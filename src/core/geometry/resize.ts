/**
 * Pure resize-handle geometry: handle ids, gesture rect math and hit-testing.
 *
 * The eight resize handles are the affordances drawn by `HandlesRenderer`
 * around the selection's union box (4 corners + 4 edge midpoints). This module
 * owns the *math* only — which edges each handle controls, how a drag frame
 * maps the before-box to a new box (with min-size clamping and optional
 * aspect-ratio lock), and where the handles sit in screen space — so the
 * interaction layer (`SelectTool`) and the rendering layer stay decoupled
 * (CLAUDE.md §1.3: shared geometric truth lives in core/).
 */
import type { BBox } from "@/core/geometry/BBox";
import { bbox } from "@/core/geometry/BBox";
import type { Camera } from "@/core/camera/Camera";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";

/** Identifier of one of the eight resize handles (screen-corner names). */
export type ResizeHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/**
 * Every handle id, corners first. Corner handles win ties during
 * hit-testing because they control both axes (more specific affordance).
 */
export const RESIZE_HANDLE_IDS: readonly ResizeHandleId[] = [
  "nw",
  "ne",
  "se",
  "sw",
  "n",
  "e",
  "s",
  "w",
];

/** Which box edges a handle drags (the controlled edges follow the pointer). */
interface HandleControls {
  /** Whether the handle moves the left edge (`minX`). */
  readonly controlsMinX: boolean;
  /** Whether the handle moves the right edge (`maxX`). */
  readonly controlsMaxX: boolean;
  /** Whether the handle moves the top edge (`minY`). */
  readonly controlsMinY: boolean;
  /** Whether the handle moves the bottom edge (`maxY`). */
  readonly controlsMaxY: boolean;
}

/**
 * Computes the resize gesture rectangle for one drag frame.
 *
 * The edges a handle does NOT control stay at their before values; the
 * controlled edges follow the pointer and are clamped so each axis keeps at
 * least `minSize` anchored at the untouched edge (the box never inverts —
 * inward drags shrink, exactly to the minimum). With `keepAspect` (Shift),
 * the rectangle keeps the before-box aspect ratio: corner handles scale from
 * the dominant axis around the fixed corner, edge handles derive the
 * perpendicular axis around its before-axis centre.
 *
 * @param before - the box the gesture started from (world space).
 * @param handle - the handle being dragged.
 * @param pointer - the current pointer position (world space).
 * @param minSize - minimum width/height kept on each axis (world units).
 * @param keepAspect - whether the before-box aspect ratio is locked.
 * @returns the new world-space box for this frame.
 */
export function resizeRectFromHandle(
  before: BBox,
  handle: ResizeHandleId,
  pointer: Vec2,
  minSize: number,
  keepAspect: boolean,
): BBox {
  const controls = controlsOf(handle);
  const raw = provisionalRect(before, controls, pointer);
  const clamped = clampRect(raw, controls, minSize);
  if (!keepAspect) {
    return clamped;
  }
  return applyAspect(clamped, controls, before, minSize);
}

/** Screen-pixel distance from the box's top edge to the rotation handle. */
export const ROTATE_HANDLE_OFFSET_PX = 24;

/** Screen-pixel radius of the rotation handle affordance. */
export const ROTATE_HANDLE_RADIUS_PX = 5;

/** Screen-pixel tolerance for grabbing the rotation handle. */
export const ROTATE_HANDLE_HIT_TOLERANCE_PX = 11;

/** Snap step of rotation with Shift held, in radians (15 degrees). */
export const ROTATION_SNAP_RAD = Math.PI / 12;

/**
 * Rotates a screen-space point around a screen-space centre.
 *
 * @param point - the point to rotate.
 * @param center - the rotation centre.
 * @param radians - the rotation angle (screen space, same sign as object
 *   rotation — both use the y-down convention).
 * @returns the rotated point.
 */
function rotateScreenPoint(point: Vec2, center: Vec2, radians: number): Vec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return vec2(center.x + dx * cos - dy * sin, center.y + dx * sin + dy * cos);
}

/**
 * Projects every handle anchor of a world box into screen space, honouring
 * the object's rotation: anchors are the rotated box corners/edge midpoints
 * (the box rotates around its centre), so the affordances hug the tilted
 * object at any rotation.
 *
 * @param world - the world-space box the handles surround (unrotated frame).
 * @param camera - the viewport transform.
 * @param rotation - the object's rotation (radians), default 0.
 * @returns the eight handles with their screen-space anchors.
 */
export function handleAnchors(
  world: BBox,
  camera: Camera,
  rotation = 0,
): ReadonlyArray<{ readonly id: ResizeHandleId; readonly screen: Vec2 }> {
  const min = camera.worldToScreen(vec2(world.minX, world.minY));
  const max = camera.worldToScreen(vec2(world.maxX, world.maxY));
  const left = Math.min(min.x, max.x);
  const right = Math.max(min.x, max.x);
  const top = Math.min(min.y, max.y);
  const bottom = Math.max(min.y, max.y);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const center = vec2(centerX, centerY);
  const anchor = (
    id: ResizeHandleId,
    x: number,
    y: number,
  ): { id: ResizeHandleId; screen: Vec2 } => ({
    id,
    screen:
      rotation === 0
        ? vec2(x, y)
        : rotateScreenPoint(vec2(x, y), center, rotation),
  });
  return [
    anchor("nw", left, top),
    anchor("n", centerX, top),
    anchor("ne", right, top),
    anchor("w", left, centerY),
    anchor("e", right, centerY),
    anchor("sw", left, bottom),
    anchor("s", centerX, bottom),
    anchor("se", right, bottom),
  ];
}

/**
 * Locates the resize handle under a screen-space point.
 *
 * Handle anchors are the (rotated) box corners and edge midpoints projected
 * to screen space (constant visual size at any zoom). Anchors are tested in
 * {@link RESIZE_HANDLE_IDS} order (corners first) with a strict distance
 * comparison, so a corner exactly between two anchors wins the tie.
 *
 * @param screen - the pointer position in canvas-local CSS pixels.
 * @param world - the world-space box the handles surround.
 * @param camera - the viewport transform projecting the box.
 * @param tolerance - maximum screen distance from an anchor, in pixels.
 * @param rotation - the object's rotation (radians), default 0.
 * @returns the closest handle id, or null when none is within tolerance.
 */
export function hitResizeHandle(
  screen: Vec2,
  world: BBox,
  camera: Camera,
  tolerance: number,
  rotation = 0,
): ResizeHandleId | null {
  const anchors = new Map(
    handleAnchors(world, camera, rotation).map((a) => [a.id, a.screen]),
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
 * Computes the screen-space anchor of the rotation handle: a constant
 * screen offset above the (rotated) top edge centre, along the box's own
 * "up" direction so the affordance rides the tilted object.
 *
 * @param world - the world-space box (unrotated frame).
 * @param camera - the viewport transform.
 * @param rotation - the object's rotation (radians), default 0.
 * @returns the rotation handle's screen-space centre.
 */
export function rotateHandleAnchor(
  world: BBox,
  camera: Camera,
  rotation = 0,
): Vec2 {
  const min = camera.worldToScreen(vec2(world.minX, world.minY));
  const max = camera.worldToScreen(vec2(world.maxX, world.maxY));
  const left = Math.min(min.x, max.x);
  const right = Math.max(min.x, max.x);
  const top = Math.min(min.y, max.y);
  const bottom = Math.max(min.y, max.y);
  const center = vec2((left + right) / 2, (top + bottom) / 2);
  const topCenter = vec2((left + right) / 2, top);
  const rotatedTopCenter =
    rotation === 0 ? topCenter : rotateScreenPoint(topCenter, center, rotation);
  let up = vec2(rotatedTopCenter.x - center.x, rotatedTopCenter.y - center.y);
  const length = Math.hypot(up.x, up.y);
  up = length > 0 ? vec2(up.x / length, up.y / length) : vec2(0, -1);
  return vec2(
    rotatedTopCenter.x + up.x * ROTATE_HANDLE_OFFSET_PX,
    rotatedTopCenter.y + up.y * ROTATE_HANDLE_OFFSET_PX,
  );
}

/**
 * Locates the rotation handle under a screen-space point.
 *
 * @param screen - the pointer position in canvas-local CSS pixels.
 * @param world - the world-space box the handle rides.
 * @param camera - the viewport transform.
 * @param rotation - the object's rotation (radians), default 0.
 * @returns whether the point grabs the rotation handle.
 */
export function hitRotateHandle(
  screen: Vec2,
  world: BBox,
  camera: Camera,
  rotation = 0,
): boolean {
  const anchor = rotateHandleAnchor(world, camera, rotation);
  return (
    Math.hypot(screen.x - anchor.x, screen.y - anchor.y) <=
    ROTATE_HANDLE_HIT_TOLERANCE_PX
  );
}

/**
 * Maps a handle id to the edges it drags.
 *
 * @param handle - the dragged handle.
 * @returns which of the four box edges follow the pointer.
 */
function controlsOf(handle: ResizeHandleId): HandleControls {
  return {
    controlsMinX: handle === "w" || handle === "nw" || handle === "sw",
    controlsMaxX: handle === "e" || handle === "ne" || handle === "se",
    controlsMinY: handle === "n" || handle === "nw" || handle === "ne",
    controlsMaxY: handle === "s" || handle === "sw" || handle === "se",
  };
}

/**
 * Builds the unclamped rectangle for one frame: controlled edges take the
 * pointer position, untouched edges keep their before values.
 *
 * @param before - the box the gesture started from.
 * @param controls - the edges the handle drags.
 * @param pointer - the current pointer position (world space).
 * @returns the provisional box (may be inverted on a controlled axis).
 */
function provisionalRect(
  before: BBox,
  controls: HandleControls,
  pointer: Vec2,
): BBox {
  return bbox(
    controls.controlsMinX ? pointer.x : before.minX,
    controls.controlsMinY ? pointer.y : before.minY,
    controls.controlsMaxX ? pointer.x : before.maxX,
    controls.controlsMaxY ? pointer.y : before.maxY,
  );
}

/**
 * Enforces the minimum size per controlled axis without inverting the box.
 *
 * A controlled edge that crossed its untouched partner is pushed back to the
 * untouched edge plus/minus `minSize` (the gesture shrinks exactly to the
 * minimum, never flips). Axes the handle does not control keep the
 * provisional (before) values.
 *
 * @param rect - the provisional box.
 * @param controls - the edges the handle drags.
 * @param minSize - minimum width/height (world units).
 * @returns the clamped box.
 */
function clampRect(
  rect: BBox,
  controls: HandleControls,
  minSize: number,
): BBox {
  let { minX, minY, maxX, maxY } = rect;
  if (controls.controlsMaxX && maxX - minX < minSize) {
    maxX = minX + minSize;
  }
  if (controls.controlsMinX && maxX - minX < minSize) {
    minX = maxX - minSize;
  }
  if (controls.controlsMaxY && maxY - minY < minSize) {
    maxY = minY + minSize;
  }
  if (controls.controlsMinY && maxY - minY < minSize) {
    minY = maxY - minSize;
  }
  return bbox(minX, minY, maxX, maxY);
}

/**
 * Locks the rectangle to the before-box aspect ratio.
 *
 * Corner handles keep the opposite corner fixed and take the size from the
 * dominant axis; edge handles grow the perpendicular axis around the
 * before-axis centre. Degenerate before-boxes (zero width or height) skip
 * the lock.
 *
 * @param rect - the clamped provisional box.
 * @param controls - the edges the handle drags.
 * @param before - the box the gesture started from.
 * @param minSize - minimum width/height (world units).
 * @returns the aspect-locked box.
 */
function applyAspect(
  rect: BBox,
  controls: HandleControls,
  before: BBox,
  minSize: number,
): BBox {
  const beforeWidth = before.maxX - before.minX;
  const beforeHeight = before.maxY - before.minY;
  if (beforeWidth <= 0 || beforeHeight <= 0) {
    return rect;
  }
  const ratio = beforeHeight / beforeWidth;
  const isCorner =
    (controls.controlsMinX || controls.controlsMaxX) &&
    (controls.controlsMinY || controls.controlsMaxY);
  if (isCorner) {
    return aspectFromCorner(rect, controls, before, ratio, minSize);
  }
  return aspectFromEdge(rect, controls, before, ratio, minSize);
}

/**
 * Aspect lock for corner handles: the dominant drag axis sets the scale and
 * the box grows from the fixed (opposite) corner toward the dragged side.
 *
 * @param rect - the clamped provisional box.
 * @param controls - the edges the handle drags.
 * @param before - the box the gesture started from.
 * @param ratio - before height / before width.
 * @param minSize - minimum width/height (world units).
 * @returns the aspect-locked box.
 */
function aspectFromCorner(
  rect: BBox,
  controls: HandleControls,
  before: BBox,
  ratio: number,
  minSize: number,
): BBox {
  const width = Math.max(rect.maxX - rect.minX, minSize);
  const height = Math.max(rect.maxY - rect.minY, minSize);
  const widthDelta = Math.abs(width - (before.maxX - before.minX));
  const heightDelta = Math.abs(height - (before.maxY - before.minY));
  let newWidth: number;
  let newHeight: number;
  if (widthDelta >= heightDelta) {
    newWidth = width;
    newHeight = width * ratio;
  } else {
    newHeight = height;
    newWidth = height / ratio;
  }
  // Fixed corner: the corner opposite the dragged handle (both its edges
  // are untouched, so they carry the before values).
  const cornerX = controls.controlsMaxX ? rect.minX : rect.maxX;
  const cornerY = controls.controlsMaxY ? rect.minY : rect.maxY;
  const left = controls.controlsMinX ? cornerX - newWidth : cornerX;
  const right = controls.controlsMaxX ? cornerX + newWidth : cornerX;
  const top = controls.controlsMinY ? cornerY - newHeight : cornerY;
  const bottom = controls.controlsMaxY ? cornerY + newHeight : cornerY;
  return bbox(
    Math.min(left, right),
    Math.min(top, bottom),
    Math.max(left, right),
    Math.max(top, bottom),
  );
}

/**
 * Aspect lock for edge handles: the dragged axis sets the size and the
 * perpendicular axis is derived around the before-axis centre (the
 * undragged axis keeps its centre, matching the familiar editors).
 *
 * @param rect - the clamped provisional box.
 * @param controls - the edges the handle drags.
 * @param before - the box the gesture started from.
 * @param ratio - before height / before width.
 * @param minSize - minimum width/height (world units).
 * @returns the aspect-locked box.
 */
function aspectFromEdge(
  rect: BBox,
  controls: HandleControls,
  before: BBox,
  ratio: number,
  minSize: number,
): BBox {
  const width = Math.max(rect.maxX - rect.minX, minSize);
  const height = Math.max(rect.maxY - rect.minY, minSize);
  const horizontal = controls.controlsMinX || controls.controlsMaxX;
  let newWidth: number;
  let newHeight: number;
  if (horizontal) {
    newWidth = width;
    newHeight = width * ratio;
  } else {
    newHeight = height;
    newWidth = height / ratio;
  }
  // The dragged axis keeps the clamped rect's span (anchored at its fixed
  // edge); the undragged axis centres on its before centre.
  const fixedX = horizontal
    ? rect.minX
    : (before.minX + before.maxX) / 2 - newWidth / 2;
  const fixedY = horizontal
    ? (before.minY + before.maxY) / 2 - newHeight / 2
    : rect.minY;
  return bbox(fixedX, fixedY, fixedX + newWidth, fixedY + newHeight);
}
