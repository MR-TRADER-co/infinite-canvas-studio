/**
 * Transient overlay state for in-progress interactions (pen drafts).
 *
 * The overlay holds `FreehandObjectData`-shaped drafts that are NOT yet in
 * the scene: the pen tool streams points into a draft while the pointer is
 * held, the renderer paints drafts on top of the committed scene each
 * frame, and the tool commits the finished stroke through a command.
 *
 * The injected notifier lets the render loop mark itself dirty whenever a
 * draft mutates (streaming points must repaint live).
 */
import type { FreehandObjectData } from "@/core/model/FreehandObject";

/** Registry of transient draft strokes drawn above the scene. */
export class StrokeOverlay {
  /** Draft strokes currently being drawn. */
  private readonly drafts: FreehandObjectData[] = [];

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

  /** @returns the current drafts (rendered every frame while non-empty). */
  public get current(): readonly FreehandObjectData[] {
    return this.drafts;
  }

  /**
   * Starts a new draft stroke.
   *
   * @param draft - the initial draft data (single point).
   */
  public begin(draft: FreehandObjectData): void {
    this.drafts.push(draft);
    this.notify?.();
  }

  /**
   * Replaces the most recent draft (immutable point-list update).
   *
   * @param draft - the updated draft data.
   */
  public update(draft: FreehandObjectData): void {
    const index = this.drafts.length - 1;
    if (index === -1) {
      return;
    }
    this.drafts[index] = draft;
    this.notify?.();
  }

  /** Removes the most recent draft (stroke finished or cancelled). */
  public end(): FreehandObjectData | undefined {
    const draft = this.drafts.pop();
    this.notify?.();
    return draft;
  }

  /** @returns whether any draft is currently in progress. */
  public get isDrawing(): boolean {
    return this.drafts.length > 0;
  }
}
