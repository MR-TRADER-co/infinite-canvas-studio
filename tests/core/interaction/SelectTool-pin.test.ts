/**
 * Unit tests for the select tool's screen-pin gestures (فاز ۲۵ «سنجاش
 * روی صفحه»): screen-space hit-testing takes priority, the pin drag
 * live-updates the anchor, one `UpdateObjectCommand` lands in history on
 * release, Escape restores the pre-gesture snapshot, and pinned members
 * never follow world-space drags or the marquee.
 */
import { describe, expect, it } from "vitest";
import { SelectTool } from "@/interaction/SelectTool";
import { hitTestTopMost, hitTestPinned } from "@/interaction/objectHitTest";
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
  type ShapeObjectData,
} from "@/core/model/ShapeObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { AppEventMap } from "@/core/events/EventBus";
import type { ToolPointerEvent } from "@/interaction/Tool";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Builds a normalised pointer payload (screen mirrors world, identity camera). */
function pointer(
  x: number,
  y: number,
  modifiers: { shift?: boolean } = {},
): ToolPointerEvent {
  return {
    screen: vec2(x, y),
    world: vec2(x, y),
    button: 0,
    shiftKey: modifiers.shift ?? false,
    ctrlKey: false,
    altKey: false,
  };
}

/** Builds a TOP-LEVEL shape fixture. */
function makeShape(
  id: string,
  x: number,
  y: number,
  width = 120,
  height = 80,
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

/** Everything the tool needs, wired with real production classes. */
function makeHarness(objects: readonly SceneObjectData[]) {
  const scene = new Scene();
  for (const object of objects) {
    scene.add(object);
  }
  const history = new HistoryManager();
  const bus = new EventBus<AppEventMap>();
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
    getViewport: () => VIEWPORT,
  });
  return { tool, scene, history, selection, bus };
}

const VIEWPORT = { width: 800, height: 600 };

describe("pinned hit-testing", () => {
  it("hitTestPinned resolves the screen footprint; the world walk skips pinned", () => {
    const pinned = {
      ...makeShape("pinned", 5000, 5000),
      pinned: true,
      // anchor (0.5, 0.5) → screen (400, 300) in an 800×600 viewport.
      pinAnchor: vec2(0.5, 0.5),
    };
    const world = makeShape("world", 400, 300);
    const scene = new Scene();
    scene.add(world);
    scene.add(pinned);

    // The pinned object resolves at its SCREEN spot…
    const hit = hitTestPinned(scene, vec2(420, 320), VIEWPORT);
    expect(hit?.id).toBe("pinned");
    // …and the world-space walk finds only the world shape there.
    const worldHit = hitTestTopMost(scene, vec2(420, 320), 2);
    expect(worldHit?.id).toBe("world");
  });
});

describe("select tool pin gestures", () => {
  it("clicks a pinned object to select it (no marquee)", () => {
    const pinned = {
      ...makeShape("pinned", 5000, 5000),
      pinned: true,
      pinAnchor: vec2(0.25, 0.25),
    };
    const { tool, selection } = makeHarness([pinned]);
    tool.onPointerDown(pointer(220, 160));
    tool.onPointerUp(pointer(220, 160));
    expect([...selection.ids]).toEqual(["pinned"]);
  });

  it("drags a pinned object in screen space — one undo entry", () => {
    const pinned = {
      ...makeShape("pinned", 0, 0),
      pinned: true,
      pinAnchor: vec2(0.1, 0.1),
    };
    const { tool, scene, history, selection } = makeHarness([pinned]);
    tool.onPointerDown(pointer(90, 70));
    tool.onPointerMove(pointer(170, 130));
    // Live update already applied mid-gesture — the anchor PRESERVES the
    // grab offset (anchor 80,60 + drag delta 80,60 → 160,120).
    const midDrag = scene.findById("pinned");
    expect(midDrag?.pinAnchor).toEqual(vec2(160 / 800, 120 / 600));
    tool.onPointerUp(pointer(170, 130));

    expect(history.canUndo()).toBe(true);
    expect(selection.has("pinned")).toBe(true);
    // Undo restores the pre-gesture anchor exactly.
    history.undo();
    const restored = scene.findById("pinned");
    expect(restored?.pinAnchor).toEqual(vec2(0.1, 0.1));
  });

  it("Escape cancels a pin drag without touching history", () => {
    const pinned = {
      ...makeShape("pinned", 0, 0),
      pinned: true,
      pinAnchor: vec2(0.2, 0.2),
    };
    const { tool, scene, history } = makeHarness([pinned]);
    tool.onPointerDown(pointer(170, 130));
    tool.onPointerMove(pointer(300, 300));
    expect(tool.onCancel()).toBe(true);
    const restored = scene.findById("pinned");
    expect(restored?.pinAnchor).toEqual(vec2(0.2, 0.2));
    expect(history.canUndo()).toBe(false);
  });

  it("a plain click on a pinned object collapses a multi-selection", () => {
    const pinned = {
      ...makeShape("pinned", 0, 0),
      pinned: true,
      pinAnchor: vec2(0.2, 0.2),
    };
    const other = makeShape("other", 400, 300);
    const { tool, selection } = makeHarness([pinned, other]);
    selection.replaceAll(["other", "pinned"]);
    tool.onPointerDown(pointer(170, 130));
    tool.onPointerUp(pointer(170, 130));
    expect([...selection.ids]).toEqual(["pinned"]);
  });

  it("pinned members never follow a world-space drag", () => {
    const pinned = {
      ...makeShape("pinned", 0, 0),
      pinned: true,
      pinAnchor: vec2(0.5, 0.5),
    };
    const world = makeShape("world", 10, 10);
    const { tool, scene, selection } = makeHarness([pinned, world]);
    selection.replaceAll(["pinned", "world"]);
    // Drag starts on the WORLD object (a click away from the pinned one).
    tool.onPointerDown(pointer(50, 40));
    tool.onPointerMove(pointer(150, 120));
    tool.onPointerUp(pointer(150, 120));

    const moved = scene.findById("world");
    expect(moved?.position).toEqual(vec2(110, 90));
    const stayed = scene.findById("pinned");
    expect(stayed?.pinAnchor).toEqual(vec2(0.5, 0.5));
  });

  it("the marquee never selects pinned objects", () => {
    const pinned = {
      ...makeShape("pinned", 5000, 5000),
      pinned: true,
      pinAnchor: vec2(0.4, 0.4),
    };
    const { tool, selection } = makeHarness([pinned]);
    tool.onPointerDown(pointer(0, 0));
    tool.onPointerMove(pointer(799, 599));
    tool.onPointerUp(pointer(799, 599));
    expect(selection.isEmpty()).toBe(true);
  });
});

describe("select tool pinned RESIZE gestures (فاز ۲۷)", () => {
  /** A pinned shape at anchor (0.25, 0.25) → screen (200, 150), 160×90. */
  function pinnedSized(): ShapeObjectData & {
    pinned: boolean;
    pinAnchor: ReturnType<typeof vec2>;
  } {
    return {
      ...makeShape("pinned", 5000, 5000, 160, 90),
      pinned: true,
      pinAnchor: vec2(0.25, 0.25),
    };
  }

  it("drags the se handle in screen space — one undo entry, exact restore", () => {
    const { tool, scene, history, selection, bus } = makeHarness([
      pinnedSized(),
    ]);
    selection.replaceAll(["pinned"]);
    const live: Array<{ width: number; height: number }> = [];
    bus.on("resize:live", (payload) => live.push(payload));

    // Pointer down EXACTLY on the se anchor (360, 240) opens the resize.
    tool.onPointerDown(pointer(360, 240));
    tool.onPointerMove(pointer(420, 280));
    const midDrag = scene.findById("pinned") as unknown as {
      width: number;
      height: number;
    };
    // Live frame: se grows to 220×130, the top-left anchor stays fixed.
    expect(midDrag.width).toBe(220);
    expect(midDrag.height).toBe(130);
    expect(live.at(-1)).toEqual({ width: 220, height: 130 });
    tool.onPointerUp(pointer(420, 280));

    expect(history.canUndo()).toBe(true);
    history.undo();
    const restored = scene.findById("pinned") as unknown as {
      width: number;
      height: number;
      pinAnchor?: ReturnType<typeof vec2>;
    };
    expect(restored.width).toBe(160);
    expect(restored.height).toBe(90);
    expect(restored.pinAnchor).toEqual(vec2(0.25, 0.25));
  });

  it("the nw handle keeps the bottom-right corner and MOVES the anchor", () => {
    const { tool, scene, history, selection } = makeHarness([
      pinnedSized(),
    ]);
    selection.replaceAll(["pinned"]);
    tool.onPointerDown(pointer(200, 150));
    tool.onPointerMove(pointer(170, 120));
    tool.onPointerUp(pointer(170, 120));
    const resized = scene.findById("pinned") as unknown as {
      width: number;
      height: number;
      pinAnchor?: ReturnType<typeof vec2>;
    };
    // Fixed corner (360, 240): width 360−170 = 190, height 240−120 = 120.
    expect(resized.width).toBe(190);
    expect(resized.height).toBe(120);
    expect(resized.pinAnchor).toEqual(vec2(170 / 800, 120 / 600));
    history.undo();
    const restored = scene.findById("pinned") as unknown as {
      width: number;
      height: number;
    };
    expect(restored.width).toBe(160);
    expect(restored.height).toBe(90);
  });

  it("Escape cancels a pinned resize without touching history", () => {
    const { tool, scene, history, selection } = makeHarness([
      pinnedSized(),
    ]);
    selection.replaceAll(["pinned"]);
    tool.onPointerDown(pointer(360, 240));
    tool.onPointerMove(pointer(420, 280));
    expect(tool.onCancel()).toBe(true);
    const restored = scene.findById("pinned") as unknown as {
      width: number;
      height: number;
    };
    expect(restored.width).toBe(160);
    expect(restored.height).toBe(90);
    expect(history.canUndo()).toBe(false);
    // The selection SURVIVES the cancel (only the gesture drops).
    expect(selection.has("pinned")).toBe(true);
  });

  it("Shift locks the aspect of a pinned corner resize", () => {
    const { tool, scene, selection } = makeHarness([pinnedSized()]);
    selection.replaceAll(["pinned"]);
    tool.onPointerDown(pointer(360, 240));
    tool.onPointerMove(pointer(420, 240, { shift: true }));
    tool.onPointerUp(pointer(420, 240, { shift: true }));
    const resized = scene.findById("pinned") as unknown as {
      width: number;
      height: number;
    };
    // 160×90 ratio: width 220 → height 220·(90/160) = 123.75.
    expect(resized.width).toBe(220);
    expect(resized.height).toBeCloseTo(123.75, 10);
  });

  it("a multi-selection shows no pinned handles — the body press wins", () => {
    const pinned = pinnedSized();
    const other = makeShape("other", 400, 300);
    const { tool, scene, history, selection } = makeHarness([pinned, other]);
    selection.replaceAll(["pinned", "other"]);
    // A click on the (would-be) se anchor: two objects selected → no
    // handles → the pinned body resolves (pin-press → click collapse).
    tool.onPointerDown(pointer(360, 240));
    tool.onPointerUp(pointer(360, 240));
    expect([...selection.ids]).toEqual(["pinned"]);
    const untouched = scene.findById("pinned") as unknown as {
      width: number;
      height: number;
    };
    expect(untouched.width).toBe(160);
    expect(history.canUndo()).toBe(false);
  });

  it("the pinned body drag still moves (not resizes) away from handles", () => {
    const { tool, scene, selection } = makeHarness([pinnedSized()]);
    selection.replaceAll(["pinned"]);
    // Press well inside the body (280, 195) → pin-press → pin-move.
    tool.onPointerDown(pointer(280, 195));
    tool.onPointerMove(pointer(330, 245));
    tool.onPointerUp(pointer(330, 245));
    const moved = scene.findById("pinned") as unknown as {
      width: number;
      height: number;
      pinAnchor?: ReturnType<typeof vec2>;
    };
    expect(moved.width).toBe(160);
    expect(moved.height).toBe(90);
    expect(moved.pinAnchor).toEqual(
      vec2((200 + 50) / 800, (150 + 50) / 600),
    );
  });
});

describe("select tool pinned rotation gestures (فاز ۳۰)", () => {
  /** A pinned shape at anchor (0.25, 0.25) → screen (200,150), 160×90. */
  function pinnedSized(): ShapeObjectData & {
    pinned: boolean;
    pinAnchor: ReturnType<typeof vec2>;
  } {
    return {
      ...makeShape("pinned", 5000, 5000, 160, 90),
      pinned: true,
      pinAnchor: vec2(0.25, 0.25),
    };
  }

  it("drags the rotation grip — one undo entry, exact restore", () => {
    const { tool, scene, history, selection, bus } = makeHarness([
      pinnedSized(),
    ]);
    selection.replaceAll(["pinned"]);
    const live: number[] = [];
    bus.on("rotate:live", (payload) => {
      live.push(payload.angle);
    });

    // Pointer down on the grip (280,126) opens the screen rotation.
    tool.onPointerDown(pointer(280, 126));
    tool.onPointerMove(pointer(349, 195));
    const midDrag = scene.findById("pinned") as unknown as {
      rotation: number;
    };
    expect(midDrag.rotation).toBeCloseTo(Math.PI / 2, 10);
    expect(live.at(-1)).toBe(90);
    tool.onPointerUp(pointer(349, 195));

    expect(history.canUndo()).toBe(true);
    history.undo();
    const restored = scene.findById("pinned") as unknown as {
      rotation: number;
    };
    expect(restored.rotation).toBe(0);
    // The selection SURVIVES the gesture.
    expect(selection.has("pinned")).toBe(true);
  });

  it("Escape cancels a pinned rotation without touching history", () => {
    const { tool, scene, history, selection } = makeHarness([
      pinnedSized(),
    ]);
    selection.replaceAll(["pinned"]);
    tool.onPointerDown(pointer(280, 126));
    tool.onPointerMove(pointer(349, 195));
    expect(tool.onCancel()).toBe(true);
    const restored = scene.findById("pinned") as unknown as {
      rotation: number;
    };
    expect(restored.rotation).toBe(0);
    expect(history.canUndo()).toBe(false);
    expect(selection.has("pinned")).toBe(true);
  });

  it("a multi-selection shows no rotation grip — the body press wins", () => {
    const pinned = pinnedSized();
    const other = makeShape("other", 400, 300);
    const { tool, scene, history, selection } = makeHarness([pinned, other]);
    selection.replaceAll(["pinned", "other"]);
    // A click on the (would-be) grip: two objects selected → no grip →
    // empty canvas (the grip floats OUTSIDE the body) → marquee.
    tool.onPointerDown(pointer(280, 126));
    tool.onPointerUp(pointer(280, 126));
    const untouched = scene.findById("pinned") as unknown as {
      rotation: number;
    };
    expect(untouched.rotation).toBe(0);
    expect(history.canUndo()).toBe(false);
  });

  it("hoverCursor offers grab over the grip and grabbing mid-gesture", () => {
    const { tool, selection } = makeHarness([pinnedSized()]);
    selection.replaceAll(["pinned"]);
    expect(tool.hoverCursor(pointer(280, 126))).toBe("grab");
    tool.onPointerDown(pointer(280, 126));
    expect(tool.hoverCursor(pointer(300, 150))).toBe("grabbing");
    tool.onCancel();
  });
});
