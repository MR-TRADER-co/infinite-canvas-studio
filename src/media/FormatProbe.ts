/**
 * FormatProbe (فاز M2 — RM2.3, A.2.4): the PURE import-gate classifier.
 *
 * Decides how one video candidate enters the app:
 * - `accepted` — the browser can play it natively → the M1 direct path;
 * - `convert` — a known video container the browser cannot play
 *   (or an accepted extension with an unsupported codec) → the OFFLINE
 *   ffmpeg.wasm conversion dialog (RM2.5);
 * - `unknown` — neither a video type nor a video extension → the
 *   Persian rejection toast; no object is ever created.
 *
 * فاز A2 (RA2.3): the AUDIO twin — `routeAudioFile` — classifies audio
 * candidates through the SAME three-way verdict on the Appendix A-1
 * matrix: `.mp3/.m4a/.aac/.ogg` are the DIRECT set (probed), `.wav/.flac`
 * ALWAYS convert, and a video-typed File carrying an audio extension
 * (a renamed `.mp4`) routes to conversion so `-vn` strips the stray
 * video stream.
 *
 * The `canPlayType` probe is INJECTED so the module stays pure and
 * unit-testable (the DOM call is one line at the call site).
 */
import { ACCEPTED_VIDEO_EXTENSIONS, extensionOf } from "@/media/videoFormats";
import {
  ACCEPTED_AUDIO_EXTENSIONS,
  CONVERT_AUDIO_EXTENSIONS,
} from "@/media/audioFormats";

/** The browser's canPlayType verdict. */
export type CanPlayVerdict = "" | "maybe" | "probably";

/** The injectable playability probe (document.createElement("video")). */
export type PlayabilityProbe = (mimeType: string) => CanPlayVerdict;

/** The import route of one video file. */
export type VideoRoute =
  | { readonly kind: "accepted"; readonly mimeType: string }
  | { readonly kind: "convert"; readonly mimeType: string }
  | { readonly kind: "unknown" };

/**
 * Routes one file through the import gate.
 *
 * Policy (A.2.4):
 * - an accepted extension whose MIME plays natively → straight in;
 * - an accepted extension whose codec the browser refuses (e.g. a
 *   QuickTime `.mov`) → conversion;
 * - any OTHER `video/*`-typed container (.avi/.mkv/.wmv/.flv…) →
 *   conversion;
 * - anything else → unknown (the Persian toast; never an object).
 *
 * @param file - the candidate file (name + optional browser MIME).
 * @param canPlay - the injected playability probe.
 * @returns the route for the file.
 */
export function routeVideoFile(
  file: { readonly name: string; readonly type?: string },
  canPlay: PlayabilityProbe,
): VideoRoute {
  const extension = extensionOf(file.name);
  const typedMime =
    file.type !== undefined && file.type.startsWith("video/")
      ? file.type
      : undefined;
  if (!ACCEPTED_VIDEO_EXTENSIONS.includes(extension) && typedMime === undefined) {
    return { kind: "unknown" };
  }
  if (!ACCEPTED_VIDEO_EXTENSIONS.includes(extension)) {
    // A `video/*`-typed FOREIGN container (.avi/.mkv/.wmv/.flv…) always
    // routes to conversion (A.2.4) — the probe is not consulted.
    return { kind: "convert", mimeType: typedMime ?? "video/mp4" };
  }
  const mimeType =
    typedMime ?? mimeForExtension(extension) ?? "video/mp4";
  const plays = canPlay(mimeType);
  if (plays === "") {
    // The probe FAILS only on the empty verdict ("maybe" means the
    // browser will attempt it — plain `video/mp4` answers "maybe" in
    // every engine and plays fine). Failure ⇒ offline conversion.
    return { kind: "convert", mimeType };
  }
  return { kind: "accepted", mimeType };
}

/**
 * The DOM probe factory (the one impure line, injected by callers).
 *
 * @returns the live `canPlayType` probe of a detached video element.
 */
export function domPlayabilityProbe(): PlayabilityProbe {
  const video = document.createElement("video");
  return (mimeType) =>
    video.canPlayType(mimeType) as CanPlayVerdict;
}

/** The import route of one audio file (فاز A2 — RA2.3). */
export type AudioRoute =
  | { readonly kind: "accepted"; readonly mimeType: string }
  | { readonly kind: "convert"; readonly mimeType: string }
  | { readonly kind: "unknown" };

/**
 * Routes one audio file through the import gate (Appendix A-1).
 *
 * Policy:
 * - an accepted extension OUTSIDE the direct set (`.wav`/`.flac`) →
 *   ALWAYS conversion (the binding matrix — the probe is not
 *   consulted; even a wav this engine could play converts to MP3);
 * - a DIRECT-set extension whose MIME plays natively → straight in;
 * - a DIRECT-set extension whose codec the probe refuses → conversion;
 * - a VIDEO-typed File carrying an audio extension (a renamed `.mp4`)
 *   → conversion (the `-vn` strip case, fixture e);
 * - an audio-typed file with a foreign extension or no accepted
 *   extension at all → unknown (the Persian toast; never an object).
 *
 * @param file - the candidate file (name + optional browser MIME).
 * @param canPlay - the injected playability probe.
 * @returns the route for the file.
 */
export function routeAudioFile(
  file: { readonly name: string; readonly type?: string },
  canPlay: PlayabilityProbe,
): AudioRoute {
  const extension = extensionOf(file.name);
  if (!ACCEPTED_AUDIO_EXTENSIONS.includes(extension)) {
    return { kind: "unknown" };
  }
  // A renamed video container riding an audio extension: the bytes
  // carry a video stream — conversion strips it (-vn) and produces a
  // clean MP3 (fixture e).
  if (file.type !== undefined && file.type.startsWith("video/")) {
    return { kind: "convert", mimeType: file.type };
  }
  if (CONVERT_AUDIO_EXTENSIONS.includes(extension)) {
    return { kind: "convert", mimeType: audioMimeForExtension(extension) };
  }
  const mimeType =
    file.type !== undefined && file.type.startsWith("audio/")
      ? file.type
      : audioMimeForExtension(extension);
  const plays = canPlay(mimeType);
  if (plays === "") {
    // The probe FAILS only on the empty verdict ("maybe" means the
    // browser will attempt it — plain `audio/mpeg` answers "maybe"
    // in every engine and plays fine). Failure ⇒ offline conversion.
    return { kind: "convert", mimeType };
  }
  return { kind: "accepted", mimeType };
}

/**
 * The AUDIO DOM probe factory (a detached `<audio>` element — A.2.4).
 *
 * @returns the live `canPlayType` probe of a detached audio element.
 */
export function domAudioPlayabilityProbe(): PlayabilityProbe {
  const audio = document.createElement("audio");
  return (mimeType) =>
    audio.canPlayType(mimeType) as CanPlayVerdict;
}

/**
 * @param extension - a lower-cased audio extension WITH the dot.
 * @returns the canonical MIME, or the mp3 default.
 */
function audioMimeForExtension(extension: string): string {
  switch (extension) {
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".ogg":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    case ".flac":
      return "audio/flac";
    default:
      return "audio/mpeg";
  }
}

/**
 * @param extension - a lower-cased extension WITH the dot.
 * @returns the canonical MIME, or null when unknown.
 */
function mimeForExtension(extension: string): string | null {
  switch (extension) {
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".ogv":
      return "video/ogg";
    default:
      return null;
  }
}
