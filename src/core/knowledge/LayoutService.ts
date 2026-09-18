/**
 * Auto-layout slot computation (R13.4): the PURE geometry engine behind
 * frames with a `layout` definition.
 *
 * Contract:
 * - Children are the objects GEOMETRICALLY inside the frame's body (the
 *   frame containment model — never persisted, recomputed here).
 * - Slot ORDER follows the children's CURRENT geometry: a column sorts by
 *   (y, x), a row by (x, y) — so a manual drag inside the frame is a
 *   REORDER, not a free move (the next reflow snaps the child into its
 *   derived slot).
 * - The frame GROWS to wrap its content: the computed size is the union
 *   of the slots + padding (never smaller than the current frame).
 * - `itemWidth: "fill"` stretches slot widths to the frame's inner width
 *   for kinds that resize horizontally (text boxes with fixed width
 *   mode; auto-width boxes, stickers and groups keep their own width —
 *   no width ping-pong).
 * - EXCLUDED from flows: connectors, freehand strokes, group MEMBERS
 *   (the group as a whole may sit in the flow) and NESTED frames that
 *   carry their own layout (single-level auto-layout — DECISIONS).
 *
 * Pure module: no DOM, no React — fully node-testable.
 */
import {
  isFrameObject,
  type FrameObjectData,
} from "@/core/model/FrameObject";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Geometric slot assigned to one flow child. */
export interface LayoutSlot {
  /** The child's object id. */
  readonly id: string;
  /** The slot's top-left corner (world units). */
  readonly x: number;
  readonly y: number;
  /** The slot's size (world units). */
  readonly width: number;
  readonly height: number;
}

/** The complete reflow plan for one auto-layout frame. */
export interface ReflowPlan {
  /** The frame's object id. */
  readonly frameId: string;
  /** The frame's derived size (wraps the content + padding). */
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** The computed slots (empty when no children qualify). */
  readonly slots: readonly LayoutSlot[];
}

/** Slot-position epsilon: smaller deltas are treated as "already there". */
export const REFLOW_EPSILON = 0.5;

/**
 * @param object - the object to test.
 * @returns whether the object's kind participates in flows at all.
 */
function isFlowableKind(object: SceneObjectData): boolean {
  return (
    object.kind !== "connector" &&
    object.kind !== "freehand" &&
    object.kind !== "group"
  );
}

/**
 * Resolves the flow items for a frame: geometrically-contained objects
 * minus group members, minus nested auto-layout frames. A GROUP that sits
 * inside the frame flows as one item (its own members follow it).
 *
 * @param frame - the frame.
 * @param allObjects - every scene object (containment is geometric).
 * @param groupMembers - ids that belong to any group.
 * @returns the flow items (unsorted).
 */
function flowItems(
  frame: FrameObjectData,
  allObjects: readonly SceneObjectData[],
  groupMembers: ReadonlySet<string>,
): readonly SceneObjectData[] {
  const bodyMinX = frame.position.x;
  const bodyMinY = frame.position.y + frame.titleHeight;
  const bodyMaxX = frame.position.x + frame.width;
  const bodyMaxY = frame.position.y + frame.height;
  return allObjects.filter((object) => {
    if (object.id === frame.id || !isFlowableKind(object)) {
      return false;
    }
    // A nested frame with its own layout stays out (single-level).
    if (isFrameObject(object) && object.layout !== undefined) {
      return false;
    }
    // Group members stay out — the group object itself flows.
    if (groupMembers.has(object.id)) {
      return false;
    }
    const bbox = objectBBox(object);
    if (bbox === null) {
      return false;
    }
    // TOP-LEFT-corner containment: an object whose corner sits inside
    // the body flows (even when it overflows the far edge — the frame
    // then GROWS to wrap the stacked slots); an object fully outside
    // (its corner beyond the far edge) never joins the flow.
    return (
      bbox.minX >= bodyMinX &&
      bbox.minX < bodyMaxX &&
      bbox.minY >= bodyMinY &&
      bbox.minY < bodyMaxY
    );
  });
}

/**
 * Minimal bbox for containment + slot math (position-anchored kinds only;
 * connectors/freehand are already excluded upstream).
 *
 * @param object - the object.
 * @returns its bounds, or null when the kind carries no geometry.
 */
function objectBBox(object: SceneObjectData): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const record = object as unknown as Record<string, unknown>;
  const width = record.width;
  const height = record.height;
  if (
    typeof width !== "number" ||
    !Number.isFinite(width) ||
    typeof height !== "number" ||
    !Number.isFinite(height)
  ) {
    return null;
  }
  const { x, y } = object.position;
  return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

/**
 * Whether a kind's slot may stretch horizontally under `itemWidth: fill`.
 * Fixed-width text boxes stretch; auto-width boxes keep their measured
 * width (no width ping-pong — DECISIONS).
 *
 * @param object - the object.
 * @returns whether the slot width may fill.
 */
function canFillWidth(object: SceneObjectData): boolean {
  const record = object as unknown as Record<string, unknown>;
  if (object.kind === "textBox") {
    return record.sizeMode !== "auto";
  }
  // Shapes and frames fill; everything else keeps its width.
  return object.kind === "shape" || object.kind === "frame";
}

/**
 * Computes the reflow plan for one auto-layout frame.
 *
 * @param frame - the frame (must carry a `layout` definition).
 * @param allObjects - every scene object.
 * @param groupMembers - ids belonging to any group.
 * @returns the plan (slots sorted in flow order + the wrapped frame size).
 */
export function computeReflowPlan(
  frame: FrameObjectData,
  allObjects: readonly SceneObjectData[],
  groupMembers: ReadonlySet<string> = new Set(),
): ReflowPlan {
  const layout = frame.layout;
  if (layout === undefined) {
    return {
      frameId: frame.id,
      frameWidth: frame.width,
      frameHeight: frame.height,
      slots: [],
    };
  }
  const items = flowItems(frame, allObjects, groupMembers);
  // Slot order follows the CURRENT geometry (a drag reorders).
  const sorted = [...items].sort((a, b) =>
    layout.dir === "column"
      ? a.position.y - b.position.y || a.position.x - b.position.x
      : a.position.x - b.position.x || a.position.y - b.position.y,
  );

  const innerX = frame.position.x + layout.padding;
  const innerY = frame.position.y + frame.titleHeight + layout.padding;
  const innerWidth = frame.width - layout.padding * 2;

  const slots: LayoutSlot[] = [];
  let cursor = layout.dir === "column" ? innerY : innerX;
  let crossMax = 0;
  for (const item of sorted) {
    const bbox = objectBBox(item);
    if (bbox === null) {
      continue;
    }
    const width =
      layout.itemWidth === "fill" && canFillWidth(item)
        ? Math.max(0, innerWidth)
        : bbox.maxX - bbox.minX;
    const height = bbox.maxY - bbox.minY;
    if (layout.dir === "column") {
      slots.push({
        id: item.id,
        x: innerX,
        y: cursor,
        width,
        height,
      });
      crossMax = Math.max(crossMax, width);
      cursor += height + layout.gap;
    } else {
      slots.push({
        id: item.id,
        x: cursor,
        y: innerY,
        width,
        height,
      });
      crossMax = Math.max(crossMax, height);
      cursor += width + layout.gap;
    }
  }

  // The frame wraps its content (never smaller than the current size).
  // contentExtent is the last slot's far edge along the flow axis; the
  // used extent subtracts the content origin (padding both ends).
  const contentExtent = slots.length > 0 ? cursor - layout.gap : 0;
  const usedAlong =
    slots.length > 0
      ? contentExtent - (layout.dir === "column" ? innerY : innerX)
      : 0;
  const frameWidth =
    layout.dir === "column"
      ? Math.max(frame.width, crossMax + layout.padding * 2)
      : Math.max(frame.width, layout.padding + usedAlong + layout.padding);
  const frameHeight =
    layout.dir === "column"
      ? Math.max(
          frame.height,
          frame.titleHeight +
            layout.padding +
            usedAlong +
            layout.padding,
        )
      : Math.max(
          frame.height,
          frame.titleHeight + layout.padding + crossMax + layout.padding,
        );

  return { frameId: frame.id, frameWidth, frameHeight, slots };
}

/**
 * Whether a slot's target position differs from the current position by
 * more than {@link REFLOW_EPSILON} — the guard that makes an unchanged
 * reflow a NO-OP (never a loop, AC13.5-adjacent).
 *
 * @param slot - the computed slot.
 * @param current - the object's current position.
 * @returns whether the object must move.
 */
export function slotRequiresMove(
  slot: LayoutSlot,
  current: { x: number; y: number },
): boolean {
  return (
    Math.abs(slot.x - current.x) > REFLOW_EPSILON ||
    Math.abs(slot.y - current.y) > REFLOW_EPSILON
  );
}

/**
 * Collects the ids of every group member in the scene (for the flow
 * exclusions).
 *
 * @param objects - every scene object.
 * @returns the member-id set.
 */
export function collectGroupMembers(
  objects: readonly SceneObjectData[],
): Set<string> {
  const members = new Set<string>();
  for (const object of objects) {
    if (object.kind === "group") {
      const childIds = (object as unknown as { childIds?: unknown })
        .childIds;
      if (Array.isArray(childIds)) {
        for (const childId of childIds) {
          if (typeof childId === "string") {
            members.add(childId);
          }
        }
      }
    }
  }
  return members;
}
