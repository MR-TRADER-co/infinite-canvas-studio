/** Unit tests for the object-removal command. */
import { describe, expect, it } from "vitest";
import { RemoveObjectCommand } from "@/core/commands/RemoveObjectCommand";
import { HistoryManager } from "@/core/history/HistoryManager";
import { Scene } from "@/core/model/Scene";
import { vec2 } from "@/core/geometry/Vec2";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Builds a minimal shape fixture with the given id and z-index. */
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

describe("RemoveObjectCommand", () => {
  it("carries the removeObject label and stores its scene and object", () => {
    const scene = new Scene();
    const object = makeObject("obj-1", 0);
    const command = new RemoveObjectCommand(scene, object);
    expect(command.label).toBe("command.removeObject");
    expect(command.scene).toBe(scene);
    expect(command.object).toBe(object);
  });

  it("do removes the object from the scene", () => {
    const scene = new Scene();
    const object = makeObject("obj-1", 0);
    scene.add(object);
    new RemoveObjectCommand(scene, object).do();
    expect(scene.findById("obj-1")).toBeUndefined();
    expect(scene.objectCount).toBe(0);
  });

  it("undo re-inserts the exact stored object data", () => {
    const scene = new Scene();
    const object = makeObject("obj-1", 4);
    const command = new RemoveObjectCommand(scene, object);
    scene.add(object);
    command.do();
    command.undo();
    expect(scene.findById("obj-1")).toBe(object);
    expect(scene.objectCount).toBe(1);
  });

  it("redo removes the object again after an undo", () => {
    const scene = new Scene();
    const object = makeObject("obj-1", 0);
    const command = new RemoveObjectCommand(scene, object);
    scene.add(object);
    command.do();
    command.undo();
    command.redo();
    expect(scene.findById("obj-1")).toBeUndefined();
    expect(scene.objectCount).toBe(0);
  });

  it("removes only the targeted object among many", () => {
    const scene = new Scene();
    const a = makeObject("a", 0);
    const b = makeObject("b", 1);
    const c = makeObject("c", 2);
    scene.add(a);
    scene.add(b);
    scene.add(c);
    const command = new RemoveObjectCommand(scene, b);
    command.do();
    expect(scene.objectCount).toBe(2);
    expect(scene.findById("b")).toBeUndefined();
    expect(scene.findById("a")).toBe(a);
    expect(scene.findById("c")).toBe(c);
    command.undo();
    expect(scene.objectCount).toBe(3);
    expect(scene.findById("b")).toBe(b);
  });

  it("round-trips through the history manager", () => {
    const scene = new Scene();
    const object = makeObject("obj-1", 0);
    scene.add(object);
    const command = new RemoveObjectCommand(scene, object);
    command.do();
    const history = new HistoryManager();
    history.push(command);
    history.undo();
    expect(scene.findById("obj-1")).toBe(object);
    history.redo();
    expect(scene.findById("obj-1")).toBeUndefined();
  });
});
