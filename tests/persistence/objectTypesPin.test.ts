/**
 * Persistence round-trips for the pin-to-screen fields (فاز ۲۵): the
 * wire payload carries `pinned` + `pinAnchor`, deserialization restores
 * them exactly, and lenient degradation keeps old/odd files alive
 * (absent = unpinned; a wrong-typed anchor or flag drops the pin without
 * refusing the object).
 */
import { describe, expect, it } from "vitest";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import {
  registerCoreObjectTypes,
  CORE_TYPE_IDS,
} from "@/persistence/objectTypes";
import { vec2 } from "@/core/geometry/Vec2";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import {
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN,
} from "@/core/model/ShapeObject";

/** A registry with the core types registered. */
function registry(): ObjectRegistry {
  return registerCoreObjectTypes(new ObjectRegistry());
}

/** Builds an in-memory pinned shape. */
function pinnedShape(): ShapeObjectData {
  return {
    id: "obj-pin",
    kind: "shape",
    name: undefined,
    parentId: undefined,
    position: vec2(12, 34),
    rotation: 0,
    zIndex: 1,
    visible: true,
    locked: false,
    pinned: true,
    pinAnchor: vec2(0.25, 0.75),
    shapeKind: "rectangle",
    width: 100,
    height: 60,
    fill: SHAPE_FILL_TOKEN,
    stroke: STROKE_COLOR_TOKEN,
    strokeWidth: 1,
  };
}

describe("pin fields — wire round-trip", () => {
  it("serializes and deserializes pinned + pinAnchor exactly", () => {
    const entry = registry().get(CORE_TYPE_IDS.shape);
    expect(entry).not.toBeNull();
    const wire = entry?.serialize(pinnedShape());
    expect(wire).toMatchObject({ pinned: true });
    expect(wire?.pinAnchor).toEqual({ x: 0.25, y: 0.75 });

    const back = entry?.deserialize(
      wire as Record<string, unknown>,
    ) as ShapeObjectData;
    expect(back.pinned).toBe(true);
    expect(back.pinAnchor).toEqual(vec2(0.25, 0.75));
  });

  it("an absent pin loads as unpinned (pre-Phase-25 files)", () => {
    const entry = registry().get(CORE_TYPE_IDS.shape);
    const object = pinnedShape();
    const wire = entry?.serialize(object) as Record<string, unknown>;
    delete wire.pinned;
    delete wire.pinAnchor;

    const back = entry?.deserialize(wire) as ShapeObjectData;
    expect(back.pinned).toBeUndefined();
    expect(back.pinAnchor).toBeUndefined();
  });

  it("a wrong-typed anchor drops the pin but keeps the object", () => {
    const entry = registry().get(CORE_TYPE_IDS.shape);
    const wire = entry?.serialize(pinnedShape()) as Record<string, unknown>;
    wire.pinAnchor = "top-right";

    const back = entry?.deserialize(wire) as ShapeObjectData;
    expect(back).not.toBeNull();
    expect(back.pinned).toBeUndefined();
    expect(back.pinAnchor).toBeUndefined();
  });

  it("a wrong-typed flag drops the pin but keeps the object", () => {
    const entry = registry().get(CORE_TYPE_IDS.shape);
    const wire = entry?.serialize(pinnedShape()) as Record<string, unknown>;
    wire.pinned = "yes";

    const back = entry?.deserialize(wire) as ShapeObjectData;
    expect(back).not.toBeNull();
    expect(back.pinned).toBeUndefined();
  });

  it("an unpinned object serializes without the pin keys", () => {
    const entry = registry().get(CORE_TYPE_IDS.shape);
    const wire = entry?.serialize({
      ...pinnedShape(),
      pinned: undefined,
      pinAnchor: undefined,
    }) as Record<string, unknown>;
    expect("pinned" in wire).toBe(true); // undefined round-trips as absent
    expect(wire.pinned).toBeUndefined();
  });
});
