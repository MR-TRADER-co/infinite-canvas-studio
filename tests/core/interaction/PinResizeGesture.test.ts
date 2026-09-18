/**
 * Unit tests for the pinned resize gesture (فاز ۲۷ «تغییر اندازهٔ
 * سنجاق‌شده»): probe gating (pinned/locked/sized/viewport), live frames
 * through the scene, the single `ResizeCommand` on commit, the no-change
 * commit skipping history, the Escape restore, and the image aspect-lock
 * default.
 */
import { describe, expect, it } from "vitest";
import { PinResizeGesture } from "@/interaction/PinResizeGesture";
import { EventBus } from "@/core/events/EventBus";
import { HistoryManager } from "@/core/history/HistoryManager";
import { HandlesRenderer } from "@/rendering/HandlesRenderer";
import { Scene } from "@/core/model/Scene";
import {
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN,
  type ShapeObjectData,
} from "@/core/model/ShapeObject";
import type { ImageObjectData } from "@/core/model/ImageObject";
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

/** Builds a pinned shape at anchor (0.25, 0.25) → screen (200,150), 160×90. */
function pinnedShape(): ShapeObjectData & {
  pinned: boolean;
  pinAnchor: ReturnType<typeof vec2>;
} {
  return {
    id: "pinned",
    kind: "shape",
    name: undefined,
    parentId: undefined,
    position: vec2(5000, 5000),
    rotation: 0,
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

/** Builds a pinned 160×90 image (aspect locks by default — AC5.2). */
function pinnedImage(): ImageObjectData & {
  pinned: boolean;
  pinAnchor: ReturnType<typeof vec2>;
} {
  return {
    id: "img",
    kind: "image",
    name: undefined,
    parentId: undefined,
    position: vec2(5000, 5000),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    src: "data:image/png;base64,AAAA",
    naturalWidth: 160,
    naturalHeight: 90,
    width: 160,
    height: 90,
    pinned: true,
    pinAnchor: vec2(0.25, 0.25),
  };
}

/** Wires the gesture with real production classes. */
function makeHarness(objects: readonly object[], viewport = { width: 800, height: 600 }) {
  const scene = new Scene();
  for (const object of objects) {
    scene.add(object as never);
  }
  const history = new HistoryManager();
  const bus = new EventBus<AppEventMap>();
  const handles = new HandlesRenderer();
  const gesture = new PinResizeGesture({
    scene,
    history,
    bus,
    handles,
    getViewport: () => viewport,
  });
  return { gesture, scene, history, bus, handles };
}

describe("PinResizeGesture.probe", () => {
  it("grabs the handle anchor of a pinned sized object", () => {
    const { gesture } = makeHarness([pinnedShape()]);
    expect(gesture.probe(pinnedShape(), pointer(202, 152))).toBe("nw");
    expect(gesture.probe(pinnedShape(), pointer(360, 240))).toBe("se");
  });

  it("refuses unpinned, locked objects and degenerate viewports", () => {
    const { gesture } = makeHarness([pinnedShape()]);
    expect(gesture.probe({ ...pinnedShape(), pinned: false }, pointer(200, 150))).toBeNull();
    expect(gesture.probe({ ...pinnedShape(), locked: true }, pointer(200, 150))).toBeNull();
    const degenerate = makeHarness([pinnedShape()], { width: 0, height: 600 });
    expect(
      degenerate.gesture.probe(pinnedShape(), pointer(200, 150)),
    ).toBeNull();
  });
});

describe("PinResizeGesture lifecycle", () => {
  it("a no-change commit skips history entirely", () => {
    const { gesture, history } = makeHarness([pinnedShape()]);
    gesture.begin(pinnedShape(), "se");
    // A pointer exactly AT the anchor: the frame equals the before box.
    gesture.moveTo(pointer(360, 240));
    gesture.commit();
    expect(history.canUndo()).toBe(false);
    expect(gesture.active).toBe(false);
  });

  it("an inward drag clamps to the minimum size (8px + stroke)", () => {
    const { gesture, scene } = makeHarness([pinnedShape()]);
    gesture.begin(pinnedShape(), "se");
    gesture.moveTo(pointer(202, 151));
    const resized = scene.findById("pinned") as unknown as {
      width: number;
      height: number;
    };
    expect(resized.width).toBe(8);
    expect(resized.height).toBe(8);
    gesture.cancel();
    const restored = scene.findById("pinned") as unknown as {
      width: number;
      height: number;
    };
    expect(restored.width).toBe(160);
    expect(restored.height).toBe(90);
  });

  it("images lock the aspect by DEFAULT (Shift frees it)", () => {
    const { gesture, scene } = makeHarness([pinnedImage()]);
    gesture.begin(pinnedImage(), "se");
    // Drag width to 220 WITHOUT Shift → height follows the 160:90 ratio.
    gesture.moveTo(pointer(420, 240));
    const locked = scene.findById("img") as unknown as {
      width: number;
      height: number;
    };
    expect(locked.width).toBe(220);
    expect(locked.height).toBeCloseTo(123.75, 10);
    // With Shift held the aspect frees: both axes follow the pointer.
    gesture.moveTo(pointer(420, 300, true));
    const freed = scene.findById("img") as unknown as {
      width: number;
      height: number;
    };
    expect(freed.width).toBe(220);
    expect(freed.height).toBe(150);
    gesture.commit();
  });

  it("emits resize:live frames and a final resize:ended", () => {
    const { gesture, bus } = makeHarness([pinnedShape()]);
    const live: number[] = [];
    let ended: { width: number; height: number } | null = null;
    bus.on("resize:live", (payload) => live.push(payload.width));
    bus.on("resize:ended", (payload) => {
      ended = payload;
    });
    gesture.begin(pinnedShape(), "se");
    gesture.moveTo(pointer(420, 280));
    gesture.commit();
    expect(live).toEqual([220]);
    expect(ended).toEqual({ width: 220, height: 130 });
  });

  it("an object removed mid-gesture ends the gesture cleanly", () => {
    const { gesture, scene, history } = makeHarness([pinnedShape()]);
    gesture.begin(pinnedShape(), "se");
    scene.remove("pinned");
    gesture.moveTo(pointer(420, 280));
    gesture.commit();
    expect(history.canUndo()).toBe(false);
    expect(gesture.active).toBe(false);
  });
});
