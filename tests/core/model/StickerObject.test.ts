/** Unit tests for the sticker model + the R11.1 style-patch seam. */
import { describe, expect, it } from "vitest";
import {
  isStickerObject,
  makeStickerObject,
  STICKER_DEFAULT_SIZE,
} from "@/core/model/StickerObject";
import { objectBBox, translateSceneObject } from "@/core/model/SceneObject";
import { planStylePatch, type StyleChanges } from "@/core/commands/StylePatches";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { StickerObjectData } from "@/core/model/StickerObject";
import { vec2 } from "@/core/geometry/Vec2";

describe("StickerObject model (R11.1)", () => {
  it("assembles a complete square sticker with the shared defaults", () => {
    const sticker = makeStickerObject("st-1", "⭐", vec2(40, 50));
    expect(sticker.kind).toBe("sticker");
    expect(sticker.emoji).toBe("⭐");
    expect(sticker.width).toBe(STICKER_DEFAULT_SIZE);
    expect(sticker.height).toBe(STICKER_DEFAULT_SIZE);
    expect(sticker.rotation).toBe(0);
    expect(sticker.visible).toBe(true);
    expect(sticker.locked).toBe(false);
  });

  it("the type guard narrows stickers and rejects other kinds", () => {
    const sticker = makeStickerObject("st-1", "🔥", vec2(0, 0));
    const shape: SceneObjectData = {
      id: "sh-1",
      kind: "shape",
      position: vec2(0, 0),
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      shapeKind: "rectangle",
      width: 10,
      height: 10,
      fill: "accent",
      stroke: "primary",
      strokeWidth: 2,
    } as SceneObjectData;
    expect(isStickerObject(sticker)).toBe(true);
    expect(isStickerObject(shape)).toBe(false);
  });

  it("shares the generic sized-object geometry (bbox + translate)", () => {
    const sticker = makeStickerObject("st-1", "🎯", vec2(100, 200), 120);
    const box = objectBBox(sticker);
    expect(box.minX).toBe(100);
    expect(box.minY).toBe(200);
    expect(box.maxX).toBe(220);
    expect(box.maxY).toBe(320);

    const moved = translateSceneObject(sticker, { x: 10, y: -5 });
    expect(moved.position).toEqual({ x: 110, y: 195 });
    expect(isStickerObject(moved)).toBe(true);
    expect((moved as StickerObjectData).emoji).toBe("🎯");
  });
});

describe("Sticker style patches (R11.1)", () => {
  it("plans an emoji patch through the inspector restyle path", () => {
    const sticker = makeStickerObject("st-1", "⭐", vec2(0, 0));
    const changes: StyleChanges = { emoji: "🚀" };
    const patch = planStylePatch(sticker, changes);
    expect(patch).toEqual({ emoji: "🚀" });
  });

  it("refuses same-emoji and empty-string patches (no-op, not corruption)", () => {
    const sticker = makeStickerObject("st-1", "⭐", vec2(0, 0));
    expect(planStylePatch(sticker, { emoji: "⭐" })).toBeNull();
    expect(planStylePatch(sticker, { emoji: "" })).toBeNull();
    expect(planStylePatch(sticker, {})).toBeNull();
  });

  it("sticker fields are isolated from the other kinds' patches", () => {
    const sticker = makeStickerObject("st-1", "⭐", vec2(0, 0));
    // A stroke-only restyle must NOT touch a sticker (it has no stroke).
    expect(planStylePatch(sticker, { strokeWidth: 4 })).toBeNull();
    expect(planStylePatch(sticker, { fill: "red" })).toBeNull();
  });
});
