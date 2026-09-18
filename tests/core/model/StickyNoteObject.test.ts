/** Unit tests for the sticky note object contract. */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STICKY_FONT_SIZE,
  DEFAULT_STICKY_HEIGHT,
  DEFAULT_STICKY_INK,
  DEFAULT_STICKY_NOTE_COLOR,
  DEFAULT_STICKY_WIDTH,
  STICKY_MIN_HEIGHT,
  STICKY_MIN_WIDTH,
  STICKY_NOTE_COLORS,
  defaultStickyNoteRect,
  isStickyNoteObject,
  stickyNoteFromRect,
} from "@/core/model/StickyNoteObject";
import {
  objectBBox,
  resizeSceneObject,
  translateSceneObject,
} from "@/core/model/SceneObject";
import { bbox } from "@/core/geometry/BBox";
import { vec2 } from "@/core/geometry/Vec2";
import type {
  SceneObjectData,
  SceneObjectKind,
} from "@/core/model/SceneObject";
import type { StickyNoteObjectData } from "@/core/model/StickyNoteObject";

/** Builds a fully populated sticky note fixture (all base + kind fields). */
function makeStickyNote(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text = "note text",
): StickyNoteObjectData {
  return {
    id,
    kind: "stickyNote",
    name: "Note",
    parentId: "group-1",
    position: vec2(x, y),
    rotation: 0,
    zIndex: 3,
    visible: true,
    locked: false,
    width,
    height,
    text,
    fontSize: DEFAULT_STICKY_FONT_SIZE,
    noteColor: DEFAULT_STICKY_NOTE_COLOR,
    color: DEFAULT_STICKY_INK,
  };
}

/** Builds a minimal fixture of a non-stickyNote kind (no kind fields). */
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

describe("StickyNoteObject constants", () => {
  it("defines the default ink, card colour, font size and card size", () => {
    expect(DEFAULT_STICKY_INK).toBe("oklch(0.30 0.03 55)");
    expect(DEFAULT_STICKY_NOTE_COLOR).toBe("oklch(0.87 0.14 85)");
    expect(DEFAULT_STICKY_FONT_SIZE).toBe(18);
    expect(DEFAULT_STICKY_WIDTH).toBe(220);
    expect(DEFAULT_STICKY_HEIGHT).toBe(220);
  });

  it("keeps the drag minimums positive and below the defaults", () => {
    expect(STICKY_MIN_WIDTH).toBeGreaterThan(0);
    expect(STICKY_MIN_HEIGHT).toBeGreaterThan(0);
    expect(STICKY_MIN_WIDTH).toBeLessThanOrEqual(DEFAULT_STICKY_WIDTH);
    expect(STICKY_MIN_HEIGHT).toBeLessThanOrEqual(DEFAULT_STICKY_HEIGHT);
  });

  it("leads the curated palette with the default colour, without duplicates", () => {
    expect(STICKY_NOTE_COLORS[0]).toBe(DEFAULT_STICKY_NOTE_COLOR);
    expect(new Set(STICKY_NOTE_COLORS).size).toBe(STICKY_NOTE_COLORS.length);
    expect(STICKY_NOTE_COLORS.length).toBeGreaterThanOrEqual(6);
  });
});

describe("isStickyNoteObject", () => {
  it("recognises sticky note objects", () => {
    expect(isStickyNoteObject(makeStickyNote("note-1", 10, 20, 220, 220))).toBe(
      true,
    );
  });

  it("rejects every other object kind, including partial fixtures without note fields", () => {
    const otherKinds: SceneObjectKind[] = [
      "shape",
      "textBox",
      "image",
      "connector",
      "freehand",
      "group",
    ];
    for (const kind of otherKinds) {
      expect(isStickyNoteObject(makeObjectOfKind(kind, 1, 2))).toBe(false);
    }
  });

  it("narrows a mixed object list to its sticky note entries", () => {
    const objects: SceneObjectData[] = [
      makeObjectOfKind("group", 0, 0),
      makeStickyNote("note-1", 10, 20, 220, 220),
      makeObjectOfKind("textBox", 0, 0),
    ];
    const notes = objects.filter(isStickyNoteObject);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe("note-1");
    expect(notes[0]?.noteColor).toBe(DEFAULT_STICKY_NOTE_COLOR);
    expect(notes[0]?.fontSize).toBe(DEFAULT_STICKY_FONT_SIZE);
  });
});

describe("defaultStickyNoteRect", () => {
  it("centres the default card on the tap point", () => {
    expect(defaultStickyNoteRect(vec2(50, 60))).toEqual(
      bbox(-60, -50, 160, 170),
    );
  });

  it("works for negative tap coordinates", () => {
    expect(defaultStickyNoteRect(vec2(-10, -20))).toEqual(
      bbox(-120, -130, 100, 90),
    );
  });
});

describe("stickyNoteFromRect", () => {
  it("assembles a complete sticky note object from a rectangle", () => {
    const note = stickyNoteFromRect(
      bbox(10, 20, 110, 120),
      "oklch(0.90 0.14 98)",
      "سلام",
      24,
      "note-1",
      7,
    );
    expect(note).toEqual({
      id: "note-1",
      kind: "stickyNote",
      name: undefined,
      parentId: undefined,
      position: vec2(10, 20),
      rotation: 0,
      zIndex: 7,
      visible: true,
      locked: false,
      width: 100,
      height: 100,
      text: "سلام",
      fontSize: 24,
      noteColor: "oklch(0.90 0.14 98)",
      color: DEFAULT_STICKY_INK,
    });
  });

  it("accepts rectangles in negative world coordinates", () => {
    const note = stickyNoteFromRect(
      bbox(-30, -40, -10, -25),
      DEFAULT_STICKY_NOTE_COLOR,
      "text",
      18,
      "note-2",
      0,
    );
    expect(note.position).toEqual(vec2(-30, -40));
    expect(note.width).toBe(20);
    expect(note.height).toBe(15);
  });

  it("passes the creation-time empty text and card colour through unchanged", () => {
    const note = stickyNoteFromRect(
      bbox(0, 0, 220, 220),
      DEFAULT_STICKY_NOTE_COLOR,
      "",
      18,
      "note-3",
      1,
    );
    expect(note.text).toBe("");
    expect(note.noteColor).toBe(DEFAULT_STICKY_NOTE_COLOR);
    expect(note.color).toBe(DEFAULT_STICKY_INK);
  });

  it("clamps width and height to zero for inverted (degenerate) rectangles", () => {
    const invertedX = stickyNoteFromRect(
      { minX: 50, minY: 60, maxX: 30, maxY: 70 },
      DEFAULT_STICKY_NOTE_COLOR,
      "",
      18,
      "note-4",
      0,
    );
    expect(invertedX.width).toBe(0);
    expect(invertedX.height).toBe(10);
    const invertedY = stickyNoteFromRect(
      { minX: 0, minY: 50, maxX: 100, maxY: 20 },
      DEFAULT_STICKY_NOTE_COLOR,
      "",
      18,
      "note-5",
      0,
    );
    expect(invertedY.width).toBe(100);
    expect(invertedY.height).toBe(0);
  });
});

describe("objectBBox (sticky note fixtures)", () => {
  it("bounds a sticky note from position plus width and height exactly", () => {
    expect(objectBBox(makeStickyNote("note-1", 10, 20, 220, 220))).toEqual(
      bbox(10, 20, 230, 240),
    );
    expect(objectBBox(makeStickyNote("note-2", -15, -25, 40, 10))).toEqual(
      bbox(-15, -25, 25, -15),
    );
  });
});

describe("translateSceneObject (sticky note fixtures)", () => {
  it("moves only the position and preserves text, card colour and geometry", () => {
    const note = makeStickyNote("note-1", 10, 20, 220, 220, "یادداشت");
    const moved = translateSceneObject(note, vec2(-10, 5));
    expect(moved).not.toBe(note);
    if (!isStickyNoteObject(moved)) {
      throw new Error("expected a sticky note object");
    }
    expect(moved.position).toEqual(vec2(0, 25));
    expect(moved.id).toBe("note-1");
    expect(moved.kind).toBe("stickyNote");
    expect(moved.text).toBe("یادداشت");
    expect(moved.noteColor).toBe(DEFAULT_STICKY_NOTE_COLOR);
    expect(moved.color).toBe(DEFAULT_STICKY_INK);
    expect(moved.fontSize).toBe(DEFAULT_STICKY_FONT_SIZE);
    expect(moved.width).toBe(220);
    expect(moved.height).toBe(220);
  });

  it("leaves the source note untouched (immutable update)", () => {
    const note = makeStickyNote("note-1", 10, 20, 100, 50);
    translateSceneObject(note, vec2(50, 50));
    expect(note.position).toEqual(vec2(10, 20));
    expect(note.text).toBe("note text");
  });
});

describe("resizeSceneObject (sticky note fixtures)", () => {
  it("scales a sticky note through the generic sized-kind path", () => {
    // before (0,0,100,50) → after (10,20,110,80): x scale 1, y scale 60/50.
    const note = makeStickyNote("note-1", 0, 0, 100, 50);
    const after = bbox(10, 20, 110, 80);
    const resized = resizeSceneObject(note, bbox(0, 0, 100, 50), after);
    expect(resized).not.toBe(note);
    if (!isStickyNoteObject(resized)) {
      throw new Error("expected a sticky note object");
    }
    expect(resized.position).toEqual(vec2(10, 20));
    expect(resized.width).toBe(100);
    expect(resized.height).toBe(60);
    expect(resized.text).toBe("note text");
    expect(resized.noteColor).toBe(DEFAULT_STICKY_NOTE_COLOR);
    expect(objectBBox(resized)).toEqual(after);
  });
});
