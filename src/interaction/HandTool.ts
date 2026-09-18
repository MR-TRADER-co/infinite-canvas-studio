/**
 * Hand tool: pans the viewport by dragging (also the target of the
 * space-drag shortcut, which temporarily activates this tool).
 *
 * The tool translates normalised pointer payloads into camera intents via
 * the `CameraController`; it never touches DOM events itself.
 */
import type { ITool, ToolCursor, ToolPointerEvent } from "@/interaction/Tool";
import type { CameraController } from "@/core/camera/CameraController";
import type { Vec2 } from "@/core/geometry/Vec2";

/** Viewport panning tool. */
export class HandTool implements ITool {
  /** Unique tool id. */
  public readonly id = "hand";
  /** Cursor hint requested while active. */
  public readonly cursor: ToolCursor = "grab";

  /** Screen position of the press that started the pan, or null. */
  private dragOrigin: Vec2 | null = null;

  /**
   * @param controller - the camera controller receiving pan intents.
   */
  public constructor(private readonly controller: CameraController) {}

  /** Called when the tool becomes active. */
  public onActivate(): void {
    this.dragOrigin = null;
  }

  /** Called when the tool stops being active (cancels any open drag). */
  public onDeactivate(): void {
    this.dragOrigin = null;
  }

  /**
   * Handles pointer press: starts the pan drag.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerDown(event: ToolPointerEvent): void {
    if (event.button === 0) {
      this.dragOrigin = event.screen;
    }
  }

  /**
   * Handles pointer move: pans by the delta since the last move.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerMove(event: ToolPointerEvent): void {
    if (this.dragOrigin === null) {
      return;
    }
    this.controller.panByScreen(
      event.screen.x - this.dragOrigin.x,
      event.screen.y - this.dragOrigin.y,
    );
    this.dragOrigin = event.screen;
  }

  /**
   * Handles pointer release: ends the pan drag.
   *
   * @param _event - normalised pointer payload.
   */
  public onPointerUp(_event: ToolPointerEvent): void {
    this.dragOrigin = null;
  }

  /**
   * Handles double-click: zooms in one step anchored at the click point
   * (the Phase 1 navigation affordance; the hand tool owns the gesture
   * because the object-creation tools claim double-click in later phases).
   * Any open pan drag is cancelled first (a double-click ends with pointer
   * release anyway — this is the defensive path).
   *
   * @param event - normalised pointer payload.
   */
  public onDoubleClick(event: ToolPointerEvent): void {
    this.dragOrigin = null;
    this.controller.zoomAt(event.screen, DOUBLE_CLICK_ZOOM_FACTOR);
  }
}

/** Zoom factor applied by a hand-tool double-click (one step in). */
const DOUBLE_CLICK_ZOOM_FACTOR = 2;
