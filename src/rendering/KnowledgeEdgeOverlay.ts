/**
 * The on-canvas knowledge-edge overlay model (pack R12.4): a PURE
 * projection of the knowledge index into drawable edges — one edge per
 * (source object → resolved target object) pair and one dashed stub
 * per broken link — plus the deterministic geometry helpers the canvas
 * painter uses for the stubs (FNV-1a hashed angles, so a missing
 * title's stub never jumps between frames).
 *
 * The frame is rebuilt by the canvas host on every `knowledge:changed`
 * (and on selection changes, for the highlight ids); the painter
 * resolves the live object boxes at PAINT time, so edges track dragged
 * objects without any extra invalidation.
 */
import type { KnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";

/** One drawable knowledge edge. */
export interface KnowledgeCanvasEdge {
  /** The linking (source) object id. */
  readonly sourceId: string;
  /** The resolved target object id (broken edges leave this unset). */
  readonly targetId?: string;
  /** The broken target's normalised key (broken edges only). */
  readonly brokenKey?: string;
  /** The broken target's display title (broken edges only). */
  readonly brokenDisplay?: string;
}

/** The full overlay frame handed to the renderer. */
export interface KnowledgeEdgeFrame {
  /** The drawable edges (deduped, capped). */
  readonly edges: readonly KnowledgeCanvasEdge[];
  /** The currently selected object ids (edge highlight). */
  readonly selectedIds: ReadonlySet<string>;
}

/** Hard edge cap — dense graphs degrade by truncation, never by lag. */
export const MAX_KNOWLEDGE_EDGES = 400;

/** FNV-1a 32-bit hash of a string. */
function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The deterministic stub angle of one broken key (radians, [0, 2π)).
 *
 * @param key - the broken target's normalised key.
 * @returns the stable stub direction.
 */
export function brokenEdgeAngle(key: string): number {
  return (hash32(key) % 62832) / 10000;
}

/**
 * The deterministic stub END point of one broken link — a fixed
 * distance away from the source centre, in the hashed direction.
 *
 * @param sourceCenter - the source object's centre (world space).
 * @param reach - the stub length beyond the source's box.
 * @param key - the broken target's normalised key.
 * @returns the stub end (world space).
 */
export function brokenStubEnd(
  sourceCenter: Vec2,
  reach: number,
  key: string,
): Vec2 {
  const angle = brokenEdgeAngle(key);
  const length = reach + (hash32(`${key}\u0000len`) % 60);
  return vec2(
    sourceCenter.x + Math.cos(angle) * length,
    sourceCenter.y + Math.sin(angle) * length,
  );
}

/**
 * Projects the knowledge index into the drawable edge list.
 *
 * Resolved links become (source, target) pairs (the FIRST resolved
 * target wins when a title is shared); broken links become stubs.
 * Self-edges and duplicate pairs drop; the list caps at
 * {@link MAX_KNOWLEDGE_EDGES} in a deterministic (sorted) order.
 *
 * @param index - the live knowledge snapshot.
 * @returns the deduped, capped edge list.
 */
export function buildKnowledgeEdges(
  index: KnowledgeIndex,
): KnowledgeCanvasEdge[] {
  const seen = new Set<string>();
  const edges: KnowledgeCanvasEdge[] = [];
  const sourceIds = [...index.outgoing.keys()].sort();
  for (const sourceId of sourceIds) {
    const links = index.outgoing.get(sourceId) ?? [];
    const sorted = [...links].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
    for (const link of sorted) {
      if (link.resolvedIds.length > 0) {
        const targetId = link.resolvedIds.find((id) => id !== sourceId);
        if (targetId === undefined) {
          continue;
        }
        const key = `${sourceId}\u0000${targetId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        edges.push({ sourceId, targetId });
      } else {
        const key = `${sourceId}\u0000b\u0000${link.key}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        edges.push({
          sourceId,
          brokenKey: link.key,
          brokenDisplay: link.display,
        });
      }
      if (edges.length >= MAX_KNOWLEDGE_EDGES) {
        return edges;
      }
    }
  }
  return edges;
}
