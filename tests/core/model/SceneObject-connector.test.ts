/** Unit tests for the connector branches of the kind-aware object helpers. */
import { describe, expect, it } from "vitest";
import {
  objectBBox,
  resizeSceneObject,
  translateSceneObject,
} from "@/core/model/SceneObject";
import {
  connectorFromEndpoints,
  isConnectorObject,
} from "@/core/model/ConnectorObject";
import type {
  ConnectorEndpoint,
  ConnectorObjectData,
} from "@/core/model/ConnectorObject";
import { DEFAULT_CONNECTOR_STYLE } from "@/core/model/ConnectorObject";
import { Scene } from "@/core/model/Scene";
import { SHAPE_FILL_TOKEN, STROKE_COLOR_TOKEN } from "@/core/model/ShapeObject";
import { bbox } from "@/core/geometry/BBox";
import { vec2 } from "@/core/geometry/Vec2";
import type { BBox } from "@/core/geometry/BBox";
import type { Vec2 } from "@/core/geometry/Vec2";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";

/** Builds a floating endpoint fixture at a fixed position. */
function floating(x: number, y: number): ConnectorEndpoint {
  return { objectId: null, anchorIndex: 0, position: vec2(x, y) };
}

/** Builds a fully populated connector fixture with floating endpoints. */
function makeConnector(
  start: Vec2,
  end: Vec2,
  strokeWidth = 2,
): ConnectorObjectData {
  return connectorFromEndpoints(
    floating(start.x, start.y),
    floating(end.x, end.y),
    { ...DEFAULT_CONNECTOR_STYLE, width: strokeWidth },
    "conn-1",
    2,
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

/** Narrows a translated/resized object back to the connector kind. */
function asConnector(object: SceneObjectData): ConnectorObjectData {
  if (!isConnectorObject(object)) {
    throw new Error("expected a connector");
  }
  return object;
}

describe("objectBBox (connector)", () => {
  it("bounds the endpoint pair padded by half the stroke width", () => {
    const connector = makeConnector(vec2(10, 20), vec2(110, 120), 4);
    expect(objectBBox(connector)).toEqual(bbox(8, 18, 112, 122));
  });

  it("returns a degenerate padded box for coincident endpoints", () => {
    const connector = makeConnector(vec2(50, 50), vec2(50, 50), 2);
    expect(objectBBox(connector)).toEqual(bbox(49, 49, 51, 51));
  });
});

describe("translateSceneObject (connector)", () => {
  it("translates the position and both endpoint caches by the delta", () => {
    const connector = makeConnector(vec2(0, 0), vec2(100, 40));
    const translated = asConnector(
      translateSceneObject(connector, vec2(10, -5)),
    );
    expect(translated).not.toBe(connector);
    expect(translated.position).toEqual(vec2(60, 15));
    expect(translated.start).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(10, -5),
    });
    expect(translated.end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(110, 35),
    });
    // Style, routing and paint order are preserved.
    expect(translated.routingKind).toBe(connector.routingKind);
    expect(translated.strokeWidth).toBe(connector.strokeWidth);
    expect(translated.zIndex).toBe(connector.zIndex);
  });

  it("translates glued endpoint caches too (the scene re-snaps them next)", () => {
    const start: ConnectorEndpoint = {
      objectId: "shape-a",
      anchorIndex: 1,
      position: vec2(100, 50),
    };
    const end: ConnectorEndpoint = {
      objectId: null,
      anchorIndex: 0,
      position: vec2(300, 50),
    };
    const connector = connectorFromEndpoints(
      start,
      end,
      DEFAULT_CONNECTOR_STYLE,
      "conn-1",
      1,
    );
    const translated = asConnector(
      translateSceneObject(connector, vec2(20, 0)),
    );
    expect(translated.start).toEqual({ ...start, position: vec2(120, 50) });
    expect(translated.end).toEqual({ ...end, position: vec2(320, 50) });
  });

  it("moves only the floating end of a half-glued connector once the scene re-snaps", () => {
    // The documented editing contract: dragging a half-glued connector moves
    // only the floating end — the glue-follow pass pins the glued one.
    const scene = new Scene();
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    const connector = connectorFromEndpoints(
      { objectId: "shape-a", anchorIndex: 1, position: vec2(100, 50) },
      { objectId: null, anchorIndex: 0, position: vec2(300, 50) },
      DEFAULT_CONNECTOR_STYLE,
      "conn-1",
      1,
    );
    scene.add(connector);
    const current = scene.findById("conn-1");
    if (current === undefined || !isConnectorObject(current)) {
      throw new Error("expected the connector");
    }
    const moved = translateSceneObject(current, vec2(40, 0));
    scene.add(moved);
    const snapped = scene.findById("conn-1");
    if (snapped === undefined || !isConnectorObject(snapped)) {
      throw new Error("expected the re-snapped connector");
    }
    expect(snapped.start).toEqual({
      objectId: "shape-a",
      anchorIndex: 1,
      position: vec2(100, 50),
    });
    expect(snapped.end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(340, 50),
    });
  });
});

describe("resizeSceneObject (connector)", () => {
  it("scales the cached endpoint positions linearly between the boxes", () => {
    const connector = makeConnector(vec2(10, 5), vec2(90, 5));
    const resized = asConnector(
      resizeSceneObject(connector, bbox(0, 0, 100, 10), bbox(0, 0, 200, 20)),
    );
    expect(resized).not.toBe(connector);
    expect(resized.start).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(20, 10),
    });
    expect(resized.end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(180, 10),
    });
    expect(resized.position).toEqual(vec2(100, 10));
  });

  it("scales asymmetric boxes per axis", () => {
    const connector = makeConnector(vec2(0, 0), vec2(50, 10));
    const resized = asConnector(
      resizeSceneObject(
        connector,
        bbox(0, 0, 50, 10),
        bbox(100, 100, 150, 140),
      ),
    );
    // scale.x = 1 (width preserved), scale.y = 4 → x shifts, y scales.
    expect(resized.start).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(100, 100),
    });
    expect(resized.end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(150, 140),
    });
  });

  it("translates instead of scaling for a degenerate before-box", () => {
    const connector = makeConnector(vec2(5, 5), vec2(5, 5));
    const resized = asConnector(
      resizeSceneObject(connector, bbox(5, 5, 5, 5), bbox(15, 25, 45, 55)),
    );
    expect(resized.start).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(15, 25),
    });
    expect(resized.end).toEqual({
      objectId: null,
      anchorIndex: 0,
      position: vec2(15, 25),
    });
  });

  it("keeps the glue metadata while scaling (targets re-snap on the next pass)", () => {
    const connector = connectorFromEndpoints(
      { objectId: "shape-a", anchorIndex: 2, position: vec2(10, 10) },
      { objectId: "shape-b", anchorIndex: 0, position: vec2(90, 10) },
      DEFAULT_CONNECTOR_STYLE,
      "conn-1",
      0,
    );
    const resized = asConnector(
      resizeSceneObject(connector, bbox(0, 0, 100, 20), bbox(0, 0, 200, 40)),
    );
    expect(resized.start).toEqual({
      objectId: "shape-a",
      anchorIndex: 2,
      position: vec2(20, 20),
    });
    expect(resized.end).toEqual({
      objectId: "shape-b",
      anchorIndex: 0,
      position: vec2(180, 20),
    });
  });

  it("round-trips the objectBBox under a uniform scale", () => {
    const connector = makeConnector(vec2(10, 5), vec2(90, 15), 0);
    const before: BBox = objectBBox(connector);
    const after: BBox = bbox(0, 0, 160, 20);
    const resized = resizeSceneObject(connector, before, after);
    expect(objectBBox(resized)).toEqual(after);
  });
});
