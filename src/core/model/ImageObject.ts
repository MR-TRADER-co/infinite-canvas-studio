/**
 * Image object: a raster picture placed on the canvas.
 *
 * The source is an inline data URL so clipboard pastes and dropped files
 * materialise as first-class scene objects with no file-system dependency
 * (the web shell has none) — the payload travels inside the object data
 * and therefore round-trips through autosave and `.icb` project files
 * unchanged. `naturalWidth/Height` keep the decoded intrinsic size so
 * aspect-correct factories and the reset affordances can rely on them;
 * `width/height` are the placed world-space size (resize/rotate behave
 * exactly like every other sized object kind).
 *
 * فاز ۳۴ «زمان صفر»: `initial` snapshots the EXACT placed state at the
 * moment the image entered the canvas (width/height/position/rotation) so
 * the «بازنشانی به حالت درج» affordance can always take it back — the
 * field is optional because pre-Phase-34 scenes persist without it and
 * degrade to the natural-size reset semantics.
 *
 * Original quality (فاز ۳۴): imports keep the ORIGINAL bytes byte-identical
 * while the decoded edge stays ≤ {@link MAX_IMAGE_DIMENSION} AND the file
 * stays ≤ {@link MAX_INLINE_IMAGE_BYTES}; only genuinely gigantic payloads
 * take the proportional downscale fallback (the localStorage autosave slot
 * would otherwise be exhausted by a single uncompressed photo — a write
 * failure there is announced by the autosave service, never silent).
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";

/**
 * Largest imported edge length (CSS pixels) kept at ORIGINAL quality.
 * Larger images are downscaled proportionally on import (4K photos and
 * QHD screenshots ride through untouched at 4096).
 */
export const MAX_IMAGE_DIMENSION = 4096;

/**
 * Largest imported file (bytes) kept byte-identical. Above this the
 * downscale fallback re-encodes — the base64 payload (~1.37× this size)
 * plus the scene JSON must fit the ~5 MB localStorage quota.
 */
export const MAX_INLINE_IMAGE_BYTES = 2_500_000;

/** Data of an image object. */
export interface ImageObjectData extends SceneObjectData {
  /** Discriminant: always `image`. */
  readonly kind: "image";
  /** Inline raster source: a `data:` URL (PNG/JPEG/...). */
  readonly src: string;
  /** Intrinsic width of the decoded image, in pixels. */
  readonly naturalWidth: number;
  /** Intrinsic height of the decoded image, in pixels. */
  readonly naturalHeight: number;
  /** Placed width in world units (canvas space). */
  readonly width: number;
  /** Placed height in world units (canvas space). */
  readonly height: number;
  /**
   * فاز ۳۴ «زمان صفر»: the placed state at the INSTANT the image entered
   * the canvas — the reference the «بازنشانی به حالت درج» affordance
   * restores. Optional: legacy (pre-1.41.0) scenes lack it and degrade
   * to the natural-size reset semantics.
   */
  readonly initial?: ImageInsertState;
}

/** The «زمان صفر» snapshot: the placed state at insert time. */
export interface ImageInsertState {
  /** Placed width at insert (world units). */
  readonly width: number;
  /** Placed height at insert (world units). */
  readonly height: number;
  /** Top-left X at insert (world units, post-cascade/snap). */
  readonly x: number;
  /** Top-left Y at insert (world units, post-cascade/snap). */
  readonly y: number;
  /** Rotation at insert (radians — imports always enter at 0). */
  readonly rotation: number;
}

/**
 * @param object - the object to inspect.
 * @returns whether the object is an image object.
 */
export function isImageObject(
  object: SceneObjectData,
): object is ImageObjectData {
  return object.kind === "image";
}

/**
 * Builds a fresh image object.
 *
 * @param id - the unique object id (from the shared `IdGenerator`).
 * @param src - the inline data-URL source.
 * @param natural - the decoded intrinsic size in pixels.
 * @param position - the world-space top-left corner.
 * @param placed - the placed size in world units (already aspect-corrected
 *        by the caller); defaults to the intrinsic size when omitted.
 * @param zIndex - the paint order (scene supplies `nextZIndex()`).
 * @returns the assembled image object data.
 */
export function createImageObject(
  id: string,
  src: string,
  natural: { readonly width: number; readonly height: number },
  position: Vec2,
  placed?: { readonly width: number; readonly height: number },
  zIndex = 0,
): ImageObjectData {
  const width = Math.max(1, Math.round(placed?.width ?? natural.width));
  const height = Math.max(1, Math.round(placed?.height ?? natural.height));
  return {
    id,
    kind: "image",
    position: vec2(position.x, position.y),
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    src,
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    width,
    height,
    // فاز ۳۴: the «زمان صفر» snapshot rides the factory so EVERY import
    // path (paste, drop, dialog, clipboard read) captures it for free.
    initial: {
      width,
      height,
      x: position.x,
      y: position.y,
      rotation: 0,
    },
  };
}

/**
 * Computes the placed size for a pasted/dropped image: the intrinsic size
 * (after import downscaling) clamped to `maxSpan` on its longest edge so
 * huge pastes still fit the visible canvas.
 *
 * @param natural - the (downscaled) intrinsic size in pixels.
 * @param maxSpan - the largest allowed world-space edge.
 * @returns the aspect-correct placed size in world units.
 */
export function placedImageSize(
  natural: { readonly width: number; readonly height: number },
  maxSpan: number,
): { readonly width: number; readonly height: number } {
  const longest = Math.max(natural.width, natural.height);
  if (longest <= maxSpan || longest === 0) {
    return { width: natural.width, height: natural.height };
  }
  const scale = maxSpan / longest;
  return { width: natural.width * scale, height: natural.height * scale };
}

/**
 * The placed-size scale versus the intrinsic (original) size, as a
 * percentage rounded for display (Phase 23's inspector readout).
 *
 * @param object - the image object to measure.
 * @returns the scale percent of the placed width (negative impossible).
 */
export function imageScalePercent(object: ImageObjectData): number {
  if (object.naturalWidth <= 0) {
    return 100;
  }
  return Math.round((object.width / object.naturalWidth) * 100);
}

/**
 * @param object - the image object to measure.
 * @returns the placed aspect ratio (width / height), safe-divided.
 */
export function imageAspectRatio(object: ImageObjectData): number {
  if (object.height <= 0) {
    return 0;
  }
  return object.width / object.height;
}

/**
 * @param object - the image object to measure.
 * @returns the INTRINSIC aspect ratio, safe-divided.
 */
export function imageNaturalAspectRatio(object: ImageObjectData): number {
  if (object.naturalHeight <= 0) {
    return 0;
  }
  return object.naturalWidth / object.naturalHeight;
}

/**
 * Whether the placed size or aspect ratio has drifted from the intrinsic
 * values (the reset affordances' enabled state).
 *
 * @param object - the image object to check.
 * @returns true when width/height differ from the natural size, OR the
 *          ratio deviates by more than half a percent.
 */
export function imageSizeDrifted(object: ImageObjectData): boolean {
  const sizeDrifted =
    Math.abs(object.width - object.naturalWidth) > 0.5 ||
    Math.abs(object.height - object.naturalHeight) > 0.5;
  if (sizeDrifted) {
    return true;
  }
  return imageRatioDeviationPercent(object) > 0.5;
}

/**
 * The aspect-ratio deviation from the intrinsic ratio, in percent of the
 * intrinsic value (a pure resize keeps this at 0).
 *
 * @param object - the image object to measure.
 * @returns the deviation percent (always ≥ 0).
 */
export function imageRatioDeviationPercent(object: ImageObjectData): number {
  const natural = imageNaturalAspectRatio(object);
  const current = imageAspectRatio(object);
  if (natural <= 0 || current <= 0) {
    return 0;
  }
  return Math.abs((current - natural) / natural) * 100;
}

/**
 * The full reset patch: the placed size returns to the INTRINSIC pixel
 * size while the object's CENTRE stays fixed (Phase 23 — «بازنشانی به
 * اندازهٔ اصلی»). One resize command commits width/height/position
 * together, so the undo restores the drifted state exactly.
 *
 * @param object - the image object being reset.
 * @returns the after-patch for a `ResizeCommand`, or null when the object
 *          is already at its natural size.
 */
export function naturalResetPatch(object: ImageObjectData): ImageObjectData | null {
  if (!imageSizeDrifted(object)) {
    return null;
  }
  const centreX = object.position.x + object.width / 2;
  const centreY = object.position.y + object.height / 2;
  return {
    ...object,
    width: object.naturalWidth,
    height: object.naturalHeight,
    position: vec2(
      centreX - object.naturalWidth / 2,
      centreY - object.naturalHeight / 2,
    ),
  };
}

/**
 * The ratio-only reset patch: the CURRENT width is kept and the height is
 * recomputed from the intrinsic ratio (Phase 23 — «بازنشانی نسبت»), centre
 * preserved horizontally, vertically re-centred on the new height.
 *
 * @param object - the image object being reset.
 * @returns the after-patch for a `ResizeCommand`, or null when the ratio
 *          already matches the intrinsic ratio.
 */
export function ratioResetPatch(object: ImageObjectData): ImageObjectData | null {
  if (imageRatioDeviationPercent(object) <= 0.5) {
    return null;
  }
  const ratio = imageNaturalAspectRatio(object);
  if (ratio <= 0) {
    return null;
  }
  const height = Math.max(1, Math.round(object.width / ratio));
  const centreY = object.position.y + object.height / 2;
  return {
    ...object,
    height,
    position: vec2(object.position.x, centreY - height / 2),
  };
}

/** Position/size/rotation drift tolerance (world units / radians). */
const INSERT_DRIFT_TOLERANCE = 0.5;

/** Rotation drift tolerance in radians (≈0.57° — well below a 15° snap). */
const INSERT_ROTATION_TOLERANCE = 0.01;

/**
 * Whether the placed state has drifted from the «زمان صفر» snapshot
 * (فاز ۳۴ — the reset-to-insert affordance's enabled state).
 *
 * @param object - the image object to check.
 * @returns true when width/height/position/rotation differ from the
 *          insert-time snapshot; legacy objects WITHOUT a snapshot fall
 *          back to the natural-size drift check (the fallback target).
 */
export function imageInsertStateDrifted(object: ImageObjectData): boolean {
  const initial = object.initial;
  if (initial === undefined) {
    return imageSizeDrifted(object);
  }
  return (
    Math.abs(object.width - initial.width) > INSERT_DRIFT_TOLERANCE ||
    Math.abs(object.height - initial.height) > INSERT_DRIFT_TOLERANCE ||
    Math.abs(object.position.x - initial.x) > INSERT_DRIFT_TOLERANCE ||
    Math.abs(object.position.y - initial.y) > INSERT_DRIFT_TOLERANCE ||
    Math.abs(object.rotation - initial.rotation) > INSERT_ROTATION_TOLERANCE
  );
}

/**
 * The «زمان صفر» reset patch (فاز ۳۴ — «بازنشانی به حالت درج»): the placed
 * size, position AND rotation return to the exact insert-time snapshot —
 * the state the image had at the moment it entered THIS canvas. One
 * `ResizeCommand` commits the whole patch (immutable snapshots), so undo
 * restores the drifted state exactly.
 *
 * Legacy objects without a snapshot degrade to the natural-size reset
 * (centre-preserving) — the closest honest reconstruction of "insert".
 *
 * @param object - the image object being reset.
 * @returns the after-patch for a `ResizeCommand`, or null when already at
 *          its insert state (or natural size, for legacy objects).
 */
export function insertStateResetPatch(
  object: ImageObjectData,
): ImageObjectData | null {
  const initial = object.initial;
  if (initial === undefined) {
    return naturalResetPatch(object);
  }
  if (!imageInsertStateDrifted(object)) {
    return null;
  }
  return {
    ...object,
    width: initial.width,
    height: initial.height,
    position: vec2(initial.x, initial.y),
    rotation: initial.rotation,
  };
}
