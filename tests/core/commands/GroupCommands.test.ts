/**
 * Unit tests for group/ungroup commands and the selection ops built on
 * them (AC2.5: group → move → ungroup keeps relative positions; every
 * action is one undo step).
 */
import { describe, expect, it } from "vitest";
import { Scene } from "@/core/model/Scene";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import { shapeFromRect } from "@/core/model/ShapeObject";
import { GroupCommand } from "@/core/commands/GroupCommands";
import { groupSelection, ungroupSelection } from "@/core/commands/SelectionOps";
import { MoveCommand } from "@/core/commands/MoveCommand";
import { expandGroupMemberIds } from "@/core/model/GroupObject";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { Selection } from "@/core/selection/Selection";
import { vec2 } from "@/core/geometry/Vec2";

/** Style bundle shared by every shape fixture. */
const STYLE = { fill: "accent", stroke: "token://stroke", strokeWidth: 2 };

/** Builds a rectangle shape fixture. */
function makeShape(id: string, x: number, y: number): ShapeObjectData {
  return shapeFromRect(
    { position: vec2(x, y), width: 80, height: 40 },
    "rectangle",
    STYLE,
    id,
    0,
  );
}

/** Builds a scene with two selected shapes a (0,0) and b (200,100). */
function makeFixture(): {
  scene: Scene;
  history: HistoryManager;
  selection: Selection;
  ids: IdGenerator;
} {
  const scene = new Scene();
  const history = new HistoryManager();
  const selection = new Selection();
  const ids = new IdGenerator("obj");
  scene.add(makeShape("a", 0, 0));
  scene.add(makeShape("b", 200, 100));
  selection.replaceAll(["a", "b"]);
  return { scene, history, selection, ids };
}

describe("GroupCommand", () => {
  it("wraps members: stamps parentId, adds the group entry (one step undo)", () => {
    const scene = new Scene();
    const a = makeShape("a", 0, 0);
    const b = makeShape("b", 200, 100);
    scene.add(a);
    scene.add(b);
    const group = { ...makeGroupData("g", ["a", "b"]) };
    const membersAfter = [
      { ...a, parentId: "g" },
      { ...b, parentId: "g" },
    ];
    const history = new HistoryManager();
    const command = new GroupCommand(scene, group, membersAfter, [a, b]);
    command.do();
    history.push(command);

    expect(scene.findById("a")?.parentId).toBe("g");
    expect(scene.findById("b")?.parentId).toBe("g");
    expect(scene.findById("g")?.kind).toBe("group");
    // Paint order of the members is unchanged (in-place replacement).
    expect(scene.objects.map((object) => object.id)).toEqual(["a", "b", "g"]);

    history.undo();
    expect(scene.findById("a")?.parentId).toBeUndefined();
    expect(scene.findById("g")).toBeUndefined();
    history.redo();
    expect(scene.findById("b")?.parentId).toBe("g");
  });

  it("group → move → ungroup keeps the members' relative positions (AC2.5)", () => {
    const { scene, history, selection, ids } = makeFixture();
    expect(groupSelection(scene, history, selection, ids)).toBe(true);
    expect(selection.size).toBe(1);

    // Move the group by (100, 50) — a MoveCommand over the expanded ids
    // (exactly what the select tool's move frames do).
    const groupId = [...selection.ids][0] as string;
    const group = scene.findById(groupId);
    if (group === undefined || group.kind !== "group") {
      throw new Error("group selection did not produce a group");
    }
    const move = new MoveCommand(
      scene,
      expandGroupMemberIds(scene, [groupId]),
      vec2(100, 50),
    );
    move.do();
    history.push(move);

    // Ungroup: members keep their absolute positions.
    expect(ungroupSelection(scene, history, selection)).toBe(true);
    const aAfter = scene.findById("a");
    const bAfter = scene.findById("b");
    if (aAfter === undefined || bAfter === undefined) {
      throw new Error("members vanished on ungroup");
    }
    expect(aAfter.position).toEqual(vec2(100, 50));
    expect(bAfter.position).toEqual(vec2(300, 150));
    // Relative position b−a = (200, 100) — unchanged from the fixture.
    expect(bAfter.position.x - aAfter.position.x).toBe(200);
    expect(bAfter.position.y - aAfter.position.y).toBe(100);
    expect([...selection.ids].sort()).toEqual(["a", "b"]);

    // Undo ungroup → group restored; undo move → back at the origin;
    // undo group → free members again.
    history.undo();
    expect(scene.findById(groupId)?.kind).toBe("group");
    history.undo();
    expect(scene.findById("a")?.position).toEqual(vec2(0, 0));
    history.undo();
    expect(scene.findById("a")?.parentId).toBeUndefined();
  });

  it("refuses to group fewer than two top-level objects", () => {
    const { scene, history, selection, ids } = makeFixture();
    selection.replaceAll(["a"]);
    expect(groupSelection(scene, history, selection, ids)).toBe(false);
    expect(history.canUndo()).toBe(false);
  });
});

describe("UngroupCommand", () => {
  it("dissolves the group and selects the released members (one step undo)", () => {
    const scene = new Scene();
    const history = new HistoryManager();
    const selection = new Selection();
    const a = makeShape("a", 0, 0);
    const b = makeShape("b", 200, 100);
    scene.add(a);
    scene.add(b);
    const group = makeGroupData("g", ["a", "b"]);
    scene.add({ ...a, parentId: "g" });
    scene.add({ ...b, parentId: "g" });
    scene.add(group);
    selection.replaceAll(["g"]);

    expect(ungroupSelection(scene, history, selection)).toBe(true);
    expect(scene.findById("g")).toBeUndefined();
    expect(scene.findById("a")?.parentId).toBeUndefined();
    expect([...selection.ids].sort()).toEqual(["a", "b"]);

    history.undo();
    expect(scene.findById("g")?.kind).toBe("group");
    expect(scene.findById("a")?.parentId).toBe("g");
    history.redo();
    expect(scene.findById("g")).toBeUndefined();
  });

  it("skips non-group selections without touching history", () => {
    const scene = new Scene();
    const history = new HistoryManager();
    const selection = new Selection();
    scene.add(makeShape("a", 0, 0));
    selection.replaceAll(["a"]);
    expect(ungroupSelection(scene, history, selection)).toBe(false);
    expect(history.canUndo()).toBe(false);
  });
});

/**
 * Builds a minimal group fixture data object.
 *
 * @param id - the group id.
 * @param childIds - the member ids.
 * @returns the group object data.
 */
function makeGroupData(id: string, childIds: readonly string[]) {
  return {
    id,
    kind: "group" as const,
    name: undefined,
    parentId: undefined,
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 5,
    visible: true,
    locked: false,
    childIds,
  };
}
