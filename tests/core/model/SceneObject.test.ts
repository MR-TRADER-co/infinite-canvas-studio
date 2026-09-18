/** Unit tests for the kind-aware scene-object geometry helpers. */
import { describe, expect, it } from "vitest";
import {
  objectBBox,
  resizeSceneObject,
  translateSceneObject,
} from "@/core/model/SceneObject";
import { isFreehandObject } from "@/core/model/FreehandObject";
import {
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN,
  isShapeObject,
} from "@/core/model/ShapeObject";
import { bbox } from "@/core/geometry/BBox";
import { vec2 } from "@/core/geometry/Vec2";
import type { Vec2 } from "@/core/geometry/Vec2";
import type { FreehandObjectData } from "@/core/model/FreehandObject";
import type { ImageObjectData } from "@/core/model/ImageObject";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import type {
  SceneObjectData,
  SceneObjectKind,
} from "@/core/model/SceneObject";

/** Builds a minimal sized text-box fixture. */
function makeTextBox(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): TextBoxObjectData {
  return {
    id,
    kind: "textBox",
    name: "Box",
    parentId: "group-1",
    position: vec2(x, y),
    rotation: 0,
    zIndex: 3,
    visible: true,
    locked: false,
    text: "doc-1 text",
    doc: null,
    sizeMode: "auto",
    fontSize: 20,
    color: "token://text",
    width,
    height,
  };
}

/** Builds a freehand stroke fixture with an explicit position. */
function makeStroke(
  id: string,
  position: Vec2,
  points: readonly Vec2[],
  strokeWidth: number,
): FreehandObjectData {
  return {
    id,
    kind: "freehand",
    position,
    rotation: 0,
    zIndex: 2,
    visible: true,
    locked: false,
    points,
    strokeColor: "#0ea5e9",
    strokeWidth,
    strokeStyle: "solid",
  };
}

/** Builds an image fixture carrying explicit placement width/height. */
function makeSizedImage(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): ImageObjectData & { readonly width: number; readonly height: number } {
  return {
    id,
    kind: "image",
    position: vec2(x, y),
    rotation: 0,
    zIndex: 4,
    visible: true,
    locked: false,
    src: "data:image/png;base64,fixturesnapshot",
    naturalWidth: 800,
    naturalHeight: 600,
    width,
    height,
  };
}

/** Builds a minimal fixture of an unsized kind at the given position. */
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

/** Narrows a scene object to its text-box variant (test-side guard). */
function isTextBox(object: SceneObjectData): object is TextBoxObjectData {
  return object.kind === "textBox";
}

/** Builds a fully populated shape fixture (all base + kind-specific fields). */
function makeSizedShape(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  strokeWidth: number,
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
    shapeKind: "rectangle",
    width,
    height,
    fill: SHAPE_FILL_TOKEN,
    stroke: STROKE_COLOR_TOKEN,
    strokeWidth,
  };
}

/** Builds a sized fixture of a non-shape, non-freehand kind. */
function makeSizedNote(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): SceneObjectData & { readonly width: number; readonly height: number } {
  return {
    id,
    kind: "stickyNote",
    name: "Note",
    parentId: "group-1",
    position: vec2(x, y),
    rotation: 0,
    zIndex: 5,
    visible: true,
    locked: false,
    width,
    height,
  };
}

/** Narrows a scene object to its sized variant (test-side guard). */
function isSized(object: SceneObjectData): object is SceneObjectData & {
  readonly width: number;
  readonly height: number;
} {
  return "width" in object && "height" in object;
}

describe("objectBBox", () => {
  it("bounds a multi-point freehand stroke padded by half the stroke width", () => {
    const stroke = makeStroke(
      "stroke-1",
      vec2(5, 10),
      [vec2(20, 30), vec2(5, 10), vec2(12, 18)],
      4,
    );
    expect(objectBBox(stroke)).toEqual(bbox(3, 8, 22, 32));
  });

  it("bounds a single-point stroke symmetrically around the point", () => {
    const stroke = makeStroke("stroke-2", vec2(7, 9), [vec2(7, 9)], 2);
    expect(objectBBox(stroke)).toEqual(bbox(6, 8, 8, 10));
  });

  it("falls back to the padded position box for a stroke without points", () => {
    const stroke = makeStroke("stroke-3", vec2(10, 20), [], 4);
    expect(objectBBox(stroke)).toEqual(bbox(8, 18, 12, 22));
  });

  it("bounds sized objects from position plus width and height", () => {
    const textBox = makeTextBox("box-1", 10, 20, 100, 50);
    expect(objectBBox(textBox)).toEqual(bbox(10, 20, 110, 70));
  });

  it("bounds image objects that carry placement width and height", () => {
    const image = makeSizedImage("img-1", 5, 5, 30, 20);
    expect(objectBBox(image)).toEqual(bbox(5, 5, 35, 25));
  });

  it("degenerates to the position box for unsized kinds", () => {
    // Connector no longer degenerates: it bounds its endpoint caches
    // (see the connector-specific bbox tests in ConnectorObject.test).
    const kinds: SceneObjectKind[] = ["shape", "stickyNote", "group"];
    for (const kind of kinds) {
      expect(objectBBox(makeObjectOfKind(kind, 3, 4))).toEqual(
        bbox(3, 4, 3, 4),
      );
    }
  });

  it("degenerates to the position box when width or height is negative", () => {
    const negativeWidth = makeTextBox("box-1", 0, 0, -10, 50);
    expect(objectBBox(negativeWidth)).toEqual(bbox(0, 0, 0, 0));
    const negativeHeight = makeTextBox("box-2", 0, 0, 40, -5);
    expect(objectBBox(negativeHeight)).toEqual(bbox(0, 0, 0, 0));
  });

  it("ignores objects with missing or non-numeric size fields", () => {
    // SceneObjectData is a broad interface; the size guard must stay robust.
    const widthOnly: SceneObjectData & { readonly width: number } = {
      ...makeObjectOfKind("shape", 2, 3),
      width: 40,
    };
    expect(objectBBox(widthOnly)).toEqual(bbox(2, 3, 2, 3));
    const textualWidth: SceneObjectData & {
      readonly width: string;
      readonly height: number;
    } = {
      ...makeObjectOfKind("shape", 2, 3),
      width: "wide",
      height: 40,
    };
    expect(objectBBox(textualWidth)).toEqual(bbox(2, 3, 2, 3));
    const textualHeight: SceneObjectData & {
      readonly width: number;
      readonly height: string;
    } = {
      ...makeObjectOfKind("shape", 2, 3),
      width: 40,
      height: "tall",
    };
    expect(objectBBox(textualHeight)).toEqual(bbox(2, 3, 2, 3));
  });
});

describe("translateSceneObject", () => {
  it("shifts a plain object's position and preserves its identity", () => {
    const shape = makeObjectOfKind("shape", 5, 7);
    const moved = translateSceneObject(shape, vec2(3, -2));
    expect(moved).not.toBe(shape);
    expect(moved.id).toBe("obj-shape");
    expect(moved.kind).toBe("shape");
    expect(moved.position).toEqual(vec2(8, 5));
    expect(moved.rotation).toBe(0);
    expect(moved.zIndex).toBe(1);
    expect(moved.visible).toBe(true);
    expect(moved.locked).toBe(false);
  });

  it("shifts every freehand point along with the position", () => {
    const stroke = makeStroke(
      "stroke-1",
      vec2(0, 0),
      [vec2(0, 0), vec2(4, 6), vec2(2, 8)],
      3,
    );
    const moved = translateSceneObject(stroke, vec2(10, 10));
    expect(moved).not.toBe(stroke);
    if (!isFreehandObject(moved)) {
      throw new Error("expected a freehand object");
    }
    expect(moved.position).toEqual(vec2(10, 10));
    expect(moved.points).toEqual([vec2(10, 10), vec2(14, 16), vec2(12, 18)]);
    expect(moved.strokeColor).toBe("#0ea5e9");
    expect(moved.strokeWidth).toBe(3);
    expect(moved.strokeStyle).toBe("solid");
  });

  it("leaves the source object untouched (immutable update)", () => {
    const stroke = makeStroke(
      "stroke-1",
      vec2(1, 1),
      [vec2(1, 1), vec2(5, 5)],
      2,
    );
    translateSceneObject(stroke, vec2(100, 100));
    expect(stroke.position).toEqual(vec2(1, 1));
    expect(stroke.points[0]).toEqual(vec2(1, 1));
    expect(stroke.points[1]).toEqual(vec2(5, 5));
  });

  it("preserves sized-object and metadata fields on translation", () => {
    const textBox = makeTextBox("box-1", 10, 20, 100, 50);
    const moved = translateSceneObject(textBox, vec2(-10, 5));
    expect(moved).not.toBe(textBox);
    expect(moved.position).toEqual(vec2(0, 25));
    expect(moved.kind).toBe("textBox");
    expect(moved.name).toBe("Box");
    expect(moved.parentId).toBe("group-1");
    expect(moved.zIndex).toBe(3);
    if (!isTextBox(moved)) {
      throw new Error("expected a textBox object");
    }
    expect(moved.text).toBe("doc-1 text");
    expect(moved.fontSize).toBe(20);
    expect(moved.width).toBe(100);
    expect(moved.height).toBe(50);
  });

  it("returns a fresh equal copy for a zero delta", () => {
    const shape = makeObjectOfKind("shape", 5, 7);
    const moved = translateSceneObject(shape, vec2(0, 0));
    expect(moved).not.toBe(shape);
    expect(moved).toEqual(shape);

    const stroke = makeStroke(
      "stroke-1",
      vec2(2, 2),
      [vec2(2, 2), vec2(6, 9)],
      2,
    );
    const movedStroke = translateSceneObject(stroke, vec2(0, 0));
    expect(movedStroke).not.toBe(stroke);
    expect(movedStroke).toEqual(stroke);
  });
});

describe("resizeSceneObject", () => {
  it("derives a shape's rect from the after box inset by half the stroke width", () => {
    // objectBBox pads by strokeWidth/2 = 1: the 100×50 shape at (10, 20)
    // occupies the padded box (9, 19, 111, 71).
    const shape = makeSizedShape("shape-1", 10, 20, 100, 50, 2);
    const before = objectBBox(shape);
    expect(before).toEqual(bbox(9, 19, 111, 71));
    const after = bbox(19, 39, 211, 121);
    const resized = resizeSceneObject(shape, before, after);
    expect(resized).not.toBe(shape);
    if (!isShapeObject(resized)) {
      throw new Error("expected the resized shape");
    }
    expect(resized.position).toEqual(vec2(20, 40));
    expect(resized.width).toBe(190);
    expect(resized.height).toBe(80);
    expect(resized.strokeWidth).toBe(2);
    expect(resized.shapeKind).toBe("rectangle");
    expect(resized.name).toBe("Shape");
    expect(resized.parentId).toBe("group-1");
    expect(resized.zIndex).toBe(3);
    expect(resized.fill).toBe(SHAPE_FILL_TOKEN);
    expect(resized.stroke).toBe(STROKE_COLOR_TOKEN);
  });

  it("round-trips the shape bounds: the result's objectBBox equals the after box", () => {
    const shape = makeSizedShape("shape-1", 10, 20, 100, 50, 6);
    const before = objectBBox(shape);
    expect(before).toEqual(bbox(7, 17, 113, 73));
    const after = bbox(10, 20, 210, 120);
    const resized = resizeSceneObject(shape, before, after);
    if (!isShapeObject(resized)) {
      throw new Error("expected the resized shape");
    }
    expect(resized.position).toEqual(vec2(13, 23));
    expect(resized.width).toBe(194);
    expect(resized.height).toBe(94);
    expect(objectBBox(resized)).toEqual(after);
  });

  it("collapses a shape to zero size when the after box is narrower than the stroke padding", () => {
    const shape = makeSizedShape("shape-1", 10, 20, 100, 50, 2);
    const resized = resizeSceneObject(
      shape,
      objectBBox(shape),
      bbox(10, 20, 11, 21),
    );
    if (!isShapeObject(resized)) {
      throw new Error("expected the resized shape");
    }
    expect(resized.position).toEqual(vec2(11, 21));
    expect(resized.width).toBe(0);
    expect(resized.height).toBe(0);
  });

  it("maps freehand points linearly into the after box's inner region", () => {
    const stroke = makeStroke(
      "stroke-1",
      vec2(5, 10),
      [vec2(20, 30), vec2(5, 10), vec2(12, 18)],
      4,
    );
    const before = objectBBox(stroke);
    expect(before).toEqual(bbox(3, 8, 22, 32));
    const after = bbox(3, 8, 37, 32);
    const resized = resizeSceneObject(stroke, before, after);
    expect(resized).not.toBe(stroke);
    if (!isFreehandObject(resized)) {
      throw new Error("expected a freehand object");
    }
    expect(resized.points).toEqual([vec2(35, 30), vec2(5, 10), vec2(19, 18)]);
    expect(resized.position).toEqual(vec2(35, 30));
    expect(resized.strokeWidth).toBe(4);
    expect(resized.strokeColor).toBe("#0ea5e9");
    expect(resized.strokeStyle).toBe("solid");
    expect(objectBBox(resized)).toEqual(after);
  });

  it("preserves the freehand point count", () => {
    const stroke = makeStroke(
      "stroke-1",
      vec2(0, 0),
      [vec2(0, 0), vec2(4, 6), vec2(2, 8), vec2(9, 1)],
      3,
    );
    const resized = resizeSceneObject(
      stroke,
      objectBBox(stroke),
      bbox(0, 0, 40, 30),
    );
    if (!isFreehandObject(resized)) {
      throw new Error("expected a freehand object");
    }
    expect(resized.points).toHaveLength(4);
  });

  it("translates a single-point stroke into the after box without NaN", () => {
    const stroke = makeStroke("stroke-2", vec2(7, 9), [vec2(7, 9)], 2);
    const before = objectBBox(stroke);
    expect(before).toEqual(bbox(6, 8, 8, 10));
    const resized = resizeSceneObject(stroke, before, bbox(10, 20, 12, 22));
    if (!isFreehandObject(resized)) {
      throw new Error("expected a freehand object");
    }
    expect(resized.points).toEqual([vec2(11, 21)]);
    expect(resized.position).toEqual(vec2(11, 21));
    expect(Number.isFinite(resized.position.x)).toBe(true);
    expect(Number.isFinite(resized.position.y)).toBe(true);
    for (const point of resized.points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it("translates a zero-size stroke box to the after origin without NaN", () => {
    const stroke = makeStroke("stroke-3", vec2(5, 5), [vec2(5, 5)], 0);
    expect(objectBBox(stroke)).toEqual(bbox(5, 5, 5, 5));
    const resized = resizeSceneObject(
      stroke,
      bbox(5, 5, 5, 5),
      bbox(10, 20, 30, 45),
    );
    if (!isFreehandObject(resized)) {
      throw new Error("expected a freehand object");
    }
    expect(resized.points).toEqual([vec2(10, 20)]);
    expect(resized.position).toEqual(vec2(10, 20));
    expect(Number.isFinite(resized.points[0]?.x)).toBe(true);
  });

  it("collapses every freehand point to the after centre when the after box is narrower than the stroke padding", () => {
    const stroke = makeStroke(
      "stroke-1",
      vec2(10, 10),
      [vec2(10, 10), vec2(20, 10)],
      4,
    );
    const resized = resizeSceneObject(
      stroke,
      objectBBox(stroke),
      bbox(0, 0, 1, 1),
    );
    if (!isFreehandObject(resized)) {
      throw new Error("expected a freehand object");
    }
    expect(resized.points).toEqual([vec2(0.5, 0.5), vec2(0.5, 0.5)]);
    expect(Number.isFinite(resized.position.x)).toBe(true);
    expect(Number.isFinite(resized.position.y)).toBe(true);
  });

  it("keeps the stroke's position for a fixture without points", () => {
    const stroke = makeStroke("stroke-4", vec2(10, 20), [], 4);
    const resized = resizeSceneObject(
      stroke,
      objectBBox(stroke),
      bbox(100, 100, 104, 104),
    );
    if (!isFreehandObject(resized)) {
      throw new Error("expected a freehand object");
    }
    expect(resized.position).toEqual(vec2(10, 20));
    expect(resized.points).toEqual([]);
    expect(resized.strokeWidth).toBe(4);
  });

  it("scales a sized non-shape kind by the after/before ratio", () => {
    const note = makeSizedNote("note-1", 0, 0, 100, 50);
    const before = objectBBox(note);
    expect(before).toEqual(bbox(0, 0, 100, 50));
    const after = bbox(10, 20, 30, 45);
    const resized = resizeSceneObject(note, before, after);
    expect(resized).not.toBe(note);
    if (!isSized(resized)) {
      throw new Error("expected the sized resize result");
    }
    expect(resized.position).toEqual(vec2(10, 20));
    expect(resized.width).toBe(20);
    expect(resized.height).toBe(25);
    expect(resized.kind).toBe("stickyNote");
    expect(resized.name).toBe("Note");
    expect(resized.parentId).toBe("group-1");
    expect(resized.id).toBe("note-1");
    expect(resized.zIndex).toBe(5);
    expect(resized.rotation).toBe(0);
    expect(resized.visible).toBe(true);
    expect(resized.locked).toBe(false);
    expect(objectBBox(resized)).toEqual(after);
  });

  it("keeps sized-kind dimensions unchanged for a degenerate zero-size before box", () => {
    const note = makeSizedNote("note-1", 0, 0, 100, 50);
    const resized = resizeSceneObject(
      note,
      bbox(0, 0, 0, 0),
      bbox(10, 20, 30, 45),
    );
    if (!isSized(resized)) {
      throw new Error("expected the sized resize result");
    }
    expect(resized.position).toEqual(vec2(10, 20));
    expect(resized.width).toBe(100);
    expect(resized.height).toBe(50);
  });

  it("moves an unsized kind's position to the after box origin", () => {
    const group = makeObjectOfKind("group", 3, 4);
    const resized = resizeSceneObject(
      group,
      objectBBox(group),
      bbox(10, 20, 30, 45),
    );
    expect(resized).not.toBe(group);
    expect(resized.position).toEqual(vec2(10, 20));
    expect(resized.id).toBe("obj-group");
    expect(resized.kind).toBe("group");
    expect(resized.rotation).toBe(0);
    expect(resized.zIndex).toBe(1);
    expect(resized.visible).toBe(true);
    expect(resized.locked).toBe(false);
  });

  it("falls back to ratio scaling for shape fixtures without a stroke width", () => {
    const partial: SceneObjectData & {
      readonly width: number;
      readonly height: number;
    } = {
      ...makeObjectOfKind("shape", 2, 3),
      width: 40,
      height: 10,
    };
    expect(objectBBox(partial)).toEqual(bbox(2, 3, 42, 13));
    // after = (2, 3, 42, 23): x scale 1, y scale 2.
    const resized = resizeSceneObject(
      partial,
      bbox(2, 3, 42, 13),
      bbox(2, 3, 42, 23),
    );
    expect(resized.position).toEqual(vec2(2, 3));
    if (!isSized(resized)) {
      throw new Error("expected the sized resize result");
    }
    expect(resized.width).toBe(40);
    expect(resized.height).toBe(20);
  });

  it("leaves the source objects untouched (immutable updates)", () => {
    const shape = makeSizedShape("shape-1", 10, 20, 100, 50, 2);
    resizeSceneObject(shape, objectBBox(shape), bbox(19, 39, 211, 121));
    expect(shape.position).toEqual(vec2(10, 20));
    expect(shape.width).toBe(100);
    expect(shape.height).toBe(50);

    const stroke = makeStroke(
      "stroke-1",
      vec2(5, 10),
      [vec2(20, 30), vec2(5, 10), vec2(12, 18)],
      4,
    );
    resizeSceneObject(stroke, objectBBox(stroke), bbox(3, 8, 37, 32));
    expect(stroke.position).toEqual(vec2(5, 10));
    expect(stroke.points).toEqual([vec2(20, 30), vec2(5, 10), vec2(12, 18)]);

    const group = makeObjectOfKind("group", 3, 4);
    resizeSceneObject(group, objectBBox(group), bbox(10, 20, 30, 45));
    expect(group.position).toEqual(vec2(3, 4));
  });
});
