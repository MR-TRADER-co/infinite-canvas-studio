/**
 * ThumbnailService (فاز M1 — A.2.2): captures the poster frame and
 * metadata of an imported video.
 *
 * A hidden `HTMLVideoElement` (blob URL, detached from the DOM, muted)
 * loads the metadata, seeks to {@link pickTimestamp} and draws the frame
 * onto a canvas at max 480px width, encoded JPEG q0.8 — the resulting
 * blob becomes the sidecar `thumb` asset. Duration, intrinsic dimensions
 * and the MIME type are captured alongside. When ANY step fails the
 * capture resolves null → the caller keeps a VALID object with the
 * film-icon fallback poster (`thumbHash: null`), per A.2.2.
 *
 * Hygiene (finally-semantics): the blob URL is revoked and the element
 * released on EVERY path — no leaked decoders after import (the canvas
 * never holds a live `<video>`; ACM1.10's zero-`<video>`-elements rule).
 */
import { pickTimestamp } from "@/media/pickTimestamp";

/** Widest captured poster (pixels) — A.2.2's thumbnail contract. */
export const THUMBNAIL_MAX_WIDTH = 480;

/** JPEG encode quality of the captured poster. */
export const THUMBNAIL_JPEG_QUALITY = 0.8;

/** Hard timeout for metadata/seek steps (the import must not hang). */
const CAPTURE_TIMEOUT_MS = 15_000;

/** The captured thumbnail + metadata of one imported video. */
export interface VideoThumbnail {
  /** The poster JPEG blob (≤ 480px wide, q0.8). */
  readonly blob: Blob;
  /** The poster's pixel width. */
  readonly thumbWidth: number;
  /** The poster's pixel height. */
  readonly thumbHeight: number;
  /** The video's playable duration in milliseconds (0 when unknown). */
  readonly durationMs: number;
  /** The video's intrinsic width in pixels. */
  readonly width: number;
  /** The video's intrinsic height in pixels. */
  readonly height: number;
}

/**
 * Captures the thumbnail + metadata of a video file.
 *
 * @param file - the imported video file.
 * @returns the thumbnail + metadata, or null when the capture failed
 *          (unplayable codec, unreadable metadata, seek timeout — the
 *          caller falls back to the film-icon poster).
 */
export async function captureVideoThumbnail(
  file: Blob,
): Promise<VideoThumbnail | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  // A hint that we never intend to play: some engines defer decoder
  // setup otherwise.
  video.autoplay = false;
  try {
    video.src = url;
    const metadata = await withTimeout(
      waitForEvent(video, "loadedmetadata"),
      CAPTURE_TIMEOUT_MS,
    );
    if (!metadata) {
      return null;
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width <= 0 || height <= 0) {
      return null;
    }
    // Seek to the pure pick point (unit-tested separately, ACM1.7).
    const seeked = await withTimeout(
      seekTo(video, pickTimestamp(duration * 1000)),
      CAPTURE_TIMEOUT_MS,
    );
    if (!seeked) {
      return null;
    }
    const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (context === null) {
      return null;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await toJpeg(canvas);
    if (blob === null || blob.size === 0) {
      return null;
    }
    return {
      blob,
      thumbWidth: canvas.width,
      thumbHeight: canvas.height,
      durationMs: Math.round(duration * 1000),
      width,
      height,
    };
  } catch {
    return null;
  } finally {
    // Finally-semantics (A.2.2): the element and the blob URL are ALWAYS
    // released — detach the source and drop the decoder.
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Encodes a canvas as JPEG q0.8.
 *
 * @param canvas - the captured frame.
 * @returns the JPEG blob, or null when encoding fails.
 */
function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      "image/jpeg",
      THUMBNAIL_JPEG_QUALITY,
    );
  });
}

/**
 * Resolves when the element fires `type` once.
 *
 * @param video - the element to observe.
 * @param type - the event name.
 * @returns a promise resolving true on the event.
 */
function waitForEvent(
  video: HTMLVideoElement,
  type: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (): void => resolve(true);
    video.addEventListener(type, done, { once: true });
  });
}

/**
 * Seeks the element and resolves on `seeked`.
 *
 * @param video - the element to seek.
 * @param seconds - the target position.
 * @returns a promise resolving true when the seek completed.
 */
function seekTo(video: HTMLVideoElement, seconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (): void => resolve(true);
    video.addEventListener("seeked", done, { once: true });
    try {
      video.currentTime = Math.max(0, seconds);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Races a promise against a timeout.
 *
 * @param promise - the awaited step.
 * @param ms - the timeout in milliseconds.
 * @returns the promise's value, or false when the timeout won.
 */
async function withTimeout(
  promise: Promise<boolean>,
  ms: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
