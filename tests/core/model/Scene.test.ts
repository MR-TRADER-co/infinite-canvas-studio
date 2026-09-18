/** Unit tests for the scene-graph root model. */
import { describe, expect, it, vi } from "vitest";
import { Camera } from "@/core/camera/Camera";
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

describe("Scene", () => {
  it("creates a default camera and selection", () => {
    const scene = new Scene();
    expect(scene.camera).toBeInstanceOf(Camera);
    expect(scene.selection).toBeInstanceOf(Selection);
    expect(scene.objectCount).toBe(0);
    expect(scene.revision).toBe(0);
    expect(scene.nextZIndex()).toBe(0);
  });

  it("accepts an explicit camera and an undefined selection argument", () => {
    const camera = new Camera(1, 2, 3, 0.5);
    const onChange = vi.fn();
    const scene = new Scene(camera, undefined, onChange);
    expect(scene.camera).toBe(camera);
    expect(scene.selection).toBeInstanceOf(Selection);
    expect(onChange).not.toHaveBeenCalled();
    scene.add(makeObject("a", 0));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("add appends objects and exposes them in insertion order", () => {
    const scene = new Scene();
    const a = makeObject("a", 0);
    const b = makeObject("b", 1);
    scene.add(a);
    scene.add(b);
    expect(scene.objectCount).toBe(2);
    expect(scene.objects[0]).toBe(a);
    expect(scene.objects[1]).toBe(b);
  });

  it("objects is a live read-only view of the object list", () => {
    const scene = new Scene();
    const a = makeObject("a", 0);
    scene.add(a);
    const view = scene.objects;
    scene.add(makeObject("b", 1));
    expect(view).toHaveLength(2);
    scene.remove("a");
    expect(view).toHaveLength(1);
    expect(view[0]?.id).toBe("b");
  });

  it("add with an existing id replaces the object in place", () => {
    const scene = new Scene();
    const a = makeObject("a", 0);
    const b = makeObject("b", 1);
    scene.add(a);
    scene.add(b);
    const replacement = makeObject("a", 5);
    scene.add(replacement);
    expect(scene.objectCount).toBe(2);
    expect(scene.objects[0]).toBe(replacement);
    expect(scene.objects[1]).toBe(b);
    expect(scene.findById("a")).toBe(replacement);
  });

  it("findById locates objects by id", () => {
    const scene = new Scene();
    const a = makeObject("a", 0);
    scene.add(a);
    expect(scene.findById("a")).toBe(a);
    expect(scene.findById("missing")).toBeUndefined();
  });

  it("remove deletes the object and reports success", () => {
    const scene = new Scene();
    const a = makeObject("a", 0);
    const b = makeObject("b", 1);
    scene.add(a);
    scene.add(b);
    expect(scene.remove("a")).toBe(true);
    expect(scene.objectCount).toBe(1);
    expect(scene.findById("a")).toBeUndefined();
    expect(scene.findById("b")).toBe(b);
  });

  it("remove of a missing id reports false without mutating", () => {
    const onChange = vi.fn();
    const scene = new Scene(undefined, undefined, onChange);
    scene.add(makeObject("a", 0));
    onChange.mockClear();
    const revisionBefore = scene.revision;
    expect(scene.remove("nope")).toBe(false);
    expect(scene.objectCount).toBe(1);
    expect(scene.revision).toBe(revisionBefore);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("revision bumps on add, replace and remove", () => {
    const scene = new Scene();
    expect(scene.revision).toBe(0);
    scene.add(makeObject("a", 0));
    expect(scene.revision).toBe(1);
    scene.add(makeObject("a", 1));
    expect(scene.revision).toBe(2);
    scene.remove("a");
    expect(scene.revision).toBe(3);
  });

  it("nextZIndex is 0 for an empty scene", () => {
    const scene = new Scene();
    expect(scene.nextZIndex()).toBe(0);
  });

  it("nextZIndex is one above the current maximum z-index", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    scene.add(makeObject("b", 7));
    scene.add(makeObject("c", 3));
    expect(scene.nextZIndex()).toBe(8);
  });

  it("nextZIndex ignores removed objects", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 9));
    scene.add(makeObject("b", 2));
    scene.remove("a");
    expect(scene.nextZIndex()).toBe(3);
  });

  it("notifies exactly once per mutation", () => {
    const onChange = vi.fn();
    const scene = new Scene(undefined, undefined, onChange);
    scene.add(makeObject("a", 0));
    scene.add(makeObject("a", 1));
    scene.remove("a");
    scene.remove("missing");
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("mutates safely without an onChange notifier", () => {
    const scene = new Scene();
    expect(() => {
      scene.add(makeObject("a", 0));
      scene.remove("a");
    }).not.toThrow();
    expect(scene.objectCount).toBe(0);
  });

  it("accepts objects of every scene-object kind", () => {
    const kinds: SceneObjectKind[] = [
      "shape",
      "textBox",
      "stickyNote",
      "image",
      "connector",
      "freehand",
      "group",
    ];
    const scene = new Scene();
    for (const kind of kinds) {
      scene.add(makeObject(`obj-${kind}`, 0, kind));
    }
    expect(scene.objectCount).toBe(kinds.length);
  });
});

describe("Scene.moveObjectTo", () => {
  it("moves an object to the target index in the paint order", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    scene.add(makeObject("b", 1));
    scene.add(makeObject("c", 2));
    const revisionBefore = scene.revision;
    expect(scene.moveObjectTo("a", 2)).toBe(true);
    expect(scene.objects.map((object) => object.id)).toEqual(["b", "c", "a"]);
    expect(scene.objectCount).toBe(3);
    expect(scene.revision).toBe(revisionBefore + 1);
  });

  it("clamps negative target indices to the first position", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    scene.add(makeObject("b", 1));
    scene.add(makeObject("c", 2));
    expect(scene.moveObjectTo("c", -10)).toBe(true);
    expect(scene.objects.map((object) => object.id)).toEqual(["c", "a", "b"]);
  });

  it("clamps oversized target indices to the last position", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    scene.add(makeObject("b", 1));
    scene.add(makeObject("c", 2));
    expect(scene.moveObjectTo("a", 99)).toBe(true);
    expect(scene.objects.map((object) => object.id)).toEqual(["b", "c", "a"]);
  });

  it("returns false without bumping the revision when the target equals the current index", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    scene.add(makeObject("b", 1));
    scene.add(makeObject("c", 2));
    const revisionBefore = scene.revision;
    expect(scene.moveObjectTo("b", 1)).toBe(false);
    expect(scene.revision).toBe(revisionBefore);
    expect(scene.objects.map((object) => object.id)).toEqual(["a", "b", "c"]);
    // A single-object scene always targets its own index.
    const lonely = new Scene();
    lonely.add(makeObject("solo", 0));
    const lonelyRevision = lonely.revision;
    expect(lonely.moveObjectTo("solo", 0)).toBe(false);
    expect(lonely.revision).toBe(lonelyRevision);
  });

  it("returns false for an unknown id without mutating the scene", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    scene.add(makeObject("b", 1));
    const revisionBefore = scene.revision;
    expect(scene.moveObjectTo("ghost", 1)).toBe(false);
    expect(scene.revision).toBe(revisionBefore);
    expect(scene.objectCount).toBe(2);
    expect(scene.objects.map((object) => object.id)).toEqual(["a", "b"]);
  });

  it("keeps the moved object's data and reference unchanged", () => {
    const scene = new Scene();
    scene.add(makeObject("a", 0));
    const b = makeObject("b", 1);
    scene.add(b);
    scene.add(makeObject("c", 2));
    scene.moveObjectTo("b", 0);
    expect(scene.objects[0]).toBe(b);
    expect(scene.findById("b")).toBe(b);
    expect(b.position).toEqual(vec2(0, 0));
    expect(b.zIndex).toBe(1);
  });
});
