/**
 * Moves a set of objects by a fixed world-space delta.
 *
 * Reversible translation of one or more objects: `do()` translates every
 * referenced object (immutable data replacement through `Scene.add`), `undo()`
 * applies the negated delta. Translation is linear, so undo is exact even
 * when the command was assembled by coalescing per-frame deltas — the merged
 * delta is the sum of the frame deltas and negating it restores the initial
 * placement (CLAUDE.md §1.5: all mutations flow through commands).
 */
import type { ICommand } from "@/core/commands/Command";
import type { Scene } from "@/core/model/Scene";
import { translateSceneObject } from "@/core/model/SceneObject";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";

/** Reversible translation of one or more objects. */
export class MoveCommand implements ICommand {
  /** Command label shown in the history UI. */
  public readonly label = "command.moveObjects";

  /**
   * @param scene - the scene whose objects move.
   * @param objectIds - ids of the objects being moved (order preserved).
   * @param delta - world-space offset applied by `do()` and reversed by `undo()`.
   */
  public constructor(
    public readonly scene: Scene,
    public readonly objectIds: readonly string[],
    public readonly delta: Vec2,
  ) {}

  /** Applies the move to every object that still exists. */
  public do(): void {
    this.translate(this.delta);
  }

  /** Reverts the move (negated delta). */
  public undo(): void {
    this.translate(vec2(-this.delta.x, -this.delta.y));
  }

  /** Re-applies the move. */
  public redo(): void {
    this.do();
  }

  /**
   * Translates every referenced object that is still in the scene.
   *
   * @param delta - the world-space offset to apply.
   */
  private translate(delta: Vec2): void {
    if (delta.x === 0 && delta.y === 0) {
      return;
    }
    for (const id of this.objectIds) {
      const object = this.scene.findById(id);
      if (object === undefined) {
        continue;
      }
      this.scene.add(translateSceneObject(object, delta));
    }
  }
}
