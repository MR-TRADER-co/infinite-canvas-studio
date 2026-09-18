/**
 * Table tool (R6.1): click or drag-out on the canvas creates a table text
 * box with the toolbar picker's dimensions.
 *
 * Like the text tool, this only expresses an *intent* on the typed event
 * bus (`table:create-requested`) — interaction/ never imports the text
 * feature module directly (CLAUDE.md §1.4 rule). A tap under
 * {@link TAP_MIN_SIZE} places a default-footprint table (cols × rows at
 * the picker's dimensions) at the release point; a drag-out commits the
 * dragged rectangle (clamped to at least the picker's table footprint).
 */
import type { ITool, ToolCursor, ToolPointerEvent } from "@/interaction/Tool";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import type { Vec2 } from "@/core/geometry/Vec2";
import { snapPointIfEnabled, type SnapConfig } from "@/interaction/SnapEngine";

/** Dependencies of the table tool (constructor injection). */
export interface TableToolDeps {
  /** Bus carrying the create request events. */
  readonly bus: EventBus<AppEventMap>;
  /** Resolves the picked row count each time a table is created. */
  readonly getRows: () => number;
  /** Resolves the picked column count each time a table is created. */
  readonly getColumns: () => number;
  /** Resolves the font size each time a table is created. */
  readonly getFontSize: () => number;
  /** Optional snap configuration (R5.5 — created tables land on the grid). */
  readonly getSnapConfig?: () => SnapConfig;
}

/** Rect dimension below which a release counts as a tap (default table). */
const TAP_MIN_SIZE = 8;

/** Table box creation tool. */
export class TableTool implements ITool {
  /** Unique tool id. */
  public readonly id = "table";
  /** Cursor hint requested while active. */
  public readonly cursor: ToolCursor = "crosshair";

  /** World-space anchor of the current press, or null while idle. */
  private anchor: Vec2 | null = null;

  /**
   * @param deps - injected tool dependencies.
   */
  public constructor(private readonly deps: TableToolDeps) {}

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
    // R5.5: the creation anchor snaps so the table's top-left lands on
    // the grid.
    this.anchor = snapPointIfEnabled(event.world, this.deps.getSnapConfig?.());
  }

  /**
   * Handles pointer move: nothing to stream per-frame (no preview layer
   * for tables yet — the box outline appears on release).
   *
   * @param _event - normalised pointer payload.
   */
  public onPointerMove(_event: ToolPointerEvent): void {}

  /**
   * Handles pointer release: a tap (or sub-threshold drag) places the
   * picker's default table footprint at the release point; a drag-out
   * requests the dragged rectangle (clamped to the picker's footprint).
   *
   * @param event - normalised pointer payload.
   */
  public onPointerUp(event: ToolPointerEvent): void {
    const anchor = this.anchor;
    this.anchor = null;
    if (anchor === null || event.button !== 0) {
      return;
    }
    const rows = Math.max(1, Math.floor(this.deps.getRows()));
    const cols = Math.max(1, Math.floor(this.deps.getColumns()));
    const fontSize = this.deps.getFontSize();
    const release = snapPointIfEnabled(
      event.world,
      this.deps.getSnapConfig?.(),
    );
    const rect = this.resolveRect(anchor, release, rows, cols);
    this.deps.bus.emit("table:create-requested", {
      x: rect.minX,
      y: rect.minY,
      width: rect.maxX - rect.minX,
      height: rect.maxY - rect.minY,
      rows,
      cols,
      fontSize,
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
   * drags) place the picker's default footprint at the release point;
   * real drags commit the dragged rectangle clamped to at least the
   * default footprint so the table never collapses.
   *
   * @param anchor - the world-space press point.
   * @param release - the world-space release point.
   * @param rows - the picked row count.
   * @param cols - the picked column count.
   * @returns the creation rectangle.
   */
  private resolveRect(
    anchor: Vec2,
    release: Vec2,
    rows: number,
    cols: number,
  ): { minX: number; minY: number; maxX: number; maxY: number } {
    const defaultWidth = cols * 110;
    const defaultHeight = rows * 36 + 8;
    const width = Math.abs(release.x - anchor.x);
    const height = Math.abs(release.y - anchor.y);
    if (width < TAP_MIN_SIZE || height < TAP_MIN_SIZE) {
      return {
        minX: release.x,
        minY: release.y - defaultHeight / 2,
        maxX: release.x + defaultWidth,
        maxY: release.y + defaultHeight / 2,
      };
    }
    const minX = Math.min(anchor.x, release.x);
    const minY = Math.min(anchor.y, release.y);
    return {
      minX,
      minY,
      maxX: Math.max(minX + defaultWidth, Math.max(anchor.x, release.x)),
      maxY: Math.max(minY + defaultHeight, Math.max(anchor.y, release.y)),
    };
  }
}
