/** Unit tests for the anchor points of object bounds. */
import { describe, expect, it } from "vitest";
import {
  ANCHOR_COUNT,
  anchorAt,
  anchorPositions,
  nearestAnchor,
} from "@/core/model/Anchors";
import { bbox } from "@/core/geometry/BBox";
import { vec2 } from "@/core/geometry/Vec2";

/**
 * Builds the reference box used by most tests: a 100×100 box whose top-left
 * sits at (10, 20) (midX = 60, midY = 70).
 */
function box(): ReturnType<typeof bbox> {
  return bbox(10, 20, 110, 120);
}

describe("Anchors constants", () => {
  it("exports eight anchors per object", () => {
    expect(ANCHOR_COUNT).toBe(8);
  });
});

describe("anchorPositions", () => {
  it("returns the eight anchors in index order (N, E, S, W, NE, SE, SW, NW)", () => {
    expect(anchorPositions(box())).toEqual([
      vec2(60, 20), // 0: N (top edge midpoint)
      vec2(110, 70), // 1: E
      vec2(60, 120), // 2: S
      vec2(10, 70), // 3: W
      vec2(110, 20), // 4: NE
      vec2(110, 120), // 5: SE
      vec2(10, 120), // 6: SW
      vec2(10, 20), // 7: NW
    ]);
  });

  it("returns exactly ANCHOR_COUNT positions", () => {
    expect(anchorPositions(box())).toHaveLength(ANCHOR_COUNT);
  });

  it("collapses every anchor to the same point for a degenerate box", () => {
    const positions = anchorPositions(bbox(5, 5, 5, 5));
    for (const position of positions) {
      expect(position).toEqual(vec2(5, 5));
    }
  });

  it("returns fresh position arrays per call (no shared mutable state)", () => {
    expect(anchorPositions(box())).not.toBe(anchorPositions(box()));
  });
});

describe("anchorAt", () => {
  it("resolves each in-range index to its compass position", () => {
    expect(anchorAt(box(), 0)).toEqual(vec2(60, 20));
    expect(anchorAt(box(), 1)).toEqual(vec2(110, 70));
    expect(anchorAt(box(), 2)).toEqual(vec2(60, 120));
    expect(anchorAt(box(), 3)).toEqual(vec2(10, 70));
    expect(anchorAt(box(), 4)).toEqual(vec2(110, 20));
    expect(anchorAt(box(), 5)).toEqual(vec2(110, 120));
    expect(anchorAt(box(), 6)).toEqual(vec2(10, 120));
    expect(anchorAt(box(), 7)).toEqual(vec2(10, 20));
  });

  it("wraps indices modulo ANCHOR_COUNT (8 → N, 9 → E, 16 → N)", () => {
    expect(anchorAt(box(), 8)).toEqual(vec2(60, 20));
    expect(anchorAt(box(), 9)).toEqual(vec2(110, 70));
    expect(anchorAt(box(), 16)).toEqual(vec2(60, 20));
  });

  it("wraps negative indices into range (-1 → NW, -8 → N, -9 → NW)", () => {
    expect(anchorAt(box(), -1)).toEqual(vec2(10, 20));
    expect(anchorAt(box(), -8)).toEqual(vec2(60, 20));
    expect(anchorAt(box(), -9)).toEqual(vec2(10, 20));
  });

  it("truncates fractional indices before wrapping (2.9 → S, 8.5 → N)", () => {
    expect(anchorAt(box(), 2.9)).toEqual(vec2(60, 120));
    expect(anchorAt(box(), 8.5)).toEqual(vec2(60, 20));
  });

  it("falls back to the box centre for an unindexable (NaN) index", () => {
    // positions[NaN] is undefined; the defensive fallback centres the box.
    expect(anchorAt(box(), Number.NaN)).toEqual(vec2(60, 70));
  });
});

describe("nearestAnchor", () => {
  it("snaps to the anchor nearest the probe point (NE corner)", () => {
    const near = nearestAnchor(box(), vec2(105, 25));
    expect(near.index).toBe(4);
    expect(near.position).toEqual(vec2(110, 20));
  });

  it("snaps to the anchor nearest the probe point (W edge midpoint)", () => {
    const near = nearestAnchor(box(), vec2(14, 71));
    expect(near.index).toBe(3);
    expect(near.position).toEqual(vec2(10, 70));
  });

  it("returns the exact anchor when probing directly on it (S)", () => {
    const near = nearestAnchor(box(), vec2(60, 120));
    expect(near.index).toBe(2);
    expect(near.position).toEqual(vec2(60, 120));
  });

  it("resolves ties to the lowest anchor index (equidistant N and NE)", () => {
    // (85, 20) is equidistant (25) between N (60, 20) and NE (110, 20); the
    // first anchor in index order wins.
    const near = nearestAnchor(box(), vec2(85, 20));
    expect(near.index).toBe(0);
    expect(near.position).toEqual(vec2(60, 20));
  });

  it("falls back to N when every anchor collapses (degenerate box)", () => {
    const near = nearestAnchor(bbox(5, 5, 5, 5), vec2(400, 300));
    expect(near.index).toBe(0);
    expect(near.position).toEqual(vec2(5, 5));
  });

  it("works for probes far outside the box (distance-ordered, no clamping)", () => {
    // (200, 70) is 90 east of E (110, 70) but further from every other anchor.
    const near = nearestAnchor(box(), vec2(200, 70));
    expect(near.index).toBe(1);
    expect(near.position).toEqual(vec2(110, 70));
  });
});
