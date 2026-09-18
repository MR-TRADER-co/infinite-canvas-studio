/**
 * The on-canvas knowledge-graph arrange planner (pack R12.3): a PURE,
 * DETERMINISTIC force-directed layout of the whole wiki-link graph in
 * WORLD space, producing one move plan (per-object world deltas) that
 * the composition root commits as a SINGLE composite undo step.
 *
 * The physics is a fixed-iteration Fruchterman–Reingold relaxation —
 * pairwise repulsion + spring attraction along the graph edges + a weak
 * pull toward the graph centroid — seeded from the objects' CURRENT
 * centres and cooled on a linear schedule. No randomness anywhere
 * (stable node order, hash-jittered tie-breaks only), so the same scene
 * always arranges to the same layout.
 *
 * Nodes are the resolved TITLES (a title shared by several objects is
 * ONE node — its members land in a tight grid cluster). Broken-link
 * targets participate as mass-full GHOST nodes so dangling sources feel
 * a pull toward where the ghost settles, but ghosts produce no moves.
 *
 * Exclusions (the plan never moves): locked objects, group members,
 * and objects fully inside an auto-layout frame (the frame's reflow
 * owns their position).
 */
import { objectBBox, type SceneObjectData } from "@/core/model/SceneObject";
import { isFrameObject, parseFrameLayout } from "@/core/model/FrameObject";
import type { KnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import type { BBox } from "@/core/geometry/BBox";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";

/** The centre of a bounding box. */
function boxCenter(box: BBox): Vec2 {
  return vec2((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
}

/** The width/height of a bounding box. */
function boxSize(box: BBox): { w: number; h: number } {
  return { w: box.maxX - box.minX, h: box.maxY - box.minY };
}

/** Tuning knobs (all optional — the defaults suit 3–120 nodes). */
export interface GraphArrangeOptions {
  /** The spring rest length in world units (default 460). */
  readonly idealEdgeLength?: number;
  /** Relaxation iterations (default 240). */
  readonly iterations?: number;
  /** Hard node cap — beyond it the lowest-degree titles stay put (default 260). */
  readonly maxNodes?: number;
  /** Gap inside multi-object title clusters (default 36). */
  readonly clusterGap?: number;
}

/** One object's planned translation. */
export interface GraphArrangeMove {
  /** The object id. */
  readonly id: string;
  /** The world-space delta to apply. */
  readonly delta: Vec2;
}

/** The complete arrange plan. */
export interface GraphArrangePlan {
  /** Per-object moves (≥1 unit; no-ops omitted). */
  readonly moves: readonly GraphArrangeMove[];
  /** How many title nodes participated in the physics. */
  readonly nodeCount: number;
  /** How many unique graph edges participated. */
  readonly edgeCount: number;
  /** Members skipped by the exclusion rules (locked/grouped/framed). */
  readonly skipped: number;
}

/** FNV-1a 32-bit hash of a string (deterministic jitter source). */
function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Maps a hash to [0, 1). */
function unitOf(hash: number): number {
  return (hash % 100000) / 100000;
}

/**
 * Whether the index has anything worth arranging: at least two real
 * (titled) nodes joined by at least one link — resolved OR broken.
 *
 * @param index - the knowledge snapshot.
 * @returns eligibility for the arrange command's enabled state.
 */
export function graphArrangeEligible(index: KnowledgeIndex): boolean {
  if (index.titles.size < 2) {
    return false;
  }
  for (const links of index.outgoing.values()) {
    if (links.length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Collects the ids of objects the plan must never move: locked, group
 * members, and objects fully inside an auto-layout frame.
 *
 * @param objects - the live scene objects.
 * @returns the excluded ids.
 */
function collectExcluded(objects: readonly SceneObjectData[]): Set<string> {
  const excluded = new Set<string>();
  const layoutFrames: BBox[] = [];
  for (const object of objects) {
    if (object.locked) {
      excluded.add(object.id);
    }
    if (
      typeof (object as { groupId?: unknown }).groupId === "string" &&
      (object as { groupId?: unknown }).groupId !== null
    ) {
      excluded.add(object.id);
    }
    if (isFrameObject(object) && parseFrameLayout(object.layout) !== null) {
      layoutFrames.push(objectBBox(object));
    }
  }
  if (layoutFrames.length > 0) {
    for (const object of objects) {
      if (excluded.has(object.id) || isFrameObject(object)) {
        continue;
      }
      const box = objectBBox(object);
      for (const frame of layoutFrames) {
        if (
          box.minX >= frame.minX &&
          box.minY >= frame.minY &&
          box.maxX <= frame.maxX &&
          box.maxY <= frame.maxY
        ) {
          excluded.add(object.id);
          break;
        }
      }
    }
  }
  return excluded;
}

/** One physics node (real or ghost). */
interface PhysicsNode {
  readonly key: string;
  readonly ghost: boolean;
  /** Live member object ids (empty for ghosts). */
  readonly members: readonly string[];
  /** Current position (mutated by the relaxation). */
  x: number;
  y: number;
  /** Displacement accumulator of one iteration. */
  dx: number;
  dy: number;
}

/** One physics edge (deduped). */
interface PhysicsEdge {
  readonly from: number;
  readonly to: number;
  readonly broken: boolean;
}

/**
 * Plans the force-directed arrangement of the knowledge graph.
 *
 * @param objects - the live scene objects (positions seed the physics).
 * @param index - the current knowledge snapshot.
 * @param options - tuning knobs.
 * @returns the plan, or null when nothing is arrangeable.
 */
export function planGraphArrange(
  objects: readonly SceneObjectData[],
  index: KnowledgeIndex,
  options: GraphArrangeOptions = {},
): GraphArrangePlan | null {
  if (!graphArrangeEligible(index)) {
    return null;
  }
  const ideal = options.idealEdgeLength ?? 460;
  const iterations = options.iterations ?? 240;
  const maxNodes = options.maxNodes ?? 260;
  const clusterGap = options.clusterGap ?? 36;

  const objectsById = new Map<string, SceneObjectData>(
    objects.map((object) => [object.id, object]),
  );
  const excluded = collectExcluded(objects);

  // ——— nodes: titles, ranked by degree then key, capped ————————————
  interface Draft {
    key: string;
    members: string[];
    degree: number;
  }
  const drafts: Draft[] = [];
  for (const [key, title] of index.titles) {
    const members = title.objectIds.filter(
      (id) => objectsById.get(id) !== undefined,
    );
    if (members.length === 0) {
      continue;
    }
    drafts.push({ key, members, degree: 0 });
  }
  if (drafts.length === 0) {
    return null;
  }

  // ——— edges (deduped, degree-counting) —————————————————————————
  const draftIndex = new Map(drafts.map((draft, i) => [draft.key, i]));
  const edgeSet = new Set<string>();
  const edges: PhysicsEdge[] = [];
  const ghostKeys: string[] = [];
  const ghostIndexOf = new Map<string, number>();
  const brokenPull = new Map<number, string[]>(); // draft index → ghost keys
  const bump = (i: number): void => {
    const draft = drafts[i];
    if (draft !== undefined) {
      draft.degree += 1;
    }
  };
  const ensureGhost = (key: string): number => {
    const existing = ghostIndexOf.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const id = drafts.length + ghostKeys.length;
    ghostIndexOf.set(key, id);
    ghostKeys.push(key);
    return id;
  };
  const sourceIds = [...index.outgoing.keys()].sort();
  for (const sourceId of sourceIds) {
    const sourceKey = index.objectTitle.get(sourceId)?.key ?? null;
    if (sourceKey === null) {
      continue;
    }
    const from = draftIndex.get(sourceKey);
    if (from === undefined) {
      continue;
    }
    for (const link of index.outgoing.get(sourceId) ?? []) {
      if (link.resolvedIds.length > 0) {
        for (const resolvedId of link.resolvedIds) {
          const toKey = index.objectTitle.get(resolvedId)?.key ?? null;
          if (toKey === null || toKey === sourceKey) {
            continue;
          }
          const to = draftIndex.get(toKey);
          if (to === undefined) {
            continue;
          }
          const key = `${Math.min(from, to)}\u0000${Math.max(from, to)}`;
          if (edgeSet.has(key)) {
            continue;
          }
          edgeSet.add(key);
          edges.push({ from, to, broken: false });
          bump(from);
          bump(to);
        }
      } else {
        const ghost = ensureGhost(link.key);
        const key = `${from}\u0000g${ghost}`;
        if (edgeSet.has(key)) {
          continue;
        }
        edgeSet.add(key);
        edges.push({ from, to: ghost, broken: true });
        bump(from);
        const pulls = brokenPull.get(from) ?? [];
        pulls.push(link.key);
        brokenPull.set(from, pulls);
      }
    }
  }

  // Node cap: keep the highest-degree titles (ties → key order).
  const ranked = [...drafts].sort((a, b) =>
    a.degree !== b.degree ? b.degree - a.degree : a.key < b.key ? -1 : 1,
  );
  const kept = new Set(
    ranked.slice(0, maxNodes).map((draft) => draft.key),
  );
  const keptDrafts = drafts.filter((draft) => kept.has(draft.key));
  const remap = new Map(
    keptDrafts.map((draft, i) => [draft.key, i] as const),
  );
  const physicsEdges = edges
    .filter((edge) => {
      if (!kept.has(drafts[edge.from]?.key ?? "")) {
        return false;
      }
      // Ghosts ride along with their source; resolved targets must be
      // kept nodes too.
      if (edge.to < drafts.length) {
        return kept.has(drafts[edge.to]?.key ?? "");
      }
      return true;
    })
    .map((edge) => ({
      from: remap.get(drafts[edge.from]?.key ?? "") ?? 0,
      to:
        edge.to < drafts.length
          ? (remap.get(drafts[edge.to]?.key ?? "") ?? 0)
          : keptDrafts.length + (edge.to - drafts.length),
      broken: edge.broken,
    }));

  // ——— seed positions ————————————————————————————————————————
  const centerOf = (id: string): Vec2 => {
    const object = objectsById.get(id);
    if (object === undefined) {
      return vec2(0, 0);
    }
    return boxCenter(objectBBox(object));
  };
  const nodes: PhysicsNode[] = keptDrafts.map((draft) => {
    let cx = 0;
    let cy = 0;
    for (const id of draft.members) {
      const centre = centerOf(id);
      cx += centre.x;
      cy += centre.y;
    }
    cx /= draft.members.length;
    cy /= draft.members.length;
    const jitter = unitOf(hash32(draft.key));
    return {
      key: draft.key,
      ghost: false,
      members: draft.members,
      x: cx + (jitter - 0.5) * 8,
      y: cy + (unitOf(hash32(`${draft.key}\u0000y`)) - 0.5) * 8,
      dx: 0,
      dy: 0,
    };
  });
  // Ghost seeds: near the centroid of their pulling sources.
  const ghostCount = ghostKeys.length;
  for (let g = 0; g < ghostCount; g += 1) {
    const ghostKey = ghostKeys[g] ?? "";
    let cx = 0;
    let cy = 0;
    let count = 0;
    for (const [draftIndex_, pulls] of brokenPull) {
      if (!pulls.includes(ghostKey)) {
        continue;
      }
      const draft = drafts[draftIndex_];
      if (draft === undefined) {
        continue;
      }
      for (const id of draft.members) {
        const centre = centerOf(id);
        cx += centre.x;
        cy += centre.y;
        count += 1;
      }
    }
    if (count === 0) {
      cx = 0;
      cy = 0;
      count = 1;
    }
    nodes.push({
      key: ghostKey,
      ghost: true,
      members: [],
      x: cx / count + ideal * (unitOf(hash32(ghostKey)) - 0.5),
      y: cy / count + ideal * (unitOf(hash32(`${ghostKey}\u0000y`)) - 0.5),
      dx: 0,
      dy: 0,
    });
  }

  // Degenerate seed guard: when everything piles into one point the
  // repulsion has no direction — fan the nodes onto a golden spiral.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }
  if (
    Math.max(maxX - minX, maxY - minY) < ideal * 0.5 &&
    nodes.length > 1
  ) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    nodes.forEach((node, i) => {
      const angle = i * 2.399963229728653; // golden angle
      const radius = ideal * 0.6 * Math.sqrt(i + 1);
      node.x = cx + radius * Math.cos(angle);
      node.y = cy + radius * Math.sin(angle);
    });
  }

  // ——— relaxation (deterministic FR with cooling) —————————————————
  const n = nodes.length;
  const k = ideal;
  const kSquared = k * k;
  let temperature = ideal * 1.1;
  const cooling = temperature / (iterations + 1);
  for (let step = 0; step < iterations; step += 1) {
    for (const node of nodes) {
      node.dx = 0;
      node.dy = 0;
    }
    // Pairwise repulsion.
    for (let i = 0; i < n; i += 1) {
      const a = nodes[i];
      if (a === undefined) {
        continue;
      }
      for (let j = i + 1; j < n; j += 1) {
        const b = nodes[j];
        if (b === undefined) {
          continue;
        }
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 4) {
          // Hash-tiebreak the exact pile-up so the push has a direction.
          dx = unitOf(hash32(`${a.key}|${b.key}`)) - 0.5;
          dy = unitOf(hash32(`${b.key}|${a.key}`)) - 0.5;
          dist = Math.hypot(dx, dy) || 1;
        }
        const force = kSquared / dist;
        const ux = dx / dist;
        const uy = dy / dist;
        a.dx -= ux * force;
        a.dy -= uy * force;
        b.dx += ux * force;
        b.dy += uy * force;
      }
    }
    // Spring attraction along the edges (weaker for broken links — the
    // ghosts settle farther out than the resolved cluster).
    for (const edge of physicsEdges) {
      const a = nodes[edge.from];
      const b = nodes[edge.to];
      if (a === undefined || b === undefined) {
        continue;
      }
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.hypot(dx, dy), 4);
      const force = (dist * dist) / (k * (edge.broken ? 2.2 : 1));
      const ux = dx / dist;
      const uy = dy / dist;
      a.dx += ux * force;
      a.dy += uy * force;
      b.dx -= ux * force;
      b.dy -= uy * force;
    }
    // Weak gravity toward the current centroid + cooling clamp.
    let cx = 0;
    let cy = 0;
    for (const node of nodes) {
      cx += node.x;
      cy += node.y;
    }
    cx /= n;
    cy /= n;
    for (const node of nodes) {
      node.dx += (cx - node.x) * 0.012;
      node.dy += (cy - node.y) * 0.012;
      const disp = Math.hypot(node.dx, node.dy);
      if (disp > temperature && disp > 0) {
        node.dx = (node.dx / disp) * temperature;
        node.dy = (node.dy / disp) * temperature;
      }
      node.x += node.dx;
      node.y += node.dy;
    }
    temperature -= cooling;
  }

  // ——— output: per-object moves ————————————————————————————————
  const moves: GraphArrangeMove[] = [];
  let skipped = 0;
  for (const node of nodes) {
    if (node.ghost) {
      continue;
    }
    const movable = node.members.filter((id) => !excluded.has(id));
    skipped += node.members.length - movable.length;
    if (movable.length === 0) {
      continue;
    }
    // Cluster layout: measure the members (in id order), grid them
    // around the node centre (≤ ceil(sqrt(n)) columns).
    const sizes: {
      id: string;
      w: number;
      h: number;
      cx: number;
      cy: number;
    }[] = [];
    for (const id of movable) {
      const object = objectsById.get(id);
      if (object === undefined) {
        continue;
      }
      const box = objectBBox(object);
      const centre = boxCenter(box);
      const size = boxSize(box);
      sizes.push({
        id,
        w: size.w,
        h: size.h,
        cx: centre.x,
        cy: centre.y,
      });
    }
    const columns = Math.ceil(Math.sqrt(sizes.length));
    const rowHeights: number[] = [];
    for (let i = 0; i < sizes.length; i += columns) {
      rowHeights.push(
        Math.max(...sizes.slice(i, i + columns).map((size) => size.h)),
      );
    }
    const totalH =
      rowHeights.reduce((sum, height) => sum + height, 0) +
      clusterGap * Math.max(0, rowHeights.length - 1);
    let cursorY = node.y - totalH / 2;
    let rowIndex = 0;
    for (let i = 0; i < sizes.length; i += 1) {
      const size = sizes[i];
      if (size === undefined) {
        continue;
      }
      if (i > 0 && i % columns === 0) {
        cursorY += (rowHeights[rowIndex] ?? 0) + clusterGap;
        rowIndex += 1;
      }
      const rowSlice = sizes.slice(
        rowIndex * columns,
        rowIndex * columns + columns,
      );
      const rowW =
        rowSlice.reduce((sum, item) => sum + item.w, 0) +
        clusterGap * Math.max(0, rowSlice.length - 1);
      const columnInRow = i % columns;
      let cursorX = node.x - rowW / 2;
      for (let c = 0; c < columnInRow; c += 1) {
        cursorX += (rowSlice[c]?.w ?? 0) + clusterGap;
      }
      const targetX = cursorX + size.w / 2;
      const targetY = cursorY + size.h / 2;
      const dx = targetX - size.cx;
      const dy = targetY - size.cy;
      if (Math.abs(dx) + Math.abs(dy) >= 1) {
        moves.push({ id: size.id, delta: vec2(dx, dy) });
      }
    }
  }

  return {
    moves,
    nodeCount: keptDrafts.length,
    edgeCount: physicsEdges.length,
    skipped,
  };
}
