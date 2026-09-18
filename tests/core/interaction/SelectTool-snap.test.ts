/**
 * Integration tests for the R5.5 snap-to-grid on the select tool's drag
 * gesture (AC5.5: on/off works for drag, edges land exactly on grid) and
 * the Shift axis-lock precedence over snapping.
 */
import { describe, expect, it } from "vitest";
import { SelectTool } from "@/interaction/SelectTool";
import { Coalescer } from "@/core/commands/Coalescer";
import { EventBus } from "@/core/events/EventBus";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { MarqueeLogic } from "@/interaction/MarqueeLogic";
import { HandlesRenderer } from "@/rendering/HandlesRenderer";
import { Scene } from "@/core/model/Scene";

import type { AppEventMap } from "@/core/events/EventBus";
import type { ToolPointerEvent } from "@/interaction/Tool";
import { Selection } from "@/core/selection/Selection";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { SnapConfig } from "@/interaction/SnapEngine";
import {
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN,
  isShapeObject,
  type ShapeObjectData,
} from "@/core/model/ShapeObject";
import { vec2 } from "@/core/geometry/Vec2";

/** Builds a normalised pointer payload (identity camera). */
function pointer(x: number, y: number, shift = false): ToolPointerEvent {
  return {
    screen: vec2(x, y),
    world: vec2(x, y),
    button: 0,
    shiftKey: shift,
    ctrlKey: false,
    altKey: false,
  };
}

/** Builds a shape fixture whose bounds equal the given box exactly. */
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

/** Everything the select tool needs, plus the snap config source. */
function makeHarness(
  objects: readonly SceneObjectData[],
  snap: SnapConfig | undefined,
): {
  tool: SelectTool;
  scene: Scene;
  history: HistoryManager;
} {
  const scene = new Scene();
  for (const object of objects) {
    scene.add(object);
  }
  const history = new HistoryManager();
  const tool = new SelectTool({
    scene,
    history,
    selection: new Selection(),
    coalescer: new Coalescer(),
    marquee: new MarqueeLogic(scene),
    handles: new HandlesRenderer(),
    bus: new EventBus<AppEventMap>(),
    getFontSize: () => 20,
    ids: new IdGenerator("obj"),
    ...(snap === undefined ? {} : { getSnapConfig: () => snap }),
  });
  return { tool, scene, history };
}

describe("SelectTool drag snapping (R5.5)", () => {
  it("drags land an edge exactly on the grid while snap is on (AC5.5)", () => {
    // Shape (0,0)-(40,40), press (20,20), release (33,33): raw displacement
    // (13,13); proposals minX 13→0 (−13), center 33→40 (+7), maxX 53→60
    // (+7) → +7 per axis → applied displacement (20,20): position (20,20),
    // far edge 60 — EXACTLY on the grid.
    const harness = makeHarness([makeShape("a", 0, 0, 40, 40)], {
      enabled: true,
      spacing: 20,
    });
    harness.tool.onPointerDown(pointer(20, 20));
    harness.tool.onPointerMove(pointer(33, 33));
    harness.tool.onPointerUp(pointer(33, 33));
    const moved = harness.scene.findById("a");
    expect(moved).toBeDefined();
    if (moved !== undefined && isShapeObject(moved)) {
      expect(moved.position.x).toBe(20);
      expect(moved.position.y).toBe(20);
      expect(moved.position.x + moved.width).toBe(60);
    }
  });

  it("dragging stays raw while snap is off", () => {
    const harness = makeHarness([makeShape("a", 0, 0, 40, 40)], {
      enabled: false,
      spacing: 20,
    });
    harness.tool.onPointerDown(pointer(20, 20));
    harness.tool.onPointerMove(pointer(33, 33));
    harness.tool.onPointerUp(pointer(33, 33));
    const moved = harness.scene.findById("a");
    if (moved !== undefined && isShapeObject(moved)) {
      expect(moved.position.x).toBe(13);
      expect(moved.position.y).toBe(13);
    }
  });

  it("unconfigured tools drag raw (optional dep, backwards compatible)", () => {
    const harness = makeHarness([makeShape("a", 0, 0, 40, 40)], undefined);
    harness.tool.onPointerDown(pointer(20, 20));
    harness.tool.onPointerMove(pointer(33, 33));
    harness.tool.onPointerUp(pointer(33, 33));
    const moved = harness.scene.findById("a");
    if (moved !== undefined && isShapeObject(moved)) {
      expect(moved.position.x).toBe(13);
    }
  });

  it("the Shift axis-lock wins over snapping (DECISIONS D-5.5)", () => {
    const harness = makeHarness([makeShape("a", 0, 0, 40, 40)], {
      enabled: true,
      spacing: 20,
    });
    // Raw displacement (13,13) locks to the dominant axis — a tie breaks
    // horizontal — and snapping is skipped: position (13, 0).
    harness.tool.onPointerDown(pointer(20, 20));
    harness.tool.onPointerMove(pointer(33, 33, true));
    harness.tool.onPointerUp(pointer(33, 33, true));
    const moved = harness.scene.findById("a");
    if (moved !== undefined && isShapeObject(moved)) {
      expect(moved.position.x).toBe(13);
      expect(moved.position.y).toBe(0);
    }
  });

  it("one snapped drag = one undo entry (coalescing preserved)", () => {
    const harness = makeHarness([makeShape("a", 0, 0, 40, 40)], {
      enabled: true,
      spacing: 20,
    });
    harness.tool.onPointerDown(pointer(20, 20));
    // (6,6): every proposal −6 → desired (0,0), nothing moves.
    harness.tool.onPointerMove(pointer(26, 26));
    // (13,13): +7 → desired (20,20), applied displacement (20,20).
    harness.tool.onPointerMove(pointer(33, 33));
    // (20,20): already on-grid proposals (0) → desired stays (20,20).
    harness.tool.onPointerMove(pointer(40, 40));
    harness.tool.onPointerUp(pointer(40, 40));
    const moved = harness.scene.findById("a");
    if (moved !== undefined && isShapeObject(moved)) {
      expect(moved.position.x).toBe(20);
      expect(moved.position.y).toBe(20);
    }
    expect(harness.history.canUndo()).toBe(true);
    harness.history.undo();
    const restored = harness.scene.findById("a");
    if (restored !== undefined && isShapeObject(restored)) {
      expect(restored.position.x).toBe(0);
      expect(restored.position.y).toBe(0);
    }
  });
});
