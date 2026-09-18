/**
 * Unit tests for the core.video registry entry (فاز M1 — RM1.2):
 * registration shape (catalog metadata → the Insert Panel card),
 * serialize/deserialize round-trips, lenient optional fields and the
 * refusal of malformed payloads (opaque fallback — nothing is lost).
 */
import { describe, expect, it } from "vitest";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import { registerCoreObjectTypes } from "@/persistence/objectTypes";
import { isVideoObject, type VideoObjectData } from "@/core/model/VideoObject";
import { vec2 } from "@/core/geometry/Vec2";

const HASH = "1".repeat(64);
const THUMB = "2".repeat(64);

/** Builds a registered registry. */
function makeRegistry(): ObjectRegistry {
  return registerCoreObjectTypes(new ObjectRegistry(true));
}

/** Builds a valid video object. */
function sampleVideo(): VideoObjectData {
  return {
    id: "video-1",
    kind: "video",
    position: vec2(10, 20),
    rotation: 0.25,
    zIndex: 3,
    visible: true,
    locked: false,
    assetHash: HASH,
    thumbHash: THUMB,
    originalName: "clip.mp4",
    mimeType: "video/mp4",
    durationMs: 61_500,
    naturalWidth: 1920,
    naturalHeight: 1080,
    width: 480,
    height: 270,
  };
}

describe("core.video registration (فاز M1 — RM1.2 / ACM1.1)", () => {
  it("registers under the core.video wire id + video kind with catalog metadata", () => {
    const registry = makeRegistry();
    const entry = registry.entryForTypeId("core.video");
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe("video");
    expect(entry?.version).toBe(1);
    expect(entry?.titleKey).toBe("objectTypes.video");
    // The Insert-Panel card appears through the catalog metadata —
    // AFTER the image card (order 10 → 11), group "media" (A.2.6).
    expect(entry?.catalog).toEqual({
      titleKey: "objectTypes.video",
      group: "media",
      order: 11,
      icon: "Film",
    });
    expect(registry.entryForKind("video")?.id).toBe("core.video");
  });

  it("round-trips a full video object through serialize/deserialize", () => {
    const registry = makeRegistry();
    const entry = registry.entryForTypeId("core.video");
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    const wire = entry.serialize(sampleVideo());
    expect(wire.typeId).toBe("core.video");
    expect(wire.typeVersion).toBe(1);
    expect(wire.kind).toBeUndefined();
    const back = entry.deserialize(wire);
    expect(back).not.toBeNull();
    if (back !== null) {
      expect(isVideoObject(back)).toBe(true);
      expect(back).toEqual(sampleVideo());
    }
  });

  it("keeps the optional kept-original hash on the round-trip", () => {
    const registry = makeRegistry();
    const entry = registry.entryForTypeId("core.video");
    if (entry === undefined) {
      return;
    }
    const withOriginal = { ...sampleVideo(), origAssetHash: "3".repeat(64) };
    const back = entry.deserialize(entry.serialize(withOriginal));
    expect(back).not.toBeNull();
    if (back !== null && isVideoObject(back)) {
      expect(back.origAssetHash).toBe("3".repeat(64));
    }
  });

  it("degrades malformed optional hashes leniently (never refuses the object)", () => {
    const registry = makeRegistry();
    const entry = registry.entryForTypeId("core.video");
    if (entry === undefined) {
      return;
    }
    const wire = entry.serialize(sampleVideo()) as Record<string, unknown>;
    wire.thumbHash = "not-a-hash";
    wire.origAssetHash = 99;
    const back = entry.deserialize(wire);
    expect(back).not.toBeNull();
    if (back !== null && isVideoObject(back)) {
      expect(back.thumbHash).toBeNull();
      expect(back.origAssetHash).toBeUndefined();
    }
  });

  it("refuses malformed required fields (the opaque fallback keeps the raw JSON)", () => {
    const registry = makeRegistry();
    const entry = registry.entryForTypeId("core.video");
    if (entry === undefined) {
      return;
    }
    const cases: Record<string, unknown>[] = [
      { ...entry.serialize(sampleVideo()), assetHash: "short" },
      { ...entry.serialize(sampleVideo()), originalName: "" },
      { ...entry.serialize(sampleVideo()), durationMs: -1 },
      { ...entry.serialize(sampleVideo()), naturalWidth: 0 },
      { id: "x" },
    ];
    for (const wire of cases) {
      expect(entry.deserialize(wire)).toBeNull();
    }
  });

  it("factory produces a structurally valid default instance", () => {
    const registry = makeRegistry();
    const entry = registry.entryForTypeId("core.video");
    if (entry === undefined) {
      return;
    }
    const instance = entry.factory();
    expect(isVideoObject(instance)).toBe(true);
    const back = entry.deserialize(entry.serialize(instance));
    expect(back).not.toBeNull();
  });
});
