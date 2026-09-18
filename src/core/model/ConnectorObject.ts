/**
 * Connector object: a line/arrow between two endpoints.
 *
 * Each endpoint is either glued to an object anchor (stored as the target
 * id + anchor index; the world position is re-derived from the target's
 * current bounds, so the connector follows moved/resized objects — the
 * cached `position` doubles as the persistence snapshot and the fallback
 * when the target was deleted) or floats at a fixed world position.
 *
 * The visible path is computed by the chosen routing strategy
 * ({@link connectorPathShape}) from the resolved endpoint positions; the
 * renderer and hit-tester share that single geometric truth.
 *
 * PHASE 5 (R5.3): `label` is the small single-line caption riding the path
 * midpoint (plain text, NOT rich text — the editor is a bare `<input>`, see
 * `ConnectorLabelEditor`). Optional so pre-Phase-5 payloads deserialize
 * label-less unchanged.
 */
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import { bbox } from "@/core/geometry/BBox";
import type { BBox } from "@/core/geometry/BBox";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { objectBBox } from "@/core/model/SceneObject";
import { anchorAt, anchorExitVector } from "@/core/model/Anchors";
import {
  STROKE_COLOR_TOKEN,
  type StrokeStyleKind,
} from "@/core/model/FreehandObject";

/** Routing strategies a connector may use. */
export type ConnectorRoutingKind = "straight" | "orthogonal" | "curved";

/** Arrowhead styles of a connector endpoint. */
export type ArrowStyle = "none" | "arrow";

/** One connector endpoint: attached to an object anchor or floating. */
export interface ConnectorEndpoint {
  /** Id of the object the endpoint is glued to, or null when floating. */
  readonly objectId: string | null;
  /** Index of the anchor used on the target object. */
  readonly anchorIndex: number;
  /** World-space position used while floating (and as a cached fallback). */
  readonly position: Vec2;
}

/** Visual style of a connector (shared by the tool, overlay and inspector). */
export interface ConnectorStyle {
  /** Stroke colour: a CSS colour string or the palette token. */
  readonly color: string;
  /** Stroke width in world units. */
  readonly width: number;
  /** Stroke dash pattern. */
  readonly dash: StrokeStyleKind;
  /** Path routing strategy. */
  readonly routing: ConnectorRoutingKind;
  /** Arrowhead at the start endpoint. */
  readonly startArrow: ArrowStyle;
  /** Arrowhead at the end endpoint. */
  readonly endArrow: ArrowStyle;
}

/** Default style new connectors are created with. */
export const DEFAULT_CONNECTOR_STYLE: ConnectorStyle = {
  color: STROKE_COLOR_TOKEN,
  width: 2,
  dash: "solid",
  routing: "straight",
  startArrow: "none",
  endArrow: "arrow",
};

/** Every routing kind the toolbar picker and inspector offer. */
export const CONNECTOR_ROUTINGS: readonly ConnectorRoutingKind[] = [
  "straight",
  "orthogonal",
  "curved",
];

/** Every arrow combination the toolbar picker and inspector offer. */
export const CONNECTOR_ARROW_MODES: readonly ConnectorArrowMode[] = [
  "none",
  "end",
  "both",
];

/** Arrow placement presets (mapped onto the two endpoint arrows). */
export type ConnectorArrowMode = "none" | "end" | "both";

/** Data of a connector object. */
export interface ConnectorObjectData extends SceneObjectData {
  /** Discriminant: always `connector`. */
  readonly kind: "connector";
  /** Endpoint the connector starts at. */
  readonly start: ConnectorEndpoint;
  /** Endpoint the connector ends at. */
  readonly end: ConnectorEndpoint;
  /** Strategy used to route the connector path. */
  readonly routingKind: ConnectorRoutingKind;
  /** Stroke colour: a CSS colour string or the palette token. */
  readonly strokeColor: string;
  /** Stroke width in world units. */
  readonly strokeWidth: number;
  /** Stroke dash pattern. */
  readonly strokeStyle: StrokeStyleKind;
  /** Arrowhead at the start endpoint. */
  readonly startArrow: ArrowStyle;
  /** Arrowhead at the end endpoint. */
  readonly endArrow: ArrowStyle;
  /** Single-line caption riding the path midpoint (R5.3, optional). */
  readonly label?: string;
}

/**
 * Type guard narrowing a generic scene object to its connector variant.
 *
 * @param object - the object to test.
 * @returns whether `object` carries connector data.
 */
export function isConnectorObject(
  object: SceneObjectData,
): object is ConnectorObjectData {
  return object.kind === "connector";
}

/**
 * Builds a connector object from resolved endpoints and a style.
 *
 * @param start - the start endpoint (glued or floating).
 * @param end - the end endpoint (glued or floating).
 * @param style - the visual style to stamp.
 * @param id - unique id from the shared generator.
 * @param zIndex - paint order slot.
 * @returns the connector object data ready for `Scene.add`.
 */
export function connectorFromEndpoints(
  start: ConnectorEndpoint,
  end: ConnectorEndpoint,
  style: ConnectorStyle,
  id: string,
  zIndex: number,
): ConnectorObjectData {
  const position = vec2(
    (start.position.x + end.position.x) / 2,
    (start.position.y + end.position.y) / 2,
  );
  return {
    id,
    kind: "connector",
    position,
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    start,
    end,
    routingKind: style.routing,
    strokeColor: style.color,
    strokeWidth: style.width,
    strokeStyle: style.dash,
    startArrow: style.startArrow,
    endArrow: style.endArrow,
  };
}

/**
 * Resolves one endpoint's world position: glued endpoints re-derive the
 * anchor from the target's CURRENT bounds (falling back to the cached
 * position when the target is gone), floating endpoints use their fixed
 * position.
 *
 * @param endpoint - the endpoint to resolve.
 * @param objects - the object list searched for the glue target.
 * @returns the endpoint's world-space position.
 */
export function resolveConnectorEndpoint(
  endpoint: ConnectorEndpoint,
  objects: readonly SceneObjectData[],
): Vec2 {
  if (endpoint.objectId !== null) {
    const target = objects.find((object) => object.id === endpoint.objectId);
    if (target !== undefined && target.visible) {
      return anchorAt(objectBBox(target), endpoint.anchorIndex);
    }
  }
  return endpoint.position ?? vec2(0, 0);
}

/**
 * Resolves both endpoints of a connector (see {@link resolveConnectorEndpoint}).
 *
 * @param connector - the connector whose endpoints are resolved.
 * @param objects - the object list searched for glue targets.
 * @returns the start and end world-space positions.
 */
export function resolveConnectorEndpoints(
  connector: ConnectorObjectData,
  objects: readonly SceneObjectData[],
): { readonly start: Vec2; readonly end: Vec2 } {
  const fallback = connector.position ?? vec2(0, 0);
  const start = connector.start;
  const end = connector.end;
  return {
    start:
      start === undefined ? fallback : resolveConnectorEndpoint(start, objects),
    end: end === undefined ? fallback : resolveConnectorEndpoint(end, objects),
  };
}

/** Computed connector geometry: control points plus the curve flag. */
export interface ConnectorPathShape {
  /** Control points from start to end (2 = straight, 3 = bezier, 4 = elbow). */
  readonly points: readonly Vec2[];
  /** Whether `points[1]` is a quadratic bezier CONTROL (not a through-point). */
  readonly bezier: boolean;
}

/** Fully resolved connector geometry: path shape + endpoint positions. */
export interface ResolvedConnectorPath {
  /** The routed path control points + curve flag. */
  readonly shape: ConnectorPathShape;
  /** Resolved world-space start position. */
  readonly start: Vec2;
  /** Resolved world-space end position. */
  readonly end: Vec2;
}

/**
 * Resolves the connector's live geometry against the object list: endpoint
 * positions, anchor exit directions and the routed path in one call, so the
 * renderer and the hit-tester share exactly the same curve (CLAUDE.md §1.3
 * single geometric truth).
 *
 * @param connector - the connector to resolve.
 * @param objects - the object list searched for glue targets.
 * @returns the resolved path (shape + endpoints).
 */
export function resolveConnectorPath(
  connector: ConnectorObjectData,
  objects: readonly SceneObjectData[],
): ResolvedConnectorPath {
  const start = resolveConnectorEndpoint(connector.start, objects);
  const end = resolveConnectorEndpoint(connector.end, objects);
  const shape = connectorPathShape(
    connector.routingKind,
    start,
    end,
    endpointExit(connector.start, objects),
    endpointExit(connector.end, objects),
  );
  return { shape, start, end };
}

/**
 * Resolves the exit direction of an endpoint: glued endpoints exit along
 * their anchor's outward vector, floating endpoints have no exit hint.
 *
 * @param endpoint - the endpoint to resolve.
 * @param objects - the object list searched for the glue target.
 * @returns the unit exit vector, or null while floating (or unglued).
 */
function endpointExit(
  endpoint: ConnectorEndpoint,
  objects: readonly SceneObjectData[],
): Vec2 | null {
  if (endpoint.objectId === null) {
    return null;
  }
  const target = objects.find((object) => object.id === endpoint.objectId);
  if (target === undefined || !target.visible) {
    return null;
  }
  return anchorExitVector(endpoint.anchorIndex);
}

/** Maximum curvature offset of the curved routing, in world units. */
const MAX_CURVE_OFFSET = 120;

/** Share of the endpoint distance used as the curvature offset. */
const CURVE_RATIO = 0.2;

/** Determinant magnitude below which two exit rays count as parallel. */
const PARALLEL_EPSILON = 1e-6;

/**
 * Computes the connector path control points for a routing strategy.
 *
 * - `straight` — the two endpoints.
 * - `orthogonal` — an elbow with the mid-rail on the dominant axis
 *   (vertical rail when the endpoints are mostly side-by-side, horizontal
 *   rail when they are mostly stacked).
 * - `curved` — a quadratic bezier. Glued endpoints with anchor exit hints
 *   route flowchart-style: the control point sits at the intersection of
 *   the two exit rays, so the curve LEAVES the source and ARRIVES at the
 *   target along the anchors' outward directions instead of sweeping
 *   through the objects. Floating endpoints (or parallel/opposing rays)
 *   fall back to the perpendicular midpoint control, offset by 20% of the
 *   distance (capped).
 *
 * @param routingKind - the routing strategy.
 * @param start - resolved start position.
 * @param end - resolved end position.
 * @param startExit - optional unit vector the curve leaves `start` along.
 * @param endExit - optional unit vector the curve arrives at `end` along.
 * @returns the path shape (control points + bezier flag).
 */
export function connectorPathShape(
  routingKind: ConnectorRoutingKind,
  start: Vec2,
  end: Vec2,
  startExit?: Vec2 | null,
  endExit?: Vec2 | null,
): ConnectorPathShape {
  if (routingKind === "curved") {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      return { points: [start, end], bezier: false };
    }
    const anchored =
      startExit !== undefined &&
      startExit !== null &&
      endExit !== undefined &&
      endExit !== null
        ? rayIntersection(start, startExit, end, endExit)
        : null;
    if (anchored !== null) {
      return { points: [start, anchored, end], bezier: true };
    }
    const offset = Math.min(length * CURVE_RATIO, MAX_CURVE_OFFSET);
    const control = vec2(
      (start.x + end.x) / 2 - (dy / length) * offset,
      (start.y + end.y) / 2 + (dx / length) * offset,
    );
    return { points: [start, control, end], bezier: true };
  }
  if (routingKind === "orthogonal") {
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
      return {
        points: [start, vec2(start.x, midY), vec2(end.x, midY), end],
        bezier: false,
      };
    }
    return {
      points: [start, vec2(midX, start.y), vec2(midX, end.y), end],
      bezier: false,
    };
  }
  return { points: [start, end], bezier: false };
}

/**
 * Intersects the ray leaving `start` along `exitA` with the ray arriving at
 * `end` along `exitB` (both parameters must be positive, so the tangents
 * genuinely point outward from the endpoints).
 *
 * @param start - the start endpoint position.
 * @param exitA - the start exit direction.
 * @param end - the end endpoint position.
 * @param exitB - the end exit direction (arrival direction at `end`).
 * @returns the intersection control point, or null when the rays are
 *   parallel or intersect behind either endpoint.
 */
function rayIntersection(
  start: Vec2,
  exitA: Vec2,
  end: Vec2,
  exitB: Vec2,
): Vec2 | null {
  const d = vec2(end.x - start.x, end.y - start.y);
  const det = exitA.x * exitB.y - exitA.y * exitB.x;
  if (Math.abs(det) < PARALLEL_EPSILON) {
    return null;
  }
  const tA = (d.x * exitB.y - d.y * exitB.x) / det;
  const tB = (exitA.x * d.y - exitA.y * d.x) / det;
  if (tA <= 0 || tB <= 0) {
    return null;
  }
  return vec2(start.x + exitA.x * tA, start.y + exitA.y * tA);
}

/** Default number of segments the bezier is flattened into. */
const BEZIER_SEGMENTS = 16;

/**
 * Computes the point at the path's half-way station (R5.3 label anchor):
 * beziers evaluate the quadratic at `t = 0.5`; polylines walk the segments
 * to the arc-length midpoint (a straight 2-point path degenerates to the
 * segment midpoint). Pure geometry — the renderer and the label editor all
 * consume this single truth.
 *
 * @param shape - the routed path shape.
 * @returns the world-space midpoint of the path.
 */
export function pathMidpoint(shape: ConnectorPathShape): Vec2 {
  const points = shape.points;
  if (points.length === 0) {
    return vec2(0, 0);
  }
  if (shape.bezier) {
    const start = points[0] ?? vec2(0, 0);
    const control = points[1] ?? start;
    const end = points[2] ?? control;
    return vec2(
      (start.x + 2 * control.x + end.x) / 4,
      (start.y + 2 * control.y + end.y) / 4,
    );
  }
  if (points.length === 1) {
    return points[0] ?? vec2(0, 0);
  }
  let total = 0;
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1] ?? points[0] ?? vec2(0, 0);
    const current = points[i] ?? previous;
    total += Math.hypot(current.x - previous.x, current.y - previous.y);
    cumulative.push(total);
  }
  if (total === 0) {
    return points[0] ?? vec2(0, 0);
  }
  const half = total / 2;
  for (let i = 1; i < cumulative.length; i += 1) {
    const segmentStart = cumulative[i - 1] ?? 0;
    const segmentEnd = cumulative[i] ?? total;
    if (segmentEnd >= half) {
      const previous = points[i - 1] ?? points[0] ?? vec2(0, 0);
      const current = points[i] ?? previous;
      const span = segmentEnd - segmentStart;
      const t = span === 0 ? 0 : (half - segmentStart) / span;
      return vec2(
        previous.x + (current.x - previous.x) * t,
        previous.y + (current.y - previous.y) * t,
      );
    }
  }
  return points[points.length - 1] ?? vec2(0, 0);
}

/**
 * Resolves where a connector's label rides RIGHT NOW: the live-resolved
 * path's midpoint (glued endpoints follow their targets), or null when the
 * connector has no usable endpoints (corrupt data) — the label then simply
 * does not render.
 *
 * @param connector - the connector whose label anchor is resolved.
 * @param objects - the object list searched for glue targets.
 * @returns the world-space label anchor, or null for broken connectors.
 */
export function connectorLabelAnchor(
  connector: ConnectorObjectData,
  objects: readonly SceneObjectData[],
): Vec2 | null {
  if (connector.start === undefined || connector.end === undefined) {
    return null;
  }
  const resolved = resolveConnectorPath(connector, objects);
  return pathMidpoint(resolved.shape);
}

/**
 * Flattens a path shape into a polyline for hit-testing (beziers are
 * subdivided; polylines pass through unchanged).
 *
 * @param shape - the path shape to flatten.
 * @param segments - bezier subdivision count (default 16).
 * @returns the polyline points from start to end.
 */
export function sampleConnectorPath(
  shape: ConnectorPathShape,
  segments: number = BEZIER_SEGMENTS,
): readonly Vec2[] {
  const points = shape.points;
  if (!shape.bezier) {
    return points;
  }
  const start = points[0] ?? vec2(0, 0);
  const control = points[1] ?? start;
  const end = points[2] ?? control;
  const sampled: Vec2[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const inv = 1 - t;
    sampled.push(
      vec2(
        inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
        inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y,
      ),
    );
  }
  return sampled;
}

/**
 * Refreshes the cached endpoint positions of glued endpoints against the
 * CURRENT object list (the glue-follow pass `Scene` runs after every
 * mutation).
 *
 * @param connector - the connector to refresh.
 * @param objects - the live object list (glue targets searched by id).
 * @returns the refreshed connector (new object when a position changed, the
 *   same reference otherwise — cheap no-op check for the common case).
 */
export function refreshGluedConnector(
  connector: ConnectorObjectData,
  objects: readonly SceneObjectData[],
): ConnectorObjectData {
  let changed = false;
  const originalStart = connector.start;
  const originalEnd = connector.end;
  // Corrupt/hand-edited data may miss the endpoints entirely (the
  // structural validation only checks the base fields) — such a connector
  // is left untouched instead of crashing the mutation pipeline.
  if (originalStart === undefined || originalEnd === undefined) {
    return connector;
  }
  let start = originalStart;
  let end = originalEnd;
  if (start.objectId !== null) {
    const target = objects.find((object) => object.id === start.objectId);
    if (target !== undefined && target.visible) {
      const position = anchorAt(objectBBox(target), start.anchorIndex);
      if (position.x !== start.position.x || position.y !== start.position.y) {
        start = { ...start, position };
        changed = true;
      }
    }
  }
  if (end.objectId !== null) {
    const target = objects.find((object) => object.id === end.objectId);
    if (target !== undefined && target.visible) {
      const position = anchorAt(objectBBox(target), end.anchorIndex);
      if (position.x !== end.position.x || position.y !== end.position.y) {
        end = { ...end, position };
        changed = true;
      }
    }
  }
  if (!changed) {
    return connector;
  }
  return {
    ...connector,
    start,
    end,
    position: vec2(
      (start.position.x + end.position.x) / 2,
      (start.position.y + end.position.y) / 2,
    ),
  };
}

/**
 * Computes the world-space bounding box of a connector from its cached
 * endpoint positions, padded by half the stroke width (the same padding
 * contract as freehand strokes and shapes).
 *
 * @param connector - the connector to measure.
 * @returns the axis-aligned box covering both endpoints.
 */
export function connectorBBox(connector: ConnectorObjectData): BBox {
  const pad = (connector.strokeWidth ?? 0) / 2;
  const start = connector.start?.position ?? connector.position ?? vec2(0, 0);
  const end = connector.end?.position ?? connector.position ?? vec2(0, 0);
  return bbox(
    Math.min(start.x, end.x) - pad,
    Math.min(start.y, end.y) - pad,
    Math.max(start.x, end.x) + pad,
    Math.max(start.y, end.y) + pad,
  );
}
