/**
 * Transient overlay state for the in-progress shape draft.
 *
 * The shape tool streams placement rectangles into a `ShapeObjectData`
 * draft while the pointer is held; the renderer paints the draft above the
 * committed scene each frame, and the tool commits the finished shape
 * through an `AddObjectCommand` (StrokeOverlay set the precedent).
 *
 * The injected notifier lets the render loop mark itself dirty whenever the
 * draft mutates.
 */
import type { ShapeObjectData } from "@/core/model/ShapeObject";

/** Registry of the transient shape draft drawn above the scene. */
export class ShapeOverlay {
  /** Draft shape currently being dragged out, or null while idle. */
  private draft: ShapeObjectData | null = null;

  /** Notifier invoked after every overlay mutation. */
  private notify: (() => void) | undefined;

  /**
   * Installs the mutation notifier (usually the render loop's dirty flag).
   *
   * @param notify - invoked after begin/update/end mutations.
   */
  public setNotifier(notify: () => void): void {
    this.notify = notify;
  }

  /**
   * @returns the current draft (rendered every frame while non-null), or
   * null while no shape is being dragged.
   */
  public get current(): ShapeObjectData | null {
    return this.draft;
  }

  /**
   * Starts a new shape draft.
   *
   * @param draft - the initial draft data (typically a zero-area rect).
   */
  public begin(draft: ShapeObjectData): void {
    this.draft = draft;
    this.notify?.();
  }

  /**
   * Replaces the draft (immutable rect updates).
   *
   * @param draft - the updated draft data.
   */
  public update(draft: ShapeObjectData): void {
    if (this.draft === null) {
      return;
    }
    this.draft = draft;
    this.notify?.();
  }

  /**
   * Removes the draft (shape finished or cancelled).
   *
   * @returns the removed draft, or null when none was in progress.
   */
  public end(): ShapeObjectData | null {
    const draft = this.draft;
    this.draft = null;
    this.notify?.();
    return draft;
  }

  /** @returns whether a draft is currently in progress. */
  public get isDrawing(): boolean {
    return this.draft !== null;
  }
}
