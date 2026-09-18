/**
 * Pure payload extraction for EXTERNAL drag-and-drop and text pastes
 * (Phase 23 — «پل کلیپ‌بورد»).
 *
 * Dragging text or an image ELEMENT off a web page arrives as
 * `text/uri-list` / `text/html` / `text/plain` strings — never as a File.
 * This module turns that string surface into a typed payload the import
 * bridge can act on; the DOM/fetch side stays in the hook.
 */
import { DEFAULT_TEXT_HEIGHT, DEFAULT_TEXT_WIDTH } from "@/core/model/TextBoxObject";
import {
  TABLE_COL_WIDTH,
  TABLE_ROW_HEIGHT,
  type RichTextDocument,
} from "@/text/editor/richtext";
import type { JSONContent } from "@tiptap/core";

/** A textual drop/paste: becomes a text box on the canvas. */
export interface DropTextPayload {
  readonly kind: "text";
  readonly text: string;
}

/** An image URL drop: fetched, then imported at original quality. */
export interface DropImagePayload {
  readonly kind: "image-url";
  readonly url: string;
}

/** The extracted external payload (null = nothing importable). */
export type DropPayload = DropTextPayload | DropImagePayload | null;

/** Image URL extensions worth a fetch attempt. */
const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".bmp",
];

/**
 * Whether a URL points at a plausible image resource.
 *
 * @param url - the candidate URL.
 * @returns whether its path ends with a known raster/vector extension
 *          (query strings and fragments ignored).
 */
export function looksLikeImageUrl(url: string): boolean {
  let path = url;
  try {
    const parsed = new URL(url);
    path = parsed.pathname;
  } catch {
    // Relative or malformed — judge the raw string.
  }
  const lower = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Parses a `text/uri-list` payload: comment lines (starting with `#`) are
 * skipped, the first non-empty URL wins.
 *
 * @param uriList - the raw uri-list string.
 * @returns the first URL, or null.
 */
export function firstUriOf(uriList: string): string | null {
  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    return trimmed;
  }
  return null;
}

/**
 * Extracts the first `src` of an `<img>` tag inside an HTML fragment
 * (dragged-from-web images carry their address there).
 *
 * @param html - the text/html payload.
 * @returns the first image src, or null.
 */
export function firstImgSrcOf(html: string): string | null {
  const matches = html.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  return matches !== null ? (matches[1] ?? null) : null;
}

/**
 * Extracts the importable payload of an external drop.
 *
 * Priority: an HTML `<img src>` (the browser fills it for image drags) →
 * an image-looking `text/uri-list` URL → the plain text. Data URLs found
 * in either place decode straight through the image pipeline.
 *
 * @param types - the DataTransfer type list.
 * @param getData - accessor for one MIME type's string.
 * @returns the typed payload, or null when nothing importable rides along.
 */
export function extractDropPayload(
  types: readonly string[],
  getData: (type: string) => string,
): DropPayload {
  const has = (type: string): boolean => types.includes(type);
  if (has("text/html")) {
    const src = firstImgSrcOf(getData("text/html"));
    if (src !== null && (src.startsWith("data:image/") || looksLikeImageUrl(src))) {
      return { kind: "image-url", url: src };
    }
  }
  if (has("text/uri-list")) {
    const uri = firstUriOf(getData("text/uri-list"));
    if (uri !== null && (uri.startsWith("data:image/") || looksLikeImageUrl(uri))) {
      return { kind: "image-url", url: uri };
    }
  }
  if (has("text/plain")) {
    const text = getData("text/plain");
    if (text.trim() !== "") {
      return { kind: "text", text };
    }
  }
  return null;
}

/**
 * Whether a paste event's text should become a canvas text object.
 * Guarded to non-empty, sane-length payloads.
 *
 * @param text - the text/plain clipboard string.
 * @returns whether the bridge should import it.
 */
export function isImportablePasteText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed !== "" && trimmed.length <= 8000;
}

/** Font size of pasted/dropped text boxes (world units). */
export const PASTED_TEXT_FONT_SIZE = 16;

/** Longest allowed pasted text-box width (world units). */
const PASTED_TEXT_MAX_WIDTH = 640;

/** Per-glyph width estimate for the sizing heuristic (Vazirmatn-ish). */
const GLYPH_WIDTH_FACTOR = 0.62;

/** Line height estimate for the sizing heuristic. */
const LINE_HEIGHT_FACTOR = 1.55;

/**
 * The box size for a pasted/dropped text payload: width tracks the
 * longest line (clamped), height tracks the line count.
 *
 * @param text - the text being placed.
 * @param fontSize - the base font size (defaults to the pasted-text size).
 * @returns the placed {width, height} in world units.
 */
export function pastedTextBoxSize(
  text: string,
  fontSize: number = PASTED_TEXT_FONT_SIZE,
): { readonly width: number; readonly height: number } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const longest = lines.reduce(
    (max, line) => Math.max(max, line.length),
    0,
  );
  const width = Math.min(
    PASTED_TEXT_MAX_WIDTH,
    Math.max(DEFAULT_TEXT_WIDTH, Math.round(longest * fontSize * GLYPH_WIDTH_FACTOR)),
  );
  const height = Math.max(
    DEFAULT_TEXT_HEIGHT,
    Math.round(lines.length * fontSize * LINE_HEIGHT_FACTOR + 12),
  );
  return { width, height };
}

/* ── فاز ۲۴ «پیوند غنی Word»: rich-paste box sizing ───────────────────── */

/** Longest allowed RICH pasted box width (tables may need more room). */
const RICH_PASTED_MAX_WIDTH = 900;

/** Font-size multipliers of the heading levels the schema keeps. */
const HEADING_SCALES: Readonly<Record<string, number>> = {
  heading1: 2,
  heading2: 1.55,
  heading3: 1.25,
};

/** Extra vertical room per block (margins the prose CSS adds). */
const BLOCK_MARGIN = 6;

/**
 * Estimates the placed size of a RICH pasted document (فاز ۲۴): walks the
 * top-level blocks — headings count at their scaled line height, lists per
 * item, code blocks per source line, tables as `cols × TABLE_COL_WIDTH` by
 * `rows × TABLE_ROW_HEIGHT` — and unions the result with the plain-text
 * heuristic so a simple document sizes exactly like Phase 23.
 *
 * Generous by design: the DOM text layer paints overflow and the first
 * edit session re-measures the box, so the estimate only has to be sane.
 *
 * @param doc - the parsed rich document being placed.
 * @param plainText - its plain-text projection (the Phase-23 baseline).
 * @param fontSize - the base font size (defaults to the pasted-text size).
 * @returns the placed {width, height} in world units.
 */
export function estimateRichPasteBoxSize(
  doc: RichTextDocument,
  plainText: string,
  fontSize: number = PASTED_TEXT_FONT_SIZE,
): { readonly width: number; readonly height: number } {
  const base = pastedTextBoxSize(plainText, fontSize);
  const lineHeight = fontSize * LINE_HEIGHT_FACTOR;
  let width = base.width;
  let height = base.height;

  const textOf = (node: JSONContent): string => {
    if (node.type === "text") {
      return node.text ?? "";
    }
    return (node.content ?? []).reduce(
      (sum, child) => sum + textOf(child),
      "",
    );
  };

  const blockWidth = (text: string, scale: number): number =>
    Math.round(text.length * fontSize * GLYPH_WIDTH_FACTOR * scale);

  const measure = (node: JSONContent): void => {
    const type = node.type ?? "";
    const scale = HEADING_SCALES[type] ?? 1;
    switch (type) {
      case "heading": {
        const text = textOf(node);
        width = Math.max(width, blockWidth(text, scale));
        const lines = Math.max(1, Math.ceil(text.length / 40));
        height += Math.round(lines * lineHeight * (scale - 1)) + BLOCK_MARGIN;
        return;
      }
      case "bulletList":
      case "orderedList": {
        const items = node.content ?? [];
        for (const item of items) {
          measure(item);
        }
        height += items.length * 4 + BLOCK_MARGIN;
        width += Math.round(fontSize * 1.4);
        return;
      }
      case "listItem": {
        for (const child of node.content ?? []) {
          measure(child);
        }
        return;
      }
      case "blockquote": {
        height += BLOCK_MARGIN * 2;
        width += Math.round(fontSize * 0.75);
        for (const child of node.content ?? []) {
          measure(child);
        }
        return;
      }
      case "codeBlock": {
        const lines = textOf(node).split("\n").length;
        height += Math.round(lines * lineHeight * 0.85) + BLOCK_MARGIN;
        return;
      }
      case "horizontalRule": {
        height += Math.round(lineHeight);
        return;
      }
      case "table": {
        let columns = 0;
        const rows = node.content ?? [];
        for (const row of rows) {
          const cells = (row.content ?? []).length;
          columns = Math.max(columns, cells);
        }
        width = Math.max(
          width,
          columns * TABLE_COL_WIDTH + Math.round(fontSize),
        );
        height = Math.max(height, rows.length * TABLE_ROW_HEIGHT + 16);
        return;
      }
      default: {
        const text = textOf(node);
        if (text.length > 0) {
          width = Math.max(width, blockWidth(text, scale));
        }
        for (const child of node.content ?? []) {
          measure(child);
        }
      }
    }
  };

  for (const block of doc.content ?? []) {
    measure(block);
  }
  return {
    width: Math.min(RICH_PASTED_MAX_WIDTH, Math.max(DEFAULT_TEXT_WIDTH, width)),
    height: Math.max(DEFAULT_TEXT_HEIGHT, height),
  };
}
