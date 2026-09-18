/**
 * Selection operations: the single command-assembly layer behind every
 * selection-level action (R2.5/R2.9).
 *
 * Both call sites — the keyboard shortcuts hook and the contextual toolbar
 * cluster — route through these functions so a behaviour (delete, duplicate,
 * group, ungroup, lock, z-order, nudge) exists exactly once and always lands
 * as ONE composite history step. Group-awareness is central: ids expand
 * through `expandGroupMemberIds` (a group's members follow its
 * delete/duplicate/nudge), duplication remaps group membership, and lock
 * toggles stamp the top-level objects.
 */
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { ICommand } from "@/core/commands/Command";
import type { IdGenerator } from "@/core/id/IdGenerator";
import type { Selection } from "@/core/selection/Selection";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { translateSceneObject } from "@/core/model/SceneObject";
import {
  expandGroupMemberIds,
  isGroupObject,
  makeGroup,
  type GroupObjectData,
} from "@/core/model/GroupObject";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import { RemoveObjectCommand } from "@/core/commands/RemoveObjectCommand";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import { MoveCommand } from "@/core/commands/MoveCommand";
import { CompositeCommand } from "@/core/commands/CompositeCommand";
import { GroupCommand, UngroupCommand } from "@/core/commands/GroupCommands";
import {
  planZOrderAfter,
  ZOrderCommand,
  type ZOrderOp,
} from "@/core/commands/ZOrderOps";
import { Coalescer } from "@/core/commands/Coalescer";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";
import {
  anchorOnPin,
  isPinnableObject,
  isPinnedObject,
  worldOnUnpin,
  type ViewportSize,
} from "@/core/model/Pinned";

/** World-space offset applied by duplication. */
const DUPLICATE_OFFSET: Vec2 = vec2(16, 16);

/** Idle time after which a nudge burst is committed to history. */
const NUDGE_FLUSH_MS = 600;

/** Shared nudge-burst coalescer (one burst at a time, app-wide). */
const nudgeCoalescer = new Coalescer();

/** Pending flush timer of the current nudge burst. */
let nudgeFlushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Deletes every selected object (group members follow their group) as one
 * composite history step.
 *
 * @param scene - the scene losing the objects.
 * @param history - history recording the composite command.
 * @param selection - the selection being deleted.
 */
export function deleteSelection(
  scene: Scene,
  history: HistoryManager,
  selection: Selection,
): void {
  flushNudgeHistory(history);
  const ids = expandGroupMemberIds(scene, [...selection.ids]);
  const commands: RemoveObjectCommand[] = [];
  // Snapshot: scene.remove prunes the selection, and mutating the live id
  // set mid-iteration could skip pending entries.
  for (const id of ids) {
    const object = scene.findById(id);
    if (object === undefined) {
      continue;
    }
    const command = new RemoveObjectCommand(scene, object);
    command.do();
    commands.push(command);
  }
  if (commands.length > 0) {
    history.push(new CompositeCommand("command.deleteSelection", commands));
  }
}

/**
 * Duplicates every selected top-level object — group members follow their
 * group with remapped ids and membership — as one composite history step,
 * then selects the copies.
 *
 * @param scene - the scene receiving the copies.
 * @param history - history recording the composite command.
 * @param selection - the selection being duplicated.
 * @param ids - id allocator for the copies.
 * @returns ids of the top-level copies (empty when nothing was duplicated).
 */
export function duplicateSelection(
  scene: Scene,
  history: HistoryManager,
  selection: Selection,
  ids: IdGenerator,
): string[] {
  flushNudgeHistory(history);
  const topLevelIds = [...selection.ids];
  if (topLevelIds.length === 0) {
    return [];
  }
  const expanded = expandGroupMemberIds(scene, topLevelIds);
  const idMap = new Map<string, string>();
  for (const id of expanded) {
    idMap.set(id, ids.next());
  }
  let z = scene.nextZIndex();
  const commands: AddObjectCommand[] = [];
  for (const id of expanded) {
    const object = scene.findById(id);
    if (object === undefined) {
      continue;
    }
    const copy = duplicateObjectDeep(object, idMap, DUPLICATE_OFFSET, z);
    z += 1;
    const command = new AddObjectCommand(scene, copy);
    command.do();
    commands.push(command);
  }
  if (commands.length === 0) {
    return [];
  }
  history.push(new CompositeCommand("command.duplicateSelection", commands));
  const copies = topLevelIds
    .map((id) => idMap.get(id))
    .filter((copy): copy is string => copy !== undefined);
  selection.replaceAll(copies);
  return copies;
}

/**
 * Groups the selection (Ctrl+G): wraps ≥ 2 top-level objects into one
 * group object and selects the group. One history step.
 *
 * @param scene - the scene gaining the group.
 * @param history - history recording the group command.
 * @param selection - the selection being grouped.
 * @param ids - id allocator for the group object.
 * @returns whether a group was created.
 */
export function groupSelection(
  scene: Scene,
  history: HistoryManager,
  selection: Selection,
  ids: IdGenerator,
): boolean {
  flushNudgeHistory(history);
  const members: SceneObjectData[] = [];
  for (const id of selection.ids) {
    const object = scene.findById(id);
    // Only top-level objects wrap into a fresh group (grouping an existing
    // group with siblings composes nesting); grouped children leave their
    // group first (ungroup) before re-grouping.
    if (object === undefined || object.parentId !== undefined) {
      continue;
    }
    members.push(object);
  }
  if (members.length < 2) {
    return false;
  }
  const group = makeGroup(ids.next(), members, scene.nextZIndex());
  const membersAfter = members.map((member) => ({
    ...member,
    parentId: group.id,
  }));
  const command = new GroupCommand(scene, group, membersAfter, members);
  command.do();
  history.push(command);
  selection.replaceAll([group.id]);
  return true;
}

/**
 * Ungroups every selected group (Ctrl+Shift+G): dissolves the group objects
 * and selects the released members. One history step per composite.
 *
 * @param scene - the scene losing the groups.
 * @param history - history recording the ungroup commands.
 * @param selection - the selection being ungrouped.
 * @returns whether any group was dissolved.
 */
export function ungroupSelection(
  scene: Scene,
  history: HistoryManager,
  selection: Selection,
): boolean {
  flushNudgeHistory(history);
  const commands: UngroupCommand[] = [];
  const released: string[] = [];
  for (const id of selection.ids) {
    const object = scene.findById(id);
    if (object === undefined || !isGroupObject(object)) {
      continue;
    }
    const members = object.childIds
      .map((childId) => scene.findById(childId))
      .filter((member): member is SceneObjectData => member !== undefined);
    const membersAfter = members.map((member) => ({
      ...member,
      parentId: undefined,
    }));
    const command = new UngroupCommand(scene, object, members, membersAfter);
    command.do();
    commands.push(command);
    released.push(...membersAfter.map((member) => member.id));
  }
  if (commands.length === 0) {
    return false;
  }
  history.push(
    commands.length === 1
      ? (commands[0] as UngroupCommand)
      : new CompositeCommand("command.ungroupObjects", commands),
  );
  selection.replaceAll(released);
  return true;
}

/**
 * Toggles the selection's lock (Ctrl+L): locks when any selected object is
 * unlocked, unlocks when every one is locked. One composite history step.
 * Locked objects refuse selection, gestures and inspector edits (the
 * `locked` contract, DECISIONS #42).
 *
 * @param scene - the scene whose objects lock.
 * @param history - history recording the composite command.
 * @param selection - the selection being locked/unlocked.
 * @returns whether the lock state changed.
 */
export function toggleLockSelection(
  scene: Scene,
  history: HistoryManager,
  selection: Selection,
): boolean {
  flushNudgeHistory(history);
  const objects: SceneObjectData[] = [];
  for (const id of selection.ids) {
    const object = scene.findById(id);
    if (object !== undefined) {
      objects.push(object);
    }
  }
  if (objects.length === 0) {
    return false;
  }
  const lock = objects.some((object) => !object.locked);
  const commands: UpdateObjectCommand[] = [];
  for (const object of objects) {
    if (object.locked === lock) {
      continue;
    }
    const command = new UpdateObjectCommand(
      scene,
      object.id,
      { locked: lock },
      object,
    );
    command.do();
    commands.push(command);
  }
  if (commands.length === 0) {
    return false;
  }
  history.push(
    commands.length === 1
      ? (commands[0] as UpdateObjectCommand)
      : new CompositeCommand("command.lockSelection", commands),
  );
  return true;
}

/**
 * Toggles the selection's screen pin (فاز ۲۵ «سنجاش روی صفحه», Mod-Shift-P):
 * pins when any selected pinnable object is unpinned, unpins when every
 * one is pinned — one composite history step. Pinning stamps the anchor
 * denoting the object's CURRENT on-screen spot; unpinning pairs an
 * `UpdateObjectCommand` (flag clear) with a `MoveCommand` landing the world
 * position exactly under the anchor (the documented geometry-command
 * exception: the drop must be exact, and `MoveCommand` keeps derived
 * geometry — freehand points, group members — consistent by construction).
 *
 * World-attached kinds (connectors, freehand strokes, groups, frames,
 * plugin widgets, query cards) refuse the affordance and are skipped.
 *
 * @param scene - the scene whose objects pin/unpin.
 * @param history - history recording the composite command.
 * @param selection - the selection being pinned/unpinned.
 * @param viewport - the viewport size in CSS pixels (anchor space).
 * @returns whether any pin state changed.
 */
export function togglePinSelection(
  scene: Scene,
  history: HistoryManager,
  selection: Selection,
  viewport: ViewportSize,
): boolean {
  flushNudgeHistory(history);
  const objects: SceneObjectData[] = [];
  for (const id of selection.ids) {
    const object = scene.findById(id);
    if (object !== undefined && isPinnableObject(object)) {
      objects.push(object);
    }
  }
  if (objects.length === 0) {
    return false;
  }
  const pin = objects.some((object) => !isPinnedObject(object));
  const commands: ICommand[] = [];
  for (const object of objects) {
    if (isPinnedObject(object) === pin) {
      continue;
    }
    if (pin) {
      const anchor = anchorOnPin(object, scene.camera, viewport);
      const command = new UpdateObjectCommand(
        scene,
        object.id,
        { pinned: true, pinAnchor: anchor },
        object,
      );
      command.do();
      commands.push(command);
    } else {
      const drop = worldOnUnpin(object, scene.camera, viewport);
      const delta = vec2(
        drop.x - object.position.x,
        drop.y - object.position.y,
      );
      const parts: ICommand[] = [];
      if (delta.x !== 0 || delta.y !== 0) {
        const move = new MoveCommand(scene, [object.id], delta);
        move.do();
        parts.push(move);
      }
      const unpinned = scene.findById(object.id);
      if (unpinned !== undefined) {
        const flag = new UpdateObjectCommand(
          scene,
          object.id,
          { pinned: false },
          unpinned,
        );
        flag.do();
        parts.push(flag);
      }
      commands.push(
        parts.length === 1
          ? (parts[0] as ICommand)
          : new CompositeCommand("command.pinSelection", parts),
      );
    }
  }
  if (commands.length === 0) {
    return false;
  }
  history.push(
    commands.length === 1
      ? (commands[0] as ICommand)
      : new CompositeCommand("command.pinSelection", commands),
  );
  return true;
}

/**
 * Applies one z-order operation to the selection as one composite history
 * step (see `ZOrderOps` for the planning rules).
 *
 * @param scene - the scene whose paint order changes.
 * @param history - history recording the composite command.
 * @param selection - the selection being reordered.
 * @param op - the operation direction.
 * @returns whether any object moved.
 */
export function zOrderSelection(
  scene: Scene,
  history: HistoryManager,
  selection: Selection,
  op: ZOrderOp,
): boolean {
  flushNudgeHistory(history);
  const before = scene.objects.map((object) => object.id);
  const after = planZOrderAfter(scene, [...selection.ids], op);
  if (after === null || sameSequence(after, before)) {
    return false;
  }
  const command = new ZOrderCommand(scene, before, after);
  command.do();
  history.push(command);
  return true;
}

/**
 * @param a - first id sequence.
 * @param b - second id sequence.
 * @returns whether both sequences are element-wise equal.
 */
function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Nudges the selection by a world-space delta (arrow keys: 1 world unit,
 * Shift = 10). Group members follow their group. Rapid bursts coalesce
 * into a single history entry flushed after a short idle time.
 *
 * @param scene - the scene whose objects move.
 * @param history - history receiving the flushed command.
 * @param selection - the selection being nudged.
 * @param dx - world-space x offset.
 * @param dy - world-space y offset.
 */
export function nudgeSelection(
  scene: Scene,
  history: HistoryManager,
  selection: Selection,
  dx: number,
  dy: number,
): void {
  if ((dx === 0 && dy === 0) || selection.isEmpty()) {
    return;
  }
  // Locked objects refuse interactive edits (the `locked` contract,
  // DECISIONS #42): only unlocked members move.
  const ids = expandGroupMemberIds(scene, [...selection.ids]).filter((id) => {
    const object = scene.findById(id);
    return object !== undefined && !object.locked;
  });
  if (ids.length === 0) {
    return;
  }
  const command = new MoveCommand(scene, ids, vec2(dx, dy));
  command.do();
  nudgeCoalescer.offer(command);
  if (nudgeFlushTimer !== null) {
    clearTimeout(nudgeFlushTimer);
  }
  nudgeFlushTimer = setTimeout(() => {
    nudgeFlushTimer = null;
    flushNudgeHistory(history);
  }, NUDGE_FLUSH_MS);
}

/**
 * Commits the pending nudge burst to history (if any). Call before undo,
 * other selection ops and tool switches so a burst never splits.
 *
 * @param history - history receiving the coalesced command.
 */
export function flushNudgeHistory(history: HistoryManager): void {
  if (nudgeFlushTimer !== null) {
    clearTimeout(nudgeFlushTimer);
    nudgeFlushTimer = null;
  }
  const pending = nudgeCoalescer.takePending();
  nudgeCoalescer.reset();
  if (pending !== null) {
    history.push(pending);
  }
}

/**
 * Builds an independent copy of an object with a remapped id, offset
 * position and a `zIndex` above the scene's current top. Group membership
 * is remapped through `idMap` (childIds and parentId), so duplicated
 * groups contain duplicated members.
 *
 * @param object - the object being copied.
 * @param idMap - old id → fresh id of every copied object in this batch.
 * @param offset - world-space offset applied to the copy.
 * @param zIndex - paint order for the copy.
 * @returns the copied object data.
 */
export function duplicateObjectDeep(
  object: SceneObjectData,
  idMap: ReadonlyMap<string, string>,
  offset: Vec2,
  zIndex: number,
): SceneObjectData {
  const id = idMap.get(object.id);
  if (id === undefined) {
    return translateSceneObject(object, offset);
  }
  const parentId =
    object.parentId !== undefined
      ? (idMap.get(object.parentId) ?? undefined)
      : undefined;
  const copy = {
    ...translateSceneObject(object, offset),
    id,
    parentId,
    zIndex,
  };
  if (isGroupObject(copy)) {
    const childIds = copy.childIds
      .map((childId) => idMap.get(childId))
      .filter((mapped): mapped is string => mapped !== undefined);
    const grouped: GroupObjectData = { ...copy, childIds };
    return grouped;
  }
  return copy;
}
