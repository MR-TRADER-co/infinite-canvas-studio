/**
 * Pure stroke-smoothing geometry (R5.4/AC5.8).
 *
 * Extracted from the renderer's canvas-coupled `tracePath` so the
 * midpoint-quadratic smoothing is node-testable: raw input points go in, a
 * path description comes out — the renderer (and any future rasterizer)
 * only maps the points through the camera and feeds them to the Canvas2D
 * path API. The algorithm is unchanged (never raw polylines):
 *
 * - the first two points open with a straight segment (keeps the stroke's
 *   start honest under the pointer),
 * - every following point `p[i]` contributes a quadratic whose control
 *   point is `p[i]` itself and whose end point is the midpoint of
 *   `p[i-1]`/`p[i]` (classic midpoint smoothing),
 * - the final point closes with a straight segment to itself.
 */
import { vec2, type Vec2 } from "@/core/geometry/Vec2";

/** One quadratic segment: control point + end point (both world space). */
export interface SmoothedQuad {
  /** Quadratic control point (the raw input point). */
  readonly control: Vec2;
  /** Quadratic end point (midpoint of the neighbouring raw points). */
  readonly end: Vec2;
}

/** Pure description of one smoothed stroke path. */
export interface SmoothedPath {
  /** Path start (the first raw point). */
  readonly start: Vec2;
  /** Straight opening segment end (the second raw point). */
  readonly firstLineTo: Vec2;
  /** Midpoint quadratics, in drawing order. */
  readonly quads: readonly SmoothedQuad[];
  /** Straight closing segment end (the last raw point). */
  readonly finalLineTo: Vec2;
}

/**
 * Smooths a raw point sequence into midpoint-quadratic path description.
 *
 * A single point degenerates to a zero-length path (`start === end`) whose
 * round line cap paints a dot; two points degenerate to a plain line.
 *
 * @param points - stroke points in world coordinates (never empty per the
 *        freehand contract; defensive against callers passing `[]`).
 * @returns the smoothed path description.
 */
export function smoothedStrokePath(points: readonly Vec2[]): SmoothedPath {
  const first = points[0] ?? vec2(0, 0);
  if (points.length <= 1) {
    return { start: first, firstLineTo: first, quads: [], finalLineTo: first };
  }
  const second = points[1] ?? first;
  const quads: SmoothedQuad[] = [];
  for (let i = 2; i < points.length; i += 1) {
    const previous = points[i - 1] ?? first;
    const current = points[i] ?? second;
    quads.push({
      control: current,
      end: vec2((previous.x + current.x) / 2, (previous.y + current.y) / 2),
    });
  }
  const last = points[points.length - 1] ?? first;
  return { start: first, firstLineTo: second, quads, finalLineTo: last };
}
