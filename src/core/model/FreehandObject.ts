/**
 * Freehand object: a pen stroke captured as a point sequence.
 *
 * Points are stored in absolute world coordinates (not relative to
 * `position`); `position` mirrors the first captured point so generic
 * consumers (layers panel, culling) can rely on it without walking the list.
 *
 * PHASE 1 (living canvas): the point list is the streamed pen input; the
 * `StrokeOverlay` carries in-progress drafts of this same shape until the
 * pen tool commits them into the scene through `AddObjectCommand`.
 *
 * PHASE 5 (R5.4): `highlighter` marks marker-mode strokes — the renderer
 * paints them wide, semi-transparent and multiply-blended so underlying
 * canvas ink shows through (text lives in the DOM layer above and always
 * stays readable, AC5.4). Optional so pre-Phase-5 payloads deserialize
 * unchanged as normal strokes.
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { Vec2 } from "@/core/geometry/Vec2";

/** Stroke dash patterns a freehand stroke can use. */
export type StrokeStyleKind = "solid" | "dashed" | "dotted";

/**
 * Type guard narrowing a generic scene object to its freehand variant.
 *
 * @param object - the object to test.
 * @returns whether `object` carries freehand stroke data.
 */
export function isFreehandObject(
  object: SceneObjectData,
): object is FreehandObjectData {
  return object.kind === "freehand";
}

/**
 * Palette token stored in `strokeColor` for theme-adaptive strokes: the
 * renderer resolves it to the active palette's stroke colour, so strokes
 * stay readable in both the dark and the light theme.
 */
export const STROKE_COLOR_TOKEN = "primary";

/** Data of a freehand stroke object. */
export interface FreehandObjectData extends SceneObjectData {
  /** Discriminant: always `freehand`. */
  readonly kind: "freehand";
  /** Captured stroke points in world coordinates, in drawing order. */
  readonly points: readonly Vec2[];
  /** Stroke colour: a CSS colour string or the {@link STROKE_COLOR_TOKEN}. */
  readonly strokeColor: string;
  /** Stroke width in world units. */
  readonly strokeWidth: number;
  /** Stroke dash pattern. */
  readonly strokeStyle: StrokeStyleKind;
  /** Marker mode (R5.4): wide, semi-transparent, multiply-blended ink. */
  readonly highlighter?: boolean;
}
