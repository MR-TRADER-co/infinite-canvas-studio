/** Unit tests for the layers-panel property-patch command. */
import { describe, expect, it } from "vitest";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import { HistoryManager } from "@/core/history/HistoryManager";
import { Scene } from "@/core/model/Scene";
import {
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN,
  isShapeObject,
} from "@/core/model/ShapeObject";
import { isFreehandObject } from "@/core/model/FreehandObject";
import { TEXT_COLOR_TOKEN, isTextBoxObject } from "@/core/model/TextBoxObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import type { FreehandObjectData } from "@/core/model/FreehandObject";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";

/** Builds a fully populated shape fixture (all base + kind-specific fields). */
function makeShape(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
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
    strokeWidth: 2,
  };
}

/** Builds a fully populated freehand stroke fixture (all base + kind fields). */
function makeStroke(id: string): FreehandObjectData {
  return {
    id,
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
  };
}

/** Builds a fully populated text box fixture (all base + kind-specific fields). */
function makeTextBox(id: string): TextBoxObjectData {
  return {
    id,
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
  };
}

describe("UpdateObjectCommand", () => {
  it("carries the updateObject label and stores scene, objectId, patch and before", () => {
    const scene = new Scene();
    const before = makeShape("shape-1", 10, 20, 100, 50);
    const command = new UpdateObjectCommand(
      scene,
      "shape-1",
      { name: "Note" },
      before,
    );
    expect(command.label).toBe("command.updateObject");
    expect(command.scene).toBe(scene);
    expect(command.objectId).toBe("shape-1");
    expect(command.patch).toEqual({ name: "Note" });
    expect(command.before).toBe(before);
  });

  it("do merges the patch into the current object data, not the captured snapshot", () => {
    const scene = new Scene();
    const before = makeShape("shape-1", 10, 20, 100, 50);
    scene.add(before);
    // A live mutation (e.g. a resize) replaces the object after the snapshot
    // was captured; the patch must apply on top of the CURRENT data.
    const widened: ShapeObjectData = { ...before, width: 140 };
    scene.add(widened);
    new UpdateObjectCommand(scene, "shape-1", { name: "Note" }, before).do();
    const patched = scene.findById("shape-1");
    if (patched === undefined || !isShapeObject(patched)) {
      throw new Error("expected the patched shape");
    }
    expect(patched.name).toBe("Note");
    expect(patched.width).toBe(140);
    expect(scene.objectCount).toBe(1);
  });

  it("do toggles visibility and lock flags", () => {
    const scene = new Scene();
    scene.add(makeShape("shape-1", 10, 20, 100, 50));
    new UpdateObjectCommand(
      scene,
      "shape-1",
      { visible: false, locked: true },
      makeShape("shape-1", 10, 20, 100, 50),
    ).do();
    const patched = scene.findById("shape-1");
    if (patched === undefined) {
      throw new Error("expected the patched shape");
    }
    expect(patched.visible).toBe(false);
    expect(patched.locked).toBe(true);
    expect(patched.name).toBe("Shape");
  });

  it("undo restores the exact before snapshot", () => {
    const scene = new Scene();
    const before = makeShape("shape-1", 10, 20, 100, 50);
    scene.add(before);
    const command = new UpdateObjectCommand(
      scene,
      "shape-1",
      { name: "Note", locked: true },
      before,
    );
    command.do();
    command.undo();
    expect(scene.findById("shape-1")).toBe(before);
  });

  it("redo re-applies the patch after an undo", () => {
    const scene = new Scene();
    const before = makeShape("shape-1", 10, 20, 100, 50);
    scene.add(before);
    const command = new UpdateObjectCommand(
      scene,
      "shape-1",
      { name: "Note" },
      before,
    );
    command.do();
    command.undo();
    command.redo();
    expect(scene.findById("shape-1")?.name).toBe("Note");
  });

  it("do with a name of undefined clears the name", () => {
    const scene = new Scene();
    scene.add(makeShape("shape-1", 10, 20, 100, 50));
    new UpdateObjectCommand(
      scene,
      "shape-1",
      { name: undefined },
      makeShape("shape-1", 10, 20, 100, 50),
    ).do();
    const patched = scene.findById("shape-1");
    if (patched === undefined) {
      throw new Error("expected the patched shape");
    }
    expect(patched.name).toBeUndefined();
  });

  it("skips objects that are no longer in the scene (do and undo are no-ops)", () => {
    const scene = new Scene();
    scene.add(makeShape("other", 0, 0, 10, 10));
    const command = new UpdateObjectCommand(
      scene,
      "ghost",
      { name: "Note" },
      makeShape("ghost", 0, 0, 10, 10),
    );
    expect(() => {
      command.do();
      command.undo();
      command.redo();
    }).not.toThrow();
    expect(scene.findById("ghost")).toBeUndefined();
    expect(scene.objectCount).toBe(1);
  });

  it("undoes consecutive patches on the same object step by step", () => {
    const scene = new Scene();
    const original = makeShape("shape-1", 10, 20, 100, 50);
    scene.add(original);
    const history = new HistoryManager();

    const rename = new UpdateObjectCommand(
      scene,
      "shape-1",
      { name: "Note" },
      original,
    );
    rename.do();
    history.push(rename);
    const afterRename = scene.findById("shape-1");
    if (afterRename === undefined) {
      throw new Error("expected the renamed shape");
    }
    const hide = new UpdateObjectCommand(
      scene,
      "shape-1",
      { visible: false },
      afterRename,
    );
    hide.do();
    history.push(hide);

    expect(scene.findById("shape-1")?.visible).toBe(false);
    history.undo();
    const stepOne = scene.findById("shape-1");
    if (stepOne === undefined) {
      throw new Error("expected the restored shape");
    }
    expect(stepOne.name).toBe("Note");
    expect(stepOne.visible).toBe(true);
    history.undo();
    expect(scene.findById("shape-1")).toBe(original);
  });
});

describe("UpdateObjectCommand (style patches)", () => {
  it("do merges a fill patch on a shape while the spread keeps every other field, undo restores the exact snapshot", () => {
    const scene = new Scene();
    const before = makeShape("shape-1", 10, 20, 100, 50);
    scene.add(before);
    const command = new UpdateObjectCommand(
      scene,
      "shape-1",
      { fill: "#22c55e" },
      before,
    );
    command.do();
    const patched = scene.findById("shape-1");
    if (patched === undefined || !isShapeObject(patched)) {
      throw new Error("expected the patched shape");
    }
    expect(patched.fill).toBe("#22c55e");
    // The spread merge keeps every field the patch does not mention.
    expect(patched).toEqual({ ...before, fill: "#22c55e" });
    expect(patched.name).toBe("Shape");
    expect(patched.parentId).toBe("group-1");
    expect(patched.position).toEqual(vec2(10, 20));
    expect(patched.shapeKind).toBe("rectangle");
    expect(patched.width).toBe(100);
    expect(patched.height).toBe(50);
    expect(patched.stroke).toBe(STROKE_COLOR_TOKEN);
    expect(patched.strokeWidth).toBe(2);
    expect(scene.objectCount).toBe(1);
    command.undo();
    // Full-object restore, not just the fill field.
    expect(scene.findById("shape-1")).toEqual(before);
  });

  it("round-trips a combined strokeColor and strokeWidth patch on a freehand stroke", () => {
    const scene = new Scene();
    const before = makeStroke("stroke-1");
    scene.add(before);
    const command = new UpdateObjectCommand(
      scene,
      "stroke-1",
      { strokeColor: "#f97316", strokeWidth: 8 },
      before,
    );
    command.do();
    const patched = scene.findById("stroke-1");
    if (patched === undefined || !isFreehandObject(patched)) {
      throw new Error("expected the patched stroke");
    }
    expect(patched.strokeColor).toBe("#f97316");
    expect(patched.strokeWidth).toBe(8);
    expect(patched).toEqual({
      ...before,
      strokeColor: "#f97316",
      strokeWidth: 8,
    });
    command.undo();
    const restored = scene.findById("stroke-1");
    if (restored === undefined || !isFreehandObject(restored)) {
      throw new Error("expected the restored stroke");
    }
    // Deep-compare the full object, point list included.
    expect(restored).toEqual(before);
    expect(restored.points).toEqual([vec2(10, 20), vec2(15, 25), vec2(20, 30)]);
    expect(restored.strokeStyle).toBe("solid");
  });

  it("patches fontSize and color on a text box and restores them exactly", () => {
    const scene = new Scene();
    const before = makeTextBox("text-1");
    scene.add(before);
    const command = new UpdateObjectCommand(
      scene,
      "text-1",
      { fontSize: 32, color: "#38bdf8" },
      before,
    );
    command.do();
    const patched = scene.findById("text-1");
    if (patched === undefined || !isTextBoxObject(patched)) {
      throw new Error("expected the patched text box");
    }
    expect(patched.fontSize).toBe(32);
    expect(patched.color).toBe("#38bdf8");
    expect(patched).toEqual({ ...before, fontSize: 32, color: "#38bdf8" });
    expect(patched.text).toBe("doc-1 text");
    expect(patched.width).toBe(100);
    expect(patched.height).toBe(50);
    command.undo();
    expect(scene.findById("text-1")).toEqual(before);
  });

  it("survives a do → undo → redo → undo cycle without drifting from the before snapshot", () => {
    const scene = new Scene();
    const before = makeShape("shape-1", 10, 20, 100, 50);
    scene.add(before);
    const history = new HistoryManager();
    const command = new UpdateObjectCommand(
      scene,
      "shape-1",
      { fill: "#22c55e", strokeWidth: 12 },
      before,
    );
    command.do();
    history.push(command);
    history.undo();
    expect(scene.findById("shape-1")).toEqual(before);
    history.redo();
    const redone = scene.findById("shape-1");
    if (redone === undefined || !isShapeObject(redone)) {
      throw new Error("expected the redone shape");
    }
    expect(redone).toEqual({ ...before, fill: "#22c55e", strokeWidth: 12 });
    history.undo();
    expect(scene.findById("shape-1")).toEqual(before);
    expect(scene.objectCount).toBe(1);
  });
});
