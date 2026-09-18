/**
 * Unit tests for the spatial index contract (R2.2): the LinearSpatialIndex
 * must satisfy the interface an R-tree will later swap into.
 */
import { describe, expect, it } from "vitest";
import { LinearSpatialIndex } from "@/core/spatial/LinearSpatialIndex";
import type { SpatialIndex, SpatialItem } from "@/core/spatial/SpatialIndex";
import { bbox } from "@/core/geometry/BBox";

/** Builds an item fixture. */
function item(
  id: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): SpatialItem {
  return { id, bounds: bbox(minX, minY, maxX, maxY) };
}

/** Runs the shared contract suite against one index factory. */
function testContract(makeIndex: () => SpatialIndex): void {
  it("inserts and queries by rectangle intersection", () => {
    const index = makeIndex();
    index.insert(item("a", 0, 0, 10, 10));
    index.insert(item("b", 100, 100, 110, 110));
    index.insert(item("c", 50, 50, 60, 60));
    expect(index.query(bbox(0, 0, 10, 10)).map((hit) => hit.id)).toEqual(["a"]);
    expect(index.query(bbox(5, 5, 55, 55)).map((hit) => hit.id)).toEqual([
      "a",
      "c",
    ]);
    expect(
      index.query(bbox(-100, -100, 1000, 1000)).map((hit) => hit.id),
    ).toEqual(["a", "b", "c"]);
    expect(index.query(bbox(11, 11, 49, 49))).toEqual([]);
  });

  it("edge-touching queries count as intersections", () => {
    const index = makeIndex();
    index.insert(item("a", 0, 0, 10, 10));
    expect(index.query(bbox(10, 0, 20, 10)).map((hit) => hit.id)).toEqual([
      "a",
    ]);
  });

  it("re-inserts refresh the bounds under the same id", () => {
    const index = makeIndex();
    index.insert(item("a", 0, 0, 10, 10));
    index.insert(item("a", 100, 100, 110, 110));
    expect(index.query(bbox(0, 0, 20, 20))).toEqual([]);
    expect(index.query(bbox(100, 100, 110, 110)).map((hit) => hit.id)).toEqual([
      "a",
    ]);
  });

  it("removes items", () => {
    const index = makeIndex();
    index.insert(item("a", 0, 0, 10, 10));
    index.remove("a");
    expect(index.query(bbox(0, 0, 10, 10))).toEqual([]);
    // Removing an absent id is a safe no-op.
    expect(() => index.remove("missing")).not.toThrow();
  });

  it("clears everything", () => {
    const index = makeIndex();
    index.insert(item("a", 0, 0, 10, 10));
    index.insert(item("b", 20, 20, 30, 30));
    index.clear();
    expect(index.query(bbox(-100, -100, 1000, 1000))).toEqual([]);
  });

  it("degenerate point items match point queries", () => {
    const index = makeIndex();
    index.insert(item("p", 5, 5, 5, 5));
    expect(index.query(bbox(5, 5, 5, 5)).map((hit) => hit.id)).toEqual(["p"]);
    expect(index.query(bbox(6, 5, 7, 5))).toEqual([]);
  });
}

describe("LinearSpatialIndex (SpatialIndex contract)", () => {
  testContract(() => new LinearSpatialIndex());

  it("queries 200 items under 16 ms (AC2.6 interaction budget)", () => {
    const index = new LinearSpatialIndex();
    for (let i = 0; i < 200; i += 1) {
      const x = (i % 20) * 100;
      const y = Math.floor(i / 20) * 100;
      index.insert(item(`item-${i}`, x, y, x + 80, y + 80));
    }
    const start = performance.now();
    for (let i = 0; i < 200; i += 1) {
      index.query(bbox(i, i, i + 300, i + 300));
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(16);
  });
});
