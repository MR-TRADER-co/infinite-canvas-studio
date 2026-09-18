/**
 * Audio file gates (فاز A1 — A.2.4's import half): the accepted
 * extension set, the extension→MIME map, and the pure import classifier
 * shared by every gesture (file dialog, Explorer drag-and-drop, clipboard
 * paste).
 *
 * The PLAYABILITY probe (`canPlayType` on a detached `<audio>`) and the
 * conversion routing are Phase A2's `FormatProbe`/`AudioConverter`; A1
 * accepts the six extensions, rejects truly unknown ones with a Persian
 * toast, and stores the bytes whatever the engine (the waveform
 * generator is format-agnostic — Web Audio decodes wav/flac in Chromium).
 *
 * Extension policy (Appendix A-1's binding matrix):
 * - `.mp3/.m4a/.aac/.ogg` — the native DIRECT set;
 * - `.wav/.flac` — the CONVERSION set (A2's offline ffmpeg gate);
 * - anything else — unknown (the Persian toast; never an object).
 *
 * Pure module — no DOM imports.
 */
import { extensionOf } from "@/media/videoFormats";

/** Audio extensions accepted at import (case-insensitive, with dot). */
export const ACCEPTED_AUDIO_EXTENSIONS: readonly string[] = [
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".wav",
  ".flac",
];

/** The DIRECT-import subset (probe-playable in the host engine). */
export const DIRECT_AUDIO_EXTENSIONS: readonly string[] = [
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
];

/** The CONVERSION subset (always gated through A2's offline MP3 path). */
export const CONVERT_AUDIO_EXTENSIONS: readonly string[] = [
  ".wav",
  ".flac",
];

/** Extension → canonical MIME type (files can arrive with empty `type`). */
const EXTENSION_MIME: Readonly<Record<string, string>> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
};

export { extensionOf };

/**
 * Resolves the canonical MIME type of an audio file: the browser-supplied
 * `audio/*` type wins; otherwise the extension map decides; the mp3
 * default covers extension-less payloads.
 *
 * @param file - the file (name + optional MIME type).
 * @returns the MIME type to store on the object.
 */
export function mimeTypeForAudioFile(file: {
  readonly name: string;
  readonly type?: string;
}): string {
  if (file.type !== undefined && file.type.startsWith("audio/")) {
    return file.type;
  }
  return EXTENSION_MIME[extensionOf(file.name)] ?? "audio/mpeg";
}

/**
 * The pure import classifier: splits a gesture's files into the audio
 * clips the app accepts and the ones it must reject (unknown extensions
 * — the Persian toast case of RA1.3; image/video/other files pass
 * through untouched for their own pipelines — the audio filter must
 * NEVER hijack an image or video drop).
 *
 * Acceptance rule: an accepted EXTENSION lets the file in (the browser's
 * `audio/*` MIME alone, without a known extension, is NOT enough — a
 * pasted `.opus`/`.weba` would otherwise land unplayable). A
 * VIDEO-typed File carrying an audio extension (a renamed `.mp4`)
 * belongs to the VIDEO pipeline — it is skipped here so it converts
 * exactly ONCE (فاز A2's one-file-one-pipeline rule).
 *
 * @param files - the gesture's files (paste/drop/picker).
 * @returns the accepted audio files and the rejected ones (for the
 *          toast), in payload order.
 */
export function classifyAudioFiles(
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
    // A video-typed payload (renamed container) is the VIDEO
    // pipeline's business — never double-queued here.
    if (entry.type !== undefined && entry.type.startsWith("video/")) {
      continue;
    }
    const extension = extensionOf(entry.name);
    if (ACCEPTED_AUDIO_EXTENSIONS.includes(extension)) {
      accepted.push(file);
      continue;
    }
    const isAudioish =
      entry.type !== undefined && entry.type.startsWith("audio/");
    if (isAudioish) {
      // An audio-typed file with a foreign/absent extension (.opus,
      // .weba, no extension): refused — A2's convert gate owns only the
      // KNOWN containers, truly unknown ones toast.
      rejected.push(file);
    }
    // Everything else (images, videos, text, unknown) belongs to other
    // pipelines.
  }
  return { accepted, rejected };
}
