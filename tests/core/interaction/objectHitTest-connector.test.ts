/** Unit tests for the connector branch of the shared object hit-tester. */
import { describe, expect, it } from "vitest";
import { hitTestTopMost } from "@/interaction/objectHitTest";
import { Scene } from "@/core/model/Scene";
import {
  connectorFromEndpoints,
  isConnectorObject,
} from "@/core/model/ConnectorObject";
import type {
  ConnectorObjectData,
  ConnectorStyle,
} from "@/core/model/ConnectorObject";
import { DEFAULT_CONNECTOR_STYLE } from "@/core/model/ConnectorObject";
import { SHAPE_FILL_TOKEN, STROKE_COLOR_TOKEN } from "@/core/model/ShapeObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import type { FreehandObjectData } from "@/core/model/FreehandObject";
import type { ConnectorEndpoint } from "@/core/model/ConnectorObject";

/** Default world-space tolerance used by the tools at zoom 1 (6 screen px). */
const TOLERANCE = 6;

/** Builds a floating endpoint fixture at a fixed position. */
function floating(x: number, y: number): ConnectorEndpoint {
  return { objectId: null, anchorIndex: 0, position: vec2(x, y) };
}

/** Builds a connector style fixture with the given routing and width. */
function style(
  routing: ConnectorStyle["routing"],
  width: number,
): ConnectorStyle {
  return { ...DEFAULT_CONNECTOR_STYLE, routing, width };
}

/** Builds a floating-floating connector fixture. */
function makeConnector(
  routing: ConnectorStyle["routing"],
  start: { x: number; y: number },
  end: { x: number; y: number },
  strokeWidth = 2,
): ConnectorObjectData {
  return connectorFromEndpoints(
    floating(start.x, start.y),
    floating(end.x, end.y),
    style(routing, strokeWidth),
    "conn-1",
    0,
  );
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

/** Builds a freehand stroke fixture over the given point list. */
function makeStroke(
  points: { x: number; y: number }[],
  strokeWidth = 2,
): FreehandObjectData {
  const world = points.map((point) => vec2(point.x, point.y));
  return {
    id: "stroke-1",
    kind: "freehand",
    position: world[0] ?? vec2(0, 0),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    points: world,
    strokeColor: "#0ea5e9",
    strokeWidth,
    strokeStyle: "solid",
  };
}

/** Builds a minimal fixture of a kind without specific hit geometry. */
function makePlain(id: string, x: number, y: number): SceneObjectData {
  return {
    id,
    kind: "group",
    position: vec2(x, y),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
  };
}

/** Assembles a scene holding exactly the given objects. */
function sceneOf(...objects: SceneObjectData[]): Scene {
  const scene = new Scene();
  for (const object of objects) {
    scene.add(object);
  }
  return scene;
}

describe("objectHitTest (straight connector)", () => {
  it("hits a point exactly on the path", () => {
    const scene = sceneOf(
      makeConnector("straight", { x: 0, y: 0 }, { x: 100, y: 0 }),
    );
    expect(hitTestTopMost(scene, vec2(50, 0), TOLERANCE)?.id).toBe("conn-1");
  });

  it("hits within the tolerance plus half the stroke width (diagonal path)", () => {
    const scene = sceneOf(
      makeConnector("straight", { x: 0, y: 0 }, { x: 100, y: 100 }),
    );
    // (30, 23) sits 7/√2 ≈ 4.95 off the diagonal — within the radius 7 —
    // and inside the padded endpoint box, so the broad-phase lets it through.
    expect(hitTestTopMost(scene, vec2(30, 23), TOLERANCE)?.id).toBe("conn-1");
    // 15/√2 ≈ 10.6 off the diagonal: beyond the radius.
    expect(hitTestTopMost(scene, vec2(30, 45), TOLERANCE)).toBeNull();
  });

  it("thick strokes widen the hit radius by their half width", () => {
    const scene = sceneOf(
      makeConnector("straight", { x: 0, y: 0 }, { x: 100, y: 100 }, 10),
    );
    // Same off-path point as the thin case: (0, 10) is 10/√2 ≈ 7.07 off the
    // diagonal — beyond the thin radius 7 but inside the thick radius 11.
    expect(hitTestTopMost(scene, vec2(0, 10), TOLERANCE)?.id).toBe("conn-1");
    const thin = sceneOf(
      makeConnector("straight", { x: 0, y: 0 }, { x: 100, y: 100 }),
    );
    expect(hitTestTopMost(thin, vec2(0, 10), TOLERANCE)).toBeNull();
  });

  it("hits near the endpoints (segment clamping)", () => {
    const scene = sceneOf(
      makeConnector("straight", { x: 0, y: 0 }, { x: 100, y: 0 }),
    );
    // 1 unit beyond the endpoint, still inside the padded box.
    expect(hitTestTopMost(scene, vec2(101, 0), TOLERANCE)?.id).toBe("conn-1");
    // 8 units beyond the endpoint: past the clamped segment distance.
    expect(hitTestTopMost(scene, vec2(108, 0), TOLERANCE)).toBeNull();
  });

  it("misses points far from the path", () => {
    const scene = sceneOf(
      makeConnector("straight", { x: 0, y: 0 }, { x: 100, y: 0 }),
    );
    expect(hitTestTopMost(scene, vec2(500, 500), TOLERANCE)).toBeNull();
    expect(hitTestTopMost(scene, vec2(-50, 0), TOLERANCE)).toBeNull();
  });

  it("pads the polyline broad-phase by the hit radius (near-path clicks hit)", () => {
    const scene = sceneOf(
      makeConnector("straight", { x: 0, y: 0 }, { x: 100, y: 0 }),
    );
    // (105, 0) is only 5 units from the endpoint — inside the tolerance
    // radius (7) though outside the endpoint-pair box — the padded
    // broad-phase lets it through and the segment clamp accepts it.
    expect(hitTestTopMost(scene, vec2(105, 0), TOLERANCE)?.id).toBe("conn-1");
    // A large tolerance rescues points proportionally further out.
    expect(hitTestTopMost(scene, vec2(50, 8), 20)?.id).toBe("conn-1");
    // Far outside the padded box the broad-phase still rejects.
    expect(hitTestTopMost(scene, vec2(50, 40), 20)).toBeNull();
  });

  it("skips invisible and locked connectors", () => {
    const invisible = {
      ...makeConnector("straight", { x: 0, y: 0 }, { x: 100, y: 0 }),
      visible: false,
    };
    expect(
      hitTestTopMost(sceneOf(invisible), vec2(50, 0), TOLERANCE),
    ).toBeNull();
    const locked = {
      ...makeConnector("straight", { x: 0, y: 0 }, { x: 100, y: 0 }),
      locked: true,
    };
    expect(hitTestTopMost(sceneOf(locked), vec2(50, 0), TOLERANCE)).toBeNull();
  });
});

describe("objectHitTest (orthogonal connector)", () => {
  it("hits every rail of the elbow", () => {
    // (0,0) → (100,40) elbows through (0,20) and (100,20).
    const scene = sceneOf(
      makeConnector("orthogonal", { x: 0, y: 0 }, { x: 100, y: 40 }),
    );
    expect(hitTestTopMost(scene, vec2(0, 10), TOLERANCE)?.id).toBe("conn-1");
    expect(hitTestTopMost(scene, vec2(50, 20), TOLERANCE)?.id).toBe("conn-1");
    expect(hitTestTopMost(scene, vec2(100, 30), TOLERANCE)?.id).toBe("conn-1");
  });

  it("misses the inner elbow area away from both rails", () => {
    const scene = sceneOf(
      makeConnector("orthogonal", { x: 0, y: 0 }, { x: 100, y: 40 }),
    );
    // (50, 10) sits inside the endpoint box but 10 units off both rails.
    expect(hitTestTopMost(scene, vec2(50, 10), TOLERANCE)).toBeNull();
  });
});

describe("objectHitTest (curved connector)", () => {
  it("hits the bezier bulge outside the endpoint-pair box", () => {
    // (0,0) → (100,0) curves through (50, 10); the endpoint box only spans
    // y ∈ [-1, 1], so hitting (50, 10) proves curved skips the broad-phase.
    const scene = sceneOf(
      makeConnector("curved", { x: 0, y: 0 }, { x: 100, y: 0 }),
    );
    expect(hitTestTopMost(scene, vec2(50, 10), TOLERANCE)?.id).toBe("conn-1");
    expect(hitTestTopMost(scene, vec2(50, 13), TOLERANCE)?.id).toBe("conn-1");
  });

  it("misses points beyond the bulge on both sides", () => {
    const scene = sceneOf(
      makeConnector("curved", { x: 0, y: 0 }, { x: 100, y: 0 }),
    );
    expect(hitTestTopMost(scene, vec2(50, 40), TOLERANCE)).toBeNull();
    expect(hitTestTopMost(scene, vec2(50, -10), TOLERANCE)).toBeNull();
  });

  it("hits on a huge tolerance outside the endpoint box (no broad-phase)", () => {
    const scene = sceneOf(
      makeConnector("curved", { x: 0, y: 0 }, { x: 100, y: 0 }),
    );
    // 8 units below the chord — rejected for polylines, accepted for curves.
    expect(hitTestTopMost(scene, vec2(50, 8), 20)?.id).toBe("conn-1");
  });
});

describe("objectHitTest (glued connector resolution)", () => {
  it("hits the path resolved from the target's current bounds", () => {
    const scene = sceneOf(
      makeShape("shape-a", 0, 0, 100, 100),
      connectorFromEndpoints(
        { objectId: "shape-a", anchorIndex: 1, position: vec2(100, 50) },
        floating(300, 50),
        style("straight", 2),
        "conn-1",
        1,
      ),
    );
    expect(hitTestTopMost(scene, vec2(200, 50), TOLERANCE)?.id).toBe("conn-1");
  });

  it("follows the target after it moves (glue-follow)", () => {
    const scene = sceneOf(
      makeShape("shape-a", 0, 0, 100, 100),
      connectorFromEndpoints(
        { objectId: "shape-a", anchorIndex: 1, position: vec2(100, 50) },
        floating(300, 50),
        style("straight", 2),
        "conn-1",
        1,
      ),
    );
    // Move the target: the E anchor (index 1) moves to (300, 150).
    scene.add(makeShape("shape-a", 200, 100, 300, 200));
    // The path now runs vertically at x = 300 between y = 50 and 150.
    const hit = hitTestTopMost(scene, vec2(300, 100), TOLERANCE);
    expect(hit?.id).toBe("conn-1");
    // The old path location is vacated.
    expect(hitTestTopMost(scene, vec2(150, 50), TOLERANCE)).toBeNull();
  });

  it("keeps hitting the cached path after the target is deleted (fallback)", () => {
    const scene = sceneOf(
      makeShape("shape-a", 0, 0, 100, 100),
      connectorFromEndpoints(
        { objectId: "shape-a", anchorIndex: 1, position: vec2(100, 50) },
        floating(300, 50),
        style("straight", 2),
        "conn-1",
        1,
      ),
    );
    scene.remove("shape-a");
    expect(hitTestTopMost(scene, vec2(200, 50), TOLERANCE)?.id).toBe("conn-1");
  });

  it("falls back to the cached path while the target is invisible", () => {
    const scene = sceneOf(
      makeShape("shape-a", 0, 0, 100, 100),
      connectorFromEndpoints(
        { objectId: "shape-a", anchorIndex: 1, position: vec2(100, 50) },
        floating(300, 50),
        style("straight", 2),
        "conn-1",
        1,
      ),
    );
    scene.add({ ...makeShape("shape-a", 0, 0, 100, 100), visible: false });
    expect(hitTestTopMost(scene, vec2(200, 50), TOLERANCE)?.id).toBe("conn-1");
  });
});

describe("objectHitTest (paint-order and other kinds)", () => {
  it("prefers the top-most object when a shape covers the connector", () => {
    const connector = makeConnector(
      "straight",
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    );
    const cover = makeShape("shape-cover", 0, 0, 100, 100);
    // (50, 0) lies on the connector path AND inside the covering shape; the
    // shape was painted after the connector, so it wins.
    expect(
      hitTestTopMost(sceneOf(connector, cover), vec2(50, 0), TOLERANCE)?.id,
    ).toBe("shape-cover");
  });

  it("prefers the connector when it was painted last", () => {
    const cover = makeShape("shape-cover", 0, 0, 100, 100);
    const connector = makeConnector(
      "straight",
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    );
    expect(
      hitTestTopMost(sceneOf(cover, connector), vec2(50, 0), TOLERANCE)?.id,
    ).toBe("conn-1");
  });

  it("hits freehand strokes segment-wise with the half-stroke radius", () => {
    const scene = sceneOf(
      makeStroke([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    );
    expect(hitTestTopMost(scene, vec2(50, 5), TOLERANCE)?.id).toBe("stroke-1");
    expect(hitTestTopMost(scene, vec2(50, 8), TOLERANCE)).toBeNull();
  });

  it("hits a single-point freehand stroke by distance", () => {
    const scene = sceneOf(makeStroke([{ x: 10, y: 10 }]));
    expect(hitTestTopMost(scene, vec2(10, 16), TOLERANCE)?.id).toBe("stroke-1");
    expect(hitTestTopMost(scene, vec2(30, 30), TOLERANCE)).toBeNull();
  });

  it("skips invisible and locked freehand strokes", () => {
    const invisible = {
      ...makeStroke([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
      visible: false,
    };
    expect(
      hitTestTopMost(sceneOf(invisible), vec2(50, 0), TOLERANCE),
    ).toBeNull();
    const locked = {
      ...makeStroke([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
      locked: true,
    };
    expect(hitTestTopMost(sceneOf(locked), vec2(50, 0), TOLERANCE)).toBeNull();
  });

  it("falls back to the bounding box for kinds without path geometry", () => {
    const scene = sceneOf(makePlain("group-1", 40, 40));
    expect(hitTestTopMost(scene, vec2(40, 40), TOLERANCE)?.id).toBe("group-1");
    expect(hitTestTopMost(scene, vec2(45, 45), TOLERANCE)).toBeNull();
  });

  it("narrows the hit object for the connector kind helper", () => {
    const scene = sceneOf(
      makeConnector("straight", { x: 0, y: 0 }, { x: 100, y: 0 }),
    );
    const hit = hitTestTopMost(scene, vec2(50, 0), TOLERANCE);
    expect(hit !== null && isConnectorObject(hit)).toBe(true);
  });
});
