/**
 * Axis-aligned bounding boxes plus small pure helpers.
 *
 * Boxes are immutable value objects in world space. Degenerate boxes (a
 * single point: `minX === maxX`, `minY === maxY`) are valid; inverted boxes
 * (`minX > maxX`) are NOT — behaviour for them is undefined.
 */
import { vec2 } from "@/core/geometry/Vec2";
import type { Vec2 } from "@/core/geometry/Vec2";

/** Axis-aligned bounding box in world space. */
export interface BBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Builds a bounding box from its edges.
 *
 * @param minX - left edge.
 * @param minY - top edge.
 * @param maxX - right edge.
 * @param maxY - bottom edge.
 * @returns the box spanned by the given edges.
 */
export function bbox(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): BBox {
  return { minX, minY, maxX, maxY };
}

/**
 * @returns the degenerate box at the origin (a single point at `(0, 0)`).
 */
export function emptyBBox(): BBox {
  return bbox(0, 0, 0, 0);
}

/**
 * @param b - box to measure.
 * @returns the center point of the box.
 */
export function bboxCenter(b: BBox): Vec2 {
  return vec2((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
}

/**
 * Computes the bounding box containing both inputs.
 *
 * @param a - first box.
 * @param b - second box.
 * @returns the smallest box enclosing `a` and `b`.
 */
export function bboxUnion(a: BBox, b: BBox): BBox {
  return bbox(
    Math.min(a.minX, b.minX),
    Math.min(a.minY, b.minY),
    Math.max(a.maxX, b.maxX),
    Math.max(a.maxY, b.maxY),
  );
}

/**
 * @param b - box to test.
 * @param point - point to test.
 * @returns whether `point` lies inside or on the boundary of `b`.
 */
export function bboxContainsPoint(b: BBox, point: Vec2): boolean {
  return (
    point.x >= b.minX &&
    point.x <= b.maxX &&
    point.y >= b.minY &&
    point.y <= b.maxY
  );
}
