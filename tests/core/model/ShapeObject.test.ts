/** Unit tests for the primitive shape object contract. */
import { describe, expect, it } from "vitest";
import {
  SHAPE_FILL_TOKEN,
  SHAPE_KINDS,
  STROKE_COLOR_TOKEN,
  defaultShapeRect,
  isShapeObject,
  normalizedRectFromDrag,
  shapeFromRect,
} from "@/core/model/ShapeObject";
import { STROKE_COLOR_TOKEN as FREEHAND_STROKE_TOKEN } from "@/core/model/FreehandObject";
import { objectBBox, translateSceneObject } from "@/core/model/SceneObject";
import { bbox } from "@/core/geometry/BBox";
import { vec2 } from "@/core/geometry/Vec2";
import type { FreehandObjectData } from "@/core/model/FreehandObject";
import type {
  SceneObjectData,
  SceneObjectKind,
} from "@/core/model/SceneObject";
import type {
  ShapeKind,
  ShapeObjectData,
  ShapeStyle,
} from "@/core/model/ShapeObject";

/** Style fixture using the theme tokens (the creation-time default). */
const TOKEN_STYLE: ShapeStyle = {
  fill: SHAPE_FILL_TOKEN,
  stroke: STROKE_COLOR_TOKEN,
  strokeWidth: 2,
};

/** Builds a fully populated shape fixture (all base + kind-specific fields). */
function makeShape(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  shapeKind: ShapeKind = "rectangle",
): ShapeObjectData {
  return {
    id,
    kind: "shape",
    name: "Shape",
    parentId: "group-1",
    position: vec2(x, y),
    rotation: 0,
    zIndex: 3,
    visible: true,
    locked: false,
    shapeKind,
    width,
    height,
    fill: SHAPE_FILL_TOKEN,
    stroke: STROKE_COLOR_TOKEN,
    strokeWidth: 2,
  };
}

/** Builds a minimal fixture of a non-shape kind. */
function makeObjectOfKind(
  kind: SceneObjectKind,
  x: number,
  y: number,
): SceneObjectData {
  return {
    id: `obj-${kind}`,
    kind,
    position: vec2(x, y),
    rotation: 0,
    zIndex: 1,
    visible: true,
    locked: false,
  };
}

/** Builds a minimal freehand stroke fixture. */
function makeStroke(id: string): FreehandObjectData {
  return {
    id,
    kind: "freehand",
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 2,
    visible: true,
    locked: false,
    points: [vec2(0, 0), vec2(5, 5)],
    strokeColor: "#0ea5e9",
    strokeWidth: 2,
    strokeStyle: "solid",
  };
}

describe("ShapeObject constants", () => {
  it("lists the six primitive kinds in picker order without duplicates", () => {
    expect(SHAPE_KINDS).toEqual([
      "rectangle",
      "roundedRectangle",
      "ellipse",
      "triangle",
      "diamond",
      "star",
    ]);
    expect(new Set(SHAPE_KINDS).size).toBe(SHAPE_KINDS.length);
  });

  it("defines the fill token and re-exports the freehand stroke token", () => {
    expect(SHAPE_FILL_TOKEN).toBe("accent");
    expect(STROKE_COLOR_TOKEN).toBe("primary");
    expect(STROKE_COLOR_TOKEN).toBe(FREEHAND_STROKE_TOKEN);
  });
});

describe("isShapeObject", () => {
  it("recognises shape objects", () => {
    expect(isShapeObject(makeShape("shape-1", 0, 0, 30, 20))).toBe(true);
  });

  it("rejects every other object kind", () => {
    const otherKinds: SceneObjectKind[] = [
      "textBox",
      "stickyNote",
      "image",
      "connector",
      "freehand",
      "group",
    ];
    for (const kind of otherKinds) {
      expect(isShapeObject(makeObjectOfKind(kind, 1, 2))).toBe(false);
    }
  });

  it("narrows a mixed object list to its shape entries", () => {
    const objects: SceneObjectData[] = [
      makeObjectOfKind("group", 0, 0),
      makeShape("shape-1", 10, 20, 5, 5),
      makeStroke("stroke-1"),
    ];
    const shapes = objects.filter(isShapeObject);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.id).toBe("shape-1");
    expect(shapes[0]?.shapeKind).toBe("rectangle");
  });
});

describe("normalizedRectFromDrag", () => {
  it("normalises a right-down drag to the anchor corner with positive size", () => {
    expect(normalizedRectFromDrag(vec2(10, 20), vec2(40, 50), false)).toEqual({
      position: vec2(10, 20),
      width: 30,
      height: 30,
    });
  });

  it("normalises a left-up drag to the current corner", () => {
    expect(normalizedRectFromDrag(vec2(40, 30), vec2(10, 5), false)).toEqual({
      position: vec2(10, 5),
      width: 30,
      height: 25,
    });
  });

  it("normalises mixed-direction drags (right-up and left-down)", () => {
    expect(normalizedRectFromDrag(vec2(0, 0), vec2(30, -10), false)).toEqual({
      position: vec2(0, -10),
      width: 30,
      height: 10,
    });
    expect(normalizedRectFromDrag(vec2(0, 0), vec2(-30, 25), false)).toEqual({
      position: vec2(-30, 0),
      width: 30,
      height: 25,
    });
  });

  it("degenerates to a zero-size rect at the anchor for a zero delta", () => {
    expect(normalizedRectFromDrag(vec2(7, 9), vec2(7, 9), false)).toEqual({
      position: vec2(7, 9),
      width: 0,
      height: 0,
    });
  });

  it("constrains to the larger delta as a square keeping the drag signs (right-up)", () => {
    expect(normalizedRectFromDrag(vec2(0, 0), vec2(30, -10), true)).toEqual({
      position: vec2(0, -30),
      width: 30,
      height: 30,
    });
  });

  it("constrains a left-down drag to a square anchored at the start point", () => {
    // x drags left (-), y drags down (+): the square spans [-20, 0] x [0, 20].
    expect(normalizedRectFromDrag(vec2(0, 0), vec2(-20, 5), true)).toEqual({
      position: vec2(-20, 0),
      width: 20,
      height: 20,
    });
  });

  it("constrains a left-up drag whose vertical delta dominates", () => {
    expect(normalizedRectFromDrag(vec2(10, 10), vec2(0, -5), true)).toEqual({
      position: vec2(-5, -5),
      width: 15,
      height: 15,
    });
  });

  it("grows a purely vertical square-constrained drag to the right (sign 0 → positive)", () => {
    expect(normalizedRectFromDrag(vec2(0, 0), vec2(0, 25), true)).toEqual({
      position: vec2(0, 0),
      width: 25,
      height: 25,
    });
  });

  it("grows a purely horizontal square-constrained drag downward (sign 0 → positive)", () => {
    expect(normalizedRectFromDrag(vec2(5, 8), vec2(30, 8), true)).toEqual({
      position: vec2(5, 8),
      width: 25,
      height: 25,
    });
  });

  it("degenerates to a zero-size square at the anchor for a zero delta", () => {
    expect(normalizedRectFromDrag(vec2(7, 9), vec2(7, 9), true)).toEqual({
      position: vec2(7, 9),
      width: 0,
      height: 0,
    });
  });
});

describe("defaultShapeRect", () => {
  it("centres a square of the given size on the tap point", () => {
    expect(defaultShapeRect(vec2(50, 60), 96)).toEqual({
      position: vec2(2, 12),
      width: 96,
      height: 96,
    });
  });

  it("works for negative centre coordinates", () => {
    expect(defaultShapeRect(vec2(-10, -20), 40)).toEqual({
      position: vec2(-30, -40),
      width: 40,
      height: 40,
    });
  });

  it("keeps the tap point at the rect centre for odd sizes", () => {
    const rect = defaultShapeRect(vec2(0, 0), 33);
    expect(rect.position).toEqual(vec2(-16.5, -16.5));
    expect(rect.width).toBe(33);
    expect(rect.height).toBe(33);
  });
});

describe("shapeFromRect", () => {
  it("assembles a complete shape object from a placement rect and token style", () => {
    const rect = defaultShapeRect(vec2(100, 120), 96);
    const shape = shapeFromRect(rect, "ellipse", TOKEN_STYLE, "shape-1", 7);
    expect(shape).toEqual({
      id: "shape-1",
      kind: "shape",
      name: undefined,
      parentId: undefined,
      position: vec2(52, 72),
      rotation: 0,
      zIndex: 7,
      visible: true,
      locked: false,
      shapeKind: "ellipse",
      width: 96,
      height: 96,
      fill: SHAPE_FILL_TOKEN,
      stroke: STROKE_COLOR_TOKEN,
      strokeWidth: 2,
    });
  });

  it("passes literal colours and drag-rect geometry through unchanged", () => {
    const literalStyle: ShapeStyle = {
      fill: "#0ea5e9",
      stroke: "#f59e0b",
      strokeWidth: 5,
    };
    const rect = normalizedRectFromDrag(vec2(0, 0), vec2(30, -10), false);
    const shape = shapeFromRect(rect, "triangle", literalStyle, "shape-2", 0);
    expect(shape.position).toEqual(vec2(0, -10));
    expect(shape.width).toBe(30);
    expect(shape.height).toBe(10);
    expect(shape.shapeKind).toBe("triangle");
    expect(shape.fill).toBe("#0ea5e9");
    expect(shape.stroke).toBe("#f59e0b");
    expect(shape.strokeWidth).toBe(5);
  });

  it("round-trips every shape kind from the picker list", () => {
    const rect = defaultShapeRect(vec2(0, 0), 10);
    for (const kind of SHAPE_KINDS) {
      const shape = shapeFromRect(rect, kind, TOKEN_STYLE, `shape-${kind}`, 1);
      expect(shape.shapeKind).toBe(kind);
    }
  });
});

describe("objectBBox (shape fixtures)", () => {
  it("bounds a shape from position plus size, padded by half the stroke width", () => {
    // strokeWidth 2 → pad 1 (mirrors the freehand padding rule).
    expect(objectBBox(makeShape("shape-1", 10, 20, 100, 50))).toEqual(
      bbox(9, 19, 111, 71),
    );
    expect(objectBBox(makeShape("shape-2", -15, -25, 40, 10))).toEqual(
      bbox(-16, -26, 26, -14),
    );
  });

  it("pads a zero-size shape symmetrically around the position", () => {
    expect(objectBBox(makeShape("shape-1", 3, 4, 0, 0))).toEqual(
      bbox(2, 3, 4, 5),
    );
  });

  it("grows the bounds with the stroke width (thick outlines stay inside)", () => {
    const shape = makeShape("shape-1", 10, 20, 100, 50, "star");
    const widened: ShapeObjectData = { ...shape, strokeWidth: 6 };
    expect(objectBBox(widened)).toEqual(bbox(7, 17, 113, 73));
  });
});

describe("translateSceneObject (shape fixtures)", () => {
  it("moves the position only and preserves geometry, style and metadata", () => {
    const shape = makeShape("shape-1", 10, 20, 100, 50, "diamond");
    const moved = translateSceneObject(shape, vec2(3, -2));
    expect(moved).not.toBe(shape);
    expect(moved.position).toEqual(vec2(13, 18));
    if (!isShapeObject(moved)) {
      throw new Error("expected a shape object");
    }
    expect(moved.id).toBe("shape-1");
    expect(moved.kind).toBe("shape");
    expect(moved.name).toBe("Shape");
    expect(moved.parentId).toBe("group-1");
    expect(moved.rotation).toBe(0);
    expect(moved.zIndex).toBe(3);
    expect(moved.visible).toBe(true);
    expect(moved.locked).toBe(false);
    expect(moved.shapeKind).toBe("diamond");
    expect(moved.width).toBe(100);
    expect(moved.height).toBe(50);
    expect(moved.fill).toBe(SHAPE_FILL_TOKEN);
    expect(moved.stroke).toBe(STROKE_COLOR_TOKEN);
    expect(moved.strokeWidth).toBe(2);
  });

  it("leaves the source shape untouched (immutable update)", () => {
    const shape = makeShape("shape-1", 10, 20, 100, 50);
    translateSceneObject(shape, vec2(50, 50));
    expect(shape.position).toEqual(vec2(10, 20));
    expect(shape.width).toBe(100);
    expect(shape.height).toBe(50);
  });

  it("returns a fresh equal copy for a zero delta", () => {
    const shape = makeShape("shape-1", 5, 7, 30, 20);
    const moved = translateSceneObject(shape, vec2(0, 0));
    expect(moved).not.toBe(shape);
    expect(moved).toEqual(shape);
  });
});
