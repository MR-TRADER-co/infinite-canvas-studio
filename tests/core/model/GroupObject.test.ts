/**
 * Unit tests for the group object model (AC2.5): derived bounds, member
 * expansion, top-level resolution and transform propagation.
 */
import { describe, expect, it } from "vitest";
import { Scene } from "@/core/model/Scene";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import { shapeFromRect } from "@/core/model/ShapeObject";
import {
  expandGroupMemberIds,
  groupWorldBBox,
  isGroupObject,
  makeGroup,
  resolveTopLevelId,
  rotateObjectsAround,
  worldBBoxOf,
  type GroupObjectData,
} from "@/core/model/GroupObject";
import { objectBBox, rotatedObjectBBox } from "@/core/model/SceneObject";
import { bbox } from "@/core/geometry/BBox";
import { vec2 } from "@/core/geometry/Vec2";

/** Style bundle shared by every shape fixture. */
const STYLE = { fill: "accent", stroke: "token://stroke", strokeWidth: 2 };

/** Builds a rectangle shape fixture at the given rect. */
function makeShape(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): ShapeObjectData {
  return shapeFromRect(
    { position: vec2(x, y), width, height },
    "rectangle",
    STYLE,
    id,
    0,
  );
}

/** Builds a two-member scene and returns it with the member ids. */
function makeGroupedScene(): {
  scene: Scene;
  group: GroupObjectData;
  a: ShapeObjectData;
  b: ShapeObjectData;
} {
  const scene = new Scene();
  const a = makeShape("a", 0, 0, 100, 50);
  const b = makeShape("b", 200, 100, 60, 60);
  scene.add(a);
  scene.add(b);
  const group = makeGroup("g", [a, b], 5);
  scene.add({ ...a, parentId: "g" });
  scene.add({ ...b, parentId: "g" });
  scene.add(group);
  return {
    scene,
    group,
    a: { ...a, parentId: "g" },
    b: { ...b, parentId: "g" },
  };
}

describe("GroupObject", () => {
  it("detects group objects", () => {
    expect(isGroupObject(makeGroup("g", [], 0))).toBe(true);
    expect(isGroupObject(makeShape("s", 0, 0, 10, 10))).toBe(false);
  });

  it("makeGroup derives the union origin and keeps child order", () => {
    const a = makeShape("a", 0, 0, 100, 50);
    const b = makeShape("b", 200, 100, 60, 60);
    const group = makeGroup("g", [a, b], 7);
    expect(group.childIds).toEqual(["a", "b"]);
    // Shape bboxes are padded by strokeWidth/2: a → −1..101 × −1..51,
    // b → 199..261 × 99..161. Union = (−1, −1)–(261, 161).
    expect(group.position).toEqual(vec2(-1, -1));
    expect(group.zIndex).toBe(7);
    expect(group.rotation).toBe(0);
  });

  it("groupWorldBBox is the live union of the member bounds (AC2.5)", () => {
    const { scene, group } = makeGroupedScene();
    expect(groupWorldBBox(scene, group)).toEqual(bbox(-1, -1, 261, 161));
    // Moving a member moves the union (bounds derive from the live data).
    const a = scene.findById("a");
    if (a === undefined) {
      throw new Error("fixture member missing");
    }
    scene.add({ ...a, position: vec2(400, 0) });
    expect(groupWorldBBox(scene, group)).toEqual(bbox(199, -1, 501, 161));
  });

  it("an empty group collapses to its own position point", () => {
    const scene = new Scene();
    const group = makeGroup("g", [], 0);
    scene.add(group);
    expect(groupWorldBBox(scene, group)).toEqual(bbox(0, 0, 0, 0));
  });

  it("worldBBoxOf covers rotated members through the union", () => {
    const scene = new Scene();
    const a = { ...makeShape("a", 0, 0, 100, 20), rotation: Math.PI / 2 };
    scene.add(a);
    // A 102×22 padded box rotated 90° covers a 22×102 box centred on
    // (50, 10): [39,61] × [−41,61].
    expect(rotatedObjectBBox(a)).toEqual(bbox(39, -41, 61, 61));
    const group = makeGroup("g", [a], 1);
    scene.add({ ...a, parentId: "g" });
    scene.add(group);
    expect(worldBBoxOf(scene, group)).toEqual(bbox(39, -41, 61, 61));
    expect(worldBBoxOf(scene, a)).toEqual(bbox(39, -41, 61, 61));
  });

  it("resolveTopLevelId walks parentId chains and stops at missing parents", () => {
    const { scene } = makeGroupedScene();
    expect(resolveTopLevelId(scene, "a")).toBe("g");
    expect(resolveTopLevelId(scene, "g")).toBe("g");
    // Nested group: child → inner group → outer group (walks the chain).
    const inner = makeGroup("inner", [], 6);
    scene.add(inner);
    scene.add({ ...makeShape("a2", 500, 500, 10, 10), parentId: "inner" });
    const outer = makeGroup("outer", [inner], 8);
    scene.add(outer);
    scene.add({ ...inner, parentId: "outer" });
    expect(resolveTopLevelId(scene, "a2")).toBe("outer");
    expect(resolveTopLevelId(scene, "inner")).toBe("outer");
    expect(resolveTopLevelId(scene, "outer")).toBe("outer");
    // Orphaned parentId (an undone group command) resolves to the child.
    scene.remove("g");
    expect(resolveTopLevelId(scene, "a")).toBe("a");
  });

  it("expandGroupMemberIds includes the group and its members (dedup, order)", () => {
    const { scene } = makeGroupedScene();
    const free = makeShape("free", 900, 900, 10, 10);
    scene.add(free);
    expect(expandGroupMemberIds(scene, ["g", "free"])).toEqual([
      "g",
      "a",
      "b",
      "free",
    ]);
    // Ids not present pass through untouched.
    expect(expandGroupMemberIds(scene, ["missing"])).toEqual(["missing"]);
    // Duplicated input collapses.
    expect(expandGroupMemberIds(scene, ["g", "g"])).toEqual(["g", "a", "b"]);
  });

  it("rotateObjectsAround orbits centres and advances own rotation (AC2.5)", () => {
    const a = makeShape("a", 0, 0, 100, 20);
    // Centre of the padded box (−1..101 × −1..21) = (50, 10).
    const pivot = vec2(0, 0);
    const [rotated] = rotateObjectsAround([a], pivot, Math.PI / 2);
    if (rotated === undefined) {
      throw new Error("rotateObjectsAround returned no object");
    }
    expect(rotated.rotation).toBeCloseTo(Math.PI / 2, 12);
    // The centre (50,10) rotated 90° around the origin maps to (−10, 50)
    // (y-down convention: (x,y)→(−y,x)).
    const rotatedBox = objectBBox(rotated);
    expect((rotatedBox.minX + rotatedBox.maxX) / 2).toBeCloseTo(-10, 9);
    expect((rotatedBox.minY + rotatedBox.maxY) / 2).toBeCloseTo(50, 9);
    // Size is preserved (rigid rotation).
    expect(rotatedBox.maxX - rotatedBox.minX).toBeCloseTo(102, 9);
    expect(rotatedBox.maxY - rotatedBox.minY).toBeCloseTo(22, 9);
  });

  it("rotateObjectsAround rotates a group's members around one shared pivot", () => {
    const { scene, group, a, b } = makeGroupedScene();
    const union = groupWorldBBox(scene, group);
    const pivot = vec2(
      (union.minX + union.maxX) / 2,
      (union.minY + union.maxY) / 2,
    );
    const before = [group, a, b];
    const delta = Math.PI / 4;
    const after = rotateObjectsAround(before, pivot, delta);
    // Every member advances its rotation by delta.
    for (const object of after) {
      expect(object.rotation).toBeCloseTo(delta, 12);
    }
    // Rigid rotation: every member's bounds centre keeps its exact pivot
    // distance, and the whole set is applied to the scene consistently.
    const distances = [a, b].map((member) => {
      const box = objectBBox(member);
      return Math.hypot(
        (box.minX + box.maxX) / 2 - pivot.x,
        (box.minY + box.maxY) / 2 - pivot.y,
      );
    });
    for (const object of after) {
      scene.add(object);
    }
    const members = after.filter((object) => object.id !== group.id);
    for (const [index, member] of members.entries()) {
      const box = objectBBox(member);
      const distance = Math.hypot(
        (box.minX + box.maxX) / 2 - pivot.x,
        (box.minY + box.maxY) / 2 - pivot.y,
      );
      expect(distance).toBeCloseTo(distances[index] ?? distance, 9);
    }
  });

  it("rotating a member around the group centre keeps the member's size", () => {
    const a = makeShape("a", 0, 0, 100, 20);
    const [rotated] = rotateObjectsAround([a], vec2(-500, -500), Math.PI / 6);
    if (rotated === undefined) {
      throw new Error("no rotated object");
    }
    const box = objectBBox(rotated);
    expect(box.maxX - box.minX).toBeCloseTo(102, 9);
    expect(box.maxY - box.minY).toBeCloseTo(22, 9);
  });
});
