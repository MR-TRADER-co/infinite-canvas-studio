/**
 * R-tree spatial index (R7.10): a Guttman-style R-tree with quadratic node
 * splits behind the {@link SpatialIndex} interface.
 *
 * Structure: leaf nodes hold {@link SpatialItem}s; branch nodes hold child
 * nodes; every node stores the union bounds of its children. Queries
 * descend only into subtrees whose bounds intersect the query rectangle
 * (log-ish broad phase instead of the linear scan's O(n)).
 *
 * Design notes:
 * - MAX_ENTRIES = 8 (classic fan-out), min-fill after splits = 40%.
 * - `insert` refreshes an existing id (remove + reinsert).
 * - Insertion descends to the leaf of least enlargement, splits overflow
 *   nodes with the quadratic split and propagates the promoted groups up
 *   (a root split grows the tree one level).
 * - `remove` finds the owning leaf, deletes the entry and CONDENSES the
 *   tree: under-full branch nodes are dissolved and their items
 *   reinserted — repeated add/remove cycles never degrade the tree.
 * - Pure data structure — no scene/UI dependencies (node-testable).
 */
import type { BBox } from "@/core/geometry/BBox";
import type { SpatialIndex, SpatialItem } from "@/core/spatial/SpatialIndex";

/** Maximum entries per node before a split. */
const MAX_ENTRIES = 8;

/** Minimum entries a node keeps after a split (40% of MAX_ENTRIES). */
const MIN_ENTRIES = Math.ceil(MAX_ENTRIES * 0.4);

/** One child slot of a node: either a leaf item or a subtree. */
interface Entry {
  /** Union bounds of the item or subtree. */
  bounds: BBox;
  /** The leaf item (leaves only). */
  item: SpatialItem | null;
  /** The child subtree (branches only). */
  node: RTreeNode | null;
}

/** A tree node: branch (child subtrees) or leaf (items). */
interface RTreeNode {
  /** Whether this node holds items directly (leaf) or subtrees (branch). */
  leaf: boolean;
  /** Child entries (items in leaves, subtrees in branches). */
  entries: Entry[];
  /** Union bounds of every entry (maintained on mutation). */
  bounds: BBox;
}

/**
 * Creates an empty node.
 *
 * @param leaf - whether the node holds items directly.
 * @returns the fresh node.
 */
function makeNode(leaf: boolean): RTreeNode {
  return { leaf, entries: [], bounds: emptyBounds() };
}

/**
 * Wraps an entry group as a same-kind sibling node.
 *
 * @param leaf - whether the group holds items.
 * @param entries - the group's entries.
 * @returns the node covering exactly the group.
 */
function makeSibling(leaf: boolean, entries: Entry[]): RTreeNode {
  return { leaf, entries, bounds: coverOf(entries) };
}

/**
 * @returns a degenerate inverted box (the neutral element of `union`).
 */
function emptyBounds(): BBox {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

/**
 * @param a - one box.
 * @param b - the other box.
 * @returns the minimal box covering both.
 */
function unionBounds(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * @param bounds - the box to measure.
 * @returns the box's area (0 for degenerate boxes).
 */
function area(bounds: BBox): number {
  return (
    Math.max(0, bounds.maxX - bounds.minX) *
    Math.max(0, bounds.maxY - bounds.minY)
  );
}

/**
 * @param bounds - the box to enlarge.
 * @param extra - the box being added.
 * @returns how much `bounds`' area grows to cover `extra`.
 */
function enlargement(bounds: BBox, extra: BBox): number {
  return area(unionBounds(bounds, extra)) - area(bounds);
}

/**
 * @param a - one box.
 * @param b - the other box.
 * @returns whether the boxes intersect (touching counts).
 */
function intersects(a: BBox, b: BBox): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
  );
}

/**
 * Guttman quadratic split: pick the two entries that waste the most space
 * when paired (max sum of the union area minus own areas), then greedily
 * distribute the rest to the side whose cover grows least. Deterministic
 * tie-breaks by entry order keep repeated splits stable.
 *
 * @param entries - the overflowing node's entries.
 * @returns the two partitioned entry groups (both ≥ MIN_ENTRIES).
 */
function quadraticSplit(entries: readonly Entry[]): [Entry[], Entry[]] {
  let seedA = 0;
  let seedB = 1;
  let worst = -1;
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const first = entries[i] as Entry;
      const second = entries[j] as Entry;
      const waste =
        area(unionBounds(first.bounds, second.bounds)) -
        area(first.bounds) -
        area(second.bounds);
      if (waste > worst) {
        worst = waste;
        seedA = i;
        seedB = j;
      }
    }
  }
  const seedEntryA = entries[seedA] as Entry;
  const seedEntryB = entries[seedB] as Entry;
  const groupA: Entry[] = [seedEntryA];
  const groupB: Entry[] = [seedEntryB];
  let coverA = { ...seedEntryA.bounds };
  let coverB = { ...seedEntryB.bounds };
  const rest = entries.filter((_, index) => index !== seedA && index !== seedB);
  // Quota: once one side holds every remaining entry it MUST take them all
  // (the other side still needs MIN_ENTRIES slots it already has).
  const quota = MAX_ENTRIES - MIN_ENTRIES + 1;
  for (const entry of rest) {
    if (groupA.length >= quota) {
      groupB.push(entry);
      coverB = unionBounds(coverB, entry.bounds);
      continue;
    }
    if (groupB.length >= quota) {
      groupA.push(entry);
      coverA = unionBounds(coverA, entry.bounds);
      continue;
    }
    const growA = enlargement(coverA, entry.bounds);
    const growB = enlargement(coverB, entry.bounds);
    if (growA < growB || (growA === growB && groupA.length <= groupB.length)) {
      groupA.push(entry);
      coverA = unionBounds(coverA, entry.bounds);
    } else {
      groupB.push(entry);
      coverB = unionBounds(coverB, entry.bounds);
    }
  }
  return [groupA, groupB];
}

/**
 * R-tree implementation of the {@link SpatialIndex} contract.
 */
export class RTreeSpatialIndex implements SpatialIndex {
  /** The root node (a leaf while the tree is small). */
  private root: RTreeNode = makeNode(true);

  /** Number of indexed items. */
  private count = 0;

  /**
   * Inserts (or refreshes) an item: an existing entry with the same id is
   * replaced at its new bounds.
   *
   * @param item - the item to index.
   */
  public insert(item: SpatialItem): void {
    // A refresh removes first (count -1) and reinserts (+1): the net count
    // always equals the number of distinct indexed ids.
    this.remove(item.id);
    this.descendInsert(item);
    this.count += 1;
  }

  /**
   * Removes an item.
   *
   * @param id - id of the item to remove.
   * @returns whether an entry was removed.
   */
  public remove(id: string): boolean {
    const path = this.findLeaf(this.root, id);
    if (path === null) {
      return false;
    }
    const leaf = path[path.length - 1] as RTreeNode;
    leaf.entries = leaf.entries.filter(
      (entry) => entry.item === null || entry.item.id !== id,
    );
    this.count -= 1;
    this.condense(path);
    return true;
  }

  /**
   * Rectangle query: every indexed item whose bounds intersect `rect`.
   *
   * @param rect - query rectangle in world space.
   * @returns the intersecting items (insert order is not guaranteed).
   */
  public query(rect: BBox): readonly SpatialItem[] {
    const hits: SpatialItem[] = [];
    this.search(this.root, rect, hits);
    return hits;
  }

  /** Removes every item. */
  public clear(): void {
    this.root = makeNode(true);
    this.count = 0;
  }

  /** @returns the number of indexed items. */
  public get size(): number {
    return this.count;
  }

  /**
   * Descends from the root to the best leaf and inserts the item,
   * propagating splits upward (a root split grows the tree).
   *
   * @param item - the item to place.
   */
  private descendInsert(item: SpatialItem): void {
    const entry: Entry = { bounds: item.bounds, item, node: null };
    // Choose the leaf of least enlargement, remembering the path.
    const path: RTreeNode[] = [this.root];
    let node = this.root;
    while (!node.leaf) {
      let bestIndex = -1;
      let bestGrow = Number.POSITIVE_INFINITY;
      let bestArea = Number.POSITIVE_INFINITY;
      for (let i = 0; i < node.entries.length; i += 1) {
        const child = node.entries[i];
        if (child === undefined || child.node === null) {
          continue;
        }
        const grow = enlargement(child.bounds, entry.bounds);
        const own = area(child.bounds);
        if (grow < bestGrow || (grow === bestGrow && own < bestArea)) {
          bestGrow = grow;
          bestArea = own;
          bestIndex = i;
        }
      }
      const chosen =
        bestIndex >= 0 ? (node.entries[bestIndex]?.node ?? null) : null;
      if (chosen === null) {
        // Defensive: a branch without children treats itself as a leaf.
        node.leaf = true;
        break;
      }
      node = chosen;
      path.push(node);
    }
    node.entries.push(entry);

    // Propagate splits bottom-up: a split promotes its second group into
    // the parent; an overflowing parent splits in turn. Every level's
    // bounds are recomputed AND mirrored into the parent's entry for that
    // node (the entry bounds are snapshots, so a stale entry would make
    // the search skip freshly-grown subtrees).
    let promoted: RTreeNode | null = null;
    for (let i = path.length - 1; i >= 0; i -= 1) {
      const current = path[i] as RTreeNode;
      if (promoted !== null) {
        current.entries.push({
          bounds: promoted.bounds,
          item: null,
          node: promoted,
        });
        promoted = null;
      }
      if (current.entries.length > MAX_ENTRIES) {
        const [groupA, groupB] = quadraticSplit(current.entries);
        current.entries = groupA;
        promoted = makeSibling(current.leaf, groupB);
      }
      recomputeBounds(current);
      const parent = i > 0 ? path[i - 1] : undefined;
      if (parent !== undefined) {
        const entry = parent.entries.find(
          (candidate) => candidate.node === current,
        );
        if (entry !== undefined) {
          entry.bounds = current.bounds;
        }
      }
    }
    if (promoted !== null) {
      // The root split: grow the tree one level.
      const branch = promoted;
      const oldRoot = this.root;
      const newRoot = makeNode(false);
      newRoot.entries = [
        { bounds: oldRoot.bounds, item: null, node: oldRoot },
        { bounds: branch.bounds, item: null, node: branch },
      ];
      newRoot.bounds = unionBounds(oldRoot.bounds, branch.bounds);
      this.root = newRoot;
    }
  }

  /**
   * Finds the leaf holding `id`.
   *
   * @param node - the subtree to search.
   * @param id - the item id.
   * @returns the root→leaf path, or null when the id is not indexed.
   */
  private findLeaf(node: RTreeNode, id: string): RTreeNode[] | null {
    if (node.leaf) {
      const has = node.entries.some(
        (entry) => entry.item !== null && entry.item.id === id,
      );
      return has ? [node] : null;
    }
    for (const entry of node.entries) {
      if (entry.node === null) {
        continue;
      }
      const found = this.findLeaf(entry.node, id);
      if (found !== null) {
        return [node, ...found];
      }
    }
    return null;
  }

  /**
   * Condenses the tree after a deletion: under-full branch nodes are
   * dissolved (their items reinserted through the descent), bounds are
   * recomputed up the path, and a single-child root collapses. Under-full
   * LEAVES are kept (the RBush simplification — correct, only mildly less
   * packed) so deletes stay cheap.
   *
   * @param path - the root→leaf path of the deleted leaf.
   */
  private condense(path: readonly RTreeNode[]): void {
    const orphans: SpatialItem[] = [];
    for (let i = path.length - 1; i > 0; i -= 1) {
      const child = path[i] as RTreeNode;
      const parent = path[i - 1] as RTreeNode;
      if (!child.leaf && child.entries.length < MIN_ENTRIES) {
        collectItems(child, orphans);
        parent.entries = parent.entries.filter((entry) => entry.node !== child);
      } else {
        recomputeBounds(child);
      }
      // Mirror the fresh bounds into the parent's entry for this child.
      const entry = parent.entries.find(
        (candidate) => candidate.node === child,
      );
      if (entry !== undefined) {
        entry.bounds = child.bounds;
      }
    }
    recomputeBounds(this.root);
    if (!this.root.leaf && this.root.entries.length === 1) {
      const only = this.root.entries[0]?.node ?? null;
      if (only !== null) {
        this.root = only;
      }
    }
    for (const orphan of orphans) {
      this.descendInsert(orphan);
    }
  }

  /**
   * Recursive search collecting intersecting items.
   *
   * @param node - the subtree to search.
   * @param rect - the query rectangle.
   * @param hits - the output accumulator.
   */
  private search(node: RTreeNode, rect: BBox, hits: SpatialItem[]): void {
    if (!intersects(node.bounds, rect)) {
      return;
    }
    for (const entry of node.entries) {
      if (!intersects(entry.bounds, rect)) {
        continue;
      }
      if (entry.item !== null) {
        hits.push(entry.item);
        continue;
      }
      if (entry.node !== null) {
        this.search(entry.node, rect, hits);
      }
    }
  }
}

/**
 * Recomputes a node's bounds as the union of its entries.
 *
 * @param node - the node to refresh.
 */
function recomputeBounds(node: RTreeNode): void {
  node.bounds = coverOf(node.entries);
}

/**
 * Computes the cover of an entry group.
 *
 * @param entries - the entries to cover.
 * @returns the union bounds (inverted when empty).
 */
function coverOf(entries: readonly Entry[]): BBox {
  let bounds = emptyBounds();
  for (const entry of entries) {
    bounds = unionBounds(bounds, entry.bounds);
  }
  return bounds;
}

/**
 * Flattens a subtree's leaf items into the accumulator.
 *
 * @param node - the subtree to flatten.
 * @param out - the output accumulator.
 */
function collectItems(node: RTreeNode, out: SpatialItem[]): void {
  if (node.leaf) {
    for (const entry of node.entries) {
      if (entry.item !== null) {
        out.push(entry.item);
      }
    }
    return;
  }
  for (const entry of node.entries) {
    if (entry.node !== null) {
      collectItems(entry.node, out);
    }
  }
}
