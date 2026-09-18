/** Unit tests for the connector object model (endpoints, routing, glue refresh). */
import { describe, expect, it } from "vitest";
import {
  CONNECTOR_ARROW_MODES,
  CONNECTOR_ROUTINGS,
  DEFAULT_CONNECTOR_STYLE,
  connectorBBox,
  connectorFromEndpoints,
  connectorPathShape,
  isConnectorObject,
  refreshGluedConnector,
  resolveConnectorEndpoint,
  resolveConnectorEndpoints,
  sampleConnectorPath,
} from "@/core/model/ConnectorObject";
import type {
  ConnectorEndpoint,
  ConnectorObjectData,
  ConnectorPathShape,
  ConnectorStyle,
} from "@/core/model/ConnectorObject";
import { STROKE_COLOR_TOKEN } from "@/core/model/FreehandObject";
import {
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN as SHAPE_STROKE_TOKEN,
} from "@/core/model/ShapeObject";
import { bbox } from "@/core/geometry/BBox";
import { vec2 } from "@/core/geometry/Vec2";
import type { Vec2 } from "@/core/geometry/Vec2";
import type {
  SceneObjectData,
  SceneObjectKind,
} from "@/core/model/SceneObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";

/** Style fixture differing from the defaults in every field. */
const STYLE: ConnectorStyle = {
  color: "#38bdf8",
  width: 3,
  dash: "dashed",
  routing: "orthogonal",
  startArrow: "arrow",
  endArrow: "none",
};

/** Builds a floating endpoint fixture at a fixed position. */
function floating(x: number, y: number): ConnectorEndpoint {
  return { objectId: null, anchorIndex: 0, position: vec2(x, y) };
}

/** Builds a glued endpoint fixture with an explicit cached position. */
function glued(
  objectId: string,
  anchorIndex: number,
  x: number,
  y: number,
): ConnectorEndpoint {
  return { objectId, anchorIndex, position: vec2(x, y) };
}

/** Builds a fully populated connector fixture (all base + kind fields). */
function makeConnector(): ConnectorObjectData {
  return connectorFromEndpoints(
    glued("shape-a", 1, 100, 50),
    floating(300, 50),
    DEFAULT_CONNECTOR_STYLE,
    "conn-1",
    4,
  );
}

/**
 * Builds a connector fixture with the given endpoints and routing kind, using
 * the default style for every other field.
 */
function makeRoutedConnector(
  start: ConnectorEndpoint,
  end: ConnectorEndpoint,
  routing: ConnectorObjectData["routingKind"],
  strokeWidth = 2,
): ConnectorObjectData {
  return connectorFromEndpoints(
    start,
    end,
    { ...DEFAULT_CONNECTOR_STYLE, routing, width: strokeWidth },
    "conn-1",
    0,
  );
}

/**
 * Builds a shape fixture whose bounds equal the given box exactly (zero
 * stroke width → no objectBBox padding, so anchors land on exact coordinates).
 */
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
    parentId: "group-1",
    position: vec2(minX, minY),
    rotation: 0,
    zIndex: 1,
    visible: true,
    locked: false,
    shapeKind: "rectangle",
    width: maxX - minX,
    height: maxY - minY,
    fill: SHAPE_FILL_TOKEN,
    stroke: SHAPE_STROKE_TOKEN,
    strokeWidth: 0,
  };
}

/** Base fields of a connector fixture, minus the fields the corrupt variants omit. */
type CorruptConnectorBase = Omit<
  ConnectorObjectData,
  "start" | "end" | "strokeWidth"
> & {
  strokeWidth?: number;
};

/**
 * Builds a connector-shaped fixture whose endpoint fields are missing
 * entirely (corrupt / hand-edited data — the guards must not crash on it).
 */
function makeCorruptConnector(
  position: Vec2,
  strokeWidth?: number,
): ConnectorObjectData {
  const base: CorruptConnectorBase = {
    id: "conn-1",
    kind: "connector",
    position,
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    routingKind: "straight",
    strokeColor: STROKE_COLOR_TOKEN,
    strokeWidth,
    strokeStyle: "solid",
    startArrow: "none",
    endArrow: "arrow",
  };
  return base as ConnectorObjectData;
}

/** Builds a minimal fixture of a kind that is not a connector. */
function makeOtherOfKind(kind: SceneObjectKind): SceneObjectData {
  return {
    id: `obj-${kind}`,
    kind,
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 1,
    visible: true,
    locked: false,
  };
}

describe("ConnectorObject constants", () => {
  it("exports the default style new connectors are created with", () => {
    expect(DEFAULT_CONNECTOR_STYLE).toEqual({
      color: STROKE_COLOR_TOKEN,
      width: 2,
      dash: "solid",
      routing: "straight",
      startArrow: "none",
      endArrow: "arrow",
    });
  });

  it("exports every routing kind", () => {
    expect(CONNECTOR_ROUTINGS).toEqual(["straight", "orthogonal", "curved"]);
  });

  it("exports every arrow placement preset", () => {
    expect(CONNECTOR_ARROW_MODES).toEqual(["none", "end", "both"]);
  });
});

describe("isConnectorObject", () => {
  it("narrows connector data", () => {
    expect(isConnectorObject(makeConnector())).toBe(true);
  });

  it("rejects every other object kind", () => {
    const kinds: SceneObjectKind[] = [
      "shape",
      "textBox",
      "stickyNote",
      "image",
      "freehand",
      "group",
    ];
    for (const kind of kinds) {
      expect(isConnectorObject(makeOtherOfKind(kind))).toBe(false);
    }
  });
});

describe("connectorFromEndpoints", () => {
  it("builds a connector from resolved endpoints and a style", () => {
    const start = glued("shape-a", 1, 100, 50);
    const end = glued("shape-b", 3, 300, 50);
    const connector = connectorFromEndpoints(start, end, STYLE, "conn-9", 7);
    expect(connector).toEqual({
      id: "conn-9",
      kind: "connector",
      position: vec2(200, 50),
      rotation: 0,
      zIndex: 7,
      visible: true,
      locked: false,
      start,
      end,
      routingKind: "orthogonal",
      strokeColor: "#38bdf8",
      strokeWidth: 3,
      strokeStyle: "dashed",
      startArrow: "arrow",
      endArrow: "none",
    });
  });

  it("positions the origin at the midpoint of the two endpoints", () => {
    const connector = connectorFromEndpoints(
      floating(0, 0),
      floating(100, 40),
      DEFAULT_CONNECTOR_STYLE,
      "conn-1",
      0,
    );
    expect(connector.position).toEqual(vec2(50, 20));
  });

  it("keeps the endpoint references it was given (immutable snapshot)", () => {
    const start = floating(0, 0);
    const end = floating(10, 10);
    const connector = connectorFromEndpoints(
      start,
      end,
      DEFAULT_CONNECTOR_STYLE,
      "c",
      0,
    );
    expect(connector.start).toBe(start);
    expect(connector.end).toBe(end);
  });
});

describe("resolveConnectorEndpoint", () => {
  it("returns the fixed position of a floating endpoint", () => {
    expect(resolveConnectorEndpoint(floating(12, 34), [])).toEqual(
      vec2(12, 34),
    );
  });

  it("re-derives a glued endpoint from the target's current bounds", () => {
    const target = makeShape("shape-a", 0, 0, 100, 100);
    // Anchor 1 (E) of a (0,0,100,100) box sits at (100, 50).
    expect(
      resolveConnectorEndpoint(glued("shape-a", 1, 90, 50), [target]),
    ).toEqual(vec2(100, 50));
  });

  it("re-derives corner anchors too (anchor 7 = NW)", () => {
    const target = makeShape("shape-a", 10, 20, 110, 120);
    expect(
      resolveConnectorEndpoint(glued("shape-a", 7, 0, 0), [target]),
    ).toEqual(vec2(10, 20));
  });

  it("falls back to the cached position when the target is missing", () => {
    expect(resolveConnectorEndpoint(glued("ghost", 1, 71, 82), [])).toEqual(
      vec2(71, 82),
    );
  });

  it("falls back to the cached position when the target is invisible", () => {
    const hidden: ShapeObjectData = {
      ...makeShape("shape-a", 0, 0, 100, 100),
      visible: false,
    };
    expect(
      resolveConnectorEndpoint(glued("shape-a", 1, 71, 82), [hidden]),
    ).toEqual(vec2(71, 82));
  });

  it("falls back to the world origin when a corrupt endpoint has no position", () => {
    const corrupt = { objectId: null, anchorIndex: 0 } as ConnectorEndpoint;
    expect(resolveConnectorEndpoint(corrupt, [])).toEqual(vec2(0, 0));
  });
});

describe("resolveConnectorEndpoints", () => {
  it("resolves both endpoints against the live object list", () => {
    const target = makeShape("shape-a", 0, 0, 100, 100);
    const connector = makeRoutedConnector(
      glued("shape-a", 1, 0, 0),
      floating(300, 50),
      "straight",
    );
    expect(resolveConnectorEndpoints(connector, [target])).toEqual({
      start: vec2(100, 50),
      end: vec2(300, 50),
    });
  });

  it("uses the connector position for endpoints missing entirely (corrupt data)", () => {
    const corrupt = makeCorruptConnector(vec2(17, 23));
    expect(resolveConnectorEndpoints(corrupt, [])).toEqual({
      start: vec2(17, 23),
      end: vec2(17, 23),
    });
  });

  it("falls back to the world origin when even the position is corrupt", () => {
    const base: Omit<ConnectorObjectData, "start" | "end" | "position"> = {
      ...makeCorruptConnector(vec2(0, 0)),
    };
    const corrupt = base as ConnectorObjectData;
    expect(resolveConnectorEndpoints(corrupt, [])).toEqual({
      start: vec2(0, 0),
      end: vec2(0, 0),
    });
  });
});

describe("connectorPathShape", () => {
  it("routes straight as the plain endpoint pair", () => {
    const start = vec2(0, 0);
    const end = vec2(100, 40);
    expect(connectorPathShape("straight", start, end)).toEqual({
      points: [start, end],
      bezier: false,
    });
  });

  it("routes orthogonal with a horizontal mid-rail when side-by-side dominates", () => {
    // |dx| = 100 >= |dy| = 40 → vertical rail: (start.x, midY) … (end.x, midY).
    expect(connectorPathShape("orthogonal", vec2(0, 0), vec2(100, 40))).toEqual(
      {
        points: [vec2(0, 0), vec2(0, 20), vec2(100, 20), vec2(100, 40)],
        bezier: false,
      },
    );
  });

  it("routes orthogonal with a vertical mid-rail when stacked dominates", () => {
    // |dy| = 100 > |dx| = 40 → horizontal rail: (midX, start.y) … (midX, end.y).
    expect(connectorPathShape("orthogonal", vec2(0, 0), vec2(40, 100))).toEqual(
      {
        points: [vec2(0, 0), vec2(20, 0), vec2(20, 100), vec2(40, 100)],
        bezier: false,
      },
    );
  });

  it("treats a square displacement as horizontal-dominant (>= tie-break)", () => {
    expect(connectorPathShape("orthogonal", vec2(0, 0), vec2(50, 50))).toEqual({
      points: [vec2(0, 0), vec2(0, 25), vec2(50, 25), vec2(50, 50)],
      bezier: false,
    });
  });

  it("routes curved as a quadratic bezier offset onto the left normal", () => {
    // (0,0) → (100,0): length 100, offset 20% = 20; control sits at the
    // midpoint plus (−dy, dx)/length · offset = (0, +20).
    expect(connectorPathShape("curved", vec2(0, 0), vec2(100, 0))).toEqual({
      points: [vec2(0, 0), vec2(50, 20), vec2(100, 0)],
      bezier: true,
    });
  });

  it("caps the curved offset at 120 world units for long spans", () => {
    // length 1000 → 20% = 200, capped at 120.
    expect(connectorPathShape("curved", vec2(0, 0), vec2(1000, 0))).toEqual({
      points: [vec2(0, 0), vec2(500, 120), vec2(1000, 0)],
      bezier: true,
    });
  });

  it("degenerates curved to a straight pair when the endpoints coincide", () => {
    expect(connectorPathShape("curved", vec2(30, 40), vec2(30, 40))).toEqual({
      points: [vec2(30, 40), vec2(30, 40)],
      bezier: false,
    });
  });
});

describe("sampleConnectorPath", () => {
  it("passes polylines through unchanged (same reference)", () => {
    const shape: ConnectorPathShape = {
      points: [vec2(0, 0), vec2(0, 20), vec2(100, 20), vec2(100, 40)],
      bezier: false,
    };
    expect(sampleConnectorPath(shape)).toBe(shape.points);
  });

  it("flattens a bezier into segments + 1 samples by default (16 → 17)", () => {
    const shape = connectorPathShape("curved", vec2(0, 0), vec2(100, 0));
    const sampled = sampleConnectorPath(shape);
    expect(sampled).toHaveLength(17);
    expect(sampled[0]).toEqual(vec2(0, 0));
    expect(sampled[16]).toEqual(vec2(100, 0));
  });

  it("samples the quadratic bezier exactly at t = 0.5 (half the control)", () => {
    const shape = connectorPathShape("curved", vec2(0, 0), vec2(100, 0));
    const sampled = sampleConnectorPath(shape);
    // B(0.5) = 0.25·start + 0.5·control + 0.25·end = (50, 10).
    expect(sampled[8]).toEqual(vec2(50, 10));
  });

  it("honours an explicit segment count (4 → 5 samples)", () => {
    const shape = connectorPathShape("curved", vec2(0, 0), vec2(100, 0));
    const sampled = sampleConnectorPath(shape, 4);
    expect(sampled).toHaveLength(5);
    expect(sampled[0]).toEqual(vec2(0, 0));
    expect(sampled[2]).toEqual(vec2(50, 10));
    expect(sampled[4]).toEqual(vec2(100, 0));
    // Interior samples at t = 0.25 / 0.75.
    expect(sampled[1]).toEqual(vec2(25, 7.5));
    expect(sampled[3]).toEqual(vec2(75, 7.5));
  });

  it("falls back to the chord when a bezier shape lacks its control point", () => {
    // Hand-edited shape: bezier flagged with only the two endpoints; the
    // control and end both fall back to points[1].
    const sparse: ConnectorPathShape = {
      points: [vec2(0, 0), vec2(100, 0)],
      bezier: true,
    };
    const sampled = sampleConnectorPath(sparse);
    expect(sampled[0]).toEqual(vec2(0, 0));
    // B(0.5) = 0.25·(0,0) + 0.5·(100,0) + 0.25·(100,0) = (75, 0).
    expect(sampled[8]).toEqual(vec2(75, 0));
    expect(sampled[16]).toEqual(vec2(100, 0));
  });

  it("samples the world origin when a bezier shape has no points at all", () => {
    const empty: ConnectorPathShape = { points: [], bezier: true };
    const sampled = sampleConnectorPath(empty);
    expect(sampled).toHaveLength(17);
    for (const point of sampled) {
      expect(point).toEqual(vec2(0, 0));
    }
  });
});

describe("refreshGluedConnector", () => {
  const targetA = makeShape("shape-a", 0, 0, 100, 100);

  it("returns the same reference when nothing moved", () => {
    const connector = makeRoutedConnector(
      glued("shape-a", 1, 100, 50),
      floating(300, 50),
      "straight",
    );
    expect(refreshGluedConnector(connector, [targetA])).toBe(connector);
  });

  it("refreshes the glued start against the target's current anchor", () => {
    const movedA: ShapeObjectData = { ...targetA, position: vec2(50, 50) };
    const start = glued("shape-a", 1, 100, 50);
    const end = floating(300, 50);
    const connector = makeRoutedConnector(start, end, "straight");
    const refreshed = refreshGluedConnector(connector, [movedA]);
    expect(refreshed).not.toBe(connector);
    expect(refreshed.start).toEqual({ ...start, position: vec2(150, 100) });
    // The untouched endpoint keeps its reference (immutable shallow update).
    expect(refreshed.end).toBe(end);
    expect(refreshed.position).toEqual(vec2(225, 75));
  });

  it("refreshes the glued end against the target's current anchor", () => {
    const movedA: ShapeObjectData = { ...targetA, position: vec2(50, 50) };
    const start = floating(0, 0);
    const end = glued("shape-a", 2, 50, 100);
    const connector = makeRoutedConnector(start, end, "straight");
    const refreshed = refreshGluedConnector(connector, [movedA]);
    expect(refreshed.end).toEqual({ ...end, position: vec2(100, 150) });
    expect(refreshed.start).toBe(start);
    expect(refreshed.position).toEqual(vec2(50, 75));
  });

  it("refreshes both endpoints when both are glued to moved targets", () => {
    const targetB = makeShape("shape-b", 300, 0, 400, 100);
    const movedB: ShapeObjectData = { ...targetB, position: vec2(400, 0) };
    const connector = makeRoutedConnector(
      glued("shape-a", 1, 100, 50),
      glued("shape-b", 3, 300, 50),
      "straight",
    );
    const refreshed = refreshGluedConnector(connector, [targetA, movedB]);
    expect(refreshed.start).toEqual(glued("shape-a", 1, 100, 50));
    expect(refreshed.end).toEqual(glued("shape-b", 3, 400, 50));
    expect(refreshed.position).toEqual(vec2(250, 50));
  });

  it("leaves the cache untouched when a glue target is missing", () => {
    const connector = makeRoutedConnector(
      glued("ghost", 1, 100, 50),
      floating(300, 50),
      "straight",
    );
    expect(refreshGluedConnector(connector, [targetA])).toBe(connector);
  });

  it("leaves the cache untouched when a glue target is invisible", () => {
    const hiddenA: ShapeObjectData = { ...targetA, visible: false };
    const connector = makeRoutedConnector(
      glued("shape-a", 1, 100, 50),
      floating(300, 50),
      "straight",
    );
    expect(refreshGluedConnector(connector, [hiddenA])).toBe(connector);
  });

  it("only re-derives glued endpoints (floating ones never move)", () => {
    const connector = makeRoutedConnector(
      floating(10, 10),
      floating(300, 50),
      "straight",
    );
    expect(refreshGluedConnector(connector, [targetA])).toBe(connector);
  });

  it("leaves corrupt connectors without endpoints untouched", () => {
    const corrupt = makeCorruptConnector(vec2(40, 60));
    expect(refreshGluedConnector(corrupt, [targetA])).toBe(corrupt);
  });
});

describe("connectorBBox", () => {
  it("bounds the endpoint pair padded by half the stroke width", () => {
    const connector = makeRoutedConnector(
      floating(10, 20),
      floating(110, 120),
      "straight",
      4,
    );
    expect(connectorBBox(connector)).toEqual(bbox(8, 18, 112, 122));
  });

  it("is symmetric when the endpoints are reversed (end left of start)", () => {
    const connector = makeRoutedConnector(
      floating(110, 120),
      floating(10, 20),
      "straight",
      4,
    );
    expect(connectorBBox(connector)).toEqual(bbox(8, 18, 112, 122));
  });

  it("pads nothing for a zero stroke width", () => {
    const connector = makeRoutedConnector(
      floating(10, 20),
      floating(110, 120),
      "straight",
      0,
    );
    expect(connectorBBox(connector)).toEqual(bbox(10, 20, 110, 120));
  });

  it("collapses to the connector position when endpoints are missing", () => {
    const corrupt = makeCorruptConnector(vec2(40, 60), 2);
    expect(connectorBBox(corrupt)).toEqual(bbox(39, 59, 41, 61));
  });

  it("treats a missing stroke width as zero padding", () => {
    const corrupt = makeCorruptConnector(vec2(40, 60));
    expect(connectorBBox(corrupt)).toEqual(bbox(40, 60, 40, 60));
  });

  it("normalises spans with a negative direction via min/max", () => {
    const connector = makeRoutedConnector(
      floating(0, 100),
      floating(0, -100),
      "straight",
      2,
    );
    expect(connectorBBox(connector)).toEqual(bbox(-1, -101, 1, 101));
  });
});
