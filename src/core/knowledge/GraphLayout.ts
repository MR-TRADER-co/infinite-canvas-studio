/**
 * The knowledge-graph layout (R15.1): a PURE, deterministic layout of
 * the whole wiki-link graph for the «گراف دانش» panel.
 *
 * Nodes are the resolved TITLES (a title shared by several objects is
 * ONE node), plus dashed GHOST nodes for broken (unresolved) link
 * targets. Edges are the directed wiki links (broken edges dashed).
 *
 * The layout is radial and deterministic — the highest-degree node sits
 * at the centre, the remaining titles on one ring ordered by degree
 * (ties broken by key), ghosts on an outer ring — so the graph never
 * jumps between rebuilds (no physics, no animation, no dependencies).
 */
import type { KnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";

/** One laid-out graph node. */
export interface GraphNode {
  /** The title key (real) or broken-link key (ghost). */
  readonly key: string;
  /** The display title. */
  readonly display: string;
  /** Centre x in panel pixels. */
  readonly x: number;
  /** Centre y in panel pixels. */
  readonly y: number;
  /** Node radius in panel pixels (6–14, by degree). */
  readonly r: number;
  /** Incident edge count (outgoing + backlinks of all its objects). */
  readonly degree: number;
  /** Whether this is a dashed ghost (a missing target). */
  readonly ghost: boolean;
  /** The objects owning the title (empty for ghosts — fly-to targets). */
  readonly objectIds: readonly string[];
}

/** One laid-out directed edge. */
export interface GraphEdge {
  /** The source node key. */
  readonly fromKey: string;
  /** The target node key. */
  readonly toKey: string;
  /** Whether the link is unresolved (dashed red). */
  readonly broken: boolean;
}

/** The complete laid-out graph. */
export interface KnowledgeGraphLayout {
  /** All nodes (reals first, then ghosts). */
  readonly nodes: readonly GraphNode[];
  /** All edges (deduped). */
  readonly edges: readonly GraphEdge[];
  /** Whether the graph has anything to draw. */
  readonly empty: boolean;
}

/** Edge dedupe key. */
function edgeKey(from: string, to: string, broken: boolean): string {
  return `${from}\u0000${to}\u0000${broken ? "1" : "0"}`;
}

/** Node radius for a degree (clamped 6–14 px). */
function radiusForDegree(degree: number): number {
  return Math.min(14, 6 + Math.max(0, degree - 1) * 1.5);
}

/**
 * Lays out the knowledge graph of one index snapshot.
 *
 * @param index - the knowledge snapshot.
 * @param width - the panel canvas width in CSS pixels.
 * @param height - the panel canvas height in CSS pixels.
 * @param padding - the outer inset (default 26).
 * @returns the deterministic layout (empty when no titles/links exist).
 */
export function layoutKnowledgeGraph(
  index: KnowledgeIndex,
  width: number,
  height: number,
  padding = 26,
): KnowledgeGraphLayout {
  // --- collect the real nodes (titles) with their degrees ------------
  interface Draft {
    key: string;
    display: string;
    degree: number;
    objectIds: string[];
  }
  const drafts = new Map<string, Draft>();
  for (const [key, title] of index.titles) {
    drafts.set(key, {
      key,
      display: title.display,
      degree: 0,
      objectIds: [...title.objectIds],
    });
  }

  // --- collect the edges (and count degrees) --------------------------
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  const ghostKeys = new Set<string>();
  const bump = (key: string): void => {
    const draft = drafts.get(key);
    if (draft !== undefined) {
      draft.degree += 1;
    }
  };
  const sourceIds = [...index.outgoing.keys()].sort();
  for (const sourceId of sourceIds) {
    const sourceKey = index.objectTitle.get(sourceId)?.key ?? null;
    if (sourceKey === null) {
      continue;
    }
    const links = index.outgoing.get(sourceId) ?? [];
    for (const link of links) {
      if (link.resolvedIds.length > 0) {
        for (const resolvedId of link.resolvedIds) {
          const toKey = index.objectTitle.get(resolvedId)?.key ?? null;
          if (toKey === null || toKey === sourceKey) {
            continue;
          }
          const key = edgeKey(sourceKey, toKey, false);
          if (seenEdges.has(key)) {
            continue;
          }
          seenEdges.add(key);
          edges.push({ fromKey: sourceKey, toKey, broken: false });
          bump(sourceKey);
          bump(toKey);
        }
      } else {
        // A broken link: target is a ghost (even if a same-key title
        // somehow exists, resolvedIds would not be empty — so this key
        // is guaranteed absent from drafts).
        ghostKeys.add(link.key);
        const key = edgeKey(sourceKey, link.key, true);
        if (seenEdges.has(key)) {
          continue;
        }
        seenEdges.add(key);
        edges.push({ fromKey: sourceKey, toKey: link.key, broken: true });
        bump(sourceKey);
      }
    }
  }
  for (const brokenKey of [...index.brokenTitles.keys()].sort()) {
    ghostKeys.add(brokenKey);
  }

  const reals = [...drafts.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  if (reals.length === 0 && ghostKeys.size === 0) {
    return { nodes: [], edges: [], empty: true };
  }

  // --- radial placement (deterministic) --------------------------------
  const cx = width / 2;
  const cy = height / 2;
  const nodes: GraphNode[] = [];

  if (reals.length === 0) {
    // Only ghosts (a scene of nothing but broken links): one ring.
    const radius = Math.max(8, Math.min(width, height) / 2 - padding);
    const ghosts = [...ghostKeys].sort();
    ghosts.forEach((key, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / ghosts.length;
      nodes.push({
        key,
        display: index.brokenTitles.get(key)?.[0]?.display ?? key,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        r: 6,
        degree: 0,
        ghost: true,
        objectIds: [],
      });
    });
    return { nodes, edges, empty: false };
  }

  // Rank: highest degree first (ties → key order — the sort above is
  // stable and by key, so the comparison below keeps it deterministic).
  const ranked = [...reals].sort((a, b) => b.degree - a.degree);
  const ringCount = ranked.length - 1;
  const maxR = Math.min(width, height) / 2 - padding;
  const ringRadius = Math.max(0, maxR - 10);

  // The top node takes the centre.
  const centre = ranked[0];
  if (centre !== undefined) {
    nodes.push({
      key: centre.key,
      display: centre.display,
      x: cx,
      y: cy,
      r: radiusForDegree(centre.degree),
      degree: centre.degree,
      ghost: false,
      objectIds: centre.objectIds,
    });
  }

  // The rest on one ring, ordered by degree (dense side by side).
  ranked.slice(1).forEach((draft, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / ringCount;
    nodes.push({
      key: draft.key,
      display: draft.display,
      x: cx + ringRadius * Math.cos(angle),
      y: cy + ringRadius * Math.sin(angle),
      r: radiusForDegree(draft.degree),
      degree: draft.degree,
      ghost: false,
      objectIds: draft.objectIds,
    });
  });

  // Ghosts on an outer ring (dashed, smaller).
  const ghosts = [...ghostKeys].sort();
  const ghostRadius = Math.min(
    Math.min(width, height) / 2 - padding / 2,
    ringRadius + 26,
  );
  ghosts.forEach((key, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / ghosts.length;
    nodes.push({
      key,
      display: index.brokenTitles.get(key)?.[0]?.display ?? key,
      x: cx + ghostRadius * Math.cos(angle),
      y: cy + ghostRadius * Math.sin(angle),
      r: 5,
      degree: 0,
      ghost: true,
      objectIds: [],
    });
  });

  return { nodes, edges, empty: false };
}
