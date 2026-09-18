/**
 * Shape tool: drag-out creation of primitive shapes.
 *
 * Pointer down anchors the shape corner; every move normalises the drag
 * rectangle (`normalizedRectFromDrag`) and streams it into the
 * `ShapeOverlay` for a live preview. Shift constrains the rectangle to a
 * square. A plain tap (sub-threshold drag) places a default-sized shape
 * centred on the tap. Release commits the finished shape through an
 * `AddObjectCommand` recorded in history; Escape mid-drag cancels the
 * draft without touching history.
 */
import type { ITool, ToolCursor, ToolPointerEvent } from "@/interaction/Tool";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { IdGenerator } from "@/core/id/IdGenerator";
import type { Scene } from "@/core/model/Scene";
import type {
  ShapeKind,
  ShapeRect,
  ShapeStyle,
} from "@/core/model/ShapeObject";
import {
  defaultShapeRect,
  normalizedRectFromDrag,
  shapeFromRect,
} from "@/core/model/ShapeObject";
import type { ShapeOverlay } from "@/rendering/ShapeOverlay";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import {
  snapPointIfEnabled,
  snapRectOrigin,
  type SnapConfig,
} from "@/interaction/SnapEngine";

/** Dependencies of the shape tool (constructor injection). */
export interface ShapeToolDeps {
  /** Scene receiving committed shapes. */
  readonly scene: Scene;
  /** History recording the commit command. */
  readonly history: HistoryManager;
  /** Id allocator for new shape objects (shared generator). */
  readonly ids: IdGenerator;
  /** Overlay holding the in-progress draft. */
  readonly overlay: ShapeOverlay;
  /** Resolves the shape kind each time a shape is started. */
  readonly getShapeKind: () => ShapeKind;
  /** Resolves the shape style each time a shape is started. */
  readonly getShapeStyle: () => ShapeStyle;
  /** Optional snap configuration (R5.5 — created shapes land on the grid). */
  readonly getSnapConfig?: () => SnapConfig;
}

/** Full size of a tap-created default shape, in world units. */
const DEFAULT_SHAPE_SIZE = 96;

/** Rect dimension below which a release counts as a tap (default shape). */
const TAP_MIN_SIZE = 8;

/** Freehand drawing tool. */
export class ShapeTool implements ITool {
  /** Unique tool id. */
  public readonly id = "shape";
  /** Cursor hint requested while active. */
  public readonly cursor: ToolCursor = "crosshair";

  /** World-space anchor of the current gesture, or null while idle. */
  private anchor: Vec2 | null = null;

  /**
   * @param deps - injected tool dependencies.
   */
  public constructor(private readonly deps: ShapeToolDeps) {}

  /** Called when the tool becomes active (cancels any open draft). */
  public onActivate(): void {
    this.cancelDraft();
  }

  /** Called when the tool stops being active (discards any open draft). */
  public onDeactivate(): void {
    this.cancelDraft();
  }

  /**
   * Handles pointer press: anchors the shape rectangle.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerDown(event: ToolPointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    // R5.5: the creation anchor snaps so the shape's corner lands on the
    // grid; the release snaps too (see onPointerUp).
    this.anchor = snapPointIfEnabled(event.world, this.deps.getSnapConfig?.());
  }

  /**
   * Handles pointer move: streams the normalised rectangle into the draft.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerMove(event: ToolPointerEvent): void {
    if (this.anchor === null) {
      return;
    }
    const rect = normalizedRectFromDrag(
      this.anchor,
      snapPointIfEnabled(event.world, this.deps.getSnapConfig?.()),
      event.shiftKey,
    );
    const draft = shapeFromRect(
      rect,
      this.deps.getShapeKind(),
      this.deps.getShapeStyle(),
      this.draftId(),
      this.deps.scene.nextZIndex(),
    );
    if (this.deps.overlay.current === null) {
      this.deps.overlay.begin(draft);
    } else {
      this.deps.overlay.update(draft);
    }
  }

  /**
   * Handles pointer release: commits the finished shape. A release whose
   * rectangle has a dimension under {@link TAP_MIN_SIZE} (tap or micro-drag)
   * places a default-sized shape centred on the release point instead.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerUp(event: ToolPointerEvent): void {
    const anchor = this.anchor;
    if (anchor === null) {
      return;
    }
    this.anchor = null;
    const rect = normalizedRectFromDrag(
      anchor,
      snapPointIfEnabled(event.world, this.deps.getSnapConfig?.()),
      event.shiftKey,
    );
    const finalRect =
      rect.width < TAP_MIN_SIZE || rect.height < TAP_MIN_SIZE
        ? this.snapRect(defaultShapeRect(event.world, DEFAULT_SHAPE_SIZE))
        : rect;
    const shape = shapeFromRect(
      finalRect,
      this.deps.getShapeKind(),
      this.deps.getShapeStyle(),
      this.deps.ids.next(),
      this.deps.scene.nextZIndex(),
    );
    this.deps.overlay.end();
    const command = new AddObjectCommand(this.deps.scene, shape);
    command.do();
    this.deps.history.push(command);
  }

  /**
   * Escape during a drag: drops the draft without committing.
   *
   * @returns whether a draft was cancelled.
   */
  public onCancel(): boolean {
    if (this.anchor === null) {
      return false;
    }
    this.anchor = null;
    this.cancelDraft();
    return true;
  }

  /**
   * Removes the overlay draft and resets gesture bookkeeping.
   */
  private cancelDraft(): void {
    this.anchor = null;
    if (this.deps.overlay.current !== null) {
      this.deps.overlay.end();
    }
  }

  /**
   * Snaps a tap-created default rectangle's origin to the grid (R5.5 —
   * both edges land on grid lines; the size is preserved).
   *
   * @param rect - the default rectangle.
   * @returns the grid-aligned rectangle (identity while snap is off).
   */
  private snapRect(rect: ShapeRect): ShapeRect {
    const snap = this.deps.getSnapConfig?.();
    if (snap === undefined || !snap.enabled) {
      return rect;
    }
    const snapped = snapRectOrigin(
      {
        minX: rect.position.x,
        minY: rect.position.y,
        maxX: rect.position.x + rect.width,
        maxY: rect.position.y + rect.height,
      },
      snap.spacing,
    );
    return {
      position: vec2(snapped.minX, snapped.minY),
      width: rect.width,
      height: rect.height,
    };
  }

  /**
   * @returns a placeholder id for the draft (the committed shape gets its
   * final id from the shared generator on release).
   */
  private draftId(): string {
    return "shape-draft";
  }
}
