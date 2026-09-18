/**
 * Unit tests for the select tool's Phase 2 gestures: the rotation handle,
 * Alt+drag duplication, Shift axis locking and group-level selection
 * (AC2.3/AC2.4/AC2.5).
 */
import { describe, expect, it, vi } from "vitest";
import { SelectTool } from "@/interaction/SelectTool";
import { Coalescer } from "@/core/commands/Coalescer";
import { EventBus } from "@/core/events/EventBus";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { MarqueeLogic } from "@/interaction/MarqueeLogic";
import { HandlesRenderer } from "@/rendering/HandlesRenderer";
import { Scene } from "@/core/model/Scene";
import {
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN,
  isShapeObject,
  type ShapeObjectData,
} from "@/core/model/ShapeObject";
import { groupSelection } from "@/core/commands/SelectionOps";
import { Selection } from "@/core/selection/Selection";
import { vec2 } from "@/core/geometry/Vec2";
import type { AppEventMap } from "@/core/events/EventBus";
import type { ToolPointerEvent } from "@/interaction/Tool";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Builds a normalised pointer payload (screen mirrors world, identity camera). */
function pointer(x: number, y: number, button = 0): ToolPointerEvent {
  return {
    screen: vec2(x, y),
    world: vec2(x, y),
    button,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
  };
}

/** Builds a pointer payload with modifier keys. */
function modPointer(
  x: number,
  y: number,
  modifiers: { shift?: boolean; alt?: boolean },
): ToolPointerEvent {
  return {
    ...pointer(x, y),
    shiftKey: modifiers.shift ?? false,
    altKey: modifiers.alt ?? false,
  };
}

/** Builds a shape fixture whose bounds equal the given box exactly (no padding). */
function makeShape(
  id: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): ShapeObjectData {
  return {
    id,
    kind: "shape",
    name: undefined,
    parentId: undefined,
    position: vec2(minX, minY),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    shapeKind: "rectangle",
    width: maxX - minX,
    height: maxY - minY,
    fill: SHAPE_FILL_TOKEN,
    stroke: STROKE_COLOR_TOKEN,
    strokeWidth: 0,
  };
}

/** Everything the select tool needs, wired with real production classes. */
interface Harness {
  readonly tool: SelectTool;
  readonly scene: Scene;
  readonly history: HistoryManager;
  readonly selection: Selection;
  readonly bus: EventBus<AppEventMap>;
  readonly rotateLive: ReturnType<typeof vi.fn>;
}

/** Builds the tool harness over the given objects. */
function makeHarness(objects: readonly SceneObjectData[]): Harness {
  const scene = new Scene();
  for (const object of objects) {
    scene.add(object);
  }
  const history = new HistoryManager();
  const bus = new EventBus<AppEventMap>();
  const rotateLive = vi.fn();
  bus.on("rotate:live", rotateLive);
  const handles = new HandlesRenderer();
  const selection = scene.selection;
  const tool = new SelectTool({
    scene,
    history,
    selection,
    coalescer: new Coalescer(),
    marquee: new MarqueeLogic(scene),
    handles,
    bus,
    getFontSize: () => 20,
    ids: new IdGenerator("obj"),
  });
  return { tool, scene, history, selection, bus, rotateLive };
}

describe("SelectTool rotation gesture", () => {
  it("drags the rotation handle to rotate around the bounds centre", () => {
    const harness = makeHarness([makeShape("a", 0, 0, 100, 100)]);
    harness.selection.replaceAll(["a"]);
    const { tool } = harness;

    // The rotation handle sits 24px above the top edge centre (50, 0).
    tool.onPointerDown(pointer(50, -24));
    tool.onPointerMove(pointer(124, 50));
    tool.onPointerUp(pointer(124, 50));

    const rotated = harness.scene.findById("a");
    if (rotated === undefined || !isShapeObject(rotated)) {
      throw new Error("rotated object vanished");
    }
    expect(rotated.rotation).toBeCloseTo(Math.PI / 2, 6);
    // Rigid rotation: size unchanged.
    expect(rotated.width).toBe(100);
    expect(rotated.height).toBe(100);
    // One history entry; undo restores the exact pre-gesture state.
    expect(harness.history.canUndo()).toBe(true);
    harness.history.undo();
    expect(harness.scene.findById("a")?.rotation).toBe(0);
    expect(harness.history.canRedo()).toBe(true);
    harness.history.redo();
    expect(harness.scene.findById("a")?.rotation).toBeCloseTo(Math.PI / 2, 6);
  });

  it("Shift snaps the rotation to 15° steps", () => {
    const harness = makeHarness([makeShape("a", 0, 0, 100, 100)]);
    harness.selection.replaceAll(["a"]);
    const { tool } = harness;

    tool.onPointerDown(modPointer(50, -24, { shift: true }));
    // A raw delta of ~49.8° (pivot (50,50), start angle −90°, pointer
    // angle ≈ −40.2°) snaps to the 45° step.
    tool.onPointerMove(modPointer(115, -5, { shift: true }));
    tool.onPointerUp(modPointer(115, -5, { shift: true }));
    const rotation = harness.scene.findById("a")?.rotation ?? 0;
    const degrees = (rotation * 180) / Math.PI;
    expect(Math.abs(degrees % 15)).toBeLessThan(1e-9);
    expect(degrees).toBeCloseTo(45, 6);
  });

  it("Escape cancels the rotation without touching history", () => {
    const harness = makeHarness([makeShape("a", 0, 0, 100, 100)]);
    harness.selection.replaceAll(["a"]);
    const { tool } = harness;

    tool.onPointerDown(pointer(50, -24));
    tool.onPointerMove(pointer(124, 50));
    expect(tool.onCancel()).toBe(true);
    expect(harness.scene.findById("a")?.rotation).toBe(0);
    expect(harness.history.canUndo()).toBe(false);
  });

  it("rotating a group spins its members around the group centre (AC2.5)", () => {
    const harness = makeHarness([
      makeShape("a", 0, 0, 100, 100),
      makeShape("b", 200, 0, 300, 100),
    ]);
    harness.selection.replaceAll(["a", "b"]);
    expect(
      groupSelection(
        harness.scene,
        harness.history,
        harness.selection,
        new IdGenerator("obj"),
      ),
    ).toBe(true);
    const groupId = [...harness.selection.ids][0] as string;

    const { tool } = harness;
    // Union box (0,0)-(300,100): the handle sits at (150, -24).
    tool.onPointerDown(pointer(150, -24));
    tool.onPointerMove(pointer(224, 50));
    tool.onPointerUp(pointer(224, 50));

    const a = harness.scene.findById("a");
    const b = harness.scene.findById("b");
    if (
      a === undefined ||
      b === undefined ||
      !isShapeObject(a) ||
      !isShapeObject(b)
    ) {
      throw new Error("group members vanished");
    }
    // Both members advanced their rotation by the gesture delta (90°).
    expect(a.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(b.rotation).toBeCloseTo(Math.PI / 2, 6);
    // Their centres orbited the group centre (150, 50) — the relative
    // arrangement rotated rigidly.
    const aCenter = {
      x: a.position.x + a.width / 2,
      y: a.position.y + a.height / 2,
    };
    const bCenter = {
      x: b.position.x + b.width / 2,
      y: b.position.y + b.height / 2,
    };
    expect(Math.hypot(aCenter.x - 150, aCenter.y - 50)).toBeCloseTo(100, 6);
    expect(Math.hypot(bCenter.x - 150, bCenter.y - 50)).toBeCloseTo(100, 6);
    // Undo restores every member in one step.
    harness.history.undo();
    expect(harness.scene.findById("a")?.rotation).toBe(0);
    expect(harness.scene.findById("b")?.rotation).toBe(0);
    expect(harness.scene.findById(groupId)?.kind).toBe("group");
  });

  it("a click on a grouped child selects the group", () => {
    const harness = makeHarness([
      makeShape("a", 0, 0, 100, 100),
      makeShape("b", 200, 0, 300, 100),
    ]);
    harness.selection.replaceAll(["a", "b"]);
    groupSelection(
      harness.scene,
      harness.history,
      harness.selection,
      new IdGenerator("obj"),
    );
    const groupId = [...harness.selection.ids][0] as string;

    harness.selection.clear();
    const { tool } = harness;
    tool.onPointerDown(pointer(50, 50));
    tool.onPointerUp(pointer(50, 50));
    expect([...harness.selection.ids]).toEqual([groupId]);
  });
});

describe("SelectTool Alt+drag duplication", () => {
  it("Alt+drag copies the selection and drags the copies (one undo entry)", () => {
    const harness = makeHarness([makeShape("a", 0, 0, 100, 100)]);
    harness.selection.replaceAll(["a"]);
    const { tool } = harness;

    tool.onPointerDown(modPointer(50, 50, { alt: true }));
    // Cross the drag threshold (10 px) and drag right by 40 world units.
    tool.onPointerMove(modPointer(90, 50, { alt: true }));
    tool.onPointerUp(modPointer(90, 50, { alt: true }));

    // The original stays; the copy moved to (40, 0).
    expect(harness.scene.findById("a")?.position).toEqual(vec2(0, 0));
    expect(harness.scene.objectCount).toBe(2);
    const copy = harness.scene.objects.find((object) => object.id !== "a");
    if (copy === undefined) {
      throw new Error("no copy created");
    }
    expect(copy.position).toEqual(vec2(40, 0));
    expect([...harness.selection.ids]).toEqual([copy.id]);

    // ONE undo entry removes the copy entirely (AC2.4).
    expect(harness.history.canUndo()).toBe(true);
    harness.history.undo();
    expect(harness.scene.objectCount).toBe(1);
    expect(harness.scene.findById("a")?.position).toEqual(vec2(0, 0));
    // Redo restores the moved copy.
    harness.history.redo();
    expect(harness.scene.objectCount).toBe(2);
    expect(copy.position).toEqual(vec2(40, 0));
  });

  it("Escape mid-alt-drag reverts the copies and restores the selection", () => {
    const harness = makeHarness([makeShape("a", 0, 0, 100, 100)]);
    harness.selection.replaceAll(["a"]);
    const { tool } = harness;

    tool.onPointerDown(modPointer(50, 50, { alt: true }));
    tool.onPointerMove(modPointer(90, 50, { alt: true }));
    expect(tool.onCancel()).toBe(true);
    expect(harness.scene.objectCount).toBe(1);
    expect([...harness.selection.ids]).toEqual(["a"]);
    expect(harness.scene.findById("a")?.position).toEqual(vec2(0, 0));
    expect(harness.history.canUndo()).toBe(false);
  });

  it("plain drags do not duplicate", () => {
    const harness = makeHarness([makeShape("a", 0, 0, 100, 100)]);
    harness.selection.replaceAll(["a"]);
    const { tool } = harness;

    tool.onPointerDown(pointer(50, 50));
    tool.onPointerMove(pointer(90, 50));
    tool.onPointerUp(pointer(90, 50));
    expect(harness.scene.objectCount).toBe(1);
    expect(harness.scene.findById("a")?.position).toEqual(vec2(40, 0));
  });
});

describe("SelectTool Shift axis lock", () => {
  it("Shift projects the displacement onto the dominant axis", () => {
    const harness = makeHarness([makeShape("a", 0, 0, 100, 100)]);
    harness.selection.replaceAll(["a"]);
    const { tool } = harness;

    tool.onPointerDown(pointer(50, 50));
    // Displacement (30, 10) with Shift held: the x axis dominates → (30, 0).
    tool.onPointerMove(modPointer(80, 60, { shift: true }));
    tool.onPointerUp(modPointer(80, 60, { shift: true }));
    expect(harness.scene.findById("a")?.position).toEqual(vec2(30, 0));
    harness.history.undo();
    expect(harness.scene.findById("a")?.position).toEqual(vec2(0, 0));
  });

  it("pressing Shift mid-drag straightens the accumulated path", () => {
    const harness = makeHarness([makeShape("a", 0, 0, 100, 100)]);
    harness.selection.replaceAll(["a"]);
    const { tool } = harness;

    tool.onPointerDown(pointer(50, 50));
    // Free move (10, 4) then Shift locks to the axis at (40, 4) → (40, 0).
    tool.onPointerMove(pointer(60, 54));
    tool.onPointerMove(modPointer(90, 54, { shift: true }));
    tool.onPointerUp(modPointer(90, 54, { shift: true }));
    expect(harness.scene.findById("a")?.position).toEqual(vec2(40, 0));
  });
});
