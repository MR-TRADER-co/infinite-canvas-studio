/**
 * Composite command: bundles nested commands into one undo/redo step.
 *
 * Used for gestures that conceptually form a single history entry (e.g.
 * "erase strokes" = N removals, "paste objects" = N creations).
 *
 * Children may already be executed when the composite is recorded (live
 * erasing applies each removal as it happens); `do()` is then never called
 * by the recorder, while `undo()`/`redo()` still replay every child.
 */
import type { ICommand } from "@/core/commands/Command";

/** A command whose do/undo/redo cascades to its children. */
export class CompositeCommand implements ICommand {
  /**
   * @param label - label of the composite shown in the history UI.
   * @param commands - nested commands applied in order.
   */
  public constructor(
    public readonly label: string,
    public readonly commands: readonly ICommand[],
  ) {}

  /** Applies every nested command in order. */
  public do(): void {
    for (const command of this.commands) {
      command.do();
    }
  }

  /** Reverts every nested command in reverse order. */
  public undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i -= 1) {
      const command = this.commands[i];
      if (command !== undefined) {
        command.undo();
      }
    }
  }

  /** Re-applies every nested command in order. */
  public redo(): void {
    for (const command of this.commands) {
      command.redo();
    }
  }
}
