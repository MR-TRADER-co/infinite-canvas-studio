/**
 * Group object: a container whose transform applies to all its children.
 *
 * Children are referenced by id, never nested structurally, so z-order and
 * membership stay cheap to persist and mutate. Children keep ABSOLUTE world
 * geometry; a group's bounds are derived on demand as the union of its
 * children's live bounds ({@link groupWorldBBox}), and every group
 * transform (move/rotate) is applied to the member objects themselves —
 * so ungrouping is a pure bookkeeping removal and children keep their exact
 * on-canvas placement (AC2.5).
 */
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import {
  objectBBox,
  rotatedObjectBBox,
  translateSceneObject,
} from "@/core/model/SceneObject";
import type { BBox } from "@/core/geometry/BBox";
import { bboxUnion } from "@/core/geometry/BBox";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";

/** Data of a group object. */
export interface GroupObjectData extends SceneObjectData {
  /** Discriminant: always `group`. */
  readonly kind: "group";
  /** Ids of the grouped objects, ordered bottom-to-top. */
  readonly childIds: readonly string[];
}

/**
 * @param object - the object to inspect.
 * @returns whether the object is a group.
 */
export function isGroupObject(
  object: SceneObjectData,
): object is GroupObjectData {
  return object.kind === "group";
}

/**
 * Assembles a group object from its (already placed) children. The group's
 * own `position` mirrors the union origin — derived bookkeeping, refreshed
 * by consumers via {@link groupWorldBBox}; the union of the LIVE child
 * bounds is the truth.
 *
 * @param id - allocated object id for the group.
 * @param children - the member objects (bottom-to-top order kept).
 * @param zIndex - paint order for the group's list entry.
 * @returns the assembled group data.
 */
export function makeGroup(
  id: string,
  children: readonly SceneObjectData[],
  zIndex: number,
): GroupObjectData {
  let union: BBox | null = null;
  for (const child of children) {
    union =
      union === null
        ? rotatedObjectBBox(child)
        : bboxUnion(union, rotatedObjectBBox(child));
  }
  const origin = union ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    id,
    kind: "group",
    name: undefined,
    parentId: undefined,
    position: vec2(origin.minX, origin.minY),
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    childIds: children.map((child) => child.id),
  };
}

/**
 * Computes the live world-space bounds of a group: the union of its
 * children's bounds, resolved against the scene (recursive — nested groups
 * union transitively). Children missing from the scene are skipped; an empty
 * group collapses to its own `position` point.
 *
 * @param scene - the scene resolving the child ids.
 * @param group - the group to measure.
 * @returns the world-space box covering every member.
 */
export function groupWorldBBox(scene: Scene, group: GroupObjectData): BBox {
  let union: BBox | null = null;
  for (const childId of group.childIds) {
    const child = scene.findById(childId);
    if (child === undefined || !child.visible) {
      continue;
    }
    const bounds = worldBBoxOf(scene, child);
    union = union === null ? bounds : bboxUnion(union, bounds);
  }
  if (union === null) {
    return objectBBox(group);
  }
  return union;
}

/**
 * Computes the world-space bounds of an object, resolving groups through
 * the scene (groups have no geometry of their own) and covering rotated
 * objects with their rotation footprint.
 *
 * @param scene - the scene resolving group membership.
 * @param object - the object to measure.
 * @returns the object's live world-space box.
 */
export function worldBBoxOf(scene: Scene, object: SceneObjectData): BBox {
  if (isGroupObject(object)) {
    return groupWorldBBox(scene, object);
  }
  return rotatedObjectBBox(object);
}

/**
 * Resolves the top-level ancestor of an object: clicking a grouped child
 * selects the enclosing group (the Figma contract). The walk stops at the
 * first missing parent, so orphaned `parentId` references (an undone group
 * command restoring children before the group) resolve to the child itself.
 *
 * @param scene - the scene resolving parent ids.
 * @param objectId - id of the hit object.
 * @returns id of the top-level object representing the hit.
 */
export function resolveTopLevelId(scene: Scene, objectId: string): string {
  let current = objectId;
  for (let hop = 0; hop < 32; hop += 1) {
    const object = scene.findById(current);
    if (object === undefined || object.parentId === undefined) {
      return current;
    }
    if (scene.findById(object.parentId) === undefined) {
      return current;
    }
    current = object.parentId;
  }
  return current;
}

/**
 * Expands a selection id set with group members: every group id gains the
 * ids of its (recursively resolved) children, so a move/delete/duplicate of
 * a selection always covers the grouped objects too. Order is stable:
 * selection order first, then the members of each group in child order.
 *
 * @param scene - the scene resolving group membership.
 * @param ids - the selected ids (typically top-level ids).
 * @returns the expanded id list (de-duplicated).
 */
export function expandGroupMemberIds(
  scene: Scene,
  ids: readonly string[],
): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();
  const push = (id: string): void => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    expanded.push(id);
  };
  for (const id of ids) {
    push(id);
    const object = scene.findById(id);
    if (object === undefined || !isGroupObject(object)) {
      continue;
    }
    for (const childId of object.childIds) {
      const child = scene.findById(childId);
      if (child === undefined) {
        continue;
      }
      for (const member of expandGroupMemberIds(scene, [childId])) {
        push(member);
      }
    }
  }
  return expanded;
}

/**
 * Rotates objects around a shared world center by `delta` radians (pure —
 * returns new object data). Each object's bounds centre orbits the pivot
 * and its own `rotation` advances by `delta`; translation goes through
 * {@link translateSceneObject} so freehand points and connector endpoints
 * follow. Groups rotate around the SAME pivot as their children (pass
 * `[group, ...children]` with the group's centre — AC2.5).
 *
 * @param objects - the objects being rotated (snapshots, never live data).
 * @param center - the world-space pivot.
 * @param delta - the rotation applied by this step (radians).
 * @returns the rotated copies, in input order.
 */
export function rotateObjectsAround(
  objects: readonly SceneObjectData[],
  center: Vec2,
  delta: number,
): SceneObjectData[] {
  const cos = Math.cos(delta);
  const sin = Math.sin(delta);
  return objects.map((object) => {
    const bounds = objectBBox(object);
    const objectCenter = vec2(
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minY + bounds.maxY) / 2,
    );
    const offset = vec2(objectCenter.x - center.x, objectCenter.y - center.y);
    const rotated = vec2(
      center.x + offset.x * cos - offset.y * sin,
      center.y + offset.x * sin + offset.y * cos,
    );
    const translated = translateSceneObject(
      object,
      vec2(rotated.x - objectCenter.x, rotated.y - objectCenter.y),
    );
    return { ...translated, rotation: translated.rotation + delta };
  });
}
