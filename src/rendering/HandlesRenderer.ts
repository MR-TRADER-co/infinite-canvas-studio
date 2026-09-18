/**
 * Selection handles: the resize/rotate affordances drawn around the current
 * selection on the canvas layer.
 *
 * Painting runs in screen space (constant stroke widths and handle sizes at
 * any zoom level). The renderer holds exactly one piece of transient state —
 * the live marquee rectangle of an in-progress multi-select — updated by the
 * select tool; the selection box itself is derived from the scene model each
 * frame. Rotated objects draw their TRUE tilted frame (not an axis-aligned
 * approximation) with the resize anchors and the rotation handle riding the
 * tilted edges; groups outline every member and frame the live union.
 * Theme colours arrive via {@link HandlesRenderer.setPalette}.
 */
import type { BBox } from "@/core/geometry/BBox";
import { bboxUnion } from "@/core/geometry/BBox";
import type { Camera } from "@/core/camera/Camera";
import type { Selection } from "@/core/selection/Selection";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { objectBBox } from "@/core/model/SceneObject";
import {
  isConnectorObject,
  resolveConnectorEndpoints,
  type ConnectorObjectData,
} from "@/core/model/ConnectorObject";
import { isFreehandObject } from "@/core/model/FreehandObject";
import { isGroupObject, worldBBoxOf } from "@/core/model/GroupObject";
import {
  isPinnedObject,
  pinnedHandleAnchors,
  pinnedRotateHandleAnchor,
  pinnedTopCentre,
  pinAnchorToScreen,
  type ViewportSize,
} from "@/core/model/Pinned";
import type { ResizeHandleId } from "@/core/geometry/resize";
import {
  ROTATE_HANDLE_OFFSET_PX,
  ROTATE_HANDLE_RADIUS_PX,
  handleAnchors,
  rotateHandleAnchor,
} from "@/core/geometry/resize";
import { vec2 } from "@/core/geometry/Vec2";

/** Theme-dependent colours of the selection and marquee affordances. */
export interface SelectionColors {
  /** Accent colour of the dashed selection box. */
  readonly accent: string;
  /** Fill colour of the per-object outline. */
  readonly objectOutline: string;
  /** Fill colour of the square handles. */
  readonly handleFill: string;
  /** Border colour of the square handles. */
  readonly handleStroke: string;
  /** Fill colour of the live marquee rectangle. */
  readonly marqueeFill: string;
  /** Border colour of the live marquee rectangle. */
  readonly marqueeStroke: string;
}

/** Dark-theme selection colours (oklch strings — Canvas 2D understands them). */
export const DARK_SELECTION_COLORS: SelectionColors = {
  accent: "oklch(0.72 0.17 340)",
  objectOutline: "oklch(0.72 0.17 340 / 45%)",
  handleFill: "oklch(0.985 0 0)",
  handleStroke: "oklch(0.72 0.17 340)",
  marqueeFill: "oklch(0.72 0.17 340 / 14%)",
  marqueeStroke: "oklch(0.72 0.17 340 / 80%)",
};

/** Light-theme selection colours. */
export const LIGHT_SELECTION_COLORS: SelectionColors = {
  accent: "oklch(0.55 0.21 340)",
  objectOutline: "oklch(0.55 0.21 340 / 40%)",
  handleFill: "oklch(0.985 0 0)",
  handleStroke: "oklch(0.55 0.21 340)",
  marqueeFill: "oklch(0.55 0.21 340 / 10%)",
  marqueeStroke: "oklch(0.55 0.21 340 / 75%)",
};

/** Edge length of the square handles, in CSS pixels. */
const HANDLE_SIZE_PX = 8;

/** Edge length of the handle being dragged, in CSS pixels. */
const ACTIVE_HANDLE_SIZE_PX = 11;

/** Corner radius of the square handles, in CSS pixels. */
const HANDLE_RADIUS_PX = 2;

/** Soft glow radius behind the active handle, in CSS pixels. */
const ACTIVE_HANDLE_GLOW_PX = 8;

/** Radius of the connector endpoint affordance dots, in CSS pixels. */
const ENDPOINT_DOT_RADIUS_PX = 6;

/** Glow radius behind the endpoint dot being re-glued, in CSS pixels. */
const ACTIVE_ENDPOINT_GLOW_PX = 10;

/** Length of the dash pattern of the selection box, in CSS pixels. */
const DASH_PATTERN_PX = 5;

/** Height of the multi-select count chip (فاز ۲۶), in CSS pixels. */
const CHIP_HEIGHT_PX = 18;

/** Horizontal padding inside the count chip, in CSS pixels. */
const CHIP_PAD_X_PX = 8;

/** Gap between the count chip and the frame's top edge, in CSS pixels. */
const CHIP_GAP_PX = 7;

/** Font of the multi-select count chip (screen-constant, Persian-safe). */
const CHIP_FONT =
  'bold 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * Amber stroke of the PINNED selection affordances (فاز ۲۷): the pin
 * identity colour (matching the pin chrome ring), readable on both themes
 * — a pinned selection reads amber against the violet world-selection
 * language.
 */
const PINNED_SELECTION_COLOR = "oklch(0.8 0.14 80)";

/** Amber stroke of the pinned resize handles (فاز ۲۷, full alpha). */
const PINNED_HANDLE_STROKE = "oklch(0.78 0.15 75)";

/** Fill of the pinned resize handles (the world handles' white). */
const PINNED_HANDLE_FILL = "oklch(0.985 0 0)";

/** A screen-space rectangle (top-left + size, CSS pixels). */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Style of one per-object selection outline (فاز ۲۶). */
export interface PerObjectOutlineStyle {
  /** Stroke colour of the per-object outline. */
  readonly color: string;
  /** Stroke width in CSS pixels. */
  readonly lineWidth: number;
}

/**
 * Resolves the per-object outline style (فاز ۲۶ «کیفیت انتخاب»): a
 * MULTI-object selection paints every member at 75 % accent alpha and
 * 1.5 px so each object reads clearly against the group frame; a single
 * selection keeps the subtle 1 px hairline (the dashed frame + handles
 * dominate there).
 *
 * @param multi - whether MORE than one object is selected.
 * @param palette - the theme palette of the affordances.
 * @returns the outline colour + width for this selection size.
 */
export function perObjectOutlineStyle(
  multi: boolean,
  palette: SelectionColors,
): PerObjectOutlineStyle {
  return multi
    ? {
        color: withSelectionAlpha(palette.accent, "75%"),
        lineWidth: 1.5,
      }
    : { color: palette.objectOutline, lineWidth: 1 };
}

/** Layout options of {@link selectionCountChipRect}. */
export interface SelectionChipOptions {
  /** Chip height in CSS pixels (default 18). */
  readonly height?: number;
  /** Horizontal padding inside the chip (default 8). */
  readonly padX?: number;
  /** Gap to the frame's top edge (default 7). */
  readonly gap?: number;
}

/**
 * Computes the multi-select COUNT chip rectangle (فاز ۲۶): a pill riding
 * ABOVE the frame's top-right corner (RTL-first reading), right-aligned
 * with the frame's right edge, at least as wide as tall, flipped INSIDE
 * the frame when it would clip the viewport's top, and clamped so it
 * never crosses the left screen edge.
 *
 * @param frame - the selection frame's screen rectangle.
 * @param labelWidth - the measured label width (CSS pixels).
 * @param options - sizing overrides (tests).
 * @returns the chip's screen rectangle.
 */
export function selectionCountChipRect(
  frame: ScreenRect,
  labelWidth: number,
  options?: SelectionChipOptions,
): ScreenRect {
  const height = options?.height ?? CHIP_HEIGHT_PX;
  const padX = options?.padX ?? CHIP_PAD_X_PX;
  const gap = options?.gap ?? CHIP_GAP_PX;
  const width = Math.max(height, labelWidth + padX * 2);
  const x = Math.max(4, frame.x + frame.width - width);
  const y =
    frame.y - height - gap < 0
      ? // Not enough room above the frame — flip inside, just under the
        // top edge (still clear of the top handles' centre line).
        frame.y + gap
      : frame.y - height - gap;
  return { x, y, width, height };
}

/** Draws selection handles and the live marquee for the active selection. */
export class HandlesRenderer {
  /** Theme palette of the affordances. */
  private palette: SelectionColors;

  /** Live marquee rectangle, or null while no marquee gesture runs. */
  private marqueeRect: BBox | null = null;

  /** Handle currently being dragged, or null (active-handle highlight). */
  private activeHandle: ResizeHandleId | null = null;

  /** Connector endpoint being re-glued, or null (active-dot highlight). */
  private activeEndpoint: "start" | "end" | null = null;

  /** Whether a rotation gesture is running (rotate-handle highlight). */
  private rotating = false;

  /** Formats the multi-select count chip label (فاز ۲۶ — injected by the
   * canvas host so the renderer stays framework-free; default ASCII). */
  private countLabelFormat: (count: number) => string = (count) =>
    String(count);

  /** Notifier invoked after marquee or handle state changes. */
  private notify: (() => void) | undefined;

  /**
   * @param palette - initial theme palette (dark by default).
   */
  public constructor(palette: SelectionColors = DARK_SELECTION_COLORS) {
    this.palette = palette;
  }

  /**
   * Installs the marquee-change notifier (usually the render loop's dirty
   * flag).
   *
   * @param notify - invoked after marquee state changes.
   */
  public setNotifier(notify: () => void): void {
    this.notify = notify;
  }

  /**
   * Replaces the palette (theme switch); the next frame uses it.
   *
   * @param palette - the new theme palette.
   */
  public setPalette(palette: SelectionColors): void {
    this.palette = palette;
  }

  /**
   * Installs the count-chip label formatter (فاز ۲۶): the canvas host
   * injects a locale-aware formatter (Persian digits follow the UI
   * setting) — the renderer itself never imports the UI dictionaries.
   * The next frame uses it.
   *
   * @param format - formats a selection count into the chip label.
   */
  public setCountLabelFormat(format: (count: number) => string): void {
    this.countLabelFormat = format;
  }

  /**
   * Publishes the live marquee rectangle (the select tool updates it while
   * dragging; null clears it).
   *
   * @param rect - the world-space marquee rectangle, or null.
   */
  public setMarquee(rect: BBox | null): void {
    const changed =
      (rect === null) !== (this.marqueeRect === null) ||
      (rect !== null &&
        this.marqueeRect !== null &&
        (rect.minX !== this.marqueeRect.minX ||
          rect.minY !== this.marqueeRect.minY ||
          rect.maxX !== this.marqueeRect.maxX ||
          rect.maxY !== this.marqueeRect.maxY));
    if (!changed) {
      return;
    }
    this.marqueeRect = rect;
    this.notify?.();
  }

  /**
   * Publishes the handle being dragged (the resize gesture updates it;
   * null clears it). The active handle paints larger with an accent glow.
   *
   * @param handle - the dragged handle id, or null.
   */
  public setActiveHandle(handle: ResizeHandleId | null): void {
    if (this.activeHandle === handle) {
      return;
    }
    this.activeHandle = handle;
    this.notify?.();
  }

  /**
   * Publishes the connector endpoint being re-glued (the reconnect gesture
   * updates it; null clears it). The active endpoint paints with a glow.
   *
   * @param endpoint - the dragged endpoint ("start"/"end"), or null.
   */
  public setActiveEndpoint(endpoint: "start" | "end" | null): void {
    if (this.activeEndpoint === endpoint) {
      return;
    }
    this.activeEndpoint = endpoint;
    this.notify?.();
  }

  /**
   * Publishes whether a rotation gesture is running (the rotate handle
   * paints filled with an accent glow while spinning).
   *
   * @param rotating - whether the rotation gesture is active.
   */
  public setRotating(rotating: boolean): void {
    if (this.rotating === rotating) {
      return;
    }
    this.rotating = rotating;
    this.notify?.();
  }

  /**
   * Draws the selection affordances for the given scene: per-object outlines
   * (every group member outlined), the dashed frame with handles around the
   * single selection — truly rotated when the object is tilted — and the
   * live marquee on top.
   *
   * @param context - the canvas 2D context to draw with.
   * @param scene - the scene providing the selection and objects.
   * @param camera - the viewport transform placing handles on screen.
   */
  public drawSelectionHandles(
    context: CanvasRenderingContext2D,
    scene: Scene,
    camera: Camera,
    viewport?: ViewportSize,
  ): void {
    const selection: Selection = scene.selection;
    if (selection.isEmpty() && this.marqueeRect === null) {
      return;
    }

    // فاز ۲۶ «کیفیت انتخاب»: a MULTI-object selection paints every
    // per-object outline at full accent strength (75 % alpha, 1.5 px) so
    // each member reads clearly against the group frame; singles keep
    // the subtle hairline (the dashed frame + handles dominate there).
    const outlineStyle = perObjectOutlineStyle(selection.size > 1, this.palette);

    let union: BBox | null = null;
    let singleSelected: SceneObjectData | null = null;
    let selectedCount = 0;
    for (const object of scene.objects) {
      if (!selection.has(object.id)) {
        continue;
      }
      selectedCount += 1;
      singleSelected = selectedCount === 1 ? object : null;
      // فاز ۲۵/۲۷/۳۰: pinned objects outline in SCREEN space (their world
      // footprint is camera-stale); they never join the world union. The
      // single selection carries the AMBER pin ring, the eight screen-
      // space resize handles (rotation-aware) and the screen-space
      // rotation grip (فاز ۳۰ — spin in place, no unpinning).
      if (isPinnedObject(object) && viewport !== undefined) {
        const width = (object as { readonly width?: number }).width;
        const height = (object as { readonly height?: number }).height;
        if (typeof width === "number" && typeof height === "number") {
          const origin = pinAnchorToScreen(
            object.pinAnchor ?? vec2(0, 0),
            viewport,
          );
          this.strokeScreenBox(
            context,
            origin.x,
            origin.y,
            width,
            height,
            PINNED_SELECTION_COLOR,
            1.5,
            true,
          );
          // فاز ۲۷/۳۰: the resize handles + the rotation grip ride the
          // single pinned selection only (locked objects offer none —
          // they refuse edits).
          if (
            singleSelected !== null &&
            singleSelected.id === object.id &&
            !object.locked
          ) {
            const sized = object as SceneObjectData & {
              readonly width: number;
              readonly height: number;
            };
            this.drawPinnedHandles(context, sized, viewport);
            this.drawPinnedRotationHandle(context, sized, viewport);
          }
        }
        continue;
      }
      if (isGroupObject(object)) {
        // Outline every member, then frame the live union.
        for (const childId of object.childIds) {
          const member = scene.findById(childId);
          if (member === undefined || !member.visible) {
            continue;
          }
          const memberBounds = worldBBoxOf(scene, member);
          this.strokeWorldBox(
            context,
            camera,
            memberBounds,
            outlineStyle.color,
            outlineStyle.lineWidth,
            false,
          );
          union =
            union === null ? memberBounds : bboxUnion(union, memberBounds);
        }
        continue;
      }
      const bounds = worldBBoxOf(scene, object);
      if (object.rotation !== 0) {
        this.strokeRotatedBox(
          context,
          camera,
          objectBBox(object),
          object.rotation,
          false,
          outlineStyle,
        );
      } else {
        this.strokeWorldBox(
          context,
          camera,
          bounds,
          outlineStyle.color,
          outlineStyle.lineWidth,
          false,
        );
      }
      union = union === null ? bounds : bboxUnion(union, bounds);
    }

    if (union !== null) {
      // A single selected connector swaps the resize handles for the two
      // endpoint dots (connectors are re-glued, never resized).
      if (singleSelected !== null && isConnectorObject(singleSelected)) {
        this.strokeWorldBox(
          context,
          camera,
          union,
          this.palette.accent,
          1.5,
          true,
        );
        this.drawConnectorEndpoints(context, camera, scene, singleSelected);
      } else if (
        singleSelected !== null &&
        singleSelected.rotation !== 0 &&
        !isGroupObject(singleSelected)
      ) {
        // A single tilted object: the dashed frame and handles ride the
        // ROTATED edges, not the covering axis-aligned box.
        this.strokeRotatedBox(
          context,
          camera,
          objectBBox(singleSelected),
          singleSelected.rotation,
          true,
        );
        this.drawHandles(
          context,
          camera,
          objectBBox(singleSelected),
          singleSelected.rotation,
        );
        if (!isFreehandObject(singleSelected)) {
          this.drawRotationHandle(
            context,
            camera,
            objectBBox(singleSelected),
            singleSelected.rotation,
          );
        }
      } else {
        this.strokeWorldBox(
          context,
          camera,
          union,
          this.palette.accent,
          1.5,
          true,
        );
        this.drawHandles(context, camera, union, 0);
        // فاز ۲۶: the multi-select COUNT chip rides above the frame's
        // top-right corner (RTL-first) — singles show no badge.
        if (selectedCount > 1) {
          this.drawSelectionCountChip(context, camera, union, selectedCount);
        }
        // The rotation affordance rides single selections only (a plain
        // object or a group whose members spin together, AC2.5).
        if (
          singleSelected !== null &&
          !isConnectorObject(singleSelected) &&
          !isFreehandObject(singleSelected)
        ) {
          const frame = isGroupObject(singleSelected)
            ? union
            : objectBBox(singleSelected);
          const rotation = isGroupObject(singleSelected)
            ? 0
            : singleSelected.rotation;
          this.drawRotationHandle(context, camera, frame, rotation);
        }
      }
    }

    if (this.marqueeRect !== null) {
      this.fillWorldBox(
        context,
        camera,
        this.marqueeRect,
        this.palette.marqueeFill,
      );
      this.strokeWorldBox(
        context,
        camera,
        this.marqueeRect,
        this.palette.marqueeStroke,
        1,
        false,
      );
    }
  }

  /**
   * Draws the eight AMBER screen-space resize handles of a single pinned
   * selection (فاز ۲۷ «تغییر اندازهٔ سنجاق‌شده"): the anchors ride the
   * object's screen footprint (rotated around its centre when tilted) at
   * a constant pixel size — the pinned identity is amber, distinct from
   * the violet world-selection handles. The dragged handle paints larger
   * with a soft glow (the active-handle pattern).
   *
   * @param context - the canvas 2D context to draw with.
   * @param object - the single selected pinned object (sized by construction).
   * @param viewport - the viewport size in CSS pixels.
   */
  private drawPinnedHandles(
    context: CanvasRenderingContext2D,
    object: SceneObjectData & { readonly width: number; readonly height: number },
    viewport: ViewportSize,
  ): void {
    const anchors = pinnedHandleAnchors(object, viewport);
    for (const anchor of anchors) {
      const isActive = anchor.id === this.activeHandle;
      const size = isActive ? ACTIVE_HANDLE_SIZE_PX : HANDLE_SIZE_PX;
      const half = size / 2;
      context.fillStyle = isActive
        ? PINNED_HANDLE_STROKE
        : PINNED_HANDLE_FILL;
      context.strokeStyle = PINNED_HANDLE_STROKE;
      context.lineWidth = 1;
      if (isActive) {
        context.shadowColor = PINNED_HANDLE_STROKE;
        context.shadowBlur = ACTIVE_HANDLE_GLOW_PX;
      }
      context.beginPath();
      context.roundRect(
        anchor.screen.x - half,
        anchor.screen.y - half,
        size,
        size,
        HANDLE_RADIUS_PX,
      );
      context.fill();
      context.stroke();
      if (isActive) {
        context.shadowBlur = 0;
      }
    }
  }

  /**
   * Draws the AMBER screen-space rotation grip of a single pinned
   * selection (فاز ۳۰ «چرخش سنجاق‌شده»): a short stem rising from the
   * (rotated) top edge centre of the screen footprint into a circular
   * grip — the pinned identity is amber, distinct from the violet world
   * rotation handle. The grip paints filled amber with a soft glow while
   * a pinned rotation gesture runs (the `setRotating` pattern).
   *
   * @param context - the canvas 2D context to draw with.
   * @param object - the single selected pinned object (sized by construction).
   * @param viewport - the viewport size in CSS pixels.
   */
  private drawPinnedRotationHandle(
    context: CanvasRenderingContext2D,
    object: SceneObjectData & { readonly width: number; readonly height: number },
    viewport: ViewportSize,
  ): void {
    const anchor = pinnedRotateHandleAnchor(object, viewport);
    if (anchor === null) {
      return;
    }
    const topCenter = pinnedTopCentre(object, viewport);
    const stemLength = ROTATE_HANDLE_OFFSET_PX - ROTATE_HANDLE_RADIUS_PX;
    const direction = { x: anchor.x - topCenter.x, y: anchor.y - topCenter.y };
    const length = Math.hypot(direction.x, direction.y);
    const unit =
      length > 0
        ? { x: direction.x / length, y: direction.y / length }
        : { x: 0, y: -1 };
    const stemEnd = {
      x: topCenter.x + unit.x * stemLength,
      y: topCenter.y + unit.y * stemLength,
    };
    const isActive = this.rotating;
    context.strokeStyle = PINNED_HANDLE_STROKE;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(topCenter.x, topCenter.y);
    context.lineTo(stemEnd.x, stemEnd.y);
    context.stroke();
    context.beginPath();
    context.arc(
      anchor.x,
      anchor.y,
      isActive ? ROTATE_HANDLE_RADIUS_PX + 1.5 : ROTATE_HANDLE_RADIUS_PX,
      0,
      Math.PI * 2,
    );
    if (isActive) {
      context.shadowColor = PINNED_HANDLE_STROKE;
      context.shadowBlur = ACTIVE_HANDLE_GLOW_PX;
      context.fillStyle = PINNED_HANDLE_STROKE;
    } else {
      context.fillStyle = PINNED_HANDLE_FILL;
    }
    context.fill();
    context.strokeStyle = PINNED_HANDLE_STROKE;
    context.lineWidth = 1.5;
    context.stroke();
    if (isActive) {
      context.shadowBlur = 0;
    }
  }

  /**
   * Draws the multi-select count chip (فاز ۲۶ «کیفیت انتخاب»): an accent
   * pill with the selection count riding above the frame's top-right
   * corner (RTL-first reading), label shaped by the injected locale
   * formatter (Persian digits follow the UI setting).
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform placing the chip on screen.
   * @param union - the selection frame's world-space box.
   * @param count - the number of selected objects.
   */
  private drawSelectionCountChip(
    context: CanvasRenderingContext2D,
    camera: Camera,
    union: BBox,
    count: number,
  ): void {
    const label = this.countLabelFormat(count);
    context.save();
    context.font = CHIP_FONT;
    const labelWidth = context.measureText(label).width;
    const chip = selectionCountChipRect(
      this.screenRect(camera, union),
      labelWidth,
    );
    context.beginPath();
    context.roundRect(chip.x, chip.y, chip.width, chip.height, chip.height / 2);
    context.fillStyle = this.palette.accent;
    context.fill();
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    // Digits render identically in both directions; LTR keeps bidi from
    // reordering multi-digit counts.
    context.direction = "ltr";
    context.fillText(label, chip.x + chip.width / 2, chip.y + chip.height / 2 + 0.5);
    context.restore();
  }

  /**
   * Strokes a world-space box in screen space.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param world - the world-space box.
   * @param color - stroke colour.
   * @param lineWidth - stroke width in CSS pixels.
   * @param dashed - whether the stroke uses the dash pattern.
   */
  private strokeWorldBox(
    context: CanvasRenderingContext2D,
    camera: Camera,
    world: BBox,
    color: string,
    lineWidth: number,
    dashed: boolean,
  ): void {
    const rect = this.screenRect(camera, world);
    if (rect.width <= 0 && rect.height <= 0) {
      // Degenerate (single-point) box: draw a minimum visual box so the
      // selection is still visible.
      rect.x -= HANDLE_SIZE_PX / 2;
      rect.y -= HANDLE_SIZE_PX / 2;
      rect.width = HANDLE_SIZE_PX;
      rect.height = HANDLE_SIZE_PX;
    }
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.setLineDash(dashed ? [DASH_PATTERN_PX, DASH_PATTERN_PX] : []);
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    context.setLineDash([]);
  }

  /**
   * Strokes a SCREEN-space box (فاز ۲۵ — the pinned-object selection
   * outline; coordinates are viewport pixels, never camera-projected).
   *
   * @param context - the canvas 2D context to draw with.
   * @param x - left edge in screen pixels.
   * @param y - top edge in screen pixels.
   * @param width - box width in screen pixels.
   * @param height - box height in screen pixels.
   * @param color - stroke colour.
   * @param lineWidth - stroke width in CSS pixels.
   * @param dashed - whether the stroke uses the dash pattern.
   */
  private strokeScreenBox(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    lineWidth: number,
    dashed: boolean,
  ): void {
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.setLineDash(dashed ? [DASH_PATTERN_PX, DASH_PATTERN_PX] : []);
    context.strokeRect(x, y, width, height);
    context.setLineDash([]);
  }

  /**
   * Strokes a world-space box ROTATED around its centre (the true tilted
   * frame of a rotated object). The stroke width stays screen-constant
   * because the rotation is a rigid transform.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param world - the UNROTATED world-space box.
   * @param rotation - the object's rotation (radians).
   * @param accent - whether to use the accent colour + dashed pattern
   *   (selection frame) instead of the per-object outline.
   * @param outline - the فاز ۲۶ per-object outline style (multi-select
   *   strength); defaults to the subtle single-selection hairline.
   */
  private strokeRotatedBox(
    context: CanvasRenderingContext2D,
    camera: Camera,
    world: BBox,
    rotation: number,
    accent = false,
    outline?: PerObjectOutlineStyle,
  ): void {
    const rect = this.screenRect(camera, world);
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    let width = rect.width;
    let height = rect.height;
    if (width <= 0 && height <= 0) {
      width = HANDLE_SIZE_PX;
      height = HANDLE_SIZE_PX;
    }
    context.save();
    context.translate(centerX, centerY);
    context.rotate(rotation);
    context.strokeStyle = accent
      ? this.palette.accent
      : (outline?.color ?? this.palette.objectOutline);
    context.lineWidth = accent ? 1.5 : (outline?.lineWidth ?? 1);
    context.setLineDash(accent ? [DASH_PATTERN_PX, DASH_PATTERN_PX] : []);
    context.strokeRect(-width / 2, -height / 2, width, height);
    context.restore();
    context.setLineDash([]);
  }

  /**
   * Fills a world-space box in screen space (marquee tint).
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param world - the world-space box.
   * @param color - fill colour.
   */
  private fillWorldBox(
    context: CanvasRenderingContext2D,
    camera: Camera,
    world: BBox,
    color: string,
  ): void {
    const rect = this.screenRect(camera, world);
    context.fillStyle = color;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
  }

  /**
   * Draws the two endpoint affordance dots of a selected connector at its
   * LIVE-resolved positions: hollow start dot and filled end dot; the
   * endpoint being re-glued paints with an accent glow.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param scene - the scene providing the glue targets.
   * @param connector - the selected connector.
   */
  private drawConnectorEndpoints(
    context: CanvasRenderingContext2D,
    camera: Camera,
    scene: Scene,
    connector: ConnectorObjectData,
  ): void {
    const resolved = resolveConnectorEndpoints(connector, scene.objects);
    const dots: Array<{
      id: "start" | "end";
      world: { x: number; y: number };
    }> = [
      { id: "start", world: resolved.start },
      { id: "end", world: resolved.end },
    ];
    for (const dot of dots) {
      const screen = camera.worldToScreen(vec2(dot.world.x, dot.world.y));
      const isActive = this.activeEndpoint === dot.id;
      const radius = isActive
        ? ENDPOINT_DOT_RADIUS_PX + 1.5
        : ENDPOINT_DOT_RADIUS_PX;
      if (isActive) {
        context.beginPath();
        context.arc(
          screen.x,
          screen.y,
          radius + ACTIVE_ENDPOINT_GLOW_PX,
          0,
          Math.PI * 2,
        );
        context.fillStyle = withSelectionAlpha(this.palette.accent, "22%");
        context.fill();
        context.shadowColor = this.palette.accent;
        context.shadowBlur = ACTIVE_ENDPOINT_GLOW_PX;
      }
      context.beginPath();
      context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      context.fillStyle = this.palette.handleFill;
      context.fill();
      context.strokeStyle = this.palette.handleStroke;
      context.lineWidth = 1.5;
      if (dot.id === "start") {
        // The start dot carries a small inner marker (a minus) so the two
        // ends read differently at a glance.
        context.beginPath();
        context.moveTo(screen.x - radius * 0.45, screen.y);
        context.lineTo(screen.x + radius * 0.45, screen.y);
      }
      context.stroke();
      if (isActive) {
        context.shadowBlur = 0;
      }
    }
  }

  /**
   * Draws the eight square handles around a world-space box, riding the
   * rotated edges when a rotation is given. The handle being dragged
   * paints larger, filled with the accent colour and backed by a soft glow
   * so the grabbed affordance reads at any zoom.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param world - the UNROTATED world-space box the handles surround.
   * @param rotation - the object's rotation (radians), default 0.
   */
  private drawHandles(
    context: CanvasRenderingContext2D,
    camera: Camera,
    world: BBox,
    rotation = 0,
  ): void {
    const anchors = handleAnchors(world, camera, rotation);
    for (const anchor of anchors) {
      const isActive = anchor.id === this.activeHandle;
      const size = isActive ? ACTIVE_HANDLE_SIZE_PX : HANDLE_SIZE_PX;
      const half = size / 2;
      context.fillStyle = isActive
        ? this.palette.handleStroke
        : this.palette.handleFill;
      context.strokeStyle = this.palette.handleStroke;
      context.lineWidth = 1;
      if (isActive) {
        context.shadowColor = this.palette.accent;
        context.shadowBlur = ACTIVE_HANDLE_GLOW_PX;
      }
      context.beginPath();
      context.roundRect(
        anchor.screen.x - half,
        anchor.screen.y - half,
        size,
        size,
        HANDLE_RADIUS_PX,
      );
      context.fill();
      context.stroke();
      if (isActive) {
        context.shadowBlur = 0;
      }
    }
  }

  /**
   * Draws the rotation handle: a short stem rising from the (rotated) top
   * edge centre into a circular grip. The grip paints filled with the
   * accent colour and a glow while a rotation gesture runs.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param world - the UNROTATED world-space box the handle rides.
   * @param rotation - the object's rotation (radians), default 0.
   */
  private drawRotationHandle(
    context: CanvasRenderingContext2D,
    camera: Camera,
    world: BBox,
    rotation = 0,
  ): void {
    const anchor = rotateHandleAnchor(world, camera, rotation);
    const stemLength = ROTATE_HANDLE_OFFSET_PX - ROTATE_HANDLE_RADIUS_PX;
    const topCenter = this.rotatedTopCenter(camera, world, rotation);
    const direction = { x: anchor.x - topCenter.x, y: anchor.y - topCenter.y };
    const length = Math.hypot(direction.x, direction.y);
    const unit =
      length > 0
        ? { x: direction.x / length, y: direction.y / length }
        : { x: 0, y: -1 };
    const stemEnd = {
      x: topCenter.x + unit.x * stemLength,
      y: topCenter.y + unit.y * stemLength,
    };
    const isActive = this.rotating;
    context.strokeStyle = this.palette.handleStroke;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(topCenter.x, topCenter.y);
    context.lineTo(stemEnd.x, stemEnd.y);
    context.stroke();
    context.beginPath();
    context.arc(
      anchor.x,
      anchor.y,
      isActive ? ROTATE_HANDLE_RADIUS_PX + 1.5 : ROTATE_HANDLE_RADIUS_PX,
      0,
      Math.PI * 2,
    );
    if (isActive) {
      context.shadowColor = this.palette.accent;
      context.shadowBlur = ACTIVE_HANDLE_GLOW_PX;
      context.fillStyle = this.palette.handleStroke;
    } else {
      context.fillStyle = this.palette.handleFill;
    }
    context.fill();
    context.strokeStyle = this.palette.handleStroke;
    context.lineWidth = 1.5;
    context.stroke();
    if (isActive) {
      context.shadowBlur = 0;
    }
  }

  /**
   * Computes the screen-space centre of the (rotated) top edge.
   *
   * @param camera - the viewport transform.
   * @param world - the UNROTATED world-space box.
   * @param rotation - the object's rotation (radians), default 0.
   * @returns the rotated top-edge centre in screen space.
   */
  private rotatedTopCenter(
    camera: Camera,
    world: BBox,
    rotation: number,
  ): { x: number; y: number } {
    const rect = this.screenRect(camera, world);
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const topCenter = { x: rect.x + rect.width / 2, y: rect.y };
    if (rotation === 0) {
      return topCenter;
    }
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const dx = topCenter.x - center.x;
    const dy = topCenter.y - center.y;
    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
    };
  }

  /**
   * Projects a world-space box into a screen-space rect.
   *
   * @param camera - the viewport transform.
   * @param world - the world-space box.
   * @returns the screen-space rect (top-left + width/height).
   */
  private screenRect(
    camera: Camera,
    world: BBox,
  ): { x: number; y: number; width: number; height: number } {
    const min = camera.worldToScreen(vec2(world.minX, world.minY));
    const max = camera.worldToScreen(vec2(world.maxX, world.maxY));
    return {
      x: Math.min(min.x, max.x),
      y: Math.min(min.y, max.y),
      width: Math.abs(max.x - min.x),
      height: Math.abs(max.y - min.y),
    };
  }
}

/**
 * Injects an alpha into a functional CSS colour ("oklch(0.7 0.1 20)" →
 * "oklch(0.7 0.1 20 / 45%)"). Non-functional colours return unchanged.
 *
 * @param color - the base CSS colour string.
 * @param alpha - the alpha channel value (e.g. "45%").
 * @returns the colour with the alpha applied.
 */
function withSelectionAlpha(color: string, alpha: string): string {
  if (color.endsWith(")")) {
    return `${color.slice(0, -1)} / ${alpha})`;
  }
  return color;
}
