/**
 * Pen tool: freehand stroke capture while the pointer is held.
 *
 * While drawing, the streamed points live in the `StrokeOverlay` (rendered
 * live, not in the scene); on release the stroke is committed through an
 * `AddObjectCommand` recorded in the history manager, so undo/redo work
 * like any other mutation.
 *
 * R5.4: the resolved style carries the user-adjustable colour/width AND
 * the marker mode — highlighter drafts preview through the same renderer
 * path (the overlay holds `FreehandObjectData`-shaped drafts, so the
 * highlighter flag simply rides the draft).
 */
import type { ITool, ToolCursor, ToolPointerEvent } from "@/interaction/Tool";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { IdGenerator } from "@/core/id/IdGenerator";
import type { Scene } from "@/core/model/Scene";
import type { FreehandObjectData } from "@/core/model/FreehandObject";
import type { StrokeOverlay } from "@/rendering/StrokeOverlay";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import type { Vec2 } from "@/core/geometry/Vec2";

/** Visual style of newly drawn strokes, resolved at stroke start. */
export interface StrokeStyle {
  /** Stroke colour as a CSS colour string or the palette token. */
  readonly color: string;
  /** Stroke width in world units. */
  readonly width: number;
  /** Marker mode (R5.4): translucent multiply-blended highlighter ink. */
  readonly highlighter: boolean;
}

/** Dependencies of the pen tool (constructor injection). */
export interface PenToolDeps {
  /** Scene receiving committed strokes. */
  readonly scene: Scene;
  /** History recording the commit command. */
  readonly history: HistoryManager;
  /** Id allocator for new stroke objects. */
  readonly ids: IdGenerator;
  /** Overlay holding the in-progress draft. */
  readonly overlay: StrokeOverlay;
  /** Resolves the stroke style each time a stroke starts. */
  readonly getStrokeStyle: () => StrokeStyle;
}

/** Minimum screen-pixel distance between streamed points. */
const MIN_POINT_DISTANCE_PX = 1.5;

/** Freehand drawing tool. */
export class PenTool implements ITool {
  /** Unique tool id. */
  public readonly id = "pen";
  /** Cursor hint requested while active. */
  public readonly cursor: ToolCursor = "crosshair";

  /** The in-progress draft, or null while idle. */
  private draft: FreehandObjectData | null = null;

  /**
   * @param deps - injected tool dependencies.
   */
  public constructor(private readonly deps: PenToolDeps) {}

  /** Called when the tool becomes active. */
  public onActivate(): void {
    this.discardDraft();
  }

  /** Called when the tool stops being active (discards any open draft). */
  public onDeactivate(): void {
    this.discardDraft();
  }

  /**
   * Handles pointer press: starts a new stroke draft.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerDown(event: ToolPointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const style = this.deps.getStrokeStyle();
    this.draft = {
      id: this.deps.ids.next(),
      kind: "freehand",
      name: undefined,
      parentId: undefined,
      position: event.world,
      rotation: 0,
      zIndex: this.deps.scene.nextZIndex(),
      visible: true,
      locked: false,
      points: [event.world],
      strokeColor: style.color,
      strokeWidth: style.width,
      strokeStyle: "solid",
      ...(style.highlighter ? { highlighter: true } : {}),
    };
    this.deps.overlay.begin(this.draft);
  }

  /**
   * Handles pointer move: streams points into the draft.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerMove(event: ToolPointerEvent): void {
    if (this.draft === null) {
      return;
    }
    const points = this.draft.points;
    const last = points[points.length - 1];
    if (last === undefined) {
      return;
    }
    // Filter micro-movements (sub-pixel in screen space) for smooth paths.
    const zoom = Math.max(this.deps.scene.camera.zoom, 0.01);
    if (
      Math.hypot(event.world.x - last.x, event.world.y - last.y) * zoom <
      MIN_POINT_DISTANCE_PX
    ) {
      return;
    }
    this.draft = { ...this.draft, points: [...points, event.world] };
    this.deps.overlay.update(this.draft);
  }

  /**
   * Handles pointer release: commits the finished stroke.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerUp(event: ToolPointerEvent): void {
    if (this.draft === null) {
      return;
    }
    const draft = this.draft;
    this.draft = null;
    this.deps.overlay.end();

    // A single-point "tap" still paints a dot: duplicate the point so the
    // round line cap of the zero-length path fills a circle.
    const points: Vec2[] =
      draft.points.length === 1
        ? [draft.points[0] ?? event.world, draft.points[0] ?? event.world]
        : [...draft.points];
    const stroke: FreehandObjectData = { ...draft, points };
    const command = new AddObjectCommand(this.deps.scene, stroke);
    command.do();
    this.deps.history.push(command);
  }

  /**
   * Discards any in-progress draft without committing it.
   */
  private discardDraft(): void {
    if (this.draft !== null) {
      this.draft = null;
      this.deps.overlay.end();
    }
  }
}
