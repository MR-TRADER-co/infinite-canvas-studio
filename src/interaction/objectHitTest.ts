/**
 * Object hit-testing shared by the interaction tools.
 *
 * Resolves the top-most interactive object at a world position by walking
 * the scene in reverse paint order (top-most first), skipping invisible or
 * locked objects. Freehand strokes test each segment precisely (plus half
 * the stroke width); connectors test their sampled routing path (plus half
 * the stroke width); other kinds test their bounding box. The tolerance is
 * given in world units (callers convert screen pixels via the camera zoom).
 * Hit-testing runs against the scene model, never DOM geometry
 * (CLAUDE.md §1.3).
 */
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { objectBBox, worldToLocalFrame } from "@/core/model/SceneObject";
import type { SceneSpatialIndex } from "@/core/spatial/SceneSpatialIndex";
import {
  isFreehandObject,
  type FreehandObjectData,
} from "@/core/model/FreehandObject";
import { isFrameObject, frameChromeHit } from "@/core/model/FrameObject";
import {
  isConnectorObject,
  resolveConnectorPath,
  sampleConnectorPath,
  type ConnectorObjectData,
} from "@/core/model/ConnectorObject";
import { distanceToSegment, pointInBBox } from "@/core/geometry/hitTest";
import type { Vec2 } from "@/core/geometry/Vec2";
import {
  isPinnedObject,
  pinnedScreenRect,
  type ViewportSize,
} from "@/core/model/Pinned";

/**
 * Hit-tests the top-most interactive object at a world position.
 *
 * Sized objects with a non-zero rotation test in their LOCAL frame: the
 * point is un-rotated around the object's bounds centre before the box
 * test, so a click in the axis-aligned bounding box but OUTSIDE the tilted
 * rectangle misses (and vice versa) — hit-testing respects rotation
 * (R2.5). Freehand strokes and connectors ignore `rotation` (their
 * geometry is the point list itself).
 *
 * R7.10: when a spatial index is provided, the REVERSE paint-order walk
 * is replaced by an R-tree broad phase resolving the candidates top-most
 * first (same results, log-ish cost); the precise per-kind tests are
 * unchanged.
 *
 * @param scene - the scene whose objects are tested.
 * @param world - the world-space position to test.
 * @param tolerance - world-space hit tolerance.
 * @param index - optional spatial index (R-tree broad phase, R7.10).
 * @returns the top-most hit object, or null.
 */
export function hitTestTopMost(
  scene: Scene,
  world: Vec2,
  tolerance: number,
  index?: SceneSpatialIndex,
): SceneObjectData | null {
  const candidates = index
    ? index.objectsAt(world, tolerance)
    : [...scene.objects].reverse();
  for (const object of candidates) {
    if (
      object === undefined ||
      !object.visible ||
      object.locked ||
      // فاز ۲۵: pinned objects live in SCREEN space — their world footprint
      // is camera-stale, so the world-space walk never resolves them
      // (`hitTestPinned` owns them).
      isPinnedObject(object)
    ) {
      continue;
    }
    if (isFreehandObject(object)) {
      if (freehandHit(object, world, tolerance + object.strokeWidth / 2)) {
        return object;
      }
      continue;
    }
    // R8.3: frames pick by their CHROME only (border ring + title bar) —
    // the body interior passes clicks through to contained objects.
    if (isFrameObject(object)) {
      if (frameChromeHit(object, world, tolerance)) {
        return object;
      }
      continue;
    }
    if (isConnectorObject(object)) {
      if (
        connectorHit(scene, object, world, tolerance + object.strokeWidth / 2)
      ) {
        return object;
      }
      continue;
    }
    if (object.rotation !== 0 && hasSize(object)) {
      if (pointInBBox(worldToLocalFrame(object, world), objectBBox(object))) {
        return object;
      }
      continue;
    }
    if (pointInBBox(world, objectBBox(object))) {
      return object;
    }
  }
  return null;
}

/**
 * Hit-tests the top-most PINNED object at a screen position (فاز ۲۵).
 *
 * Pinned objects resolve in screen space — their anchor plus their own
 * size at scale 1 — walking the scene in reverse paint order. Sized kinds
 * only (every pinnable kind carries width/height; a defensive guard
 * skips exotic shapes).
 *
 * @param scene - the scene whose pinned objects are tested.
 * @param screen - the screen-space position to test.
 * @param viewport - the viewport size in CSS pixels.
 * @param tolerance - screen-pixel hit tolerance.
 * @returns the top-most pinned hit object, or null.
 */
export function hitTestPinned(
  scene: Scene,
  screen: Vec2,
  viewport: ViewportSize,
  tolerance = 4,
): SceneObjectData | null {
  for (const object of [...scene.objects].reverse()) {
    if (
      !object.visible ||
      object.locked ||
      !isPinnedObject(object) ||
      typeof (object as { width?: unknown }).width !== "number" ||
      typeof (object as { height?: unknown }).height !== "number"
    ) {
      continue;
    }
    const rect = pinnedScreenRect(
      object as SceneObjectData & {
        readonly width: number;
        readonly height: number;
      },
      viewport,
    );
    if (
      pointInBBox(screen, {
        minX: rect.minX - tolerance,
        minY: rect.minY - tolerance,
        maxX: rect.maxX + tolerance,
        maxY: rect.maxY + tolerance,
      })
    ) {
      return object;
    }
  }
  return null;
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
 * Tests whether any connector path segment passes within `radius` of the
 * point. The path is resolved against the live scene (glue-follow) and the
 * bezier routing flattened before the segment tests.
 *
 * @param scene - the scene providing the glue targets.
 * @param connector - the connector to test.
 * @param point - the world-space position to test.
 * @param radius - the world-space hit radius (stroke half-width included).
 * @returns whether the connector is hit.
 */
function connectorHit(
  scene: Scene,
  connector: ConnectorObjectData,
  point: Vec2,
  radius: number,
): boolean {
  // Cheap broad-phase for the polylines: the point must lie within the
  // endpoint-pair bounds PADDED BY THE HIT RADIUS, so a click within
  // tolerance just outside the box still passes to the segment tests.
  // Curved routing is skipped — its bezier bulge can extend well outside
  // the endpoint box, and 16 sampled segments are cheap.
  if (connector.routingKind !== "curved") {
    const bounds = objectBBox(connector);
    if (
      point.x < bounds.minX - radius ||
      point.x > bounds.maxX + radius ||
      point.y < bounds.minY - radius ||
      point.y > bounds.maxY + radius
    ) {
      return false;
    }
  }
  const resolved = resolveConnectorPath(connector, scene.objects);
  const points = sampleConnectorPath(resolved.shape);
  if (points.length === 1) {
    const only = points[0];
    return (
      only !== undefined &&
      Math.hypot(point.x - only.x, point.y - only.y) <= radius
    );
  }
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    if (start === undefined || end === undefined) {
      continue;
    }
    if (distanceToSegment(point, start, end) <= radius) {
      return true;
    }
  }
  return false;
}

/**
 * Tests whether any freehand segment passes within `radius` of the point.
 *
 * @param stroke - the freehand stroke to test.
 * @param point - the world-space position to test.
 * @param radius - the world-space hit radius.
 * @returns whether the stroke is hit.
 */
function freehandHit(
  stroke: FreehandObjectData,
  point: Vec2,
  radius: number,
): boolean {
  const points = stroke.points;
  if (points.length === 1) {
    const only = points[0];
    return (
      only !== undefined &&
      Math.hypot(point.x - only.x, point.y - only.y) <= radius
    );
  }
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    if (start === undefined || end === undefined) {
      continue;
    }
    if (distanceToSegment(point, start, end) <= radius) {
      return true;
    }
  }
  return false;
}
