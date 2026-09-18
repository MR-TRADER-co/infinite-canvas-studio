/** Unit tests for the bounding-box helpers. */
import { describe, expect, it } from "vitest";
import {
  bbox,
  bboxCenter,
  bboxContainsPoint,
  bboxUnion,
  emptyBBox,
} from "@/core/geometry/BBox";
import { vec2 } from "@/core/geometry/Vec2";

describe("BBox helpers", () => {
  it("bbox builds a box from its edges", () => {
    expect(bbox(1, 2, 3, 4)).toEqual({ minX: 1, minY: 2, maxX: 3, maxY: 4 });
  });

  it("emptyBBox is the degenerate point box at the origin", () => {
    expect(emptyBBox()).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(bboxContainsPoint(emptyBBox(), vec2(0, 0))).toBe(true);
  });

  it("bboxCenter computes the midpoint of the box", () => {
    expect(bboxCenter(bbox(0, 0, 10, 20))).toEqual({ x: 5, y: 10 });
    expect(bboxCenter(bbox(-2, -4, 2, 4))).toEqual({ x: 0, y: 0 });
  });

  it("bboxUnion encloses both boxes", () => {
    expect(bboxUnion(bbox(0, 0, 2, 2), bbox(4, 4, 6, 6))).toEqual({
      minX: 0,
      minY: 0,
      maxX: 6,
      maxY: 6,
    });
  });

  it("bboxUnion returns the same box when one input contains the other", () => {
    const outer = bbox(-5, -5, 5, 5);
    expect(bboxUnion(outer, bbox(-1, -1, 1, 1))).toEqual(outer);
    expect(bboxUnion(bbox(-1, -1, 1, 1), outer)).toEqual(outer);
  });

  it("bboxUnion handles overlapping boxes", () => {
    expect(bboxUnion(bbox(0, 0, 4, 4), bbox(2, 2, 6, 6))).toEqual({
      minX: 0,
      minY: 0,
      maxX: 6,
      maxY: 6,
    });
  });

  it("bboxContainsPoint includes interior and boundary, excludes outside", () => {
    const b = bbox(0, 0, 10, 10);
    expect(bboxContainsPoint(b, vec2(5, 5))).toBe(true);
    expect(bboxContainsPoint(b, vec2(0, 0))).toBe(true);
    expect(bboxContainsPoint(b, vec2(10, 10))).toBe(true);
    expect(bboxContainsPoint(b, vec2(10.001, 5))).toBe(false);
    expect(bboxContainsPoint(b, vec2(-0.001, 5))).toBe(false);
    expect(bboxContainsPoint(b, vec2(5, -1))).toBe(false);
    expect(bboxContainsPoint(b, vec2(5, 11))).toBe(false);
  });
});
