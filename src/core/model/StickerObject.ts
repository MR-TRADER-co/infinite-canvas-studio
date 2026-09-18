/**
 * Emoji sticker object (R11.1 — «استیکر»): a single emoji glyph placed on
 * the canvas, FigJam-style. The emoji renders through the platform emoji
 * font (fully offline — no assets, no network), sized to the object's
 * world-space footprint.
 *
 * Geometry follows the shape precedent: `width`/`height` measured from
 * `position` (the top-left corner) — axis-aligned, so `objectBBox`,
 * `translateSceneObject` and the whole R4 manipulation machinery work on
 * stickers with zero extra code. The aspect ratio stays square by
 * convention (the insert cards default 96×96 and resizing keeps the
 * glyph centred inside whatever box the user drags).
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";

/** Default sticker footprint in world units (square, touch-friendly). */
export const STICKER_DEFAULT_SIZE = 96;

/**
 * Data of an emoji sticker object.
 */
export interface StickerObjectData extends SceneObjectData {
  /** Discriminant: always `sticker`. */
  readonly kind: "sticker";
  /** The emoji glyph (one or more UTF-16 code points forming one glyph). */
  readonly emoji: string;
  /** Sticker width in world units (≥ 0; `position` is the top-left corner). */
  readonly width: number;
  /** Sticker height in world units (≥ 0). */
  readonly height: number;
}

/**
 * Type guard narrowing a generic scene object to its sticker variant.
 *
 * @param object - the object to test.
 * @returns whether the object is a sticker.
 */
export function isStickerObject(
  object: SceneObjectData,
): object is StickerObjectData {
  return (
    object.kind === "sticker" &&
    typeof (object as StickerObjectData).emoji === "string" &&
    typeof (object as StickerObjectData).width === "number" &&
    typeof (object as StickerObjectData).height === "number"
  );
}

/**
 * Assembles a complete sticker object.
 *
 * @param id - the object id.
 * @param emoji - the emoji glyph.
 * @param position - the top-left corner in world space.
 * @param size - the square footprint in world units (defaults 96).
 * @param zIndex - the paint order.
 * @returns the sticker object data.
 */
export function makeStickerObject(
  id: string,
  emoji: string,
  position: Vec2,
  size: number = STICKER_DEFAULT_SIZE,
  zIndex: number = 0,
): StickerObjectData {
  return {
    kind: "sticker",
    id,
    position,
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    emoji,
    width: size,
    height: size,
  };
}

/**
 * The default world position handed to factory-made stickers (the insert
 * path re-centres the object on the drop point, so the raw value only
 * matters for tests).
 */
export const STICKER_FACTORY_ORIGIN = vec2(0, 0);
