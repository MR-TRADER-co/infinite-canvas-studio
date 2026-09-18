/**
 * Rotation gesture: the state machine behind the rotation-handle drag.
 *
 * Owns one in-progress rotation of a set of objects (a single object, a
 * group with its members, or a whole multi-selection) around a shared world
 * pivot. Live frames are recomputed from the BEFORE snapshots every time
 * (`rotateObjectsAround` is pure), so long gestures never drift; the
 * finished {@link RotateCommand} swaps absolute snapshots, so pushing it
 * after the live frames is exact and idempotent. `cancel()` restores the
 * before snapshots without touching history (the Escape contract,
 * DECISIONS #30).
 *
 * Shift snaps the rotation delta to 15° steps. Emits `rotate:live` /
 * `rotate:ended` so the status bar can show the live angle chip.
 */
import type { ToolCursor, ToolPointerEvent } from "@/interaction/Tool";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { rotateObjectsAround } from "@/core/model/GroupObject";
import type { Vec2 } from "@/core/geometry/Vec2";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import { RotateCommand } from "@/core/commands/RotateCommand";
import { ROTATION_SNAP_RAD } from "@/core/geometry/resize";
import type { HandlesRenderer } from "@/rendering/HandlesRenderer";

/** Dependencies of the rotation gesture (constructor injection). */
export interface RotateGestureDeps {
  /** Scene whose objects rotate. */
  readonly scene: Scene;
  /** History recording the finished gesture. */
  readonly history: HistoryManager;
  /** Bus carrying the live-angle events. */
  readonly bus: EventBus<AppEventMap>;
  /** Handles renderer carrying the active-handle highlight. */
  readonly handles: HandlesRenderer;
}

/** Idle frame discriminator (angle of "no rotation yet"). */
const NO_DELTA = 0;

/**
 * The rotation gesture state machine. Exactly one gesture runs at a time;
 * `begin()` on an active gesture restarts it.
 */
export class RotateGesture {
  /** Object snapshots captured at gesture start (restore source). */
  private before: SceneObjectData[] | null = null;

  /** World-space pivot shared by every rotated object. */
  private pivot: Vec2 | null = null;

  /** World-space pointer position where the gesture began. */
  private startPointer: Vec2 | null = null;

  /** Rotation delta of the latest applied frame (radians). */
  private delta = NO_DELTA;

  /**
   * @param deps - injected gesture dependencies.
   */
  public constructor(private readonly deps: RotateGestureDeps) {}

  /** @returns whether a rotation gesture is in progress. */
  public get active(): boolean {
    return this.before !== null;
  }

  /** @returns the cursor hint while rotating. */
  public get cursorHint(): ToolCursor | null {
    return this.active ? "grabbing" : null;
  }

  /**
   * Starts rotating a set of objects around a pivot.
   *
   * @param objects - the snapshot objects being rotated (for a group:
   *   `[group, ...members]`; for a multi-selection: every top-level object
   *   plus group members).
   * @param pivot - the world-space pivot (bounds centre of the set).
   * @param startPointer - the world-space pointer position at press.
   */
  public begin(
    objects: readonly SceneObjectData[],
    pivot: Vec2,
    startPointer: Vec2,
  ): void {
    this.before = [...objects];
    this.pivot = pivot;
    this.startPointer = startPointer;
    this.delta = NO_DELTA;
    this.deps.handles.setRotating(true);
  }

  /**
   * Applies one live frame: the pointer angle around the pivot since the
   * gesture start becomes the rotation delta (snapped to 15° with Shift),
   * and every object is re-derived from its before snapshot.
   *
   * @param event - the latest normalised pointer payload.
   */
  public moveTo(event: ToolPointerEvent): void {
    const before = this.before;
    const pivot = this.pivot;
    const start = this.startPointer;
    if (before === null || pivot === null || start === null) {
      return;
    }
    let delta =
      Math.atan2(event.world.y - pivot.y, event.world.x - pivot.x) -
      Math.atan2(start.y - pivot.y, start.x - pivot.x);
    if (event.shiftKey) {
      delta = Math.round(delta / ROTATION_SNAP_RAD) * ROTATION_SNAP_RAD;
    }
    for (const object of rotateObjectsAround(before, pivot, delta)) {
      this.deps.scene.add(object);
    }
    this.delta = delta;
    this.deps.bus.emit("rotate:live", { angle: roundDegrees(delta) });
  }

  /**
   * Commits the gesture: the live-applied final state enters history as one
   * `RotateCommand` (snapshot swap, `do()` already applied by the frames).
   */
  public commit(): void {
    const before = this.before;
    if (before === null) {
      this.end();
      return;
    }
    const after = before
      .map((object) => this.deps.scene.findById(object.id))
      .filter((object): object is SceneObjectData => object !== undefined);
    if (after.length === before.length && this.delta !== NO_DELTA) {
      const command = new RotateCommand(this.deps.scene, before, after);
      this.deps.history.push(command);
    }
    this.end();
  }

  /**
   * Drops the gesture without touching history, restoring every object to
   * its pre-gesture snapshot (the Escape contract).
   */
  public cancel(): void {
    const before = this.before;
    if (before !== null) {
      for (const object of before) {
        this.deps.scene.add(object);
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
    this.before = null;
    this.pivot = null;
    this.startPointer = null;
    this.delta = NO_DELTA;
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
