/** Unit tests for the object-insertion command. */
import { describe, expect, it } from "vitest";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import { Scene } from "@/core/model/Scene";
import { vec2 } from "@/core/geometry/Vec2";
import type { FreehandObjectData } from "@/core/model/FreehandObject";
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

describe("AddObjectCommand", () => {
  it("carries the addObject label and stores its scene and object", () => {
    const scene = new Scene();
    const object = makeObject("obj-1", 0);
    const command = new AddObjectCommand(scene, object);
    expect(command.label).toBe("command.addObject");
    expect(command.scene).toBe(scene);
    expect(command.object).toBe(object);
  });

  it("do inserts the object into the scene", () => {
    const scene = new Scene();
    const object = makeObject("obj-1", 0);
    new AddObjectCommand(scene, object).do();
    expect(scene.findById("obj-1")).toBe(object);
    expect(scene.objectCount).toBe(1);
  });

  it("undo removes the inserted object again", () => {
    const scene = new Scene();
    const object = makeObject("obj-1", 0);
    const command = new AddObjectCommand(scene, object);
    command.do();
    command.undo();
    expect(scene.findById("obj-1")).toBeUndefined();
    expect(scene.objectCount).toBe(0);
  });

  it("redo re-inserts the object after an undo", () => {
    const scene = new Scene();
    const object = makeObject("obj-1", 0);
    const command = new AddObjectCommand(scene, object);
    command.do();
    command.undo();
    command.redo();
    expect(scene.findById("obj-1")).toBe(object);
    expect(scene.objectCount).toBe(1);
  });

  it("do/undo/redo round-trips leave the scene empty in between", () => {
    const scene = new Scene();
    const first = new AddObjectCommand(scene, makeObject("obj-1", 0));
    const second = new AddObjectCommand(scene, makeObject("obj-2", 1));
    first.do();
    second.do();
    expect(scene.objectCount).toBe(2);
    first.undo();
    second.undo();
    expect(scene.objectCount).toBe(0);
    first.redo();
    second.redo();
    expect(scene.objectCount).toBe(2);
    expect(scene.findById("obj-1")).toBeDefined();
    expect(scene.findById("obj-2")).toBeDefined();
  });

  it("also carries freehand stroke objects", () => {
    const scene = new Scene();
    const stroke: FreehandObjectData = {
      id: "stroke-1",
      kind: "freehand",
      position: vec2(10, 20),
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      points: [vec2(10, 20), vec2(15, 25)],
      strokeColor: "#0ea5e9",
      strokeWidth: 2,
      strokeStyle: "solid",
    };
    const command = new AddObjectCommand(scene, stroke);
    command.do();
    expect(scene.findById("stroke-1")).toBe(stroke);
    command.undo();
    expect(scene.findById("stroke-1")).toBeUndefined();
    command.redo();
    expect(scene.findById("stroke-1")).toBe(stroke);
  });
});
