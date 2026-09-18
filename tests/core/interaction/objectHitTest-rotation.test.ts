/**
 * Unit tests for rotation-aware hit-testing (AC2.8: hitTest with rotation).
 */
import { describe, expect, it } from "vitest";
import { Scene } from "@/core/model/Scene";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import { shapeFromRect } from "@/core/model/ShapeObject";
import { hitTestTopMost } from "@/interaction/objectHitTest";
import { rotatedObjectBBox } from "@/core/model/SceneObject";
import { vec2 } from "@/core/geometry/Vec2";

/** Style bundle shared by every shape fixture. */
const STYLE = { fill: "accent", stroke: "token://stroke", strokeWidth: 2 };

/** Builds a 100×100 rectangle at the origin with the given rotation. */
function makeRotated(id: string, rotation: number): ShapeObjectData {
  return {
    ...shapeFromRect(
      { position: vec2(0, 0), width: 100, height: 100 },
      "rectangle",
      STYLE,
      id,
      0,
    ),
    rotation,
  };
}

describe("hitTestTopMost with rotation", () => {
  it("hits inside the tilted rectangle", () => {
    const scene = new Scene();
    // 45°: the square becomes a diamond centred at (50,50).
    scene.add(makeRotated("diamond", Math.PI / 4));
    expect(hitTestTopMost(scene, vec2(50, 50), 0.1)?.id).toBe("diamond");
    // Near the diamond's top vertex.
    expect(hitTestTopMost(scene, vec2(50, 20), 0.1)?.id).toBe("diamond");
  });

  it("misses points inside the AABB but outside the tilted shape", () => {
    const scene = new Scene();
    scene.add(makeRotated("diamond", Math.PI / 4));
    // The AABB of the 45° square is [−20.7, 120.7]²; its corners are empty.
    expect(hitTestTopMost(scene, vec2(0, 0), 0.1)).toBeNull();
    expect(hitTestTopMost(scene, vec2(100, 100), 0.1)).toBeNull();
    expect(hitTestTopMost(scene, vec2(0, 100), 0.1)).toBeNull();
  });

  it("hits points the AABB would miss but the tilted shape covers", () => {
    const scene = new Scene();
    scene.add(makeRotated("diamond", Math.PI / 4));
    // The AABB top edge is y ≈ −20.7; the diamond covers (50, 10) but a
    // ZERO-rotation square would not (y < 0 is outside [0,100]).
    expect(hitTestTopMost(scene, vec2(50, 10), 0.1)?.id).toBe("diamond");
  });

  it("skips rotated locked objects", () => {
    const scene = new Scene();
    scene.add({ ...makeRotated("locked", Math.PI / 4), locked: true });
    expect(hitTestTopMost(scene, vec2(50, 50), 0.1)).toBeNull();
  });

  it("prefers the top-most of stacked rotated objects", () => {
    const scene = new Scene();
    scene.add(makeRotated("bottom", Math.PI / 4));
    scene.add(makeRotated("top", Math.PI / 4));
    expect(hitTestTopMost(scene, vec2(50, 50), 0.1)?.id).toBe("top");
  });

  it("a 90° rotation swaps the hit axes", () => {
    const scene = new Scene();
    // A 200×20 strip rotated 90° covers a 20×200 vertical strip.
    const strip = {
      ...shapeFromRect(
        { position: vec2(0, 0), width: 200, height: 20 },
        "rectangle",
        STYLE,
        "s",
        0,
      ),
      rotation: Math.PI / 2,
    };
    scene.add(strip);
    // The strip's centre (100,10) is the rotation pivot.
    expect(hitTestTopMost(scene, vec2(100, 10), 0.1)?.id).toBe("s");
    // Far along the rotated long axis: still inside; along the short axis:
    // outside.
    expect(hitTestTopMost(scene, vec2(100, 90), 0.1)?.id).toBe("s");
    expect(hitTestTopMost(scene, vec2(120, 10), 0.1)).toBeNull();
  });

  it("rotatedObjectBBox covers the tilted corners", () => {
    expect(rotatedObjectBBox(makeRotated("d", 0))).toEqual({
      minX: -1,
      minY: -1,
      maxX: 101,
      maxY: 101,
    });
    const rotated = rotatedObjectBBox(makeRotated("d", Math.PI / 2));
    // A square rotated 90° has the same covering box (up to float noise).
    expect(rotated.minX).toBeCloseTo(-1, 9);
    expect(rotated.minY).toBeCloseTo(-1, 9);
    expect(rotated.maxX).toBeCloseTo(101, 9);
    expect(rotated.maxY).toBeCloseTo(101, 9);
    const tilted = rotatedObjectBBox(makeRotated("d", Math.PI / 4));
    // The padded box is 102 wide (half 51); rotated 45° the covering
    // half-extent is 51·√2, centred on (50, 50).
    expect(tilted.minX).toBeCloseTo(50 - 51 * Math.SQRT2, 6);
    expect(tilted.maxX).toBeCloseTo(50 + 51 * Math.SQRT2, 6);
  });
});
