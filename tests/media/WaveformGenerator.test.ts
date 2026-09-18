// @vitest-environment jsdom
/**
 * WaveformGenerator unit tests (فاز A1 — ACA1.7): the decode → peaks →
 * JPEG pipeline with a MOCKED decode host and a recording canvas-2D
 * stand-in (jsdom ships no real 2D context — the StickerGlyphPaint
 * recording-fake pattern).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  drawWaveform,
  generateAudioWaveform,
  samplePeaks,
  WAVEFORM_PEAKS,
  type AudioBufferLike,
  type DecodeHost,
} from "@/media/WaveformGenerator";

/** Every recorded 2D-context method call. */
const calls: string[] = [];

/** A recording no-op 2D-context stand-in. */
function fakeContext(): CanvasRenderingContext2D {
  return new Proxy(
    {},
    {
      get:
        (_target, prop: string) =>
        (..._args: unknown[]) => {
          calls.push(prop);
          return undefined;
        },
    },
  ) as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    fakeContext(),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    function (
      this: HTMLCanvasElement,
      callback: ((blob: Blob | null) => void) | null,
    ) {
      callback?.(
        new Blob([new Uint8Array([9, 9, 9, 9])], { type: "image/jpeg" }),
      );
      return undefined;
    },
  );
});

/** A deterministic 1-channel buffer fake (5s of sine). */
function fakeBuffer(duration: number, frames: number, channels = 1) {
  const data = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    data[i] = Math.sin((i / frames) * Math.PI * 8) * 0.8;
  }
  return {
    duration,
    numberOfChannels: channels,
    getChannelData: (channel: number) =>
      channel === 0 ? data : new Float32Array(frames),
  };
}

/** Host factory wrapping a canned buffer. */
function hostOf(buffer: unknown, fail = false): () => DecodeHost | null {
  return () => ({
    decodeAudioData: fail
      ? () => Promise.reject(new Error("corrupt"))
      : () => Promise.resolve(buffer as AudioBufferLike),
  });
}

describe("samplePeaks", () => {
  it("downsamples to ~200 normalised max-amplitude buckets", () => {
    const peaks = samplePeaks(fakeBuffer(2, 44_100));
    expect(peaks).toHaveLength(WAVEFORM_PEAKS);
    for (const peak of peaks) {
      expect(peak).toBeGreaterThanOrEqual(0);
      expect(peak).toBeLessThanOrEqual(1);
      expect(Number.isFinite(peak)).toBe(true);
    }
    // The sine spans most of the amplitude range → some peaks are high.
    expect(Math.max(...peaks)).toBeGreaterThan(0.5);
  });

  it("handles an empty buffer (all-zero peaks, no crash)", () => {
    const peaks = samplePeaks({
      duration: 0,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(0),
    });
    expect(peaks).toHaveLength(WAVEFORM_PEAKS);
    expect(peaks.every((peak) => peak === 0)).toBe(true);
  });
});

describe("drawWaveform", () => {
  it("paints a ≤480px-wide centred waveform canvas", () => {
    calls.length = 0;
    const canvas = drawWaveform(new Array(200).fill(0.5));
    expect(canvas).not.toBeNull();
    expect(canvas!.width).toBeLessThanOrEqual(480);
    expect(canvas!.width).toBeGreaterThanOrEqual(240);
    expect(canvas!.height).toBe(160);
    // The plate fill + 200 bars + the centre hairline all painted.
    const fillRects = calls.filter((name) => name === "fillRect").length;
    expect(fillRects).toBeGreaterThanOrEqual(202);
  });
});

describe("generateAudioWaveform", () => {
  it("produces the JPEG blob + duration from the decoded buffer", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], {
      type: "audio/mpeg",
    });
    const result = await generateAudioWaveform(
      blob,
      hostOf(fakeBuffer(5, 44_100 * 5)),
    );
    expect(result).not.toBeNull();
    expect(result!.blob.type).toBe("image/jpeg");
    expect(result!.blob.size).toBeGreaterThan(0);
    expect(result!.thumbWidth).toBeLessThanOrEqual(480);
    expect(result!.thumbHeight).toBe(160);
    expect(result!.durationMs).toBe(5000);
  });

  it("resolves null when the decode fails (the fallback contract)", async () => {
    const blob = new Blob([new Uint8Array([1])], { type: "audio/mpeg" });
    const result = await generateAudioWaveform(blob, hostOf(null, true));
    expect(result).toBeNull();
  });

  it("resolves null when no host exists (SSR/old engines)", async () => {
    const blob = new Blob([new Uint8Array([1])], { type: "audio/mpeg" });
    const result = await generateAudioWaveform(blob, () => null);
    expect(result).toBeNull();
  });
});
