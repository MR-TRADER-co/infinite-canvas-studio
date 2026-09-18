/**
 * Resize gesture: the state machine behind handle-drag resizing.
 *
 * Owns one in-progress resize of a single object: the gesture-start bounds
 * and object snapshot, the per-frame rectangle math (min-size clamping,
 * Shift aspect lock), live scene application, and the single history entry
 * recorded on commit. Rotated objects resize in their LOCAL frame: the
 * pointer is un-rotated around the object centre, the rectangle math runs
 * on the unrotated box, and the resulting centre displacement rotates back
 * into world space — so a tilted rectangle's edges stay tilted while its
 * handles follow the pointer. Live frames apply `resizeSceneObject` (or the
 * local-frame equivalent) directly (immutable replacement — paint order
 * preserved); the finished `ResizeCommand` swaps absolute snapshots, so
 * pushing it after the live frames is exact and idempotent. `cancel()`
 * restores the before snapshot without touching history (the Escape
 * contract, DECISIONS #30).
 *
 * Emits `resize:live` / `resize:ended` so the status bar can show the
 * live dimensions chip while the gesture runs.
 */
import type { ToolCursor, ToolPointerEvent } from "@/interaction/Tool";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import {
  objectBBox,
  resizeSceneObject,
  worldToLocalFrame,
} from "@/core/model/SceneObject";
import { isFreehandObject } from "@/core/model/FreehandObject";
import { isShapeObject } from "@/core/model/ShapeObject";
import { isImageObject } from "@/core/model/ImageObject";
import { isVideoObject } from "@/core/model/VideoObject";
import { isAudioObject } from "@/core/model/AudioObject";
import { snapResizeRect, type SnapConfig } from "@/interaction/SnapEngine";
import { withManualSizeMode } from "@/core/model/TextBoxObject";
import type { BBox } from "@/core/geometry/BBox";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import { ResizeCommand } from "@/core/commands/ResizeCommand";
import type { HandlesRenderer } from "@/rendering/HandlesRenderer";
import {
  hitResizeHandle,
  resizeRectFromHandle,
  type ResizeHandleId,
} from "@/core/geometry/resize";
import { vec2 } from "@/core/geometry/Vec2";

/** Dependencies of the resize gesture (constructor injection). */
export interface ResizeGestureDeps {
  /** Scene whose object resizes. */
  readonly scene: Scene;
  /** History recording the finished gesture. */
  readonly history: HistoryManager;
  /** Bus carrying the live-dimension events. */
  readonly bus: EventBus<AppEventMap>;
  /** Handles renderer carrying the active-handle highlight. */
  readonly handles: HandlesRenderer;
  /** Optional snap configuration (R5.5 — dragged edges snap to the grid). */
  readonly getSnapConfig?: () => SnapConfig;
}

/** Cursor hint each resize handle requests while hovered or dragged. */
export const RESIZE_HANDLE_CURSOR: { [K in ResizeHandleId]: ToolCursor } = {
  nw: "nwseResize",
  ne: "neswResize",
  se: "nwseResize",
  sw: "neswResize",
  n: "nsResize",
  e: "ewResize",
  s: "nsResize",
  w: "ewResize",
};

/** Screen-pixel tolerance for grabbing a handle (8px handle + slack). */
const HANDLE_HIT_TOLERANCE_PX = 10;

/** Minimum visible size kept on each axis, in world units (plus stroke). */
const MIN_RESIZE_WORLD = 2;

/**
 * The resize gesture state machine. Exactly one gesture runs at a time;
 * `begin()` on an active gesture restarts it.
 */
export class ResizeGesture {
  /** Id of the object being resized, or null while idle. */
  private objectId: string | null = null;

  /** Handle being dragged. */
  private handle: ResizeHandleId | null = null;

  /** Object snapshot captured at gesture start (restore source). */
  private beforeObject: SceneObjectData | null = null;

  /** Padded bounds at gesture start. */
  private before: BBox | null = null;

  /** Latest applied rectangle (null until the first frame). */
  private current: BBox | null = null;

  /** Minimum box size for the resized object (stroke-aware). */
  private minSize = MIN_RESIZE_WORLD;

  /** Whether the object's aspect ratio is locked WITHOUT Shift (R5.5:
   *  images lock by default — AC5.2 — and Shift UNlocks them, mirroring
   *  the generic Shift-to-lock contract inverted). */
  private aspectLockedByDefault = false;

  /**
   * @param deps - injected gesture dependencies.
   */
  public constructor(private readonly deps: ResizeGestureDeps) {}

  /** @returns whether a resize gesture is in progress. */
  public get active(): boolean {
    return this.handle !== null;
  }

  /** @returns the cursor hint of the dragged handle, or null while idle. */
  public get cursorHint(): ToolCursor | null {
    return this.handle === null ? null : RESIZE_HANDLE_CURSOR[this.handle];
  }

  /**
   * Probes whether a pointer event grabs a resize handle of an object.
   *
   * @param object - the single selected object offering handles.
   * @param event - the pointer event to test.
   * @returns the grabbed handle id, or null.
   */
  public probe(
    object: SceneObjectData,
    event: ToolPointerEvent,
  ): ResizeHandleId | null {
    if (object.locked) {
      return null;
    }
    return hitResizeHandle(
      event.screen,
      objectBBox(object),
      this.deps.scene.camera,
      HANDLE_HIT_TOLERANCE_PX,
      object.rotation,
    );
  }

  /**
   * Starts resizing an object from one of its handles.
   *
   * @param object - the object being resized.
   * @param handle - the handle the drag grabbed.
   */
  public begin(object: SceneObjectData, handle: ResizeHandleId): void {
    this.objectId = object.id;
    this.handle = handle;
    this.beforeObject = object;
    this.before = objectBBox(object);
    this.current = null;
    const stroke =
      isShapeObject(object) || isFreehandObject(object)
        ? object.strokeWidth
        : 0;
    this.minSize = MIN_RESIZE_WORLD + stroke;
    // فاز M1 (A.2.7): videos lock their aspect by default exactly like
    // images (Shift frees it). فاز A1: audio chips lock too — the SAME
    // rule as image/video (A.2.7 "aspect-locked by default").
    this.aspectLockedByDefault =
      isImageObject(object) || isVideoObject(object) || isAudioObject(object);
    this.deps.handles.setActiveHandle(handle);
  }

  /**
   * Applies one live frame: the new rectangle follows the pointer, and the
   * object is replaced immutably in the scene.
   *
   * @param event - the latest normalised pointer payload.
   */
  public moveTo(event: ToolPointerEvent): void {
    const id = this.objectId;
    const before = this.before;
    const handle = this.handle;
    if (id === null || before === null || handle === null) {
      return;
    }
    const object = this.deps.scene.findById(id);
    if (object === undefined) {
      this.end(null);
      return;
    }
    // R5.5/AC5.2: images lock their aspect by DEFAULT (Shift frees it);
    // every other kind keeps the generic Shift-to-lock contract.
    const keepAspect = this.aspectLockedByDefault
      ? !event.shiftKey
      : event.shiftKey;
    const rotated = object.rotation !== 0 && hasSize(object);
    const rawRect = rotated
      ? this.rotatedLocalRect(object, event, keepAspect)
      : resizeRectFromHandle(
          before,
          handle,
          event.world,
          this.minSize,
          keepAspect,
        );
    if (rawRect === null) {
      return;
    }
    // R5.5: snap the DRAGGED edges to the grid — but only for unrotated
    // frames (a rotated object's world edges are not its visual edges) and
    // only while Shift is NOT held (the aspect lock wins over the grid —
    // DECISIONS D-5.5).
    const snap =
      !rotated && !event.shiftKey ? this.deps.getSnapConfig?.() : undefined;
    const rect =
      snap !== undefined && snap.enabled
        ? snapResizeRect(rawRect, handle, this.minSize, snap.spacing)
        : rawRect;
    this.deps.scene.add(
      rotated && hasSize(object)
        ? this.applyLocalRect(object, rect)
        : resizeSceneObject(object, objectBBox(object), rect),
    );
    this.current = rect;
    this.deps.bus.emit("resize:live", {
      width: Math.round(rect.maxX - rect.minX),
      height: Math.round(rect.maxY - rect.minY),
    });
  }

  /**
   * Computes the LOCAL-frame rectangle of one rotated resize frame: the
   * pointer enters the object's unrotated coordinate frame before the
   * handle rectangle math runs.
   *
   * @param object - the rotated object being resized.
   * @param event - the latest normalised pointer payload.
   * @returns the local-frame rectangle, or null while the gesture is idle.
   */
  private rotatedLocalRect(
    object: SceneObjectData & {
      readonly width: number;
      readonly height: number;
    },
    event: ToolPointerEvent,
    keepAspect: boolean,
  ): BBox | null {
    const before = this.before;
    const handle = this.handle;
    if (before === null || handle === null) {
      return null;
    }
    const localPointer = worldToLocalFrame(object, event.world);
    return resizeRectFromHandle(
      before,
      handle,
      localPointer,
      this.minSize,
      keepAspect,
    );
  }

  /**
   * Maps a local-frame rectangle back onto the rotated object: the local
   * centre displacement rotates into world space and the unrotated
   * position/size derive from the stroke-inset rectangle.
   *
   * @param object - the rotated object being resized.
   * @param rect - the local-frame (padded) rectangle after this frame.
   * @returns the resized object data.
   */
  private applyLocalRect(
    object: SceneObjectData & {
      readonly width: number;
      readonly height: number;
    },
    rect: BBox,
  ): SceneObjectData & { readonly width: number; readonly height: number } {
    const before = this.before;
    if (before === null) {
      return object;
    }
    const beforeCenter = vec2(
      (before.minX + before.maxX) / 2,
      (before.minY + before.maxY) / 2,
    );
    const rectCenter = vec2(
      (rect.minX + rect.maxX) / 2,
      (rect.minY + rect.maxY) / 2,
    );
    const displacement = vec2(
      rectCenter.x - beforeCenter.x,
      rectCenter.y - beforeCenter.y,
    );
    const cos = Math.cos(object.rotation);
    const sin = Math.sin(object.rotation);
    const worldDisplacement = vec2(
      displacement.x * cos - displacement.y * sin,
      displacement.x * sin + displacement.y * cos,
    );
    const pad = isShapeObject(object) ? object.strokeWidth / 2 : 0;
    const width = Math.max(0, rect.maxX - rect.minX - pad * 2);
    const height = Math.max(0, rect.maxY - rect.minY - pad * 2);
    const center = vec2(
      beforeCenter.x + worldDisplacement.x,
      beforeCenter.y + worldDisplacement.y,
    );
    return {
      ...object,
      position: vec2(center.x - width / 2, center.y - height / 2),
      width,
      height,
    };
  }

  /**
   * Commits the gesture: the live-applied final state enters history as one
   * `ResizeCommand` (snapshot swap, `do()` already applied by the frames).
   */
  public commit(): void {
    const id = this.objectId;
    const before = this.before;
    if (id === null || before === null || this.beforeObject === null) {
      this.end(null);
      return;
    }
    const afterObject = this.deps.scene.findById(id);
    if (
      afterObject !== undefined &&
      this.current !== null &&
      !sameBox(this.current, before)
    ) {
      // A manual width change pins an AUTO text box to FIXED (R3A.7) —
      // apply the conversion live so the pushed command snapshots it.
      const after = withManualSizeMode(this.beforeObject, afterObject);
      if (after !== afterObject) {
        this.deps.scene.add(after);
      }
      const command = new ResizeCommand(
        this.deps.scene,
        id,
        this.beforeObject,
        after,
      );
      this.deps.history.push(command);
    }
    this.end(this.current);
  }

  /**
   * Drops the gesture without touching history, restoring the object to
   * its pre-gesture snapshot (the Escape contract).
   */
  public cancel(): void {
    const id = this.objectId;
    const before = this.before;
    if (id !== null && this.beforeObject !== null && before !== null) {
      const object = this.deps.scene.findById(id);
      if (
        object !== undefined &&
        this.current !== null &&
        !sameBox(this.current, before)
      ) {
        this.deps.scene.add(this.beforeObject);
      }
    }
    this.end(before);
  }

  /**
   * Clears the gesture state and emits the ended event.
   *
   * @param finalRect - the final rectangle for the readout, or null.
   */
  private end(finalRect: BBox | null): void {
    this.deps.handles.setActiveHandle(null);
    if (finalRect !== null) {
      this.deps.bus.emit("resize:ended", {
        width: Math.round(finalRect.maxX - finalRect.minX),
        height: Math.round(finalRect.maxY - finalRect.minY),
      });
    }
    this.objectId = null;
    this.handle = null;
    this.beforeObject = null;
    this.before = null;
    this.current = null;
    this.minSize = MIN_RESIZE_WORLD;
  }
}

/**
 * @param a - first box.
 * @param b - second box.
 * @returns whether the boxes share all four edges.
 */
function sameBox(a: BBox, b: BBox): boolean {
  return (
    a.minX === b.minX &&
    a.minY === b.minY &&
    a.maxX === b.maxX &&
    a.maxY === b.maxY
  );
}

/**
 * @param object - the object to inspect.
 * @returns whether the object carries numeric `width`/`height` fields.
 */
function hasSize(object: SceneObjectData): object is SceneObjectData & {
  readonly width: number;
  readonly height: number;
} {
  return (
    "width" in object &&
    "height" in object &&
    typeof object.width === "number" &&
    typeof object.height === "number"
  );
}
