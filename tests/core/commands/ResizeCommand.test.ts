/** Unit tests for the object-resize command. */
import { describe, expect, it } from "vitest";
import { ResizeCommand } from "@/core/commands/ResizeCommand";
import { HistoryManager } from "@/core/history/HistoryManager";
import { Scene } from "@/core/model/Scene";
import { SHAPE_FILL_TOKEN, STROKE_COLOR_TOKEN } from "@/core/model/ShapeObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { ShapeObjectData } from "@/core/model/ShapeObject";

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

describe("ResizeCommand", () => {
  it("carries the resizeObject label and stores scene, objectId and both snapshots", () => {
    const scene = new Scene();
    const before = makeShape("shape-1", 10, 20, 100, 50);
    const after = makeShape("shape-1", 9, 19, 202, 102);
    const command = new ResizeCommand(scene, "shape-1", before, after);
    expect(command.label).toBe("command.resizeObject");
    expect(command.scene).toBe(scene);
    expect(command.objectId).toBe("shape-1");
    expect(command.before).toBe(before);
    expect(command.after).toBe(after);
  });

  it("do replaces the object with the after snapshot", () => {
    const scene = new Scene();
    scene.add(makeShape("shape-1", 10, 20, 100, 50));
    const after = makeShape("shape-1", 9, 19, 202, 102);
    new ResizeCommand(
      scene,
      "shape-1",
      makeShape("shape-1", 10, 20, 100, 50),
      after,
    ).do();
    expect(scene.findById("shape-1")).toBe(after);
    expect(scene.objectCount).toBe(1);
  });

  it("undo restores the before snapshot", () => {
    const scene = new Scene();
    const before = makeShape("shape-1", 10, 20, 100, 50);
    const after = makeShape("shape-1", 9, 19, 202, 102);
    scene.add(before);
    const command = new ResizeCommand(scene, "shape-1", before, after);
    command.do();
    command.undo();
    expect(scene.findById("shape-1")).toBe(before);
  });

  it("redo re-applies the after snapshot", () => {
    const scene = new Scene();
    const before = makeShape("shape-1", 10, 20, 100, 50);
    const after = makeShape("shape-1", 9, 19, 202, 102);
    scene.add(before);
    const command = new ResizeCommand(scene, "shape-1", before, after);
    command.do();
    command.undo();
    command.redo();
    expect(scene.findById("shape-1")).toBe(after);
  });

  it("skips objects that are no longer in the scene (do and undo are no-ops)", () => {
    const scene = new Scene();
    scene.add(makeShape("other", 0, 0, 10, 10));
    scene.add(makeShape("shape-1", 10, 20, 100, 50));
    scene.remove("shape-1");
    const command = new ResizeCommand(
      scene,
      "shape-1",
      makeShape("shape-1", 10, 20, 100, 50),
      makeShape("shape-1", 9, 19, 202, 102),
    );
    expect(() => {
      command.do();
      command.undo();
      command.redo();
    }).not.toThrow();
    expect(scene.findById("shape-1")).toBeUndefined();
    expect(scene.objectCount).toBe(1);
  });

  it("round-trips through the history manager", () => {
    const scene = new Scene();
    const before = makeShape("shape-1", 10, 20, 100, 50);
    const after = makeShape("shape-1", 9, 19, 202, 102);
    scene.add(before);
    const history = new HistoryManager();
    const command = new ResizeCommand(scene, "shape-1", before, after);
    command.do();
    history.push(command);
    expect(history.undo()).toBe(command);
    expect(scene.findById("shape-1")).toBe(before);
    expect(history.redo()).toBe(command);
    expect(scene.findById("shape-1")).toBe(after);
  });

  it("preserves the paint order when replacing the resized object", () => {
    const scene = new Scene();
    const first = makeShape("shape-1", 10, 20, 100, 50);
    const second = makeShape("shape-2", 50, 60, 30, 30);
    scene.add(first);
    scene.add(second);
    const after = makeShape("shape-1", 9, 19, 202, 102);
    const command = new ResizeCommand(scene, "shape-1", first, after);
    command.do();
    expect(scene.objectCount).toBe(2);
    expect(scene.objects.map((object) => object.id)).toEqual([
      "shape-1",
      "shape-2",
    ]);
    expect(scene.objects[1]).toBe(second);
    command.undo();
    expect(scene.objects.map((object) => object.id)).toEqual([
      "shape-1",
      "shape-2",
    ]);
    expect(scene.objects[1]).toBe(second);
  });

  it("preserves z-index and metadata of the replaced snapshot", () => {
    const scene = new Scene();
    scene.add(makeShape("shape-1", 10, 20, 100, 50));
    const after: ShapeObjectData = {
      ...makeShape("shape-1", 9, 19, 202, 102),
      zIndex: 7,
      name: "Resized",
    };
    new ResizeCommand(
      scene,
      "shape-1",
      makeShape("shape-1", 10, 20, 100, 50),
      after,
    ).do();
    const resized = scene.findById("shape-1");
    if (resized === undefined) {
      throw new Error("expected the resized shape");
    }
    expect(resized.zIndex).toBe(7);
    expect(resized.name).toBe("Resized");
    expect(scene.objectCount).toBe(1);
  });
});
