"use client";

/**
 * The OS-clipboard bridge (Phase 23 — «پل کلیپ‌بورد»).
 *
 * Browser-only side of the clipboard interop:
 * - writing `text/plain` so copied canvas text pastes into Word, mail and
 *   every plain-text field;
 * - writing `image/png` rendered from the image object's ORIGINAL source
 *   at its INTRINSIC pixel size — so a resized-on-canvas picture still
 *   leaves the canvas at its original quality (Photoshop / After Effects
 *   / Word receive the full-resolution bitmap);
 * - reading images/text back (permission-gated; failures resolve null).
 *
 * Image writes resolve a TRI-STATE outcome (فاز ۲۶ «کیفیت انتخاب و
 * کلیپ‌بورد»): `"written"` (the OS clipboard holds the PNG),
 * `"unsupported"` (this browser cannot write images at all — Firefox
 * ships no `ClipboardItem`; the caller falls back to a PNG download) and
 * `"failed"` (a genuine write/render error — the caller raises the
 * honest Persian error toast). Every entry point stays fail-safe and
 * never throws.
 */
import type { ImageObjectData } from "@/core/model/ImageObject";

/** Outcome of a system-clipboard IMAGE write attempt (فاز ۲۶). */
export type ClipboardWriteOutcome =
  | "written"
  /** The browser has no image-clipboard write API (e.g. Firefox) — the
   * caller should fall back to a PNG download. */
  | "unsupported"
  /** The write or the render genuinely failed — surface the error. */
  | "failed";

/** @returns whether the async clipboard write API exists. */
function hasAsyncClipboard(): boolean {
  // فاز ۲۶ robustness: `navigator.clipboard` is UNDEFINED on insecure
  // origins (plain http) — optional chaining keeps the probe fail-safe
  // instead of throwing an unhandled TypeError.
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

/** @returns whether this browser can write IMAGES to the OS clipboard. */
export function canWriteImagesToSystemClipboard(): boolean {
  return hasAsyncClipboard() && typeof ClipboardItem !== "undefined";
}

/**
 * Writes plain text to the system clipboard.
 *
 * @param text - the text to publish.
 * @returns whether the write succeeded.
 */
export async function writeTextToSystemClipboard(
  text: string,
): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.clipboard?.writeText !== "function"
  ) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Renders one image object into a PNG blob at its INTRINSIC pixel size.
 *
 * @param object - the image object being exported.
 * @returns the PNG blob, or null when the source cannot be decoded.
 */
export async function imageObjectToPngBlob(
  object: ImageObjectData,
): Promise<Blob | null> {
  if (typeof document === "undefined") {
    return null;
  }
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
  });
  image.src = object.src;
  const ok = await loaded;
  if (!ok) {
    return null;
  }
  // The ORIGINAL quality contract: the bitmap is drawn at the intrinsic
  // pixel size — never at the placed (possibly squashed) world size.
  const width = Math.max(1, object.naturalWidth || image.naturalWidth);
  const height = Math.max(1, object.naturalHeight || image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) {
    return null;
  }
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, width, height);
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * Writes one image object to the system clipboard as `image/png` at its
 * ORIGINAL size and quality.
 *
 * @param object - the image object being copied out.
 * @returns the tri-state outcome (فاز ۲۶): "unsupported" means this
 *          browser cannot write images (Firefox) — the caller falls back
 *          to downloading the rendered PNG.
 */
export async function writeImageObjectToSystemClipboard(
  object: ImageObjectData,
): Promise<ClipboardWriteOutcome> {
  if (object.src === "") {
    return "failed";
  }
  if (!hasAsyncClipboard() || typeof ClipboardItem === "undefined") {
    return "unsupported";
  }
  const blob = await imageObjectToPngBlob(object);
  if (blob === null) {
    return "failed";
  }
  try {
    // A Promise payload maximises Safari compatibility (it requires the
    // blob lazily); Chrome accepts both.
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": Promise.resolve(blob).then(() => blob) }),
    ]);
    return "written";
  } catch {
    return "failed";
  }
}

/**
 * Writes a rasterised SELECTION snapshot to the system clipboard
 * (فاز ۲۴ «کپی چندشیء به‌صورت تصویر») as `image/png`, optionally riding
 * the plain-text projection in the SAME `ClipboardItem` — one atomic
 * `navigator.clipboard.write` call, so image consumers (Word, PowerPoint,
 * Photoshop) receive the snapshot while text consumers still find the
 * textual projection.
 *
 * @param image - the rasterised selection PNG.
 * @param text - the selection's plain-text projection, or null when the
 *        selection carries no text.
 * @returns the tri-state outcome (فاز ۲۶): "unsupported" means this
 *          browser cannot write images (Firefox) — the caller falls back
 *          to writing the text alone + downloading the PNG.
 */
export async function writeSelectionImageToSystemClipboard(
  image: Blob,
  text: string | null,
): Promise<ClipboardWriteOutcome> {
  if (!hasAsyncClipboard() || typeof ClipboardItem === "undefined") {
    return "unsupported";
  }
  try {
    const payload: Record<string, Blob | Promise<Blob>> = {
      // A Promise payload maximises Safari compatibility (it requires the
      // blob lazily); Chrome accepts both.
      "image/png": Promise.resolve(image).then(() => image),
    };
    if (text !== null && text.trim().length > 0) {
      payload["text/plain"] = new Blob([text], { type: "text/plain" });
    }
    await navigator.clipboard.write([new ClipboardItem(payload)]);
    return "written";
  } catch {
    return "failed";
  }
}

/**
 * Writes a RICH text payload to the system clipboard (فاز ۳۵ — «خروج غنی
 * از بوم»): `text/html` + `text/plain` ride ONE atomic `ClipboardItem`,
 * so Word / Outlook / AI chats paste the STRUCTURE (headings, bold,
 * lists, tables) while plain-text consumers still find the projection.
 *
 * @param html - the sanitized HTML fragment (see `richTextOut`).
 * @param text - the plain-text projection (always shipped alongside).
 * @returns the tri-state (فاز ۲۶): "unsupported" means this browser has
 *          no `ClipboardItem` (Firefox) — the caller falls back to the
 *          plain `writeText` path so the text still lands.
 */
export async function writeRichTextToSystemClipboard(
  html: string,
  text: string,
): Promise<ClipboardWriteOutcome> {
  if (!hasAsyncClipboard() || typeof ClipboardItem === "undefined") {
    return "unsupported";
  }
  try {
    const payload: Record<string, Blob | Promise<Blob>> = {
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" }),
    };
    await navigator.clipboard.write([new ClipboardItem(payload)]);
    return "written";
  } catch {
    return "failed";
  }
}

/** Outcome of a system-clipboard read attempt. */
export type SystemReadStatus =
  | "ok"
  /** The read() API threw — permission denied or document not focused. */
  | "denied"
  /** No async clipboard read API in this browser (e.g. old Firefox). */
  | "unsupported";

/** One system-clipboard read result. */
export interface SystemClipboardRead {
  readonly status: SystemReadStatus;
  /** The first image payload, when present. */
  readonly image: Blob | null;
  /** The text/plain payload, when present. */
  readonly text: string | null;
}

/**
 * Reads the system clipboard (permission-gated): the first image and the
 * plain text ride one `navigator.clipboard.read()` call when available,
 * falling back to `readText()` in text-only browsers.
 *
 * @returns the discriminated read result (never throws).
 */
export async function readSystemClipboard(): Promise<SystemClipboardRead> {
  if (
    typeof navigator === "undefined" ||
    navigator.clipboard == null
  ) {
    return { status: "unsupported", image: null, text: null };
  }
  if (typeof navigator.clipboard.read !== "function") {
    try {
      const text = await navigator.clipboard.readText();
      return { status: "ok", image: null, text };
    } catch {
      return { status: "denied", image: null, text: null };
    }
  }
  try {
    const items = await navigator.clipboard.read();
    let image: Blob | null = null;
    let text: string | null = null;
    for (const item of items) {
      if (image === null) {
        const imageType = item.types.find((candidate) =>
          candidate.startsWith("image/"),
        );
        if (imageType !== undefined) {
          image = await item.getType(imageType);
        }
      }
      if (text === null && item.types.includes("text/plain")) {
        const blob = await item.getType("text/plain");
        text = await blob.text();
      }
      if (image !== null && text !== null) {
        break;
      }
    }
    return { status: "ok", image, text };
  } catch {
    return { status: "denied", image: null, text: null };
  }
}
