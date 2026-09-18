/**
 * Command: inserts a scene object (pen stroke, shape, ...).
 *
 * The pen tool executes the command the moment the stroke is committed;
 * the history manager records it so undo/redo work uniformly.
 */
import type { ICommand } from "@/core/commands/Command";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Adds (and re-adds on redo) one object to the scene. */
export class AddObjectCommand implements ICommand {
  /**
   * @param scene - the scene receiving the object.
   * @param object - the object data to insert.
   */
  public constructor(
    public readonly scene: Scene,
    public readonly object: SceneObjectData,
  ) {}

  /** Human-readable label for the history UI. */
  public readonly label = "command.addObject";

  /** Inserts the object into the scene. */
  public do(): void {
    this.scene.add(this.object);
  }

  /** Removes the object from the scene again. */
  public undo(): void {
    this.scene.remove(this.object.id);
  }

  /** Re-applies the mutation. */
  public redo(): void {
    this.do();
  }
}
