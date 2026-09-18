/**
 * Anchor points: glue positions connectors can attach to on objects.
 *
 * Every object exposes eight anchors — the four edge midpoints (N, E, S, W)
 * followed by the four corners (NE, SE, SW, NW) — derived from its
 * axis-aligned bounding box. Connectors store the anchor INDEX they are
 * glued to; the world position is re-derived from the target's CURRENT
 * bounds whenever needed, so glued endpoints follow moved or resized
 * objects for free (the "glue-follow" contract, CLAUDE.md §1.3).
 */
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import type { BBox } from "@/core/geometry/BBox";

/** Number of anchors every object exposes. */
export const ANCHOR_COUNT = 8;

/**
 * Anchor index → compass position:
 * 0 = N (top edge midpoint), 1 = E, 2 = S, 3 = W,
 * 4 = NE, 5 = SE, 6 = SW, 7 = NW.
 */
export type AnchorIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A snap/glue position belonging to a scene object. */
export interface AnchorPoint {
  /** Id of the object the anchor belongs to. */
  readonly objectId: string;
  /** Index of the anchor on the object (see {@link AnchorIndex}). */
  readonly index: AnchorIndex;
  /** World-space position of the anchor. */
  readonly position: Vec2;
}

/**
 * Computes every anchor position of a bounding box, in index order.
 *
 * @param box - the world-space box to place anchors on.
 * @returns the eight anchor positions (N, E, S, W, NE, SE, SW, NW).
 */
export function anchorPositions(box: BBox): readonly Vec2[] {
  const midX = (box.minX + box.maxX) / 2;
  const midY = (box.minY + box.maxY) / 2;
  return [
    vec2(midX, box.minY), // 0: N
    vec2(box.maxX, midY), // 1: E
    vec2(midX, box.maxY), // 2: S
    vec2(box.minX, midY), // 3: W
    vec2(box.maxX, box.minY), // 4: NE
    vec2(box.maxX, box.maxY), // 5: SE
    vec2(box.minX, box.maxY), // 6: SW
    vec2(box.minX, box.minY), // 7: NW
  ];
}

/**
 * Resolves one anchor position of a bounding box.
 *
 * @param box - the world-space box to place the anchor on.
 * @param index - the anchor index (wrapped into range, so any number is safe).
 * @returns the anchor's world-space position.
 */
export function anchorAt(box: BBox, index: number): Vec2 {
  const positions = anchorPositions(box);
  const wrapped =
    ((Math.trunc(index) % ANCHOR_COUNT) + ANCHOR_COUNT) % ANCHOR_COUNT;
  return (
    positions[wrapped] ??
    vec2(midOf(box.minX, box.maxX), midOf(box.minY, box.maxY))
  );
}

/**
 * Finds the anchor of a bounding box closest to a world position.
 *
 * @param box - the world-space box to place anchors on.
 * @param world - the position to snap near.
 * @returns the nearest anchor index and its position (N when the box is
 *   degenerate — every anchor collapses to the same point).
 */
export function nearestAnchor(
  box: BBox,
  world: Vec2,
): { readonly index: AnchorIndex; readonly position: Vec2 } {
  const positions = anchorPositions(box);
  let bestIndex: AnchorIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < positions.length; i += 1) {
    const position = positions[i];
    if (position === undefined) {
      continue;
    }
    const dx = world.x - position.x;
    const dy = world.y - position.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i as AnchorIndex;
    }
  }
  return {
    index: bestIndex,
    position: positions[bestIndex] ?? anchorAt(box, bestIndex),
  };
}

/**
 * Unit exit vector of one anchor: the direction a connector should LEAVE
 * (or arrive along) when glued to that anchor — edge midpoints exit
 * perpendicular to their edge, corners exit diagonally. Mirrors the index
 * order of {@link anchorPositions}.
 */
const ANCHOR_EXITS: readonly Vec2[] = [
  vec2(0, -1), // 0: N
  vec2(1, 0), // 1: E
  vec2(0, 1), // 2: S
  vec2(-1, 0), // 3: W
  vec2(Math.SQRT1_2, -Math.SQRT1_2), // 4: NE
  vec2(Math.SQRT1_2, Math.SQRT1_2), // 5: SE
  vec2(-Math.SQRT1_2, Math.SQRT1_2), // 6: SW
  vec2(-Math.SQRT1_2, -Math.SQRT1_2), // 7: NW
];

/**
 * Resolves the exit direction of one anchor index.
 *
 * @param index - the anchor index (wrapped into range, so any number is safe).
 * @returns the unit vector a connector leaves the anchor along.
 */
export function anchorExitVector(index: number): Vec2 {
  const wrapped =
    ((Math.trunc(index) % ANCHOR_COUNT) + ANCHOR_COUNT) % ANCHOR_COUNT;
  return ANCHOR_EXITS[wrapped] ?? vec2(0, -1);
}

/**
 * @param a - first value.
 * @param b - second value.
 * @returns the midpoint of two numbers.
 */
function midOf(a: number, b: number): number {
  return (a + b) / 2;
}
