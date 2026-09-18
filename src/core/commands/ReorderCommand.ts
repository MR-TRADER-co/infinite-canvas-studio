/**
 * Moves one object within the scene's paint order (layers-panel z-order
 * operations: bring forward / send backward).
 *
 * The renderer paints `scene.objects` in array order, so z-order IS the
 * array position (`zIndex` is bookkeeping). `do()` moves the object from
 * its captured index to the target index; `undo()` moves it back. Out-of
 * -range or missing targets are skipped (no-ops, the `MoveCommand`
 * convention). The moved object keeps its id/data — only its position in
 * the paint order changes.
 */
import type { ICommand } from "@/core/commands/Command";
import type { Scene } from "@/core/model/Scene";

/** Reversible paint-order move of a single object. */
export class ReorderCommand implements ICommand {
  /** Command label shown in the history UI. */
  public readonly label = "command.reorderObject";

  /**
   * @param scene - the scene whose paint order changes.
   * @param objectId - id of the object being moved.
   * @param fromIndex - the object's index before the move.
   * @param toIndex - the target index (clamped to the list bounds at run
   *   time, so scene mutations between construction and execution stay
   *   safe).
   */
  public constructor(
    public readonly scene: Scene,
    public readonly objectId: string,
    public readonly fromIndex: number,
    public readonly toIndex: number,
  ) {}

  /** Applies the reorder when the object still exists. */
  public do(): void {
    this.scene.moveObjectTo(this.objectId, this.toIndex);
  }

  /** Reverts the reorder when the object still exists. */
  public undo(): void {
    this.scene.moveObjectTo(this.objectId, this.fromIndex);
  }

  /** Re-applies the reorder. */
  public redo(): void {
    this.do();
  }
}
