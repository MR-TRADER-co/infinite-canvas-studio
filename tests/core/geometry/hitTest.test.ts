/** Unit tests for the pure hit-testing helpers. */
import { describe, expect, it } from "vitest";
import { bbox } from "@/core/geometry/BBox";
import {
  bboxIntersectsBBox,
  distanceToSegment,
  pointInBBox,
} from "@/core/geometry/hitTest";
import { vec2 } from "@/core/geometry/Vec2";

describe("hitTest", () => {
  it("pointInBBox matches bboxContainsPoint semantics", () => {
    const b = bbox(0, 0, 10, 10);
    expect(pointInBBox(vec2(5, 5), b)).toBe(true);
    expect(pointInBBox(vec2(0, 10), b)).toBe(true);
    expect(pointInBBox(vec2(-1, 5), b)).toBe(false);
    expect(pointInBBox(vec2(5, 10.1), b)).toBe(false);
  });

  it("distanceToSegment returns 0 for points on the segment", () => {
    const a = vec2(0, 0);
    const b = vec2(10, 0);
    expect(distanceToSegment(vec2(5, 0), a, b)).toBe(0);
    expect(distanceToSegment(a, a, b)).toBe(0);
    expect(distanceToSegment(b, a, b)).toBe(0);
  });

  it("distanceToSegment measures the perpendicular distance", () => {
    const a = vec2(0, 0);
    const b = vec2(10, 0);
    expect(distanceToSegment(vec2(5, 3), a, b)).toBe(3);
    expect(distanceToSegment(vec2(5, -4), a, b)).toBe(4);
  });

  it("distanceToSegment clamps to the nearest endpoint beyond the segment", () => {
    const a = vec2(0, 0);
    const b = vec2(10, 0);
    // Closest point is the endpoint (10, 0) → distance 5.
    expect(distanceToSegment(vec2(13, 4), a, b)).toBe(5);
    // Closest point is the endpoint (0, 0) → distance sqrt(9+16) = 5.
    expect(distanceToSegment(vec2(-3, -4), a, b)).toBe(5);
  });

  it("distanceToSegment handles degenerate (point) segments", () => {
    const point = vec2(3, 4);
    expect(distanceToSegment(vec2(3, 8), point, point)).toBe(4);
    expect(distanceToSegment(point, point, point)).toBe(0);
  });

  it("distanceToSegment works for diagonal segments", () => {
    // Point (1, 1) on the diagonal (0,0)–(10,10): distance 0.
    expect(
      distanceToSegment(vec2(1, 1), vec2(0, 0), vec2(10, 10)),
    ).toBeLessThan(1e-9);
    // Point (1, -1) is √2 away from the diagonal.
    expect(
      distanceToSegment(vec2(1, -1), vec2(0, 0), vec2(10, 10)),
    ).toBeCloseTo(Math.SQRT2, 12);
  });

  it("bboxIntersectsBBox detects overlaps, touching edges and disjoint boxes", () => {
    expect(bboxIntersectsBBox(bbox(0, 0, 5, 5), bbox(3, 3, 8, 8))).toBe(true);
    expect(bboxIntersectsBBox(bbox(0, 0, 5, 5), bbox(5, 5, 8, 8))).toBe(true); // touching corner
    expect(bboxIntersectsBBox(bbox(0, 0, 5, 5), bbox(5, 0, 8, 3))).toBe(true); // touching edge
    expect(bboxIntersectsBBox(bbox(0, 0, 5, 5), bbox(6, 6, 8, 8))).toBe(false);
    expect(bboxIntersectsBBox(bbox(0, 0, 5, 5), bbox(-8, -8, -6, -6))).toBe(
      false,
    );
  });

  it("bboxIntersectsBBox treats containment as intersection", () => {
    expect(bboxIntersectsBBox(bbox(-5, -5, 5, 5), bbox(-1, -1, 1, 1))).toBe(
      true,
    );
    expect(bboxIntersectsBBox(bbox(-1, -1, 1, 1), bbox(-5, -5, 5, 5))).toBe(
      true,
    );
  });
});
