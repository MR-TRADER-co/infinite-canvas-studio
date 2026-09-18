/**
 * Alignment & distribution (R7.3): Figma-style selection-relative alignment
 * and equal-gap distribution, applied as ONE composite undo step.
 *
 * Pure planning functions (node-testable) compute per-object translation
 * deltas against the SELECTION's own bounding box (align) or an
 * equal-gap arrangement along an axis (distribute); the applier resolves
 * the live selection's top-level objects (locked objects refuse edits and
 * are skipped) and commits the plan through `MoveCommand`s wrapped in one
 * `CompositeCommand`.
 */
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { objectBBox } from "@/core/model/SceneObject";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import type { BBox } from "@/core/geometry/BBox";
import { MoveCommand } from "@/core/commands/MoveCommand";
import { CompositeCommand } from "@/core/commands/CompositeCommand";
import type { ICommand } from "@/core/commands/Command";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { Selection } from "@/core/selection/Selection";

/** Alignment modes: the selection-relative edge/axis to align to. */
export type AlignMode =
  "left" | "centerHorizontal" | "right" | "top" | "middle" | "bottom";

/** Distribution axes: equal gaps along this axis. */
export type DistributeAxis = "horizontal" | "vertical";

/** One planned object translation. */
export interface AlignPlanStep {
  /** Id of the object to translate. */
  readonly id: string;
  /** World-space delta to apply. */
  readonly delta: Vec2;
}

/**
 * Computes the union bounds of a set of objects.
 *
 * @param objects - the objects to bound.
 * @returns the union box, or null when empty.
 */
export function selectionBounds(
  objects: readonly SceneObjectData[],
): BBox | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const object of objects) {
    const box = objectBBox(object);
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  if (minX > maxX || minY > maxY) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Plans an alignment against an EXPLICIT reference frame (the full
 * selection bounds — locked objects included — while the plan moves only
 * the movable objects; the Figma contract).
 *
 * @param objects - the objects to move.
 * @param frame - the reference bounds.
 * @param mode - the alignment mode.
 * @returns the per-object translation steps.
 */
export function planAlignmentAgainstFrame(
  objects: readonly SceneObjectData[],
  frame: BBox,
  mode: AlignMode,
): readonly AlignPlanStep[] {
  const steps: AlignPlanStep[] = [];
  for (const object of objects) {
    const box = objectBBox(object);
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case "left":
        dx = frame.minX - box.minX;
        break;
      case "centerHorizontal":
        dx = (frame.minX + frame.maxX) / 2 - (box.minX + box.maxX) / 2;
        break;
      case "right":
        dx = frame.maxX - box.maxX;
        break;
      case "top":
        dy = frame.minY - box.minY;
        break;
      case "middle":
        dy = (frame.minY + frame.maxY) / 2 - (box.minY + box.maxY) / 2;
        break;
      case "bottom":
        dy = frame.maxY - box.maxY;
        break;
    }
    steps.push({ id: object.id, delta: vec2(dx, dy) });
  }
  return steps;
}

/**
 * Plans an alignment: every object's chosen edge/centre moves onto the
 * SELECTION bbox's matching edge/centre (the Figma contract — the
 * reference frame is the selection itself, never the canvas origin).
 *
 * @param objects - the objects to align (≥ 1; meaningful at ≥ 2).
 * @param mode - the alignment mode.
 * @returns the per-object translation steps (zero deltas included, so the
 *          caller can rely on the plan covering every object).
 */
export function planAlignment(
  objects: readonly SceneObjectData[],
  mode: AlignMode,
): readonly AlignPlanStep[] {
  const bounds = selectionBounds(objects);
  if (bounds === null) {
    return [];
  }
  return planAlignmentAgainstFrame(objects, bounds, mode);
}

/**
 * Plans an equal-gap distribution along one axis: objects sorted by that
 * axis keep their ORDER and sizes; the gaps between consecutive objects
 * all become the average gap (the Figma behaviour — total span is
 * preserved; overlapping objects can yield negative equal gaps, which is
 * honest: the arrangement still distributes evenly).
 *
 * @param objects - the objects to distribute (≥ 2; meaningful at ≥ 3).
 * @param axis - the distribution axis.
 * @returns the per-object translation steps.
 */
export function planDistribution(
  objects: readonly SceneObjectData[],
  axis: DistributeAxis,
): readonly AlignPlanStep[] {
  if (objects.length < 2) {
    return [];
  }
  const minKey = axis === "horizontal" ? "minX" : "minY";
  const maxKey = axis === "horizontal" ? "maxX" : "maxY";
  const sorted = [...objects].sort(
    (a, b) => objectBBox(a)[minKey] - objectBBox(b)[minKey],
  );
  const first = objectBBox(sorted[0] as SceneObjectData);
  const last = objectBBox(sorted[sorted.length - 1] as SceneObjectData);
  const span = last[maxKey] - first[minKey];
  const totalSize = sorted.reduce(
    (sum, object) =>
      sum + (objectBBox(object)[maxKey] - objectBBox(object)[minKey]),
    0,
  );
  const gap = (span - totalSize) / (sorted.length - 1);
  const steps: AlignPlanStep[] = [];
  let cursor = first[minKey];
  for (const object of sorted) {
    const box = objectBBox(object);
    const size = box[maxKey] - box[minKey];
    const target = cursor;
    const current = box[minKey];
    steps.push({
      id: object.id,
      delta:
        axis === "horizontal"
          ? vec2(target - current, 0)
          : vec2(0, target - current),
    });
    cursor = target + size + gap;
  }
  return steps;
}

/**
 * Resolves the movable top-level objects of the current selection (locked
 * objects refuse interactive edits — they are skipped and reported).
 *
 * @param scene - the scene resolving ids.
 * @param selection - the selection to resolve.
 * @returns the movable objects plus the skipped-lock count.
 */
export function movableSelectionObjects(
  scene: Scene,
  selection: Selection,
): { objects: SceneObjectData[]; locked: number } {
  const objects: SceneObjectData[] = [];
  let locked = 0;
  for (const id of selection.ids) {
    const object = scene.findById(id);
    if (object === undefined) {
      continue;
    }
    if (object.locked) {
      locked += 1;
      continue;
    }
    objects.push(object);
  }
  return { objects, locked };
}

/**
 * Commits a plan as ONE undo entry: every step's delta becomes a
 * `MoveCommand` (kind-aware translation), all wrapped in a composite.
 *
 * @param scene - the scene receiving the moves.
 * @param history - the history stack receiving the composite.
 * @param steps - the planned translations.
 * @param label - the composite's history label.
 * @returns the pushed command, or null when the plan is empty/identity.
 */
export function commitAlignmentPlan(
  scene: Scene,
  history: HistoryManager,
  steps: readonly AlignPlanStep[],
  label: string,
): ICommand | null {
  const commands = steps
    .filter((step) => step.delta.x !== 0 || step.delta.y !== 0)
    .map((step) => new MoveCommand(scene, [step.id], step.delta));
  if (commands.length === 0) {
    return null;
  }
  const composite = new CompositeCommand(label, commands);
  composite.do();
  history.push(composite);
  return composite;
}

/**
 * Aligns the current selection (R7.3): Figma-style, one undo step.
 *
 * @param scene - the scene.
 * @param history - the history stack.
 * @param selection - the selection.
 * @param mode - the alignment mode.
 * @returns whether anything moved.
 */
export function alignSelection(
  scene: Scene,
  history: HistoryManager,
  selection: Selection,
  mode: AlignMode,
): boolean {
  // The toolbar visibility rule is selection ≥ 2; locked objects refuse
  // to move but still define the selection frame (the Figma contract).
  const selectedAll = [...selection.ids]
    .map((id) => scene.findById(id))
    .filter((object): object is SceneObjectData => object !== undefined);
  const { objects: movable } = movableSelectionObjects(scene, selection);
  if (selection.size < 2 || movable.length < 1) {
    return false;
  }
  const frame = selectionBounds(selectedAll);
  if (frame === null) {
    return false;
  }
  const steps = planAlignmentAgainstFrame(movable, frame, mode);
  const composite = commitAlignmentPlan(
    scene,
    history,
    steps,
    "command.alignSelection",
  );
  return composite !== null;
}

/**
 * Distributes the current selection (R7.3): equal gaps, one undo step.
 *
 * @param scene - the scene.
 * @param history - the history stack.
 * @param selection - the selection.
 * @param axis - the distribution axis.
 * @returns whether anything moved.
 */
export function distributeSelection(
  scene: Scene,
  history: HistoryManager,
  selection: Selection,
  axis: DistributeAxis,
): boolean {
  const { objects } = movableSelectionObjects(scene, selection);
  if (selection.size < 3 || objects.length < 2) {
    return false;
  }
  const steps = planDistribution(objects, axis);
  const composite = commitAlignmentPlan(
    scene,
    history,
    steps,
    "command.distributeSelection",
  );
  return composite !== null;
}
