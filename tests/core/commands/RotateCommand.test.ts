/**
 * Unit tests for the rotate command's undo/redo sequences (AC2.4/AC2.8).
 */
import { describe, expect, it } from "vitest";
import { Scene } from "@/core/model/Scene";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import { shapeFromRect } from "@/core/model/ShapeObject";
import { RotateCommand } from "@/core/commands/RotateCommand";
import { HistoryManager } from "@/core/history/HistoryManager";
import { vec2 } from "@/core/geometry/Vec2";

/** Style bundle shared by every shape fixture. */
const STYLE = { fill: "accent", stroke: "token://stroke", strokeWidth: 2 };

/** Builds a rectangle shape fixture. */
function makeShape(id: string, x: number, y: number): ShapeObjectData {
  return shapeFromRect(
    { position: vec2(x, y), width: 100, height: 40 },
    "rectangle",
    STYLE,
    id,
    0,
  );
}

describe("RotateCommand", () => {
  it("applies the after snapshots and restores the before ones on undo", () => {
    const scene = new Scene();
    const before = makeShape("a", 0, 0);
    scene.add(before);
    const after = { ...before, rotation: Math.PI / 3, position: vec2(12, -8) };
    const command = new RotateCommand(scene, [before], [after]);

    command.do();
    expect(scene.findById("a")?.rotation).toBeCloseTo(Math.PI / 3, 12);
    expect(scene.findById("a")?.position).toEqual(vec2(12, -8));

    command.undo();
    expect(scene.findById("a")?.rotation).toBe(0);
    expect(scene.findById("a")?.position).toEqual(vec2(0, 0));

    command.redo();
    expect(scene.findById("a")?.rotation).toBeCloseTo(Math.PI / 3, 12);
  });

  it("is exact across long undo/redo cycles (snapshot semantics)", () => {
    const scene = new Scene();
    const before = makeShape("a", 5, 5);
    scene.add(before);
    const after = { ...before, rotation: -2.4, position: vec2(-50, 17) };
    const command = new RotateCommand(scene, [before], [after]);
    command.do();
    for (let i = 0; i < 10; i += 1) {
      command.undo();
      command.redo();
    }
    command.undo();
    expect(scene.findById("a")).toEqual(before);
  });

  it("rotates several objects as one history entry", () => {
    const scene = new Scene();
    const a = makeShape("a", 0, 0);
    const b = makeShape("b", 200, 0);
    scene.add(a);
    scene.add(b);
    const rotated = [
      { ...a, rotation: Math.PI / 2 },
      { ...b, rotation: Math.PI / 2 },
    ];
    const history = new HistoryManager();
    const command = new RotateCommand(scene, [a, b], rotated);
    command.do();
    history.push(command);

    expect(history.undo()).not.toBeNull();
    expect(scene.findById("a")?.rotation).toBe(0);
    expect(scene.findById("b")?.rotation).toBe(0);
    expect(history.redo()).not.toBeNull();
    expect(scene.findById("b")?.rotation).toBeCloseTo(Math.PI / 2, 12);
  });

  it("skips objects removed in the meantime (the MoveCommand convention)", () => {
    const scene = new Scene();
    const a = makeShape("a", 0, 0);
    const before = [a];
    scene.add(a);
    const after = [{ ...a, rotation: 1 }];
    const command = new RotateCommand(scene, before, after);
    scene.remove("a");
    expect(() => command.undo()).not.toThrow();
    expect(scene.findById("a")).toBeUndefined();
  });
});
