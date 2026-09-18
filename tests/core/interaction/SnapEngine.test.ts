/**
 * Unit tests for the R5.5 snap engine: the grid candidate contract, the
 * pure scalar/point/box/resize helpers and the runtime configuration
 * (on/off, spacing changes, AC5.5 "edges land exactly on grid").
 */
import { describe, expect, it } from "vitest";
import {
  SnapEngine,
  DEFAULT_SNAP_SPACING,
  SNAP_DISABLED,
  gridSnapCandidates,
  snapScalar,
  snapPointToGrid,
  snapPointIfEnabled,
  snapBoxDisplacement,
  snapResizeRect,
  snapRectOrigin,
} from "@/interaction/SnapEngine";
import { vec2 } from "@/core/geometry/Vec2";
import { bbox } from "@/core/geometry/BBox";

describe("snapScalar", () => {
  it("rounds to the nearest grid multiple", () => {
    expect(snapScalar(13, 20)).toBe(20);
    expect(snapScalar(9, 20)).toBe(0);
    expect(snapScalar(-9, 20)).toBe(-0);
    expect(snapScalar(41, 20)).toBe(40);
  });

  it("passes non-positive spacing through unchanged (defensive)", () => {
    expect(snapScalar(13, 0)).toBe(13);
    expect(snapScalar(13, -5)).toBe(13);
  });
});

describe("snapPointToGrid", () => {
  it("snaps both axes to the nearest crossing", () => {
    expect(snapPointToGrid(vec2(13, 31), 20)).toEqual(vec2(20, 40));
  });
});

describe("snapPointIfEnabled", () => {
  it("passes through while disabled or unconfigured", () => {
    expect(snapPointIfEnabled(vec2(13, 31), undefined)).toEqual(vec2(13, 31));
    expect(
      snapPointIfEnabled(vec2(13, 31), { enabled: false, spacing: 20 }),
    ).toEqual(vec2(13, 31));
  });

  it("snaps while enabled", () => {
    expect(
      snapPointIfEnabled(vec2(13, 31), { enabled: true, spacing: 20 }),
    ).toEqual(vec2(20, 40));
  });
});

describe("gridSnapCandidates", () => {
  it("returns the four surrounding crossings ranked by distance", () => {
    const candidates = gridSnapCandidates(vec2(12, 12), 20);
    expect(candidates).toHaveLength(4);
    const positions = candidates.map((candidate) => candidate.position);
    expect(positions).toContainEqual(vec2(0, 0));
    expect(positions).toContainEqual(vec2(20, 0));
    expect(positions).toContainEqual(vec2(0, 20));
    expect(positions).toContainEqual(vec2(20, 20));
    // Ranked: (20, 20) is nearest to (12, 12).
    expect(candidates[0]?.position).toEqual(vec2(20, 20));
    expect(candidates.every((candidate) => candidate.kind === "grid")).toBe(
      true,
    );
  });

  it("is empty for non-positive spacing", () => {
    expect(gridSnapCandidates(vec2(12, 12), 0)).toEqual([]);
  });
});

describe("snapBoxDisplacement", () => {
  it("aligns an edge exactly on the grid (AC5.5)", () => {
    // Box (5,5)-(45,45), raw displacement (12, 12): minX lands on 17→20
    // (+3), center 37→40 (+3), maxX 57→60 (+3) — every proposal is +3,
    // so the far edge 45+12+3 = 60 lands EXACTLY on the grid.
    const adjust = snapBoxDisplacement(bbox(5, 5, 45, 45), vec2(12, 12), 20);
    expect(adjust.x).toBe(3);
    expect(adjust.y).toBe(3);
  });

  it("picks the proposal closest to the raw placement per axis", () => {
    // Box (0,0)-(10,10), raw displacement (7, 7): minX 7→0 (−7), center
    // 12→20 (+8), maxX 17→20 (+3) → +3 wins.
    const adjust = snapBoxDisplacement(bbox(0, 0, 10, 10), vec2(7, 7), 20);
    expect(adjust.x).toBe(3);
    expect(adjust.y).toBe(3);
    // 17 + 3 = 20: the far edge lands exactly on grid.
  });

  it("is zero for non-positive spacing", () => {
    expect(snapBoxDisplacement(bbox(0, 0, 10, 10), vec2(7, 7), 0)).toEqual(
      vec2(0, 0),
    );
  });
});

describe("snapResizeRect", () => {
  it("snaps only the dragged edges (e handle snaps maxX, minX pinned)", () => {
    const snapped = snapResizeRect(bbox(0, 0, 100, 50), "e", 2, 20);
    expect(snapped.minX).toBe(0);
    expect(snapped.maxX).toBe(100); // already on grid
    expect(snapped.minY).toBe(0);
    expect(snapped.maxY).toBe(50);
  });

  it("e handle moves maxX onto the nearest grid line", () => {
    const snapped = snapResizeRect(bbox(0, 0, 93, 50), "e", 2, 20);
    expect(snapped.maxX).toBe(100);
    expect(snapped.minX).toBe(0);
  });

  it("w handle snaps minX and never collapses below minSize", () => {
    const snapped = snapResizeRect(bbox(0, 0, 93, 50), "w", 2, 20);
    // minX raw 0 → snaps to 0; maxX 93 → the clamp keeps 93 ≥ minX+2.
    expect(snapped.maxX).toBe(93);
    expect(snapped.maxX - snapped.minX).toBeGreaterThanOrEqual(2);
  });

  it("corner handles snap both dragged edges (se)", () => {
    const snapped = snapResizeRect(bbox(0, 0, 93, 47), "se", 2, 20);
    expect(snapped.maxX).toBe(100);
    expect(snapped.maxY).toBe(40); // 47 → 40 is the nearest multiple of 20
  });

  it("a snap that would collapse the box re-clamps to minSize", () => {
    // e handle, box (0,0)-(2,10), minSize 2: maxX 2 snaps to 0 → the clamp
    // restores maxX = minX + minSize = 2.
    const snapped = snapResizeRect(bbox(0, 0, 2, 10), "e", 2, 20);
    expect(snapped.maxX).toBe(2);
  });
});

describe("snapRectOrigin", () => {
  it("translates the rect so its top-left lands on the grid, size kept", () => {
    const snapped = snapRectOrigin(bbox(13, 27, 113, 127), 20);
    expect(snapped.minX).toBe(20);
    expect(snapped.minY).toBe(20);
    expect(snapped.maxX - snapped.minX).toBe(100);
    expect(snapped.maxY - snapped.minY).toBe(100);
  });
});

describe("SnapEngine", () => {
  it("defaults to the R5.5 spacing and disabled", () => {
    const engine = new SnapEngine();
    expect(engine.configuration.enabled).toBe(false);
    expect(engine.configuration.spacing).toBe(DEFAULT_SNAP_SPACING);
    expect(DEFAULT_SNAP_SPACING).toBe(20);
    expect(SNAP_DISABLED.enabled).toBe(false);
    expect(engine.computeSnapCandidates(vec2(12, 12))).toEqual([]);
  });

  it("produces ranked candidates while enabled", () => {
    const engine = new SnapEngine({ enabled: true, spacing: 20 });
    const candidates = engine.computeSnapCandidates(vec2(12, 12));
    expect(candidates).toHaveLength(4);
    expect(candidates[0]?.position).toEqual(vec2(20, 20));
  });

  it("re-configures at runtime (the UI store toggles)", () => {
    const engine = new SnapEngine();
    engine.configure({ enabled: true, spacing: 40 });
    const candidates = engine.computeSnapCandidates(vec2(12, 12));
    expect(candidates[0]?.position).toEqual(vec2(0, 0));
    engine.configure({ enabled: false, spacing: 40 });
    expect(engine.computeSnapCandidates(vec2(12, 12))).toEqual([]);
  });
});
