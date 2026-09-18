/**
 * Pure hit-testing helpers.
 *
 * Authoritative hit-testing always runs against the scene model, never
 * against DOM geometry (CLAUDE.md §1.3).
 */
import type { BBox } from "@/core/geometry/BBox";
import type { Vec2 } from "@/core/geometry/Vec2";

/**
 * @param point - point to test.
 * @param b - box to test against.
 * @returns whether `point` lies inside or on the boundary of `b`.
 */
export function pointInBBox(point: Vec2, b: BBox): boolean {
  return (
    point.x >= b.minX &&
    point.x <= b.maxX &&
    point.y >= b.minY &&
    point.y <= b.maxY
  );
}

/**
 * Computes the smallest distance from a point to a line segment.
 *
 * @param point - point to measure from.
 * @param segmentStart - first segment endpoint.
 * @param segmentEnd - second segment endpoint.
 * @returns the Euclidean distance to the closest point of the segment
 * (clamped to the segment, so endpoints count).
 */
export function distanceToSegment(
  point: Vec2,
  segmentStart: Vec2,
  segmentEnd: Vec2,
): number {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    // Degenerate segment: distance to the single endpoint.
    return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y);
  }
  // Projection parameter clamped to [0, 1] keeps the closest point on the segment.
  const t =
    ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) /
    lengthSquared;
  const clamped = Math.min(1, Math.max(0, t));
  const closestX = segmentStart.x + clamped * dx;
  const closestY = segmentStart.y + clamped * dy;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

/**
 * @param a - first box.
 * @param b - second box.
 * @returns whether the two boxes overlap or touch (edges included).
 */
export function bboxIntersectsBBox(a: BBox, b: BBox): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
  );
}

/**
 * Computes the intersection rectangle of two boxes.
 *
 * @param a - first box.
 * @param b - second box.
 * @returns the shared rectangle, or null when the boxes are disjoint.
 */
export function bboxIntersection(a: BBox, b: BBox): BBox | null {
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);
  if (minX > maxX || minY > maxY) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}
