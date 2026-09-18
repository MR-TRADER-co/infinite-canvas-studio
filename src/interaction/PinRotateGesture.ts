/**
 * Pinned rotation gesture (فاز ۳۰ — «چرخش سنجاق‌شده»): the state machine
 * behind the rotation-handle drag of a PINNED object, in SCREEN space.
 *
 * The grip rides above the (rotated) top edge centre of the pinned
 * footprint — a constant screen offset along the object's own "up"
 * direction, so the affordance hugs the object at any tilt. One drag
 * changes ONE stored field — `rotation` — around the footprint CENTRE
 * (invariant: the anchor and size stay fixed), so the object spins in
 * place on screen exactly like a world rotation pivots around the bounds
 * centre. Live frames apply immutable replacements directly; the finished
 * `RotateCommand` swaps absolute snapshots, so pushing it after the live
 * frames is exact and idempotent — one gesture = one undo entry.
 * `cancel()` restores the before snapshot without touching history (the
 * Escape contract, DECISIONS #30).
 *
 * Shift snaps the delta to 15° steps (the world `RotateGesture`
 * contract). Emits `rotate:live` / `rotate:ended` so the status bar shows
 * the live angle chip while the gesture runs.
 */
import type { ToolCursor, ToolPointerEvent } from "@/interaction/Tool";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { Vec2 } from "@/core/geometry/Vec2";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import { RotateCommand } from "@/core/commands/RotateCommand";
import { ROTATION_SNAP_RAD } from "@/core/geometry/resize";
import type { HandlesRenderer } from "@/rendering/HandlesRenderer";
import {
  hitPinnedRotateHandle,
  isPinnedObject,
  pinnedFootprintCentre,
  pinnedRotationDelta,
  type ViewportSize,
} from "@/core/model/Pinned";

/** Idle frame discriminator (angle of "no rotation yet"). */
const NO_DELTA = 0;

/** Dependencies of the pinned rotation gesture (constructor injection). */
export interface PinRotateGestureDeps {
  /** Scene whose object rotates. */
  readonly scene: Scene;
  /** History recording the finished gesture. */
  readonly history: HistoryManager;
  /** Bus carrying the live-angle events. */
  readonly bus: EventBus<AppEventMap>;
  /** Handles renderer carrying the rotating-grip highlight. */
  readonly handles: HandlesRenderer;
  /** The viewport size (the pin coordinate space). */
  readonly getViewport: () => ViewportSize;
}

/**
 * The pinned rotation gesture state machine. Exactly one gesture runs at
 * a time; `begin()` on an active gesture restarts it.
 */
export class PinRotateGesture {
  /** Id of the object being rotated, or null while idle. */
  private objectId: string | null = null;

  /** Object snapshot captured at gesture start (restore source). */
  private beforeObject: SceneObjectData | null = null;

  /** Screen-space footprint centre (the invariant rotation pivot). */
  private centre: Vec2 | null = null;

  /** Screen-space pointer position where the gesture began. */
  private startPointer: Vec2 | null = null;

  /** Rotation delta of the latest applied frame (radians). */
  private delta = NO_DELTA;

  /** Whether any live frame actually changed the object. */
  private changed = false;

  /**
   * @param deps - injected gesture dependencies.
   */
  public constructor(private readonly deps: PinRotateGestureDeps) {}

  /** @returns whether a pinned rotation gesture is in progress. */
  public get active(): boolean {
    return this.objectId !== null;
  }

  /** @returns the cursor hint while rotating. */
  public get cursorHint(): ToolCursor | null {
    return this.active ? "grabbing" : null;
  }

  /**
   * Probes whether a pointer event grabs the rotation handle of a PINNED
   * object's screen footprint (فاز ۳۰).
   *
   * @param object - the single selected pinned object offering the grip.
   * @param event - the pointer event to test.
   * @returns whether the grip is grabbed.
   */
  public probe(object: SceneObjectData, event: ToolPointerEvent): boolean {
    if (object.locked || !isPinnedObject(object)) {
      return false;
    }
    const viewport = this.deps.getViewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return false;
    }
    return hitPinnedRotateHandle(object, event.screen, viewport);
  }

  /**
   * Starts rotating a pinned object around its footprint centre.
   *
   * @param object - the pinned object being rotated.
   * @param startPointer - the pointer position (screen px) at press.
   */
  public begin(object: SceneObjectData, startPointer: Vec2): void {
    this.objectId = object.id;
    this.beforeObject = object;
    const viewport = this.deps.getViewport();
    const width = (object as { readonly width?: unknown }).width;
    const height = (object as { readonly height?: unknown }).height;
    this.centre =
      typeof width === "number" && typeof height === "number"
        ? pinnedFootprintCentre(
            object as SceneObjectData & {
              readonly width: number;
              readonly height: number;
            },
            viewport,
          )
        : null;
    this.startPointer = startPointer;
    this.delta = NO_DELTA;
    this.changed = false;
    this.deps.handles.setRotating(true);
  }

  /**
   * Applies one live frame: the pointer angle around the footprint centre
   * since the gesture start becomes the rotation delta (snapped to 15°
   * with Shift) on top of the before rotation, and the object is replaced
   * immutably in the scene.
   *
   * @param event - the latest normalised pointer payload.
   */
  public moveTo(event: ToolPointerEvent): void {
    const id = this.objectId;
    const before = this.beforeObject;
    const centre = this.centre;
    const start = this.startPointer;
    if (id === null || before === null || centre === null || start === null) {
      return;
    }
    const current = this.deps.scene.findById(id);
    if (current === undefined || !isPinnedObject(current)) {
      this.end();
      return;
    }
    const delta = pinnedRotationDelta(
      centre,
      start,
      event.screen,
      event.shiftKey ? ROTATION_SNAP_RAD : null,
    );
    const rotation = before.rotation + delta;
    if (rotation !== current.rotation) {
      this.deps.scene.add({ ...current, rotation } as typeof current);
      this.changed = rotation !== before.rotation;
    }
    this.delta = delta;
    this.deps.bus.emit("rotate:live", { angle: roundDegrees(delta) });
  }

  /**
   * Commits the gesture: the live-applied final state enters history as one
   * `RotateCommand` (snapshot swap, applied by the frames — idempotent).
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
      const command = new RotateCommand(
        this.deps.scene,
        [before],
        [afterObject],
      );
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
    this.deps.bus.emit("rotate:ended", { angle: roundDegrees(this.delta) });
    this.deps.handles.setRotating(false);
    this.objectId = null;
    this.beforeObject = null;
    this.centre = null;
    this.startPointer = null;
    this.delta = NO_DELTA;
    this.changed = false;
  }
}

/**
 * Converts a radian delta to rounded degrees for the status readout.
 *
 * @param radians - the rotation delta.
 * @returns the delta in whole degrees.
 */
function roundDegrees(radians: number): number {
  return Math.round((radians * 180) / Math.PI);
}
