/**
 * Video file gates (فاز M1 — A.2.4's import half): the accepted extension
 * set, the extension→MIME map, and the pure import classifier shared by
 * every gesture (file dialog, Explorer drag-and-drop, clipboard paste).
 *
 * The PLAYABILITY probe (`canPlayType`) and the conversion routing are
 * Phase M2's `FormatProbe`/`VideoConverter`; M1 accepts the five native
 * extensions, rejects truly unknown ones with a Persian toast, and lets
 * known-but-unplayable containers in with the film-icon fallback poster
 * (their bytes are still stored; conversion arrives in M2).
 *
 * Pure module — no DOM imports.
 */

/** Video extensions accepted at import (case-insensitive, with dot). */
export const ACCEPTED_VIDEO_EXTENSIONS: readonly string[] = [
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".ogv",
];

/** Extension → canonical MIME type (files can arrive with empty `type`). */
const EXTENSION_MIME: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
};

/**
 * @param name - a file name (or path).
 * @returns the lower-cased extension including the dot ("" when none).
 */
export function extensionOf(name: string): string {
  const clean = name.split(/[\\/]/).pop() ?? "";
  const dot = clean.lastIndexOf(".");
  return dot <= 0 ? "" : clean.slice(dot).toLowerCase();
}

/**
 * Resolves the canonical MIME type of a video file: the browser-supplied
 * `video/*` type wins; otherwise the extension map decides; the mp4
 * default covers extension-less payloads.
 *
 * @param file - the file (name + optional MIME type).
 * @returns the MIME type to store on the object.
 */
export function mimeTypeForVideoFile(file: {
  readonly name: string;
  readonly type?: string;
}): string {
  if (file.type !== undefined && file.type.startsWith("video/")) {
    return file.type;
  }
  return EXTENSION_MIME[extensionOf(file.name)] ?? "video/mp4";
}

/**
 * The pure import classifier: splits a gesture's files into the videos
 * the app accepts and the ones it must reject (unknown extensions — the
 * Persian toast case of RM1.3; image/other files pass through untouched
 * for their own pipelines).
 *
 * Acceptance rule: a `video/*` MIME OR an accepted extension lets the
 * file in ONLY when its extension is one of the five accepted ones — a
 * `.flv`/`.avi` typed `video/x-flv` is NOT accepted here (M2 routes it
 * to the offline conversion dialog instead of silently storing an
 * unplayable blob).
 *
 * @param files - the gesture's files (paste/drop/picker).
 * @returns the accepted video files and the rejected ones (for the
 *          toast), in payload order.
 */
export function classifyVideoFiles(
  files: readonly {
    readonly name: string;
    readonly type?: string;
    readonly file?: unknown;
  }[],
): { readonly accepted: readonly File[]; readonly rejected: readonly File[] } {
  const accepted: File[] = [];
  const rejected: File[] = [];
  for (const entry of files) {
    const file = entry as unknown as File | undefined;
    if (!(file instanceof File)) {
      continue;
    }
    const extension = extensionOf(entry.name);
    const isVideoish =
      entry.type !== undefined && entry.type.startsWith("video/");
    if (ACCEPTED_VIDEO_EXTENSIONS.includes(extension)) {
      accepted.push(file);
      continue;
    }
    if (isVideoish) {
      // A video-typed file with a foreign/absent extension (.flv, .avi,
      // .mkv, .wmv, no extension): refused in M1 — M2's convert gate
      // owns these.
      rejected.push(file);
    }
    // Everything else (images, text, unknown) belongs to other pipelines.
  }
  return { accepted, rejected };
}
