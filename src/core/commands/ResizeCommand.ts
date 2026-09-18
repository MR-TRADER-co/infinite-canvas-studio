/**
 * Resizes an object from one geometry snapshot to another.
 *
 * `do()`/`undo()` swap immutable object snapshots through `Scene.add`
 * (replace-in-place, so paint order and `zIndex` are preserved) — the same
 * exact-restore precedent as `RemoveObjectCommand`. Snapshots make the
 * command idempotent and immune to relative-scale drift, which matters
 * because the select tool applies resize frames live during the gesture and
 * pushes the finished command without re-running `do()` (the `MoveCommand` +
 * coalescer precedent: one gesture = one history entry). Objects removed
 * mid-gesture are skipped (the resize silently drops, mirroring
 * `MoveCommand`).
 */
import type { ICommand } from "@/core/commands/Command";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Reversible resize of a single object. */
export class ResizeCommand implements ICommand {
  /** Command label shown in the history UI. */
  public readonly label = "command.resizeObject";

  /**
   * @param scene - the scene whose object resizes.
   * @param objectId - id of the object being resized.
   * @param before - the full object data before the gesture.
   * @param after - the full object data after the gesture.
   */
  public constructor(
    public readonly scene: Scene,
    public readonly objectId: string,
    public readonly before: SceneObjectData,
    public readonly after: SceneObjectData,
  ) {}

  /** Applies the resize when the object still exists. */
  public do(): void {
    this.apply(this.after);
  }

  /** Reverts the resize when the object still exists. */
  public undo(): void {
    this.apply(this.before);
  }

  /** Re-applies the resize. */
  public redo(): void {
    this.do();
  }

  /**
   * Replaces the live object with a snapshot, skipping when it was removed.
   *
   * @param snapshot - the object data to restore.
   */
  private apply(snapshot: SceneObjectData): void {
    if (this.scene.findById(this.objectId) === undefined) {
      return;
    }
    this.scene.add(snapshot);
  }
}
