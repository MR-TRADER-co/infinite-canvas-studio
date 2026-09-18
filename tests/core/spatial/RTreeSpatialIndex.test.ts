/**
 * R-tree spatial index tests (R7.10): result equivalence against the
 * linear implementation across randomized workloads (inserts, moves,
 * removals, queries) plus a perf smoke proving the broad phase beats the
 * linear scan at the 500+ object scale (AC7.10).
 */
import { describe, expect, it } from "vitest";
import { bbox, type BBox } from "@/core/geometry/BBox";
import { LinearSpatialIndex } from "@/core/spatial/LinearSpatialIndex";
import { RTreeSpatialIndex } from "@/core/spatial/RTreeSpatialIndex";
import type { SpatialItem } from "@/core/spatial/SpatialIndex";

/** Deterministic PRNG (mulberry32) so failures replay exactly. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a small random box.
 *
 * @param random - the PRNG.
 * @returns the box.
 */
function randomBox(random: () => number): BBox {
  const x = random() * 1000;
  const y = random() * 1000;
  const w = 10 + random() * 60;
  const h = 10 + random() * 60;
  return bbox(x, y, x + w, y + h);
}

/**
 * Runs the same id set through both implementations as sorted id lists.
 *
 * @param items - the raw hit list.
 * @returns the sorted ids.
 */
function idsOf(items: readonly SpatialItem[]): string[] {
  return items.map((item) => item.id).sort();
}

describe("RTreeSpatialIndex", () => {
  it("returns the same results as the linear index across a randomized workload", () => {
    const random = makeRandom(1337);
    const rtree = new RTreeSpatialIndex();
    const linear = new LinearSpatialIndex();
    const live = new Map<string, BBox>();
    for (let step = 0; step < 400; step += 1) {
      const roll = random();
      if (roll < 0.55 || live.size < 5) {
        // Insert (or move) one item.
        const id = `obj-${step}`;
        const box = randomBox(random);
        const item = { id, bounds: box };
        rtree.insert(item);
        linear.insert(item);
        live.set(id, box);
      } else if (roll < 0.75) {
        // Remove a random live id.
        const keys = [...live.keys()];
        const victim = keys[Math.floor(random() * keys.length)] as string;
        rtree.remove(victim);
        linear.remove(victim);
        live.delete(victim);
      }
      if (step % 7 === 0) {
        // Query both and compare.
        const query = randomBox(random);
        expect(idsOf(rtree.query(query))).toEqual(idsOf(linear.query(query)));
      }
    }
    // Final full-coverage sweep.
    const all = bbox(0, 0, 1200, 1200);
    expect(rtree.query(all).length).toBe(live.size);
    expect(idsOf(rtree.query(all))).toEqual(idsOf(linear.query(all)));
  });

  it("refreshes an existing id on reinsert (move semantics)", () => {
    const index = new RTreeSpatialIndex();
    index.insert({ id: "a", bounds: bbox(0, 0, 10, 10) });
    index.insert({ id: "a", bounds: bbox(500, 500, 510, 510) });
    expect(index.size).toBe(1);
    expect(index.query(bbox(0, 0, 20, 20))).toHaveLength(0);
    expect(index.query(bbox(490, 490, 520, 520))).toHaveLength(1);
  });

  it("removes cleanly and keeps remaining queries exact", () => {
    const index = new RTreeSpatialIndex();
    for (let i = 0; i < 40; i += 1) {
      index.insert({
        id: `obj-${i}`,
        bounds: bbox(i * 5, i * 5, i * 5 + 4, i * 5 + 4),
      });
    }
    for (let i = 0; i < 40; i += 3) {
      index.remove(`obj-${i}`);
    }
    const hits = index.query(bbox(-100, -100, 1000, 1000));
    expect(hits).toHaveLength(40 - 14);
    expect(index.remove("obj-0")).toBe(false);
  });

  it("clears every item", () => {
    const index = new RTreeSpatialIndex();
    for (let i = 0; i < 30; i += 1) {
      index.insert({
        id: `obj-${i}`,
        bounds: bbox(i, i, i + 1, i + 1),
      });
    }
    index.clear();
    expect(index.size).toBe(0);
    expect(index.query(bbox(0, 0, 100, 100))).toHaveLength(0);
  });

  it("answers point queries with many splits without losing items (fuzz)", () => {
    const random = makeRandom(42);
    const index = new RTreeSpatialIndex();
    const items: SpatialItem[] = [];
    for (let i = 0; i < 500; i += 1) {
      const item = { id: `obj-${i}`, bounds: randomBox(random) };
      items.push(item);
      index.insert(item);
    }
    // Random removal burst, then verify every survivor still answers its
    // own point query.
    const survivors: SpatialItem[] = [];
    for (const item of items) {
      if (random() < 0.7) {
        survivors.push(item);
      } else {
        index.remove(item.id);
      }
    }
    expect(index.size).toBe(survivors.length);
    for (const item of survivors) {
      const centre = {
        x: (item.bounds.minX + item.bounds.maxX) / 2,
        y: (item.bounds.minY + item.bounds.maxY) / 2,
      };
      const hits = index.query(
        bbox(
          centre.x - 0.01,
          centre.y - 0.01,
          centre.x + 0.01,
          centre.y + 0.01,
        ),
      );
      expect(idsOf(hits)).toContain(item.id);
    }
  });

  it("broad phase beats the linear scan at 600+ objects (perf smoke)", () => {
    const random = makeRandom(7);
    const count = 600;
    const items: SpatialItem[] = [];
    for (let i = 0; i < count; i += 1) {
      items.push({ id: `obj-${i}`, bounds: randomBox(random) });
    }
    const rtree = new RTreeSpatialIndex();
    const linear = new LinearSpatialIndex();
    for (const item of items) {
      rtree.insert(item);
      linear.insert(item);
    }
    // Small queries are the hit-test shape: mostly-empty rectangles.
    const queries: BBox[] = [];
    for (let i = 0; i < 300; i += 1) {
      const x = random() * 1000;
      const y = random() * 1000;
      queries.push(bbox(x, y, x + 24, y + 24));
    }
    const time = (run: () => void): number => {
      const start = performance.now();
      run();
      return performance.now() - start;
    };
    let rtreeHits = 0;
    let linearHits = 0;
    const rtreeMs = time(() => {
      for (const query of queries) {
        rtreeHits += rtree.query(query).length;
      }
    });
    const linearMs = time(() => {
      for (const query of queries) {
        linearHits += linear.query(query).length;
      }
    });
    // Same results …
    expect(rtreeHits).toBe(linearHits);
    // … and the R-tree wins the broad phase (allow generous CI noise, but
    // assert the direction).
    expect(rtreeMs).toBeLessThan(linearMs);
  });
});
