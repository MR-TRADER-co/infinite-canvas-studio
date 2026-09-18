/**
 * Discriminated data contract shared by every object in the scene graph.
 *
 * `SceneObjectData` is the serialisable "data" half of a scene object: the
 * concrete object kinds extend this interface and narrow the `kind`
 * discriminant so rendering, interaction and persistence can dispatch on it
 * safely.
 *
 * Kind-aware helpers (`objectBBox`, `translateSceneObject`) live here so every
 * consumer (selection, marquee, commands, hit-testing) shares one geometric
 * truth instead of re-deriving it per module (CLAUDE.md §1.3).
 */
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import type { BBox } from "@/core/geometry/BBox";
import { bbox } from "@/core/geometry/BBox";
import {
  isFreehandObject,
  type FreehandObjectData,
} from "@/core/model/FreehandObject";
import { isShapeObject } from "@/core/model/ShapeObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import { connectorBBox, isConnectorObject } from "@/core/model/ConnectorObject";
import type {
  ConnectorEndpoint,
  ConnectorObjectData,
} from "@/core/model/ConnectorObject";
import { isOpaqueObject, opaqueBBox } from "@/core/model/OpaqueObject";
import { isFrameObject } from "@/core/model/FrameObject";
import type { PropertyValue } from "@/core/model/Properties";

/**
 * Kinds of objects the scene graph can contain.
 *
 * - `shape` — primitive vector shapes
 * - `textBox` — free-standing rich text boxes
 * - `stickyNote` — coloured notes carrying rich text
 * - `image` — raster images placed on the canvas
 * - `video` — videos placed as lightweight poster thumbnails (فاز M1:
 *   the bytes live in the sidecar AssetStore, never in the payload)
 * - `audio` — audio clips placed as lightweight waveform thumbnails
 *   (فاز A1: the same sidecar AssetStore contract as video)
 * - `pdf` — PDF documents placed as lightweight page thumbnails
 *   (فاز P1: the same sidecar AssetStore contract as video/audio; the
 *   viewer — never a live render — is Phase P2's floating window)
 * - `connector` — lines/arrows linking objects or anchors
 * - `freehand` — pen strokes
 * - `group` — containers transforming their children together
 * - `opaque` — placeholders for unregistered (plugin/future) types (R4.3)
 * - `frame` — titled rectangular containers sequenced by the
 *   presentation mode (R8.3)
 * - `plugin` — canvas widgets owned by the Phase 9 plugin runtime: the
 *   host owns the envelope, the plugin owns the payload + paints through
 *   a sandboxed iframe widget view (R9.9)
 * - `sticker` — emoji glyphs rendered through the platform emoji font
 *   (R11.1, FigJam-style reaction/affordance markers)
 */
export type SceneObjectKind =
  | "shape"
  | "textBox"
  | "stickyNote"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "connector"
  | "freehand"
  | "group"
  | "opaque"
  | "frame"
  | "plugin"
  | "sticker"
  | "query";

/** Fields shared by every scene object (the future persistence contract). */
export interface SceneObjectData {
  /** Unique object id, allocated by `IdGenerator`. */
  readonly id: string;
  /** Discriminant naming the concrete object kind. */
  readonly kind: SceneObjectKind;
  /** Optional user-visible name (layers panel, accessibility). */
  readonly name?: string;
  /** Id of the enclosing group object, when the object is nested. */
  readonly parentId?: string;
  /** World-space position of the object origin. */
  readonly position: Vec2;
  /** Rotation around the object origin, in radians. */
  readonly rotation: number;
  /** Paint order; objects with a larger value render on top. */
  readonly zIndex: number;
  /** Whether the object is currently rendered. */
  readonly visible: boolean;
  /** Whether the object refuses interactive edits. */
  readonly locked: boolean;
  /**
   * Structured properties (pack R11.3): typed key→value pairs filtered
   * by the query engine and edited through the inspector's Properties
   * section. Absent = none (the pre-Phase-11 default; optional field,
   * §1.7.4 keeps unknown shapes alive on round-trip).
   */
  readonly properties?: Readonly<Record<string, PropertyValue>>;
  /**
   * Whether the object is pinned to the SCREEN (فاز ۲۵): while true the
   * object renders in screen space at {@link pinAnchor} and ignores the
   * camera (pans and zooms leave it in place). Absent = unpinned; only
   * `isPinnableObject` kinds honour the flag.
   */
  readonly pinned?: boolean;
  /**
   * Normalized viewport anchor (each axis 0..1, top-left origin) of a
   * pinned object — see `core/model/Pinned.ts`. Meaningful only while
   * `pinned` is true; kept (stale-but-ignored) after unpinning.
   */
  readonly pinAnchor?: Vec2;
}

/**
 * Computes the world-space bounding box of an object.
 *
 * Kind rules: freehand strokes bound their point list (padded by half the
 * stroke width); boxes and shapes bound `position` + `width/height` (shapes
 * also padded by half their stroke width so thick outlines stay inside the
 * box); connectors bound their two cached endpoint positions (padded by half
 * the stroke width — the cached positions are kept in sync by the scene's
 * glue-follow pass); every other kind (stickyNote, group) still has
 * parametric or deferred geometry and falls back to the degenerate box at
 * `position` until their phase lands. Object rotation is ignored
 * (axis-aligned bound).
 *
 * @param object - the object to measure.
 * @returns the axis-aligned world-space box covering the object.
 */
export function objectBBox(object: SceneObjectData): BBox {
  if (isOpaqueObject(object)) {
    return opaqueBBox(object.raw);
  }
  if (isFrameObject(object)) {
    // The title bar sits INSIDE the width/height footprint (the frame is
    // one rectangle; the renderer draws the bar over its top strip).
    return bbox(
      object.position.x,
      object.position.y,
      object.position.x + object.width,
      object.position.y + object.height,
    );
  }
  if (isFreehandObject(object)) {
    return freehandBBox(object);
  }
  if (isConnectorObject(object)) {
    return connectorBBox(object);
  }
  if (
    isShapeObject(object) &&
    hasSize(object) &&
    object.width >= 0 &&
    object.height >= 0 &&
    typeof object.strokeWidth === "number"
  ) {
    // Padded by half the stroke width so thick outlines stay inside the box
    // (mirrors the freehand rule).
    const pad = object.strokeWidth / 2;
    return bbox(
      object.position.x - pad,
      object.position.y - pad,
      object.position.x + object.width + pad,
      object.position.y + object.height + pad,
    );
  }
  if (hasSize(object) && object.width >= 0 && object.height >= 0) {
    return bbox(
      object.position.x,
      object.position.y,
      object.position.x + object.width,
      object.position.y + object.height,
    );
  }
  return bbox(
    object.position.x,
    object.position.y,
    object.position.x,
    object.position.y,
  );
}

/**
 * Computes the axis-aligned world box COVERING the object after its own
 * `rotation` is applied around its bounds centre.
 *
 * `objectBBox` returns the UNROTATED box (the resize/local-frame math needs
 * it); this helper is the world-space footprint consumers that must cover
 * everything the object paints on screen: marquee intersection, selection
 * unions, fit-to-content and rotated hit-test broad phases. For rotation 0
 * it is exactly `objectBBox`.
 *
 * @param object - the object to measure.
 * @returns the axis-aligned box covering the rotated object.
 */
export function rotatedObjectBBox(object: SceneObjectData): BBox {
  const box = objectBBox(object);
  if (object.rotation === 0) {
    return box;
  }
  const center = vec2((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
  const corners: readonly Vec2[] = [
    vec2(box.minX, box.minY),
    vec2(box.maxX, box.minY),
    vec2(box.maxX, box.maxY),
    vec2(box.minX, box.maxY),
  ];
  const cos = Math.cos(object.rotation);
  const sin = Math.sin(object.rotation);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    const dx = corner.x - center.x;
    const dy = corner.y - center.y;
    const x = center.x + dx * cos - dy * sin;
    const y = center.y + dx * sin + dy * cos;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return bbox(minX, minY, maxX, maxY);
}

/**
 * Maps a world point into an object's LOCAL (unrotated) frame: the point is
 * un-rotated around the object's bounds centre. The inverse of the object's
 * own rotation — the basis of rotation-aware hit-testing and local-frame
 * resizing.
 *
 * @param object - the object whose frame the point enters.
 * @param world - the world-space point.
 * @returns the point in the object's local coordinates.
 */
export function worldToLocalFrame(object: SceneObjectData, world: Vec2): Vec2 {
  if (object.rotation === 0) {
    return world;
  }
  const box = objectBBox(object);
  const center = vec2((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
  const cos = Math.cos(-object.rotation);
  const sin = Math.sin(-object.rotation);
  const dx = world.x - center.x;
  const dy = world.y - center.y;
  return vec2(center.x + dx * cos - dy * sin, center.y + dx * sin + dy * cos);
}

/**
 * Produces a translated copy of an object (immutable update).
 *
 * The generic fields (`position`) and every kind-specific geometry field
 * (freehand `points`, connector endpoint caches) move by `delta`; identity,
 * paint order and style are preserved, so the result is a drop-in
 * replacement for `Scene.add`. Glued connector endpoints re-derive their
 * world position from the target's current bounds on the next glue-follow
 * pass, so dragging a half-glued connector moves only the floating end
 * (the documented editing contract).
 *
 * @param object - the object to translate.
 * @param delta - world-space offset.
 * @returns the translated object data.
 */
export function translateSceneObject(
  object: SceneObjectData,
  delta: Vec2,
): SceneObjectData {
  const position = vec2(
    object.position.x + delta.x,
    object.position.y + delta.y,
  );
  if (isFreehandObject(object)) {
    const points = object.points.map((point) =>
      vec2(point.x + delta.x, point.y + delta.y),
    );
    const translated: FreehandObjectData = { ...object, position, points };
    return translated;
  }
  if (isConnectorObject(object)) {
    const translated: ConnectorObjectData = {
      ...object,
      position,
      start: translateEndpoint(object.start, delta),
      end: translateEndpoint(object.end, delta),
    };
    return translated;
  }
  return { ...object, position };
}

/**
 * Translates one connector endpoint cache (both glued and floating caches
 * move; glued positions are re-derived by the scene's glue-follow pass).
 *
 * @param endpoint - the endpoint to translate.
 * @param delta - world-space offset.
 * @returns the translated endpoint.
 */
function translateEndpoint(
  endpoint: ConnectorEndpoint,
  delta: Vec2,
): ConnectorEndpoint {
  return {
    ...endpoint,
    position: vec2(
      endpoint.position.x + delta.x,
      endpoint.position.y + delta.y,
    ),
  };
}

/**
 * Produces a resized copy of an object mapping one bounding box onto another
 * (immutable update).
 *
 * Kind rules mirror {@link objectBBox} padding so a before→after round-trip
 * is visually consistent: shapes derive their rect absolutely from the
 * `after` box inset by half the stroke width; freehand strokes scale their
 * point list linearly (stroke width itself stays constant — proportional
 * stroke scaling is a later-phase decision); connectors scale their cached
 * endpoint positions linearly (glued endpoints re-snap on the scene's next
 * glue-follow pass, so only floating endpoints truly move); other sized
 * kinds scale `width`/`height`; kinds without geometry fall back to moving
 * `position` to the new box origin. Degenerate before-boxes (zero width or
 * height) translate instead of scaling (no division by zero).
 *
 * @param object - the object to resize (assumed to sit at the `before` box).
 * @param before - the object's bounds before the resize (padded semantics).
 * @param after - the requested bounds after the resize.
 * @returns the resized object data.
 */
export function resizeSceneObject(
  object: SceneObjectData,
  before: BBox,
  after: BBox,
): SceneObjectData {
  if (isFreehandObject(object)) {
    return resizeFreehand(object, before, after);
  }
  if (isConnectorObject(object)) {
    return resizeConnector(object, before, after);
  }
  if (
    isShapeObject(object) &&
    hasSize(object) &&
    typeof object.strokeWidth === "number"
  ) {
    const pad = object.strokeWidth / 2;
    const resized: ShapeObjectData = {
      ...object,
      position: vec2(after.minX + pad, after.minY + pad),
      width: Math.max(0, after.maxX - after.minX - pad * 2),
      height: Math.max(0, after.maxY - after.minY - pad * 2),
    };
    return resized;
  }
  if (hasSize(object)) {
    const scale = scaleFactors(before, after);
    const resized: SceneObjectData & {
      readonly width: number;
      readonly height: number;
    } = {
      ...object,
      position: vec2(after.minX, after.minY),
      width: Math.max(0, object.width * scale.x),
      height: Math.max(0, object.height * scale.y),
    };
    return resized;
  }
  return { ...object, position: vec2(after.minX, after.minY) };
}

/**
 * Resizes a freehand stroke by linearly mapping its point list from the
 * before box onto the after box. Both boxes are the PADDED bounds
 * (`objectBBox` semantics), so the point list is mapped between the
 * pad-inset inner regions — the result's padded bounds equal `after`
 * exactly and live gesture frames never drift outward. Stroke width stays
 * constant.
 *
 * @param stroke - the stroke to resize.
 * @param before - the stroke's padded bounds before the resize.
 * @param after - the requested padded bounds after the resize.
 * @returns the resized stroke data.
 */
function resizeFreehand(
  stroke: FreehandObjectData,
  before: BBox,
  after: BBox,
): FreehandObjectData {
  const pad = stroke.strokeWidth / 2;
  const innerBefore = insetBox(before, pad);
  const innerAfter = insetBox(after, pad);
  const scale = scaleFactors(innerBefore, innerAfter);
  const points = stroke.points.map((point) =>
    vec2(
      innerAfter.minX + (point.x - innerBefore.minX) * scale.x,
      innerAfter.minY + (point.y - innerBefore.minY) * scale.y,
    ),
  );
  const position = points[0] ?? stroke.position;
  return { ...stroke, position, points };
}

/**
 * Resizes a connector by linearly mapping its cached endpoint positions from
 * the before box onto the after box (glued endpoints re-snap on the next
 * glue-follow pass; floating endpoints scale for real).
 *
 * @param connector - the connector to resize.
 * @param before - the connector's bounds before the resize.
 * @param after - the requested bounds after the resize.
 * @returns the resized connector data.
 */
function resizeConnector(
  connector: ConnectorObjectData,
  before: BBox,
  after: BBox,
): ConnectorObjectData {
  const scale = scaleFactors(before, after);
  const mapPoint = (point: Vec2): Vec2 =>
    vec2(
      after.minX + (point.x - before.minX) * scale.x,
      after.minY + (point.y - before.minY) * scale.y,
    );
  const start = mapPoint(connector.start.position);
  const end = mapPoint(connector.end.position);
  return {
    ...connector,
    position: vec2((start.x + end.x) / 2, (start.y + end.y) / 2),
    start: { ...connector.start, position: start },
    end: { ...connector.end, position: end },
  };
}

/**
 * Insets a box by `pad` on every side, collapsing to the centre line when
 * the box is too small to inset (keeps the box valid, never inverted).
 *
 * @param box - the box to inset.
 * @param pad - the inset per side.
 * @returns the inset (or collapsed) box.
 */
function insetBox(box: BBox, pad: number): BBox {
  const collapseX = box.maxX - box.minX < pad * 2;
  const collapseY = box.maxY - box.minY < pad * 2;
  const midX = (box.minX + box.maxX) / 2;
  const midY = (box.minY + box.maxY) / 2;
  return bbox(
    collapseX ? midX : box.minX + pad,
    collapseY ? midY : box.minY + pad,
    collapseX ? midX : box.maxX - pad,
    collapseY ? midY : box.maxY - pad,
  );
}

/**
 * Computes the per-axis scale factors between two boxes (1 for degenerate
 * axes so zero-sized before-boxes never divide by zero).
 *
 * @param before - the source box.
 * @param after - the destination box.
 * @returns the x/y scale factors.
 */
function scaleFactors(before: BBox, after: BBox): Vec2 {
  const beforeWidth = before.maxX - before.minX;
  const beforeHeight = before.maxY - before.minY;
  const afterWidth = after.maxX - after.minX;
  const afterHeight = after.maxY - after.minY;
  return vec2(
    beforeWidth > 0 ? afterWidth / beforeWidth : 1,
    beforeHeight > 0 ? afterHeight / beforeHeight : 1,
  );
}

/**
 * @param object - the object to inspect.
 * @returns whether the object carries numeric `width`/`height` fields.
 */
function hasSize(object: SceneObjectData): object is SceneObjectData & {
  readonly width: number;
  readonly height: number;
} {
  return (
    "width" in object &&
    "height" in object &&
    typeof object.width === "number" &&
    typeof object.height === "number"
  );
}

/**
 * Computes the padded bounds of a freehand point list.
 *
 * @param stroke - the freehand object to measure.
 * @returns the box covering every point, expanded by half the stroke width.
 */
function freehandBBox(stroke: FreehandObjectData): BBox {
  const pad = stroke.strokeWidth / 2;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of stroke.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (minX > maxX || minY > maxY) {
    return bbox(
      stroke.position.x - pad,
      stroke.position.y - pad,
      stroke.position.x + pad,
      stroke.position.y + pad,
    );
  }
  return bbox(minX - pad, minY - pad, maxX + pad, maxY + pad);
}
