/**
 * Command: rotates one or more objects around a shared world centre.
 *
 * Snapshot-swap semantics (the `ResizeCommand` convention): the gesture
 * applies live frames through {@link rotateObjectsAround} and records this
 * command on release; `do()` re-applies the AFTER snapshots, `undo()`
 * restores the BEFORE snapshots — exact restores, no drift across long
 * undo/redo sequences. Rotating a group passes `[group, ...children]` so
 * members orbit the group centre (AC2.5).
 */
import type { ICommand } from "@/core/commands/Command";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Reversible rotation of a set of objects around one pivot. */
export class RotateCommand implements ICommand {
  /** Command label shown in the history UI. */
  public readonly label = "command.rotateObjects";

  /**
   * @param scene - the scene whose objects rotate.
   * @param before - the object snapshots captured before the gesture.
   * @param after - the object snapshots produced by the gesture.
   */
  public constructor(
    public readonly scene: Scene,
    public readonly before: readonly SceneObjectData[],
    public readonly after: readonly SceneObjectData[],
  ) {}

  /** Applies the after snapshots of objects still present. */
  public do(): void {
    for (const object of this.after) {
      if (this.scene.findById(object.id) !== undefined) {
        this.scene.add(object);
      }
    }
  }

  /** Restores the before snapshots of objects still present. */
  public undo(): void {
    for (const object of this.before) {
      if (this.scene.findById(object.id) !== undefined) {
        this.scene.add(object);
      }
    }
  }

  /** Re-applies the rotation. */
  public redo(): void {
    this.do();
  }
}
