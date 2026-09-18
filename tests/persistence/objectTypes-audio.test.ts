/**
 * objectTypes-audio unit tests (فاز A1 — ACA1.1/§1.7.1): the audio
 * registry entry — factory shape, catalog metadata (media group, order
 * AFTER video), wire round-trip, lenient optional fields and malformed
 * refusals (opaque fallback, nothing lost).
 */
import { describe, expect, it } from "vitest";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import {
  CORE_TYPE_IDS,
  registerCoreObjectTypes,
} from "@/persistence/objectTypes";
import { isAudioObject, type AudioObjectData } from "@/core/model/AudioObject";

/** A registry with the core types registered. */
function registry(): ObjectRegistry {
  return registerCoreObjectTypes(new ObjectRegistry());
}

/** The audio entry of a fresh registry. */
function audioEntry() {
  const entry = registry().entryForTypeId(CORE_TYPE_IDS.audio);
  expect(entry).toBeDefined();
  return entry!;
}

const HASH = "a".repeat(64);
const THUMB = "b".repeat(64);
const ORIG = "c".repeat(64);

/** A well-formed audio wire payload. */
function audioWire(): Record<string, unknown> {
  return {
    id: "au1",
    position: { x: 10, y: 20 },
    rotation: 0,
    zIndex: 4,
    visible: true,
    locked: false,
    assetHash: HASH,
    thumbHash: THUMB,
    originalName: "clip.mp3",
    mimeType: "audio/mpeg",
    durationMs: 5000,
    width: 315,
    height: 105,
  };
}

describe("audio registry entry (فاز A1)", () => {
  it("registers under core.audio with kind audio + catalog metadata", () => {
    const entry = audioEntry();
    expect(entry.id).toBe("core.audio");
    expect(entry.kind).toBe("audio");
    expect(entry.version).toBe(1);
    expect(entry.titleKey).toBe("objectTypes.audio");
    expect(entry.catalog).toEqual({
      titleKey: "objectTypes.audio",
      group: "media",
      order: 12,
      icon: "Music",
    });
    // The card order sits AFTER the video card (A.2.6).
    const video = registry().entryForTypeId(CORE_TYPE_IDS.video)!;
    expect(video.catalog?.order).toBe(11);
    expect(entry.catalog!.order).toBeGreaterThan(video.catalog!.order);
  });

  it("factory builds a structurally-valid placeholder", () => {
    const object = audioEntry().factory() as AudioObjectData;
    expect(isAudioObject(object)).toBe(true);
    expect(object.assetHash).toBe("0".repeat(64));
    expect(object.thumbHash).toBeNull();
    expect(object.durationMs).toBe(0);
    expect(object.width).toBeGreaterThan(0);
    expect(object.height).toBeGreaterThan(0);
  });

  it("round-trips a full payload through serialize/deserialize", () => {
    const entry = audioEntry();
    const wire = entry.serialize({
      ...(audioEntry().factory() as AudioObjectData),
      id: "au9",
      position: { x: 1, y: 2 } as never,
      assetHash: HASH,
      thumbHash: THUMB,
      originalName: "song.flac",
      mimeType: "audio/flac",
      durationMs: 61_500,
      width: 480,
      height: 160,
      origAssetHash: ORIG,
    } as AudioObjectData);
    expect(wire.typeId).toBe("core.audio");
    const restored = entry.deserialize(wire);
    expect(restored).not.toBeNull();
    expect(isAudioObject(restored!)).toBe(true);
    if (isAudioObject(restored!)) {
      expect(restored.assetHash).toBe(HASH);
      expect(restored.thumbHash).toBe(THUMB);
      expect(restored.originalName).toBe("song.flac");
      expect(restored.mimeType).toBe("audio/flac");
      expect(restored.durationMs).toBe(61_500);
      expect(restored.width).toBe(480);
      expect(restored.height).toBe(160);
      expect(restored.origAssetHash).toBe(ORIG);
    }
  });

  it("lenient optional fields: absent thumbHash/origAssetHash degrade", () => {
    const entry = audioEntry();
    const wire = audioWire();
    delete wire.thumbHash;
    const restored = entry.deserialize(wire);
    expect(restored).not.toBeNull();
    expect(isAudioObject(restored!)).toBe(true);
    if (isAudioObject(restored!)) {
      expect(restored.thumbHash).toBeNull();
      expect(restored.origAssetHash).toBeUndefined();
    }
  });

  it("malformed payloads refuse to null (the opaque fallback owns them)", () => {
    const entry = audioEntry();
    expect(entry.deserialize({ ...audioWire(), assetHash: "xyz" })).toBeNull();
    expect(entry.deserialize({ ...audioWire(), originalName: "" })).toBeNull();
    expect(entry.deserialize({ ...audioWire(), mimeType: "" })).toBeNull();
    expect(entry.deserialize({ ...audioWire(), durationMs: -1 })).toBeNull();
    expect(entry.deserialize({ ...audioWire(), width: -5 })).toBeNull();
    expect(entry.deserialize({ id: "x" })).toBeNull();
  });
});
