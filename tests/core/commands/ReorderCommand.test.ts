/** Unit tests for the paint-order (z-order) reorder command. */
import { describe, expect, it } from "vitest";
import { ReorderCommand } from "@/core/commands/ReorderCommand";
import { HistoryManager } from "@/core/history/HistoryManager";
import { Scene } from "@/core/model/Scene";
import { vec2 } from "@/core/geometry/Vec2";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Builds a minimal shape fixture at the given position. */
function makeObject(id: string, zIndex: number): SceneObjectData {
  return {
    id,
    kind: "shape",
    position: vec2(0, 0),
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
  };
}

/** Adds three objects a, b, c to a fresh scene and returns it. */
function makeSceneWithThree(): Scene {
  const scene = new Scene();
  scene.add(makeObject("a", 0));
  scene.add(makeObject("b", 1));
  scene.add(makeObject("c", 2));
  return scene;
}

describe("ReorderCommand", () => {
  it("carries the reorderObject label and stores scene, objectId and both indices", () => {
    const scene = new Scene();
    const command = new ReorderCommand(scene, "b", 1, 2);
    expect(command.label).toBe("command.reorderObject");
    expect(command.scene).toBe(scene);
    expect(command.objectId).toBe("b");
    expect(command.fromIndex).toBe(1);
    expect(command.toIndex).toBe(2);
  });

  it("do moves the object from fromIndex to toIndex in the paint order", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    scene.add(makeObject("b", 1));
    scene.add(makeObject("c", 2));
    scene.add(makeObject("d", 3));
    new ReorderCommand(scene, "b", 1, 3).do();
    expect(scene.objects.map((object) => object.id)).toEqual([
      "a",
      "c",
      "d",
      "b",
    ]);
    expect(scene.objectCount).toBe(4);
  });

  it("undo moves the object back to fromIndex", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    scene.add(makeObject("b", 1));
    scene.add(makeObject("c", 2));
    scene.add(makeObject("d", 3));
    const command = new ReorderCommand(scene, "b", 1, 3);
    command.do();
    command.undo();
    expect(scene.objects.map((object) => object.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("redo re-applies the move", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    scene.add(makeObject("b", 1));
    scene.add(makeObject("c", 2));
    scene.add(makeObject("d", 3));
    const command = new ReorderCommand(scene, "b", 1, 3);
    command.do();
    command.undo();
    command.redo();
    expect(scene.objects.map((object) => object.id)).toEqual([
      "a",
      "c",
      "d",
      "b",
    ]);
  });

  it("clamps an oversized toIndex to the last position", () => {
    const scene = makeSceneWithThree();
    new ReorderCommand(scene, "a", 0, 99).do();
    expect(scene.objects.map((object) => object.id)).toEqual(["b", "c", "a"]);
  });

  it("clamps a negative toIndex to the first position", () => {
    const scene = makeSceneWithThree();
    new ReorderCommand(scene, "b", 1, -5).do();
    expect(scene.objects.map((object) => object.id)).toEqual(["b", "a", "c"]);
  });

  it("skips objects that are no longer in the scene (do and undo are no-ops)", () => {
    const scene = makeSceneWithThree();
    scene.remove("b");
    const command = new ReorderCommand(scene, "b", 1, 2);
    const revisionBefore = scene.revision;
    expect(() => {
      command.do();
      command.undo();
      command.redo();
    }).not.toThrow();
    expect(scene.objects.map((object) => object.id)).toEqual(["a", "c"]);
    expect(scene.objectCount).toBe(2);
    expect(scene.revision).toBe(revisionBefore);
  });

  it("does not bump the revision for a same-position move", () => {
    const scene = makeSceneWithThree();
    const command = new ReorderCommand(scene, "b", 1, 1);
    const revisionBefore = scene.revision;
    command.do();
    command.undo();
    expect(scene.revision).toBe(revisionBefore);
    expect(scene.objects.map((object) => object.id)).toEqual(["a", "b", "c"]);
  });

  it("round-trips through the history manager", () => {
    const scene = makeSceneWithThree();
    const history = new HistoryManager();
    const command = new ReorderCommand(scene, "a", 0, 2);
    command.do();
    history.push(command);
    expect(scene.objects.map((object) => object.id)).toEqual(["b", "c", "a"]);
    expect(history.undo()).toBe(command);
    expect(scene.objects.map((object) => object.id)).toEqual(["a", "b", "c"]);
    expect(history.redo()).toBe(command);
    expect(scene.objects.map((object) => object.id)).toEqual(["b", "c", "a"]);
  });

  it("keeps the moved object's data and reference unchanged", () => {
    const scene = makeSceneWithThree();
    const b = scene.findById("b");
    if (b === undefined) {
      throw new Error("expected the b fixture");
    }
    new ReorderCommand(scene, "b", 1, 2).do();
    expect(scene.objects[2]).toBe(b);
    expect(scene.findById("b")).toBe(b);
    expect(scene.objectCount).toBe(3);
  });
});
