"use client";

/**
 * Layers-panel model bridge: live scene/selection snapshots plus
 * command-backed row actions.
 *
 * Subscribes to `scene:changed`/`selection:changed` (revision-keyed
 * re-renders, the `useCanvasStatus` pattern — Zustand never holds domain
 * data, CLAUDE.md §1.2). Every mutation flows through a command pushed
 * onto history: rename/visibility/lock patches use `UpdateObjectCommand`,
 * z-order moves use `ReorderCommand` (the panel lists objects in reverse
 * paint order, so "forward" in the panel means a later array index).
 */
import { useEffect, useState } from "react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { Selection } from "@/core/selection/Selection";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import {
  UpdateObjectCommand,
  type ObjectPatch,
} from "@/core/commands/UpdateObjectCommand";
import { ReorderCommand } from "@/core/commands/ReorderCommand";

/** Paint-order direction of a z-order move. */
export type ReorderDirection = "forward" | "backward";

/** Live layers snapshot consumed by the panel. */
export interface LayersModel {
  /** Objects in paint order (array order; the panel renders it reversed). */
  readonly objects: readonly SceneObjectData[];
  /** Ids of the currently selected objects. */
  readonly selectedIds: ReadonlySet<string>;
  /** Whether the model has booted (services resolved). */
  readonly ready: boolean;
  /** Replaces (or toggles) the selection with one row. */
  readonly selectRow: (id: string, additive: boolean) => void;
  /** Renames an object (empty string clears the custom name). */
  readonly rename: (id: string, name: string) => void;
  /** Sets the visibility of an object. */
  readonly setVisibility: (id: string, visible: boolean) => void;
  /** Sets the lock state of an object. */
  readonly setLocked: (id: string, locked: boolean) => void;
  /** Moves an object one step in the paint order. */
  readonly reorder: (id: string, direction: ReorderDirection) => void;
  /** Moves an object between absolute paint-order indices (R7.1 row drag). */
  readonly reorderArray: (id: string, from: number, to: number) => void;
}

/**
 * Subscribes to the scene and selection once the app booted and returns the
 * layers model with command-backed actions. Before boot, an empty model is
 * returned.
 *
 * @returns the live {@link LayersModel}.
 */
export function useLayersModel(): LayersModel {
  const [snapshot, setSnapshot] = useState<{
    objects: readonly SceneObjectData[];
    selectedIds: ReadonlySet<string>;
    ready: boolean;
  }>({ objects: [], selectedIds: new Set<string>(), ready: false });

  useEffect(() => {
    const unsubscribers: Array<() => void> = [];
    let cancelled = false;

    const install = (
      scene: Scene,
      selection: Selection,
      bus: EventBus<AppEventMap>,
    ): void => {
      const read = (): void => {
        setSnapshot({
          objects: [...scene.objects],
          selectedIds: new Set(selection.ids),
          ready: true,
        });
      };
      read();
      unsubscribers.push(
        bus.on("scene:changed", read),
        bus.on("selection:changed", read),
      );
    };

    void Application.boot().then((context: AppContext) => {
      if (!cancelled) {
        install(
          context.get(Services.scene),
          context.get(Services.selection),
          context.get(Services.eventBus),
        );
      }
    });

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  return {
    objects: snapshot.objects,
    selectedIds: snapshot.selectedIds,
    ready: snapshot.ready,
    selectRow: (id, additive) => {
      const selection = resolveSelection();
      if (selection === null) {
        return;
      }
      if (additive) {
        selection.toggle(id);
      } else {
        selection.replaceAll([id]);
      }
    },
    rename: (id, name) =>
      patchObject(id, { name: name.trim() === "" ? undefined : name.trim() }),
    setVisibility: (id, visible) => patchObject(id, { visible }),
    setLocked: (id, locked) => patchObject(id, { locked }),
    reorder: (id, direction) => reorderObject(id, direction),
    reorderArray: (id, from, to) => reorderObjectArray(id, from, to),
  };
}

/**
 * Applies a property patch through an `UpdateObjectCommand`.
 *
 * @param id - id of the object being patched.
 * @param patch - the fields to merge.
 */
function patchObject(id: string, patch: ObjectPatch): void {
  const scene = resolveScene();
  const history = resolveHistory();
  if (scene === null || history === null) {
    return;
  }
  const object = scene.findById(id);
  if (object === undefined) {
    return;
  }
  const command = new UpdateObjectCommand(scene, id, patch, object);
  command.do();
  history.push(command);
}

/**
 * Moves an object one step in the paint order through a `ReorderCommand`.
 *
 * @param id - id of the object being moved.
 * @param direction - forward (toward the top) or backward.
 */
function reorderObject(id: string, direction: ReorderDirection): void {
  const scene = resolveScene();
  const history = resolveHistory();
  if (scene === null || history === null) {
    return;
  }
  const from = scene.objects.findIndex((object) => object.id === id);
  if (from === -1) {
    return;
  }
  const to = direction === "forward" ? from + 1 : from - 1;
  if (to < 0 || to >= scene.objects.length) {
    return;
  }
  const command = new ReorderCommand(scene, id, from, to);
  command.do();
  history.push(command);
}

/**
 * Moves an object between absolute paint-order indices through a
 * `ReorderCommand` (the layers row drag, R7.1).
 *
 * @param id - id of the object being moved.
 * @param from - the current array index.
 * @param to - the target array index.
 * @returns the command's result, or null when the move is invalid.
 */
function reorderObjectArray(id: string, from: number, to: number): void {
  const scene = resolveScene();
  const history = resolveHistory();
  if (scene === null || history === null) {
    return;
  }
  if (from === to || from < 0 || to < 0 || from >= scene.objects.length) {
    return;
  }
  const command = new ReorderCommand(scene, id, from, to);
  command.do();
  history.push(command);
}

/**
 * @returns the booted scene, or null before boot.
 */
function resolveScene(): Scene | null {
  return AppContext.getDefault().tryGet(Services.scene) ?? null;
}

/**
 * @returns the booted history manager, or null before boot.
 */
function resolveHistory(): HistoryManager | null {
  return AppContext.getDefault().tryGet(Services.history) ?? null;
}

/**
 * @returns the booted selection, or null before boot.
 */
function resolveSelection(): Selection | null {
  return AppContext.getDefault().tryGet(Services.selection) ?? null;
}
