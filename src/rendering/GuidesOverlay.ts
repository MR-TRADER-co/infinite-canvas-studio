/**
 * Transient smart-guide overlay state (R7.4): the magenta alignment lines
 * and equal-gap badges the SelectTool streams while dragging.
 *
 * Follows the `ShapeOverlay`/`ConnectorOverlay` precedent: the tool
 * mutates the overlay, the injected notifier marks the render loop dirty,
 * and the renderer paints the current state above the committed scene
 * every frame. Alt-held frames clear the guides (temporary bypass) and
 * gesture end/cancel clears them for good.
 */
import type { GuideLine, SpacingHint } from "@/interaction/SmartGuides";

/** The current drag-frame guide state. */
export interface GuidesFrame {
  /** Alignment guide lines (magenta, 1px screen space). */
  readonly lines: readonly GuideLine[];
  /** Equal-gap value badges. */
  readonly hints: readonly SpacingHint[];
}

/** The idle frame: no guides. */
const IDLE: GuidesFrame = { lines: [], hints: [] };

/** Registry of the transient smart-guide overlay. */
export class GuidesOverlay {
  /** The current frame (rendered every frame while non-empty). */
  private frame: GuidesFrame = IDLE;

  /** Notifier invoked after every overlay mutation. */
  private notify: (() => void) | undefined;

  /**
   * Installs the mutation notifier (the render loop's dirty flag).
   *
   * @param notify - invoked after every set/clear.
   */
  public setNotifier(notify: () => void): void {
    this.notify = notify;
  }

  /** @returns the current frame. */
  public get current(): GuidesFrame {
    return this.frame;
  }

  /**
   * Replaces the frame (one drag frame's guides).
   *
   * @param lines - the guide lines.
   * @param hints - the gap hints.
   */
  public set(
    lines: readonly GuideLine[],
    hints: readonly SpacingHint[] = [],
  ): void {
    this.frame = { lines, hints };
    this.notify?.();
  }

  /** Clears the overlay (gesture end, cancel, Alt bypass). */
  public clear(): void {
    if (this.frame === IDLE) {
      return;
    }
    this.frame = IDLE;
    this.notify?.();
  }

  /** @returns whether any guide is showing. */
  public get isActive(): boolean {
    return this.frame.lines.length > 0 || this.frame.hints.length > 0;
  }
}
