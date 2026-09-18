/** Unit tests for the text box object contract. */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_HEIGHT,
  DEFAULT_TEXT_WIDTH,
  TEXT_COLOR_TOKEN,
  defaultTextBoxRect,
  isTextBoxObject,
  textBoxFromRect,
} from "@/core/model/TextBoxObject";
import {
  objectBBox,
  resizeSceneObject,
  translateSceneObject,
} from "@/core/model/SceneObject";
import { SHAPE_FILL_TOKEN, STROKE_COLOR_TOKEN } from "@/core/model/ShapeObject";
import { bbox } from "@/core/geometry/BBox";
import { vec2 } from "@/core/geometry/Vec2";
import type {
  SceneObjectData,
  SceneObjectKind,
} from "@/core/model/SceneObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";

/** Builds a fully populated text box fixture (all base + kind-specific fields). */
function makeTextBox(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text = "doc-1 text",
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
    width,
    height,
    text,
    doc: null,
    sizeMode: "auto",
    fontSize: 20,
    color: TEXT_COLOR_TOKEN,
  };
}

/** Builds a minimal fixture of a non-textBox kind (no kind-specific fields). */
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

/** Builds a fully populated shape fixture (for the padding contrast). */
function makeShape(
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

describe("TextBoxObject constants", () => {
  it("defines the ink token, the default font size and the default box size", () => {
    expect(TEXT_COLOR_TOKEN).toBe("token://text");
    expect(DEFAULT_TEXT_FONT_SIZE).toBe(20);
    expect(DEFAULT_TEXT_WIDTH).toBe(260);
    expect(DEFAULT_TEXT_HEIGHT).toBe(64);
  });
});

describe("isTextBoxObject", () => {
  it("recognises text box objects", () => {
    expect(isTextBoxObject(makeTextBox("text-1", 10, 20, 100, 50))).toBe(true);
  });

  it("rejects every other object kind, including partial fixtures without text fields", () => {
    const otherKinds: SceneObjectKind[] = [
      "shape",
      "stickyNote",
      "image",
      "connector",
      "freehand",
      "group",
    ];
    for (const kind of otherKinds) {
      expect(isTextBoxObject(makeObjectOfKind(kind, 1, 2))).toBe(false);
    }
  });

  it("narrows a mixed object list to its text box entries", () => {
    const objects: SceneObjectData[] = [
      makeObjectOfKind("group", 0, 0),
      makeTextBox("text-1", 10, 20, 100, 50),
      makeShape("shape-1", 0, 0, 30, 20, 2),
    ];
    const boxes = objects.filter(isTextBoxObject);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.id).toBe("text-1");
    expect(boxes[0]?.text).toBe("doc-1 text");
    expect(boxes[0]?.fontSize).toBe(20);
  });
});

describe("defaultTextBoxRect", () => {
  it("places the default box top-left half a default height above the tap point", () => {
    // Top-left = (world.x, world.y − DEFAULT_TEXT_HEIGHT/2); size 260×64.
    expect(defaultTextBoxRect(vec2(50, 60))).toEqual(bbox(50, 28, 310, 92));
  });

  it("works for negative tap coordinates", () => {
    expect(defaultTextBoxRect(vec2(-10, -20))).toEqual(bbox(-10, -52, 250, 12));
  });
});

describe("textBoxFromRect", () => {
  it("assembles a complete text box object from a rectangle", () => {
    const box = textBoxFromRect(bbox(10, 20, 110, 70), "سلام", 24, "text-1", 7);
    expect(box).toEqual({
      id: "text-1",
      kind: "textBox",
      name: undefined,
      parentId: undefined,
      position: vec2(10, 20),
      rotation: 0,
      zIndex: 7,
      visible: true,
      locked: false,
      width: 100,
      height: 50,
      text: "سلام",
      doc: null,
      sizeMode: "auto",
      fontSize: 24,
      color: TEXT_COLOR_TOKEN,
    });
  });

  it("accepts rectangles in negative world coordinates", () => {
    const box = textBoxFromRect(
      bbox(-30, -40, -10, -25),
      "text",
      20,
      "text-2",
      0,
    );
    expect(box.position).toEqual(vec2(-30, -40));
    expect(box.width).toBe(20);
    expect(box.height).toBe(15);
  });

  it("passes the creation-time empty text and font size through unchanged", () => {
    const box = textBoxFromRect(bbox(0, 0, 260, 64), "", 20, "text-3", 1);
    expect(box.text).toBe("");
    expect(box.fontSize).toBe(20);
    expect(box.color).toBe(TEXT_COLOR_TOKEN);
  });

  it("clamps width and height to zero for inverted (degenerate) rectangles", () => {
    // The assembler tolerates minX > maxX / minY > maxY instead of going negative.
    const invertedX = textBoxFromRect(
      { minX: 50, minY: 60, maxX: 30, maxY: 70 },
      "",
      20,
      "text-4",
      0,
    );
    expect(invertedX.width).toBe(0);
    expect(invertedX.height).toBe(10);
    const invertedY = textBoxFromRect(
      { minX: 0, minY: 50, maxX: 100, maxY: 20 },
      "",
      20,
      "text-5",
      0,
    );
    expect(invertedY.width).toBe(100);
    expect(invertedY.height).toBe(0);
  });
});

describe("objectBBox (text box fixtures)", () => {
  it("bounds a text box from position plus width and height exactly", () => {
    expect(objectBBox(makeTextBox("text-1", 10, 20, 100, 50))).toEqual(
      bbox(10, 20, 110, 70),
    );
    expect(objectBBox(makeTextBox("text-2", -15, -25, 40, 10))).toEqual(
      bbox(-15, -25, 25, -15),
    );
  });

  it("adds no stroke padding, unlike an equally-sized stroked shape", () => {
    // The shape's bounds grow by strokeWidth/2 = 1 on every side; the text
    // box's bounds are exactly position + width/height.
    expect(objectBBox(makeShape("shape-1", 10, 20, 100, 50, 2))).toEqual(
      bbox(9, 19, 111, 71),
    );
    expect(objectBBox(makeTextBox("text-1", 10, 20, 100, 50))).toEqual(
      bbox(10, 20, 110, 70),
    );
  });
});

describe("translateSceneObject (text box fixtures)", () => {
  it("moves only the position and preserves text, font size and box geometry", () => {
    const box = makeTextBox("text-1", 10, 20, 100, 50, "متن");
    const moved = translateSceneObject(box, vec2(-10, 5));
    expect(moved).not.toBe(box);
    if (!isTextBoxObject(moved)) {
      throw new Error("expected a text box object");
    }
    expect(moved.position).toEqual(vec2(0, 25));
    expect(moved.id).toBe("text-1");
    expect(moved.kind).toBe("textBox");
    expect(moved.name).toBe("Box");
    expect(moved.parentId).toBe("group-1");
    expect(moved.rotation).toBe(0);
    expect(moved.zIndex).toBe(3);
    expect(moved.visible).toBe(true);
    expect(moved.locked).toBe(false);
    expect(moved.text).toBe("متن");
    expect(moved.fontSize).toBe(20);
    expect(moved.color).toBe(TEXT_COLOR_TOKEN);
    expect(moved.width).toBe(100);
    expect(moved.height).toBe(50);
  });

  it("leaves the source text box untouched (immutable update)", () => {
    const box = makeTextBox("text-1", 10, 20, 100, 50);
    translateSceneObject(box, vec2(50, 50));
    expect(box.position).toEqual(vec2(10, 20));
    expect(box.width).toBe(100);
    expect(box.height).toBe(50);
    expect(box.text).toBe("doc-1 text");
  });

  it("returns a fresh equal copy for a zero delta", () => {
    const box = makeTextBox("text-1", 5, 7, 30, 20);
    const moved = translateSceneObject(box, vec2(0, 0));
    expect(moved).not.toBe(box);
    expect(moved).toEqual(box);
  });
});

describe("resizeSceneObject (text box fixtures)", () => {
  it("scales a text box through the generic sized-kind path", () => {
    // before (0,0,100,50) → after (10,20,110,80): x scale 1, y scale 60/50.
    const box = makeTextBox("text-1", 0, 0, 100, 50);
    const after = bbox(10, 20, 110, 80);
    const resized = resizeSceneObject(box, bbox(0, 0, 100, 50), after);
    expect(resized).not.toBe(box);
    if (!isTextBoxObject(resized)) {
      throw new Error("expected a text box object");
    }
    expect(resized.position).toEqual(vec2(10, 20));
    expect(resized.width).toBe(100);
    expect(resized.height).toBe(60);
    expect(resized.text).toBe("doc-1 text");
    expect(resized.fontSize).toBe(20);
    expect(resized.color).toBe(TEXT_COLOR_TOKEN);
    expect(resized.zIndex).toBe(3);
    expect(objectBBox(resized)).toEqual(after);
  });

  it("keeps the width of a zero-width before box (degenerate axis scales by 1)", () => {
    const box = makeTextBox("text-1", 0, 0, 100, 50);
    const resized = resizeSceneObject(
      box,
      bbox(0, 0, 0, 50),
      bbox(10, 20, 110, 80),
    );
    if (!isTextBoxObject(resized)) {
      throw new Error("expected a text box object");
    }
    expect(resized.position).toEqual(vec2(10, 20));
    expect(resized.width).toBe(100);
    expect(resized.height).toBe(60);
  });
});
