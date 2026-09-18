/**
 * Text tool: click to create a text box (entering edit mode immediately) or
 * to edit an existing text box; drag-out sizes the box.
 *
 * Creation and editing themselves live in the text layer (the DOM overlay),
 * so this tool only expresses *intents* on the typed event bus
 * (`text:create-requested`, `text:edit-requested`) — interaction/ never
 * imports the text feature module directly (CLAUDE.md §1.4 rule: feature
 * modules communicate through core interfaces and the bus). A tap under
 * {@link TAP_MIN_SIZE} places a default-sized box at the release point; a
 * drag-out commits the dragged rectangle (clamped to at least one line).
 */
import type { ITool, ToolCursor, ToolPointerEvent } from "@/interaction/Tool";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import type { Scene } from "@/core/model/Scene";
import type { BBox } from "@/core/geometry/BBox";
import { bbox } from "@/core/geometry/BBox";
import type { Vec2 } from "@/core/geometry/Vec2";
import { hitTestTopMost } from "@/interaction/objectHitTest";
import { snapPointIfEnabled, type SnapConfig } from "@/interaction/SnapEngine";
import {
  DEFAULT_TEXT_HEIGHT,
  defaultTextBoxRect,
  isTextBoxObject,
} from "@/core/model/TextBoxObject";

/** Dependencies of the text tool (constructor injection). */
export interface TextToolDeps {
  /** Scene used for hit-probing existing objects. */
  readonly scene: Scene;
  /** Bus carrying the create/edit request events. */
  readonly bus: EventBus<AppEventMap>;
  /** Resolves the font size each time a box is created. */
  readonly getFontSize: () => number;
  /** Optional snap configuration (R5.5 — created boxes land on the grid). */
  readonly getSnapConfig?: () => SnapConfig;
}

/** Rect dimension below which a release counts as a tap (default box). */
const TAP_MIN_SIZE = 8;

/** Text box creation tool. */
export class TextTool implements ITool {
  /** Unique tool id. */
  public readonly id = "text";
  /** Cursor hint requested while active. */
  public readonly cursor: ToolCursor = "text";

  /** World-space anchor of the current press, or null while idle. */
  private anchor: Vec2 | null = null;

  /**
   * @param deps - injected tool dependencies.
   */
  public constructor(private readonly deps: TextToolDeps) {}

  /** Called when the tool becomes active (no gesture to roll back). */
  public onActivate(): void {}

  /** Called when the tool stops being active (presses are stateless). */
  public onDeactivate(): void {}

  /**
   * Handles pointer press: anchors the (potential) drag-out rectangle.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerDown(event: ToolPointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    // R5.5: the creation anchor snaps so the box's top-left lands on the
    // grid (hit-probing still uses the RAW pointer — snapping never
    // changes what gets edited).
    this.anchor = snapPointIfEnabled(event.world, this.deps.getSnapConfig?.());
  }

  /**
   * Handles pointer move: the dragged rect preview is painted by the text
   * layer from the pending create events; nothing to stream per-frame here.
   *
   * @param _event - normalised pointer payload.
   */
  public onPointerMove(_event: ToolPointerEvent): void {}

  /**
   * Handles pointer release: a tap edits a hit text box or requests a
   * default-sized creation; a drag-out requests the dragged rectangle.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerUp(event: ToolPointerEvent): void {
    const anchor = this.anchor;
    this.anchor = null;
    if (anchor === null || event.button !== 0) {
      return;
    }
    const hit = hitTestTopMost(this.deps.scene, event.world, 0);
    if (hit !== null && isTextBoxObject(hit)) {
      this.deps.bus.emit("text:edit-requested", { objectId: hit.id });
      return;
    }
    const release = snapPointIfEnabled(
      event.world,
      this.deps.getSnapConfig?.(),
    );
    const rect = this.resolveRect(anchor, release);
    const tap = isTap(anchor, release);
    this.deps.bus.emit("text:create-requested", {
      x: rect.minX,
      y: rect.minY,
      width: rect.maxX - rect.minX,
      height: rect.maxY - rect.minY,
      fontSize: this.deps.getFontSize(),
      // R3A.7: a tap creates a label-style AUTO box (grows with content);
      // a drag-out pins the width as FIXED (wrapping).
      sizeMode: tap ? "auto" : "fixed",
    });
  }

  /**
   * Escape hook: presses are stateless, so there is nothing to cancel.
   *
   * @returns always false (nothing consumed).
   */
  public onCancel(): boolean {
    return false;
  }

  /**
   * Resolves the creation rectangle for a release: taps (sub-threshold
   * drags) place the default box at the release point; real drags commit
   * the dragged rectangle clamped to at least one text line.
   *
   * @param anchor - the world-space press point.
   * @param release - the world-space release point.
   * @returns the creation rectangle.
   */
  private resolveRect(anchor: Vec2, release: Vec2): BBox {
    const width = Math.abs(release.x - anchor.x);
    const height = Math.abs(release.y - anchor.y);
    if (width < TAP_MIN_SIZE || height < TAP_MIN_SIZE) {
      return defaultTextBoxRect(release);
    }
    // Dragged box: at least ~¾ of a default line tall so the first line fits.
    const clampedHeight = Math.max(height, DEFAULT_TEXT_HEIGHT * 0.75);
    const minX = Math.min(anchor.x, release.x);
    const minY = Math.min(anchor.y, release.y);
    return bbox(
      minX,
      minY,
      Math.max(anchor.x, release.x),
      minY + clampedHeight,
    );
  }
}

/**
 * @param anchor - the world-space press point.
 * @param release - the world-space release point.
 * @returns whether the gesture stayed under the tap threshold (either
 *          axis below threshold counts as a tap — the resolveRect rule).
 */
function isTap(anchor: Vec2, release: Vec2): boolean {
  return (
    Math.abs(release.x - anchor.x) < TAP_MIN_SIZE ||
    Math.abs(release.y - anchor.y) < TAP_MIN_SIZE
  );
}
