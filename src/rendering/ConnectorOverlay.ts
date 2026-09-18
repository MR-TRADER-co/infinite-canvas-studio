/**
 * Transient overlay state for the in-progress connector draft.
 *
 * The overlay holds `ConnectorDraft` state that is NOT yet in the scene:
 * the connector tool streams endpoint candidates into the draft while the
 * pointer is held (rubber-band preview), the renderer paints the draft on
 * top of the committed scene each frame, and the tool commits the finished
 * connector through a command. Mirrors the `ShapeOverlay` contract.
 */
import type {
  ConnectorEndpoint,
  ConnectorStyle,
} from "@/core/model/ConnectorObject";

/** Rubber-band draft of a connector being dragged out. */
export interface ConnectorDraft {
  /** Start endpoint (already resolved to a live world position). */
  readonly start: ConnectorEndpoint;
  /** End endpoint candidate (glued or floating, live per move). */
  readonly end: ConnectorEndpoint;
  /** Visual style the preview is painted with (mirrors the commit style). */
  readonly style: ConnectorStyle;
}

/** Registry of the transient connector draft drawn above the scene. */
export class ConnectorOverlay {
  /** Draft currently being dragged, or null while idle. */
  private draft: ConnectorDraft | null = null;

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

  /** @returns the current draft, or null while no connector is dragged. */
  public get current(): ConnectorDraft | null {
    return this.draft;
  }

  /**
   * Starts a new draft (first pointer move of the gesture).
   *
   * @param draft - the initial draft data.
   */
  public begin(draft: ConnectorDraft): void {
    this.draft = draft;
    this.notify?.();
  }

  /**
   * Replaces the draft (immutable endpoint update per move).
   *
   * @param draft - the updated draft data.
   */
  public update(draft: ConnectorDraft): void {
    this.draft = draft;
    this.notify?.();
  }

  /** Removes the draft (connector committed or cancelled). */
  public end(): ConnectorDraft | null {
    const draft = this.draft;
    this.draft = null;
    this.notify?.();
    return draft;
  }
}
