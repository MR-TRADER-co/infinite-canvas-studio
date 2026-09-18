/** Unit tests for the select tool's connector reconnect gesture. */
import { describe, expect, it, vi } from "vitest";
import { SelectTool } from "@/interaction/SelectTool";
import { Coalescer } from "@/core/commands/Coalescer";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import { EventBus } from "@/core/events/EventBus";
import { HistoryManager } from "@/core/history/HistoryManager";
import { MarqueeLogic } from "@/interaction/MarqueeLogic";
import { HandlesRenderer } from "@/rendering/HandlesRenderer";
import { Scene } from "@/core/model/Scene";
import {
  connectorFromEndpoints,
  isConnectorObject,
} from "@/core/model/ConnectorObject";
import type {
  ConnectorObjectData,
  ConnectorStyle,
} from "@/core/model/ConnectorObject";
import { SHAPE_FILL_TOKEN, STROKE_COLOR_TOKEN } from "@/core/model/ShapeObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { AppEventMap } from "@/core/events/EventBus";
import type { ToolPointerEvent } from "@/interaction/Tool";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import { IdGenerator } from "@/core/id/IdGenerator";

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

/** Builds a normalised pointer payload with Shift held. */
function shiftPointer(x: number, y: number): ToolPointerEvent {
  return { ...pointer(x, y), shiftKey: true };
}

/** Connector style fixture used by every connector built in this suite. */
const CONNECTOR_STYLE: ConnectorStyle = {
  color: "#38bdf8",
  width: 2,
  dash: "solid",
  routing: "straight",
  startArrow: "none",
  endArrow: "arrow",
};

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
    name: "Shape",
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

/**
 * Builds the glued fixture: shape-a (0,0,100,100) and shape-b (300,0,400,100)
 * joined by a connector whose start is glued to a's E anchor (100, 50) and
 * whose end is glued to b's W anchor (300, 50).
 */
function makeGluedConnector(): ConnectorObjectData {
  return connectorFromEndpoints(
    { objectId: "shape-a", anchorIndex: 1, position: vec2(100, 50) },
    { objectId: "shape-b", anchorIndex: 3, position: vec2(300, 50) },
    CONNECTOR_STYLE,
    "conn-1",
    2,
  );
}

/** Builds a floating-floating connector fixture between two world points. */
function makeFloatingConnector(
  start: { x: number; y: number },
  end: { x: number; y: number },
): ConnectorObjectData {
  return connectorFromEndpoints(
    { objectId: null, anchorIndex: 0, position: vec2(start.x, start.y) },
    { objectId: null, anchorIndex: 0, position: vec2(end.x, end.y) },
    CONNECTOR_STYLE,
    "conn-1",
    2,
  );
}

/** Everything the select tool needs, wired with real production classes. */
interface Harness {
  readonly tool: SelectTool;
  readonly scene: Scene;
  readonly history: HistoryManager;
  readonly handles: HandlesRenderer;
  readonly bus: EventBus<AppEventMap>;
  readonly resizeLive: ReturnType<typeof vi.fn>;
}

/** Builds the tool harness over the given objects (shapes first, then shapes+connector). */
function makeHarness(objects: readonly SceneObjectData[]): Harness {
  const scene = new Scene();
  for (const object of objects) {
    scene.add(object);
  }
  const history = new HistoryManager();
  const bus = new EventBus<AppEventMap>();
  const resizeLive = vi.fn();
  bus.on("resize:live", resizeLive);
  const handles = new HandlesRenderer();
  const tool = new SelectTool({
    scene,
    history,
    selection: scene.selection,
    coalescer: new Coalescer(),
    marquee: new MarqueeLogic(scene),
    handles,
    bus,
    getFontSize: () => 20,
    ids: new IdGenerator("obj"),
  });
  return { tool, scene, history, handles, bus, resizeLive };
}

/** Builds the standard glued-scene harness (two shapes + glued connector). */
function makeGluedHarness(): Harness & { connector: ConnectorObjectData } {
  const harness = makeHarness([
    makeShape("shape-a", 0, 0, 100, 100),
    makeShape("shape-b", 300, 0, 400, 100),
    makeGluedConnector(),
  ]);
  return { ...harness, connector: getConnector(harness.scene) };
}

/** Returns the scene's connector, failing loudly when absent or duplicated. */
function getConnector(scene: Scene): ConnectorObjectData {
  const object = scene.findById("conn-1");
  if (object === undefined || !isConnectorObject(object)) {
    throw new Error("expected the connector");
  }
  return object;
}

/** Clicks the connector's path midpoint to select it (plain press-release). */
function selectConnector(harness: Harness, x = 200, y = 50): void {
  harness.tool.onPointerDown(pointer(x, y));
  harness.tool.onPointerUp(pointer(x, y));
}

describe("SelectTool connector selection", () => {
  it("selects a connector by clicking its path", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    expect(harness.scene.selection.has("conn-1")).toBe(true);
    expect(harness.scene.selection.size).toBe(1);
  });

  it("keeps the connector selected through a second plain click", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    selectConnector(harness, 200, 50);
    expect(harness.scene.selection.has("conn-1")).toBe(true);
  });
});

describe("SelectTool reconnect gesture", () => {
  it("begins a reconnect on a press within the endpoint tolerance (11 px)", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    // (305, 55) is 7.07 units from the end endpoint (300, 50) — inside 11.
    harness.tool.onPointerDown(pointer(305, 55));
    // The reconnect press neither changes the selection nor the connector.
    expect(harness.scene.selection.has("conn-1")).toBe(true);
    expect(getConnector(harness.scene)).toEqual(harness.connector);
    // Live frames update the endpoint: floating over empty canvas.
    harness.tool.onPointerMove(pointer(500, 100));
    const updated = getConnector(harness.scene);
    expect(updated.end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(500, 100),
    });
    expect(updated.start).toEqual(harness.connector.start);
  });

  it("re-glues the endpoint onto another object's nearest anchor", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    harness.tool.onPointerDown(pointer(305, 55));
    // Drag the end over shape-a, clear of the connector's own path: (30, 90)
    // resolves to a's S anchor (50, 100).
    harness.tool.onPointerMove(pointer(30, 90));
    harness.tool.onPointerUp(pointer(30, 90));
    const updated = getConnector(harness.scene);
    expect(updated.end).toEqual({
      objectId: "shape-a",
      anchorIndex: 2,
      position: vec2(50, 100),
    });
    expect(updated.start).toEqual(harness.connector.start);
  });

  it("never treats the connector itself as a re-glue target", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    harness.tool.onPointerDown(pointer(305, 55));
    // (200, 50) lies ON the connector's own path — an ordinary hit, but the
    // reconnect candidate must float there instead of gluing to itself.
    harness.tool.onPointerMove(pointer(200, 50));
    harness.tool.onPointerUp(pointer(200, 50));
    const updated = getConnector(harness.scene);
    expect(updated.end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(200, 50),
    });
    expect(updated.start).toEqual(harness.connector.start);
  });

  it("commits exactly one UpdateObjectCommand whose undo restores the snapshot", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    harness.tool.onPointerDown(pointer(305, 55));
    harness.tool.onPointerMove(pointer(500, 100));
    harness.tool.onPointerUp(pointer(500, 100));
    expect(harness.history.canUndo()).toBe(true);
    const command = harness.history.undo();
    if (command === null || !(command instanceof UpdateObjectCommand)) {
      throw new Error("expected a single UpdateObjectCommand");
    }
    expect(command.label).toBe("command.updateObject");
    expect(command.patch).toEqual({
      end: { objectId: null, anchorIndex: 0, position: vec2(500, 100) },
    });
    expect(command.before).toBe(harness.connector);
    // One entry only, and the undo restored the pre-gesture snapshot.
    expect(harness.history.canUndo()).toBe(false);
    expect(getConnector(harness.scene)).toEqual(harness.connector);
    // Redo re-applies the endpoint patch.
    harness.history.redo();
    expect(getConnector(harness.scene).end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(500, 100),
    });
  });

  it("grabs the start endpoint when the press is equidistant to both", () => {
    const harness = makeHarness([
      makeFloatingConnector({ x: 0, y: 0 }, { x: 20, y: 0 }),
    ]);
    selectConnector(harness, 10, 0);
    // (10, 0) is 10 units from both endpoints; the start wins the tie.
    harness.tool.onPointerDown(pointer(10, 0));
    harness.tool.onPointerMove(pointer(50, 30));
    harness.tool.onPointerUp(pointer(50, 30));
    const updated = getConnector(harness.scene);
    expect(updated.start).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(50, 30),
    });
    expect(updated.end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(20, 0),
    });
  });

  it("grabs the end endpoint when the press is closer to it", () => {
    const harness = makeHarness([
      makeFloatingConnector({ x: 0, y: 0 }, { x: 200, y: 0 }),
    ]);
    selectConnector(harness, 100, 0);
    harness.tool.onPointerDown(pointer(195, 0));
    harness.tool.onPointerMove(pointer(210, 0));
    harness.tool.onPointerUp(pointer(210, 0));
    const updated = getConnector(harness.scene);
    expect(updated.end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(210, 0),
    });
    expect(updated.start).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(0, 0),
    });
  });

  it("accepts a press exactly at the endpoint tolerance (11 px)", () => {
    const harness = makeHarness([
      makeFloatingConnector({ x: 0, y: 0 }, { x: 200, y: 0 }),
    ]);
    selectConnector(harness, 100, 0);
    harness.tool.onPointerDown(pointer(211, 0));
    harness.tool.onPointerMove(pointer(250, 0));
    expect(getConnector(harness.scene).end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(250, 0),
    });
    // Escape restores the snapshot and reports the consumed cancel.
    expect(harness.tool.onCancel()).toBe(true);
    expect(getConnector(harness.scene).end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(200, 0),
    });
  });

  it("rejects a press beyond the endpoint tolerance (11.5 px)", () => {
    const harness = makeHarness([
      makeFloatingConnector({ x: 0, y: 0 }, { x: 200, y: 0 }),
    ]);
    selectConnector(harness, 100, 0);
    harness.tool.onPointerDown(pointer(211.5, 0));
    // No reconnect opened: Escape is not consumed (a marquee began instead).
    expect(harness.tool.onCancel()).toBe(false);
    harness.tool.onPointerUp(pointer(211.5, 0));
    expect(getConnector(harness.scene).end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(200, 0),
    });
    // The degenerate marquee selected nothing, so the selection is empty now.
    expect(harness.scene.selection.isEmpty()).toBe(true);
  });

  it("Escape restores the before snapshot without any history entry", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    harness.tool.onPointerDown(pointer(305, 55));
    harness.tool.onPointerMove(pointer(500, 100));
    // Live frame applied; escape must roll it back out of history.
    expect(getConnector(harness.scene).end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(500, 100),
    });
    expect(harness.tool.onCancel()).toBe(true);
    expect(getConnector(harness.scene)).toEqual(harness.connector);
    expect(harness.history.canUndo()).toBe(false);
    expect(harness.history.canRedo()).toBe(false);
    // A second escape is not consumed (the tool is idle again).
    expect(harness.tool.onCancel()).toBe(false);
  });

  it("onDeactivate commits an open reconnect gesture into history", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    harness.tool.onPointerDown(pointer(305, 55));
    harness.tool.onPointerMove(pointer(500, 100));
    harness.tool.onDeactivate();
    expect(getConnector(harness.scene).end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(500, 100),
    });
    expect(harness.history.canUndo()).toBe(true);
    harness.history.undo();
    expect(getConnector(harness.scene)).toEqual(harness.connector);
  });

  it("survives the connector being deleted mid-gesture (no commit)", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    harness.tool.onPointerDown(pointer(305, 55));
    harness.scene.remove("conn-1");
    expect(() => {
      harness.tool.onPointerMove(pointer(500, 100));
      harness.tool.onPointerUp(pointer(500, 100));
    }).not.toThrow();
    expect(harness.history.canUndo()).toBe(false);
    expect(harness.scene.objectCount).toBe(2);
  });

  it("suppresses the endpoint probe while more than one object is selected", () => {
    const harness = makeGluedHarness();
    harness.scene.selection.replaceAll(["conn-1", "shape-a"]);
    // The press lands on shape-b instead: a plain selection press.
    harness.tool.onPointerDown(pointer(305, 55));
    harness.tool.onPointerUp(pointer(305, 55));
    expect(harness.scene.selection.has("shape-b")).toBe(true);
    expect(harness.scene.selection.size).toBe(1);
    expect(getConnector(harness.scene)).toEqual(harness.connector);
  });

  it("ignores endpoint presses on a locked connector", () => {
    const scene = new Scene();
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    scene.add(makeShape("shape-b", 300, 0, 400, 100));
    const connector: ConnectorObjectData = {
      ...makeGluedConnector(),
      locked: true,
    };
    scene.add(connector);
    const history = new HistoryManager();
    const tool = new SelectTool({
      scene,
      history,
      selection: scene.selection,
      coalescer: new Coalescer(),
      marquee: new MarqueeLogic(scene),
      handles: new HandlesRenderer(),
      bus: new EventBus<AppEventMap>(),
      getFontSize: () => 20,
      ids: new IdGenerator("obj"),
    });
    scene.selection.replaceAll(["conn-1"]);
    tool.onPointerDown(pointer(305, 55));
    tool.onPointerUp(pointer(305, 55));
    // The locked connector is untouched and was never re-glued.
    expect(getConnector(scene)).toEqual(connector);
    expect(history.canUndo()).toBe(false);
  });
});

describe("SelectTool connector affordances", () => {
  it("offers no resize handles for a selected connector (re-glue instead)", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    // The union box's top-edge midpoint (200, 49) is where the "n" handle of
    // a rect-like object would sit — a connector must offer no cursor there.
    expect(harness.tool.hoverCursor(pointer(200, 49))).toBeNull();
    // Its corners are endpoint dots, not resize handles.
    expect(harness.tool.hoverCursor(pointer(99, 49))).toBe("pointer");
    expect(harness.tool.hoverCursor(pointer(301, 51))).toBe("pointer");
    // A press-release there opens no resize gesture.
    harness.tool.onPointerDown(pointer(200, 49));
    harness.tool.onPointerUp(pointer(200, 49));
    expect(harness.resizeLive).not.toHaveBeenCalled();
    expect(harness.history.canUndo()).toBe(false);
    expect(getConnector(harness.scene)).toEqual(harness.connector);
  });

  it("advertises the pointer cursor near endpoint dots and null elsewhere", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    expect(harness.tool.hoverCursor(pointer(305, 55))).toBe("pointer");
    expect(harness.tool.hoverCursor(pointer(105, 55))).toBe("pointer");
    expect(harness.tool.hoverCursor(pointer(500, 500))).toBeNull();
    expect(harness.tool.hoverCursor(pointer(200, 50))).toBeNull();
  });

  it("advertises the pointer cursor throughout an active reconnect", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    harness.tool.onPointerDown(pointer(305, 55));
    expect(harness.tool.hoverCursor(pointer(600, 600))).toBe("pointer");
    harness.tool.onCancel();
  });

  it("reports nothing to cancel while idle", () => {
    const harness = makeGluedHarness();
    expect(harness.tool.onCancel()).toBe(false);
  });

  it("dragging a half-glued connector body moves only the floating end", () => {
    const scene = new Scene();
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    const connector = connectorFromEndpoints(
      { objectId: "shape-a", anchorIndex: 1, position: vec2(100, 50) },
      { objectId: null, anchorIndex: 0, position: vec2(300, 50) },
      CONNECTOR_STYLE,
      "conn-1",
      2,
    );
    scene.add(connector);
    const history = new HistoryManager();
    const tool = new SelectTool({
      scene,
      history,
      selection: scene.selection,
      coalescer: new Coalescer(),
      marquee: new MarqueeLogic(scene),
      handles: new HandlesRenderer(),
      bus: new EventBus<AppEventMap>(),
      getFontSize: () => 20,
      ids: new IdGenerator("obj"),
    });
    // Select by clicking the path, then drag the body by (40, 0).
    tool.onPointerDown(pointer(200, 50));
    tool.onPointerUp(pointer(200, 50));
    tool.onPointerDown(pointer(200, 50));
    tool.onPointerMove(pointer(240, 50));
    // A zero-delta frame is a no-op, and frames after the selection empties
    // are dropped entirely — neither moves the connector further.
    tool.onPointerMove(pointer(240, 50));
    scene.selection.clear();
    tool.onPointerMove(pointer(280, 50));
    tool.onPointerUp(pointer(280, 50));
    const moved = getConnector(scene);
    // The glued start re-snapped; only the floating end moved.
    expect(moved.start).toEqual({
      objectId: "shape-a",
      anchorIndex: 1,
      position: vec2(100, 50),
    });
    expect(moved.end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(340, 50),
    });
    // One move command in history; undo restores the floating end.
    expect(history.canUndo()).toBe(true);
    history.undo();
    const restored = getConnector(scene);
    expect(restored.start).toEqual({
      objectId: "shape-a",
      anchorIndex: 1,
      position: vec2(100, 50),
    });
    expect(restored.end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(300, 50),
    });
  });

  it("advertises the move cursor during a body drag and null during a press", () => {
    const scene = new Scene();
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    scene.add(
      connectorFromEndpoints(
        { objectId: "shape-a", anchorIndex: 1, position: vec2(100, 50) },
        { objectId: null, anchorIndex: 0, position: vec2(300, 50) },
        CONNECTOR_STYLE,
        "conn-1",
        2,
      ),
    );
    const tool = new SelectTool({
      scene,
      history: new HistoryManager(),
      selection: scene.selection,
      coalescer: new Coalescer(),
      marquee: new MarqueeLogic(scene),
      handles: new HandlesRenderer(),
      bus: new EventBus<AppEventMap>(),
      getFontSize: () => 20,
      ids: new IdGenerator("obj"),
    });
    tool.onPointerDown(pointer(200, 50));
    tool.onPointerUp(pointer(200, 50));
    tool.onPointerDown(pointer(200, 50));
    // Press phase: no cursor refinement yet.
    expect(tool.hoverCursor(pointer(200, 60))).toBeNull();
    tool.onPointerMove(pointer(240, 50));
    expect(tool.hoverCursor(pointer(245, 50))).toBe("move");
    tool.onPointerUp(pointer(240, 50));
  });

  it("a selected shape offers resize-handle cursors where a connector offers none", () => {
    const harness = makeGluedHarness();
    // Contrast probe: a plain shape's top-edge handle position.
    harness.scene.selection.replaceAll(["shape-a"]);
    expect(harness.tool.hoverCursor(pointer(50, -1))).toBe("nsResize");
    expect(harness.tool.hoverCursor(pointer(500, 500))).toBeNull();
    // The connector at the same kind of position offers nothing.
    harness.scene.selection.replaceAll(["conn-1"]);
    expect(harness.tool.hoverCursor(pointer(200, 49))).toBeNull();
  });
});

describe("SelectTool connector-adjacent gestures", () => {
  it("onActivate drops an open reconnect gesture and restores the snapshot", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    harness.tool.onPointerDown(pointer(305, 55));
    harness.tool.onPointerMove(pointer(500, 100));
    expect(getConnector(harness.scene).end).not.toEqual(harness.connector.end);
    harness.tool.onActivate();
    expect(getConnector(harness.scene)).toEqual(harness.connector);
    expect(harness.history.canUndo()).toBe(false);
  });

  it("onDeactivate while idle is harmless", () => {
    const harness = makeGluedHarness();
    expect(() => harness.tool.onDeactivate()).not.toThrow();
    expect(getConnector(harness.scene)).toEqual(harness.connector);
  });

  it("onDeactivate during a connector body drag commits the move", () => {
    const scene = new Scene();
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    scene.add(
      connectorFromEndpoints(
        { objectId: "shape-a", anchorIndex: 1, position: vec2(100, 50) },
        { objectId: null, anchorIndex: 0, position: vec2(300, 50) },
        CONNECTOR_STYLE,
        "conn-1",
        2,
      ),
    );
    const history = new HistoryManager();
    const tool = new SelectTool({
      scene,
      history,
      selection: scene.selection,
      coalescer: new Coalescer(),
      marquee: new MarqueeLogic(scene),
      handles: new HandlesRenderer(),
      bus: new EventBus<AppEventMap>(),
      getFontSize: () => 20,
      ids: new IdGenerator("obj"),
    });
    tool.onPointerDown(pointer(200, 50));
    tool.onPointerUp(pointer(200, 50));
    tool.onPointerDown(pointer(200, 50));
    tool.onPointerMove(pointer(240, 50));
    tool.onDeactivate();
    expect(getConnector(scene).end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(340, 50),
    });
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(getConnector(scene).end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(300, 50),
    });
  });

  it("ignores presses of non-primary buttons on a selected connector", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    harness.tool.onPointerDown(pointer(305, 55, 1));
    harness.tool.onPointerUp(pointer(305, 55, 1));
    expect(getConnector(harness.scene)).toEqual(harness.connector);
    expect(harness.scene.selection.has("conn-1")).toBe(true);
    expect(harness.history.canUndo()).toBe(false);
  });

  it("shift-click toggles a connector out of the selection", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    expect(harness.scene.selection.has("conn-1")).toBe(true);
    harness.tool.onPointerDown(shiftPointer(200, 50));
    harness.tool.onPointerUp(shiftPointer(200, 50));
    expect(harness.scene.selection.isEmpty()).toBe(true);
    expect(getConnector(harness.scene)).toEqual(harness.connector);
  });

  it("dragging after a shift-toggle-off keeps the connector put (nothing selected)", () => {
    const harness = makeGluedHarness();
    selectConnector(harness);
    harness.tool.onPointerDown(shiftPointer(200, 50));
    // Toggle-off emptied the selection; crossing the drag threshold must not
    // move anything (the press stays idle instead of promoting to a move).
    harness.tool.onPointerMove(pointer(240, 50));
    harness.tool.onPointerUp(pointer(240, 50));
    expect(getConnector(harness.scene)).toEqual(harness.connector);
    expect(harness.history.canUndo()).toBe(false);
  });

  it("a plain click on the connector collapses a multi-selection to it", () => {
    const harness = makeGluedHarness();
    harness.scene.selection.replaceAll(["conn-1", "shape-a"]);
    harness.tool.onPointerDown(pointer(200, 50));
    harness.tool.onPointerUp(pointer(200, 50));
    expect(harness.scene.selection.size).toBe(1);
    expect(harness.scene.selection.has("conn-1")).toBe(true);
  });

  it("a marquee drag selects a connector intersecting the rectangle", () => {
    const harness = makeGluedHarness();
    // Press on empty canvas above the connector path, drag a rect over it.
    harness.tool.onPointerDown(pointer(150, 20));
    harness.tool.onPointerMove(pointer(250, 80));
    expect(harness.tool.hoverCursor(pointer(250, 80))).toBe("crosshair");
    harness.tool.onPointerUp(pointer(250, 80));
    expect(harness.scene.selection.size).toBe(1);
    expect(harness.scene.selection.has("conn-1")).toBe(true);
    expect(getConnector(harness.scene)).toEqual(harness.connector);
  });
});
