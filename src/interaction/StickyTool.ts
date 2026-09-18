/**
 * Sticky tool: click to create a sticky note (entering edit mode
 * immediately) or to edit an existing one; drag-out sizes the card.
 *
 * Creation and editing themselves live in the text layer (the DOM overlay),
 * so this tool only expresses *intents* on the typed event bus
 * (`sticky:create-requested`, `text:edit-requested`) — interaction/ never
 * imports the text feature module directly (CLAUDE.md §1.4 rule: feature
 * modules communicate through core interfaces and the bus). A tap under
 * {@link TAP_MIN_SIZE} places a default-sized card centred on the release
 * point; a drag-out commits the dragged rectangle (clamped to a usable
 * minimum).
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
  STICKY_MIN_HEIGHT,
  STICKY_MIN_WIDTH,
  defaultStickyNoteRect,
  isStickyNoteObject,
} from "@/core/model/StickyNoteObject";

/** Dependencies of the sticky tool (constructor injection). */
export interface StickyToolDeps {
  /** Scene used for hit-probing existing objects. */
  readonly scene: Scene;
  /** Bus carrying the create/edit request events. */
  readonly bus: EventBus<AppEventMap>;
  /** Resolves the card colour each time a note is created. */
  readonly getNoteColor: () => string;
  /** Resolves the font size each time a note is created. */
  readonly getFontSize: () => number;
  /** Optional snap configuration (R5.5 — created notes land on the grid). */
  readonly getSnapConfig?: () => SnapConfig;
}

/** Rect dimension below which a release counts as a tap (default card). */
const TAP_MIN_SIZE = 8;

/** Sticky note creation tool. */
export class StickyTool implements ITool {
  /** Unique tool id. */
  public readonly id = "sticky";
  /** Cursor hint requested while active. */
  public readonly cursor: ToolCursor = "crosshair";

  /** World-space anchor of the current press, or null while idle. */
  private anchor: Vec2 | null = null;

  /**
   * @param deps - injected tool dependencies.
   */
  public constructor(private readonly deps: StickyToolDeps) {}

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
    // R5.5: the creation anchor snaps so the card's top-left lands on the
    // grid (hit-probing still uses the RAW pointer).
    this.anchor = snapPointIfEnabled(event.world, this.deps.getSnapConfig?.());
  }

  /**
   * Handles pointer move: the dragged card preview is painted by the text
   * layer from the pending create events; nothing to stream per-frame here.
   *
   * @param _event - normalised pointer payload.
   */
  public onPointerMove(_event: ToolPointerEvent): void {}

  /**
   * Handles pointer release: a tap edits a hit sticky note or requests a
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
    if (hit !== null && isStickyNoteObject(hit)) {
      this.deps.bus.emit("text:edit-requested", { objectId: hit.id });
      return;
    }
    const release = snapPointIfEnabled(
      event.world,
      this.deps.getSnapConfig?.(),
    );
    const rect = this.resolveRect(anchor, release);
    this.deps.bus.emit("sticky:create-requested", {
      x: rect.minX,
      y: rect.minY,
      width: rect.maxX - rect.minX,
      height: rect.maxY - rect.minY,
      noteColor: this.deps.getNoteColor(),
      fontSize: this.deps.getFontSize(),
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
   * drags) place the default card centred on the release point; real drags
   * commit the dragged rectangle clamped to the note minimum size.
   *
   * @param anchor - the world-space press point.
   * @param release - the world-space release point.
   * @returns the creation rectangle.
   */
  private resolveRect(anchor: Vec2, release: Vec2): BBox {
    const width = Math.abs(release.x - anchor.x);
    const height = Math.abs(release.y - anchor.y);
    if (width < TAP_MIN_SIZE || height < TAP_MIN_SIZE) {
      return defaultStickyNoteRect(release);
    }
    const clampedWidth = Math.max(width, STICKY_MIN_WIDTH);
    const clampedHeight = Math.max(height, STICKY_MIN_HEIGHT);
    const minX = Math.min(anchor.x, release.x);
    const minY = Math.min(anchor.y, release.y);
    return bbox(minX, minY, minX + clampedWidth, minY + clampedHeight);
  }
}
