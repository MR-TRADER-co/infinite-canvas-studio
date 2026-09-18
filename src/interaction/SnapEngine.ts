/**
 * Snap engine (R5.5 — basic): computes the grid candidates a moving point
 * can snap to, plus the pure helpers the create/drag/resize gestures use so
 * edges land EXACTLY on the grid (AC5.5).
 *
 * Phase 5 scope is snap-to-GRID only: configurable spacing (default 20
 * world units, matching the visible grid base so snapped edges land on the
 * dots at every zoom level — see DECISIONS D-5.4), an on/off toggle driven
 * from the StatusBar. The `objectEdge`/`objectCenter`/`anchor` candidate
 * kinds stay in the vocabulary for the Phase 7 smart-guides engine; this
 * engine already speaks the candidate contract it will extend.
 *
 * Pure functions — no scene/UI dependencies — so the whole module is
 * node-testable.
 */
import { vec2, type Vec2 } from "@/core/geometry/Vec2";
import type { BBox } from "@/core/geometry/BBox";
import type { ResizeHandleId } from "@/core/geometry/resize";

/** Kinds of snap targets the engine can produce. */
export type SnapKind = "grid" | "objectEdge" | "objectCenter" | "anchor";

/** One candidate position an input point could snap to. */
export interface SnapCandidate {
  /** Which kind of target produced the candidate. */
  readonly kind: SnapKind;
  /** World-space snap position. */
  readonly position: Vec2;
  /** Id of the object that offered the snap, when object-based. */
  readonly objectId?: string;
}

/** Runtime configuration of the snap engine (mirrors the UI store). */
export interface SnapConfig {
  /** Master on/off switch (StatusBar magnet, R5.5). */
  readonly enabled: boolean;
  /** Grid spacing in world units (default 20 per R5.5). */
  readonly spacing: number;
}

/** Default snap grid spacing: 20 world units (R5.5). */
export const DEFAULT_SNAP_SPACING = 20;

/** The disabled default: gestures pass positions through unchanged. */
export const SNAP_DISABLED: SnapConfig = {
  enabled: false,
  spacing: DEFAULT_SNAP_SPACING,
};

/**
 * Rounds one scalar to the nearest grid multiple.
 *
 * @param value - the raw world coordinate.
 * @param spacing - the grid spacing (non-positive spacing returns the value
 *        unchanged — a defensive guard against corrupt settings).
 * @returns the snapped coordinate.
 */
export function snapScalar(value: number, spacing: number): number {
  if (spacing <= 0) {
    return value;
  }
  return Math.round(value / spacing) * spacing;
}

/**
 * Snaps a point to the nearest grid crossing.
 *
 * @param point - the raw world-space point.
 * @param spacing - the grid spacing.
 * @returns the snapped point.
 */
export function snapPointToGrid(point: Vec2, spacing: number): Vec2 {
  if (spacing <= 0) {
    return point;
  }
  return vec2(snapScalar(point.x, spacing), snapScalar(point.y, spacing));
}

/**
 * Computes the snap candidate positions of a raw point (R5.5): the four
 * grid crossings surrounding it, ranked by distance. Pure — object-based
 * candidates arrive with the Phase 7 smart guides.
 *
 * @param position - the raw pointer position in world space.
 * @param spacing - the grid spacing in world units.
 * @returns the (up to) four ranked candidates.
 */
export function gridSnapCandidates(
  position: Vec2,
  spacing: number,
): readonly SnapCandidate[] {
  if (spacing <= 0) {
    return [];
  }
  const floorX = Math.floor(position.x / spacing) * spacing;
  const floorY = Math.floor(position.y / spacing) * spacing;
  const crossings: Vec2[] = [
    vec2(floorX, floorY),
    vec2(floorX + spacing, floorY),
    vec2(floorX, floorY + spacing),
    vec2(floorX + spacing, floorY + spacing),
  ];
  return crossings
    .map((crossing) => ({
      kind: "grid" as const,
      position: crossing,
      distance: Math.hypot(crossing.x - position.x, crossing.y - position.y),
    }))
    .sort((a, b) => a.distance - b.distance)
    .map(({ kind, position: candidate }) => ({ kind, position: candidate }));
}

/**
 * Snaps one axis of a translated box: the box's min/center/max edges each
 * propose a snap, the candidate closest to the RAW translated edge wins —
 * so "edges land exactly on grid" (AC5.5) while the box never jumps more
 * than half a spacing.
 *
 * @param box - the box at its ORIGIN placement (before the displacement).
 * @param displacement - the raw world displacement applied to the box.
 * @param spacing - the grid spacing.
 * @returns the axis-aligned snap adjustment to ADD to the displacement.
 */
export function snapBoxDisplacement(
  box: Pick<BBox, "minX" | "maxX" | "minY" | "maxY">,
  displacement: Vec2,
  spacing: number,
): Vec2 {
  if (spacing <= 0) {
    return vec2(0, 0);
  }
  const axisSnap = (
    rawEdge: number,
    centerEdge: number,
    farEdge: number,
  ): number => {
    const proposals = [rawEdge, centerEdge, farEdge].map(
      (edge) => snapScalar(edge, spacing) - edge,
    );
    let best = proposals[0] ?? 0;
    for (const proposal of proposals) {
      if (Math.abs(proposal) < Math.abs(best)) {
        best = proposal;
      }
    }
    return best;
  };
  const dx = axisSnap(
    box.minX + displacement.x,
    (box.minX + box.maxX) / 2 + displacement.x,
    box.maxX + displacement.x,
  );
  const dy = axisSnap(
    box.minY + displacement.y,
    (box.minY + box.maxY) / 2 + displacement.y,
    box.maxY + displacement.y,
  );
  return vec2(dx, dy);
}

/**
 * Snaps the DRAGGED edges of a resize rectangle to the grid (R5.5 resize):
 * only the sides the grabbed handle controls move — the anchor sides stay
 * pinned, exactly like the pointer-driven rect math. Snapping happens on
 * the raw rect, then the min-size clamp re-applies so a snap can never
 * collapse the box below its floor.
 *
 * @param rect - the raw resized rectangle (already pointer-driven).
 * @param handle - the handle being dragged.
 * @param minSize - the minimum width/height floor.
 * @param spacing - the grid spacing.
 * @returns the snapped + re-clamped rectangle.
 */
export function snapResizeRect(
  rect: BBox,
  handle: ResizeHandleId,
  minSize: number,
  spacing: number,
): BBox {
  if (spacing <= 0) {
    return rect;
  }
  let minX = rect.minX;
  let minY = rect.minY;
  let maxX = rect.maxX;
  let maxY = rect.maxY;
  if (handle.includes("w")) {
    minX = Math.min(snapScalar(minX, spacing), maxX - minSize);
  }
  if (handle.includes("e")) {
    maxX = Math.max(snapScalar(maxX, spacing), minX + minSize);
  }
  if (handle.includes("n")) {
    minY = Math.min(snapScalar(minY, spacing), maxY - minSize);
  }
  if (handle.includes("s")) {
    maxY = Math.max(snapScalar(maxY, spacing), minY + minSize);
  }
  return {
    minX,
    minY,
    maxX: Math.max(maxX, minX + minSize),
    maxY: Math.max(maxY, minY + minSize),
  };
}

/**
 * Snaps a freshly created rectangle's origin so its top-left corner (and
 * therefore both edges) land on the grid, preserving its size.
 *
 * @param rect - the created rectangle (top-left + size).
 * @param spacing - the grid spacing.
 * @returns the translated rectangle.
 */
export function snapRectOrigin(
  rect: Pick<BBox, "minX" | "minY" | "maxX" | "maxY">,
  spacing: number,
): Pick<BBox, "minX" | "minY" | "maxX" | "maxY"> {
  if (spacing <= 0) {
    return rect;
  }
  const dx = snapScalar(rect.minX, spacing) - rect.minX;
  const dy = snapScalar(rect.minY, spacing) - rect.minY;
  return {
    minX: rect.minX + dx,
    minY: rect.minY + dy,
    maxX: rect.maxX + dx,
    maxY: rect.maxY + dy,
  };
}

/**
 * Snaps a point to the grid when the (optional) config says so — the
 * convenience the creation tools call on their press/release points.
 *
 * @param point - the raw world-space point.
 * @param config - the snap config (undefined/abled-off passes through).
 * @returns the snapped point.
 */
export function snapPointIfEnabled(
  point: Vec2,
  config: SnapConfig | undefined,
): Vec2 {
  if (config === undefined || !config.enabled || config.spacing <= 0) {
    return point;
  }
  return snapPointToGrid(point, config.spacing);
}

/**
 * Computes snap candidates for pointer positions against the configured
 * grid (the class keeps the {@link SnapCandidate} contract the Phase 7
 * smart-guides engine will extend with object/anchor targets).
 */
export class SnapEngine {
  private config: SnapConfig = {
    enabled: false,
    spacing: DEFAULT_SNAP_SPACING,
  };

  /**
   * @param config - the initial configuration (disabled by default).
   */
  public constructor(config: Partial<SnapConfig> = {}) {
    this.config = { ...SNAP_DISABLED, ...config };
  }

  /**
   * Replaces the configuration (the UI store calls this on every toggle or
   * spacing change).
   *
   * @param config - the new configuration.
   */
  public configure(config: SnapConfig): void {
    this.config = { ...config };
  }

  /** @returns the active configuration. */
  public get configuration(): SnapConfig {
    return this.config;
  }

  /**
   * Computes ranked snap candidates for a raw pointer position: the four
   * surrounding grid crossings by ascending distance when the engine is
   * enabled; empty when disabled (or the spacing is invalid).
   *
   * @param position - the raw pointer position in world space.
   * @param _excludeIds - object ids never to snap against (reserved for
   *        the Phase 7 object snap; the grid has no owners).
   * @returns the ranked snap candidates.
   */
  public computeSnapCandidates(
    position: Vec2,
    _excludeIds: readonly string[] = [],
  ): readonly SnapCandidate[] {
    if (!this.config.enabled || this.config.spacing <= 0) {
      return [];
    }
    return gridSnapCandidates(position, this.config.spacing);
  }
}
