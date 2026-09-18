/**
 * Command pattern contract for every reversible scene mutation.
 *
 * All mutations of the scene model flow through commands so the history
 * manager can undo/redo them uniformly (CLAUDE.md §1.5).
 *
 * PHASE 0 STUB — fully implemented in a later phase.
 */

/** A reversible mutation of the scene. */
export interface ICommand {
  /** Human-readable label for the history UI (i18n key or plain text). */
  readonly label: string;
  /** Applies the mutation (first execution). */
  do(): void;
  /** Reverts the mutation. */
  undo(): void;
  /** Re-applies the mutation after an undo. */
  redo(): void;
}
