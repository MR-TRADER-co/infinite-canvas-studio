/**
 * Unit tests for the z-order planning and the shared selection ops
 * (AC2.4/AC2.5: every action is one undo step, groups behave as units).
 */
import { describe, expect, it } from "vitest";
import { Scene } from "@/core/model/Scene";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import { shapeFromRect } from "@/core/model/ShapeObject";
import { planZOrderAfter } from "@/core/commands/ZOrderOps";
import {
  deleteSelection,
  duplicateSelection,
  flushNudgeHistory,
  groupSelection,
  nudgeSelection,
  toggleLockSelection,
  ungroupSelection,
  zOrderSelection,
} from "@/core/commands/SelectionOps";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { Selection } from "@/core/selection/Selection";
import { isGroupObject } from "@/core/model/GroupObject";
import { vec2 } from "@/core/geometry/Vec2";

/** Style bundle shared by every shape fixture. */
const STYLE = { fill: "accent", stroke: "token://stroke", strokeWidth: 2 };

/** Builds a rectangle shape fixture. */
function makeShape(id: string, x: number, y: number): ShapeObjectData {
  return shapeFromRect(
    { position: vec2(x, y), width: 60, height: 40 },
    "rectangle",
    STYLE,
    id,
    0,
  );
}

/** Builds a scene with five stacked objects a..e and the services. */
function makeStacked(): {
  scene: Scene;
  history: HistoryManager;
  selection: Selection;
  ids: IdGenerator;
} {
  const scene = new Scene();
  const history = new HistoryManager();
  const selection = new Selection();
  const ids = new IdGenerator("obj");
  for (const [i, id] of ["a", "b", "c", "d", "e"].entries()) {
    scene.add(makeShape(id, i * 100, 0));
  }
  return { scene, history, selection, ids };
}

/** Paint-order ids of the scene. */
function order(scene: Scene): string[] {
  return scene.objects.map((object) => object.id);
}

describe("planZOrderAfter", () => {
  it("front appends the selection (internal order preserved)", () => {
    const { scene } = makeStacked();
    expect(planZOrderAfter(scene, ["a", "b"], "front")).toEqual([
      "c",
      "d",
      "e",
      "a",
      "b",
    ]);
  });

  it("back prepends the selection (internal order preserved)", () => {
    const { scene } = makeStacked();
    expect(planZOrderAfter(scene, ["d", "e"], "back")).toEqual([
      "d",
      "e",
      "a",
      "b",
      "c",
    ]);
  });

  it("forward steps the selection block past one unselected neighbour", () => {
    const { scene } = makeStacked();
    expect(planZOrderAfter(scene, ["b", "c"], "forward")).toEqual([
      "a",
      "d",
      "b",
      "c",
      "e",
    ]);
    expect(planZOrderAfter(scene, ["b", "d"], "forward")).toEqual([
      "a",
      "c",
      "b",
      "e",
      "d",
    ]);
  });

  it("backward steps the selection block past one unselected neighbour", () => {
    const { scene } = makeStacked();
    expect(planZOrderAfter(scene, ["c", "e"], "backward")).toEqual([
      "a",
      "c",
      "b",
      "e",
      "d",
    ]);
    expect(planZOrderAfter(scene, ["b", "c"], "backward")).toEqual([
      "b",
      "c",
      "a",
      "d",
      "e",
    ]);
  });

  it("plans nothing when the move is a no-op or the ids are unknown", () => {
    const { scene } = makeStacked();
    expect(planZOrderAfter(scene, ["a"], "backward")).toBeNull();
    expect(planZOrderAfter(scene, ["e"], "forward")).toBeNull();
    expect(planZOrderAfter(scene, [], "front")).toBeNull();
    expect(planZOrderAfter(scene, ["missing"], "front")).toBeNull();
    // Front of the top-most object is a no-op.
    expect(planZOrderAfter(scene, ["e"], "front")).toBeNull();
  });
});

describe("zOrderSelection (op layer)", () => {
  it("records one history entry and undoes/redoes exactly", () => {
    const { scene, history, selection } = makeStacked();
    selection.replaceAll(["a"]);
    expect(zOrderSelection(scene, history, selection, "front")).toBe(true);
    expect(order(scene)).toEqual(["b", "c", "d", "e", "a"]);
    history.undo();
    expect(order(scene)).toEqual(["a", "b", "c", "d", "e"]);
    history.redo();
    expect(order(scene)).toEqual(["b", "c", "d", "e", "a"]);
  });

  it("no-op orders never touch history", () => {
    const { scene, history, selection } = makeStacked();
    selection.replaceAll(["e"]);
    expect(zOrderSelection(scene, history, selection, "front")).toBe(false);
    expect(history.canUndo()).toBe(false);
  });
});

describe("toggleLockSelection", () => {
  it("locks when any object is unlocked, unlocks when all are locked", () => {
    const { scene, history, selection } = makeStacked();
    selection.replaceAll(["a", "b"]);
    expect(toggleLockSelection(scene, history, selection)).toBe(true);
    expect(scene.findById("a")?.locked).toBe(true);
    expect(scene.findById("b")?.locked).toBe(true);
    expect(toggleLockSelection(scene, history, selection)).toBe(true);
    expect(scene.findById("a")?.locked).toBe(false);
    // One entry per toggle.
    history.undo();
    expect(scene.findById("a")?.locked).toBe(true);
  });

  it("does nothing for an empty selection", () => {
    const { scene, history, selection } = makeStacked();
    expect(toggleLockSelection(scene, history, selection)).toBe(false);
    expect(history.canUndo()).toBe(false);
  });
});

describe("deleteSelection / duplicateSelection with groups", () => {
  it("deleting a group removes its members too (one entry)", () => {
    const { scene, history, selection, ids } = makeStacked();
    selection.replaceAll(["a", "b"]);
    expect(groupSelection(scene, history, selection, ids)).toBe(true);
    const groupId = [...selection.ids][0] as string;
    deleteSelection(scene, history, selection);
    expect(scene.findById(groupId)).toBeUndefined();
    expect(scene.findById("a")).toBeUndefined();
    expect(scene.findById("b")).toBeUndefined();
    expect(scene.objectCount).toBe(3);
    history.undo();
    expect(scene.findById("a")).toBeDefined();
    const restored = scene.findById(groupId);
    expect(restored !== undefined && isGroupObject(restored)).toBe(true);
  });

  it("duplicating a group copies the members with remapped membership", () => {
    const { scene, history, selection, ids } = makeStacked();
    selection.replaceAll(["a", "b"]);
    expect(groupSelection(scene, history, selection, ids)).toBe(true);

    const copies = duplicateSelection(scene, history, selection, ids);
    expect(copies).toHaveLength(1);
    const copyId = copies[0] as string;
    const copyGroup = scene.findById(copyId);
    if (copyGroup === undefined || !isGroupObject(copyGroup)) {
      throw new Error("duplicate did not produce a group copy");
    }
    expect(copyGroup.childIds).toHaveLength(2);
    // The member copies carry remapped parentId and the offset position.
    const aCopy = scene.findById(copyGroup.childIds[0] as string);
    if (aCopy === undefined) {
      throw new Error("first member copy missing");
    }
    expect(aCopy.parentId).toBe(copyId);
    expect(aCopy.position).toEqual(vec2(16, 16));
    // One undo step removes the whole copy (group + members).
    history.undo();
    expect(scene.findById(copyId)).toBeUndefined();
    expect(scene.objectCount).toBe(6);
  });

  it("duplicate selects the copies", () => {
    const { scene, history, selection, ids } = makeStacked();
    selection.replaceAll(["a"]);
    const copies = duplicateSelection(scene, history, selection, ids);
    expect([...selection.ids]).toEqual(copies);
    expect(scene.findById("a")?.position).toEqual(vec2(0, 0));
    expect(scene.findById(copies[0] as string)?.position).toEqual(vec2(16, 16));
  });
});

describe("nudgeSelection", () => {
  it("moves group members with the group and coalesces bursts (one entry)", () => {
    const { scene, history, selection, ids } = makeStacked();
    selection.replaceAll(["a", "b"]);
    expect(groupSelection(scene, history, selection, ids)).toBe(true);
    const groupId = [...selection.ids][0] as string;

    nudgeSelection(scene, history, selection, 1, 0);
    nudgeSelection(scene, history, selection, 0, 1);
    nudgeSelection(scene, history, selection, 1, 0);
    // The burst applies live but stays out of history until the flush —
    // the only entry so far is the grouping above.
    expect(scene.findById("a")?.position).toEqual(vec2(2, 1));
    flushNudgeHistory(history);
    expect(history.canUndo()).toBe(true);
    // All members moved by the summed delta (2, 1) in world units.
    expect(scene.findById("a")?.position).toEqual(vec2(2, 1));
    expect(scene.findById("b")?.position).toEqual(vec2(102, 1));
    // Undo (burst, then group) restores the exact pre-gesture state.
    history.undo();
    expect(scene.findById("a")?.position).toEqual(vec2(0, 0));
    expect(scene.findById("b")?.position).toEqual(vec2(100, 0));
    history.undo();
    expect(scene.findById("a")?.parentId).toBeUndefined();
    expect(scene.findById("b")?.parentId).toBeUndefined();
    expect(scene.findById(groupId)).toBeUndefined();
    expect(history.canUndo()).toBe(false);
  });

  it("ungroup after a grouped nudge keeps the moved positions", () => {
    const { scene, history, selection, ids } = makeStacked();
    selection.replaceAll(["a", "b"]);
    groupSelection(scene, history, selection, ids);
    nudgeSelection(scene, history, selection, 10, 0);
    flushNudgeHistory(history);
    expect(ungroupSelection(scene, history, selection)).toBe(true);
    expect(scene.findById("a")?.position).toEqual(vec2(10, 0));
    expect(scene.findById("b")?.position).toEqual(vec2(110, 0));
  });
});

describe("nudgeSelection lock contract", () => {
  it("skips locked members and moves only the unlocked ones", () => {
    const { scene, history, selection } = makeStacked();
    const aObj = scene.findById("a");
    if (aObj === undefined) {
      throw new Error("fixture missing");
    }
    scene.add({ ...aObj, locked: true });
    selection.replaceAll(["a", "b"]);
    nudgeSelection(scene, history, selection, 1, 0);
    flushNudgeHistory(history);
    expect(scene.findById("a")?.position).toEqual(vec2(0, 0));
    expect(scene.findById("b")?.position).toEqual(vec2(101, 0));
    history.undo();
    expect(scene.findById("b")?.position).toEqual(vec2(100, 0));
  });

  it("no-ops when every member is locked", () => {
    const { scene, history, selection } = makeStacked();
    const aObj = scene.findById("a");
    if (aObj === undefined) {
      throw new Error("fixture missing");
    }
    scene.add({ ...aObj, locked: true });
    selection.replaceAll(["a"]);
    nudgeSelection(scene, history, selection, 1, 0);
    flushNudgeHistory(history);
    expect(history.canUndo()).toBe(false);
    expect(scene.findById("a")?.position).toEqual(vec2(0, 0));
  });
});
