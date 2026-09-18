/**
 * Command: removes a scene object (eraser, delete-selection, ...).
 *
 * The command stores the full object data, so undo re-inserts the exact
 * same object (id, zIndex and paint order included).
 */
import type { ICommand } from "@/core/commands/Command";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Removes (and removes again on redo) one object from the scene. */
export class RemoveObjectCommand implements ICommand {
  /**
   * @param scene - the scene losing the object.
   * @param object - the object data to remove.
   */
  public constructor(
    public readonly scene: Scene,
    public readonly object: SceneObjectData,
  ) {}

  /** Human-readable label for the history UI. */
  public readonly label = "command.removeObject";

  /** Removes the object from the scene. */
  public do(): void {
    this.scene.remove(this.object.id);
  }

  /** Re-inserts the stored object data. */
  public undo(): void {
    this.scene.add(this.object);
  }

  /** Re-applies the mutation. */
  public redo(): void {
    this.do();
  }
}
