/**
 * Pin-to-screen model (فاز ۲۵ — «سنجاش روی صفحه»).
 *
 * A PINNED object renders in SCREEN space: its position is a normalized
 * viewport anchor instead of a world coordinate, so it stays put on the
 * screen while the camera pans and zooms — the FigJam/Miro "pinned note"
 * affordance. The world `position` field is kept untouched while pinned
 * (rendering ignores it; unpin restores it to the world point under the
 * anchor, so the object drops exactly where the user sees it).
 *
 * The anchor is stored as FRACTIONS of the viewport (0..1 from the top-left
 * corner, physical axes — never RTL-flipped), so a window resize keeps the
 * relative placement and the value survives camera changes by construction.
 */
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import type { BBox } from "@/core/geometry/BBox";
import type { Camera } from "@/core/camera/Camera";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { ResizeHandleId } from "@/core/geometry/resize";
import {
  RESIZE_HANDLE_IDS,
  ROTATE_HANDLE_HIT_TOLERANCE_PX,
  ROTATE_HANDLE_OFFSET_PX,
  resizeRectFromHandle,
} from "@/core/geometry/resize";

/** Viewport size in CSS pixels (the pin coordinate space). */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** Normalized viewport anchor (each axis 0..1, top-left origin). */
export type PinAnchor = Vec2;

/** Kinds that may be pinned (world-attached kinds refuse by design). */
const PINNABLE_KINDS: readonly string[] = [
  "shape",
  "textBox",
  "stickyNote",
  "image",
  "sticker",
];

/**
 * @param object - the object to inspect.
 * @returns whether the object kind participates in pinning. Connectors,
 *          freehand strokes, groups, frames, plugin widgets and query cards
 *          are inherently world-attached (their geometry is a point list, a
 *          glue or a layout) and refuse the affordance.
 */
export function isPinnableObject(object: SceneObjectData): boolean {
  return (
    object.parentId === undefined && PINNABLE_KINDS.includes(object.kind)
  );
}

/**
 * @param object - the object to inspect.
 * @returns whether the object is currently pinned to the screen.
 */
export function isPinnedObject(object: SceneObjectData): boolean {
  return object.pinned === true;
}

/**
 * @param anchor - the anchor to clamp.
 * @returns the anchor clamped to the 0..1 viewport on both axes.
 */
export function clampPinAnchor(anchor: PinAnchor): PinAnchor {
  return vec2(
    Math.min(1, Math.max(0, anchor.x)),
    Math.min(1, Math.max(0, anchor.y)),
  );
}

/**
 * Maps a pin anchor to the screen point it denotes.
 *
 * @param anchor - normalized viewport anchor.
 * @param viewport - the viewport size in CSS pixels.
 * @returns the screen-space point (top-left of the pinned object).
 */
export function pinAnchorToScreen(
  anchor: PinAnchor,
  viewport: ViewportSize,
): Vec2 {
  return vec2(anchor.x * viewport.width, anchor.y * viewport.height);
}

/**
 * Maps a screen point back to a clamped pin anchor.
 *
 * @param screen - the screen-space point.
 * @param viewport - the viewport size in CSS pixels.
 * @returns the normalized, clamped anchor.
 */
export function screenToPinAnchor(
  screen: Vec2,
  viewport: ViewportSize,
): PinAnchor {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return vec2(0, 0);
  }
  return clampPinAnchor(
    vec2(screen.x / viewport.width, screen.y / viewport.height),
  );
}

/**
 * Computes the anchor a world object should take when pinned NOW: the
 * object's current on-screen position, normalized.
 *
 * @param object - the object about to pin (unpinned).
 * @param camera - the current viewport transform.
 * @param viewport - the viewport size in CSS pixels.
 * @returns the clamped pin anchor denoting the object's visible spot.
 */
export function anchorOnPin(
  object: SceneObjectData,
  camera: Camera,
  viewport: ViewportSize,
): PinAnchor {
  return screenToPinAnchor(
    camera.worldToScreen(object.position),
    viewport,
  );
}

/**
 * Computes the world position a pinned object should take when unpinned
 * NOW: the world point under its anchor, so the object drops exactly where
 * the user sees it on screen.
 *
 * @param object - the pinned object about to unpin.
 * @param camera - the current viewport transform.
 * @param viewport - the viewport size in CSS pixels.
 * @returns the world-space position under the anchor.
 */
export function worldOnUnpin(
  object: SceneObjectData,
  camera: Camera,
  viewport: ViewportSize,
): Vec2 {
  return camera.screenToWorld(
    pinAnchorToScreen(object.pinAnchor ?? vec2(0, 0), viewport),
  );
}

/**
 * Computes the screen-space footprint of a pinned object: the anchor plus
 * the object's own size at scale 1 (pinned objects never scale with zoom).
 *
 * @param object - the pinned object (must carry numeric width/height).
 * @param viewport - the viewport size in CSS pixels.
 * @returns the axis-aligned screen rect.
 */
export function pinnedScreenRect(
  object: SceneObjectData & { readonly width: number; readonly height: number },
  viewport: ViewportSize,
): BBox {
  const origin = pinAnchorToScreen(object.pinAnchor ?? vec2(0, 0), viewport);
  return {
    minX: origin.x,
    minY: origin.y,
    maxX: origin.x + object.width,
    maxY: origin.y + object.height,
  };
}

/** One named position preset of the inspector's 3×3 grid. */
export interface PinPositionPreset {
  /** Stable preset id (`tl`, `tc`, … `br`). */
  readonly id: string;
  /** The anchor the preset denotes. */
  readonly anchor: PinAnchor;
}

/** The nine-region grid presets (top/middle/bottom × left/centre/right). */
export const PIN_POSITION_PRESETS: readonly PinPositionPreset[] = [
  { id: "tl", anchor: vec2(0.02, 0.02) },
  { id: "tc", anchor: vec2(0.5, 0.02) },
  { id: "tr", anchor: vec2(0.98, 0.02) },
  { id: "ml", anchor: vec2(0.02, 0.5) },
  { id: "mc", anchor: vec2(0.5, 0.5) },
  { id: "mr", anchor: vec2(0.98, 0.5) },
  { id: "bl", anchor: vec2(0.02, 0.98) },
  { id: "bc", anchor: vec2(0.5, 0.98) },
  { id: "br", anchor: vec2(0.98, 0.98) },
];

/** A pinned object carrying numeric size fields (the resize contract). */
type SizedPinnedObject = SceneObjectData & {
  readonly width: number;
  readonly height: number;
};

/**
 * Checks whether an object is a sized pinned object.
 *
 * @param object - the object to inspect.
 * @returns whether the object participates in pinned resizing.
 */
function isSizedPinnedObject(
  object: SceneObjectData,
): object is SizedPinnedObject {
  return (
    isPinnedObject(object) &&
    "width" in object &&
    "height" in object &&
    typeof object.width === "number" &&
    typeof object.height === "number"
  );
}

/**
 * The FIXED POINT of the object (fractions of its own width/height) that
 * stays put on screen while each resize handle drags — the corner/edge
 * OPPOSITE the grabbed handle (فاز ۲۷ «تغییر اندازهٔ سنجاق‌شده»).
 *
 * The gesture never stores this fraction: it falls out of the shared
 * `resizeRectFromHandle` box math, which anchors the minimum size at the
 * untouched edges. The table documents the semantics (and drives tests).
 */
export const PIN_RESIZE_FIXED_POINT: {
  readonly [K in ResizeHandleId]: Vec2;
} = {
  nw: vec2(1, 1),
  n: vec2(0.5, 1),
  ne: vec2(0, 1),
  w: vec2(1, 0.5),
  e: vec2(0, 0.5),
  sw: vec2(1, 0),
  s: vec2(0.5, 0),
  se: vec2(0, 0),
};

/** One resize frame of a pinned object (the stored fields that change). */
export interface PinnedResizeFrame {
  /** New width in SCREEN pixels (the pinned render is scale 1). */
  readonly width: number;
  /** New height in SCREEN pixels. */
  readonly height: number;
  /** New top-left anchor (viewport fractions, deliberately UNCLAMPED — the
   *  fixed point may legitimately sit off-screen during a resize). */
  readonly pinAnchor: PinAnchor;
}

/**
 * Computes one pinned-resize frame (فاز ۲۷): the pointer drags one of the
 * eight handles of the object's screen footprint; the opposite corner/edge
 * stays EXACTLY fixed, the on-screen size follows the pointer (the pinned
 * render is scale 1, so the stored width/height ARE screen pixels), and the
 * top-left anchor re-derives from the new origin. Rotated objects resize in
 * their LOCAL frame — the pointer un-rotates around the footprint centre —
 * so the tilted edges keep their tilt while the box grows.
 *
 * @param object - the pinned object (must carry numeric width/height).
 * @param handle - the handle being dragged.
 * @param pointerScreen - the pointer position in CSS pixels.
 * @param viewport - the viewport size in CSS pixels.
 * @param minPx - minimum width/height kept on each axis (screen pixels).
 * @param keepAspect - whether the before aspect ratio is locked.
 * @returns the frame's stored fields, or null on a degenerate viewport.
 */
export function pinnedResizeFrame(
  object: SizedPinnedObject,
  handle: ResizeHandleId,
  pointerScreen: Vec2,
  viewport: ViewportSize,
  minPx: number,
  keepAspect: boolean,
): PinnedResizeFrame | null {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }
  if (!isSizedPinnedObject(object)) {
    return null;
  }
  const before = pinnedScreenRect(object, viewport);
  let pointer = pointerScreen;
  if (object.rotation !== 0) {
    // Local-frame resize: un-rotate the pointer around the footprint
    // centre so the box math runs on the object's own (tilted) axes.
    const cx = (before.minX + before.maxX) / 2;
    const cy = (before.minY + before.maxY) / 2;
    const cos = Math.cos(-object.rotation);
    const sin = Math.sin(-object.rotation);
    const dx = pointerScreen.x - cx;
    const dy = pointerScreen.y - cy;
    pointer = vec2(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
  }
  const after = resizeRectFromHandle(
    before,
    handle,
    pointer,
    minPx,
    keepAspect,
  );
  return {
    width: after.maxX - after.minX,
    height: after.maxY - after.minY,
    pinAnchor: vec2(
      after.minX / viewport.width,
      after.minY / viewport.height,
    ),
  };
}

/**
 * Projects the eight resize-handle anchors of a pinned object into screen
 * space: the corners/edge midpoints of the screen footprint, rotated around
 * its centre when the object is tilted (the affordances hug the object at
 * any rotation — the `handleAnchors` contract, mirrored in screen space).
 *
 * @param object - the pinned object (must carry numeric width/height).
 * @param viewport - the viewport size in CSS pixels.
 * @returns the eight handles with their screen-space anchors.
 */
export function pinnedHandleAnchors(
  object: SizedPinnedObject,
  viewport: ViewportSize,
): ReadonlyArray<{ readonly id: ResizeHandleId; readonly screen: Vec2 }> {
  const rect = pinnedScreenRect(object, viewport);
  const left = rect.minX;
  const top = rect.minY;
  const right = rect.maxX;
  const bottom = rect.maxY;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rotation = object.rotation;
  const anchor = (
    id: ResizeHandleId,
    x: number,
    y: number,
  ): { readonly id: ResizeHandleId; readonly screen: Vec2 } => ({
    id,
    screen:
      rotation === 0
        ? vec2(x, y)
        : rotateAround(vec2(x, y), cx, cy, rotation),
  });
  return [
    anchor("nw", left, top),
    anchor("n", cx, top),
    anchor("ne", right, top),
    anchor("w", left, cy),
    anchor("e", right, cy),
    anchor("sw", left, bottom),
    anchor("s", cx, bottom),
    anchor("se", right, bottom),
  ];
}

/** Screen-pixel tolerance for grabbing a pinned resize handle (فاز ۲۷). */
export const PINNED_HANDLE_HIT_TOLERANCE_PX = 10;

/**
 * Locates the pinned resize handle under a screen-space point (corner-first
 * tie-break, the `hitResizeHandle` contract mirrored in screen space).
 *
 * @param object - the pinned object (must carry numeric width/height).
 * @param screen - the pointer position in CSS pixels.
 * @param viewport - the viewport size in CSS pixels.
 * @param tolerance - maximum screen distance from an anchor, in pixels.
 * @returns the closest handle id, or null when none is within tolerance.
 */
export function hitPinnedResizeHandle(
  object: SizedPinnedObject,
  screen: Vec2,
  viewport: ViewportSize,
  tolerance = PINNED_HANDLE_HIT_TOLERANCE_PX,
): ResizeHandleId | null {
  if (!isSizedPinnedObject(object)) {
    return null;
  }
  const anchors = new Map(
    pinnedHandleAnchors(object, viewport).map((a) => [a.id, a.screen]),
  );
  let best: ResizeHandleId | null = null;
  let bestDistance = tolerance;
  for (const id of RESIZE_HANDLE_IDS) {
    const anchor = anchors.get(id);
    if (anchor === undefined) {
      continue;
    }
    const distance = Math.hypot(screen.x - anchor.x, screen.y - anchor.y);
    if (distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Computes the screen-space CENTRE of a pinned object's footprint — the
 * pivot of the pinned rotation gesture (فاز ۳۰ «چرخش سنجاق‌شده»). The
 * centre is invariant under rotation (the anchor and size stay fixed), so
 * the gesture captures it once at begin.
 *
 * @param object - the pinned object (must carry numeric width/height).
 * @param viewport - the viewport size in CSS pixels.
 * @returns the footprint centre in screen pixels.
 */
export function pinnedFootprintCentre(
  object: SizedPinnedObject,
  viewport: ViewportSize,
): Vec2 {
  const rect = pinnedScreenRect(object, viewport);
  return vec2((rect.minX + rect.maxX) / 2, (rect.minY + rect.maxY) / 2);
}

/**
 * Computes the screen-space centre of a pinned object's (rotated) TOP edge
 * — where the rotation handle's stem begins (فاز ۳۰).
 *
 * @param object - the pinned object (must carry numeric width/height).
 * @param viewport - the viewport size in CSS pixels.
 * @returns the rotated top-edge centre in screen pixels.
 */
export function pinnedTopCentre(
  object: SizedPinnedObject,
  viewport: ViewportSize,
): Vec2 {
  const rect = pinnedScreenRect(object, viewport);
  const centre = vec2((rect.minX + rect.maxX) / 2, (rect.minY + rect.maxY) / 2);
  const topCentre = vec2(centre.x, rect.minY);
  return object.rotation === 0
    ? topCentre
    : rotateAround(topCentre, centre.x, centre.y, object.rotation);
}

/**
 * Computes the screen-space anchor of the pinned rotation handle: a
 * constant screen offset above the (rotated) top edge centre, along the
 * object's OWN "up" direction so the affordance rides the tilted object
 * (the world `rotateHandleAnchor` contract, mirrored in screen space —
 * فاز ۳۰ «چرخش سنجاق‌شده»).
 *
 * @param object - the pinned object (must carry numeric width/height).
 * @param viewport - the viewport size in CSS pixels.
 * @returns the rotation grip's screen-space centre, or null when the
 *          object is not a sized pinned object or the viewport degenerates.
 */
export function pinnedRotateHandleAnchor(
  object: SceneObjectData,
  viewport: ViewportSize,
): Vec2 | null {
  if (!isSizedPinnedObject(object)) {
    return null;
  }
  if (viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }
  const rect = pinnedScreenRect(object, viewport);
  const centre = vec2((rect.minX + rect.maxX) / 2, (rect.minY + rect.maxY) / 2);
  const topCentre = pinnedTopCentre(object, viewport);
  let up = vec2(topCentre.x - centre.x, topCentre.y - centre.y);
  const length = Math.hypot(up.x, up.y);
  up = length > 0 ? vec2(up.x / length, up.y / length) : vec2(0, -1);
  return vec2(
    topCentre.x + up.x * ROTATE_HANDLE_OFFSET_PX,
    topCentre.y + up.y * ROTATE_HANDLE_OFFSET_PX,
  );
}

/**
 * Locates the pinned rotation handle under a screen-space point (فاز ۳۰).
 *
 * @param object - the pinned object (must carry numeric width/height).
 * @param screen - the pointer position in CSS pixels.
 * @param viewport - the viewport size in CSS pixels.
 * @param tolerance - maximum screen distance from the grip, in pixels.
 * @returns whether the point grabs the rotation affordance.
 */
export function hitPinnedRotateHandle(
  object: SceneObjectData,
  screen: Vec2,
  viewport: ViewportSize,
  tolerance = ROTATE_HANDLE_HIT_TOLERANCE_PX,
): boolean {
  const anchor = pinnedRotateHandleAnchor(object, viewport);
  if (anchor === null) {
    return false;
  }
  return Math.hypot(screen.x - anchor.x, screen.y - anchor.y) <= tolerance;
}

/**
 * Computes the rotation DELTA of one pinned-rotation frame (فاز ۳۰): the
 * pointer's angle around the (invariant) footprint centre since the
 * gesture began, optionally snapped to a step (Shift → 15°, the world
 * `RotateGesture` contract).
 *
 * @param centre - the footprint centre (captured at gesture begin).
 * @param startPointer - the pointer position where the gesture began.
 * @param pointerScreen - the latest pointer position in CSS pixels.
 * @param snapRad - the snap step in radians, or null for free rotation.
 * @returns the rotation delta in radians.
 */
export function pinnedRotationDelta(
  centre: Vec2,
  startPointer: Vec2,
  pointerScreen: Vec2,
  snapRad: number | null,
): number {
  let delta =
    Math.atan2(pointerScreen.y - centre.y, pointerScreen.x - centre.x) -
    Math.atan2(startPointer.y - centre.y, startPointer.x - centre.x);
  if (snapRad !== null) {
    delta = Math.round(delta / snapRad) * snapRad;
  }
  return delta;
}

/**
 * Rotates a point around a centre (screen space, y-down — the renderers'
 * convention).
 *
 * @param point - the point to rotate.
 * @param cx - the rotation centre X.
 * @param cy - the rotation centre Y.
 * @param radians - the rotation angle.
 * @returns the rotated point.
 */
function rotateAround(
  point: Vec2,
  cx: number,
  cy: number,
  radians: number,
): Vec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - cx;
  const dy = point.y - cy;
  return vec2(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
}
