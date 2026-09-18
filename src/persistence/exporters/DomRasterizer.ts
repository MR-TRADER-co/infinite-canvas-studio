/**
 * DOM rasterizer (R4.8): rasterizes the text layer's HTML through the
 * SVG-`<foreignObject>` technique — the ONLY browser mechanism that
 * renders arbitrary HTML (bidi text, lists, tables, rotated boxes) into
 * a canvas-drawable image without a headless browser.
 *
 * Pipeline: build `<svg><foreignObject><div xmlns=…>` → data URL →
 * `Image.decode()` → draw. External resources are BLOCKED inside SVG
 * images, so the Vazirmatn webfont is EMBEDDED as base64 `@font-face`
 * rules collected from the live document stylesheets (fonts.css). System
 * fonts (Tahoma, ui-monospace fallbacks) resolve natively inside the
 * rasterization context.
 *
 * Failures are LOUD: a font collection failure or a rasterization
 * error/timeout rejects with a typed error — content is never silently
 * dropped from an export.
 */
import { isTauriEnvironment } from "@/platform/tauri/log";

/** Rasterization timeout — a hung decode must not freeze the dialog. */
const RASTERIZE_TIMEOUT_MS = 15_000;

/** Font weights embedded into the export (everything the prose uses). */
const EMBEDDED_WEIGHTS: readonly number[] = [400, 600, 700, 800];

/** Module-level cache of the collected font-face CSS (one fetch/weight). */
let embeddedFontFacesCache: string | null = null;

/** Typed failure of the DOM rasterizer (surfaced as a Persian error). */
export class DomRasterizerError extends Error {
  /**
   * @param kind - the machine-readable failure kind.
   * @param message - the developer-facing detail.
   */
  public constructor(
    public readonly kind: "fonts-unavailable" | "rasterization-failed",
    message: string,
  ) {
    super(message);
    this.name = "DomRasterizerError";
  }
}

/**
 * Extracts the Vazirmatn `@font-face` rules from the live stylesheets and
 * rewrites each `url(...)` into a base64 data URL (external resources
 * cannot load inside an SVG image). Memoised per session.
 *
 * @returns the embedded `@font-face` CSS block (empty string when the
 *          stylesheet scan finds nothing — the rasterizer still works
 *          through system-font fallbacks, but Persian text quality drops;
 *          the EXPORTER decides whether that is acceptable).
 * @throws DomRasterizerError when a font file fails to fetch.
 */
export async function collectEmbeddedFontFaces(): Promise<string> {
  if (embeddedFontFacesCache !== null) {
    return embeddedFontFacesCache;
  }
  const faces = collectVazirmatnFaceRules();
  if (faces.length === 0) {
    embeddedFontFacesCache = "";
    return embeddedFontFacesCache;
  }
  const rules: string[] = [];
  for (const face of faces) {
    if (!EMBEDDED_WEIGHTS.includes(face.weight)) {
      continue;
    }
    const dataUrl = await fetchAsDataUrl(face.url, face.weight);
    rules.push(
      `@font-face { font-family: "Vazirmatn"; font-style: normal; ` +
        `font-weight: ${face.weight}; src: url(${dataUrl}) format("woff2"); }`,
    );
  }
  embeddedFontFacesCache = rules.join("\n");
  return embeddedFontFacesCache;
}

/** One `@font-face` rule discovered in the live stylesheets. */
interface FontFaceRule {
  /** Declared weight (parsed from the rule's text). */
  readonly weight: number;
  /** The resolved absolute `src` URL. */
  readonly url: string;
}

/**
 * Scans the document stylesheets for Vazirmatn `@font-face` rules.
 *
 * @returns the discovered rules (cross-origin sheets are skipped).
 */
function collectVazirmatnFaceRules(): FontFaceRule[] {
  if (typeof document === "undefined") {
    return [];
  }
  const rules: FontFaceRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue; // cross-origin / inaccessible sheet
    }
    for (const rule of Array.from(cssRules)) {
      if (!(rule instanceof CSSFontFaceRule)) {
        continue;
      }
      const text = rule.cssText;
      if (!text.includes('"Vazirmatn"') && !text.includes("'Vazirmatn'")) {
        continue;
      }
      const weightMatch = text.match(/font-weight:\s*(\d+)/);
      const urlMatch = text.match(/url\(([^)]+)\)/);
      if (weightMatch === null || urlMatch === null) {
        continue;
      }
      const weight = Number(weightMatch[1] ?? Number.NaN);
      const url = (urlMatch[1] ?? "").replace(/^['"]|['"]$/g, "");
      if (!Number.isFinite(weight) || url.length === 0) {
        continue;
      }
      rules.push({
        weight,
        url: new URL(url, sheet.href ?? document.baseURI).href,
      });
    }
  }
  return rules;
}

/**
 * Fetches a font file and encodes it as a base64 data URL.
 *
 * @param url - the absolute font URL.
 * @param weight - the weight (error context).
 * @returns the `data:font/woff2;base64,…` URL.
 * @throws DomRasterizerError when the fetch fails.
 */
async function fetchAsDataUrl(url: string, weight: number): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    return `data:font/woff2;base64,${base64}`;
  } catch (error) {
    throw new DomRasterizerError(
      "fonts-unavailable",
      `Vazirmatn ${weight} fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * @param buffer - the bytes to encode.
 * @returns the base64 string.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

/**
 * Rasterizes one HTML fragment at the given pixel size.
 *
 * @param html - the fragment (positioned inside a relative root).
 * @param width - the output width in pixels.
 * @param height - the output height in pixels.
 * @param fontFacesCss - the embedded `@font-face` rules (from
 *        {@link collectEmbeddedFontFaces}).
 * @returns the decoded image (ready for `drawImage`).
 * @throws DomRasterizerError when rasterization fails or times out.
 */
export async function rasterizeHtml(
  html: string,
  width: number,
  height: number,
  fontFacesCss: string,
): Promise<HTMLImageElement> {
  if (typeof window === "undefined" || typeof Image === "undefined") {
    throw new DomRasterizerError(
      "rasterization-failed",
      "no DOM image support",
    );
  }
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new DomRasterizerError(
      "rasterization-failed",
      `invalid size ${width}x${height}`,
    );
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" ` +
    `style="position:relative;width:${width}px;height:${height}px;overflow:hidden;` +
    `font-family:'Vazirmatn','Tahoma',ui-sans-serif,sans-serif;direction:rtl;">` +
    (fontFacesCss.length > 0 ? `<style>${fontFacesCss}</style>` : "") +
    xmlNormalizeFragment(html) +
    `</div></foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = new Image();
  image.decoding = "sync";
  try {
    await Promise.race([
      decodeImage(image, url),
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new DomRasterizerError(
                "rasterization-failed",
                `decode timed out after ${RASTERIZE_TIMEOUT_MS}ms`,
              ),
            ),
          RASTERIZE_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    // On failure the image src is cleared to avoid stray network attempts.
    image.src = "";
    if (error instanceof DomRasterizerError) {
      throw error;
    }
    throw new DomRasterizerError(
      "rasterization-failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new DomRasterizerError(
      "rasterization-failed",
      "rasterized image is empty",
    );
  }
  return image;
}

/**
 * XML-normalises one HTML fragment before it is embedded into the SVG
 * rasterization context (فاز ۲۴ fix): the browser's HTML serialisation
 * leaves VOID elements (`<col>`, `<br>`, `<hr>`, `<img>`) UNCLOSED — valid
 * HTML, INVALID XML — and one unclosed `<col>` inside a rich-text table
 * makes the WHOLE SVG image fail to load (every export of a canvas that
 * contains a table or a hard break silently died at this step). The
 * DOMParser → XMLSerializer round-trip closes every void element and
 * escapes every entity, producing XHTML the SVG engine accepts.
 *
 * @param html - the fragment as HTML serialisation produced it.
 * @returns the XML-safe fragment (the input unchanged when the ambient
 *          DOM lacks the parsers — pure-node tests).
 */
export function xmlNormalizeFragment(html: string): string {
  const parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  const serializerCtor =
    (globalThis as { XMLSerializer?: typeof XMLSerializer }).XMLSerializer;
  if (parser === undefined || serializerCtor === undefined) {
    return html;
  }
  try {
    const doc = new parser().parseFromString(html, "text/html");
    const serializer = new serializerCtor();
    const parts: string[] = [];
    for (const child of Array.from(doc.body.childNodes)) {
      parts.push(serializer.serializeToString(child));
    }
    return parts.join("");
  } catch {
    return html;
  }
}

/**
 * Loads + fully decodes one image from a data URL.
 *
 * @param image - the image element to load into.
 * @param url - the data URL.
 * @returns a promise resolving when decode completes.
 */
function decodeImage(image: HTMLImageElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    image.onload = () => {
      resolve();
    };
    image.onerror = () => {
      reject(
        new DomRasterizerError(
          "rasterization-failed",
          `SVG image failed to load`,
        ),
      );
    };
    image.src = url;
  });
}

/**
 * @returns whether rasterization can run in this environment at all
 *          (false in SSR — the export dialog hides itself).
 */
export function canRasterize(): boolean {
  return typeof window !== "undefined" && typeof Image !== "undefined";
}

/** Re-exported for tests: the internal base64 helper + the XML normaliser. */
export const testing = {
  arrayBufferToBase64,
  collectVazirmatnFaceRules,
  xmlNormalizeFragment,
};

/** Whether the font collection should skip the DOM scan (SSR tests). */
export const rasterizerEnvironment = { isTauri: isTauriEnvironment };
