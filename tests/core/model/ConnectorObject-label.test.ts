/**
 * Unit tests for the R5.3 connector midpoint label: the path-midpoint
 * geometry (straight/elbow/bezier), the live label anchor following glued
 * endpoints, and the double-click intent wiring on the select tool.
 */
import { describe, expect, it, vi } from "vitest";
import {
  connectorFromEndpoints,
  connectorLabelAnchor,
  pathMidpoint,
  type ConnectorEndpoint,
  type ConnectorStyle,
} from "@/core/model/ConnectorObject";
import { vec2 } from "@/core/geometry/Vec2";
import { DEFAULT_CONNECTOR_STYLE } from "@/core/model/ConnectorObject";
import { SelectTool } from "@/interaction/SelectTool";
import { Coalescer } from "@/core/commands/Coalescer";
import { EventBus } from "@/core/events/EventBus";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { MarqueeLogic } from "@/interaction/MarqueeLogic";
import { HandlesRenderer } from "@/rendering/HandlesRenderer";
import { Scene } from "@/core/model/Scene";
import { Selection } from "@/core/selection/Selection";
import type { AppEventMap } from "@/core/events/EventBus";
import type { ToolPointerEvent } from "@/interaction/Tool";
import type { SceneObjectData } from "@/core/model/SceneObject";
import {
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN,
  type ShapeObjectData,
} from "@/core/model/ShapeObject";

/** Builds a normalised pointer payload (identity camera). */
function pointer(x: number, y: number): ToolPointerEvent {
  return {
    screen: vec2(x, y),
    world: vec2(x, y),
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
  };
}

/** Builds a floating endpoint at the given position. */
function floating(x: number, y: number): ConnectorEndpoint {
  return { objectId: null, anchorIndex: 0, position: vec2(x, y) };
}

describe("pathMidpoint", () => {
  it("returns the segment midpoint of a straight path", () => {
    const midpoint = pathMidpoint({
      points: [vec2(0, 0), vec2(100, 0)],
      bezier: false,
    });
    expect(midpoint).toEqual(vec2(50, 0));
  });

  it("walks the arc-length midpoint of an elbow path", () => {
    // Elbow: (0,0) → (0,50) → (100,50) → (100,100). Segment lengths
    // 50 + 100 + 50 = 200; half = 100 → 50 down, then 50 along the rail
    // → the midpoint sits exactly at (50, 50).
    const midpoint = pathMidpoint({
      points: [vec2(0, 0), vec2(0, 50), vec2(100, 50), vec2(100, 100)],
      bezier: false,
    });
    expect(midpoint).toEqual(vec2(50, 50));
  });

  it("evaluates the bezier at t = 0.5", () => {
    // Quadratic (0,0) C(0,100) E(100,100) at t=.5 = (25+50, 25+100−12.5)
    // → exactly ( (0+2·0+100)/4, (0+2·100+100)/4 ) = (25, 75).
    const midpoint = pathMidpoint({
      points: [vec2(0, 0), vec2(0, 100), vec2(100, 100)],
      bezier: true,
    });
    expect(midpoint).toEqual(vec2(25, 75));
  });

  it("degenerates for empty and single-point paths", () => {
    expect(pathMidpoint({ points: [], bezier: false })).toEqual(vec2(0, 0));
    expect(pathMidpoint({ points: [vec2(7, 8)], bezier: false })).toEqual(
      vec2(7, 8),
    );
  });
});

describe("connectorLabelAnchor", () => {
  const style: ConnectorStyle = { ...DEFAULT_CONNECTOR_STYLE };

  it("rides the midpoint of a floating connector", () => {
    const connector = connectorFromEndpoints(
      floating(0, 0),
      floating(100, 0),
      style,
      "c1",
      0,
    );
    expect(connectorLabelAnchor(connector, [])).toEqual(vec2(50, 0));
  });

  it("follows a moved glue target (AC5.3 live re-route)", () => {
    const target: ShapeObjectData = {
      id: "t1",
      kind: "shape",
      name: undefined,
      parentId: undefined,
      position: vec2(200, 0),
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      shapeKind: "rectangle",
      width: 100,
      height: 100,
      fill: SHAPE_FILL_TOKEN,
      stroke: STROKE_COLOR_TOKEN,
      strokeWidth: 0,
    };
    const connector = connectorFromEndpoints(
      floating(0, 50),
      { objectId: "t1", anchorIndex: 3, position: vec2(200, 50) },
      style,
      "c1",
      0,
    );
    // Anchor 3 of (200,0)-(300,100) is the left-middle (200,50).
    const anchorBefore = connectorLabelAnchor(connector, [target]);
    expect(anchorBefore).toEqual(vec2(100, 50));
    const moved = { ...target, position: vec2(400, 0) };
    const anchorAfter = connectorLabelAnchor(connector, [moved]);
    // Anchor 3 of (400,0)-(500,100) = (400,50): midpoint with (0,50).
    expect(anchorAfter).toEqual(vec2(200, 50));
  });

  it("returns null for corrupt connector data without endpoints", () => {
    const broken = {
      id: "c1",
      kind: "connector",
      position: vec2(0, 0),
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      routingKind: "straight" as const,
      strokeColor: "#000",
      strokeWidth: 2,
      strokeStyle: "solid" as const,
      startArrow: "none" as const,
      endArrow: "arrow" as const,
      label: "x",
    };
    expect(connectorLabelAnchor(broken as never, [])).toBeNull();
  });
});

describe("SelectTool double-click label intent (R5.3)", () => {
  /** Builds the select tool harness with the given objects. */
  function makeTool(objects: readonly SceneObjectData[]): {
    tool: SelectTool;
    bus: EventBus<AppEventMap>;
  } {
    const scene = new Scene();
    for (const object of objects) {
      scene.add(object);
    }
    const bus = new EventBus<AppEventMap>();
    const tool = new SelectTool({
      scene,
      history: new HistoryManager(),
      selection: new Selection(),
      coalescer: new Coalescer(),
      marquee: new MarqueeLogic(scene),
      handles: new HandlesRenderer(),
      bus,
      getFontSize: () => 20,
      ids: new IdGenerator("obj"),
    });
    return { tool, bus };
  }

  it("double-clicking a connector requests the label editor", () => {
    const connector = connectorFromEndpoints(
      floating(0, 0),
      floating(100, 0),
      DEFAULT_CONNECTOR_STYLE,
      "c1",
      0,
    );
    const { tool, bus } = makeTool([connector]);
    const handler = vi.fn();
    bus.on("ui:connector-label-requested", handler);
    tool.onDoubleClick(pointer(50, 0));
    expect(handler).toHaveBeenCalledWith({ objectId: "c1" });
  });

  it("double-clicking empty canvas still creates a text box (regression)", () => {
    const { tool, bus } = makeTool([]);
    const create = vi.fn();
    bus.on("text:create-requested", create);
    tool.onDoubleClick(pointer(50, 50));
    expect(create).toHaveBeenCalledTimes(1);
  });
});
