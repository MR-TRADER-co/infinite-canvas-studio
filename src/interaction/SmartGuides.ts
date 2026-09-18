/**
 * Smart guides (R7.4): the pure geometry behind the magenta alignment
 * guides and equal-spacing hints shown while dragging a selection.
 *
 * Inputs are the moving box (the selection union at its RAW displaced
 * position), the reference boxes (other visible, unlocked, non-selected
 * objects) and a snap threshold in WORLD units (the caller converts the
 * 6px screen-space radius via the camera zoom). Outputs are the axis-wise
 * snap adjustment, the guide line segments to draw, and the equal-gap
 * hints (Figma-style value badges).
 *
 * Everything here is pure — no scene/UI/camera dependencies — so the
 * whole module is node-testable (AC7.4's exactness is provable).
 */
import type { BBox } from "@/core/geometry/BBox";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";

/** One magenta alignment guide: an infinite-feeling line segment. */
export interface GuideLine {
  /** The axis the line runs along (x = vertical line, y = horizontal). */
  readonly axis: "x" | "y";
  /** World coordinate the line sits at. */
  readonly coordinate: number;
  /** World-space extent of the visible segment. */
  readonly from: number;
  readonly to: number;
}

/** One equal-spacing hint: the gap value badge between two boxes. */
export interface SpacingHint {
  /** The axis the gap runs along. */
  readonly axis: "x" | "y";
  /** The equal gap, in world units. */
  readonly gap: number;
  /** The badge anchors at the centre of the gap region. */
  readonly centre: Vec2;
}

/** The computed smart-snap result for one drag frame. */
export interface SmartSnapResult {
  /** The adjustment to ADD to the raw displacement. */
  readonly adjust: Vec2;
  /** Guide lines to draw this frame. */
  readonly guides: readonly GuideLine[];
  /** Equal-gap hints to draw this frame. */
  readonly hints: readonly SpacingHint[];
}

/** A reference box offered by a non-selected object. */
export interface ReferenceBox {
  /** Id of the reference object (diagnostics only). */
  readonly id: string;
  /** The reference bounds. */
  readonly box: BBox;
}

/** Neutral result: no snap, nothing to draw. */
const NO_SNAP: SmartSnapResult = {
  adjust: vec2(0, 0),
  guides: [],
  hints: [],
};

/**
 * Computes the smart-snap adjustment and guide lines for a moving box
 * against a set of reference boxes.
 *
 * Matching: the moving box's three lines per axis (min/centre/max) pair
 * with every reference's three lines; the CLOSEST pair within the
 * threshold wins per axis (ties resolved by the smaller distance). The
 * adjustment lands the pair exactly on each other, and the guide segment
 * spans both boxes' extents.
 *
 * Equal spacing: when the moving box sits between two consecutive
 * references, its two gaps become the average gap when that arrangement
 * is within the threshold; when the moving box's gap to a neighbour
 * matches an existing reference gap within the threshold, it snaps to
 * exactly that gap. Both cases emit a value hint.
 *
 * @param moved - the moving box at its RAW displaced position.
 * @param references - the candidate reference boxes (caller pre-filters
 *        invisible/locked/selected — AC7.4's "never for locked/invisible").
 * @param threshold - the snap threshold in world units.
 * @returns the snap result (never null; identity when nothing matches).
 */
export function computeSmartSnap(
  moved: BBox,
  references: readonly ReferenceBox[],
  threshold: number,
): SmartSnapResult {
  if (references.length === 0 || threshold <= 0) {
    return NO_SNAP;
  }
  const lineCandidates = (box: BBox): [number, number, number] => [
    box.minX,
    (box.minX + box.maxX) / 2,
    box.maxX,
  ];
  const columnCandidates = (box: BBox): [number, number, number] => [
    box.minY,
    (box.minY + box.maxY) / 2,
    box.maxY,
  ];

  // ── Edge/centre alignment: best pair per axis ─────────────────────
  let bestX: { delta: number; coordinate: number; other: BBox } | null = null;
  let bestY: { delta: number; coordinate: number; other: BBox } | null = null;
  for (const reference of references) {
    for (const movedLine of lineCandidates(moved)) {
      for (const otherLine of lineCandidates(reference.box)) {
        const delta = otherLine - movedLine;
        if (Math.abs(delta) > threshold) {
          continue;
        }
        if (bestX === null || Math.abs(delta) < Math.abs(bestX.delta)) {
          bestX = { delta, coordinate: otherLine, other: reference.box };
        }
      }
    }
    for (const movedLine of columnCandidates(moved)) {
      for (const otherLine of columnCandidates(reference.box)) {
        const delta = otherLine - movedLine;
        if (Math.abs(delta) > threshold) {
          continue;
        }
        if (bestY === null || Math.abs(delta) < Math.abs(bestY.delta)) {
          bestY = { delta, coordinate: otherLine, other: reference.box };
        }
      }
    }
  }

  const guides: GuideLine[] = [];
  let adjustX = 0;
  let adjustY = 0;
  if (bestX !== null) {
    adjustX = bestX.delta;
    guides.push({
      axis: "x",
      coordinate: bestX.coordinate,
      from: Math.min(moved.minY, bestX.other.minY),
      to: Math.max(moved.maxY, bestX.other.maxY),
    });
  }
  if (bestY !== null) {
    adjustY = bestY.delta;
    guides.push({
      axis: "y",
      coordinate: bestY.coordinate,
      from: Math.min(moved.minX, bestY.other.minX),
      to: Math.max(moved.maxX, bestY.other.maxX),
    });
  }

  // ── Equal-spacing hints (checked on the ALIGNED position) ─────────
  const hints: SpacingHint[] = [];
  const aligned: BBox = {
    minX: moved.minX + adjustX,
    minY: moved.minY + adjustY,
    maxX: moved.maxX + adjustX,
    maxY: moved.maxY + adjustY,
  };
  const spacing = equalSpacing(aligned, references, threshold);
  if (spacing !== null) {
    adjustX += spacing.adjustX;
    adjustY += spacing.adjustY;
    hints.push(spacing.hint);
  }

  if (
    adjustX === 0 &&
    adjustY === 0 &&
    guides.length === 0 &&
    hints.length === 0
  ) {
    return NO_SNAP;
  }
  return { adjust: vec2(adjustX, adjustY), guides, hints };
}

/**
 * Computes the equal-spacing snap for the (already edge-aligned) moving
 * box: between-pair equalisation or neighbour-gap matching.
 *
 * @param moved - the moving box at its aligned position.
 * @param references - the reference boxes.
 * @param threshold - the snap threshold in world units.
 * @returns the extra axis adjustment + the hint, or null.
 */
function equalSpacing(
  moved: BBox,
  references: readonly ReferenceBox[],
  threshold: number,
): { adjustX: number; adjustY: number; hint: SpacingHint } | null {
  const axes: Array<"x" | "y"> = ["x", "y"];
  for (const axis of axes) {
    const min = axis === "x" ? "minX" : "minY";
    const max = axis === "x" ? "maxX" : "maxY";
    const sorted = [...references]
      .map((reference) => reference.box)
      .sort((a, b) => a[min] - b[min]);
    // Case 1: the moving box sits between two consecutive references —
    // equalise its two gaps to their average.
    for (let i = 1; i < sorted.length; i += 1) {
      const left = sorted[i - 1] as BBox;
      const right = sorted[i] as BBox;
      const gapLeft = moved[min] - left[max];
      const gapRight = right[min] - moved[max];
      if (gapLeft < 0 || gapRight < 0) {
        continue;
      }
      const average = (gapLeft + gapRight) / 2;
      // Shift so both gaps equal `average` (d = average − gapLeft, which
      // is exactly (gapRight − gapLeft)/2 — symmetric on both gaps).
      const delta = average - gapLeft;
      if (Math.abs(delta) > threshold) {
        continue;
      }
      return {
        adjustX: axis === "x" ? delta : 0,
        adjustY: axis === "y" ? delta : 0,
        hint: {
          axis,
          gap: average,
          centre: gapCentre(axis, left, moved),
        },
      };
    }
    // Case 2: the moving box's gap to its nearest neighbour snaps to an
    // existing gap between consecutive references.
    for (let i = 1; i < sorted.length; i += 1) {
      const left = sorted[i - 1] as BBox;
      const right = sorted[i] as BBox;
      const existingGap = right[min] - left[max];
      if (existingGap <= 0) {
        continue;
      }
      // Moving box right of `right`?
      const gapAfter = moved[min] - right[max];
      if (gapAfter >= 0 && Math.abs(gapAfter - existingGap) <= threshold) {
        const delta = existingGap - gapAfter;
        return {
          adjustX: axis === "x" ? delta : 0,
          adjustY: axis === "y" ? delta : 0,
          hint: {
            axis,
            gap: existingGap,
            centre: gapCentre(axis, right, moved),
          },
        };
      }
      // Moving box left of `left`?
      const gapBefore = left[min] - moved[max];
      if (gapBefore >= 0 && Math.abs(gapBefore - existingGap) <= threshold) {
        const delta = -(existingGap - gapBefore);
        return {
          adjustX: axis === "x" ? delta : 0,
          adjustY: axis === "y" ? delta : 0,
          hint: {
            axis,
            gap: existingGap,
            centre: gapCentre(axis, moved, left),
          },
        };
      }
    }
  }
  return null;
}

/**
 * Computes the badge anchor for the gap between two boxes along an axis.
 *
 * @param axis - the gap's axis.
 * @param first - the first box (lower coordinate).
 * @param second - the second box (higher coordinate).
 * @returns the gap-region centre in world space.
 */
function gapCentre(axis: "x" | "y", first: BBox, second: BBox): Vec2 {
  if (axis === "x") {
    return vec2(
      (first.maxX + second.minX) / 2,
      (Math.max(first.minY, second.minY) + Math.min(first.maxY, second.maxY)) /
        2,
    );
  }
  return vec2(
    (Math.max(first.minX, second.minX) + Math.min(first.maxX, second.maxX)) / 2,
    (first.maxY + second.minY) / 2,
  );
}

/**
 * Collects the smart-guide reference boxes for a drag: every visible,
 * unlocked object NOT in the excluded set with a non-degenerate box.
 *
 * @param objects - all scene objects.
 * @param excludedIds - ids never offering a reference (the dragged
 *        selection + its group members).
 * @returns the reference boxes.
 */
export function collectReferenceBoxes(
  objects: readonly {
    id: string;
    visible: boolean;
    locked: boolean;
  }[],
  boxes: (id: string) => BBox | undefined,
  excludedIds: ReadonlySet<string>,
): ReferenceBox[] {
  const references: ReferenceBox[] = [];
  for (const object of objects) {
    if (!object.visible || object.locked || excludedIds.has(object.id)) {
      continue;
    }
    const box = boxes(object.id);
    if (
      box === undefined ||
      box.maxX - box.minX <= 0 ||
      box.maxY - box.minY <= 0
    ) {
      continue;
    }
    references.push({ id: object.id, box });
  }
  return references;
}
