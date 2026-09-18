/**
 * Opaque object: the placeholder materialised for an object whose type id is
 * NOT registered in the {@link ObjectRegistry} (R4.3, CLAUDE.md §1.7.4).
 *
 * Nothing is ever lost: the raw JSON of the unknown object is retained
 * verbatim, a bounding box is derived from whatever position/size fields the
 * payload carries (with a sane degenerate fallback), the canvas renders a
 * dashed placeholder with the Persian label «شیء ناشناخته», and the object is
 * selectable but never editable or movable (materialised as locked).
 * Serialization writes the ORIGINAL raw JSON back out byte-for-semantic-byte.
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import { bbox, type BBox } from "@/core/geometry/BBox";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";

/** i18n key of the placeholder label (rendered on the canvas layer). */
export const OPAQUE_LABEL_KEY = "object.opaque" as const;

/** Fallback footprint of a size-less unknown object, in world units. */
export const OPAQUE_FALLBACK_SIZE = 96;

/** Data of an opaque (unknown-type) object. */
export interface OpaqueObjectData extends SceneObjectData {
  /** Discriminant: always `opaque` (the wire `kind` lives inside `raw`). */
  readonly kind: "opaque";
  /** The verbatim raw JSON of the unknown object, kept for round-trips. */
  readonly raw: Record<string, unknown>;
}

/**
 * @param object - the object to inspect.
 * @returns whether the object is an opaque placeholder.
 */
export function isOpaqueObject(
  object: SceneObjectData,
): object is OpaqueObjectData {
  return object.kind === "opaque";
}

/**
 * Materialises an unknown-type payload into an opaque object (R4.3).
 *
 * Identity and geometry fields are read DEFENSIVELY from the raw JSON — a
 * hand-edited or plugin-written payload may miss or corrupt any of them, and
 * a placeholder must never crash the app on load. Sane defaults fill the
 * gaps; `locked` is forced true (selectable, not editable/movable).
 *
 * @param raw - the raw JSON object with an unregistered `kind`.
 * @returns the opaque placeholder data.
 */
export function materializeOpaqueObject(
  raw: Record<string, unknown>,
): OpaqueObjectData {
  const position = readPosition(raw);
  const rawRotation = raw.rotation;
  const rawZIndex = raw.zIndex;
  return {
    kind: "opaque",
    id:
      typeof raw.id === "string" && raw.id.length > 0
        ? raw.id
        : `opaque-${position.x}-${position.y}`,
    name: typeof raw.name === "string" ? raw.name : undefined,
    parentId: typeof raw.parentId === "string" ? raw.parentId : undefined,
    position,
    rotation:
      typeof rawRotation === "number" && Number.isFinite(rawRotation)
        ? rawRotation
        : 0,
    zIndex:
      typeof rawZIndex === "number" && Number.isFinite(rawZIndex)
        ? rawZIndex
        : 0,
    visible: raw.visible === undefined ? true : raw.visible !== false,
    locked: true,
    raw,
  };
}

/**
 * Derives the bounding box of an opaque object from its raw payload
 * (R4.3: "derives a bbox from stored x/y/width/height, sane fallback").
 *
 * Accepted spellings, most specific first: a `position: {x, y}` pair with
 * numeric `width`/`height`; flat `x`/`y`/`width`/`height` fields. Anything
 * else (or degenerate sizes) collapses to a square footprint anchored at the
 * resolved origin so the placeholder stays visible and selectable.
 *
 * @param raw - the verbatim raw JSON of the unknown object.
 * @returns the axis-aligned world-space box covering the placeholder.
 */
export function opaqueBBox(raw: Record<string, unknown>): BBox {
  const position = readPosition(raw);
  const width = readFinite(raw.width);
  const height = readFinite(raw.height);
  if (width === null || height === null || width <= 0 || height <= 0) {
    return bbox(
      position.x,
      position.y,
      position.x + OPAQUE_FALLBACK_SIZE,
      position.y + OPAQUE_FALLBACK_SIZE,
    );
  }
  return bbox(position.x, position.y, position.x + width, position.y + height);
}

/**
 * Reads the raw object's origin: `position: {x, y}` when present, flat
 * `x`/`y` fields otherwise, `(0, 0)` as the last resort.
 *
 * @param raw - the verbatim raw JSON of the unknown object.
 * @returns the world-space origin of the placeholder.
 */
function readPosition(raw: Record<string, unknown>): Vec2 {
  if (typeof raw.position === "object" && raw.position !== null) {
    const candidate = raw.position as { x?: unknown; y?: unknown };
    const x = readFinite(candidate.x);
    const y = readFinite(candidate.y);
    if (x !== null && y !== null) {
      return vec2(x, y);
    }
  }
  const x = readFinite(raw.x);
  const y = readFinite(raw.y);
  if (x !== null && y !== null) {
    return vec2(x, y);
  }
  return vec2(0, 0);
}

/**
 * @param value - the raw value to test.
 * @returns the value when it is a finite number, else null.
 */
function readFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
