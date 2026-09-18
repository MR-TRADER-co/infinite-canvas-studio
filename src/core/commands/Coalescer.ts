/**
 * Coalesces consecutive commands (e.g. per-frame drag deltas) into one.
 *
 * Dragging emits one move command per rendered frame; the coalescer folds
 * them into a single history entry so undo reverts the whole gesture. The
 * caller applies each frame command immediately (live feedback) and pushes
 * only the accumulated command when the gesture ends —
 * {@link Coalescer.takePending} returns it, {@link Coalescer.reset} drops it.
 *
 * Merge rule: two {@link MoveCommand}s over the exact same id list (same
 * order, same length) fold into one command whose delta is the component-wise
 * sum. Any other sequence starts a new pending command.
 */
import type { ICommand } from "@/core/commands/Command";
import { MoveCommand } from "@/core/commands/MoveCommand";
import { vec2 } from "@/core/geometry/Vec2";

/** Accumulates commands, merging ones that belong to the same gesture. */
export class Coalescer {
  private pending: ICommand | null = null;

  /**
   * Offers a command for coalescing with the pending one.
   *
   * @param command - the command produced by the current input frame.
   * @returns the command to push to history when the gesture ends: the
   *          merged command while the gesture continues, or — until a
   *          mergeable pair exists — the offered command unchanged.
   */
  public offer(command: ICommand): ICommand {
    const merged = this.merge(this.pending, command);
    this.pending = merged ?? command;
    return this.pending;
  }

  /**
   * @returns the command still waiting to be coalesced (and pushed), or null.
   */
  public takePending(): ICommand | null {
    return this.pending;
  }

  /** Drops the pending command without merging it. */
  public reset(): void {
    this.pending = null;
  }

  /**
   * Merges two commands into one when they belong to the same gesture.
   *
   * @param pending - the accumulated command, or null.
   * @param next - the command of the current frame.
   * @returns the merged command, or null when the pair is not mergeable.
   */
  private merge(pending: ICommand | null, next: ICommand): ICommand | null {
    if (pending === null) {
      return null;
    }
    if (pending instanceof MoveCommand && next instanceof MoveCommand) {
      if (sameIds(pending.objectIds, next.objectIds)) {
        return new MoveCommand(
          next.scene,
          next.objectIds,
          vec2(pending.delta.x + next.delta.x, pending.delta.y + next.delta.y),
        );
      }
    }
    return null;
  }
}

/**
 * @param a - first id list.
 * @param b - second id list.
 * @returns whether both lists are element-wise equal.
 */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
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
