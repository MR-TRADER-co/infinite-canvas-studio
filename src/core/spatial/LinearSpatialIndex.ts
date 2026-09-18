/**
 * Brute-force spatial index: a map plus a linear scan per query.
 *
 * Correct but O(n) per query — replaced by a quadtree when profiling asks
 * for it (CLAUDE.md §1.5: simplest sensible decision first).
 *
 * PHASE 0 STUB — fully implemented in a later phase.
 */
import type { BBox } from "@/core/geometry/BBox";
import type { SpatialIndex, SpatialItem } from "@/core/spatial/SpatialIndex";

/** Map-backed `SpatialIndex` that scans every item on query. */
export class LinearSpatialIndex implements SpatialIndex {
  private readonly items = new Map<string, SpatialItem>();

  /**
   * Inserts (or refreshes) an item.
   *
   * @param item - the item to index.
   */
  public insert(item: SpatialItem): void {
    this.items.set(item.id, item);
  }

  /**
   * Removes an item.
   *
   * @param id - id of the item to remove.
   */
  public remove(id: string): void {
    this.items.delete(id);
  }

  /**
   * Brute-force rectangle query.
   *
   * @param rect - query rectangle in world space.
   * @returns every item whose bounds intersect `rect`.
   */
  public query(rect: BBox): readonly SpatialItem[] {
    const hits: SpatialItem[] = [];
    for (const item of this.items.values()) {
      const b = item.bounds;
      const intersects =
        b.minX <= rect.maxX &&
        b.maxX >= rect.minX &&
        b.minY <= rect.maxY &&
        b.maxY >= rect.minY;
      if (intersects) {
        hits.push(item);
      }
    }
    return hits;
  }

  /** Removes every item. */
  public clear(): void {
    this.items.clear();
  }
}
