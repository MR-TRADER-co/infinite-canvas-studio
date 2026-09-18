/**
 * Eraser tool: removes freehand strokes the pointer passes over.
 *
 * Hit-testing runs against the scene model (`distanceToSegment` on every
 * stroke segment) — never DOM geometry. Removals are applied live (each
 * hit erases immediately) and bundled into one `CompositeCommand` of
 * `RemoveObjectCommand`s recorded on release, so a whole eraser swipe
 * undoes/redoes as a single history step.
 */
import type { ITool, ToolCursor, ToolPointerEvent } from "@/interaction/Tool";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { Scene } from "@/core/model/Scene";
import {
  isFreehandObject,
  type FreehandObjectData,
} from "@/core/model/FreehandObject";
import { distanceToSegment } from "@/core/geometry/hitTest";
import { RemoveObjectCommand } from "@/core/commands/RemoveObjectCommand";
import { CompositeCommand } from "@/core/commands/CompositeCommand";

/** Base eraser radius in screen pixels (scaled by 1/zoom into world). */
const ERASER_RADIUS_PX = 9;

/** Freehand stroke eraser. */
export class EraserTool implements ITool {
  /** Unique tool id. */
  public readonly id = "eraser";
  /** Cursor hint requested while active. */
  public readonly cursor: ToolCursor = "crosshair";

  /** Live removals of the current swipe, bundled on release. */
  private removed: RemoveObjectCommand[] = [];

  /** Whether a swipe is currently open. */
  private erasing = false;

  /**
   * @param scene - the scene whose strokes are erased.
   * @param history - history recording the swipe's composite command.
   */
  public constructor(
    private readonly scene: Scene,
    private readonly history: HistoryManager,
  ) {}

  /** Called when the tool becomes active. */
  public onActivate(): void {
    this.reset();
  }

  /** Called when the tool stops being active (drops any open swipe). */
  public onDeactivate(): void {
    this.reset();
  }

  /**
   * Handles pointer press: opens a new eraser swipe.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerDown(event: ToolPointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    this.erasing = true;
    this.removed = [];
    this.eraseAt(event);
  }

  /**
   * Handles pointer move: erases every stroke under the cursor.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerMove(event: ToolPointerEvent): void {
    if (!this.erasing) {
      return;
    }
    this.eraseAt(event);
  }

  /**
   * Handles pointer release: records the swipe as one history step.
   *
   * @param _event - normalised pointer payload.
   */
  public onPointerUp(_event: ToolPointerEvent): void {
    if (!this.erasing) {
      return;
    }
    this.erasing = false;
    if (this.removed.length > 0) {
      this.history.push(
        new CompositeCommand("command.eraseStrokes", this.removed),
      );
    }
    this.removed = [];
  }

  /**
   * Erases every stroke hit by the pointer position.
   *
   * @param event - normalised pointer payload.
   */
  private eraseAt(event: ToolPointerEvent): void {
    const radius = ERASER_RADIUS_PX / Math.max(this.scene.camera.zoom, 0.01);
    for (const object of this.scene.objects) {
      if (!isFreehandObject(object) || !object.visible || object.locked) {
        continue;
      }
      if (
        this.strokeHit(object, event.world, radius + object.strokeWidth / 2)
      ) {
        const command = new RemoveObjectCommand(this.scene, object);
        command.do();
        this.removed.push(command);
      }
    }
  }

  /**
   * Tests whether any stroke segment passes within `radius` of the point.
   *
   * @param stroke - the freehand stroke to test.
   * @param point - the world-space pointer position.
   * @param radius - the world-space hit radius.
   * @returns whether the stroke is hit.
   */
  private strokeHit(
    stroke: FreehandObjectData,
    point: { x: number; y: number },
    radius: number,
  ): boolean {
    const points = stroke.points;
    if (points.length === 1) {
      const only = points[0];
      return (
        only !== undefined &&
        Math.hypot(point.x - only.x, point.y - only.y) <= radius
      );
    }
    for (let i = 1; i < points.length; i += 1) {
      const start = points[i - 1];
      const end = points[i];
      if (start === undefined || end === undefined) {
        continue;
      }
      if (distanceToSegment(point, start, end) <= radius) {
        return true;
      }
    }
    return false;
  }

  /** Drops any open swipe without recording history. */
  private reset(): void {
    this.erasing = false;
    this.removed = [];
  }
}
