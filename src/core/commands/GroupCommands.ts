/**
 * Commands: group and ungroup selections (Ctrl+G / Ctrl+Shift+G).
 *
 * Grouping wraps a set of top-level objects into a `GroupObjectData` list
 * entry and stamps `parentId` on the members; the members keep their exact
 * world geometry, so grouping is pure bookkeeping — bounds derive from the
 * live union and transforms propagate to the members themselves
 * (see `core/model/GroupObject.ts`, AC2.5).
 *
 * Both commands are snapshot-exact: `do()`/`undo()` swap full before/after
 * object lists, so undo/redo cycles never drift. Selection changes ride
 * along (`selectAfter*`) and are applied by the ops layer OUTSIDE history —
 * selection is view state, not document state (DECISIONS: Selection never
 * enters history).
 */
import type { ICommand } from "@/core/commands/Command";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { GroupObjectData } from "@/core/model/GroupObject";

/** Reversible grouping of a set of objects. */
export class GroupCommand implements ICommand {
  /** Command label shown in the history UI. */
  public readonly label = "command.groupObjects";

  /**
   * @param scene - the scene gaining the group.
   * @param group - the assembled group object (after state).
   * @param membersAfter - member snapshots with `parentId` stamped (after).
   * @param membersBefore - member snapshots as they were (undo source).
   */
  public constructor(
    public readonly scene: Scene,
    public readonly group: GroupObjectData,
    public readonly membersAfter: readonly SceneObjectData[],
    public readonly membersBefore: readonly SceneObjectData[],
  ) {}

  /** Adds the group and stamps the members. */
  public do(): void {
    for (const member of this.membersAfter) {
      this.scene.add(member);
    }
    this.scene.add(this.group);
  }

  /** Removes the group and unstamps the members. */
  public undo(): void {
    this.scene.remove(this.group.id);
    for (const member of this.membersBefore) {
      this.scene.add(member);
    }
  }

  /** Re-applies the grouping. */
  public redo(): void {
    this.do();
  }
}

/** Reversible ungrouping of one group. */
export class UngroupCommand implements ICommand {
  /** Command label shown in the history UI. */
  public readonly label = "command.ungroupObjects";

  /**
   * @param scene - the scene losing the group.
   * @param group - the group being dissolved (before state).
   * @param membersBefore - member snapshots WITH `parentId` stamped (before).
   * @param membersAfter - member snapshots unstamped (after state).
   */
  public constructor(
    public readonly scene: Scene,
    public readonly group: GroupObjectData,
    public readonly membersBefore: readonly SceneObjectData[],
    public readonly membersAfter: readonly SceneObjectData[],
  ) {}

  /** Removes the group and unstamps the members. */
  public do(): void {
    this.scene.remove(this.group.id);
    for (const member of this.membersAfter) {
      this.scene.add(member);
    }
  }

  /** Restores the group and the stamped members. */
  public undo(): void {
    for (const member of this.membersBefore) {
      this.scene.add(member);
    }
    this.scene.add(this.group);
  }

  /** Re-applies the ungrouping. */
  public redo(): void {
    this.do();
  }
}
