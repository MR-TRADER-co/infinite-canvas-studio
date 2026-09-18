"use client";

/**
 * The clipboard-fallback file download (فاز ۲۶ «کیفیت انتخاب و
 * کلیپ‌بورد»).
 *
 * Browsers without image-clipboard writes (Firefox ships no
 * `ClipboardItem`) still deserve the pixels: the copy-as-image paths
 * degrade to DOWNLOADING the rendered PNG — the same anchor pattern the
 * SVG/PNG export dialogs have proven on the web shell. The desktop shell
 * (WebView2) always has `ClipboardItem`, so the fallback is web-only by
 * construction.
 */

/** Suggested file name of the single-image clipboard fallback download. */
export const IMAGE_DOWNLOAD_FILENAME = "infinite-canvas-image.png";

/** Suggested file name of the selection-snapshot clipboard fallback. */
export const SELECTION_SNAPSHOT_FILENAME = "infinite-canvas-selection.png";

/**
 * Triggers the browser download of one blob (fail-safe, never throws).
 *
 * @param blob - the payload to download.
 * @param name - the suggested file name.
 * @returns whether the download was triggered (false on the server or a
 *          DOM-less runtime).
 */
export function downloadBlob(blob: Blob, name: string): boolean {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return false;
  }
  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}
