/**
 * Unit tests for `togglePinSelection` (فاز ۲۵ «سنجاش روی صفحه»):
 * pinning stamps the anchor of the CURRENT on-screen spot, unpinning
 * lands the world position under the anchor (MoveCommand + flag clear),
 * mixed selections pin when ANY member is free, world-attached kinds are
 * skipped — and every toggle is ONE history entry that undoes exactly.
 */
import { describe, expect, it } from "vitest";
import { HistoryManager } from "@/core/history/HistoryManager";
import { Scene } from "@/core/model/Scene";
import { Selection } from "@/core/selection/Selection";
import { vec2 } from "@/core/geometry/Vec2";
import {
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN,
  type ShapeObjectData,
} from "@/core/model/ShapeObject";
import { togglePinSelection } from "@/core/commands/SelectionOps";
import { isPinnedObject } from "@/core/model/Pinned";

/** Builds a TOP-LEVEL shape fixture. */
function makeShape(
  id: string,
  x: number,
  y: number,
  width = 50,
  height = 40,
): ShapeObjectData {
  return {
    id,
    kind: "shape",
    name: undefined,
    parentId: undefined,
    position: vec2(x, y),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    shapeKind: "rectangle",
    width,
    height,
    fill: SHAPE_FILL_TOKEN,
    stroke: STROKE_COLOR_TOKEN,
    strokeWidth: 0,
  };
}

/** Everything a toggle needs, over real production classes. */
function makeHarness(objects: readonly ShapeObjectData[]) {
  const scene = new Scene();
  for (const object of objects) {
    scene.add(object);
  }
  const history = new HistoryManager();
  const selection = new Selection();
  return { scene, history, selection };
}

const VIEWPORT = { width: 1000, height: 600 };

describe("togglePinSelection", () => {
  it("pins at the object's current on-screen spot", () => {
    const { scene, history, selection } = makeHarness([
      makeShape("a", 100, 80),
    ]);
    // Camera anchored so world (100,80) sits at screen (250,200).
    scene.camera.x = 0;
    scene.camera.y = 0;
    scene.camera.zoom = 2.5;
    scene.camera.rotation = 0;
    selection.replaceAll(["a"]);

    expect(togglePinSelection(scene, history, selection, VIEWPORT)).toBe(true);

    const pinned = scene.findById("a");
    expect(pinned?.pinned).toBe(true);
    expect(pinned?.pinAnchor).toEqual(vec2(250 / 1000, 200 / 600));
    expect(history.canUndo()).toBe(true);
  });

  it("unpins by dropping the world position under the anchor", () => {
    const { scene, history, selection } = makeHarness([
      { ...makeShape("a", 0, 0), pinned: true, pinAnchor: vec2(0.3, 0.2) },
    ]);
    scene.camera.zoom = 2;
    scene.camera.x = 10;
    scene.camera.y = 20;
    selection.replaceAll(["a"]);

    expect(togglePinSelection(scene, history, selection, VIEWPORT)).toBe(true);

    const unpinned = scene.findById("a");
    expect(unpinned?.pinned).toBe(false);
    // anchor (300,120) → world (300/2+10, 120/2+20) = (160, 80).
    expect(unpinned?.position).toEqual(vec2(160, 80));
    // One history entry; undo restores BOTH the flag and the old position.
    expect(history.canUndo()).toBe(true);
    history.undo();
    const restored = scene.findById("a");
    expect(restored?.pinned).toBe(true);
    expect(restored?.pinAnchor).toEqual(vec2(0.3, 0.2));
    expect(restored?.position).toEqual(vec2(0, 0));
  });

  it("pins a mixed selection when any member is free", () => {
    const { scene, history, selection } = makeHarness([
      makeShape("free", 0, 0),
      { ...makeShape("pinned", 10, 10), pinned: true, pinAnchor: vec2(0, 0) },
    ]);
    selection.replaceAll(["free", "pinned"]);

    expect(togglePinSelection(scene, history, selection, VIEWPORT)).toBe(true);
    expect(isPinnedObject(scene.findById("free") as ShapeObjectData)).toBe(
      true,
    );
    expect(isPinnedObject(scene.findById("pinned") as ShapeObjectData)).toBe(
      true,
    );
    expect(history.canUndo()).toBe(true);
  });

  it("skips world-attached kinds (group children)", () => {
    const child = { ...makeShape("child", 0, 0), parentId: "group-1" };
    const { scene, history, selection } = makeHarness([child]);
    selection.replaceAll(["child"]);

    expect(togglePinSelection(scene, history, selection, VIEWPORT)).toBe(false);
    expect(history.canUndo()).toBe(false);
  });

  it("no-ops on an empty selection", () => {
    const { scene, history, selection } = makeHarness([]);
    expect(togglePinSelection(scene, history, selection, VIEWPORT)).toBe(false);
  });
});
