/** Unit tests for the pure resize-handle geometry helpers. */
import { describe, expect, it } from "vitest";
import {
  RESIZE_HANDLE_IDS,
  handleAnchors,
  hitResizeHandle,
  resizeRectFromHandle,
  type ResizeHandleId,
} from "@/core/geometry/resize";
import { Camera } from "@/core/camera/Camera";
import { bbox } from "@/core/geometry/BBox";
import { vec2 } from "@/core/geometry/Vec2";
import type { BBox } from "@/core/geometry/BBox";
import type { Vec2 } from "@/core/geometry/Vec2";

/** Gesture-start box used by the drag-frame fixtures (100×50 at (10, 20)). */
const BOX = bbox(10, 20, 110, 70);

/** Minimum size used by the drag-frame fixtures (world units). */
const MIN_SIZE = 8;

/** Outward pointer drags per handle with the expected resulting frame. */
const OUTWARD_DRAGS: ReadonlyArray<{
  readonly handle: ResizeHandleId;
  readonly pointer: Vec2;
  readonly expected: BBox;
}> = [
  { handle: "nw", pointer: vec2(0, 5), expected: bbox(0, 5, 110, 70) },
  { handle: "ne", pointer: vec2(150, 0), expected: bbox(10, 0, 150, 70) },
  { handle: "se", pointer: vec2(160, 90), expected: bbox(10, 20, 160, 90) },
  { handle: "sw", pointer: vec2(-5, 120), expected: bbox(-5, 20, 110, 120) },
  { handle: "n", pointer: vec2(60, 5), expected: bbox(10, 5, 110, 70) },
  { handle: "e", pointer: vec2(150, 45), expected: bbox(10, 20, 150, 70) },
  { handle: "s", pointer: vec2(60, 100), expected: bbox(10, 20, 110, 100) },
  { handle: "w", pointer: vec2(-20, 45), expected: bbox(-20, 20, 110, 70) },
];

describe("RESIZE_HANDLE_IDS", () => {
  it("lists the eight handle ids with the four corners first", () => {
    expect(RESIZE_HANDLE_IDS).toEqual([
      "nw",
      "ne",
      "se",
      "sw",
      "n",
      "e",
      "s",
      "w",
    ]);
    expect(RESIZE_HANDLE_IDS).toHaveLength(8);
    expect(new Set(RESIZE_HANDLE_IDS).size).toBe(8);
  });
});

describe("resizeRectFromHandle", () => {
  it("follows the dragged edges outward while the opposite edges stay fixed for every handle", () => {
    for (const drag of OUTWARD_DRAGS) {
      const result = resizeRectFromHandle(
        BOX,
        drag.handle,
        drag.pointer,
        MIN_SIZE,
        false,
      );
      expect(result).toEqual(drag.expected);
    }
  });

  it("grows the width when the e handle drags right", () => {
    const result = resizeRectFromHandle(
      BOX,
      "e",
      vec2(150, 45),
      MIN_SIZE,
      false,
    );
    expect(result).toEqual(bbox(10, 20, 150, 70));
    expect(result.maxX - result.minX).toBe(140);
  });

  it("changes only maxY when the s handle drags down", () => {
    const result = resizeRectFromHandle(
      BOX,
      "s",
      vec2(60, 100),
      MIN_SIZE,
      false,
    );
    expect(result).toEqual(bbox(10, 20, 110, 100));
  });

  it("moves both min edges and keeps both max edges fixed on an nw drag", () => {
    const result = resizeRectFromHandle(BOX, "nw", vec2(0, 5), MIN_SIZE, false);
    expect(result).toEqual(bbox(0, 5, 110, 70));
    expect(result.maxX).toBe(BOX.maxX);
    expect(result.maxY).toBe(BOX.maxY);
  });

  it("clamps the e handle to the minimum size anchored at the fixed minX for a sub-min-size before box", () => {
    // Zero-width before box: the provisional frame is 1 wide, below the minimum.
    const result = resizeRectFromHandle(
      bbox(10, 20, 10, 70),
      "e",
      vec2(11, 45),
      MIN_SIZE,
      false,
    );
    expect(result).toEqual(bbox(10, 20, 18, 70));
    expect(result.maxX - result.minX).toBe(MIN_SIZE);
  });

  it("clamps the w handle to the fixed maxX minus the minimum size", () => {
    // 10-wide before box with a 16 minimum: the frame collapses toward maxX.
    const result = resizeRectFromHandle(
      bbox(100, 20, 110, 70),
      "w",
      vec2(105, 45),
      16,
      false,
    );
    expect(result).toEqual(bbox(94, 20, 110, 70));
    expect(result.maxX - result.minX).toBe(16);
  });

  it("clamps the s handle to the minimum size anchored at the fixed minY for a zero-height before box", () => {
    const result = resizeRectFromHandle(
      bbox(10, 20, 110, 20),
      "s",
      vec2(60, 21),
      MIN_SIZE,
      false,
    );
    expect(result).toEqual(bbox(10, 20, 110, 28));
  });

  it("clamps the n handle to the fixed maxY minus the minimum size", () => {
    const result = resizeRectFromHandle(
      bbox(10, 70, 110, 70),
      "n",
      vec2(60, 69),
      MIN_SIZE,
      false,
    );
    expect(result).toEqual(bbox(10, 62, 110, 70));
    expect(result.maxY - result.minY).toBe(MIN_SIZE);
  });

  it("keeps the uncontrolled y axis at its before values on an e drag (zero-height before box)", () => {
    // Zero-height before box on an e drag: no y edge is controlled, so the
    // y axis keeps the before values (the pointer's y is ignored) and is
    // not min-clamped (nothing to anchor against).
    const result = resizeRectFromHandle(
      bbox(10, 20, 110, 20),
      "e",
      vec2(150, 20.5),
      MIN_SIZE,
      false,
    );
    expect(result).toEqual(bbox(10, 20, 150, 20));
  });

  it("clamps an inward e drag to the minimum size anchored at the fixed minX", () => {
    // Dragging the e handle LEFT past the fixed minX shrinks the box exactly
    // to the minimum size — the controlled edge never crosses its untouched
    // partner (no inversion), and inward drags DO shrink the box.
    const result = resizeRectFromHandle(BOX, "e", vec2(5, 45), MIN_SIZE, false);
    expect(result).toEqual(bbox(10, 20, 18, 70));
    expect(result.maxX - result.minX).toBe(MIN_SIZE);
  });

  it("locks the before aspect ratio from the dominant width axis on a se corner drag", () => {
    const result = resizeRectFromHandle(
      bbox(0, 0, 100, 50),
      "se",
      vec2(200, 100),
      MIN_SIZE,
      true,
    );
    expect(result).toEqual(bbox(0, 0, 200, 100));
    expect((result.maxY - result.minY) / (result.maxX - result.minX)).toBe(0.5);
  });

  it("locks the before aspect ratio from the dominant height axis on a se corner drag", () => {
    const result = resizeRectFromHandle(
      bbox(0, 0, 100, 50),
      "se",
      vec2(120, 200),
      MIN_SIZE,
      true,
    );
    expect(result).toEqual(bbox(0, 0, 400, 200));
    expect((result.maxY - result.minY) / (result.maxX - result.minX)).toBe(0.5);
  });

  it("anchors the nw corner aspect lock at the fixed se corner", () => {
    const result = resizeRectFromHandle(
      bbox(0, 0, 100, 50),
      "nw",
      vec2(-100, -50),
      MIN_SIZE,
      true,
    );
    expect(result).toEqual(bbox(-100, -50, 100, 50));
    expect(result.maxX).toBe(100);
    expect(result.maxY).toBe(50);
  });

  it("anchors the ne corner aspect lock at the fixed sw corner", () => {
    const result = resizeRectFromHandle(
      bbox(0, 0, 100, 50),
      "ne",
      vec2(200, -20),
      MIN_SIZE,
      true,
    );
    expect(result).toEqual(bbox(0, -50, 200, 50));
    expect(result.minX).toBe(0);
    expect(result.maxY).toBe(50);
  });

  it("anchors the sw corner aspect lock at the fixed ne corner", () => {
    const result = resizeRectFromHandle(
      bbox(0, 0, 100, 50),
      "sw",
      vec2(-30, 120),
      MIN_SIZE,
      true,
    );
    expect(result).toEqual(bbox(-140, 0, 100, 120));
    expect(result.maxX).toBe(100);
    expect(result.minY).toBe(0);
  });

  it("grows the perpendicular height around its centre on an e handle aspect drag", () => {
    const result = resizeRectFromHandle(
      bbox(0, 0, 100, 50),
      "e",
      vec2(200, 25),
      MIN_SIZE,
      true,
    );
    expect(result).toEqual(bbox(0, -25, 200, 75));
    expect(result.minX).toBe(0);
    expect((result.minY + result.maxY) / 2).toBe(25);
    expect((result.maxY - result.minY) / (result.maxX - result.minX)).toBe(0.5);
  });

  it("grows the perpendicular height around its centre on a w handle aspect drag", () => {
    const result = resizeRectFromHandle(
      bbox(0, 0, 100, 50),
      "w",
      vec2(-100, 25),
      MIN_SIZE,
      true,
    );
    expect(result).toEqual(bbox(-100, -25, 100, 75));
    expect(result.maxX).toBe(100);
    expect((result.minY + result.maxY) / 2).toBe(25);
  });

  it("grows the perpendicular width around the before x centre on an n handle aspect drag", () => {
    // Edge handles derive the undragged axis from the dragged one: an n drag
    // sets the height from the pointer and widens x around the before x
    // centre, keeping the 2:1 before ratio.
    const result = resizeRectFromHandle(
      bbox(0, 0, 100, 50),
      "n",
      vec2(50, -100),
      MIN_SIZE,
      true,
    );
    expect(result).toEqual(bbox(-100, -100, 200, 50));
    expect((result.minX + result.maxX) / 2).toBe(50);
    expect((result.maxY - result.minY) / (result.maxX - result.minX)).toBe(0.5);
  });

  it("returns the clamped rect unchanged for a zero-width before box with the aspect lock", () => {
    const result = resizeRectFromHandle(
      bbox(10, 20, 10, 70),
      "e",
      vec2(11, 45),
      MIN_SIZE,
      true,
    );
    expect(result).toEqual(bbox(10, 20, 18, 70));
  });

  it("returns the clamped rect unchanged for a zero-height before box with the aspect lock", () => {
    const result = resizeRectFromHandle(
      bbox(10, 20, 110, 20),
      "s",
      vec2(60, 21),
      MIN_SIZE,
      true,
    );
    expect(result).toEqual(bbox(10, 20, 110, 28));
  });
});

describe("hitResizeHandle", () => {
  it("hits the handle whose anchor the point sits on exactly", () => {
    const world = bbox(0, 0, 100, 100);
    const camera = new Camera();
    expect(hitResizeHandle(vec2(0, 0), world, camera, 10)).toBe("nw");
    expect(hitResizeHandle(vec2(100, 100), world, camera, 10)).toBe("se");
    expect(hitResizeHandle(vec2(100, 50), world, camera, 10)).toBe("e");
    expect(hitResizeHandle(vec2(50, 0), world, camera, 10)).toBe("n");
  });

  it("prefers the corner when it is slightly closer than the neighbouring edge midpoint", () => {
    const world = bbox(0, 0, 100, 100);
    const camera = new Camera();
    // 24 px from nw, 26 px from n: the corner wins on strict closeness.
    expect(hitResizeHandle(vec2(24, 0), world, camera, 30)).toBe("nw");
  });

  it("resolves an exact corner/midpoint tie to the corner (corners tested first)", () => {
    // (25, 0) is exactly 25 px from both the nw corner and the n midpoint;
    // the corner wins because corners are tested first with a strict
    // distance comparison.
    const world = bbox(0, 0, 100, 100);
    const camera = new Camera();
    expect(hitResizeHandle(vec2(25, 0), world, camera, 30)).toBe("nw");
  });

  it("returns null when every anchor is beyond the tolerance", () => {
    const world = bbox(0, 0, 100, 100);
    const camera = new Camera();
    expect(hitResizeHandle(vec2(200, 200), world, camera, 10)).toBeNull();
    expect(hitResizeHandle(vec2(12, 0), world, camera, 10)).toBeNull();
  });

  it("misses at exactly the tolerance boundary (strict comparison)", () => {
    const world = bbox(0, 0, 100, 100);
    const camera = new Camera();
    // Exactly 10 px from nw (0, 0): the strict distance comparison treats the
    // tolerance as exclusive, so the boundary itself misses.
    expect(hitResizeHandle(vec2(10, 0), world, camera, 10)).toBeNull();
  });

  it("projects the anchors through a zoomed camera before hit-testing", () => {
    // Camera(x, y, zoom, rotation): at zoom 2 the e anchor of a 100×100 box
    // sits at screen (200, 100) — screen distances scale with the zoom.
    const world = bbox(0, 0, 100, 100);
    const camera = new Camera(0, 0, 2, 0);
    expect(hitResizeHandle(vec2(205, 100), world, camera, 10)).toBe("e");
    expect(hitResizeHandle(vec2(211, 100), world, camera, 10)).toBeNull();
    // 12 screen px = 6 world px from the anchor: still beyond the 10 px
    // screen tolerance, so the hit misses at zoom 2.
    expect(hitResizeHandle(vec2(200, 112), world, camera, 10)).toBeNull();
  });

  it("hits through a panned camera", () => {
    // Camera anchor (-50, -25): world (0, 0) projects to screen (50, 25).
    const world = bbox(0, 0, 100, 100);
    const camera = new Camera(-50, -25, 1, 0);
    expect(hitResizeHandle(vec2(150, 125), world, camera, 10)).toBe("se");
    expect(hitResizeHandle(vec2(52, 25), world, camera, 10)).toBe("nw");
  });
});

describe("handleAnchors", () => {
  it("returns the eight anchors in nw,n,ne,w,e,sw,s,se order for the identity camera", () => {
    const anchors = handleAnchors(BOX, new Camera());
    expect(anchors.map((anchor) => anchor.id)).toEqual([
      "nw",
      "n",
      "ne",
      "w",
      "e",
      "sw",
      "s",
      "se",
    ]);
    expect(anchors.map((anchor) => [anchor.screen.x, anchor.screen.y])).toEqual(
      [
        [10, 20],
        [60, 20],
        [110, 20],
        [10, 45],
        [110, 45],
        [10, 70],
        [60, 70],
        [110, 70],
      ],
    );
  });

  it("scales the anchors with the camera zoom", () => {
    const anchors = handleAnchors(bbox(0, 0, 100, 100), new Camera(0, 0, 2, 0));
    expect(anchors.map((anchor) => [anchor.screen.x, anchor.screen.y])).toEqual(
      [
        [0, 0],
        [100, 0],
        [200, 0],
        [0, 100],
        [200, 100],
        [0, 200],
        [100, 200],
        [200, 200],
      ],
    );
  });

  it("offsets the anchors by the camera anchor position", () => {
    const anchors = handleAnchors(
      bbox(0, 0, 100, 100),
      new Camera(-50, -25, 1, 0),
    );
    expect(anchors.map((anchor) => [anchor.screen.x, anchor.screen.y])).toEqual(
      [
        [50, 25],
        [100, 25],
        [150, 25],
        [50, 75],
        [150, 75],
        [50, 125],
        [100, 125],
        [150, 125],
      ],
    );
  });

  it("normalises flipped corner projections under a rotated camera", () => {
    // A 180° rotation projects the min and max corners onto each other's
    // sides; the anchors stay a valid box mirrored through the origin.
    const anchors = handleAnchors(
      bbox(0, 0, 100, 50),
      new Camera(0, 0, 1, Math.PI),
    );
    const expected: ReadonlyArray<readonly [number, number]> = [
      [-100, -50],
      [-50, -50],
      [0, -50],
      [-100, -25],
      [0, -25],
      [-100, 0],
      [-50, 0],
      [0, 0],
    ];
    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      const point = expected[index];
      if (anchor === undefined || point === undefined) {
        throw new Error("expected eight anchors");
      }
      expect(anchor.screen.x).toBeCloseTo(point[0], 10);
      expect(anchor.screen.y).toBeCloseTo(point[1], 10);
    }
  });
});
