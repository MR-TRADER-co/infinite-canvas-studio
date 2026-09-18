/**
 * AudioObject unit tests (فاز A1): the pure model — factory defaults,
 * guards, the placed-size rule, the relocation manifest and the
 * timecode core.
 */
import { describe, expect, it } from "vitest";
import {
  AUDIO_FALLBACK_INTRINSIC,
  audioTimecodeLatin,
  collectAudioAssetHashes,
  createAudioObject,
  isAudioObject,
  placedAudioSize,
} from "@/core/model/AudioObject";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { vec2 } from "@/core/geometry/Vec2";

/** A minimal non-audio object for guard checks. */
const other: SceneObjectData = {
  id: "x",
  kind: "textBox",
  position: vec2(0, 0),
  rotation: 0,
  zIndex: 0,
  visible: true,
  locked: false,
} as unknown as SceneObjectData;

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_T = "c".repeat(64);

describe("isAudioObject", () => {
  it("accepts kind=audio only", () => {
    const audio = createAudioObject(
      "a1",
      {
        assetHash: HASH_A,
        thumbHash: null,
        originalName: "clip.mp3",
        mimeType: "audio/mpeg",
        durationMs: 5000,
      },
      vec2(10, 20),
    );
    expect(isAudioObject(audio)).toBe(true);
    expect(isAudioObject(other)).toBe(false);
  });
});

describe("createAudioObject", () => {
  it("builds the full data shape with defaults", () => {
    const audio = createAudioObject(
      "a2",
      {
        assetHash: HASH_A,
        thumbHash: HASH_T,
        originalName: "song.mp3",
        mimeType: "audio/mpeg",
        durationMs: 12345.6,
      },
      vec2(5, 7),
      { width: 300, height: 100 },
      9,
    );
    expect(audio.kind).toBe("audio");
    expect(audio.id).toBe("a2");
    expect(audio.position).toEqual(vec2(5, 7));
    expect(audio.rotation).toBe(0);
    expect(audio.zIndex).toBe(9);
    expect(audio.visible).toBe(true);
    expect(audio.locked).toBe(false);
    expect(audio.assetHash).toBe(HASH_A);
    expect(audio.thumbHash).toBe(HASH_T);
    expect(audio.originalName).toBe("song.mp3");
    expect(audio.mimeType).toBe("audio/mpeg");
    expect(audio.durationMs).toBe(12346);
    expect(audio.width).toBe(300);
    expect(audio.height).toBe(100);
    expect(audio.origAssetHash).toBeUndefined();
  });

  it("defaults the placed size to the 3:1 intrinsic and clamps", () => {
    const audio = createAudioObject(
      "a3",
      {
        assetHash: HASH_A,
        thumbHash: null,
        originalName: "n.mp3",
        mimeType: "audio/mpeg",
        durationMs: 0,
      },
      vec2(0, 0),
    );
    expect(audio.width).toBe(AUDIO_FALLBACK_INTRINSIC.width);
    expect(audio.height).toBe(AUDIO_FALLBACK_INTRINSIC.height);
    const tiny = createAudioObject(
      "a4",
      {
        assetHash: HASH_A,
        thumbHash: null,
        originalName: "n.mp3",
        mimeType: "audio/mpeg",
        durationMs: 0,
      },
      vec2(0, 0),
      { width: 0, height: -5 },
    );
    expect(tiny.width).toBe(1);
    expect(tiny.height).toBe(1);
  });

  it("carries the optional kept-original hash", () => {
    const audio = createAudioObject(
      "a5",
      {
        assetHash: HASH_A,
        thumbHash: null,
        originalName: "n.wav",
        mimeType: "audio/mpeg",
        durationMs: 0,
        origAssetHash: HASH_B,
      },
      vec2(0, 0),
    );
    expect(audio.origAssetHash).toBe(HASH_B);
  });
});

describe("placedAudioSize", () => {
  it("clamps the longest edge to the span (the image rule)", () => {
    expect(placedAudioSize({ width: 480, height: 160 }, 240)).toEqual({
      width: 240,
      height: 80,
    });
    expect(placedAudioSize({ width: 480, height: 160 }, 960)).toEqual({
      width: 480,
      height: 160,
    });
  });
});

describe("collectAudioAssetHashes", () => {
  it("collects distinct current+thumb+orig hashes in order", () => {
    const first = createAudioObject(
      "a6",
      {
        assetHash: HASH_A,
        thumbHash: HASH_T,
        originalName: "x.mp3",
        mimeType: "audio/mpeg",
        durationMs: 0,
        origAssetHash: HASH_B,
      },
      vec2(0, 0),
    );
    const second = createAudioObject(
      "a7",
      {
        assetHash: HASH_A,
        thumbHash: null,
        originalName: "y.mp3",
        mimeType: "audio/mpeg",
        durationMs: 0,
      },
      vec2(0, 0),
    );
    expect(collectAudioAssetHashes([other, first, second])).toEqual([
      HASH_A,
      HASH_T,
      HASH_B,
    ]);
  });
});

describe("audioTimecodeLatin", () => {
  it("formats m:ss and h:mm:ss (the shared media core)", () => {
    expect(audioTimecodeLatin(0)).toBe("0:00");
    expect(audioTimecodeLatin(247_000)).toBe("4:07");
    expect(audioTimecodeLatin(3_723_000)).toBe("1:02:03");
  });
});
