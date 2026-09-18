/**
 * Z-order operations for selections: bring to front / bring forward / send
 * backward / send to back (R2.5).
 *
 * The renderer paints `scene.objects` in array order, so z-order IS the
 * array position. Planning runs on the ID SEQUENCE (robust against the
 * index shifts that per-object moves cause): the selection's members move
 * as a block past their unselected neighbours, preserving the selection's
 * internal paint order. The recorded {@link ZOrderCommand} snapshots the
 * full before/after order — snapshot-exact undo/redo, immune to interleaved
 * mutations.
 */
import type { ICommand } from "@/core/commands/Command";
import type { Scene } from "@/core/model/Scene";

/** The four z-order operations. */
export type ZOrderOp = "front" | "forward" | "backward" | "back";

/**
 * Plans the paint order after one z-order operation over a selection.
 *
 * @param scene - the scene whose paint order changes.
 * @param ids - the selected top-level object ids.
 * @param op - the operation direction.
 * @returns the after-order id sequence, or null when nothing moves.
 */
export function planZOrderAfter(
  scene: Scene,
  ids: readonly string[],
  op: ZOrderOp,
): string[] | null {
  const selected = new Set<string>();
  for (const id of ids) {
    if (scene.findById(id) !== undefined) {
      selected.add(id);
    }
  }
  if (selected.size === 0) {
    return null;
  }
  const seq = scene.objects.map((object) => object.id);
  const isSelected = (id: string): boolean => selected.has(id);

  let after: string[];
  if (op === "front") {
    after = [...seq.filter((id) => !isSelected(id)), ...seq.filter(isSelected)];
  } else if (op === "back") {
    after = [...seq.filter(isSelected), ...seq.filter((id) => !isSelected(id))];
  } else if (op === "forward") {
    // One top-down pass: every selected id swaps with the unselected id
    // directly above it (each member steps up exactly one neighbour).
    after = [...seq];
    for (let i = after.length - 2; i >= 0; i -= 1) {
      const current = after[i];
      const above = after[i + 1];
      if (current === undefined || above === undefined) {
        continue;
      }
      if (isSelected(current) && !isSelected(above)) {
        after[i + 1] = current;
        after[i] = above;
      }
    }
  } else {
    // backward: bottom-up mirror — every selected id swaps with the
    // unselected id directly below it.
    after = [...seq];
    for (let i = 1; i < after.length; i += 1) {
      const current = after[i];
      const below = after[i - 1];
      if (current === undefined || below === undefined) {
        continue;
      }
      if (isSelected(current) && !isSelected(below)) {
        after[i - 1] = current;
        after[i] = below;
      }
    }
  }

  if (sameSequence(after, seq)) {
    return null;
  }
  return after;
}

/**
 * Reversible paint-order change of the whole list (snapshot semantics).
 */
export class ZOrderCommand implements ICommand {
  /** Command label shown in the history UI. */
  public readonly label = "command.zOrderSelection";

  /**
   * @param scene - the scene whose paint order changes.
   * @param before - the id sequence before the operation.
   * @param after - the id sequence after the operation.
   */
  public constructor(
    public readonly scene: Scene,
    public readonly before: readonly string[],
    public readonly after: readonly string[],
  ) {}

  /** Applies the after order. */
  public do(): void {
    this.scene.applyOrder(this.after);
  }

  /** Restores the before order. */
  public undo(): void {
    this.scene.applyOrder(this.before);
  }

  /** Re-applies the after order. */
  public redo(): void {
    this.do();
  }
}

/**
 * @param a - first id sequence.
 * @param b - second id sequence.
 * @returns whether both sequences are element-wise equal.
 */
function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
