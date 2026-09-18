/**
 * Unit tests for the pure midpoint-quadratic stroke smoothing (R5.4/AC5.8):
 * the extracted geometry feeds the renderer's `tracePath` verbatim, so the
 * smoothing contract is node-testable.
 */
import { describe, expect, it } from "vitest";
import { smoothedStrokePath } from "@/core/geometry/strokeSmoothing";
import { vec2 } from "@/core/geometry/Vec2";

describe("smoothedStrokePath", () => {
  it("degenerates a single point to a zero-length path (dot)", () => {
    const path = smoothedStrokePath([vec2(10, 20)]);
    expect(path.start).toEqual(vec2(10, 20));
    expect(path.firstLineTo).toEqual(vec2(10, 20));
    expect(path.quads).toHaveLength(0);
    expect(path.finalLineTo).toEqual(vec2(10, 20));
  });

  it("degenerates two points to a plain line", () => {
    const path = smoothedStrokePath([vec2(0, 0), vec2(10, 0)]);
    expect(path.start).toEqual(vec2(0, 0));
    expect(path.firstLineTo).toEqual(vec2(10, 0));
    expect(path.quads).toHaveLength(0);
    expect(path.finalLineTo).toEqual(vec2(10, 0));
  });

  it("emits one midpoint quad per point beyond the second (never raw polylines)", () => {
    const path = smoothedStrokePath([
      vec2(0, 0),
      vec2(10, 0),
      vec2(20, 0),
      vec2(30, 0),
    ]);
    expect(path.quads).toHaveLength(2);
    // First quad: control = p[2] (20,0), end = midpoint p[1]/p[2] (15,0).
    expect(path.quads[0]?.control).toEqual(vec2(20, 0));
    expect(path.quads[0]?.end).toEqual(vec2(15, 0));
    // Second quad: control = p[3] (30,0), end = midpoint p[2]/p[3] (25,0).
    expect(path.quads[1]?.control).toEqual(vec2(30, 0));
    expect(path.quads[1]?.end).toEqual(vec2(25, 0));
    // The closing line lands on the raw final point.
    expect(path.finalLineTo).toEqual(vec2(30, 0));
  });

  it("keeps midpoints exactly between the neighbouring raw points", () => {
    const path = smoothedStrokePath([vec2(0, 0), vec2(4, 10), vec2(12, 2)]);
    const quad = path.quads[0];
    expect(quad).toBeDefined();
    if (quad !== undefined) {
      expect(quad.control).toEqual(vec2(12, 2));
      expect(quad.end).toEqual(vec2(8, 6));
    }
  });

  it("defends against an empty point list", () => {
    const path = smoothedStrokePath([]);
    expect(path.start).toEqual(vec2(0, 0));
    expect(path.quads).toHaveLength(0);
  });
});
