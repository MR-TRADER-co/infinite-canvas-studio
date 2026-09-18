/** Unit tests for the connector tool (rubber-band creation gesture). */
import { describe, expect, it, vi } from "vitest";
import { ConnectorTool } from "@/interaction/ConnectorTool";
import { ConnectorOverlay } from "@/rendering/ConnectorOverlay";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { Scene } from "@/core/model/Scene";
import {
  connectorFromEndpoints,
  isConnectorObject,
} from "@/core/model/ConnectorObject";
import type { ConnectorStyle } from "@/core/model/ConnectorObject";
import { SHAPE_FILL_TOKEN, STROKE_COLOR_TOKEN } from "@/core/model/ShapeObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { ToolPointerEvent } from "@/interaction/Tool";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";

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

/** Everything the connector tool needs, wired with real production classes. */
interface Harness {
  readonly tool: ConnectorTool;
  readonly scene: Scene;
  readonly history: HistoryManager;
  readonly overlay: ConnectorOverlay;
  readonly ids: IdGenerator;
  /** Swaps the style the tool resolves for the next draft/commit. */
  setStyle(style: ConnectorStyle): void;
}

/** Builds the standard two-shape scene and tool harness. */
function makeHarness(): Harness {
  const scene = new Scene();
  scene.add(makeShape("shape-a", 0, 0, 100, 100));
  scene.add(makeShape("shape-b", 300, 0, 400, 100));
  const history = new HistoryManager();
  const overlay = new ConnectorOverlay();
  const ids = new IdGenerator("conn");
  let style: ConnectorStyle = {
    color: "#38bdf8",
    width: 3,
    dash: "dashed",
    routing: "orthogonal",
    startArrow: "arrow",
    endArrow: "none",
  };
  const tool = new ConnectorTool({
    scene,
    history,
    ids,
    overlay,
    getConnectorStyle: () => style,
  });
  return {
    tool,
    scene,
    history,
    overlay,
    ids,
    setStyle(next: ConnectorStyle) {
      style = next;
    },
  };
}

/** Returns the scene's only connector, failing loudly when absent. */
function onlyConnector(scene: Scene): SceneObjectData {
  const connectors = scene.objects.filter(isConnectorObject);
  if (connectors.length !== 1) {
    throw new Error(
      `expected exactly one connector, found ${connectors.length}`,
    );
  }
  return connectors[0] as SceneObjectData;
}

describe("ConnectorTool metadata", () => {
  it("exposes the connector tool id and the crosshair cursor", () => {
    const { tool } = makeHarness();
    expect(tool.id).toBe("connector");
    expect(tool.cursor).toBe("crosshair");
  });
});

describe("ConnectorTool pointer down", () => {
  it("glues the start endpoint to the pressed object's nearest anchor", () => {
    const { tool, overlay } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(150, 50));
    const draft = overlay.current;
    if (draft === null) {
      throw new Error("expected a live draft");
    }
    // Anchor 1 (E) of the (0,0,100,100) box sits at (100, 50).
    expect(draft.start).toEqual({
      objectId: "shape-a",
      anchorIndex: 1,
      position: vec2(100, 50),
    });
  });

  it("snaps to the corner anchor when pressing near a corner", () => {
    const { tool, overlay } = makeHarness();
    tool.onPointerDown(pointer(9, 9));
    tool.onPointerMove(pointer(50, 50));
    expect(overlay.current?.start).toEqual({
      objectId: "shape-a",
      anchorIndex: 7,
      position: vec2(0, 0),
    });
  });

  it("starts nothing on a press over empty canvas", () => {
    const { tool, overlay, scene } = makeHarness();
    tool.onPointerDown(pointer(500, 500));
    tool.onPointerMove(pointer(520, 520));
    tool.onPointerUp(pointer(520, 520));
    expect(overlay.current).toBeNull();
    expect(scene.objectCount).toBe(2);
  });

  it("starts nothing on a press over an existing connector", () => {
    const { tool, scene, overlay } = makeHarness();
    scene.add(
      connectorFromEndpoints(
        { objectId: null, anchorIndex: 0, position: vec2(0, 200) },
        { objectId: null, anchorIndex: 0, position: vec2(100, 200) },
        {
          color: "#38bdf8",
          width: 2,
          dash: "solid",
          routing: "straight",
          startArrow: "none",
          endArrow: "arrow",
        },
        "conn-existing",
        2,
      ),
    );
    tool.onPointerDown(pointer(50, 200));
    tool.onPointerMove(pointer(150, 200));
    tool.onPointerUp(pointer(150, 200));
    expect(overlay.current).toBeNull();
    expect(scene.objectCount).toBe(3);
    expect(onlyConnector(scene).id).toBe("conn-existing");
  });

  it("ignores presses of non-primary buttons", () => {
    const { tool, overlay, scene } = makeHarness();
    tool.onPointerDown(pointer(50, 50, 1));
    tool.onPointerMove(pointer(150, 50));
    tool.onPointerUp(pointer(150, 50));
    expect(overlay.current).toBeNull();
    expect(scene.objectCount).toBe(2);
  });

  it("ignores pointer moves and releases without a preceding press", () => {
    const { tool, overlay, scene } = makeHarness();
    tool.onPointerMove(pointer(150, 50));
    expect(overlay.current).toBeNull();
    tool.onPointerUp(pointer(150, 50));
    expect(scene.objectCount).toBe(2);
  });
});

describe("ConnectorTool draft streaming", () => {
  it("begins the draft on the first move and updates it on every later one", () => {
    const { tool, overlay } = makeHarness();
    const notify = vi.fn();
    overlay.setNotifier(notify);
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(150, 60));
    const first = overlay.current;
    expect(first).not.toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
    tool.onPointerMove(pointer(200, 80));
    const second = overlay.current;
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(notify).toHaveBeenCalledTimes(2);
    if (first === null || second === null) {
      throw new Error("expected live drafts");
    }
    expect(first.end.position).toEqual(vec2(150, 60));
    expect(second.end.position).toEqual(vec2(200, 80));
  });

  it("glues the draft end to the hovered object's nearest anchor", () => {
    const { tool, overlay } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(301, 50));
    expect(overlay.current?.end).toEqual({
      objectId: "shape-b",
      anchorIndex: 3,
      position: vec2(300, 50),
    });
  });

  it("floats the draft end over empty canvas at the pointer", () => {
    const { tool, overlay } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(600, 120));
    expect(overlay.current?.end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(600, 120),
    });
  });

  it("re-queries the style provider for every move", () => {
    const { tool, overlay, setStyle } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(150, 50));
    const first = overlay.current;
    setStyle({
      color: "#22c55e",
      width: 5,
      dash: "dotted",
      routing: "curved",
      startArrow: "none",
      endArrow: "none",
    });
    tool.onPointerMove(pointer(200, 50));
    const second = overlay.current;
    if (first === null || second === null) {
      throw new Error("expected live drafts");
    }
    expect(first.style.routing).toBe("orthogonal");
    expect(second.style.routing).toBe("curved");
  });
});

describe("ConnectorTool release (commit)", () => {
  it("commits a glued-to-glued connector through one history entry", () => {
    const { tool, scene, history } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(301, 50));
    tool.onPointerUp(pointer(301, 50));
    expect(scene.objectCount).toBe(3);
    expect(onlyConnector(scene)).toEqual({
      id: "conn-1",
      kind: "connector",
      position: vec2(200, 50),
      rotation: 0,
      zIndex: 1,
      visible: true,
      locked: false,
      start: { objectId: "shape-a", anchorIndex: 1, position: vec2(100, 50) },
      end: { objectId: "shape-b", anchorIndex: 3, position: vec2(300, 50) },
      routingKind: "orthogonal",
      strokeColor: "#38bdf8",
      strokeWidth: 3,
      strokeStyle: "dashed",
      startArrow: "arrow",
      endArrow: "none",
    });
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(scene.objectCount).toBe(2);
    history.redo();
    expect(scene.objectCount).toBe(3);
  });

  it("commits a glued-to-floating connector when released over empty canvas", () => {
    const { tool, scene, history } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(600, 60));
    tool.onPointerUp(pointer(600, 60));
    const connector = onlyConnector(scene);
    if (!isConnectorObject(connector)) {
      throw new Error("expected a connector");
    }
    expect(connector.start).toEqual({
      objectId: "shape-a",
      anchorIndex: 1,
      position: vec2(100, 50),
    });
    expect(connector.end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(600, 60),
    });
    expect(history.canUndo()).toBe(true);
  });

  it("uses the current style at commit time", () => {
    const { tool, scene, setStyle } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(301, 50));
    setStyle({
      color: "#22c55e",
      width: 5,
      dash: "dotted",
      routing: "curved",
      startArrow: "none",
      endArrow: "none",
    });
    tool.onPointerUp(pointer(301, 50));
    const connector = onlyConnector(scene);
    if (!isConnectorObject(connector)) {
      throw new Error("expected a connector");
    }
    expect(connector.strokeColor).toBe("#22c55e");
    expect(connector.routingKind).toBe("curved");
  });

  it("clears the overlay draft on release", () => {
    const { tool, overlay } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(301, 50));
    tool.onPointerUp(pointer(301, 50));
    expect(overlay.current).toBeNull();
  });

  it("commits a drag of exactly the tap threshold (6 screen px)", () => {
    const { tool, scene, history } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    // Exactly 6 px of screen movement counts as a drag, and the release point
    // floats far enough from the glued anchor to differ.
    tool.onPointerUp(pointer(105, 50));
    expect(scene.objectCount).toBe(3);
    expect(history.canUndo()).toBe(true);
  });
});

describe("ConnectorTool release (cancel paths)", () => {
  it("cancels when released over the same object the gesture started on", () => {
    const { tool, scene, history, overlay } = makeHarness();
    tool.onPointerDown(pointer(10, 10));
    tool.onPointerMove(pointer(90, 90));
    tool.onPointerUp(pointer(90, 90));
    expect(scene.objectCount).toBe(2);
    expect(history.canUndo()).toBe(false);
    expect(overlay.current).toBeNull();
  });

  it("a sub-threshold tap ARMS the start for click-click mode (no commit yet)", () => {
    const { tool, scene, history } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(100, 51));
    tool.onPointerUp(pointer(101, 51));
    expect(scene.objectCount).toBe(2);
    expect(history.canUndo()).toBe(false);
  });

  it("click-click: tap on A then click on B commits the connector", () => {
    const { tool, scene, history, overlay } = makeHarness();
    // First click: press + release on shape-a (sub-threshold = tap).
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerUp(pointer(100, 51));
    // The armed draft follows the cursor.
    tool.onPointerMove(pointer(200, 50));
    expect(overlay.current).not.toBeNull();
    // Second click: press on shape-b commits immediately.
    tool.onPointerDown(pointer(301, 50));
    expect(scene.objectCount).toBe(3);
    expect(history.canUndo()).toBe(true);
    expect(overlay.current).toBeNull();
    // The trailing release is a no-op.
    tool.onPointerUp(pointer(301, 50));
    expect(scene.objectCount).toBe(3);
    const connector = scene.objects.find(isConnectorObject);
    expect(connector).toBeDefined();
  });

  it("click-click: tapping the SAME object twice disarms without committing", () => {
    const { tool, scene, history, overlay } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerUp(pointer(100, 51));
    tool.onPointerDown(pointer(20, 50));
    expect(scene.objectCount).toBe(2);
    expect(history.canUndo()).toBe(false);
    expect(overlay.current).toBeNull();
  });

  it("click-click: clicking empty canvas after arming disarms", () => {
    const { tool, scene, overlay } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerUp(pointer(100, 51));
    tool.onPointerDown(pointer(150, 50));
    expect(scene.objectCount).toBe(2);
    expect(overlay.current).toBeNull();
  });

  it("click-click: Escape disarms the armed start", () => {
    const { tool, scene, overlay } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerUp(pointer(100, 51));
    tool.onPointerMove(pointer(200, 50));
    expect(overlay.current).not.toBeNull();
    expect(tool.onCancel()).toBe(true);
    expect(overlay.current).toBeNull();
    expect(scene.objectCount).toBe(2);
    // A subsequent press starts a fresh gesture (nothing armed).
    tool.onPointerDown(pointer(20, 50));
    tool.onPointerUp(pointer(20, 50));
    expect(scene.objectCount).toBe(2);
  });

  it("click-click: switching tools disarms the armed start", () => {
    const { tool, scene, overlay } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerUp(pointer(100, 51));
    tool.onDeactivate();
    expect(overlay.current).toBeNull();
    expect(scene.objectCount).toBe(2);
  });

  it("cancels when both endpoints resolve to the same world position", () => {
    // shape-c sits directly right of shape-a: its W anchor (100, 50) coincides
    // with shape-a's E anchor, so glued→glued endpoints collapse to one point.
    const scene = new Scene();
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    scene.add(makeShape("shape-c", 100, 0, 200, 100));
    const history = new HistoryManager();
    const tool = new ConnectorTool({
      scene,
      history,
      ids: new IdGenerator("conn"),
      overlay: new ConnectorOverlay(),
      getConnectorStyle: () => ({
        color: "#38bdf8",
        width: 2,
        dash: "solid",
        routing: "straight",
        startArrow: "none",
        endArrow: "arrow",
      }),
    });
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(105, 50));
    tool.onPointerUp(pointer(105, 50));
    expect(scene.objectCount).toBe(2);
    expect(history.canUndo()).toBe(false);
  });
});

describe("ConnectorTool cancel and lifecycle", () => {
  it("Escape drops the running draft and reports consumed (true), false when idle", () => {
    const { tool, overlay, scene, history } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(150, 50));
    expect(overlay.current).not.toBeNull();
    expect(tool.onCancel()).toBe(true);
    expect(overlay.current).toBeNull();
    expect(scene.objectCount).toBe(2);
    expect(history.canUndo()).toBe(false);
    expect(tool.onCancel()).toBe(false);
    // The cancelled gesture is fully gone: a stray release commits nothing.
    tool.onPointerUp(pointer(301, 50));
    expect(scene.objectCount).toBe(2);
  });

  it("onActivate drops an open draft and resets the gesture", () => {
    const { tool, overlay, scene } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(150, 50));
    tool.onActivate();
    expect(overlay.current).toBeNull();
    tool.onPointerUp(pointer(301, 50));
    expect(scene.objectCount).toBe(2);
  });

  it("onDeactivate drops an open draft and resets the gesture", () => {
    const { tool, overlay, scene } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(150, 50));
    tool.onDeactivate();
    expect(overlay.current).toBeNull();
    tool.onPointerUp(pointer(301, 50));
    expect(scene.objectCount).toBe(2);
  });

  it("lifecycle calls on an idle tool are harmless", () => {
    const { tool, overlay } = makeHarness();
    expect(() => {
      tool.onActivate();
      tool.onDeactivate();
      tool.onCancel();
    }).not.toThrow();
    expect(overlay.current).toBeNull();
  });
});

describe("ConnectorTool hoverCursor", () => {
  it("advertises pointer over an object", () => {
    const { tool } = makeHarness();
    expect(tool.hoverCursor(pointer(50, 50))).toBe("pointer");
  });

  it("falls back to null over empty canvas", () => {
    const { tool } = makeHarness();
    expect(tool.hoverCursor(pointer(500, 500))).toBeNull();
  });

  it("falls back to null over a connector (connections start on objects)", () => {
    const { tool, scene } = makeHarness();
    scene.add(
      connectorFromEndpoints(
        { objectId: null, anchorIndex: 0, position: vec2(0, 200) },
        { objectId: null, anchorIndex: 0, position: vec2(100, 200) },
        {
          color: "#38bdf8",
          width: 2,
          dash: "solid",
          routing: "straight",
          startArrow: "none",
          endArrow: "arrow",
        },
        "conn-existing",
        2,
      ),
    );
    expect(tool.hoverCursor(pointer(50, 200))).toBeNull();
  });
});

describe("ConnectorTool integration", () => {
  it("streams a full glued-to-glued gesture into the overlay before committing", () => {
    const { tool, overlay, scene } = makeHarness();
    tool.onPointerDown(pointer(99, 50));
    tool.onPointerMove(pointer(150, 50));
    tool.onPointerMove(pointer(301, 50));
    const draft = overlay.current;
    if (draft === null) {
      throw new Error("expected a live draft");
    }
    expect(draft.start.position).toEqual(vec2(100, 50));
    expect(draft.end.position).toEqual(vec2(300, 50));
    tool.onPointerUp(pointer(301, 50));
    expect(overlay.current).toBeNull();
    expect(scene.objectCount).toBe(3);
  });
});
