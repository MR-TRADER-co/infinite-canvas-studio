/** Unit tests for the object-translation command. */
import { describe, expect, it } from "vitest";
import { MoveCommand } from "@/core/commands/MoveCommand";
import { HistoryManager } from "@/core/history/HistoryManager";
import { Scene } from "@/core/model/Scene";
import { isFreehandObject } from "@/core/model/FreehandObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { Vec2 } from "@/core/geometry/Vec2";
import type { FreehandObjectData } from "@/core/model/FreehandObject";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Builds a minimal shape fixture at the given position. */
function makeObject(
  id: string,
  x: number,
  y: number,
  zIndex: number,
): SceneObjectData {
  return {
    id,
    kind: "shape",
    position: vec2(x, y),
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
  };
}

/** Builds a freehand stroke fixture whose position mirrors its first point. */
function makeStroke(id: string, points: readonly Vec2[]): FreehandObjectData {
  const first = points[0];
  if (first === undefined) {
    throw new Error("stroke fixtures need at least one point");
  }
  return {
    id,
    kind: "freehand",
    position: vec2(first.x, first.y),
    rotation: 0,
    zIndex: 5,
    visible: true,
    locked: false,
    points,
    strokeColor: "#0ea5e9",
    strokeWidth: 2,
    strokeStyle: "solid",
  };
}

describe("MoveCommand", () => {
  it("carries the moveObjects label and stores scene, objectIds and delta", () => {
    const scene = new Scene();
    const command = new MoveCommand(scene, ["a", "b"], vec2(3, 4));
    expect(command.label).toBe("command.moveObjects");
    expect(command.scene).toBe(scene);
    expect(command.objectIds).toEqual(["a", "b"]);
    expect(command.delta).toEqual(vec2(3, 4));
  });

  it("do translates every referenced object", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0, 0, 0));
    scene.add(makeObject("b", 10, 20, 1));
    new MoveCommand(scene, ["a", "b"], vec2(3, 4)).do();
    expect(scene.findById("a")?.position).toEqual(vec2(3, 4));
    expect(scene.findById("b")?.position).toEqual(vec2(13, 24));
    expect(scene.objectCount).toBe(2);
  });

  it("do replaces objects in place, preserving insertion order and z-index", () => {
    const scene = new Scene();
    const a = makeObject("a", 0, 0, 2);
    const b = makeObject("b", 5, 5, 3);
    const c = makeObject("c", 9, 9, 4);
    scene.add(a);
    scene.add(b);
    scene.add(c);
    new MoveCommand(scene, ["a", "c"], vec2(1, 1)).do();
    expect(scene.objectCount).toBe(3);
    expect(scene.objects[0]?.id).toBe("a");
    expect(scene.objects[1]).toBe(b);
    expect(scene.objects[2]?.id).toBe("c");
    expect(scene.objects[0]?.zIndex).toBe(2);
    expect(scene.objects[2]?.zIndex).toBe(4);
    expect(scene.objects[0]).not.toBe(a);
    expect(scene.objects[2]).not.toBe(c);
  });

  it("do shifts every freehand stroke point", () => {
    const scene = new Scene();
    scene.add(makeStroke("stroke-1", [vec2(1, 2), vec2(5, 6), vec2(8, 3)]));
    new MoveCommand(scene, ["stroke-1"], vec2(10, -1)).do();
    const moved = scene.findById("stroke-1");
    if (moved === undefined || !isFreehandObject(moved)) {
      throw new Error("expected the moved freehand stroke");
    }
    expect(moved.position).toEqual(vec2(11, 1));
    expect(moved.points).toEqual([vec2(11, 1), vec2(15, 5), vec2(18, 2)]);
    expect(moved.strokeWidth).toBe(2);
  });

  it("do with a zero delta leaves the scene untouched", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 7, 9, 0));
    const command = new MoveCommand(scene, ["a"], vec2(0, 0));
    const revisionBefore = scene.revision;
    command.do();
    command.undo();
    command.redo();
    expect(scene.revision).toBe(revisionBefore);
    expect(scene.findById("a")?.position).toEqual(vec2(7, 9));
  });

  it("moves objects for a vertical-only delta", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 7, 9, 0));
    new MoveCommand(scene, ["a"], vec2(0, 5)).do();
    expect(scene.findById("a")?.position).toEqual(vec2(7, 14));
  });

  it("undo restores the exact original positions and points", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 12, 34, 0));
    scene.add(makeStroke("stroke-1", [vec2(0, 0), vec2(6, 8)]));
    const command = new MoveCommand(scene, ["a", "stroke-1"], vec2(25, -17));
    command.do();
    command.undo();
    expect(scene.findById("a")?.position).toEqual(vec2(12, 34));
    const stroke = scene.findById("stroke-1");
    if (stroke === undefined || !isFreehandObject(stroke)) {
      throw new Error("expected the freehand stroke");
    }
    expect(stroke.position).toEqual(vec2(0, 0));
    expect(stroke.points).toEqual([vec2(0, 0), vec2(6, 8)]);
  });

  it("redo re-applies the move after an undo", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 12, 34, 0));
    const command = new MoveCommand(scene, ["a"], vec2(25, -17));
    command.do();
    command.undo();
    command.redo();
    expect(scene.findById("a")?.position).toEqual(vec2(37, 17));
  });

  it("skips referenced ids that are no longer in the scene", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0, 0, 0));
    scene.add(makeObject("b", 10, 10, 1));
    scene.remove("b");
    const command = new MoveCommand(scene, ["a", "b", "ghost"], vec2(2, 2));
    expect(() => command.do()).not.toThrow();
    expect(scene.findById("a")?.position).toEqual(vec2(2, 2));
    expect(scene.findById("b")).toBeUndefined();
    expect(scene.objectCount).toBe(1);
  });

  it("round-trips through the history manager", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 12, 34, 0));
    scene.add(makeStroke("stroke-1", [vec2(0, 0), vec2(6, 8)]));
    const history = new HistoryManager();
    const command = new MoveCommand(scene, ["a", "stroke-1"], vec2(5, 7));
    command.do();
    history.push(command);
    expect(history.undo()).toBe(command);
    expect(scene.findById("a")?.position).toEqual(vec2(12, 34));
    expect(history.redo()).toBe(command);
    expect(scene.findById("a")?.position).toEqual(vec2(17, 41));
    const stroke = scene.findById("stroke-1");
    if (stroke === undefined || !isFreehandObject(stroke)) {
      throw new Error("expected the freehand stroke");
    }
    expect(stroke.points).toEqual([vec2(5, 7), vec2(11, 15)]);
  });
});
