/** Unit tests for drag-gesture command coalescing. */
import { describe, expect, it } from "vitest";
import { Coalescer } from "@/core/commands/Coalescer";
import { MoveCommand } from "@/core/commands/MoveCommand";
import { HistoryManager } from "@/core/history/HistoryManager";
import { Scene } from "@/core/model/Scene";
import { isFreehandObject } from "@/core/model/FreehandObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { Vec2 } from "@/core/geometry/Vec2";
import type { ICommand } from "@/core/commands/Command";
import type { FreehandObjectData } from "@/core/model/FreehandObject";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Minimal non-move command double used to break merge chains. */
class StubCommand implements ICommand {
  public readonly label = "stub.command";

  public do(): void {}

  public undo(): void {}

  public redo(): void {}
}

/** Builds a minimal shape fixture at the given position. */
function makeObject(id: string, x: number, y: number): SceneObjectData {
  return {
    id,
    kind: "shape",
    position: vec2(x, y),
    rotation: 0,
    zIndex: 0,
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
    zIndex: 1,
    visible: true,
    locked: false,
    points,
    strokeColor: "#0ea5e9",
    strokeWidth: 2,
    strokeStyle: "solid",
  };
}

describe("Coalescer", () => {
  it("returns the first offered command unchanged and keeps it pending", () => {
    const scene = new Scene();
    const first = new MoveCommand(scene, ["a"], vec2(3, 4));
    const coalescer = new Coalescer();
    expect(coalescer.offer(first)).toBe(first);
    expect(coalescer.takePending()).toBe(first);
  });

  it("merges two move commands over the same ids into a summed delta", () => {
    const scene = new Scene();
    const first = new MoveCommand(scene, ["a", "b"], vec2(3, 4));
    const second = new MoveCommand(scene, ["a", "b"], vec2(1, 2));
    const coalescer = new Coalescer();
    coalescer.offer(first);
    const merged = coalescer.offer(second);
    if (!(merged instanceof MoveCommand)) {
      throw new Error("expected a merged MoveCommand");
    }
    expect(merged).not.toBe(first);
    expect(merged).not.toBe(second);
    expect(merged.delta).toEqual(vec2(4, 6));
    expect(merged.objectIds).toEqual(["a", "b"]);
    expect(merged.scene).toBe(scene);
    expect(merged.label).toBe("command.moveObjects");
    expect(first.delta).toEqual(vec2(3, 4));
    expect(second.delta).toEqual(vec2(1, 2));
  });

  it("merges a three-frame drag chain into one command", () => {
    const scene = new Scene();
    const frame1 = new MoveCommand(scene, ["a"], vec2(1, 2));
    const frame2 = new MoveCommand(scene, ["a"], vec2(3, 4));
    const frame3 = new MoveCommand(scene, ["a"], vec2(5, 6));
    const coalescer = new Coalescer();
    const firstResult = coalescer.offer(frame1);
    const secondResult = coalescer.offer(frame2);
    const thirdResult = coalescer.offer(frame3);
    expect(firstResult).toBe(frame1);
    if (!(secondResult instanceof MoveCommand)) {
      throw new Error("expected a merged MoveCommand");
    }
    expect(secondResult.delta).toEqual(vec2(4, 6));
    if (!(thirdResult instanceof MoveCommand)) {
      throw new Error("expected a merged MoveCommand");
    }
    expect(thirdResult.delta).toEqual(vec2(9, 12));
    expect(coalescer.takePending()).toBe(thirdResult);
  });

  it("the merged command operates on the second command's scene", () => {
    const sceneA = new Scene();
    sceneA.add(makeObject("a", 0, 0));
    const sceneB = new Scene();
    sceneB.add(makeObject("a", 0, 0));
    const first = new MoveCommand(sceneA, ["a"], vec2(3, 4));
    const second = new MoveCommand(sceneB, ["a"], vec2(1, 1));
    const coalescer = new Coalescer();
    coalescer.offer(first);
    const merged = coalescer.offer(second);
    if (!(merged instanceof MoveCommand)) {
      throw new Error("expected a merged MoveCommand");
    }
    expect(merged.scene).toBe(sceneB);
    merged.do();
    expect(sceneB.findById("a")?.position).toEqual(vec2(4, 5));
    expect(sceneA.findById("a")?.position).toEqual(vec2(0, 0));
  });

  it("merges move commands with empty id lists", () => {
    const scene = new Scene();
    const first = new MoveCommand(scene, [], vec2(1, 1));
    const second = new MoveCommand(scene, [], vec2(2, 3));
    const coalescer = new Coalescer();
    coalescer.offer(first);
    const merged = coalescer.offer(second);
    if (!(merged instanceof MoveCommand)) {
      throw new Error("expected a merged MoveCommand");
    }
    expect(merged.objectIds).toEqual([]);
    expect(merged.delta).toEqual(vec2(3, 4));
  });

  it("does not merge when the id lists differ in order", () => {
    const scene = new Scene();
    const first = new MoveCommand(scene, ["a", "b"], vec2(1, 1));
    const second = new MoveCommand(scene, ["b", "a"], vec2(2, 2));
    const coalescer = new Coalescer();
    coalescer.offer(first);
    const result = coalescer.offer(second);
    expect(result).toBe(second);
    expect(coalescer.takePending()).toBe(second);
  });

  it("does not merge when the id lists differ in length", () => {
    const scene = new Scene();
    const first = new MoveCommand(scene, ["a"], vec2(1, 1));
    const second = new MoveCommand(scene, ["a", "b"], vec2(2, 2));
    const coalescer = new Coalescer();
    coalescer.offer(first);
    const result = coalescer.offer(second);
    expect(result).toBe(second);
    expect(coalescer.takePending()).toBe(second);
  });

  it("does not merge a non-move command onto a pending move command", () => {
    const scene = new Scene();
    const move = new MoveCommand(scene, ["a"], vec2(1, 1));
    const stub = new StubCommand();
    const coalescer = new Coalescer();
    coalescer.offer(move);
    const result = coalescer.offer(stub);
    expect(result).toBe(stub);
    expect(coalescer.takePending()).toBe(stub);
  });

  it("does not merge a move command onto a pending non-move command", () => {
    const scene = new Scene();
    const stub = new StubCommand();
    const move = new MoveCommand(scene, ["a"], vec2(1, 1));
    const coalescer = new Coalescer();
    coalescer.offer(stub);
    const result = coalescer.offer(move);
    expect(result).toBe(move);
    expect(coalescer.takePending()).toBe(move);
  });

  it("takePending returns the pending command without clearing it", () => {
    const scene = new Scene();
    const move = new MoveCommand(scene, ["a"], vec2(1, 1));
    const coalescer = new Coalescer();
    coalescer.offer(move);
    expect(coalescer.takePending()).toBe(move);
    expect(coalescer.takePending()).toBe(move);
  });

  it("takePending is null before anything was offered", () => {
    const coalescer = new Coalescer();
    expect(coalescer.takePending()).toBeNull();
  });

  it("reset drops the pending command", () => {
    const scene = new Scene();
    const first = new MoveCommand(scene, ["a"], vec2(3, 4));
    const second = new MoveCommand(scene, ["a"], vec2(1, 2));
    const coalescer = new Coalescer();
    coalescer.offer(first);
    coalescer.reset();
    expect(coalescer.takePending()).toBeNull();
    const result = coalescer.offer(second);
    expect(result).toBe(second);
  });

  it("merged undo restores the start after per-frame do()s (drag gesture)", () => {
    const scene = new Scene();
    scene.add(makeObject("shape-1", 10, 10));
    scene.add(makeStroke("stroke-1", [vec2(0, 0), vec2(6, 8)]));
    const ids = ["shape-1", "stroke-1"];
    const frame1 = new MoveCommand(scene, ids, vec2(2, 3));
    frame1.do();
    const frame2 = new MoveCommand(scene, ids, vec2(5, -1));
    frame2.do();
    const coalescer = new Coalescer();
    coalescer.offer(frame1);
    const merged = coalescer.offer(frame2);
    const history = new HistoryManager();
    history.push(merged);
    history.undo();
    expect(scene.findById("shape-1")?.position).toEqual(vec2(10, 10));
    const stroke = scene.findById("stroke-1");
    if (stroke === undefined || !isFreehandObject(stroke)) {
      throw new Error("expected the freehand stroke");
    }
    expect(stroke.position).toEqual(vec2(0, 0));
    expect(stroke.points).toEqual([vec2(0, 0), vec2(6, 8)]);
    history.redo();
    expect(scene.findById("shape-1")?.position).toEqual(vec2(17, 12));
    expect(scene.findById("stroke-1")?.position).toEqual(vec2(7, 2));
  });
});
