/**
 * Scene: the root of the scene graph and the single source of truth.
 *
 * Owns the flat object list plus the camera and selection references.
 * Rendering, interaction and persistence all read from (and write through)
 * this model — never from DOM geometry (CLAUDE.md §1.3).
 *
 * Mutations bump a monotonic `revision` counter and invoke the injected
 * `onChange` notifier so the render loop and status readouts can react
 * without polling. Every mutation flows through commands (undo-able).
 */
import { Camera } from "@/core/camera/Camera";
import { Selection } from "@/core/selection/Selection";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { isConnectorObject } from "@/core/model/ConnectorObject";
import { refreshGluedConnector } from "@/core/model/ConnectorObject";

/** Scene-graph root holding every object plus camera and selection. */
export class Scene {
  /** Internal mutable object list, in insertion (paint) order. */
  private readonly list: SceneObjectData[] = [];

  /** Every object currently on the canvas, in insertion order. */
  public readonly objects: readonly SceneObjectData[] = this.list;

  /** The viewport camera owned by this scene. */
  public readonly camera: Camera;

  /** The selection owned by this scene. */
  public readonly selection: Selection;

  /** Monotonic counter bumped by every mutation (dirty-flag source). */
  public revision = 0;

  /** Notifier invoked after every mutation (composition-root wiring). */
  private readonly notifyChange: (() => void) | undefined;

  /** Re-entrancy guard of the glue-follow pass (see {@link refreshGluedConnectors}). */
  private refreshing = false;

  /**
   * @param camera - camera to own (default: a fresh `Camera`).
   * @param selection - selection to own (default: a fresh `Selection`).
   * @param onChange - optional notifier invoked after each mutation.
   */
  public constructor(
    camera: Camera = new Camera(),
    selection: Selection = new Selection(),
    onChange?: () => void,
  ) {
    this.camera = camera;
    this.selection = selection;
    this.notifyChange = onChange;
  }

  /** @returns the number of objects currently in the scene. */
  public get objectCount(): number {
    return this.list.length;
  }

  /**
   * Adds an object to the scene; an object with an existing id replaces the
   * old entry in place (idempotent re-insert), otherwise it is appended.
   *
   * @param object - the object data to insert.
   */
  public add(object: SceneObjectData): void {
    const index = this.list.findIndex((existing) => existing.id === object.id);
    if (index === -1) {
      this.list.push(object);
    } else {
      this.list[index] = object;
    }
    this.bumpRevision();
  }

  /**
   * Removes an object from the scene and prunes it from the selection so the
   * selection never holds ids of deleted objects.
   *
   * @param objectId - id of the object to remove.
   * @returns whether an object was actually removed.
   */
  public remove(objectId: string): boolean {
    const index = this.list.findIndex((existing) => existing.id === objectId);
    if (index === -1) {
      return false;
    }
    this.list.splice(index, 1);
    this.selection.remove(objectId);
    this.bumpRevision();
    return true;
  }

  /**
   * Looks an object up by id.
   *
   * @param objectId - id to look up.
   * @returns the object data, or `undefined` when not present.
   */
  public findById(objectId: string): SceneObjectData | undefined {
    return this.list.find((existing) => existing.id === objectId);
  }

  /**
   * @returns the next free `zIndex` for newly created objects (0 when the
   * scene is empty, one above the current maximum otherwise).
   */
  public nextZIndex(): number {
    return (
      this.list.reduce((max, object) => Math.max(max, object.zIndex), -1) + 1
    );
  }

  /**
   * Moves an object to a new position in the paint order (z-order).
   *
   * The renderer paints `objects` in array order, so reordering the list
   * reorders the visual stacking. The target index is clamped to the list
   * bounds; moving to the current position is a no-op that does not bump
   * the revision.
   *
   * @param objectId - id of the object to move.
   * @param targetIndex - the desired list index (clamped).
   * @returns whether the object actually moved.
   */
  public moveObjectTo(objectId: string, targetIndex: number): boolean {
    const from = this.list.findIndex((existing) => existing.id === objectId);
    if (from === -1) {
      return false;
    }
    const clamped = Math.max(0, Math.min(targetIndex, this.list.length - 1));
    if (clamped === from) {
      return false;
    }
    const [object] = this.list.splice(from, 1);
    if (object === undefined) {
      return false;
    }
    this.list.splice(clamped, 0, object);
    this.bumpRevision();
    return true;
  }

  /**
   * Reorders the object list to match a given id sequence (snapshot-exact
   * z-order restore). Ids missing from the list are ignored; objects absent
   * from the sequence keep their relative order after the sequenced ones.
   * A no-op order (matching the current one) does not bump the revision.
   *
   * @param ids - the desired paint order as an id sequence.
   */
  public applyOrder(ids: readonly string[]): void {
    const desired = new Map<string, number>();
    for (const [index, id] of ids.entries()) {
      if (!desired.has(id) && this.findById(id) !== undefined) {
        desired.set(id, index);
      }
    }
    const sorted = [...this.list].sort((a, b) => {
      const ia = desired.get(a.id);
      const ib = desired.get(b.id);
      if (ia === undefined && ib === undefined) {
        return 0;
      }
      if (ia === undefined) {
        return 1;
      }
      if (ib === undefined) {
        return -1;
      }
      return ia - ib;
    });
    const unchanged =
      sorted.length === this.list.length &&
      sorted.every((object, index) => object === this.list[index]);
    if (unchanged) {
      return;
    }
    this.list.length = 0;
    this.list.push(...sorted);
    this.bumpRevision();
  }

  /** Removes every object and prunes the selection (document reset/load). */
  public clear(): void {
    if (this.list.length === 0) {
      return;
    }
    for (const object of this.list) {
      this.selection.remove(object.id);
    }
    this.list.length = 0;
    this.bumpRevision();
  }

  /** Bumps the revision counter, refreshes glued connectors and notifies. */
  private bumpRevision(): void {
    this.revision += 1;
    this.refreshGluedConnectors();
    this.notifyChange?.();
  }

  /**
   * Glue-follow pass: re-derives the cached endpoint positions of every
   * glued connector against the CURRENT object list, so connectors follow
   * moved, resized, re-added or restored objects without any command
   * knowing about connectors. Runs inside {@link bumpRevision} before the
   * change notification (one mutation → one repaint covers the follow);
   * replacements write the list directly without re-bumping, guarded by
   * {@link Scene.refreshing} against re-entrancy.
   */
  private refreshGluedConnectors(): void {
    if (this.refreshing) {
      return;
    }
    let hasConnectors = false;
    for (const object of this.list) {
      if (isConnectorObject(object)) {
        hasConnectors = true;
        break;
      }
    }
    if (!hasConnectors) {
      return;
    }
    this.refreshing = true;
    try {
      for (let i = 0; i < this.list.length; i += 1) {
        const object = this.list[i];
        if (object === undefined || !isConnectorObject(object)) {
          continue;
        }
        const refreshed = refreshGluedConnector(object, this.list);
        if (refreshed !== object) {
          this.list[i] = refreshed;
        }
      }
    } finally {
      this.refreshing = false;
    }
  }
}
