/**
 * Tool contract: the strategy interface every canvas tool implements.
 *
 * Pointer events are captured by the canvas layer, hit-tested against the
 * scene model, and handed to the active tool as normalised payloads
 * (CLAUDE.md §1.3) — tools never touch DOM events directly. The optional
 * `hoverCursor`/`onCancel` hooks let a tool refine the pointer feedback and
 * Escape behaviour per gesture state without leaking DOM access.
 */
import type { Vec2 } from "@/core/geometry/Vec2";

/** Cursor hints a tool can request from the host while active. */
export type ToolCursor =
  | "default"
  | "crosshair"
  | "grab"
  | "grabbing"
  | "text"
  | "move"
  | "pointer"
  | "not-allowed"
  | "nwseResize"
  | "neswResize"
  | "nsResize"
  | "ewResize";

/** Normalised pointer event handed to tools in screen and world space. */
export interface ToolPointerEvent {
  /** Pointer position in screen (viewport) coordinates. */
  readonly screen: Vec2;
  /** Pointer position in world coordinates. */
  readonly world: Vec2;
  /** Mouse button that changed (0 = primary). */
  readonly button: number;
  /** Whether the Shift key was held. */
  readonly shiftKey: boolean;
  /** Whether the Ctrl key was held. */
  readonly ctrlKey: boolean;
  /** Whether the Alt key was held. */
  readonly altKey: boolean;
}

/** Strategy contract implemented by every canvas tool. */
export interface ITool {
  /** Unique tool id, used by the tool manager and UI. */
  readonly id: string;
  /** Cursor hint requested while this tool is active. */
  readonly cursor: ToolCursor;
  /** Called once when the tool becomes the active tool. */
  onActivate(): void;
  /** Called once when the tool stops being the active tool. */
  onDeactivate(): void;
  /**
   * Called on pointer press.
   *
   * @param event - normalised pointer payload.
   */
  onPointerDown(event: ToolPointerEvent): void;
  /**
   * Called on pointer move.
   *
   * @param event - normalised pointer payload.
   */
  onPointerMove(event: ToolPointerEvent): void;
  /**
   * Called on pointer release.
   *
   * @param event - normalised pointer payload.
   */
  onPointerUp(event: ToolPointerEvent): void;
  /**
   * Optional per-position cursor refinement, evaluated after every pointer
   * move. Returning null (or leaving the hook unimplemented) falls back to
   * the tool's static {@link ITool.cursor} hint — the host applies the
   * override purely visually, never as tool state.
   *
   * @param event - the latest normalised pointer payload.
   * @returns a context-sensitive cursor hint, or null for the static hint.
   */
  hoverCursor?(event: ToolPointerEvent): ToolCursor | null;
  /**
   * Optional pointer-cancel hook (Escape): drops any in-progress gesture
   * (open stroke/shape draft, live resize) without touching history.
   *
   * @returns whether the tool consumed the cancel (suppresses the fallback
   *   action, e.g. clearing the selection).
   */
  onCancel?(): boolean;
  /**
   * Optional double-click hook: a full press-release-press-release sequence
   * on the canvas. The most common use is entering an edit mode (text
   * objects) or creating one (double-click on empty canvas).
   *
   * @param event - normalised pointer payload of the final click.
   */
  onDoubleClick?(event: ToolPointerEvent): void;
}
