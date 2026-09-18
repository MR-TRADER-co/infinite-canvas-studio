/**
 * Minimap planning (فاز ۲۹ — «هم‌ترازی سنجاش در نقشه و ارائه»): the pure
 * helpers behind the bird's-eye map, PIN-AWARE by construction.
 *
 * A pinned object's stored world `position` is the stale pre-pin spot —
 * rendering ignores it while pinned (the object lives in SCREEN space at a
 * viewport anchor). The minimap therefore:
 *   1. frames WORLD content only (`minimapWorldObjects`) so a stale pin
 *      bbox can never distort the map's fit,
 *   2. draws each pinned object at its LIVE effective world position —
 *      the world quad under its screen footprint at the CURRENT camera
 *      (`pinnedFootprintWorldQuad`) — so the map tells the truth: the
 *      footprint travels with the viewport rectangle as the camera moves,
 *      exactly like the object travels with the real screen.
 * When the scene has no world objects at all (only pinned furniture, or
 * empty), the map falls back to framing the CURRENT VIEWPORT
 * (`minimapViewportWorldBounds`) so pins and the view stay visible.
 */
import type { Camera } from "@/core/camera/Camera";
import type { BBox } from "@/core/geometry/BBox";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import { rotatedObjectBBox } from "@/core/model/SceneObject";
import type { SceneObjectData } from "@/core/model/SceneObject";
import {
  isPinnedObject,
  pinnedScreenRect,
  type ViewportSize,
} from "@/core/model/Pinned";

/** Structural scene shape the planning helpers consume (no Scene import). */
export interface SceneLike {
  /** The scene's objects in paint order. */
  readonly objects: readonly SceneObjectData[];
}

/** Structural camera-controller shape (the camera holder). */
export interface CameraControllerLike {
  /** The live viewport transform. */
  readonly camera: Camera;
}

/** Map content inset in CSS pixels (shared with the panel's painter). */
export const MINIMAP_PADDING_PX = 8;

/** Default map draw size in CSS pixels (the panel canvas' CSS box). */
export const MINIMAP_MAP_WIDTH = 208;
export const MINIMAP_MAP_HEIGHT = 132;

/** Content fit descriptor (scale + world origin) — the panel's map space. */
export interface MinimapFit {
  /** World→map uniform scale (map pixels per world unit). */
  readonly scale: number;
  /** The world X at the map's padding origin (pre-centring compensation). */
  readonly minX: number;
  /** The world Y at the map's padding origin (pre-centring compensation). */
  readonly minY: number;
}

/**
 * Whether an object takes part in the minimap's WORLD layer: visible and
 * NOT pinned (a pinned object renders in screen space — its world
 * position is stale and must never frame or fill the map as if it were
 * world content).
 *
 * @param object - the object to inspect.
 * @returns whether the object is minimap world content.
 */
export function isMinimapWorldObject(object: SceneObjectData): boolean {
  return object.visible && !isPinnedObject(object);
}

/**
 * Computes the world-content bounds the minimap frames: the union of the
 * rotated bounds of every VISIBLE UNPINNED object. Pinned objects are
 * excluded on purpose (their stored position is the stale pre-pin spot).
 *
 * @param objects - the scene's objects in any order.
 * @returns the content bbox, or null when the scene has no world objects.
 */
export function minimapContentBounds(
  objects: readonly SceneObjectData[],
): BBox | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const object of objects) {
    if (!isMinimapWorldObject(object)) {
      continue;
    }
    const box = rotatedObjectBBox(object);
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  if (minX > maxX || minY > maxY) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Computes the world-space bounds of the CURRENT VIEWPORT: the world
 * quad under the viewport's four screen corners (rotation-aware — the
 * axis-aligned bbox of the un-rotated corners when the camera turns).
 * The minimap's fallback frame when no world objects exist, so the view
 * rectangle and the pinned footprints stay on the map.
 *
 * @param camera - the live viewport transform.
 * @param viewport - the viewport size in CSS pixels.
 * @returns the view's world bbox (degenerate-safe minimum span of 1).
 */
export function minimapViewportWorldBounds(
  camera: Camera,
  viewport: ViewportSize,
): BBox {
  const corners: readonly Vec2[] = [
    camera.screenToWorld(vec2(0, 0)),
    camera.screenToWorld(vec2(viewport.width, 0)),
    camera.screenToWorld(vec2(viewport.width, viewport.height)),
    camera.screenToWorld(vec2(0, viewport.height)),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    maxX: Math.max(maxX, minX + 1),
    maxY: Math.max(maxY, minY + 1),
  };
}

/**
 * Fits world bounds into the map's box: uniform scale, centred, padding
 * respected (the classic bird's-eye fit, extracted from the panel so it
 * is testable and reusable).
 *
 * @param bounds - the world bounds to frame.
 * @param width - map width in CSS pixels.
 * @param height - map height in CSS pixels.
 * @param padding - map content inset in CSS pixels.
 * @returns the fit descriptor.
 */
export function minimapFit(
  bounds: BBox,
  width: number,
  height: number,
  padding: number = MINIMAP_PADDING_PX,
): MinimapFit {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(
    (width - padding * 2) / spanX,
    (height - padding * 2) / spanY,
  );
  const mapW = spanX * scale;
  const mapH = spanY * scale;
  return {
    scale,
    minX: bounds.minX - (width - padding * 2 - mapW) / 2 / scale,
    minY: bounds.minY - (height - padding * 2 - mapH) / 2 / scale,
  };
}

/**
 * Unions two world-space bounds (either may be null — the other wins).
 *
 * @param a - first bounds, or null.
 * @param b - second bounds, or null.
 * @returns the union, or null when both are null.
 */
export function unionMinimapBounds(
  a: BBox | null,
  b: BBox | null,
): BBox | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * Resolves the map's content fit (فاز ۲۹ pin-aware): the world-content
 * bbox UNION the current viewport's world bounds frames the map — world
 * content alone could leave the view (and the pinned quads riding it)
 * clipped off-map when the content sits far from the camera, so the map
 * always shows BOTH what exists and where you are. A scene with no world
 * objects falls back to the viewport alone.
 *
 * @param scene - the scene being mapped.
 * @param controller - the camera controller (the viewport transform).
 * @param viewport - the viewport size in CSS pixels.
 * @param width - map width in CSS pixels.
 * @param height - map height in CSS pixels.
 * @returns the fit (never null while a controller exists).
 */
export function minimapSceneFit(
  scene: SceneLike,
  controller: CameraControllerLike,
  viewport: ViewportSize,
  width: number,
  height: number,
): MinimapFit | null {
  const viewBounds = minimapViewportWorldBounds(
    controller.camera,
    viewport,
  );
  const bounds = unionMinimapBounds(
    minimapContentBounds(scene.objects),
    viewBounds,
  );
  if (bounds === null) {
    return null;
  }
  return minimapFit(bounds, width, height);
}

/**
 * The LIVE effective world quad of a pinned object (فاز ۲۹): the screen
 * footprint (`pinnedScreenRect` — anchor + size at screen scale 1) mapped
 * through the CURRENT camera into world space. This is where the object
 * would land if unpinned right now, which is exactly where the minimap
 * must draw it — the footprint rides the viewport as the camera moves,
 * mirroring the real screen behaviour (the object follows the view).
 *
 * @param object - the pinned object (must carry numeric width/height).
 * @param camera - the live viewport transform.
 * @param viewport - the viewport size in CSS pixels.
 * @returns the world quad (tl, tr, br, bl order), or null when the object
 *          is not a sized pinned object.
 */
export function pinnedFootprintWorldQuad(
  object: SceneObjectData,
  camera: Camera,
  viewport: ViewportSize,
): readonly Vec2[] | null {
  if (!isPinnedObject(object)) {
    return null;
  }
  const width = (object as { readonly width?: number }).width;
  const height = (object as { readonly height?: number }).height;
  if (typeof width !== "number" || typeof height !== "number") {
    return null;
  }
  const screen = pinnedScreenRect(
    object as SceneObjectData & {
      readonly width: number;
      readonly height: number;
    },
    viewport,
  );
  return [
    camera.screenToWorld(vec2(screen.minX, screen.minY)),
    camera.screenToWorld(vec2(screen.maxX, screen.minY)),
    camera.screenToWorld(vec2(screen.maxX, screen.maxY)),
    camera.screenToWorld(vec2(screen.minX, screen.maxY)),
  ];
}
