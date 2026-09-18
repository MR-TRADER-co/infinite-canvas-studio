/**
 * WaveformGenerator (فاز A1 — A.2.2): renders an audio file's waveform
 * thumbnail.
 *
 * Attempt 1: decode the blob through the Web Audio API — a minimal
 * `OfflineAudioContext` (1 sample, 44.1kHz — a pure DECODER host: no
 * output device, no permission prompt) runs `decodeAudioData`, the
 * channel data is downsampled to ~200 peaks (the max amplitude per
 * bucket), and a centred waveform is drawn onto a hidden canvas (max
 * 480px wide, distinct stroke colour), encoded JPEG q0.8. The duration
 * rides along. When ANY step fails (corrupt bytes, undecodable codec)
 * the capture resolves null → the caller falls back to the audio-note
 * plate (A.2.2 Attempt 2) — the object stays valid.
 *
 * Hygiene: the `OfflineAudioContext` is detached and garbage-collected
 * (no `close()` needed), the canvas never enters the DOM, and nothing
 * is retained after the promise settles — with N audio objects on the
 * canvas and no player open, ZERO decoder elements exist (the poster
 * decodes ONCE into the shared PosterBitmapCache, ACM-style A.2.2).
 *
 * `AudioContext` is looked up lazily through `globalThis` so the module
 * stays importable in unit tests (mocked) and on the server.
 */
import { THUMBNAIL_JPEG_QUALITY } from "@/media/ThumbnailService";

/** Widest generated waveform (pixels) — A.2.2's thumbnail contract. */
export const WAVEFORM_MAX_WIDTH = 480;

/** Waveform chip height at full width (the 3:1 media-chip ratio). */
export const WAVEFORM_HEIGHT = 160;

/** Peak buckets sampled from the channel data (~200, A.2.2). */
export const WAVEFORM_PEAKS = 200;

/** Hard timeout for the decode step (the import must not hang). */
const DECODE_TIMEOUT_MS = 20_000;

/** The generated waveform thumbnail + metadata of one audio file. */
export interface AudioWaveform {
  /** The waveform JPEG blob (≤ 480px wide, q0.8). */
  readonly blob: Blob;
  /** The thumbnail's pixel width. */
  readonly thumbWidth: number;
  /** The thumbnail's pixel height. */
  readonly thumbHeight: number;
  /** The decoded duration in milliseconds (0 when unknown). */
  readonly durationMs: number;
}

/** The subset of the Web Audio decode host the generator needs. */
export interface DecodeHost {
  decodeAudioData(
    bytes: ArrayBuffer,
  ): Promise<AudioBufferLike>;
}

/** The subset of AudioBuffer the generator reads. */
export interface AudioBufferLike {
  readonly duration: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * A decode-host factory seam (mocked in tests; the real host is a
 * 1-sample OfflineAudioContext — a pure decoder with no device).
 */
export type DecodeHostFactory = () => DecodeHost | null;

/** The default host factory: the minimal OfflineAudioContext decoder. */
export function offlineDecodeHostFactory(): DecodeHost | null {
  if (typeof globalThis === "undefined") {
    return null;
  }
  const Ctor = (
    globalThis as {
      OfflineAudioContext?: new (
        channels: number,
        length: number,
        sampleRate: number,
      ) => DecodeHost & { startRendering?: () => unknown };
    }
  ).OfflineAudioContext;
  if (Ctor === undefined) {
    return null;
  }
  try {
    // 1 frame at 44.1kHz: the smallest legal context — decodeAudioData
    // works on it verbatim (BaseAudioContext API) and nothing is ever
    // rendered through a device.
    return new Ctor(1, 1, 44100);
  } catch {
    return null;
  }
}

/**
 * Generates the waveform thumbnail of an audio file.
 *
 * @param file - the imported audio blob.
 * @param hostFactory - the decode-host seam (tests inject a mock).
 * @returns the waveform + duration, or null when decoding failed (the
 *          caller falls back to the audio-note plate).
 */
export async function generateAudioWaveform(
  file: Blob,
  hostFactory: DecodeHostFactory = offlineDecodeHostFactory,
): Promise<AudioWaveform | null> {
  const host = hostFactory();
  if (host === null) {
    return null;
  }
  try {
    const bytes = await file.arrayBuffer();
    const buffer = await withTimeout(
      host.decodeAudioData(bytes),
      DECODE_TIMEOUT_MS,
    );
    if (buffer === null) {
      return null;
    }
    const peaks = samplePeaks(buffer);
    const canvas = drawWaveform(peaks);
    if (canvas === null) {
      return null;
    }
    const blob = await toJpeg(canvas);
    if (blob === null || blob.size === 0) {
      return null;
    }
    return {
      blob,
      thumbWidth: canvas.width,
      thumbHeight: canvas.height,
      durationMs: Number.isFinite(buffer.duration)
        ? Math.round(buffer.duration * 1000)
        : 0,
    };
  } catch {
    // Corrupt bytes / undecodable codec / encode failure — the caller
    // keeps a VALID object with the fallback plate (A.2.2 Attempt 2).
    return null;
  }
}

/**
 * Downsamples the buffer's channels to ~200 max-amplitude peaks.
 *
 * @param buffer - the decoded audio buffer.
 * @returns the normalised peaks (0..1) to draw.
 */
export function samplePeaks(buffer: AudioBufferLike): number[] {
  const buckets = Math.max(1, WAVEFORM_PEAKS);
  const peaks = new Array<number>(buckets).fill(0);
  const frames = buffer.numberOfChannels > 0
    ? buffer.getChannelData(0).length
    : 0;
  if (frames === 0) {
    return peaks;
  }
  // Mix every channel's |amplitude| into the shared buckets — a stereo
  // clip's waveform reads the same as its mono fold-down.
  const size = frames / buckets;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      const start = Math.floor(bucket * size);
      const end = Math.min(frames, Math.max(start + 1, Math.floor((bucket + 1) * size)));
      let peak = 0;
      for (let i = start; i < end; i += 1) {
        const amplitude = Math.abs(data[i] ?? 0);
        if (amplitude > peak) {
          peak = amplitude;
        }
      }
      if (peak > (peaks[bucket] ?? 0)) {
        peaks[bucket] = peak;
      }
    }
  }
  // Guard against 0-frequency-condition garbage (Inf/NaN) and normalise.
  for (let i = 0; i < peaks.length; i += 1) {
    const value = peaks[i] ?? 0;
    peaks[i] = Number.isFinite(value) ? Math.min(1, value) : 0;
  }
  return peaks;
}

/**
 * Draws the centred waveform onto a hidden canvas (≤ 480px wide, the
 * 3:1 chip at full width; narrower on tiny displays).
 *
 * @param peaks - the sampled, normalised peaks.
 * @returns the painted canvas, or null without a 2D context.
 */
export function drawWaveform(peaks: readonly number[]): HTMLCanvasElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const width = Math.min(WAVEFORM_MAX_WIDTH, Math.max(240, peaks.length * 2));
  const height = WAVEFORM_HEIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) {
    return null;
  }
  // The plate: a dark media surface (content, not chrome — dark on both
  // themes like every player surface).
  context.fillStyle = "oklch(0.24 0.02 260)";
  context.fillRect(0, 0, width, height);
  // The waveform: a centred symmetric bar field in a DISTINCT colour
  // (a warm coral — reads against the dark plate and never collides
  // with the app's accent tokens).
  const mid = height / 2;
  const slot = width / peaks.length;
  const bar = Math.max(1, slot * 0.72);
  context.fillStyle = "oklch(0.78 0.14 30)";
  for (let i = 0; i < peaks.length; i += 1) {
    const peak = Math.min(1, Math.max(0.02, peaks[i] ?? 0));
    const half = Math.max(1.5, peak * (height * 0.42));
    const x = i * slot + (slot - bar) / 2;
    context.fillRect(x, mid - half, bar, half * 2);
  }
  // The centre hairline ties the two mirrored halves together.
  context.fillStyle = "rgba(255, 255, 255, 0.22)";
  context.fillRect(0, mid - 0.5, width, 1);
  return canvas;
}

/**
 * Encodes a canvas as JPEG q0.8 (the SAME quality knob the video poster
 * uses — shared constant, A.2.2).
 *
 * @param canvas - the painted waveform.
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
 * Races a promise against a timeout.
 *
 * @param promise - the awaited decode.
 * @param ms - the timeout in milliseconds.
 * @returns the decode's value, or null when the timeout won.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
