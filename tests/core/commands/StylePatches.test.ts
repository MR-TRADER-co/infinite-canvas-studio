/** Unit tests for the pure inspector style-patch planner. */
import { describe, expect, it } from "vitest";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  STROKE_WIDTH_MAX,
  STROKE_WIDTH_MIN,
  clampFontSize,
  clampStrokeWidth,
  planStylePatch,
} from "@/core/commands/StylePatches";
import type { StyleChanges } from "@/core/commands/StylePatches";
import { SHAPE_FILL_TOKEN, STROKE_COLOR_TOKEN } from "@/core/model/ShapeObject";
import { TEXT_COLOR_TOKEN } from "@/core/model/TextBoxObject";
import {
  DEFAULT_STICKY_INK,
  DEFAULT_STICKY_NOTE_COLOR,
} from "@/core/model/StickyNoteObject";
import { vec2 } from "@/core/geometry/Vec2";
import type {
  SceneObjectData,
  SceneObjectKind,
} from "@/core/model/SceneObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import type { FreehandObjectData } from "@/core/model/FreehandObject";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import type { StickyNoteObjectData } from "@/core/model/StickyNoteObject";

/** Builds a fully populated shape fixture (all base + kind-specific fields). */
function makeShape(
  overrides: Partial<
    Pick<ShapeObjectData, "fill" | "stroke" | "strokeWidth">
  > = {},
): ShapeObjectData {
  return {
    id: "shape-1",
    kind: "shape",
    name: "Shape",
    parentId: "group-1",
    position: vec2(10, 20),
    rotation: 0,
    zIndex: 3,
    visible: true,
    locked: false,
    shapeKind: "rectangle",
    width: 100,
    height: 50,
    fill: SHAPE_FILL_TOKEN,
    stroke: STROKE_COLOR_TOKEN,
    strokeWidth: 2,
    ...overrides,
  };
}

/** Builds a fully populated freehand stroke fixture (all base + kind fields). */
function makeStroke(
  overrides: Partial<
    Pick<FreehandObjectData, "strokeColor" | "strokeWidth" | "strokeStyle">
  > = {},
): FreehandObjectData {
  return {
    id: "stroke-1",
    kind: "freehand",
    name: "Stroke",
    parentId: "group-1",
    position: vec2(10, 20),
    rotation: 0,
    zIndex: 3,
    visible: true,
    locked: false,
    points: [vec2(10, 20), vec2(15, 25), vec2(20, 30)],
    strokeColor: "#0ea5e9",
    strokeWidth: 2,
    strokeStyle: "solid",
    ...overrides,
  };
}

/** Builds a fully populated text box fixture (all base + kind-specific fields). */
function makeTextBox(
  overrides: Partial<Pick<TextBoxObjectData, "fontSize" | "color">> = {},
): TextBoxObjectData {
  return {
    id: "text-1",
    kind: "textBox",
    name: "Box",
    parentId: "group-1",
    position: vec2(10, 20),
    rotation: 0,
    zIndex: 3,
    visible: true,
    locked: false,
    width: 100,
    height: 50,
    text: "doc-1 text",
    doc: null,
    sizeMode: "auto",
    fontSize: 20,
    color: TEXT_COLOR_TOKEN,
    ...overrides,
  };
}

/** Builds a fully populated sticky note fixture (all base + kind fields). */
function makeStickyNote(
  overrides: Partial<
    Pick<StickyNoteObjectData, "fontSize" | "noteColor" | "color">
  > = {},
): StickyNoteObjectData {
  return {
    id: "note-1",
    kind: "stickyNote",
    name: "Note",
    parentId: "group-1",
    position: vec2(10, 20),
    rotation: 0,
    zIndex: 3,
    visible: true,
    locked: false,
    width: 220,
    height: 220,
    text: "note text",
    fontSize: 18,
    noteColor: DEFAULT_STICKY_NOTE_COLOR,
    color: DEFAULT_STICKY_INK,
    ...overrides,
  };
}

/** Builds a minimal fixture of a kind the planner does not style. */
function makeOtherOfKind(kind: SceneObjectKind): SceneObjectData {
  return {
    id: `obj-${kind}`,
    kind,
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 1,
    visible: true,
    locked: false,
  };
}

describe("StylePatches constants", () => {
  it("exports the stroke-width and font-size bounds", () => {
    expect(STROKE_WIDTH_MIN).toBe(1);
    expect(STROKE_WIDTH_MAX).toBe(48);
    expect(FONT_SIZE_MIN).toBe(8);
    expect(FONT_SIZE_MAX).toBe(96);
  });
});

describe("clampStrokeWidth", () => {
  it("clamps values below the minimum up to 1", () => {
    expect(clampStrokeWidth(0)).toBe(1);
    expect(clampStrokeWidth(0.2)).toBe(1);
    expect(clampStrokeWidth(-5)).toBe(1);
  });

  it("clamps values above the maximum down to 48", () => {
    expect(clampStrokeWidth(48.1)).toBe(48);
    expect(clampStrokeWidth(100)).toBe(48);
    expect(clampStrokeWidth(Number.POSITIVE_INFINITY)).toBe(48);
  });

  it("rounds to the nearest integer", () => {
    expect(clampStrokeWidth(3.6)).toBe(4);
    expect(clampStrokeWidth(3.4)).toBe(3);
    expect(clampStrokeWidth(7.5)).toBe(8);
  });

  it("passes in-range values through unchanged, including the bounds", () => {
    expect(clampStrokeWidth(1)).toBe(1);
    expect(clampStrokeWidth(7)).toBe(7);
    expect(clampStrokeWidth(48)).toBe(48);
  });
});

describe("clampFontSize", () => {
  it("clamps values below the minimum up to 8", () => {
    expect(clampFontSize(0)).toBe(8);
    expect(clampFontSize(3.2)).toBe(8);
    expect(clampFontSize(-12)).toBe(8);
  });

  it("clamps values above the maximum down to 96", () => {
    expect(clampFontSize(96.4)).toBe(96);
    expect(clampFontSize(200)).toBe(96);
    expect(clampFontSize(Number.POSITIVE_INFINITY)).toBe(96);
  });

  it("rounds to the nearest integer", () => {
    expect(clampFontSize(20.4)).toBe(20);
    expect(clampFontSize(20.6)).toBe(21);
    expect(clampFontSize(42.5)).toBe(43);
  });

  it("passes in-range values through unchanged, including the bounds", () => {
    expect(clampFontSize(8)).toBe(8);
    expect(clampFontSize(33)).toBe(33);
    expect(clampFontSize(96)).toBe(96);
  });
});

describe("planStylePatch (shape)", () => {
  it("plans a fill-only patch for a fill change", () => {
    expect(planStylePatch(makeShape(), { fill: "#22c55e" })).toEqual({
      fill: "#22c55e",
    });
  });

  it("plans a stroke-only patch for a stroke change", () => {
    expect(planStylePatch(makeShape(), { stroke: "#f97316" })).toEqual({
      stroke: "#f97316",
    });
  });

  it("drops the freehand-only strokeColor field", () => {
    expect(planStylePatch(makeShape(), { strokeColor: "#eab308" })).toBeNull();
  });

  it("clamps and lands a stroke-width change", () => {
    expect(planStylePatch(makeShape(), { strokeWidth: 7.6 })).toEqual({
      strokeWidth: 8,
    });
  });

  it("clamps an out-of-range stroke width inside the planner (100 → 48)", () => {
    expect(planStylePatch(makeShape(), { strokeWidth: 100 })).toEqual({
      strokeWidth: 48,
    });
  });

  it("returns null when the fill equals the current fill (no-op)", () => {
    expect(planStylePatch(makeShape(), { fill: SHAPE_FILL_TOKEN })).toBeNull();
  });

  it("returns null when the stroke equals the current stroke (no-op)", () => {
    expect(
      planStylePatch(makeShape(), { stroke: STROKE_COLOR_TOKEN }),
    ).toBeNull();
  });

  it("returns null when the clamped stroke width equals the current value", () => {
    expect(
      planStylePatch(makeShape({ strokeWidth: 48 }), { strokeWidth: 48 }),
    ).toBeNull();
    // Clamping can make a differing request a no-op: 200 clamps to 48.
    expect(
      planStylePatch(makeShape({ strokeWidth: 48 }), { strokeWidth: 200 }),
    ).toBeNull();
  });

  it("drops the text-only fontSize and color fields", () => {
    expect(planStylePatch(makeShape(), { fontSize: 32 })).toBeNull();
    expect(planStylePatch(makeShape(), { color: "#38bdf8" })).toBeNull();
  });

  it("keeps only the fields that actually differ in a combined change", () => {
    const patch = planStylePatch(makeShape(), {
      fill: SHAPE_FILL_TOKEN,
      strokeWidth: 4,
    });
    expect(patch).toEqual({ strokeWidth: 4 });
    const strokeOnly = planStylePatch(makeShape(), {
      stroke: STROKE_COLOR_TOKEN,
      strokeWidth: 4,
    });
    expect(strokeOnly).toEqual({ strokeWidth: 4 });
  });

  it("combines fill, stroke and stroke width into one patch", () => {
    expect(
      planStylePatch(makeShape(), {
        fill: "#22c55e",
        stroke: "#f97316",
        strokeWidth: 100,
      }),
    ).toEqual({ fill: "#22c55e", stroke: "#f97316", strokeWidth: 48 });
  });
});

describe("planStylePatch (freehand)", () => {
  it("plans a strokeColor-only patch for a stroke colour change", () => {
    expect(planStylePatch(makeStroke(), { strokeColor: "#eab308" })).toEqual({
      strokeColor: "#eab308",
    });
  });

  it("drops the shape-only fill and stroke fields", () => {
    expect(planStylePatch(makeStroke(), { fill: "#22c55e" })).toBeNull();
    expect(planStylePatch(makeStroke(), { stroke: "#f97316" })).toBeNull();
  });

  it("clamps a stroke-width change into the editable range (60 → 48)", () => {
    expect(planStylePatch(makeStroke(), { strokeWidth: 60 })).toEqual({
      strokeWidth: 48,
    });
  });

  it("returns null when the stroke colour equals the current one (no-op)", () => {
    expect(planStylePatch(makeStroke(), { strokeColor: "#0ea5e9" })).toBeNull();
  });

  it("keeps only the differing field when the clamped stroke width is already current", () => {
    // 4.6 rounds to 5, which equals the fixture's stroke width.
    expect(
      planStylePatch(makeStroke({ strokeWidth: 5 }), { strokeWidth: 4.6 }),
    ).toBeNull();
    const patch = planStylePatch(makeStroke({ strokeWidth: 5 }), {
      strokeColor: "#eab308",
      strokeWidth: 4.6,
    });
    expect(patch).toEqual({ strokeColor: "#eab308" });
  });

  it("keeps only the stroke width when the stroke colour is unchanged", () => {
    const patch = planStylePatch(makeStroke(), {
      strokeColor: "#0ea5e9",
      strokeWidth: 8,
    });
    expect(patch).toEqual({ strokeWidth: 8 });
  });

  it("drops the text-only fontSize and color fields", () => {
    expect(planStylePatch(makeStroke(), { fontSize: 32 })).toBeNull();
    expect(planStylePatch(makeStroke(), { color: "#38bdf8" })).toBeNull();
  });

  it("combines stroke colour and stroke width into one patch", () => {
    expect(
      planStylePatch(makeStroke(), {
        strokeColor: "#eab308",
        strokeWidth: 60,
      }),
    ).toEqual({ strokeColor: "#eab308", strokeWidth: 48 });
  });
});

describe("planStylePatch (textBox)", () => {
  it("clamps a font-size change into the editable range (200 → 96)", () => {
    expect(planStylePatch(makeTextBox(), { fontSize: 200 })).toEqual({
      fontSize: 96,
    });
  });

  it("rounds a fractional font size inside the planner (42.6 → 43)", () => {
    expect(planStylePatch(makeTextBox(), { fontSize: 42.6 })).toEqual({
      fontSize: 43,
    });
  });

  it("plans a color-only patch for an ink colour change", () => {
    expect(planStylePatch(makeTextBox(), { color: "#38bdf8" })).toEqual({
      color: "#38bdf8",
    });
  });

  it("drops the shape-only and freehand-only style fields", () => {
    expect(planStylePatch(makeTextBox(), { fill: "#22c55e" })).toBeNull();
    expect(planStylePatch(makeTextBox(), { stroke: "#f97316" })).toBeNull();
    expect(
      planStylePatch(makeTextBox(), { strokeColor: "#eab308" }),
    ).toBeNull();
    expect(planStylePatch(makeTextBox(), { strokeWidth: 4 })).toBeNull();
  });

  it("returns null when the clamped font size equals the current value", () => {
    expect(
      planStylePatch(makeTextBox({ fontSize: 20 }), { fontSize: 20 }),
    ).toBeNull();
    // Clamping can make a differing request a no-op: 200 clamps to 96.
    expect(
      planStylePatch(makeTextBox({ fontSize: 96 }), { fontSize: 200 }),
    ).toBeNull();
  });

  it("returns null when the colour equals the current ink colour (no-op)", () => {
    expect(
      planStylePatch(makeTextBox(), { color: TEXT_COLOR_TOKEN }),
    ).toBeNull();
  });

  it("keeps only the differing field in mixed changes", () => {
    const sameFont = planStylePatch(makeTextBox(), {
      fontSize: 20,
      color: "#38bdf8",
    });
    expect(sameFont).toEqual({ color: "#38bdf8" });
    const sameColor = planStylePatch(makeTextBox(), {
      fontSize: 32,
      color: TEXT_COLOR_TOKEN,
    });
    expect(sameColor).toEqual({ fontSize: 32 });
  });

  it("combines font size and colour into one patch", () => {
    expect(
      planStylePatch(makeTextBox(), {
        fontSize: 42.6,
        color: "#38bdf8",
      }),
    ).toEqual({ fontSize: 43, color: "#38bdf8" });
  });
});

describe("planStylePatch (stickyNote)", () => {
  it("plans a noteColor-only patch for a card colour change", () => {
    expect(
      planStylePatch(makeStickyNote(), { noteColor: "oklch(0.90 0.14 98)" }),
    ).toEqual({
      noteColor: "oklch(0.90 0.14 98)",
    });
  });

  it("clamps a font-size change into the editable range (200 → 96)", () => {
    expect(planStylePatch(makeStickyNote(), { fontSize: 200 })).toEqual({
      fontSize: 96,
    });
  });

  it("plans a color-only patch for a note ink change", () => {
    expect(
      planStylePatch(makeStickyNote(), { color: "oklch(0.25 0.02 55)" }),
    ).toEqual({
      color: "oklch(0.25 0.02 55)",
    });
  });

  it("drops the shape-only and freehand-only style fields", () => {
    expect(planStylePatch(makeStickyNote(), { fill: "#22c55e" })).toBeNull();
    expect(planStylePatch(makeStickyNote(), { stroke: "#f97316" })).toBeNull();
    expect(
      planStylePatch(makeStickyNote(), { strokeColor: "#eab308" }),
    ).toBeNull();
    expect(planStylePatch(makeStickyNote(), { strokeWidth: 4 })).toBeNull();
  });

  it("returns null when the card colour equals the current one (no-op)", () => {
    expect(
      planStylePatch(makeStickyNote(), {
        noteColor: DEFAULT_STICKY_NOTE_COLOR,
      }),
    ).toBeNull();
  });

  it("returns null when the clamped font size equals the current value", () => {
    expect(
      planStylePatch(makeStickyNote({ fontSize: 18 }), { fontSize: 18 }),
    ).toBeNull();
    // Clamping can make a differing request a no-op: 200 clamps to 96.
    expect(
      planStylePatch(makeStickyNote({ fontSize: 96 }), { fontSize: 200 }),
    ).toBeNull();
  });

  it("keeps only the differing field in mixed changes", () => {
    const sameFont = planStylePatch(makeStickyNote(), {
      fontSize: 18,
      noteColor: "oklch(0.90 0.14 98)",
    });
    expect(sameFont).toEqual({ noteColor: "oklch(0.90 0.14 98)" });
    const sameColor = planStylePatch(makeStickyNote(), {
      fontSize: 32,
      noteColor: DEFAULT_STICKY_NOTE_COLOR,
    });
    expect(sameColor).toEqual({ fontSize: 32 });
  });

  it("combines card colour, font size and ink into one patch", () => {
    expect(
      planStylePatch(makeStickyNote(), {
        noteColor: "oklch(0.90 0.14 98)",
        fontSize: 42.6,
        color: "oklch(0.25 0.02 55)",
      }),
    ).toEqual({
      noteColor: "oklch(0.90 0.14 98)",
      fontSize: 43,
      color: "oklch(0.25 0.02 55)",
    });
  });
});

describe("planStylePatch (other kinds)", () => {
  /** Every style field set at once — the widest possible request. */
  const fullChanges: StyleChanges = {
    fill: "#22c55e",
    stroke: "#f97316",
    strokeColor: "#eab308",
    strokeWidth: 4,
    fontSize: 32,
    color: "#38bdf8",
    noteColor: "oklch(0.90 0.14 98)",
  };

  it("returns null for every other unstyled kind (image, group)", () => {
    // Connector is a styled kind now (stroke + routing + arrows — see the
    // connector branch tests in the StylePatches connector suite).
    const kinds: SceneObjectKind[] = ["image", "group"];
    for (const kind of kinds) {
      expect(planStylePatch(makeOtherOfKind(kind), fullChanges)).toBeNull();
    }
  });
});

describe("planStylePatch (empty changes)", () => {
  it("returns null for every kind when no field is requested", () => {
    expect(planStylePatch(makeShape(), {})).toBeNull();
    expect(planStylePatch(makeStroke(), {})).toBeNull();
    expect(planStylePatch(makeTextBox(), {})).toBeNull();
    expect(planStylePatch(makeStickyNote(), {})).toBeNull();
    expect(planStylePatch(makeOtherOfKind("group"), {})).toBeNull();
  });
});
