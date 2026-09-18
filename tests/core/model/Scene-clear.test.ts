/** Unit tests for Scene.clear() (document reset / project-load semantics). */
import { describe, expect, it, vi } from "vitest";
import { Selection } from "@/core/selection/Selection";
import { Scene } from "@/core/model/Scene";
import { vec2 } from "@/core/geometry/Vec2";
import type {
  SceneObjectData,
  SceneObjectKind,
} from "@/core/model/SceneObject";

/** Builds a minimal scene-object fixture with the given id and z-index. */
function makeObject(
  id: string,
  zIndex: number,
  kind: SceneObjectKind = "shape",
): SceneObjectData {
  return {
    id,
    kind,
    position: vec2(0, 0),
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
  };
}

describe("Scene.clear", () => {
  it("removes every object and bumps the revision exactly once", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    scene.add(makeObject("b", 1));
    scene.add(makeObject("c", 2));
    const revisionBefore = scene.revision;
    scene.clear();
    expect(scene.objectCount).toBe(0);
    expect(scene.objects).toHaveLength(0);
    expect(scene.findById("a")).toBeUndefined();
    expect(scene.findById("b")).toBeUndefined();
    expect(scene.revision).toBe(revisionBefore + 1);
  });

  it("notifies onChange exactly once for a populated scene", () => {
    const onChange = vi.fn();
    const scene = new Scene(undefined, undefined, onChange);
    scene.add(makeObject("a", 0));
    scene.add(makeObject("b", 1));
    onChange.mockClear();
    scene.clear();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("prunes every cleared object id from the scene selection", () => {
    const selection = new Selection();
    const scene = new Scene(undefined, selection);
    scene.add(makeObject("a", 0));
    scene.add(makeObject("b", 1));
    scene.add(makeObject("c", 2));
    scene.selection.addMany(["a", "b", "c"]);
    expect(scene.selection.size).toBe(3);
    scene.clear();
    expect(scene.selection.isEmpty()).toBe(true);
    expect(scene.selection.has("a")).toBe(false);
    expect(scene.selection.has("b")).toBe(false);
    expect(scene.selection.has("c")).toBe(false);
  });

  it("leaves selection ids of non-scene objects untouched", () => {
    const selection = new Selection();
    const scene = new Scene(undefined, selection);
    scene.add(makeObject("a", 0));
    scene.selection.addMany(["a", "ghost"]);
    scene.clear();
    expect(scene.selection.has("a")).toBe(false);
    expect(scene.selection.has("ghost")).toBe(true);
  });

  it("is a no-op on an empty scene (no revision bump, no notify)", () => {
    const onChange = vi.fn();
    const scene = new Scene(undefined, undefined, onChange);
    scene.clear();
    expect(scene.objectCount).toBe(0);
    expect(scene.revision).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is a no-op when called twice in a row", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    scene.clear();
    const revisionBefore = scene.revision;
    scene.clear();
    expect(scene.revision).toBe(revisionBefore);
    expect(scene.objectCount).toBe(0);
  });

  it("mutates safely without an onChange notifier", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    expect(() => scene.clear()).not.toThrow();
    expect(scene.objectCount).toBe(0);
  });

  it("supports repopulating the scene via add() after clear", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    scene.add(makeObject("b", 1));
    scene.clear();
    const c = makeObject("c", 5);
    const d = makeObject("d", 6);
    scene.add(c);
    scene.add(d);
    expect(scene.objectCount).toBe(2);
    expect(scene.objects).toEqual([c, d]);
    expect(scene.findById("c")).toBe(c);
    expect(scene.findById("d")).toBe(d);
    expect(scene.nextZIndex()).toBe(7);
  });
});
