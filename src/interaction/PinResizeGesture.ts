/**
 * Pinned resize gesture (فاز ۲۷ — «تغییر اندازهٔ سنجاق‌شده»): the state
 * machine behind handle-drag resizing of a PINNED object, in SCREEN space.
 *
 * The eight handles ride the pinned object's screen footprint (constant
 * size at any zoom — the pinned render is scale 1, so the stored
 * width/height ARE the on-screen pixels). One drag changes THREE stored
 * fields per frame — width, height and the top-left pinAnchor — while the
 * corner/edge OPPOSITE the grabbed handle stays exactly fixed (the shared
 * `resizeRectFromHandle` box math, anchored at the untouched edges).
 * Rotated objects resize in their LOCAL frame (the pointer un-rotates
 * around the footprint centre — the `ResizeGesture` precedent, mirrored in
 * screen space). Live frames apply immutable replacements directly; the
 * finished `ResizeCommand` swaps absolute snapshots, so pushing it after
 * the live frames is exact and idempotent — one gesture = one undo entry.
 * `cancel()` restores the before snapshot without touching history (the
 * Escape contract, DECISIONS #30). A manual width change pins an AUTO text
 * box to FIXED (R3A.7) at commit time.
 *
 * Emits `resize:live` / `resize:ended` so the status bar shows the live
 * dimensions chip while the gesture runs (screen pixels).
 */
import type { ToolCursor, ToolPointerEvent } from "@/interaction/Tool";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { isShapeObject } from "@/core/model/ShapeObject";
import { isImageObject } from "@/core/model/ImageObject";
import { isVideoObject } from "@/core/model/VideoObject";
import { isAudioObject } from "@/core/model/AudioObject";
import { withManualSizeMode } from "@/core/model/TextBoxObject";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import { ResizeCommand } from "@/core/commands/ResizeCommand";
import type { HandlesRenderer } from "@/rendering/HandlesRenderer";
import { RESIZE_HANDLE_CURSOR } from "@/interaction/ResizeGesture";
import type { ResizeHandleId } from "@/core/geometry/resize";
import {
  hitPinnedResizeHandle,
  isPinnedObject,
  pinnedResizeFrame,
  type ViewportSize,
} from "@/core/model/Pinned";

/** Minimum visible size kept on each axis, in screen pixels. */
export const MIN_PINNED_RESIZE_PX = 8;

/** Dependencies of the pinned resize gesture (constructor injection). */
export interface PinResizeGestureDeps {
  /** Scene whose object resizes. */
  readonly scene: Scene;
  /** History recording the finished gesture. */
  readonly history: HistoryManager;
  /** Bus carrying the live-dimension events. */
  readonly bus: EventBus<AppEventMap>;
  /** Handles renderer carrying the active-handle highlight. */
  readonly handles: HandlesRenderer;
  /** The viewport size (the pin coordinate space). */
  readonly getViewport: () => ViewportSize;
}

/**
 * The pinned resize gesture state machine. Exactly one gesture runs at a
 * time; `begin()` on an active gesture restarts it.
 */
export class PinResizeGesture {
  /** Id of the object being resized, or null while idle. */
  private objectId: string | null = null;

  /** Handle being dragged. */
  private handle: ResizeHandleId | null = null;

  /** Object snapshot captured at gesture start (restore source). */
  private beforeObject: SceneObjectData | null = null;

  /** Whether any live frame actually changed the object. */
  private changed = false;

  /** Minimum size for the resized object (stroke-aware), screen pixels. */
  private minPx = MIN_PINNED_RESIZE_PX;

  /** Whether the object's aspect ratio is locked WITHOUT Shift (images —
   *  AC5.2 — and Shift UNlocks them, the `ResizeGesture` contract). */
  private aspectLockedByDefault = false;

  /** Last applied frame (the `resize:ended` readout), or null. */
  private lastFrame: { readonly width: number; readonly height: number } | null =
    null;

  /**
   * @param deps - injected gesture dependencies.
   */
  public constructor(private readonly deps: PinResizeGestureDeps) {}

  /** @returns whether a pinned resize gesture is in progress. */
  public get active(): boolean {
    return this.handle !== null;
  }

  /** @returns the cursor hint of the dragged handle, or null while idle. */
  public get cursorHint(): ToolCursor | null {
    return this.handle === null ? null : RESIZE_HANDLE_CURSOR[this.handle];
  }

  /**
   * Probes whether a pointer event grabs a resize handle of a PINNED
   * object's screen footprint.
   *
   * @param object - the single selected pinned object offering handles.
   * @param event - the pointer event to test.
   * @returns the grabbed handle id, or null.
   */
  public probe(
    object: SceneObjectData,
    event: ToolPointerEvent,
  ): ResizeHandleId | null {
    if (object.locked || !isPinnedObject(object)) {
      return null;
    }
    const width = (object as { readonly width?: unknown }).width;
    const height = (object as { readonly height?: unknown }).height;
    if (typeof width !== "number" || typeof height !== "number") {
      return null;
    }
    const viewport = this.deps.getViewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return null;
    }
    return hitPinnedResizeHandle(
      object as SceneObjectData & {
        readonly width: number;
        readonly height: number;
      },
      event.screen,
      viewport,
    );
  }

  /**
   * Starts resizing a pinned object from one of its screen-space handles.
   *
   * @param object - the pinned object being resized.
   * @param handle - the handle the drag grabbed.
   */
  public begin(object: SceneObjectData, handle: ResizeHandleId): void {
    this.objectId = object.id;
    this.handle = handle;
    this.beforeObject = object;
    this.changed = false;
    this.lastFrame = null;
    const stroke = isShapeObject(object) ? object.strokeWidth : 0;
    this.minPx = MIN_PINNED_RESIZE_PX + stroke;
    // فاز M1 (A.2.7): videos lock their aspect by default exactly like
    // images (Shift frees it). فاز A1: audio chips lock too (A.2.7).
    this.aspectLockedByDefault =
      isImageObject(object) || isVideoObject(object) || isAudioObject(object);
    this.deps.handles.setActiveHandle(handle);
  }

  /**
   * Applies one live frame: the object's on-screen footprint follows the
   * pointer (the opposite corner/edge fixed), and the object is replaced
   * immutably in the scene.
   *
   * @param event - the latest normalised pointer payload.
   */
  public moveTo(event: ToolPointerEvent): void {
    const id = this.objectId;
    const before = this.beforeObject;
    const handle = this.handle;
    if (id === null || before === null || handle === null) {
      return;
    }
    const current = this.deps.scene.findById(id);
    if (current === undefined || !isPinnedObject(current)) {
      this.end();
      return;
    }
    const width = (current as { readonly width?: unknown }).width;
    const height = (current as { readonly height?: unknown }).height;
    if (typeof width !== "number" || typeof height !== "number") {
      return;
    }
    const viewport = this.deps.getViewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }
    // AC5.2: images lock their aspect by DEFAULT (Shift frees it); every
    // other kind keeps the generic Shift-to-lock contract.
    const keepAspect = this.aspectLockedByDefault
      ? !event.shiftKey
      : event.shiftKey;
    const frame = pinnedResizeFrame(
      current as SceneObjectData & {
        readonly width: number;
        readonly height: number;
      },
      handle,
      event.screen,
      viewport,
      this.minPx,
      keepAspect,
    );
    if (frame === null) {
      return;
    }
    this.deps.scene.add({
      ...current,
      width: frame.width,
      height: frame.height,
      pinAnchor: frame.pinAnchor,
    } as typeof current);
    if (frame.width !== width || frame.height !== height) {
      this.changed = true;
    }
    this.lastFrame = { width: frame.width, height: frame.height };
    this.deps.bus.emit("resize:live", {
      width: Math.round(frame.width),
      height: Math.round(frame.height),
    });
  }

  /**
   * Commits the gesture: the live-applied final state enters history as one
   * `ResizeCommand` (snapshot swap, applied by the frames — idempotent).
   */
  public commit(): void {
    const id = this.objectId;
    const before = this.beforeObject;
    if (id === null || before === null) {
      this.end();
      return;
    }
    const afterObject = this.deps.scene.findById(id);
    if (afterObject !== undefined && this.changed) {
      // A manual width change pins an AUTO text box to FIXED (R3A.7) —
      // apply the conversion live so the pushed command snapshots it.
      const after = withManualSizeMode(before, afterObject);
      if (after !== afterObject) {
        this.deps.scene.add(after);
      }
      const command = new ResizeCommand(this.deps.scene, id, before, after);
      this.deps.history.push(command);
    }
    this.end();
  }

  /**
   * Drops the gesture without touching history, restoring the object to
   * its pre-gesture snapshot (the Escape contract).
   */
  public cancel(): void {
    const id = this.objectId;
    const before = this.beforeObject;
    if (id !== null && before !== null && this.changed) {
      if (this.deps.scene.findById(id) !== undefined) {
        this.deps.scene.add(before);
      }
    }
    this.end();
  }

  /**
   * Clears the gesture state and emits the ended event.
   */
  private end(): void {
    this.deps.handles.setActiveHandle(null);
    if (this.lastFrame !== null) {
      this.deps.bus.emit("resize:ended", {
        width: Math.round(this.lastFrame.width),
        height: Math.round(this.lastFrame.height),
      });
    }
    this.objectId = null;
    this.handle = null;
    this.beforeObject = null;
    this.changed = false;
    this.lastFrame = null;
    this.minPx = MIN_PINNED_RESIZE_PX;
  }
}
