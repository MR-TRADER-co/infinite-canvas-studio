/**
 * History manager: bounded undo/redo stacks over `ICommand` objects.
 *
 * Pushing a new command clears the redo branch, as in every conventional
 * undo history. Every stack mutation invokes the optional `onChange`
 * notifier so history-aware UI (undo/redo buttons) can refresh without
 * polling.
 */
import type { ICommand } from "@/core/commands/Command";

/** Owns the undo and redo stacks of executed commands. */
export class HistoryManager {
  private readonly undoStack: ICommand[] = [];
  private readonly redoStack: ICommand[] = [];

  /** Notifier invoked after every stack mutation. */
  private readonly notifyChange: (() => void) | undefined;

  /**
   * @param limit - maximum number of remembered commands, ≥ 200 per the
   *   interaction spec (oldest evicted).
   * @param onChange - optional notifier invoked after each stack mutation.
   */
  public constructor(
    public readonly limit = 200,
    onChange?: () => void,
  ) {
    this.notifyChange = onChange;
  }

  /**
   * Records an executed command.
   *
   * @param command - the command whose `do()` has just run.
   */
  public push(command: ICommand): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.changed();
  }

  /**
   * Undoes the most recent command.
   *
   * @returns the undone command, or null when nothing can be undone.
   */
  public undo(): ICommand | null {
    const command = this.undoStack.pop();
    if (command === undefined) {
      return null;
    }
    command.undo();
    this.redoStack.push(command);
    this.changed();
    return command;
  }

  /**
   * Redoes the most recently undone command.
   *
   * @returns the redone command, or null when nothing can be redone.
   */
  public redo(): ICommand | null {
    const command = this.redoStack.pop();
    if (command === undefined) {
      return null;
    }
    command.redo();
    this.undoStack.push(command);
    this.changed();
    return command;
  }

  /** @returns whether at least one command can be undone. */
  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** @returns whether at least one command can be redone. */
  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** @returns the number of undoable commands (project.digest, R10.2). */
  public depth(): number {
    return this.undoStack.length;
  }

  /** Forgets the entire history. */
  public clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.changed();
  }

  /** Invokes the change notifier after a stack mutation. */
  private changed(): void {
    this.notifyChange?.();
  }
}
