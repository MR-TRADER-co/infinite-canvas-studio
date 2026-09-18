/**
 * Unit tests for the pinned rotation gesture (فاز ۳۰ «چرخش سنجاق‌شده»):
 * probe gating (pinned/locked/sized/viewport), live rotation frames
 * through the scene (before-rotation-relative, no drift), the single
 * `RotateCommand` on commit, the no-change commit skipping history, the
 * Escape restore, Shift's 15° snap, and the live-angle events.
 */
import { describe, expect, it } from "vitest";
import { PinRotateGesture } from "@/interaction/PinRotateGesture";
import { EventBus } from "@/core/events/EventBus";
import { HistoryManager } from "@/core/history/HistoryManager";
import { HandlesRenderer } from "@/rendering/HandlesRenderer";
import { Scene } from "@/core/model/Scene";
import {
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN,
  type ShapeObjectData,
} from "@/core/model/ShapeObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { AppEventMap } from "@/core/events/EventBus";
import type { ToolPointerEvent } from "@/interaction/Tool";

/** Builds a normalised pointer payload (screen mirrors world). */
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

/**
 * Builds a pinned shape at anchor (0.25, 0.25) → screen (200,150),
 * 160×90: centre (280,195), upright grip (280,126).
 */
function pinnedShape(rotation = 0): ShapeObjectData & {
  pinned: boolean;
  pinAnchor: ReturnType<typeof vec2>;
} {
  return {
    id: "pinned",
    kind: "shape",
    name: undefined,
    parentId: undefined,
    position: vec2(5000, 5000),
    rotation,
    zIndex: 0,
    visible: true,
    locked: false,
    shapeKind: "rectangle",
    width: 160,
    height: 90,
    fill: SHAPE_FILL_TOKEN,
    stroke: STROKE_COLOR_TOKEN,
    strokeWidth: 0,
    pinned: true,
    pinAnchor: vec2(0.25, 0.25),
  };
}

/** Wires the gesture with real production classes. */
function makeHarness(
  objects: readonly object[],
  viewport = { width: 800, height: 600 },
) {
  const scene = new Scene();
  for (const object of objects) {
    scene.add(object as never);
  }
  const history = new HistoryManager();
  const bus = new EventBus<AppEventMap>();
  const handles = new HandlesRenderer();
  const gesture = new PinRotateGesture({
    scene,
    history,
    bus,
    handles,
    getViewport: () => viewport,
  });
  return { gesture, scene, history, bus, handles };
}

describe("PinRotateGesture.probe", () => {
  it("grabs the rotation grip of a pinned sized object", () => {
    const { gesture } = makeHarness([pinnedShape()]);
    expect(gesture.probe(pinnedShape(), pointer(280, 126))).toBe(true);
    // The tilted object's grip follows the rotation.
    expect(
      gesture.probe(pinnedShape(Math.PI / 2), pointer(349, 195)),
    ).toBe(true);
  });

  it("refuses unpinned, locked objects and degenerate viewports", () => {
    const { gesture } = makeHarness([pinnedShape()]);
    expect(
      gesture.probe({ ...pinnedShape(), pinned: false }, pointer(280, 126)),
    ).toBe(false);
    expect(
      gesture.probe({ ...pinnedShape(), locked: true }, pointer(280, 126)),
    ).toBe(false);
    const degenerate = makeHarness([pinnedShape()], {
      width: 800,
      height: 0,
    });
    expect(
      degenerate.gesture.probe(pinnedShape(), pointer(280, 126)),
    ).toBe(false);
  });

  it("misses points away from the grip", () => {
    const { gesture } = makeHarness([pinnedShape()]);
    expect(gesture.probe(pinnedShape(), pointer(280, 160))).toBe(false);
    expect(gesture.probe(pinnedShape(), pointer(400, 300))).toBe(false);
  });
});

describe("PinRotateGesture lifecycle", () => {
  it("a quarter drag rotates exactly +90° in ONE undo entry", () => {
    const { gesture, scene, history } = makeHarness([pinnedShape()]);
    // Press on the grip, drag to the right edge of the centre row.
    gesture.begin(pinnedShape(), vec2(280, 126));
    gesture.moveTo(pointer(349, 195));
    gesture.commit();
    const rotated = scene.findById("pinned") as unknown as {
      rotation: number;
    };
    expect(rotated.rotation).toBeCloseTo(Math.PI / 2, 10);
    expect(history.canUndo()).toBe(true);
    history.undo();
    const restored = scene.findById("pinned") as unknown as {
      rotation: number;
    };
    expect(restored.rotation).toBe(0);
  });

  it("rotation ADDS to the before rotation (relative, no drift)", () => {
    const { gesture, scene } = makeHarness([pinnedShape(Math.PI / 2)]);
    gesture.begin(pinnedShape(Math.PI / 2), vec2(349, 195));
    // A further +90° drag: start angle 0 (grip is right of centre),
    // pointer below the centre → +π/2.
    gesture.moveTo(pointer(280, 264));
    const rotated = scene.findById("pinned") as unknown as {
      rotation: number;
    };
    expect(rotated.rotation).toBeCloseTo(Math.PI, 10);
    // Long gestures recompute from the before snapshot: dragging back to
    // the start angle returns to the BEFORE rotation exactly.
    gesture.moveTo(pointer(349, 195));
    const back = scene.findById("pinned") as unknown as { rotation: number };
    expect(back.rotation).toBeCloseTo(Math.PI / 2, 10);
    gesture.commit();
  });

  it("a no-change commit skips history entirely", () => {
    const { gesture, history } = makeHarness([pinnedShape()]);
    gesture.begin(pinnedShape(), vec2(280, 126));
    // Pointer exactly AT the start point: delta 0.
    gesture.moveTo(pointer(280, 126));
    gesture.commit();
    expect(history.canUndo()).toBe(false);
    expect(gesture.active).toBe(false);
  });

  it("Shift snaps the delta to 15° steps", () => {
    const { gesture, scene } = makeHarness([pinnedShape()]);
    gesture.begin(pinnedShape(), vec2(280, 126));
    // The grip sits straight above the centre (angle -90°); drag the
    // pointer 20° around → Shift snaps the delta to exactly 15°.
    const radius = 69;
    const twenty = (20 * Math.PI) / 180;
    const angle = -Math.PI / 2 + twenty;
    gesture.moveTo(
      pointer(
        280 + radius * Math.cos(angle),
        195 + radius * Math.sin(angle),
        true,
      ),
    );
    const rotated = scene.findById("pinned") as unknown as {
      rotation: number;
    };
    expect(rotated.rotation).toBeCloseTo(Math.PI / 12, 10);
    gesture.cancel();
  });

  it("cancel restores the before rotation without touching history", () => {
    const { gesture, scene, history } = makeHarness([pinnedShape()]);
    gesture.begin(pinnedShape(), vec2(280, 126));
    gesture.moveTo(pointer(349, 195));
    gesture.cancel();
    const restored = scene.findById("pinned") as unknown as {
      rotation: number;
    };
    expect(restored.rotation).toBe(0);
    expect(history.canUndo()).toBe(false);
    expect(gesture.active).toBe(false);
  });

  it("emits rotate:live frames and a final rotate:ended", () => {
    const { gesture, bus } = makeHarness([pinnedShape()]);
    const live: number[] = [];
    let ended: { angle: number } | null = null;
    bus.on("rotate:live", (payload) => {
      live.push(payload.angle);
    });
    bus.on("rotate:ended", (payload) => {
      ended = payload;
    });
    gesture.begin(pinnedShape(), vec2(280, 126));
    gesture.moveTo(pointer(349, 195));
    gesture.commit();
    expect(live).toEqual([90]);
    expect(ended).toEqual({ angle: 90 });
  });

  it("an object unpinned mid-gesture ends the gesture cleanly", () => {
    const { gesture, scene, history } = makeHarness([pinnedShape()]);
    gesture.begin(pinnedShape(), vec2(280, 126));
    const current = scene.findById("pinned");
    if (current !== undefined) {
      scene.add({ ...current, pinned: false } as never);
    }
    gesture.moveTo(pointer(349, 195));
    gesture.commit();
    expect(history.canUndo()).toBe(false);
    expect(gesture.active).toBe(false);
  });

  it("an object removed mid-gesture ends the gesture cleanly", () => {
    const { gesture, scene, history } = makeHarness([pinnedShape()]);
    gesture.begin(pinnedShape(), vec2(280, 126));
    scene.remove("pinned");
    gesture.moveTo(pointer(349, 195));
    gesture.commit();
    expect(history.canUndo()).toBe(false);
    expect(gesture.active).toBe(false);
  });
});
