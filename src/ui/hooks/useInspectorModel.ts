"use client";

/**
 * Inspector-panel model bridge: live selection snapshots plus command-backed
 * property actions.
 *
 * Subscribes to `scene:changed`/`selection:changed` (revision-keyed
 * re-renders, the `useLayersModel` pattern — Zustand never holds domain data,
 * CLAUDE.md §1.2). Mutations follow the layered command conventions:
 * style restyles plan per-object patches (`planStylePatch`) applied through
 * `UpdateObjectCommand` — batched into one composite when several objects
 * change, one history entry per user action; position edits route through
 * `MoveCommand` (delta-based, so freehand point lists move too); size edits
 * route through `ResizeCommand` snapshots. Locked objects refuse restyles
 * (the `locked` contract, DECISIONS #42).
 */
import { useEffect, useState } from "react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { Selection } from "@/core/selection/Selection";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import { CompositeCommand } from "@/core/commands/CompositeCommand";
import { MoveCommand } from "@/core/commands/MoveCommand";
import { ResizeCommand } from "@/core/commands/ResizeCommand";
import {
  isImageObject,
  insertStateResetPatch,
  naturalResetPatch,
  ratioResetPatch,
} from "@/core/model/ImageObject";
import { RotateCommand } from "@/core/commands/RotateCommand";
import { withManualSizeMode } from "@/core/model/TextBoxObject";
import { togglePinSelection } from "@/core/commands/SelectionOps";
import { isPinnedObject, isPinnableObject } from "@/core/model/Pinned";
import type { Vec2 } from "@/core/geometry/Vec2";
import {
  planStylePatch,
  type StyleChanges,
} from "@/core/commands/StylePatches";
import { vec2 } from "@/core/geometry/Vec2";

/** A scene object narrowed to carry numeric width/height fields. */
type SizedObjectData = SceneObjectData & {
  readonly width: number;
  readonly height: number;
};

/**
 * @param object - the object to inspect.
 * @returns whether the object carries numeric `width`/`height` fields.
 */
function isSized(object: SceneObjectData): object is SizedObjectData {
  return (
    "width" in object &&
    "height" in object &&
    typeof object.width === "number" &&
    typeof object.height === "number"
  );
}

/** Live inspector snapshot consumed by the panel. */
export interface InspectorModel {
  /** Selected objects in paint order. */
  readonly objects: readonly SceneObjectData[];
  /** The single selected object, when exactly one is selected. */
  readonly single: SceneObjectData | null;
  /** Whether the model has booted (services resolved). */
  readonly ready: boolean;
  /**
   * Restyles every selected compatible object (locked objects and kinds the
   * changes do not apply to are skipped); one history entry per call.
   *
   * @param changes - the requested style changes.
   * @returns whether any object changed.
   */
  readonly applyStyle: (changes: StyleChanges) => boolean;
  /**
   * Moves the single selected object to an absolute world position.
   *
   * @param x - the target world x coordinate.
   * @param y - the target world y coordinate.
   * @returns whether the object moved.
   */
  readonly moveTo: (x: number, y: number) => boolean;
  /**
   * Resizes the single selected sized object (width/height in world units;
   * non-sized kinds are skipped).
   *
   * @param width - the target width.
   * @param height - the target height.
   * @returns whether the object resized.
   */
  readonly resizeTo: (width: number, height: number) => boolean;
  /**
   * Rotates the single selected object to an absolute angle (one undo
   * step, the snapshot-swap `RotateCommand`).
   *
   * @param degrees - the target angle in degrees.
   * @returns whether the object rotated.
   */
  readonly rotateTo: (degrees: number) => boolean;
  /**
   * Resets the single selected IMAGE to its intrinsic pixel size,
   * CENTRE preserved (Phase 23 — «بازنشانی به اندازهٔ اصلی»; one undo
   * step through the snapshot-swap `ResizeCommand`).
   *
   * @returns whether the object reset.
   */
  readonly resetImageToNatural: () => boolean;
  /**
   * Restores the single selected IMAGE to its «زمان صفر» snapshot — the
   * EXACT placed size/position/rotation at the instant it entered this
   * canvas (فاز ۳۴ — «بازنشانی به حالت درج»; legacy objects without a
   * snapshot degrade to the natural-size reset; one undo step through
   * the snapshot-swap `ResizeCommand`).
   *
   * @returns whether the object reset.
   */
  readonly resetImageToInsertState: () => boolean;
  /**
   * Restores the single selected IMAGE's aspect ratio from the intrinsic
   * ratio, keeping the CURRENT width (Phase 23 — «بازنشانی نسبت»).
   *
   * @returns whether the ratio reset.
   */
  readonly resetImageRatio: () => boolean;
  /**
   * Renames the single selected object (empty string clears the name).
   * One undo step; the name feeds the layers panel and the top-right
   * name badge of badge-qualified kinds.
   *
   * @param name - the new name (whitespace-trimmed; "" clears).
   * @returns whether the object was renamed.
   */
  readonly rename: (name: string) => boolean;
  /**
   * Toggles the selection's screen pin (فاز ۲۵ — «سنجاش روی صفحه»):
   * pins at the object's current on-screen spot, unpins by dropping the
   * world position under the anchor. One undo step.
   *
   * @returns whether any pin state changed.
   */
  readonly togglePin: () => boolean;
  /**
   * Moves the single PINNED selected object to an absolute screen anchor
   * (فاز ۲۵ — the 3×3 position grid). One undo step.
   *
   * @param anchor - the normalized viewport anchor (0..1 per axis).
   * @returns whether the anchor changed.
   */
  readonly setPinAnchor: (anchor: Vec2) => boolean;
  /**
   * Resizes the single PINNED selected object to absolute SCREEN
   * dimensions (فاز ۲۷ — the inspector's precise size row; the pinned
   * render is scale 1, so the values are on-screen pixels). The anchor
   * (top-left) stays fixed; an AUTO text box flips to FIXED (R3A.7). One
   * undo step through the snapshot-swap `ResizeCommand`.
   *
   * @param width - the new on-screen width in pixels.
   * @param height - the new on-screen height in pixels.
   * @returns whether the size changed.
   */
  readonly setPinnedSize: (width: number, height: number) => boolean;
  /**
   * Rotates the single PINNED selected object by a relative amount
   * (فاز ۳۰ — the inspector's quick-turn row). The footprint centre stays
   * fixed (the object spins in place on screen). One undo step through
   * the snapshot-swap `RotateCommand`.
   *
   * @param deltaDegrees - the rotation delta in degrees (e.g. ±90).
   * @returns whether the rotation changed.
   */
  readonly rotatePinnedBy: (deltaDegrees: number) => boolean;
}

/**
 * Subscribes to the scene and selection once the app booted and returns the
 * inspector model with command-backed actions. Before boot, an empty model is
 * returned.
 *
 * @returns the live {@link InspectorModel}.
 */
export function useInspectorModel(): InspectorModel {
  const [snapshot, setSnapshot] = useState<{
    objects: readonly SceneObjectData[];
    ready: boolean;
  }>({ objects: [], ready: false });

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
          objects: Array.from(selection.ids)
            .map((id) => scene.findById(id))
            .filter(
              (object): object is SceneObjectData => object !== undefined,
            ),
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

  const single =
    snapshot.objects.length === 1 ? (snapshot.objects[0] ?? null) : null;

  return {
    objects: snapshot.objects,
    single,
    ready: snapshot.ready,
    applyStyle: (changes) => {
      const scene = resolveScene();
      const history = resolveHistory();
      if (scene === null || history === null) {
        return false;
      }
      const commands: UpdateObjectCommand[] = [];
      for (const object of snapshot.objects) {
        if (object.locked) {
          continue;
        }
        const patch = planStylePatch(object, changes);
        if (patch === null) {
          continue;
        }
        const command = new UpdateObjectCommand(
          scene,
          object.id,
          patch,
          object,
        );
        command.do();
        commands.push(command);
      }
      if (commands.length === 0) {
        return false;
      }
      // One composite per user action: a single restyle click is one undo
      // entry regardless of how many objects changed.
      history.push(new CompositeCommand("command.restyleObjects", commands));
      return true;
    },
    moveTo: (x, y) => {
      const target = single;
      const scene = resolveScene();
      const history = resolveHistory();
      if (
        target === null ||
        scene === null ||
        history === null ||
        target.locked
      ) {
        return false;
      }
      const delta = vec2(x - target.position.x, y - target.position.y);
      if (delta.x === 0 && delta.y === 0) {
        return false;
      }
      const command = new MoveCommand(scene, [target.id], delta);
      command.do();
      history.push(command);
      return true;
    },
    resizeTo: (width, height) => {
      const target = single;
      const scene = resolveScene();
      const history = resolveHistory();
      if (
        target === null ||
        scene === null ||
        history === null ||
        target.locked ||
        !isSized(target)
      ) {
        return false;
      }
      const clampedWidth = Math.max(1, Math.round(width));
      const clampedHeight = Math.max(1, Math.round(height));
      if (clampedWidth === target.width && clampedHeight === target.height) {
        return false;
      }
      // A manual width change pins an AUTO text box to FIXED (R3A.7).
      const after = withManualSizeMode(target, {
        ...target,
        width: clampedWidth,
        height: clampedHeight,
      } as SizedObjectData);
      const command = new ResizeCommand(scene, target.id, target, after);
      command.do();
      history.push(command);
      return true;
    },
    rotateTo: (degrees) => {
      const target = single;
      const scene = resolveScene();
      const history = resolveHistory();
      if (
        target === null ||
        scene === null ||
        history === null ||
        target.locked
      ) {
        return false;
      }
      const radians = (degrees * Math.PI) / 180;
      if (radians === target.rotation) {
        return false;
      }
      const after: SceneObjectData = { ...target, rotation: radians };
      const command = new RotateCommand(scene, [target], [after]);
      command.do();
      history.push(command);
      return true;
    },
    // Phase 23: the image size/ratio resets (single-image selections).
    resetImageToNatural: () => {
      const target = single;
      const scene = resolveScene();
      const history = resolveHistory();
      if (
        target === null ||
        scene === null ||
        history === null ||
        target.locked ||
        !isImageObject(target)
      ) {
        return false;
      }
      const after = naturalResetPatch(target);
      if (after === null) {
        return false;
      }
      const command = new ResizeCommand(scene, target.id, target, after);
      command.do();
      history.push(command);
      return true;
    },
    // فاز ۳۴ «زمان صفر»: the insert-state reset (size+position+rotation
    // in ONE snapshot-swap command — undo restores the drift exactly).
    resetImageToInsertState: () => {
      const target = single;
      const scene = resolveScene();
      const history = resolveHistory();
      const bus = AppContext.getDefault().tryGet(Services.eventBus);
      if (
        target === null ||
        scene === null ||
        history === null ||
        target.locked ||
        !isImageObject(target)
      ) {
        return false;
      }
      const after = insertStateResetPatch(target);
      if (after === null) {
        return false;
      }
      const command = new ResizeCommand(scene, target.id, target, after);
      command.do();
      history.push(command);
      bus?.emit("ui:notice", {
        messageKey: "image.insertResetDoneNotice",
        severity: "info",
      });
      return true;
    },
    resetImageRatio: () => {
      const target = single;
      const scene = resolveScene();
      const history = resolveHistory();
      if (
        target === null ||
        scene === null ||
        history === null ||
        target.locked ||
        !isImageObject(target)
      ) {
        return false;
      }
      const after = ratioResetPatch(target);
      if (after === null) {
        return false;
      }
      const command = new ResizeCommand(scene, target.id, target, after);
      command.do();
      history.push(command);
      return true;
    },
    rename: (name) => {
      const target = single;
      const scene = resolveScene();
      const history = resolveHistory();
      if (target === null || scene === null || history === null) {
        return false;
      }
      const trimmed = name.trim();
      const next = trimmed === "" ? undefined : trimmed;
      if (next === target.name) {
        return false;
      }
      const command = new UpdateObjectCommand(
        scene,
        target.id,
        { name: next },
        target,
      );
      command.do();
      history.push(command);
      return true;
    },
    // فاز ۲۵ «سنجاش روی صفحه»: the inspector's pin actions.
    togglePin: () => {
      const scene = resolveScene();
      const history = resolveHistory();
      if (scene === null || history === null) {
        return false;
      }
      const selection = AppContext.getDefault().tryGet(Services.selection);
      if (selection === undefined) {
        return false;
      }
      const canvas =
        typeof document !== "undefined"
          ? document.querySelector("canvas")
          : null;
      const viewport =
        canvas !== null
          ? { width: canvas.clientWidth, height: canvas.clientHeight }
          : { width: 0, height: 0 };
      if (viewport.width <= 0 || viewport.height <= 0) {
        return false;
      }
      return togglePinSelection(scene, history, selection, viewport);
    },
    setPinAnchor: (anchor) => {
      const target = single;
      const scene = resolveScene();
      const history = resolveHistory();
      if (
        target === null ||
        scene === null ||
        history === null ||
        target.locked ||
        !isPinnableObject(target) ||
        !isPinnedObject(target)
      ) {
        return false;
      }
      const current = target.pinAnchor;
      if (
        current !== undefined &&
        current.x === anchor.x &&
        current.y === anchor.y
      ) {
        return false;
      }
      const command = new UpdateObjectCommand(
        scene,
        target.id,
        { pinAnchor: anchor },
        target,
      );
      command.do();
      history.push(command);
      return true;
    },
    setPinnedSize: (width, height) => {
      const target = single;
      const scene = resolveScene();
      const history = resolveHistory();
      const sized =
        target !== null &&
        typeof (target as { readonly width?: unknown }).width === "number" &&
        typeof (target as { readonly height?: unknown }).height === "number"
          ? (target as SceneObjectData & {
              readonly width: number;
              readonly height: number;
            })
          : null;
      if (
        sized === null ||
        scene === null ||
        history === null ||
        target === null ||
        target.locked ||
        !isPinnableObject(target) ||
        !isPinnedObject(target) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        return false;
      }
      const clampedWidth = Math.max(8, Math.round(width));
      const clampedHeight = Math.max(8, Math.round(height));
      if (
        clampedWidth === sized.width &&
        clampedHeight === sized.height
      ) {
        return false;
      }
      // A manual width change pins an AUTO text box to FIXED (R3A.7).
      const after = withManualSizeMode(
        sized,
        sized.kind === "textBox" && clampedWidth !== sized.width
          ? { ...sized, width: clampedWidth, height: clampedHeight, sizeMode: "fixed" }
          : { ...sized, width: clampedWidth, height: clampedHeight },
      );
      const command = new ResizeCommand(scene, target.id, sized, after);
      command.do();
      history.push(command);
      return true;
    },
    // فاز ۳۰ «چرخش سنجاق‌شده»: the inspector's quick-turn action.
    rotatePinnedBy: (deltaDegrees) => {
      const target = single;
      const scene = resolveScene();
      const history = resolveHistory();
      if (
        target === null ||
        scene === null ||
        history === null ||
        target.locked ||
        !isPinnableObject(target) ||
        !isPinnedObject(target) ||
        !Number.isFinite(deltaDegrees) ||
        deltaDegrees === 0
      ) {
        return false;
      }
      const radians = (deltaDegrees * Math.PI) / 180;
      const after: SceneObjectData = {
        ...target,
        rotation: target.rotation + radians,
      };
      const command = new RotateCommand(scene, [target], [after]);
      command.do();
      history.push(command);
      return true;
    },
  };
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
