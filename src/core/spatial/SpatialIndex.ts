/**
 * Spatial index contract for rectangle queries over scene objects.
 *
 * Backends: brute force now (see `LinearSpatialIndex`), a quadtree later.
 *
 * PHASE 0 STUB — fully implemented in a later phase.
 */
import type { BBox } from "@/core/geometry/BBox";

/** Item stored in a spatial index: an id plus its world-space bounds. */
export interface SpatialItem {
  /** Id of the indexed object. */
  readonly id: string;
  /** World-space bounds of the object. */
  readonly bounds: BBox;
}

/** Rectangle-queryable index over spatial items. */
export interface SpatialIndex {
  /**
   * Inserts (or refreshes) an item.
   *
   * @param item - the item to index.
   */
  insert(item: SpatialItem): void;
  /**
   * Removes an item.
   *
   * @param id - id of the item to remove.
   */
  remove(id: string): void;
  /**
   * @param rect - query rectangle in world space.
   * @returns every indexed item whose bounds intersect `rect`.
   */
  query(rect: BBox): readonly SpatialItem[];
  /** Removes every item. */
  clear(): void;
}
