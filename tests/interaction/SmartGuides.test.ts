/**
 * Smart-guide tests (R7.4/AC7.4): the pure snap engine — edge/centre
 * alignment with exact landing, thresholding, locked/invisible objects
 * never offering references, and equal-spacing snaps + hints.
 */
import { describe, expect, it } from "vitest";
import {
  collectReferenceBoxes,
  computeSmartSnap,
} from "@/interaction/SmartGuides";
import { bbox } from "@/core/geometry/BBox";

/** Reference box helper. */
function ref(
  id: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) {
  return { id, box: bbox(minX, minY, maxX, maxY) };
}

describe("computeSmartSnap (R7.4)", () => {
  it("snaps the moving box's edge exactly onto the reference's edge", () => {
    // Moving box left edge at 104; reference left edge at 100; threshold 6.
    const moved = bbox(104, 0, 204, 100);
    const references = [ref("neighbour", 100, 200, 300, 300)];
    const result = computeSmartSnap(moved, references, 6);
    expect(result.adjust.x).toBe(-4);
    expect(result.adjust.y).toBe(0);
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]?.axis).toBe("x");
    expect(result.guides[0]?.coordinate).toBe(100);
  });

  it("snaps centres (vertical line for the x axis)", () => {
    const moved = bbox(0, 0, 100, 50);
    // Moving centre x = 50 vs reference centre x = 52 → within threshold.
    const near = [ref("target", 2, 500, 102, 600)];
    const result = computeSmartSnap(moved, near, 6);
    expect(result.adjust.x).toBe(2);
    expect(result.guides.some((guide) => guide.axis === "x")).toBe(true);
  });

  it("does not snap beyond the threshold", () => {
    const moved = bbox(120, 0, 220, 100);
    const references = [ref("neighbour", 100, 200, 300, 300)];
    const result = computeSmartSnap(moved, references, 6);
    expect(result.adjust.x).toBe(0);
    expect(result.adjust.y).toBe(0);
    expect(result.guides).toHaveLength(0);
  });

  it("snaps both axes independently", () => {
    const moved = bbox(104, 104, 204, 154);
    const references = [ref("corner", 100, 100, 300, 200)];
    const result = computeSmartSnap(moved, references, 6);
    expect(result.adjust.x).toBe(-4);
    expect(result.adjust.y).toBe(-4);
    expect(result.guides).toHaveLength(2);
  });

  it("picks the closest candidate within the threshold", () => {
    const moved = bbox(104, 0, 204, 100);
    const references = [
      ref("near", 100, 200, 300, 300),
      ref("far", 110, 400, 500, 500),
    ];
    const result = computeSmartSnap(moved, references, 6);
    expect(result.adjust.x).toBe(-4);
    expect(result.guides[0]?.coordinate).toBe(100);
  });

  it("equalises the gaps when the box sits between two references", () => {
    // Left ref ends at 0, right ref starts at 210; the equalised gap is
    // 55 on both sides (box at 55..155). A box at 52..152 is within the
    // threshold → it snaps to the equalised position and hints the gap.
    const references = [
      ref("left", -100, 0, 0, 100),
      ref("right", 210, 0, 310, 100),
    ];
    const nearEqual = bbox(52, 0, 152, 50);
    const result = computeSmartSnap(nearEqual, references, 6);
    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]?.gap).toBeCloseTo(55, 6);
    // And the box landed exactly at the equalised position.
    expect(52 + result.adjust.x).toBeCloseTo(55, 6);
  });

  it("collectReferenceBoxes never offers locked/invisible/excluded objects (AC7.4)", () => {
    const objects = [
      { id: "ok", visible: true, locked: false },
      { id: "hidden", visible: false, locked: false },
      { id: "locked", visible: true, locked: true },
      { id: "dragged", visible: true, locked: false },
    ];
    const boxes = (id: string) =>
      id === "degenerate" ? bbox(0, 0, 0, 0) : bbox(0, 0, 100, 100);
    const references = collectReferenceBoxes(
      objects,
      boxes,
      new Set(["dragged"]),
    );
    expect(references.map((reference) => reference.id)).toEqual(["ok"]);
  });
});
