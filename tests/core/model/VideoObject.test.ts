/**
 * Unit tests for the VideoObject model (فاز M1 — RM1.2): the factory
 * contract (placed size, metadata passthrough, fallback intrinsic),
 * the shared placement-size rule (A.2.10 — the image rule), the scene
 * hash manifest for relocations and the timecode formatter.
 */
import { describe, expect, it } from "vitest";
import {
  VIDEO_FALLBACK_INTRINSIC,
  collectVideoAssetHashes,
  createVideoObject,
  isVideoObject,
  placedVideoSize,
  videoTimecodeLatin,
} from "@/core/model/VideoObject";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { vec2 } from "@/core/geometry/Vec2";

const HASH = "4".repeat(64);
const THUMB = "5".repeat(64);
const ORIGINAL = "6".repeat(64);

describe("createVideoObject (فاز M1 — RM1.2)", () => {
  it("stores the hashes + metadata with the placed size", () => {
    const video = createVideoObject(
      "v1",
      {
        assetHash: HASH,
        thumbHash: THUMB,
        originalName: "clip.mp4",
        mimeType: "video/mp4",
        durationMs: 42_000,
        naturalWidth: 1280,
        naturalHeight: 720,
      },
      vec2(5, 6),
      { width: 320, height: 180 },
      7,
    );
    expect(isVideoObject(video)).toBe(true);
    expect(video.assetHash).toBe(HASH);
    expect(video.thumbHash).toBe(THUMB);
    expect(video.originalName).toBe("clip.mp4");
    expect(video.durationMs).toBe(42_000);
    expect(video.naturalWidth).toBe(1280);
    expect(video.naturalHeight).toBe(720);
    expect(video.width).toBe(320);
    expect(video.height).toBe(180);
    expect(video.position).toEqual(vec2(5, 6));
    expect(video.zIndex).toBe(7);
    expect(video.origAssetHash).toBeUndefined();
  });

  it("defaults the placed size to the intrinsic size", () => {
    const video = createVideoObject(
      "v2",
      {
        assetHash: HASH,
        thumbHash: null,
        originalName: "a.webm",
        mimeType: "video/webm",
        durationMs: 0,
        naturalWidth: 640,
        naturalHeight: 360,
      },
      vec2(0, 0),
    );
    expect(video.width).toBe(640);
    expect(video.height).toBe(360);
    expect(video.thumbHash).toBeNull();
  });

  it("falls back to the default intrinsic size when metadata failed (A.2.2)", () => {
    const video = createVideoObject(
      "v3",
      {
        assetHash: HASH,
        thumbHash: null,
        originalName: "broken.avi",
        mimeType: "video/mp4",
        durationMs: 0,
        naturalWidth: 0,
        naturalHeight: 0,
      },
      vec2(0, 0),
    );
    expect(video.naturalWidth).toBe(VIDEO_FALLBACK_INTRINSIC.width);
    expect(video.naturalHeight).toBe(VIDEO_FALLBACK_INTRINSIC.height);
    expect(video.width).toBe(VIDEO_FALLBACK_INTRINSIC.width);
  });

  it("keeps the kept-original hash when a conversion replaced it (M2)", () => {
    const video = createVideoObject(
      "v4",
      {
        assetHash: HASH,
        thumbHash: THUMB,
        originalName: "old.mkv",
        mimeType: "video/mp4",
        durationMs: 1,
        naturalWidth: 2,
        naturalHeight: 3,
        origAssetHash: ORIGINAL,
      },
      vec2(0, 0),
    );
    expect(video.origAssetHash).toBe(ORIGINAL);
  });
});

describe("placedVideoSize (A.2.10 — the EXACT image rule)", () => {
  it("clamps the longest edge to the span, aspect preserved", () => {
    expect(placedVideoSize({ width: 1920, height: 1080 }, 480)).toEqual({
      width: 480,
      height: 270,
    });
    expect(placedVideoSize({ width: 100, height: 50 }, 480)).toEqual({
      width: 100,
      height: 50,
    });
  });
});

describe("collectVideoAssetHashes (فاز M1 — the relocation manifest)", () => {
  it("collects asset + thumb + original hashes, distinct and ordered", () => {
    const video = createVideoObject(
      "v",
      {
        assetHash: HASH,
        thumbHash: THUMB,
        originalName: "x.mp4",
        mimeType: "video/mp4",
        durationMs: 0,
        naturalWidth: 10,
        naturalHeight: 10,
        origAssetHash: ORIGINAL,
      },
      vec2(0, 0),
    );
    const dup = { ...video, id: "v2" };
    const other = { kind: "shape", id: "s" } as unknown as SceneObjectData;
    expect(collectVideoAssetHashes([other, video, dup])).toEqual([
      HASH,
      THUMB,
      ORIGINAL,
    ]);
  });

  it("skips null thumb hashes", () => {
    const video = createVideoObject(
      "v",
      {
        assetHash: HASH,
        thumbHash: null,
        originalName: "x.mp4",
        mimeType: "video/mp4",
        durationMs: 0,
        naturalWidth: 10,
        naturalHeight: 10,
      },
      vec2(0, 0),
    );
    expect(collectVideoAssetHashes([video])).toEqual([HASH]);
  });
});

describe("videoTimecodeLatin (فاز M1 — the badge core)", () => {
  it("formats m:ss under an hour and h:mm:ss above", () => {
    expect(videoTimecodeLatin(0)).toBe("0:00");
    expect(videoTimecodeLatin(4_700)).toBe("0:04");
    expect(videoTimecodeLatin(247_000)).toBe("4:07");
    expect(videoTimecodeLatin(3_723_000)).toBe("1:02:03");
  });

  it("clamps negative durations", () => {
    expect(videoTimecodeLatin(-5_000)).toBe("0:00");
  });
});
