/**
 * Canvas 2D implementation of the renderer contract.
 *
 * Renders the grid and every canvas-layer object (freehand strokes in this
 * phase) with viewport culling; text-bearing objects will join via the DOM
 * overlay layer in a later phase (CLAUDE.md §1.3). One frame = clear →
 * grid → objects. In-progress pen drafts are painted by
 * {@link Canvas2DRenderer.renderDrafts} on top of the committed scene.
 *
 * The backing store is DPR-aware: each frame applies
 * `setTransform(dpr, …)` so all drawing happens in CSS pixels.
 */
import {
  GridRenderer,
  DARK_GRID_COLORS,
  LIGHT_GRID_COLORS,
  type GridColors,
} from "@/rendering/GridRenderer";
import {
  DARK_SELECTION_COLORS,
  LIGHT_SELECTION_COLORS,
  type SelectionColors,
} from "@/rendering/HandlesRenderer";
import type { HandlesRenderer } from "@/rendering/HandlesRenderer";
import type { IRenderer } from "@/rendering/IRenderer";
import { Camera } from "@/core/camera/Camera";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import {
  isPinnedObject,
  pinAnchorToScreen,
} from "@/core/model/Pinned";
import {
  isFreehandObject,
  STROKE_COLOR_TOKEN,
  type FreehandObjectData,
} from "@/core/model/FreehandObject";
import {
  SHAPE_FILL_TOKEN,
  isShapeObject,
  type ShapeKind,
  type ShapeObjectData,
} from "@/core/model/ShapeObject";
import {
  isStickerObject,
  type StickerObjectData,
} from "@/core/model/StickerObject";
import { isQueryObject, type QueryObjectData } from "@/core/model/QueryObject";
import {
  connectorPathShape,
  isConnectorObject,
  pathMidpoint,
  resolveConnectorPath,
  type ConnectorEndpoint,
  type ConnectorObjectData,
  type ResolvedConnectorPath,
} from "@/core/model/ConnectorObject";
import { anchorExitVector } from "@/core/model/Anchors";
import { isImageObject, type ImageObjectData } from "@/core/model/ImageObject";
import {
  isVideoObject,
  videoTimecodeLatin,
  type VideoObjectData,
} from "@/core/model/VideoObject";
import {
  audioTimecodeLatin,
  isAudioObject,
  type AudioObjectData,
} from "@/core/model/AudioObject";
import {
  isPdfObject,
  pdfPageBadgeLatin,
  type PdfObjectData,
} from "@/core/model/PdfObject";
import { posterBitmapCache } from "@/media/PosterBitmapCache";
import { assetUrlOf } from "@/media/AssetUrlResolver";
import { smoothedStrokePath } from "@/core/geometry/strokeSmoothing";
import {
  isOpaqueObject,
  type OpaqueObjectData,
} from "@/core/model/OpaqueObject";
import { isFrameObject, type FrameObjectData } from "@/core/model/FrameObject";
import type { ConnectorDraft } from "@/rendering/ConnectorOverlay";
import type { GuidesFrame } from "@/rendering/GuidesOverlay";
import {
  brokenStubEnd,
  type KnowledgeEdgeFrame,
} from "@/rendering/KnowledgeEdgeOverlay";
import { objectBBox, rotatedObjectBBox } from "@/core/model/SceneObject";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";

/** Theme-dependent colours the canvas painter uses. */
export interface RenderPalette {
  /** Canvas background fill. */
  readonly background: string;
  /** Grid layer colours. */
  readonly grid: GridColors;
  /** Colour strokes tagged with the palette token are painted with. */
  readonly stroke: string;
  /** Colour shape fills tagged with the fill token are painted with. */
  readonly shapeFill: string;
  /** Selection and marquee affordance colours. */
  readonly selection: SelectionColors;
  /** Label of the opaque placeholder (i18n-provided, R4.3). */
  readonly opaqueLabel: string;
  /** Label of the broken-image placeholder (i18n-provided, R5.2). */
  readonly brokenImageLabel: string;
  /**
   * Label of the missing-video placeholder (فاز M1, i18n-provided;
   * defaults to the built-in Persian string when absent).
   */
  readonly videoMissingLabel?: string;
  /**
   * Formats the video duration badge value (فاز M1 — i18n digit
   * shaping, the guideNumberFormat pattern); absent → latin digits.
   */
  readonly videoDurationFormat?: (durationMs: number) => string;
  /**
   * Label of the missing-audio placeholder (فاز A1, i18n-provided;
   * defaults to the built-in Persian string when absent).
   */
  readonly audioMissingLabel?: string;

  /** The missing-asset placeholder label of PDF objects (فاز P1 —
   *  RP1.6; rides the palette so the renderer stays i18n-free). */
  readonly pdfMissingLabel?: string;

  /** The page badge formatter of PDF objects (فاز P1 — RP1.5):
   *  `(current, count) => "۲ / ۱۰"` — the DIGIT SHAPING follows the
   *  app's Persian-digits setting at the call site (A.2.8). */
  readonly pdfPageBadgeFormat?: (current: number, count: number) => string;
  /**
   * Formats the audio duration badge value (فاز A1 — i18n digit
   * shaping; absent → the latin timecode core).
   */
  readonly audioDurationFormat?: (durationMs: number) => string;
  /** Smart-guide line colour (R7.4 — magenta in both themes by default). */
  readonly guideColor?: string;
  /** Formats the equal-gap badge value (R7.4 — i18n digit shaping). */
  readonly guideNumberFormat?: (value: number) => string;
  /** Label drawn for a frame with an empty title (R8.3, i18n-provided). */
  readonly frameUntitledLabel?: string;
  /** Live query-card labels (R15.2 + R12.2, i18n-provided). */
  readonly queryLabels?: QueryCardLabels;
  /**
   * Runs one live knowledge query (R15.2) or one structured filter
   * (R12.2 — the full QuerySpec through the engine) — injected by the
   * canvas host so the renderer stays framework-free; absent → cards
   * draw header-only. `selfId` carries the recursion guard.
   */
  readonly queryResolver?: (
    request: QueryCardRequest,
  ) => import("@/core/knowledge/KnowledgeQueries").KnowledgeQueryResult;
  /** On-canvas knowledge-edge colour (R12.4 — theme accent by default). */
  readonly knowledgeEdgeColor?: string;
  /** On-canvas broken-link stub colour (R12.4 — destructive red). */
  readonly knowledgeBrokenColor?: string;
}

/** Translated labels of the live query card (R15.2 + R12.2). */
export interface QueryCardLabels {
  /** Header of a backlinks card («پیوندهای ورودی»). */
  readonly backlinks: string;
  /** Header of a tag card («برچسب»). */
  readonly tag: string;
  /** Header of a broken-links card («پیوندهای گمشده»). */
  readonly broken: string;
  /** Header of an islands card («جزیره‌ها»). */
  readonly orphans: string;
  /** Header of a structured-filter card (R12.2, «فیلتر ساخت‌یافته»). */
  readonly filter: string;
  /** Inline hint when the target does not exist («هدف ناموجود»). */
  readonly missing: string;
  /** Untitled row substitute («شیء بدون عنوان»). */
  readonly untitled: string;
  /** Untitled group bucket label (R12.2, «بدون گروه»). */
  readonly ungrouped: string;
}

/** One live query-card resolve request (the renderer → host seam). */
export interface QueryCardRequest {
  /** The query kind. */
  readonly type: import("@/core/model/QueryObject").QueryType;
  /** The target key (knowledge kinds). */
  readonly target: string;
  /** The structured engine spec (the `filter` kind only). */
  readonly structured?: import("@/core/knowledge/QueryEngine").SceneQuerySpec;
  /** The results table's property columns (≤ 3, display only). */
  readonly columns?: readonly string[];
  /** The card's own id (the R12.2 recursion guard). */
  readonly selfId?: string;
}

/** Screen font size of connector labels (fixed — readable at any zoom, AC5.3). */
const CONNECTOR_LABEL_FONT_PX = 11;

/** Largest label text width before ellipsizing, in screen pixels. */
const CONNECTOR_LABEL_MAX_PX = 140;

/** Horizontal padding inside the connector label chip. */
const CONNECTOR_LABEL_PAD_X = 6;

/** Vertical padding inside the connector label chip. */
const CONNECTOR_LABEL_PAD_Y = 3;

/** Opacity of highlighter strokes (R5.4: semi-transparent marker ink). */
const HIGHLIGHTER_ALPHA = 0.45;

/** Screen-space stroke width of smart-guide lines (R7.4). */
const GUIDE_LINE_PX = 1;

/** Screen font size of the equal-gap badges (R7.4). */
const GUIDE_BADGE_FONT_PX = 11;

/** Horizontal padding inside the gap badge. */
const GUIDE_BADGE_PAD_X = 6;

/** Vertical padding inside the gap badge. */
const GUIDE_BADGE_PAD_Y = 3;

/** Magenta smart-guide colour (readable on both themes — R7.4). */
const GUIDE_COLOR = "#EC4899";

/** Default knowledge-edge colour (R12.4 — the app's teal accent). */
const KNOWLEDGE_EDGE_COLOR = "#14b8a6";

/** Default broken-link stub colour (R12.4 — destructive red). */
const KNOWLEDGE_BROKEN_COLOR = "#dc2626";

/** Screen font size of the broken-target stub labels (R12.4). */
const KNOWLEDGE_STUB_FONT_PX = 10;

/** Max broken-target label characters before ellipsis (R12.4). */
const KNOWLEDGE_STUB_LABEL_MAX = 14;

/**
 * Amber pinned-object ring colour (فاز ۲۵ — readable on both themes).
 * فاز ۲۷: the SELECTED state stays amber too (the pin identity) — the
 * amber reads "pinned" against the violet world-selection language.
 */
const PIN_RING_COLOR = "oklch(0.8 0.14 80 / 65%)";

/** Amber stroke of a selected pinned object's chrome ring (فاز ۲۷). */
const PIN_RING_SELECTED_COLOR = "oklch(0.8 0.14 80)";

/** Radius of the pinned-state pin chip (فاز ۲۵), CSS pixels. */
const PIN_CHIP_RADIUS_PX = 9;

/** Dash pattern of a selected pinned object's ring (فاز ۲۵). */
const DASH_PATTERN_PX = 5;

/** Default dark-theme palette (oklch strings — Canvas 2D understands them). */
export const DARK_PALETTE: RenderPalette = {
  background: "oklch(0.145 0 0)",
  grid: DARK_GRID_COLORS,
  stroke: "oklch(0.84 0.16 340)",
  shapeFill: "oklch(0.72 0.17 340 / 20%)",
  selection: DARK_SELECTION_COLORS,
  opaqueLabel: "شیء ناشناخته",
  brokenImageLabel: "تصویر در دسترس نیست",
  videoMissingLabel: "ویدئو در دسترس نیست",
  audioMissingLabel: "صوت در دسترس نیست",
  pdfMissingLabel: "سند PDF در دسترس نیست",
  frameUntitledLabel: "قاب بدون عنوان",
};

/** Default light-theme palette. */
export const LIGHT_PALETTE: RenderPalette = {
  background: "oklch(0.985 0 0)",
  grid: LIGHT_GRID_COLORS,
  stroke: "oklch(0.5 0.2 340)",
  shapeFill: "oklch(0.55 0.21 340 / 14%)",
  selection: LIGHT_SELECTION_COLORS,
  opaqueLabel: "شیء ناشناخته",
  brokenImageLabel: "تصویر در دسترس نیست",
  videoMissingLabel: "ویدئو در دسترس نیست",
  audioMissingLabel: "صوت در دسترس نیست",
  pdfMissingLabel: "سند PDF در دسترس نیست",
  frameUntitledLabel: "قاب بدون عنوان",
};

/** Default renderer drawing the scene with the Canvas 2D API. */
export class Canvas2DRenderer implements IRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private readonly grid: GridRenderer;
  private palette: RenderPalette;
  /** Whether the dotted background grid is drawn (Ctrl+' toggle). */
  private gridVisible = true;

  /**
   * R3B5.4 seams audit: the per-kind canvas drawer LOOKUP TABLE — the
   * object-kind dispatch that used to be an if-chain. Signatures are
   * unified (context/camera/object/scene/viewport); each entry narrows
   * its object through the model's type guards. Kinds without an entry
   * (text boxes, sticky notes, groups) render through the DOM overlay —
   * the Phase 4/9 ObjectRegistry will generalise this table to
   * contributions.
   */
  private readonly canvasDrawers: Record<
    string,
    | undefined
    | ((
        context: CanvasRenderingContext2D,
        camera: Camera,
        object: import("@/core/model/SceneObject").SceneObjectData,
        scene: Scene,
        viewport: { minX: number; minY: number; maxX: number; maxY: number },
      ) => void)
  > = {
    freehand: (context, camera, object, _scene, viewport) => {
      if (isFreehandObject(object)) {
        this.drawFreehand(context, camera, object, viewport);
      }
    },
    shape: (context, camera, object, _scene, viewport) => {
      if (isShapeObject(object)) {
        this.drawShape(context, camera, object, viewport);
      }
    },
    connector: (context, camera, object, scene, viewport) => {
      if (isConnectorObject(object)) {
        this.drawConnector(context, camera, object, scene, viewport);
      }
    },
    image: (context, camera, object, _scene, viewport) => {
      if (isImageObject(object)) {
        this.drawImage(context, camera, object, viewport);
      }
    },
    video: (context, camera, object, _scene, viewport) => {
      if (isVideoObject(object)) {
        this.drawVideo(context, camera, object, viewport);
      }
    },
    audio: (context, camera, object, _scene, viewport) => {
      if (isAudioObject(object)) {
        this.drawAudio(context, camera, object, viewport);
      }
    },
    pdf: (context, camera, object, _scene, viewport) => {
      if (isPdfObject(object)) {
        this.drawPdf(context, camera, object, viewport);
      }
    },
    opaque: (context, camera, object, _scene, viewport) => {
      if (isOpaqueObject(object)) {
        this.drawOpaque(context, camera, object, viewport);
      }
    },
    frame: (context, camera, object, _scene, viewport) => {
      if (isFrameObject(object)) {
        this.drawFrame(context, camera, object, viewport);
      }
    },
    sticker: (context, camera, object, _scene, viewport) => {
      if (isStickerObject(object)) {
        this.drawSticker(context, camera, object, viewport);
      }
    },
    query: (context, camera, object, _scene, viewport) => {
      if (isQueryObject(object)) {
        this.drawQuery(context, camera, object, viewport);
      }
    },
  };

  /** Selection handles painter attached by the canvas host. */
  private handles: HandlesRenderer | null = null;

  /**
   * Decoded image cache keyed by data URL (image objects share sources by
   * value — the map grows with distinct pasted bitmaps only).
   */
  private readonly imageCache = new Map<string, HTMLImageElement>();

  /** Repaint notifier invoked when a cached image finishes decoding. */
  private repaintNotifier: (() => void) | null = null;

  /** The on-canvas knowledge-edge frame (null = the overlay is off). */
  private knowledgeEdgeFrame: KnowledgeEdgeFrame | null = null;

  /**
   * @param style - grid style delegated to the {@link GridRenderer}.
   */
  public constructor(style: "dots" | "lines" = "dots") {
    this.grid = new GridRenderer(style);
    this.palette = DARK_PALETTE;
  }

  /**
   * Prepares the renderer for its target canvas.
   *
   * @param canvas - the canvas element to draw into.
   */
  public initialize(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
  }

  /**
   * Attaches the selection-handles painter (the composition root owns the
   * instance so tools and the renderer share it).
   *
   * @param handles - the handles painter drawn at the end of every frame.
   */
  public attachHandles(handles: HandlesRenderer): void {
    this.handles = handles;
    handles.setPalette(this.palette.selection);
  }

  /**
   * Replaces the palette (theme switch); the next frame uses it.
   *
   * @param palette - the new theme palette.
   */
  public setPalette(palette: RenderPalette): void {
    this.palette = palette;
    this.grid.setColors(palette.grid);
    this.handles?.setPalette(palette.selection);
  }

  /**
   * Shows or hides the background grid + origin marker; the next frame
   * reflects the change (the host marks the loop dirty).
   *
   * @param visible - whether the grid is drawn.
   */
  public setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
  }

  /**
   * Replaces the background grid's base cell spacing (R8.2 — the
   * Settings dialog's canvas section); the next frame reflects it.
   *
   * @param spacing - the base world-space spacing (≥ 1).
   */
  public setGridBaseSpacing(spacing: number): void {
    this.grid.setBaseSpacing(spacing);
  }

  /**
   * Sets the on-canvas knowledge-edge frame (pack R12.4). The host
   * rebuilds the frame on knowledge/selection changes and passes null
   * while the overlay is toggled off; the PAINTER resolves the live
   * object geometry each frame, so no further invalidation is needed.
   *
   * @param frame - the edge frame, or null to hide the overlay.
   */
  public setKnowledgeEdgeFrame(frame: KnowledgeEdgeFrame | null): void {
    this.knowledgeEdgeFrame = frame;
  }

  /**
   * Draws one frame: background fill, grid, then every visible object
   * (culled against the world-space viewport).
   *
   * @param scene - the scene model to render.
   * @param camera - the viewport transform to render with.
   */
  public render(scene: Scene, camera: Camera): void {
    const context = this.context;
    if (context === null || this.canvas === null) {
      return;
    }
    const size = this.cssSize();
    if (size.width === 0 || size.height === 0) {
      return;
    }

    const dpr = this.canvas.width / size.width;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = this.palette.background;
    context.fillRect(0, 0, size.width, size.height);

    if (this.gridVisible) {
      this.grid.drawGrid(context, camera);
    }

    const viewport = worldViewport(camera, size.width, size.height);
    let hasPinned = false;
    for (const object of scene.objects) {
      if (!object.visible) {
        continue;
      }
      // فاز ۲۵ «سنجاش روی صفحه»: pinned objects render in a SECOND pass
      // with an identity camera (screen space) — they float above the
      // world like screen furniture.
      if (isPinnedObject(object)) {
        hasPinned = true;
        continue;
      }
      // R3B5.4 seams audit: the per-kind canvas drawer is a LOOKUP, not an
      // if-chain — object-kind dispatch lives in this one table (the
      // ObjectRegistry in Phase 4/9 generalises it to contributions).
      const draw = this.canvasDrawers[object.kind];
      draw?.call(this, context, camera, object, scene, viewport);
    }
    if (hasPinned) {
      this.renderPinnedPass(context, scene, size);
    }

    // Selection affordances (per-object outlines, union box, handles) paint
    // above the objects; pen drafts still draw on top in renderDrafts.
    if (this.knowledgeEdgeFrame !== null) {
      this.drawKnowledgeEdges(context, camera, scene);
    }
    this.handles?.drawSelectionHandles(
      context,
      scene,
      camera,
      { width: size.width, height: size.height },
    );
  }

  /**
   * فاز ۲۵ «سنجاش روی صفحه»: the SCREEN-space pass. Pinned objects paint
   * through their regular drawers but with an IDENTITY camera and the
   * position swapped for the anchor's screen pixels — so every per-kind
   * drawer (shape/image/sticker) works unchanged, sizes render at scale 1
   * and the camera rotation never applies (upright screen furniture). A
   * soft amber ring + pin chip marks the pinned state.
   *
   * @param context - the canvas 2D context to draw with.
   * @param scene - the scene providing the pinned objects.
   * @param size - the CSS-pixel canvas size (the anchor space).
   */
  private renderPinnedPass(
    context: CanvasRenderingContext2D,
    scene: Scene,
    size: { width: number; height: number },
  ): void {
    const viewport: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    } = { minX: 0, minY: 0, maxX: size.width, maxY: size.height };
    const camera = new Camera(0, 0, 1, 0);
    const selection = scene.selection;
    for (const object of scene.objects) {
      if (!object.visible || !isPinnedObject(object)) {
        continue;
      }
      const origin = pinAnchorToScreen(
        object.pinAnchor ?? vec2(0, 0),
        size,
      );
      const draw = this.canvasDrawers[object.kind];
      if (draw !== undefined) {
        draw.call(this, context, camera, { ...object, position: origin }, scene, viewport);
      }
      this.drawPinnedChrome(
        context,
        origin,
        object,
        selection.has(object.id),
      );
    }
  }

  /**
   * Draws the pinned-state chrome (فاز ۲۵): a soft amber rounded ring and
   * a pin chip at the top-right corner — subtle at rest, accent-coloured
   * while selected.
   *
   * @param context - the canvas 2D context to draw with.
   * @param origin - the object's screen-space origin.
   * @param object - the pinned object (sized kinds only by construction).
   * @param selected - whether the object is in the live selection.
   */
  private drawPinnedChrome(
    context: CanvasRenderingContext2D,
    origin: Vec2,
    object: SceneObjectData,
    selected: boolean,
  ): void {
    const width = (object as { readonly width?: number }).width;
    const height = (object as { readonly height?: number }).height;
    if (typeof width !== "number" || typeof height !== "number") {
      return;
    }
    context.save();
    // Soft ring (dashed while selected — the selection affordance
    // language of the world pass, mirrored in screen space).
    context.strokeStyle = selected
      ? PIN_RING_SELECTED_COLOR
      : PIN_RING_COLOR;
    context.lineWidth = selected ? 1.5 : 1;
    if (selected) {
      context.setLineDash([DASH_PATTERN_PX]);
    }
    this.roundedRectPath(
      context,
      origin.x - 3,
      origin.y - 3,
      width + 6,
      height + 6,
      8,
    );
    context.stroke();
    context.setLineDash([]);
    // The pin chip: a small circular badge with the 📌 glyph, riding the
    // top-right corner.
    const chipX = origin.x + width + 2;
    const chipY = origin.y - 2;
    context.beginPath();
    context.arc(chipX, chipY, PIN_CHIP_RADIUS_PX, 0, Math.PI * 2);
    context.fillStyle = this.palette.background;
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = selected
      ? PIN_RING_SELECTED_COLOR
      : PIN_RING_COLOR;
    context.stroke();
    context.font = `${PIN_CHIP_RADIUS_PX * 1.25}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.direction = "ltr";
    context.fillText("📌", chipX, chipY + 0.5);
    context.restore();
  }

  /**
   * Builds a rounded-rectangle path (no fill/stroke — caller paints).
   *
   * @param context - the canvas 2D context.
   * @param x - left edge.
   * @param y - top edge.
   * @param width - rectangle width.
   * @param height - rectangle height.
   * @param radius - corner radius.
   */
  private roundedRectPath(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.arcTo(x + width, y, x + width, y + r, r);
    context.lineTo(x + width, y + height - r);
    context.arcTo(x + width, y + height, x + width - r, y + height, r);
    context.lineTo(x + r, y + height);
    context.arcTo(x, y + height, x, y + height - r, r);
    context.lineTo(x, y + r);
    context.arcTo(x, y, x + r, y, r);
    context.closePath();
  }

  /**
   * Paints the in-progress pen drafts above the committed scene.
   *
   * @param drafts - transient draft strokes (see `StrokeOverlay`).
   * @param camera - the viewport transform to render with.
   */
  public renderDrafts(
    drafts: readonly FreehandObjectData[],
    camera: Camera,
  ): void {
    const context = this.context;
    if (context === null || this.canvas === null || drafts.length === 0) {
      return;
    }
    const size = this.cssSize();
    const viewport = worldViewport(camera, size.width, size.height);
    for (const draft of drafts) {
      this.drawFreehand(context, camera, draft, viewport);
    }
  }

  /**
   * Paints the in-progress shape draft above the committed scene.
   *
   * @param draft - transient shape draft (see `ShapeOverlay`), or null.
   * @param camera - the viewport transform to render with.
   */
  public renderShapeDraft(draft: ShapeObjectData | null, camera: Camera): void {
    const context = this.context;
    if (context === null || this.canvas === null || draft === null) {
      return;
    }
    const size = this.cssSize();
    const viewport = worldViewport(camera, size.width, size.height);
    this.drawShape(context, camera, draft, viewport);
  }

  /**
   * Paints the in-progress connector rubber-band above the committed scene:
   * a semi-transparent preview of the final path plus the glue affordances —
   * the hovered target's bounds glow, the glued start dot and the snap/hollow
   * end dot.
   *
   * @param draft - transient connector draft (see `ConnectorOverlay`), or null.
   * @param camera - the viewport transform to render with.
   * @param scene - the scene providing the glue-target bounds.
   */
  public renderConnectorDraft(
    draft: ConnectorDraft | null,
    camera: Camera,
    scene: Scene,
  ): void {
    const context = this.context;
    if (context === null || this.canvas === null || draft === null) {
      return;
    }
    const accent = this.palette.stroke;

    // Glue-target affordance: a soft accent glow around the hovered object.
    if (draft.end.objectId !== null) {
      const target = scene.findById(draft.end.objectId);
      if (target !== undefined) {
        this.strokeWorldBox(
          context,
          camera,
          objectBBox(target),
          withAlpha(accent, "38%"),
          2,
        );
        this.fillWorldBox(
          context,
          camera,
          objectBBox(target),
          withAlpha(accent, "10%"),
        );
      }
    }

    const startScreen = camera.worldToScreen(draft.start.position);
    const endScreen = camera.worldToScreen(draft.end.position);
    // Rubber-band path: exit-aware when both ends are glued (mirrors the
    // committed geometry), perpendicular fallback otherwise.
    const shape = this.toScreenShape(
      connectorPathShape(
        draft.style.routing,
        draft.start.position,
        draft.end.position,
        draftExit(draft.start, scene),
        draftExit(draft.end, scene),
      ),
      camera,
    );
    const width = Math.max(draft.style.width * camera.zoom, 1);

    context.save();
    context.strokeStyle = withAlpha(accent, "85%");
    context.lineWidth = width;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.setLineDash([
      6 * this.dashScale(camera),
      5 * this.dashScale(camera),
    ]);
    this.traceConnectorPath(context, shape);
    context.stroke();
    context.restore();

    // End arrowhead preview (mirrors the commit style).
    if (draft.style.endArrow === "arrow") {
      this.drawArrowHead(
        context,
        endScreen,
        pathEndTangent(shape),
        this.arrowSize(width),
        accent,
      );
    }

    // Endpoint dots: the glued start is a solid accent dot with a light
    // ring; the end snaps (solid + halo ring) while over an object and
    // floats (hollow) over empty canvas.
    this.drawDraftDot(context, startScreen, "filled", accent);
    this.drawDraftDot(
      context,
      endScreen,
      draft.end.objectId !== null ? "snap" : "hollow",
      accent,
    );
  }

  /**
   * Paints the transient smart-guide overlay (R7.4): magenta alignment
   * lines (1px screen space) spanning the matched boxes, plus equal-gap
   * value badges. The gap value is formatted through the palette's
   * number formatter so Persian digit shaping follows the UI setting.
   *
   * @param frame - the current guide frame (see `GuidesOverlay`).
   * @param camera - the viewport transform to render with.
   */
  public renderGuides(frame: GuidesFrame, camera: Camera): void {
    const context = this.context;
    if (context === null || this.canvas === null) {
      return;
    }
    if (frame.lines.length === 0 && frame.hints.length === 0) {
      return;
    }
    const color = this.palette.guideColor ?? GUIDE_COLOR;
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = GUIDE_LINE_PX;
    context.lineCap = "butt";
    for (const line of frame.lines) {
      if (line.axis === "x") {
        const screenX = camera.worldToScreen(vec2(line.coordinate, 0)).x;
        const fromY = camera.worldToScreen(vec2(0, line.from)).y;
        const toY = camera.worldToScreen(vec2(0, line.to)).y;
        context.beginPath();
        context.moveTo(Math.round(screenX) + 0.5, fromY);
        context.lineTo(Math.round(screenX) + 0.5, toY);
        context.stroke();
      } else {
        const screenY = camera.worldToScreen(vec2(0, line.coordinate)).y;
        const fromX = camera.worldToScreen(vec2(line.from, 0)).x;
        const toX = camera.worldToScreen(vec2(line.to, 0)).x;
        context.beginPath();
        context.moveTo(fromX, Math.round(screenY) + 0.5);
        context.lineTo(toX, Math.round(screenY) + 0.5);
        context.stroke();
      }
    }
    const format =
      this.palette.guideNumberFormat ??
      ((value: number) => String(Math.round(value)));
    for (const hint of frame.hints) {
      const screen = camera.worldToScreen(vec2(hint.centre.x, hint.centre.y));
      const label = format(hint.gap);
      context.font = `600 ${GUIDE_BADGE_FONT_PX}px Vazirmatn, ui-sans-serif, system-ui`;
      const width = context.measureText(label).width + GUIDE_BADGE_PAD_X * 2;
      const height = GUIDE_BADGE_FONT_PX + GUIDE_BADGE_PAD_Y * 2;
      const x = screen.x - width / 2;
      const y = screen.y - height / 2;
      context.save();
      context.fillStyle = color;
      context.beginPath();
      context.roundRect(x, y, width, height, 4);
      context.fill();
      context.fillStyle = "#FFFFFF";
      context.textAlign = "center";
      context.textBaseline = "middle";
      // BiDi-safe: a bare number renders identically either direction.
      context.fillText(label, screen.x, screen.y + 0.5);
      context.restore();
    }
    context.restore();
  }

  /** Releases the canvas reference and the decoded image cache. */
  public dispose(): void {
    this.canvas = null;
    this.context = null;
    this.imageCache.clear();
    this.repaintNotifier = null;
  }

  /**
   * Installs the repaint notifier invoked when a cached image finishes
   * decoding (the host wires it to `RenderLoop.markDirty` so late-decoding
   * bitmaps appear without any extra frame scheduling of their own).
   *
   * @param notifier - the repaint request callback, or null to clear.
   */
  public setRepaintNotifier(notifier: (() => void) | null): void {
    this.repaintNotifier = notifier;
    // فاز M1: late-decoding video posters share the exact seam — the
    // shared bitmap cache announces itself through the SAME notifier.
    posterBitmapCache.setNotifier(() => this.repaintNotifier?.());
  }

  /**
   * Preloads the bitmaps of every image object into the decode cache so
   * the NEXT {@link Canvas2DRenderer.render} paints them synchronously —
   * the export pipeline (R4.8) calls this before rendering an offscreen
   * frame, where a late decode would silently drop the image from the
   * exported PNG.
   *
   * @param scene - the scene whose image objects should be decoded.
   * @returns whether every bitmap finished decoding (a failed data URL
   *          resolves false — the export proceeds with what decoded).
   */
  public async preloadImages(scene: Scene): Promise<boolean> {
    let allDecoded = true;
    const sources = new Set<string>();
    const posterSources = new Set<string>();
    for (const object of scene.objects) {
      if (isImageObject(object)) {
        sources.add(object.src);
      } else if (isVideoObject(object) && object.thumbHash !== null) {
        // فاز M1: video posters preload through the shared bitmap cache
        // (decode-once — the export renders them synchronously after).
        const url = assetUrlOf(object.thumbHash);
        if (url !== null) {
          posterSources.add(url);
        } else {
          allDecoded = false;
        }
      } else if (isAudioObject(object) && object.thumbHash !== null) {
        // فاز A1: audio waveform posters preload through the SAME shared
        // bitmap cache (decode-once — identical export semantics).
        const url = assetUrlOf(object.thumbHash);
        if (url !== null) {
          posterSources.add(url);
        } else {
          allDecoded = false;
        }
      } else if (isPdfObject(object) && object.thumbHash !== null) {
        // فاز P1: PDF page posters preload through the SAME shared
        // bitmap cache (decode-once — the export renders the CURRENT
        // page's poster in place, never a live PDF, RP1.8).
        const url = assetUrlOf(object.thumbHash);
        if (url !== null) {
          posterSources.add(url);
        } else {
          allDecoded = false;
        }
      }
    }
    await Promise.all(
      [...sources].map(
        (src) =>
          new Promise<void>((resolve) => {
            const cached = this.imageCache.get(src);
            if (
              cached !== undefined &&
              cached.complete &&
              cached.naturalWidth > 0
            ) {
              resolve();
              return;
            }
            const image = new Image();
            image.decoding = "async";
            image.onload = () => resolve();
            image.onerror = () => {
              allDecoded = false;
              resolve();
            };
            image.src = src;
            this.imageCache.set(src, image);
          }),
      ),
    );
    if (posterSources.size > 0) {
      const posters = await Promise.all(
        [...posterSources].map((url) => posterBitmapCache.preload(url)),
      );
      if (posters.some((decoded) => !decoded)) {
        allDecoded = false;
      }
    }
    return allDecoded;
  }

  /**
   * Resolves (and lazily starts decoding) the bitmap for a data URL. Loaded
   * images draw this frame; images still decoding are skipped silently and
   * announce themselves through the repaint notifier once ready.
   *
   * @param src - the data-URL source.
   * @returns the decoded element, or null while it is unavailable.
   */
  private resolveImageBitmap(src: string): HTMLImageElement | null {
    const cached = this.imageCache.get(src);
    if (cached !== undefined) {
      return cached.complete && cached.naturalWidth > 0 ? cached : null;
    }
    const image = new Image();
    image.decoding = "async";
    image.onload = () => this.repaintNotifier?.();
    image.src = src;
    this.imageCache.set(src, image);
    return null;
  }

  /**
   * @param src - the image source to inspect.
   * @returns whether the cached bitmap DEFINITIVELY failed to decode
   *          (`complete` with a zero intrinsic size — a data URL the engine
   *          refuses, or a payload that is not an image at all).
   */
  private isImageBroken(src: string): boolean {
    const cached = this.imageCache.get(src);
    return (
      cached !== undefined &&
      cached.complete &&
      cached.naturalWidth === 0 &&
      cached.naturalHeight === 0
    );
  }

  /**
   * Draws the broken/missing-asset placeholder of one image object (R5.2):
   * a dashed frame over the object's placed footprint, a soft accent tint
   * and the Persian message from the palette — mirroring the opaque
   * placeholder contract so both read as "occupied but unavailable".
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param image - the image object whose asset failed to decode.
   */
  private drawImagePlaceholder(
    context: CanvasRenderingContext2D,
    camera: Camera,
    image: ImageObjectData,
  ): void {
    const center = camera.worldToScreen(
      vec2(
        image.position.x + image.width / 2,
        image.position.y + image.height / 2,
      ),
    );
    const width = Math.max(image.width * camera.zoom, 1);
    const height = Math.max(image.height * camera.zoom, 1);
    const accent = this.palette.stroke;

    context.save();
    context.translate(center.x, center.y);
    context.rotate(camera.rotation + image.rotation);
    context.fillStyle = withAlpha(accent, "8%");
    context.fillRect(-width / 2, -height / 2, width, height);
    context.strokeStyle = withAlpha(accent, "65%");
    context.lineWidth = 1.5;
    context.setLineDash([6, 4]);
    context.strokeRect(
      -width / 2 + 0.75,
      -height / 2 + 0.75,
      width - 1.5,
      height - 1.5,
    );
    context.setLineDash([]);
    const fontSize = Math.min(Math.max(Math.min(width, height) / 3, 10), 18);
    if (width > fontSize * 3 && height > fontSize * 1.7) {
      context.fillStyle = withAlpha(accent, "90%");
      context.font = `${fontSize}px Vazirmatn, Tahoma, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.direction = "rtl";
      context.fillText(this.palette.brokenImageLabel, 0, 0);
    }
    context.restore();
  }

  /**
   * Draws one image object: the decoded bitmap mapped exactly through the
   * camera transform. The projected rect is the object rect rotated by
   * `camera.rotation + image.rotation` around its projected centre (both
   * rotations compose additively — the camera's linear part is the uniform
   * zoom times its rotation), so the mapping stays exact for tilted cameras
   * AND tilted objects. A crisp hairline border frames the bitmap so light
   * PNGs remain visible on the light theme.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param image - the image data to paint.
   * @param viewport - world-space culling bounds.
   */
  private drawImage(
    context: CanvasRenderingContext2D,
    camera: Camera,
    image: ImageObjectData,
    viewport: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    if (image.width <= 0 || image.height <= 0) {
      return;
    }
    const pad = 2 / camera.zoom;
    const cullBox = image.rotation !== 0 ? rotatedObjectBBox(image) : null;
    const minX = cullBox ? cullBox.minX : image.position.x;
    const minY = cullBox ? cullBox.minY : image.position.y;
    const maxX = cullBox ? cullBox.maxX : image.position.x + image.width;
    const maxY = cullBox ? cullBox.maxY : image.position.y + image.height;
    if (
      maxX + pad < viewport.minX ||
      minX - pad > viewport.maxX ||
      maxY + pad < viewport.minY ||
      minY - pad > viewport.maxY
    ) {
      return;
    }
    const bitmap = this.resolveImageBitmap(image.src);
    if (bitmap === null) {
      // R5.2: a definitive decode failure paints the broken-asset
      // placeholder (dashed frame + Persian message); a still-loading
      // bitmap stays silent — the async onload repaints when it lands.
      if (this.isImageBroken(image.src)) {
        this.drawImagePlaceholder(context, camera, image);
      }
      return;
    }

    // Exact affine mapping: project the object's centre, then compose both
    // rotations around it (see the method doc — the math holds for any
    // camera whose linear part is zoom·R(θ)).
    const center = camera.worldToScreen(
      vec2(
        image.position.x + image.width / 2,
        image.position.y + image.height / 2,
      ),
    );
    const width = Math.max(image.width * camera.zoom, 1);
    const height = Math.max(image.height * camera.zoom, 1);

    context.save();
    context.translate(center.x, center.y);
    context.rotate(camera.rotation + image.rotation);
    context.drawImage(bitmap, -width / 2, -height / 2, width, height);
    // Hairline frame so light PNGs stay visible on the light theme (and
    // the object's footprint stays readable while transformed).
    context.strokeStyle = this.palette.selection.objectOutline;
    context.lineWidth = 1;
    context.strokeRect(
      -width / 2 + 0.5,
      -height / 2 + 0.5,
      width - 1,
      height - 1,
    );
    context.restore();
  }

  /**
   * Draws one video object (فاز M1 — A.2.2/A.2.7): the poster bitmap (or
   * the film-icon fallback when thumbnail capture failed) mapped through
   * the EXACT {@link drawImage} affine path — the projected centre, the
   * additive camera+object rotation, the hairline frame — plus the
   * thumbnail chrome: a centered play glyph and the duration badge
   * (Persian digits per setting through the palette's formatter), both
   * painted INSIDE the rotated frame so they transform with the object.
   * The canvas NEVER holds a `<video>` element; a missing poster paints
   * the dashed placeholder instead (ACM1.5).
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param video - the video object data to paint.
   * @param viewport - world-space culling bounds.
   */
  private drawVideo(
    context: CanvasRenderingContext2D,
    camera: Camera,
    video: VideoObjectData,
    viewport: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    if (video.width <= 0 || video.height <= 0) {
      return;
    }
    const pad = 2 / camera.zoom;
    const cullBox = video.rotation !== 0 ? rotatedObjectBBox(video) : null;
    const minX = cullBox ? cullBox.minX : video.position.x;
    const minY = cullBox ? cullBox.minY : video.position.y;
    const maxX = cullBox ? cullBox.maxX : video.position.x + video.width;
    const maxY = cullBox ? cullBox.maxY : video.position.y + video.height;
    if (
      maxX + pad < viewport.minX ||
      minX - pad > viewport.maxX ||
      maxY + pad < viewport.minY ||
      minY - pad > viewport.maxY
    ) {
      return;
    }

    // Poster resolution: null thumbHash → the film-icon fallback (the
    // object is valid — only the capture failed, A.2.2); a hash that
    // cannot resolve (missing asset / no store) → the dashed placeholder.
    const posterUrl =
      video.thumbHash !== null ? assetUrlOf(video.thumbHash) : null;
    if (video.thumbHash !== null && posterUrl === null) {
      this.drawVideoPlaceholder(context, camera, video);
      return;
    }
    const poster = posterUrl !== null ? posterBitmapCache.resolve(posterUrl) : null;
    if (poster !== null && poster.state === "broken") {
      this.drawVideoPlaceholder(context, camera, video);
      return;
    }
    if (poster !== null && poster.image === null) {
      // Still decoding — silent; the shared cache announces the repaint.
      return;
    }

    const center = camera.worldToScreen(
      vec2(
        video.position.x + video.width / 2,
        video.position.y + video.height / 2,
      ),
    );
    const width = Math.max(video.width * camera.zoom, 1);
    const height = Math.max(video.height * camera.zoom, 1);

    context.save();
    context.translate(center.x, center.y);
    context.rotate(camera.rotation + video.rotation);
    if (poster !== null && poster.image !== null) {
      context.drawImage(poster.image, -width / 2, -height / 2, width, height);
    } else {
      this.drawVideoFallbackPlate(context, width, height);
    }
    context.strokeStyle = this.palette.selection.objectOutline;
    context.lineWidth = 1;
    context.strokeRect(
      -width / 2 + 0.5,
      -height / 2 + 0.5,
      width - 1,
      height - 1,
    );
    this.drawVideoBadges(context, width, height, video);
    context.restore();
  }

  /**
   * Paints the generic film-icon fallback plate (فاز M1 — A.2.2's
   * capture-failure case): a dark rounded plate + a translucent film-strip
   * glyph + the play circle, so the object reads as a video even without
   * a poster. Theme-independent by design — a thumbnail is CONTENT, not
   * chrome (video plates stay dark on both themes, like every player).
   *
   * @param context - the canvas 2D context (already translated/rotated).
   * @param width - the drawn width in (zoomed) pixels.
   * @param height - the drawn height in (zoomed) pixels.
   */
  private drawVideoFallbackPlate(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const w = width / 2;
    const h = height / 2;
    context.save();
    this.roundedRectPath(context, -w, -h, width, height, Math.min(10, width / 8, height / 8));
    context.fillStyle = "oklch(0.24 0.02 260)";
    context.fill();
    // The film-strip glyph: an outlined strip with two sprocket rows.
    const stripW = Math.min(width * 0.52, height * 0.72, 120);
    const stripH = stripW * 0.78;
    const sprocket = stripH / 9;
    context.strokeStyle = "rgba(255, 255, 255, 0.55)";
    context.lineWidth = Math.max(1, stripW / 46);
    this.roundedRectPath(context, -stripW / 2, -stripH / 2, stripW, stripH, stripW / 14);
    context.stroke();
    context.fillStyle = "rgba(255, 255, 255, 0.45)";
    for (let i = 0; i < 4; i += 1) {
      const sx = -stripW / 2 + (stripW / 4) * (i + 0.5) - sprocket / 2;
      context.fillRect(sx, -stripH / 2 + sprocket * 0.9, sprocket, sprocket);
      context.fillRect(sx, stripH / 2 - sprocket * 1.9, sprocket, sprocket);
    }
    // The centered play triangle ties the plate to the play affordance.
    const tri = stripW * 0.16;
    context.beginPath();
    context.moveTo(-tri / 2, -tri);
    context.lineTo(-tri / 2, tri);
    context.lineTo(tri, 0);
    context.closePath();
    context.fillStyle = "rgba(255, 255, 255, 0.75)";
    context.fill();
    context.restore();
  }

  /**
   * Paints the thumbnail chrome (فاز M1 — A.2.2): the centered play
   * glyph and the duration badge. Both live INSIDE the object's rotated
   * frame (they rotate/zoom with the thumbnail); the timecode text
   * itself reads LTR (universal media convention — the DIGITS follow the
   * app's Persian-digit setting through the palette formatter, A.2.8);
   * the badge sits at the bottom-right corner like every mainstream
   * video surface (YouTube/Aparat). Tiny footprints skip the chrome.
   *
   * @param context - the canvas 2D context (already translated/rotated).
   * @param width - the drawn width in (zoomed) pixels.
   * @param height - the drawn height in (zoomed) pixels.
   * @param video - the video object being painted.
   */
  private drawVideoBadges(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    video: VideoObjectData,
  ): void {
    if (width < 30 || height < 30) {
      return;
    }
    context.save();
    // Play glyph: translucent dark circle + white triangle (media icons
    // are never mirrored, even in the RTL chrome).
    const radius = Math.min(
      Math.max(Math.min(width, height) * 0.13, 13),
      34,
    );
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fillStyle = "rgba(15, 18, 25, 0.55)";
    context.fill();
    const tri = radius * 0.5;
    context.beginPath();
    context.moveTo(-tri * 0.45, -tri);
    context.lineTo(-tri * 0.45, tri);
    context.lineTo(tri, 0);
    context.closePath();
    context.fillStyle = "#ffffff";
    context.fill();

    // Duration badge (skip when unknown).
    if (video.durationMs > 0) {
      const label = (this.palette.videoDurationFormat ??
        videoTimecodeLatin)(video.durationMs);
      const fontSize = Math.min(
        Math.max(Math.min(width, height) * 0.075, 10),
        15,
      );
      context.font = `600 ${fontSize}px Vazirmatn, Tahoma, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.direction = "ltr";
      const textWidth = context.measureText(label).width;
      const padX = fontSize * 0.5;
      const chipWidth = textWidth + padX * 2;
      const chipHeight = fontSize + padX;
      const inset = Math.max(4, Math.min(width, height) * 0.035);
      const chipX = width / 2 - chipWidth - inset;
      const chipY = height / 2 - chipHeight - inset;
      this.roundedRectPath(
        context,
        chipX,
        chipY,
        chipWidth,
        chipHeight,
        chipHeight / 3,
      );
      context.fillStyle = "rgba(15, 18, 25, 0.72)";
      context.fill();
      context.fillStyle = "#ffffff";
      context.fillText(label, chipX + chipWidth / 2, chipY + chipHeight / 2 + 0.5);
    }
    context.restore();
  }

  /**
   * Draws the missing-asset placeholder of one video object (فاز M1 —
   * RM1.6): the ImageObject dashed-placeholder contract — dashed frame,
   * soft accent tint, the Persian message from the palette — plus the
   * original file name so the artist knows WHICH clip went missing.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param video - the video object whose asset is missing.
   */
  private drawVideoPlaceholder(
    context: CanvasRenderingContext2D,
    camera: Camera,
    video: VideoObjectData,
  ): void {
    const center = camera.worldToScreen(
      vec2(
        video.position.x + video.width / 2,
        video.position.y + video.height / 2,
      ),
    );
    const width = Math.max(video.width * camera.zoom, 1);
    const height = Math.max(video.height * camera.zoom, 1);
    const accent = this.palette.stroke;

    context.save();
    context.translate(center.x, center.y);
    context.rotate(camera.rotation + video.rotation);
    context.fillStyle = withAlpha(accent, "8%");
    context.fillRect(-width / 2, -height / 2, width, height);
    context.strokeStyle = withAlpha(accent, "65%");
    context.lineWidth = 1.5;
    context.setLineDash([6, 4]);
    context.strokeRect(
      -width / 2 + 0.75,
      -height / 2 + 0.75,
      width - 1.5,
      height - 1.5,
    );
    context.setLineDash([]);
    const fontSize = Math.min(Math.max(Math.min(width, height) / 3, 10), 18);
    if (width > fontSize * 3 && height > fontSize * 1.7) {
      context.fillStyle = withAlpha(accent, "90%");
      context.font = `${fontSize}px Vazirmatn, Tahoma, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.direction = "rtl";
      const label = this.palette.videoMissingLabel ?? "ویدئو در دسترس نیست";
      const nameSize = Math.max(9, fontSize * 0.62);
      const name = ellipsize(video.originalName, 28);
      const nameFits =
        width > nameSize * 1.9 * Math.min(name.length, 28) * 0.6;
      const gap = fontSize * 0.75;
      const blockH = fontSize + (nameFits ? gap + nameSize : 0);
      context.fillText(label, 0, nameFits ? -blockH / 2 + fontSize / 2 : 0);
      if (nameFits) {
        context.fillStyle = withAlpha(accent, "60%");
        context.font = `${nameSize}px Vazirmatn, Tahoma, sans-serif`;
        context.fillText(
          name,
          0,
          -blockH / 2 + fontSize + gap + nameSize / 2,
        );
      }
    }
    context.restore();
  }

  /**
   * Draws one audio object (فاز A1 — A.2.2/A.2.7): the waveform bitmap
   * (or the audio-note fallback plate when generation failed) mapped
   * through the EXACT {@link drawImage}/{@link drawVideo} affine path —
   * the projected centre, the additive camera+object rotation, the
   * hairline frame — plus the thumbnail chrome: a centered play glyph
   * and the duration badge (Persian digits per setting through the
   * palette's formatter), both painted INSIDE the rotated frame so they
   * transform with the object. The canvas NEVER holds an `<audio>`
   * element; a missing waveform paints the dashed placeholder instead
   * (ACA1.5).
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param audio - the audio object data to paint.
   * @param viewport - world-space culling bounds.
   */
  private drawAudio(
    context: CanvasRenderingContext2D,
    camera: Camera,
    audio: AudioObjectData,
    viewport: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    if (audio.width <= 0 || audio.height <= 0) {
      return;
    }
    const pad = 2 / camera.zoom;
    const cullBox = audio.rotation !== 0 ? rotatedObjectBBox(audio) : null;
    const minX = cullBox ? cullBox.minX : audio.position.x;
    const minY = cullBox ? cullBox.minY : audio.position.y;
    const maxX = cullBox ? cullBox.maxX : audio.position.x + audio.width;
    const maxY = cullBox ? cullBox.maxY : audio.position.y + audio.height;
    if (
      maxX + pad < viewport.minX ||
      minX - pad > viewport.maxX ||
      maxY + pad < viewport.minY ||
      minY - pad > viewport.maxY
    ) {
      return;
    }

    // Poster resolution: null thumbHash → the audio-note fallback (the
    // object is valid — only the generation failed, A.2.2); a hash that
    // cannot resolve (missing asset / no store) → the dashed placeholder.
    const posterUrl =
      audio.thumbHash !== null ? assetUrlOf(audio.thumbHash) : null;
    if (audio.thumbHash !== null && posterUrl === null) {
      this.drawAudioPlaceholder(context, camera, audio);
      return;
    }
    const poster = posterUrl !== null ? posterBitmapCache.resolve(posterUrl) : null;
    if (poster !== null && poster.state === "broken") {
      this.drawAudioPlaceholder(context, camera, audio);
      return;
    }
    if (poster !== null && poster.image === null) {
      // Still decoding — silent; the shared cache announces the repaint.
      return;
    }

    const center = camera.worldToScreen(
      vec2(
        audio.position.x + audio.width / 2,
        audio.position.y + audio.height / 2,
      ),
    );
    const width = Math.max(audio.width * camera.zoom, 1);
    const height = Math.max(audio.height * camera.zoom, 1);

    context.save();
    context.translate(center.x, center.y);
    context.rotate(camera.rotation + audio.rotation);
    if (poster !== null && poster.image !== null) {
      context.drawImage(poster.image, -width / 2, -height / 2, width, height);
    } else {
      this.drawAudioFallbackPlate(context, width, height);
    }
    context.strokeStyle = this.palette.selection.objectOutline;
    context.lineWidth = 1;
    context.strokeRect(
      -width / 2 + 0.5,
      -height / 2 + 0.5,
      width - 1,
      height - 1,
    );
    this.drawAudioBadges(context, width, height, audio);
    context.restore();
  }

  /**
   * Paints the generic audio-note fallback plate (فاز A1 — A.2.2's
   * generation-failure case): a dark rounded plate + a translucent
   * musical-note glyph + the play circle, so the object reads as an
   * audio clip even without a waveform. Theme-independent by design —
   * a thumbnail is CONTENT, not chrome (audio plates stay dark on both
   * themes, like every player surface).
   *
   * @param context - the canvas 2D context (already translated/rotated).
   * @param width - the drawn width in (zoomed) pixels.
   * @param height - the drawn height in (zoomed) pixels.
   */
  private drawAudioFallbackPlate(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const w = width / 2;
    const h = height / 2;
    context.save();
    this.roundedRectPath(context, -w, -h, width, height, Math.min(10, width / 8, height / 8));
    context.fillStyle = "oklch(0.24 0.02 260)";
    context.fill();
    // The musical-note glyph (an eighth note): stem + flag + two note
    // heads, drawn with simple paths at a plate-proportional scale.
    const scale = Math.min(width / 480, height / 160, 1);
    const unit = Math.max(6, 34 * scale);
    context.strokeStyle = "rgba(255, 255, 255, 0.6)";
    context.fillStyle = "rgba(255, 255, 255, 0.6)";
    context.lineWidth = Math.max(1.5, unit * 0.09);
    context.lineCap = "round";
    // Stem.
    context.beginPath();
    context.moveTo(-unit * 0.1, -unit);
    context.lineTo(-unit * 0.1, unit * 0.55);
    context.stroke();
    // Flag (a quadratic curve from the stem's top).
    context.beginPath();
    context.moveTo(-unit * 0.1, -unit);
    context.quadraticCurveTo(unit * 0.75, -unit * 0.72, unit * 0.55, -unit * 0.05);
    context.quadraticCurveTo(unit * 0.42, -unit * 0.55, -unit * 0.1, -unit * 0.45);
    context.closePath();
    context.fill();
    // Note head (an ellipse).
    context.beginPath();
    context.ellipse(-unit * 0.48, unit * 0.62, unit * 0.42, unit * 0.3, -0.4, 0, Math.PI * 2);
    context.fill();
    // The centered play triangle ties the plate to the play affordance.
    const tri = Math.min(unit * 0.5, Math.min(width, height) * 0.16);
    context.beginPath();
    context.moveTo(-tri * 0.45, -tri);
    context.lineTo(-tri * 0.45, tri);
    context.lineTo(tri, 0);
    context.closePath();
    context.fillStyle = "rgba(255, 255, 255, 0.75)";
    context.fill();
    context.restore();
  }

  /**
   * Paints the thumbnail chrome (فاز A1 — A.2.2): the centered play
   * glyph and the duration badge. Both live INSIDE the object's rotated
   * frame (they rotate/zoom with the thumbnail); the timecode text
   * itself reads LTR (universal media convention — the DIGITS follow the
   * app's Persian-digit setting through the palette formatter, A.2.8);
   * the badge sits at the bottom-end corner like every mainstream
   * media surface. Tiny footprints skip the chrome.
   *
   * @param context - the canvas 2D context (already translated/rotated).
   * @param width - the drawn width in (zoomed) pixels.
   * @param height - the drawn height in (zoomed) pixels.
   * @param audio - the audio object being painted.
   */
  private drawAudioBadges(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    audio: AudioObjectData,
  ): void {
    if (width < 40 || height < 26) {
      return;
    }
    context.save();
    // Play glyph: translucent dark circle + white triangle (media icons
    // are never mirrored, even in the RTL chrome).
    const radius = Math.min(
      Math.max(Math.min(width, height) * 0.16, 11),
      26,
    );
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fillStyle = "rgba(15, 18, 25, 0.55)";
    context.fill();
    const tri = radius * 0.5;
    context.beginPath();
    context.moveTo(-tri * 0.45, -tri);
    context.lineTo(-tri * 0.45, tri);
    context.lineTo(tri, 0);
    context.closePath();
    context.fillStyle = "#ffffff";
    context.fill();

    // Duration badge (skip when unknown).
    if (audio.durationMs > 0) {
      const label = (this.palette.audioDurationFormat ??
        audioTimecodeLatin)(audio.durationMs);
      const fontSize = Math.min(
        Math.max(Math.min(width, height) * 0.11, 10),
        15,
      );
      context.font = `600 ${fontSize}px Vazirmatn, Tahoma, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.direction = "ltr";
      const textWidth = context.measureText(label).width;
      const padX = fontSize * 0.5;
      const chipWidth = textWidth + padX * 2;
      const chipHeight = fontSize + padX;
      const inset = Math.max(4, Math.min(width, height) * 0.045);
      const chipX = width / 2 - chipWidth - inset;
      const chipY = height / 2 - chipHeight - inset;
      this.roundedRectPath(
        context,
        chipX,
        chipY,
        chipWidth,
        chipHeight,
        chipHeight / 3,
      );
      context.fillStyle = "rgba(15, 18, 25, 0.72)";
      context.fill();
      context.fillStyle = "#ffffff";
      context.fillText(label, chipX + chipWidth / 2, chipY + chipHeight / 2 + 0.5);
    }
    context.restore();
  }

  /**
   * Draws the missing-asset placeholder of one audio object (فاز A1 —
   * RA1.6): the ImageObject dashed-placeholder contract — dashed frame,
   * soft accent tint, the Persian message from the palette — plus the
   * original file name so the artist knows WHICH clip went missing.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param audio - the audio object whose asset is missing.
   */
  private drawAudioPlaceholder(
    context: CanvasRenderingContext2D,
    camera: Camera,
    audio: AudioObjectData,
  ): void {
    const center = camera.worldToScreen(
      vec2(
        audio.position.x + audio.width / 2,
        audio.position.y + audio.height / 2,
      ),
    );
    const width = Math.max(audio.width * camera.zoom, 1);
    const height = Math.max(audio.height * camera.zoom, 1);
    const accent = this.palette.stroke;

    context.save();
    context.translate(center.x, center.y);
    context.rotate(camera.rotation + audio.rotation);
    context.fillStyle = withAlpha(accent, "8%");
    context.fillRect(-width / 2, -height / 2, width, height);
    context.strokeStyle = withAlpha(accent, "65%");
    context.lineWidth = 1.5;
    context.setLineDash([6, 4]);
    context.strokeRect(
      -width / 2 + 0.75,
      -height / 2 + 0.75,
      width - 1.5,
      height - 1.5,
    );
    context.setLineDash([]);
    const fontSize = Math.min(Math.max(Math.min(width, height) / 3, 10), 18);
    if (width > fontSize * 3 && height > fontSize * 1.7) {
      context.fillStyle = withAlpha(accent, "90%");
      context.font = `${fontSize}px Vazirmatn, Tahoma, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.direction = "rtl";
      const label = this.palette.audioMissingLabel ?? "صوت در دسترس نیست";
      const nameSize = Math.max(9, fontSize * 0.62);
      const name = ellipsize(audio.originalName, 28);
      const nameFits =
        width > nameSize * 1.9 * Math.min(name.length, 28) * 0.6;
      const gap = fontSize * 0.75;
      const blockH = fontSize + (nameFits ? gap + nameSize : 0);
      context.fillText(label, 0, nameFits ? -blockH / 2 + fontSize / 2 : 0);
      if (nameFits) {
        context.fillStyle = withAlpha(accent, "60%");
        context.font = `${nameSize}px Vazirmatn, Tahoma, sans-serif`;
        context.fillText(
          name,
          0,
          -blockH / 2 + fontSize + gap + nameSize / 2,
        );
      }
    }
    context.restore();
  }

  /**
   * Draws one PDF object (فاز P1 — RP1.5/A.2.7): the current page's
   * poster bitmap (or the document-glyph fallback plate when the poster
   * capture failed) mapped through the EXACT {@link drawVideo} affine
   * path — the projected centre, the additive camera+object rotation,
   * the hairline frame — plus the thumbnail chrome: the PDF document
   * badge + the page-count badge (`۲ / ۱۰`, Persian digits per setting
   * through the palette's formatter), both painted INSIDE the rotated
   * frame so they transform with the object. The canvas NEVER holds a
   * `<canvas>`/`<iframe>` element for the PDF — the thumbnail state has
   * NO rendering overhead (A.1); a missing poster paints the dashed
   * placeholder instead (RP1.6).
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param pdf - the PDF object data to paint.
   * @param viewport - world-space culling bounds.
   */
  private drawPdf(
    context: CanvasRenderingContext2D,
    camera: Camera,
    pdf: PdfObjectData,
    viewport: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    if (pdf.width <= 0 || pdf.height <= 0) {
      return;
    }
    const pad = 2 / camera.zoom;
    const cullBox = pdf.rotation !== 0 ? rotatedObjectBBox(pdf) : null;
    const minX = cullBox ? cullBox.minX : pdf.position.x;
    const minY = cullBox ? cullBox.minY : pdf.position.y;
    const maxX = cullBox ? cullBox.maxX : pdf.position.x + pdf.width;
    const maxY = cullBox ? cullBox.maxY : pdf.position.y + pdf.height;
    if (
      maxX + pad < viewport.minX ||
      minX - pad > viewport.maxX ||
      maxY + pad < viewport.minY ||
      minY - pad > viewport.maxY
    ) {
      return;
    }

    // Poster resolution: null thumbHash → the document-glyph fallback
    // (the object is valid — only the capture failed, A.2.2); a hash
    // that cannot resolve (missing asset / no store) → the dashed
    // placeholder (RP1.6).
    const posterUrl =
      pdf.thumbHash !== null ? assetUrlOf(pdf.thumbHash) : null;
    if (pdf.thumbHash !== null && posterUrl === null) {
      this.drawPdfPlaceholder(context, camera, pdf);
      return;
    }
    const poster = posterUrl !== null ? posterBitmapCache.resolve(posterUrl) : null;
    if (poster !== null && poster.state === "broken") {
      this.drawPdfPlaceholder(context, camera, pdf);
      return;
    }
    if (poster !== null && poster.image === null) {
      // Still decoding — silent; the shared cache announces the repaint.
      return;
    }

    const center = camera.worldToScreen(
      vec2(
        pdf.position.x + pdf.width / 2,
        pdf.position.y + pdf.height / 2,
      ),
    );
    const width = Math.max(pdf.width * camera.zoom, 1);
    const height = Math.max(pdf.height * camera.zoom, 1);

    context.save();
    context.translate(center.x, center.y);
    context.rotate(camera.rotation + pdf.rotation);
    if (poster !== null && poster.image !== null) {
      context.drawImage(poster.image, -width / 2, -height / 2, width, height);
    } else {
      this.drawPdfFallbackPlate(context, width, height);
    }
    context.strokeStyle = this.palette.selection.objectOutline;
    context.lineWidth = 1;
    context.strokeRect(
      -width / 2 + 0.5,
      -height / 2 + 0.5,
      width - 1,
      height - 1,
    );
    this.drawPdfBadges(context, width, height, pdf);
    context.restore();
  }

  /**
   * Paints the generic document-glyph fallback plate (فاز P1 — A.2.2's
   * capture-failure case): a light rounded plate + a translucent
   * document sheet with folded corner + the PDF wordmark, so the object
   * reads as a PDF even without a poster. Theme-independent by design —
   * a thumbnail is CONTENT, not chrome (a white sheet reads as paper on
   * both themes).
   *
   * @param context - the canvas 2D context (already translated/rotated).
   * @param width - the drawn width in (zoomed) pixels.
   * @param height - the drawn height in (zoomed) pixels.
   */
  private drawPdfFallbackPlate(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const w = width / 2;
    const h = height / 2;
    context.save();
    this.roundedRectPath(context, -w, -h, width, height, Math.min(10, width / 8, height / 8));
    context.fillStyle = "oklch(0.97 0.005 260)";
    context.fill();
    // The document sheet with a folded corner.
    const sheetW = Math.min(width * 0.46, height * 0.6, 110);
    const sheetH = sheetW * 1.29;
    const fold = sheetW * 0.28;
    context.beginPath();
    context.moveTo(-sheetW / 2, -sheetH / 2);
    context.lineTo(sheetW / 2 - fold, -sheetH / 2);
    context.lineTo(sheetW / 2, -sheetH / 2 + fold);
    context.lineTo(sheetW / 2, sheetH / 2);
    context.lineTo(-sheetW / 2, sheetH / 2);
    context.closePath();
    context.fillStyle = "rgba(255, 255, 255, 0.9)";
    context.fill();
    context.strokeStyle = "rgba(30, 35, 45, 0.35)";
    context.lineWidth = Math.max(1, sheetW / 55);
    context.stroke();
    // The folded corner triangle.
    context.beginPath();
    context.moveTo(sheetW / 2 - fold, -sheetH / 2);
    context.lineTo(sheetW / 2 - fold, -sheetH / 2 + fold);
    context.lineTo(sheetW / 2, -sheetH / 2 + fold);
    context.closePath();
    context.fillStyle = "rgba(30, 35, 45, 0.18)";
    context.fill();
    // Suggestive text lines.
    context.strokeStyle = "rgba(30, 35, 45, 0.3)";
    context.lineWidth = Math.max(1, sheetW / 70);
    for (let i = 0; i < 5; i += 1) {
      const ly = -sheetH / 2 + fold + (i + 1) * ((sheetH - fold * 1.4) / 6);
      const lx = sheetW * 0.14;
      context.beginPath();
      context.moveTo(-sheetW / 2 + lx * 0.6, ly);
      context.lineTo(sheetW / 2 - (i % 2 === 0 ? lx : lx * 2.4), ly);
      context.stroke();
    }
    // The PDF wordmark chip ties the plate to the format.
    const font = Math.max(9, Math.min(sheetW * 0.22, 16));
    context.font = `700 ${font}px Vazirmatn, Tahoma, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.direction = "ltr";
    const wordmark = "PDF";
    const wordmarkWidth = context.measureText(wordmark).width + font * 0.7;
    const chipH = font * 1.35;
    const chipY = sheetH / 2 - chipH / 2 - sheetH * 0.04;
    this.roundedRectPath(
      context,
      -wordmarkWidth / 2,
      chipY - chipH / 2,
      wordmarkWidth,
      chipH,
      chipH / 3,
    );
    context.fillStyle = "rgba(15, 18, 25, 0.72)";
    context.fill();
    context.fillStyle = "#ffffff";
    context.fillText(wordmark, 0, chipY + 0.5);
    context.restore();
  }

  /**
   * Paints the thumbnail chrome (فاز P1 — RP1.5): the PDF document
   * badge + the page-count badge (`۲ / ۱۰`). Both live INSIDE the
   * object's rotated frame (they rotate/zoom with the thumbnail); the
   * page numbers follow the Persian-digits setting through the palette
   * formatter (A.2.8); RTL-correct placement — the PDF badge sits at
   * the top-right corner and the page badge at the bottom-right corner
   * (document conventions are NOT mirrored, exactly like the media
   * timecodes). Tiny footprints skip the chrome.
   *
   * @param context - the canvas 2D context (already translated/rotated).
   * @param width - the drawn width in (zoomed) pixels.
   * @param height - the drawn height in (zoomed) pixels.
   * @param pdf - the PDF object being painted.
   */
  private drawPdfBadges(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    pdf: PdfObjectData,
  ): void {
    if (width < 30 || height < 30) {
      return;
    }
    context.save();
    const fontSize = Math.min(
      Math.max(Math.min(width, height) * 0.075, 10),
      15,
    );
    context.font = `600 ${fontSize}px Vazirmatn, Tahoma, sans-serif`;
    context.textBaseline = "middle";
    context.direction = "rtl";
    const inset = Math.max(4, Math.min(width, height) * 0.035);

    // The PDF document badge (top-right corner).
    const pdfLabel = "PDF";
    const pdfWidth = context.measureText(pdfLabel).width + fontSize * 0.7;
    const chipHeight = fontSize + fontSize * 0.5;
    const chipX = width / 2 - pdfWidth - inset;
    const chipY = -height / 2 + inset;
    this.roundedRectPath(
      context,
      chipX,
      chipY,
      pdfWidth,
      chipHeight,
      chipHeight / 3,
    );
    context.fillStyle = "rgba(15, 18, 25, 0.72)";
    context.fill();
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.direction = "ltr";
    context.fillText(pdfLabel, chipX + pdfWidth / 2, chipY + chipHeight / 2 + 0.5);

    // The page-count badge (bottom-right corner, e.g. "۲ / ۱۰").
    const label = (this.palette.pdfPageBadgeFormat ??
      pdfPageBadgeLatin)(pdf.currentPage, pdf.pageCount);
    context.font = `600 ${fontSize}px Vazirmatn, Tahoma, sans-serif`;
    context.direction = "ltr";
    const textWidth = context.measureText(label).width;
    const padX = fontSize * 0.5;
    const badgeWidth = textWidth + padX * 2;
    const badgeX = width / 2 - badgeWidth - inset;
    const badgeY = height / 2 - chipHeight - inset;
    this.roundedRectPath(
      context,
      badgeX,
      badgeY,
      badgeWidth,
      chipHeight,
      chipHeight / 3,
    );
    context.fillStyle = "rgba(15, 18, 25, 0.72)";
    context.fill();
    context.fillStyle = "#ffffff";
    context.fillText(
      label,
      badgeX + badgeWidth / 2,
      badgeY + chipHeight / 2 + 0.5,
    );
    context.restore();
  }

  /**
   * Draws the missing-asset placeholder of one PDF object (فاز P1 —
   * RP1.6): the ImageObject dashed-placeholder contract — dashed
   * frame, soft accent tint, the Persian message from the palette —
   * plus the original file name so the artist knows WHICH document
   * went missing.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param pdf - the PDF object whose asset is missing.
   */
  private drawPdfPlaceholder(
    context: CanvasRenderingContext2D,
    camera: Camera,
    pdf: PdfObjectData,
  ): void {
    const center = camera.worldToScreen(
      vec2(
        pdf.position.x + pdf.width / 2,
        pdf.position.y + pdf.height / 2,
      ),
    );
    const width = Math.max(pdf.width * camera.zoom, 1);
    const height = Math.max(pdf.height * camera.zoom, 1);
    const accent = this.palette.stroke;

    context.save();
    context.translate(center.x, center.y);
    context.rotate(camera.rotation + pdf.rotation);
    context.fillStyle = withAlpha(accent, "8%");
    context.fillRect(-width / 2, -height / 2, width, height);
    context.strokeStyle = withAlpha(accent, "65%");
    context.lineWidth = 1.5;
    context.setLineDash([6, 4]);
    context.strokeRect(
      -width / 2 + 0.75,
      -height / 2 + 0.75,
      width - 1.5,
      height - 1.5,
    );
    context.setLineDash([]);
    const fontSize = Math.min(Math.max(Math.min(width, height) / 3, 10), 18);
    if (width > fontSize * 3 && height > fontSize * 1.7) {
      context.fillStyle = withAlpha(accent, "90%");
      context.font = `${fontSize}px Vazirmatn, Tahoma, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.direction = "rtl";
      const label = this.palette.pdfMissingLabel ?? "سند PDF در دسترس نیست";
      const nameSize = Math.max(9, fontSize * 0.62);
      const name = ellipsize(pdf.originalName, 28);
      const nameFits =
        width > nameSize * 1.9 * Math.min(name.length, 28) * 0.6;
      const gap = fontSize * 0.75;
      const blockH = fontSize + (nameFits ? gap + nameSize : 0);
      context.fillText(label, 0, nameFits ? -blockH / 2 + fontSize / 2 : 0);
      if (nameFits) {
        context.fillStyle = withAlpha(accent, "60%");
        context.font = `${nameSize}px Vazirmatn, Tahoma, sans-serif`;
        context.fillText(
          name,
          0,
          -blockH / 2 + fontSize + gap + nameSize / 2,
        );
      }
    }
    context.restore();
  }

  /**
   * Draws one emoji sticker (R11.1): the glyph renders centred inside the
   * object's world footprint through the platform emoji font — fully
   * offline, no assets. The font size follows the SMALLER box edge (×0.82)
   * so any aspect ratio keeps the glyph fully inside; rotation composes
   * around the box centre exactly like {@link drawImage}. A soft round
   * backing plate (theme-tinted, 6% alpha) keeps white-ish glyphs visible
   * on the light theme without boxing the sticker in.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param sticker - the sticker object data to paint.
   * @param viewport - the visible world rect (culling).
   */
  private drawSticker(
    context: CanvasRenderingContext2D,
    camera: Camera,
    sticker: StickerObjectData,
    viewport: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    if (sticker.width <= 0 || sticker.height <= 0) {
      return;
    }
    const pad = 2 / camera.zoom;
    const cullBox =
      sticker.rotation !== 0 ? rotatedObjectBBox(sticker) : null;
    const minX = cullBox ? cullBox.minX : sticker.position.x;
    const minY = cullBox ? cullBox.minY : sticker.position.y;
    const maxX = cullBox ? cullBox.maxX : sticker.position.x + sticker.width;
    const maxY = cullBox ? cullBox.maxY : sticker.position.y + sticker.height;
    if (
      maxX + pad < viewport.minX ||
      minX - pad > viewport.maxX ||
      maxY + pad < viewport.minY ||
      minY - pad > viewport.maxY
    ) {
      return;
    }

    const center = camera.worldToScreen(
      vec2(
        sticker.position.x + sticker.width / 2,
        sticker.position.y + sticker.height / 2,
      ),
    );
    const width = Math.max(sticker.width * camera.zoom, 1);
    const height = Math.max(sticker.height * camera.zoom, 1);
    const glyph = Math.min(width, height) * 0.82;

    context.save();
    context.translate(center.x, center.y);
    context.rotate(camera.rotation + sticker.rotation);
    // Soft circular backing plate — theme-aware tint keeps pale glyphs
    // readable on light backgrounds (R11.1 styling detail). فاز ۳۳ adds
    // a hairline ring at the plate's edge so a sticker reads as a
    // self-contained "chip" object on BOTH themes (the emoji alone
    // floats ambiguously on busy boards).
    const plateRadius = Math.min(width, height) / 2;
    if (plateRadius > 3) {
      context.fillStyle = withAlpha(this.palette.stroke, "6%");
      context.beginPath();
      context.arc(0, 0, plateRadius, 0, Math.PI * 2);
      context.fill();
      if (plateRadius > 10) {
        context.lineWidth = 1;
        context.strokeStyle = withAlpha(this.palette.stroke, "16%");
        context.stroke();
      }
    }
    // Reset to an OPAQUE paint before the glyph: canvas composites colour
    // emoji bitmaps against the fill ALPHA, so the plate's 6%-alpha
    // fillStyle leaking into fillText rendered every sticker ghosted to
    // near-invisibility (found live in the فاز-۳۳ QA round). The paint
    // colour itself is ignored by colour glyphs, but monochrome fallback
    // fonts use it — the theme stroke stays readable on both themes.
    context.fillStyle = this.palette.stroke;
    context.font = `${glyph}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.direction = "ltr";
    context.fillText(sticker.emoji, 0, 0);
    context.restore();
  }

  /**
   * Draws one live knowledge-query card (R15.2): a rounded list card
   * whose header names the query and whose rows are the LIVE result of
   * {@link runKnowledgeQuery} over the injected resolver's snapshot.
   * Screen-space typography (the connector-label convention): the font
   * stays fixed while the card scales with zoom, so the visible row
   * count adapts to the card's on-screen height.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param object - the query object data to paint.
   * @param viewport - world-space culling bounds.
   */
  private drawQuery(
    context: CanvasRenderingContext2D,
    camera: Camera,
    object: QueryObjectData,
    viewport: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    if (object.width <= 0 || object.height <= 0) {
      return;
    }
    const pad = 4 / camera.zoom;
    const minX = object.position.x;
    const minY = object.position.y;
    const maxX = object.position.x + object.width;
    const maxY = object.position.y + object.height;
    if (
      maxX + pad < viewport.minX ||
      minX - pad > viewport.maxX ||
      maxY + pad < viewport.minY ||
      minY - pad > viewport.maxY
    ) {
      return;
    }

    const center = camera.worldToScreen(
      vec2(
        object.position.x + object.width / 2,
        object.position.y + object.height / 2,
      ),
    );
    const width = Math.max(object.width * camera.zoom, 1);
    const height = Math.max(object.height * camera.zoom, 1);
    const accent = this.palette.stroke;
    const labels = this.palette.queryLabels;
    const header =
      labels === undefined
        ? null
        : object.queryType === "backlinks"
          ? labels.backlinks
          : object.queryType === "tag"
            ? labels.tag
            : object.queryType === "broken"
              ? labels.broken
              : object.queryType === "filter"
                ? labels.filter
                : labels.orphans;

    context.save();
    context.translate(center.x, center.y);
    context.rotate(camera.rotation + object.rotation);

    // Card body: soft tint + solid border (readable over any content).
    context.fillStyle = withAlpha(accent, "8%");
    context.strokeStyle = withAlpha(accent, "55%");
    context.lineWidth = 1;
    const radius = Math.min(10, Math.min(width, height) / 4);
    context.beginPath();
    context.roundRect(-width / 2, -height / 2, width, height, radius);
    context.fill();
    context.stroke();

    if (width < 56 || height < 40) {
      // Too small for text — the card footprint alone carries it.
      context.restore();
      return;
    }

    const font = (px: number): string =>
      `${px}px Vazirmatn, Tahoma, sans-serif`;
    const headerH = 24;
    // Header separator.
    context.strokeStyle = withAlpha(accent, "30%");
    context.beginPath();
    context.moveTo(-width / 2 + 6, -height / 2 + headerH);
    context.lineTo(width / 2 - 6, -height / 2 + headerH);
    context.stroke();

    /** Ellipsizes one line to a pixel width. */
    const fit = (text: string, px: number, maxPx: number): string => {
      context.font = font(px);
      if (context.measureText(text).width <= maxPx) {
        return text;
      }
      let cut = text.length;
      while (cut > 1 && context.measureText(`${text.slice(0, cut)}…`).width > maxPx) {
        cut -= 1;
      }
      return `${text.slice(0, cut)}…`;
    };

    // Header text (right-aligned, RTL) + live count chip (left).
    context.direction = "rtl";
    context.textBaseline = "middle";
    const target = object.queryTarget.trim();
    const headerText =
      header === null
        ? ""
        : object.queryType === "backlinks"
          ? `${header} «${fit(target, 11, width - 90)}»`
          : object.queryType === "tag"
            ? `# ${fit(target, 11, width - 90)}`
            : header;
    context.fillStyle = withAlpha(accent, "95%");
    context.font = `600 ${font(11)}`;
    context.textAlign = "right";
    context.fillText(headerText, width / 2 - 8, -height / 2 + headerH / 2);

    const result = this.palette.queryResolver?.({
      type: object.queryType,
      target: object.queryTarget,
      structured:
        object.queryType === "filter" ? object.querySpec : undefined,
      columns: object.columns,
      selfId: object.id,
    });
    const count =
      result?.total ??
      (result?.missingTarget === true ? 0 : result?.rows.length ?? 0);
    const digits =
      this.palette.guideNumberFormat?.(count) ?? String(count);
    context.font = font(10);
    context.textAlign = "left";
    context.fillStyle = withAlpha(accent, "75%");
    context.fillText(
      result?.missingTarget === true ? "⚠" : digits,
      -width / 2 + 8,
      -height / 2 + headerH / 2,
    );

    // Rows: live titles (right-aligned), one line each — the structured
    // filter kind draws group separators + the first column's value
    // (R12.2); the knowledge kinds keep the flat title rows.
    if (result !== undefined) {
      const rowH = 20;
      const groupH = 15;
      const top = -height / 2 + headerH + 6;
      const bottom = height / 2 - 4;
      let y = top;
      let drawn = 0;
      let previousGroup: string | null = null;
      const grouped =
        object.queryType === "filter" &&
        result.rows.some((row) => row.group !== undefined);
      for (const row of result.rows) {
        // Group separator (R12.2): a tiny label + hairline above the
        // bucket's first row.
        if (grouped && row.group !== previousGroup) {
          if (y + groupH > bottom) {
            break;
          }
          previousGroup = row.group ?? "";
          const groupLabel =
            previousGroup === ""
              ? (labels?.ungrouped ?? "—")
              : previousGroup;
          context.strokeStyle = withAlpha(accent, "22%");
          context.lineWidth = 1;
          context.beginPath();
          const lineY = y + groupH - 4;
          context.moveTo(-width / 2 + 6, lineY);
          context.lineTo(width / 2 - 6, lineY);
          context.stroke();
          context.font = `600 ${font(9)}`;
          context.textAlign = "right";
          context.fillStyle = withAlpha(accent, "62%");
          context.fillText(
            fit(groupLabel, 9, width - 24),
            width / 2 - 8,
            y + groupH / 2 - 3,
          );
          y += groupH;
        }
        if (y + rowH > bottom) {
          break;
        }
        const rowY = y + rowH / 2;
        drawn += 1;
        // Row bullet (right edge).
        context.fillStyle = row.detail === undefined ? accent : withAlpha(accent, "45%");
        context.beginPath();
        context.arc(width / 2 - 12, rowY, 2.5, 0, Math.PI * 2);
        context.fill();
        // Title.
        const title =
          row.title === "" ? (labels?.untitled ?? "—") : row.title;
        context.font = font(11);
        context.textAlign = "right";
        context.fillStyle = withAlpha(accent, "92%");
        context.fillText(
          fit(title, 11, width - 44),
          width / 2 - 18,
          rowY,
        );
        // Detail (broken: the missing title; filter: the column value),
        // left of the row.
        if (row.detail !== undefined) {
          context.font = font(9);
          context.textAlign = "left";
          context.fillStyle = withAlpha(accent, "55%");
          context.fillText(
            `→ ${fit(row.detail, 9, width / 2 - 20)}`,
            -width / 2 + 8,
            rowY,
          );
        }
        y += rowH;
      }
      const hidden = result.total - drawn;
      if (hidden > 0) {
        context.font = font(9);
        context.textAlign = "left";
        context.fillStyle = withAlpha(accent, "60%");
        context.fillText(
          `+${this.palette.guideNumberFormat?.(hidden) ?? String(hidden)}`,
          -width / 2 + 8,
          height / 2 - 9,
        );
      }
      // Missing-target hint, centred.
      if (result.missingTarget) {
        context.font = font(10);
        context.textAlign = "center";
        context.fillStyle = withAlpha(accent, "65%");
        context.fillText(labels?.missing ?? "", 0, top + 14);
      }
    }

    context.restore();
  }

  /**
   * Draws one opaque placeholder (R4.3): a dashed rect over the derived
   * footprint, a soft accent tint inside, and the Persian label
   * «شیء ناشناخته» centred on the box. The label font scales with the world
   * footprint (clamped on screen) so it stays readable at every zoom without
   * dominating small objects; the whole drawing composes the object's own
   * rotation around the box centre exactly like {@link drawImage}.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param object - the opaque object data to paint.
   * @param viewport - world-space culling bounds.
   */
  private drawOpaque(
    context: CanvasRenderingContext2D,
    camera: Camera,
    object: OpaqueObjectData,
    viewport: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const box = objectBBox(object);
    const cullBox = object.rotation !== 0 ? rotatedObjectBBox(object) : box;
    const pad = 4 / camera.zoom;
    if (
      cullBox.maxX + pad < viewport.minX ||
      cullBox.minX - pad > viewport.maxX ||
      cullBox.maxY + pad < viewport.minY ||
      cullBox.minY - pad > viewport.maxY
    ) {
      return;
    }
    const width = Math.max(box.maxX - box.minX, 1);
    const height = Math.max(box.maxY - box.minY, 1);
    const center = camera.worldToScreen(
      vec2((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2),
    );
    const screenW = Math.max(width * camera.zoom, 1);
    const screenH = Math.max(height * camera.zoom, 1);
    const accent = this.palette.stroke;

    context.save();
    context.translate(center.x, center.y);
    context.rotate(camera.rotation + object.rotation);
    // Soft tint so the footprint reads as "occupied but unknown".
    context.fillStyle = withAlpha(accent, "12%");
    context.fillRect(-screenW / 2, -screenH / 2, screenW, screenH);
    // Dashed outline — the dashed "placeholder" affordance of R4.3.
    context.strokeStyle = withAlpha(accent, "70%");
    context.lineWidth = 1.5;
    context.setLineDash([6, 4]);
    context.strokeRect(
      -screenW / 2 + 0.75,
      -screenH / 2 + 0.75,
      screenW - 1.5,
      screenH - 1.5,
    );
    context.setLineDash([]);
    // Persian label, clamped between 10px and a third of the box.
    const fontSize = Math.min(Math.max(screenH / 3, 10), 20);
    if (screenW > fontSize * 2 && screenH > fontSize * 1.6) {
      context.fillStyle = withAlpha(accent, "90%");
      context.font = `${fontSize}px Vazirmatn, Tahoma, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.direction = "rtl";
      context.fillText(this.palette.opaqueLabel, 0, 0);
    }
    context.restore();
  }

  /**
   * Draws one connector: the routed path (live-resolved endpoints) under
   * optional arrowheads, with the dash pattern scaled by zoom so it stays
   * readable at every level.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param connector - the connector data to paint.
   * @param scene - the scene providing the glue targets.
   * @param viewport - world-space culling bounds.
   */
  private drawConnector(
    context: CanvasRenderingContext2D,
    camera: Camera,
    connector: ConnectorObjectData,
    scene: Scene,
    viewport: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const resolved = resolveConnectorPath(connector, scene.objects);
    const pad = connector.strokeWidth + 4 / camera.zoom;
    if (
      Math.max(resolved.start.x, resolved.end.x) + pad < viewport.minX ||
      Math.min(resolved.start.x, resolved.end.x) - pad > viewport.maxX ||
      Math.max(resolved.start.y, resolved.end.y) + pad < viewport.minY ||
      Math.min(resolved.start.y, resolved.end.y) - pad > viewport.maxY
    ) {
      return;
    }

    const startScreen = camera.worldToScreen(resolved.start);
    const endScreen = camera.worldToScreen(resolved.end);
    // The routed path is computed in WORLD space (exit-aware), then mapped
    // to screen — the hit-tester resolves exactly the same shape.
    const shape = this.toScreenShape(resolved.shape, camera);
    const color = this.resolveStrokeColor(connector.strokeColor);
    const width = Math.max(connector.strokeWidth * camera.zoom, 1);

    context.save();
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineCap = connector.strokeStyle === "dotted" ? "round" : "butt";
    context.lineJoin = "round";
    context.setLineDash(this.dashPattern(connector.strokeStyle, width, camera));
    this.traceConnectorPath(context, shape);
    context.stroke();
    context.restore();

    const arrow = this.arrowSize(width);
    if (connector.startArrow === "arrow") {
      this.drawArrowHead(
        context,
        startScreen,
        pathStartTangent(shape),
        arrow,
        color,
      );
    }
    if (connector.endArrow === "arrow") {
      this.drawArrowHead(
        context,
        endScreen,
        pathEndTangent(shape),
        arrow,
        color,
      );
    }
    if (connector.label !== undefined && connector.label.length > 0) {
      this.drawConnectorLabel(context, camera, resolved, connector.label);
    }
  }

  /**
   * Draws the connector's single-line label (R5.3) as a chip riding the
   * path midpoint: a background-coloured rounded pill (it covers the line
   * beneath the text, Miro-style), a hairline border, and the caption at a
   * FIXED screen font size so it stays readable at every zoom (AC5.3).
   * Overlong captions ellipsize at {@link CONNECTOR_LABEL_MAX_PX}.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param resolved - the connector's live-resolved geometry.
   * @param label - the caption text (non-empty by contract).
   */
  private drawConnectorLabel(
    context: CanvasRenderingContext2D,
    camera: Camera,
    resolved: ResolvedConnectorPath,
    label: string,
  ): void {
    const anchor = camera.worldToScreen(pathMidpoint(resolved.shape));
    context.save();
    context.font = `600 ${CONNECTOR_LABEL_FONT_PX}px Vazirmatn, Tahoma, sans-serif`;
    context.direction = "rtl";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const text = this.ellipsizeLabel(context, label, CONNECTOR_LABEL_MAX_PX);
    const textWidth = context.measureText(text).width;
    const chipWidth = textWidth + CONNECTOR_LABEL_PAD_X * 2;
    const chipHeight = CONNECTOR_LABEL_FONT_PX + CONNECTOR_LABEL_PAD_Y * 2;
    chipRectPath(
      context,
      anchor.x - chipWidth / 2,
      anchor.y - chipHeight / 2,
      chipWidth,
      chipHeight,
      5,
    );
    context.fillStyle = this.palette.background;
    context.fill();
    context.strokeStyle = withAlpha(this.palette.stroke, "40%");
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = this.palette.stroke;
    context.fillText(text, anchor.x, anchor.y);
    context.restore();
  }

  /**
   * Truncates a label with a trailing ellipsis until it fits the width.
   *
   * @param context - the measuring 2D context (font already set).
   * @param label - the full caption.
   * @param maxWidth - the largest allowed text width, in screen pixels.
   * @returns the fitted caption (unchanged when it already fits).
   */
  private ellipsizeLabel(
    context: CanvasRenderingContext2D,
    label: string,
    maxWidth: number,
  ): string {
    if (context.measureText(label).width <= maxWidth) {
      return label;
    }
    let text = label;
    while (
      text.length > 1 &&
      context.measureText(`${text}…`).width > maxWidth
    ) {
      text = text.slice(0, -1);
    }
    return `${text}…`;
  }

  /**
   * Maps a world-space path shape into screen space (control points are
   * affine-mapped — a world-space quadratic stays a screen-space quadratic).
   *
   * @param shape - the world-space control points + curve flag.
   * @param camera - the viewport transform.
   * @returns the screen-space path shape.
   */
  private toScreenShape(
    shape: { readonly points: readonly Vec2[]; readonly bezier: boolean },
    camera: Camera,
  ): { readonly points: readonly Vec2[]; readonly bezier: boolean } {
    return {
      points: shape.points.map((point) => camera.worldToScreen(point)),
      bezier: shape.bezier,
    };
  }

  /**
   * Traces a connector path shape: polylines stroke straight segments, the
   * curved routing strokes one quadratic through the control point.
   *
   * @param context - the canvas 2D context to draw with.
   * @param shape - the path control points + bezier flag (screen space).
   */
  private traceConnectorPath(
    context: CanvasRenderingContext2D,
    shape: { readonly points: readonly Vec2[]; readonly bezier: boolean },
  ): void {
    const points = shape.points;
    const first = points[0] ?? vec2(0, 0);
    context.beginPath();
    context.moveTo(first.x, first.y);
    if (shape.bezier) {
      const control = points[1] ?? first;
      const end = points[2] ?? control;
      context.quadraticCurveTo(control.x, control.y, end.x, end.y);
      return;
    }
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i] ?? first;
      context.lineTo(point.x, point.y);
    }
  }

  /**
   * Draws a filled arrowhead triangle at a tip pointing along `direction`.
   *
   * @param context - the canvas 2D context to draw with.
   * @param tip - the arrow tip in CSS pixels.
   * @param direction - the unit vector pointing INTO the tip.
   * @param size - the arrow length in CSS pixels.
   * @param color - the fill colour.
   */
  private drawArrowHead(
    context: CanvasRenderingContext2D,
    tip: Vec2,
    direction: Vec2,
    size: number,
    color: string,
  ): void {
    if (direction.x === 0 && direction.y === 0) {
      return;
    }
    const angle = Math.atan2(direction.y, direction.x);
    const half = 0.42;
    context.beginPath();
    context.moveTo(tip.x, tip.y);
    context.lineTo(
      tip.x - size * Math.cos(angle - half),
      tip.y - size * Math.sin(angle - half),
    );
    context.lineTo(
      tip.x - size * Math.cos(angle + half),
      tip.y - size * Math.sin(angle + half),
    );
    context.closePath();
    context.fillStyle = color;
    context.fill();
  }

  /**
   * @param strokeWidth - the connector stroke width in CSS pixels.
   * @returns the arrowhead length (clamped 9–22 px).
   */
  private arrowSize(strokeWidth: number): number {
    return Math.min(22, Math.max(9, strokeWidth * 3.2));
  }

  /**
   * @param camera - the viewport transform.
   * @returns the dash scale factor (clamped 0.75–3) keeping patterns
   *   readable at every zoom level.
   */
  private dashScale(camera: Camera): number {
    return Math.max(0.75, Math.min(camera.zoom, 3));
  }

  /**
   * Builds the screen-space dash pattern of a stroke style.
   *
   * @param style - the stored dash style.
   * @param lineWidth - the stroke width in CSS pixels.
   * @param camera - the viewport transform (pattern scale).
   * @returns the `setLineDash` pattern.
   */
  private dashPattern(
    style: "solid" | "dashed" | "dotted",
    lineWidth: number,
    camera: Camera,
  ): number[] {
    if (style === "dashed") {
      const scale = this.dashScale(camera);
      return [8 * scale, 6 * scale];
    }
    if (style === "dotted") {
      return [0.01, Math.max(6, lineWidth * 2.6)];
    }
    return [];
  }

  /**
   * Paints the on-canvas knowledge edges (pack R12.4) above the scene
   * objects: resolved links as accent quadratic arcs with arrowheads
   * (highlighted when either end is selected), broken links as dashed
   * red stubs ending in a dashed ring + the missing title's label.
   *
   * Geometry resolves from the LIVE scene at paint time, so the edges
   * track dragged objects with zero extra invalidation.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param scene - the scene providing the object boxes.
   */
  private drawKnowledgeEdges(
    context: CanvasRenderingContext2D,
    camera: Camera,
    scene: Scene,
  ): void {
    const frame = this.knowledgeEdgeFrame;
    if (frame === null || frame.edges.length === 0) {
      return;
    }
    const edgeColor = this.palette.knowledgeEdgeColor ?? KNOWLEDGE_EDGE_COLOR;
    const brokenColor =
      this.palette.knowledgeBrokenColor ?? KNOWLEDGE_BROKEN_COLOR;
    const size = this.cssSize();
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const edge of frame.edges) {
      const source = scene.findById(edge.sourceId);
      if (source === undefined || !source.visible) {
        continue;
      }
      const sourceBox = objectBBox(source);
      const sourceCenter = vec2(
        (sourceBox.minX + sourceBox.maxX) / 2,
        (sourceBox.minY + sourceBox.maxY) / 2,
      );
      const sourceScreen = camera.worldToScreen(sourceCenter);

      if (edge.targetId !== undefined) {
        const target = scene.findById(edge.targetId);
        if (target === undefined || !target.visible) {
          continue;
        }
        const targetBox = objectBBox(target);
        const targetCenter = vec2(
          (targetBox.minX + targetBox.maxX) / 2,
          (targetBox.minY + targetBox.maxY) / 2,
        );
        // Cull when both ends are far outside the viewport.
        const targetScreen = camera.worldToScreen(targetCenter);
        if (
          (sourceScreen.x < -240 &&
            targetScreen.x < -240) ||
          (sourceScreen.x > size.width + 240 &&
            targetScreen.x > size.width + 240) ||
          (sourceScreen.y < -240 && targetScreen.y < -240) ||
          (sourceScreen.y > size.height + 240 && targetScreen.y > size.height + 240)
        ) {
          continue;
        }
        const selected =
          frame.selectedIds.has(edge.sourceId) ||
          frame.selectedIds.has(edge.targetId);
        // Trim both ends to the object boxes (centre-line intersection).
        const from = camera.worldToScreen(
          boxEdgeToward(sourceBox, targetCenter),
        );
        const to = camera.worldToScreen(boxEdgeToward(targetBox, sourceCenter));
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 14) {
          continue;
        }
        // Deterministic per-pair arc side keeps A→B and B→A separated.
        const side =
          (edge.sourceId.charCodeAt(0) + (edge.targetId.charCodeAt(0) || 0)) %
            2 ===
          0
            ? 1
            : -1;
        const lift = Math.min(0.16 * dist, 90) * side;
        const control = vec2(
          (from.x + to.x) / 2 + (-dy / dist) * lift,
          (from.y + to.y) / 2 + (dx / dist) * lift,
        );
        context.strokeStyle = withAlpha(edgeColor, selected ? "95%" : "48%");
        context.lineWidth = selected ? 2.25 : 1.5;
        context.setLineDash([]);
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.quadraticCurveTo(control.x, control.y, to.x, to.y);
        context.stroke();
        if (selected) {
          this.drawArrowHead(
            context,
            to,
            vec2(to.x - control.x, to.y - control.y),
            8,
            withAlpha(edgeColor, "95%"),
          );
        }
        continue;
      }

      // Broken link: a dashed stub toward the deterministic direction.
      const key = edge.brokenKey ?? edge.sourceId;
      const reach =
        Math.max(
          sourceBox.maxX - sourceBox.minX,
          sourceBox.maxY - sourceBox.minY,
        ) / 2 + 150;
      const stubWorld = brokenStubEnd(sourceCenter, reach, key);
      const stubScreen = camera.worldToScreen(stubWorld);
      if (
        stubScreen.x < -260 ||
        stubScreen.x > size.width + 260 ||
        stubScreen.y < -260 ||
        stubScreen.y > size.height + 260
      ) {
        continue;
      }
      const selected = frame.selectedIds.has(edge.sourceId);
      context.strokeStyle = withAlpha(brokenColor, selected ? "90%" : "55%");
      context.lineWidth = selected ? 2 : 1.5;
      context.setLineDash([
        6 * this.dashScale(camera),
        5 * this.dashScale(camera),
      ]);
      context.beginPath();
      context.moveTo(sourceScreen.x, sourceScreen.y);
      context.lineTo(stubScreen.x, stubScreen.y);
      context.stroke();
      context.setLineDash([]);
      // Dashed ghost ring at the stub end.
      context.beginPath();
      context.arc(stubScreen.x, stubScreen.y, 4.5, 0, Math.PI * 2);
      context.stroke();
      // The missing title's label (zoom-gated to avoid deep-zoom noise).
      if (camera.zoom >= 0.35 && edge.brokenDisplay !== undefined) {
        const label =
          edge.brokenDisplay.length > KNOWLEDGE_STUB_LABEL_MAX
            ? `${edge.brokenDisplay.slice(0, KNOWLEDGE_STUB_LABEL_MAX - 1)}…`
            : edge.brokenDisplay;
        context.font = `${KNOWLEDGE_STUB_FONT_PX}px Vazirmatn, Tahoma, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "top";
        context.direction = "rtl";
        context.fillStyle = withAlpha(brokenColor, "85%");
        context.fillText(label, stubScreen.x, stubScreen.y + 8);
        context.direction = "inherit";
      }
    }
    context.restore();
  }

  /**
   * Draws one rubber-band endpoint dot.
   *
   * @param context - the canvas 2D context to draw with.
   * @param screen - the dot centre in CSS pixels.
   * @param kind - filled (glued start), snap (glued end candidate) or hollow
   *        (floating end candidate).
   * @param accent - the accent colour.
   */
  private drawDraftDot(
    context: CanvasRenderingContext2D,
    screen: Vec2,
    kind: "filled" | "snap" | "hollow",
    accent: string,
  ): void {
    const radius = kind === "snap" ? 6 : 5;
    if (kind === "snap") {
      // Halo ring around the snapping end candidate.
      context.beginPath();
      context.arc(screen.x, screen.y, radius + 4, 0, Math.PI * 2);
      context.strokeStyle = withAlpha(accent, "55%");
      context.lineWidth = 1.5;
      context.stroke();
    }
    context.beginPath();
    context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    if (kind === "hollow") {
      context.strokeStyle = accent;
      context.lineWidth = 2;
      context.stroke();
    } else {
      context.fillStyle = accent;
      context.fill();
      // Light inner ring so the dot reads on any background.
      context.beginPath();
      context.arc(screen.x, screen.y, radius - 2, 0, Math.PI * 2);
      context.strokeStyle = "oklch(0.985 0 0 / 70%)";
      context.lineWidth = 1;
      context.stroke();
    }
  }

  /**
   * Fills a world-space box in screen space (glue-target glow).
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param world - the world-space box.
   * @param color - fill colour.
   */
  private fillWorldBox(
    context: CanvasRenderingContext2D,
    camera: Camera,
    world: { minX: number; minY: number; maxX: number; maxY: number },
    color: string,
  ): void {
    const min = camera.worldToScreen(vec2(world.minX, world.minY));
    const max = camera.worldToScreen(vec2(world.maxX, world.maxY));
    context.fillStyle = color;
    context.fillRect(
      Math.min(min.x, max.x),
      Math.min(min.y, max.y),
      Math.abs(max.x - min.x),
      Math.abs(max.y - min.y),
    );
  }

  /**
   * Strokes a world-space box in screen space (glue-target glow).
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param world - the world-space box.
   * @param color - stroke colour.
   * @param lineWidth - stroke width in CSS pixels.
   */
  private strokeWorldBox(
    context: CanvasRenderingContext2D,
    camera: Camera,
    world: { minX: number; minY: number; maxX: number; maxY: number },
    color: string,
    lineWidth: number,
  ): void {
    const min = camera.worldToScreen(vec2(world.minX, world.minY));
    const max = camera.worldToScreen(vec2(world.maxX, world.maxY));
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.strokeRect(
      Math.min(min.x, max.x),
      Math.min(min.y, max.y),
      Math.abs(max.x - min.x),
      Math.abs(max.y - min.y),
    );
  }

  /**
   * Resolves a stroke colour: the palette token maps to the theme's stroke
   * colour, every other value is a literal CSS colour.
   *
   * @param color - the stored stroke colour (literal or token).
   * @returns the colour to paint with.
   */
  private resolveStrokeColor(color: string): string {
    return color === STROKE_COLOR_TOKEN ? this.palette.stroke : color;
  }

  /**
   * Resolves a shape fill colour: the fill token maps to the theme's
   * accent-tinted fill, every other value is a literal CSS colour.
   *
   * @param color - the stored fill colour (literal or token).
   * @returns the colour to paint with.
   */
  private resolveShapeFillColor(color: string): string {
    return color === SHAPE_FILL_TOKEN ? this.palette.shapeFill : color;
  }

  /**
   * Draws one frame object (R8.3): the title-bar strip (accent-tinted,
   * carrying the frame title — or the palette's untitled label when
   * empty), a translucent body wash and a solid border. The body is
   * transparent enough that contained objects (drawn later in paint
   * order or by the DOM text layer) stay fully readable — the frame is a
   * stage marker, not a backdrop.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param frame - the frame object.
   * @param viewport - the world-space cull window.
   */
  private drawFrame(
    context: CanvasRenderingContext2D,
    camera: Camera,
    frame: FrameObjectData,
    viewport: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    if (frame.width <= 0 || frame.height <= 0) {
      return;
    }
    const pad = frame.strokeWidth / 2 + 2 / camera.zoom;
    const min = frame.position;
    const max = vec2(
      frame.position.x + frame.width,
      frame.position.y + frame.height,
    );
    if (
      max.x + pad < viewport.minX ||
      min.x - pad > viewport.maxX ||
      max.y + pad < viewport.minY ||
      min.y - pad > viewport.maxY
    ) {
      return;
    }

    const screenMin = camera.worldToScreen(min);
    const screenMax = camera.worldToScreen(max);
    const x = Math.min(screenMin.x, screenMax.x);
    const y = Math.min(screenMin.y, screenMax.y);
    const width = Math.abs(screenMax.x - screenMin.x);
    const height = Math.abs(screenMax.y - screenMin.y);
    const titleHeightPx = Math.min(
      Math.abs(frame.titleHeight * camera.zoom),
      height,
    );
    const fontSizePx = Math.min(
      Math.max(titleHeightPx * 0.5, 9),
      titleHeightPx - 4,
    );

    context.save();
    // Body: soft accent wash under the content.
    context.fillStyle = this.resolveShapeFillColor(frame.fill);
    context.fillRect(x, y, width, height);
    // Title bar: stronger accent tint over the top strip.
    context.fillStyle = this.resolveShapeFillColor(frame.fill);
    context.globalAlpha = Math.min(1, 0.9);
    context.fillRect(x, y, width, titleHeightPx);
    context.globalAlpha = 1;
    // Border.
    context.strokeStyle = this.resolveStrokeColor(frame.stroke);
    context.lineWidth = Math.max(frame.strokeWidth * camera.zoom, 1);
    context.strokeRect(x, y, width, height);
    // Title text (Persian-safe: RTL direction detected per content).
    const title =
      frame.title !== ""
        ? frame.title
        : (this.palette.frameUntitledLabel ?? "");
    if (title !== "" && fontSizePx > 0) {
      const rtl = /[\u0600-\u06FF]/.test(title);
      context.font = `600 ${fontSizePx}px Vazirmatn, ui-sans-serif, system-ui`;
      context.fillStyle = this.resolveStrokeColor(frame.stroke);
      context.textBaseline = "middle";
      context.textAlign = rtl ? "right" : "left";
      const textX = rtl ? x + width - 10 : x + 10;
      context.fillText(title, textX, y + titleHeightPx / 2, width - 20);
    }
    context.restore();
  }

  /**
   * Draws one primitive shape: token-resolved fill under a crisp stroke.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param shape - the shape data to paint.
   * @param viewport - world-space culling bounds.
   */
  private drawShape(
    context: CanvasRenderingContext2D,
    camera: Camera,
    shape: ShapeObjectData,
    viewport: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    if (shape.width <= 0 || shape.height <= 0) {
      return;
    }
    const pad = shape.strokeWidth / 2 + 2 / camera.zoom;
    const min = shape.position;
    const max = vec2(
      shape.position.x + shape.width,
      shape.position.y + shape.height,
    );
    // Rotated shapes cull against their covering footprint (the tilted
    // corners can extend past the unrotated box).
    const cullBox = shape.rotation !== 0 ? rotatedObjectBBox(shape) : null;
    if (
      (cullBox ? cullBox.maxX : max.x) + pad < viewport.minX ||
      (cullBox ? cullBox.minX : min.x) - pad > viewport.maxX ||
      (cullBox ? cullBox.maxY : max.y) + pad < viewport.minY ||
      (cullBox ? cullBox.minY : min.y) - pad > viewport.maxY
    ) {
      return;
    }

    const screenMin = camera.worldToScreen(min);
    const screenMax = camera.worldToScreen(max);
    const x = Math.min(screenMin.x, screenMax.x);
    const y = Math.min(screenMin.y, screenMax.y);
    const width = Math.abs(screenMax.x - screenMin.x);
    const height = Math.abs(screenMax.y - screenMin.y);

    context.fillStyle = this.resolveShapeFillColor(shape.fill);
    context.strokeStyle = this.resolveStrokeColor(shape.stroke);
    context.lineWidth = Math.max(shape.strokeWidth * camera.zoom, 1);

    if (shape.rotation !== 0) {
      // The object rotates around its centre: translate to the screen
      // centre, rotate, and trace the rect centred on the origin. (Camera
      // rotation composes additively — rotation matrices commute with the
      // uniform zoom scale.)
      context.save();
      context.translate(x + width / 2, y + height / 2);
      context.rotate(camera.rotation + shape.rotation);
      this.traceShapePath(
        context,
        shape.shapeKind,
        -width / 2,
        -height / 2,
        width,
        height,
      );
      context.fill();
      context.stroke();
      context.restore();
      return;
    }
    this.traceShapePath(context, shape.shapeKind, x, y, width, height);
    context.fill();
    context.stroke();
  }

  /**
   * Traces the primitive outline inside a screen-space rect (fill + stroke
   * are applied by the caller). Rotation is not yet applied (always 0).
   *
   * @param context - the canvas 2D context to draw with.
   * @param shapeKind - the primitive geometry.
   * @param x - rect left in CSS pixels.
   * @param y - rect top in CSS pixels.
   * @param width - rect width in CSS pixels.
   * @param height - rect height in CSS pixels.
   */
  private traceShapePath(
    context: CanvasRenderingContext2D,
    shapeKind: ShapeKind,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    context.beginPath();
    switch (shapeKind) {
      case "rectangle":
        context.rect(x, y, width, height);
        break;
      case "roundedRectangle": {
        const radius = Math.min(width, height) * 0.16;
        context.roundRect(x, y, width, height, radius);
        break;
      }
      case "ellipse":
        context.ellipse(
          x + width / 2,
          y + height / 2,
          width / 2,
          height / 2,
          0,
          0,
          Math.PI * 2,
        );
        break;
      case "triangle":
        context.moveTo(x + width / 2, y);
        context.lineTo(x + width, y + height);
        context.lineTo(x, y + height);
        context.closePath();
        break;
      case "diamond":
        context.moveTo(x + width / 2, y);
        context.lineTo(x + width, y + height / 2);
        context.lineTo(x + width / 2, y + height);
        context.lineTo(x, y + height / 2);
        context.closePath();
        break;
      case "star": {
        const cx = x + width / 2;
        const cy = y + height / 2;
        const outerX = width / 2;
        const outerY = height / 2;
        const innerX = outerX * 0.44;
        const innerY = outerY * 0.44;
        for (let i = 0; i < 10; i += 1) {
          const outer = i % 2 === 0;
          const rx = outer ? outerX : innerX;
          const ry = outer ? outerY : innerY;
          const angle = -Math.PI / 2 + (i * Math.PI) / 5;
          const px = cx + rx * Math.cos(angle);
          const py = cy + ry * Math.sin(angle);
          if (i === 0) {
            context.moveTo(px, py);
          } else {
            context.lineTo(px, py);
          }
        }
        context.closePath();
        break;
      }
    }
  }

  /**
   * Draws one freehand stroke as a smoothed quadratic path.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param stroke - the stroke data to paint.
   * @param viewport - world-space culling bounds.
   */
  private drawFreehand(
    context: CanvasRenderingContext2D,
    camera: Camera,
    stroke: FreehandObjectData,
    viewport: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const points = stroke.points;
    if (points.length === 0) {
      return;
    }
    const pad = stroke.strokeWidth / 2 + 2 / camera.zoom;
    const bounds = strokeBounds(points);
    if (
      bounds.maxX + pad < viewport.minX ||
      bounds.minX - pad > viewport.maxX ||
      bounds.maxY + pad < viewport.minY ||
      bounds.minY - pad > viewport.maxY
    ) {
      return;
    }

    context.save();
    context.strokeStyle = this.resolveStrokeColor(stroke.strokeColor);
    if (stroke.highlighter === true) {
      // R5.4 marker mode: wide translucent ink, multiply-blended so
      // canvas ink underneath shows through the stroke. Text lives in
      // the DOM layer ABOVE the canvas and always stays readable (AC5.4).
      // Butt caps give the flat chisel-tip feel; the wider stroke width
      // is the stored `strokeWidth` itself, so hit-tests and the eraser
      // (which use the stored width) stay consistent with the visual.
      context.globalAlpha = HIGHLIGHTER_ALPHA;
      context.globalCompositeOperation = "multiply";
      context.lineWidth = Math.max(stroke.strokeWidth * camera.zoom, 3);
      context.lineCap = "butt";
      context.lineJoin = "round";
    } else {
      context.lineWidth = Math.max(stroke.strokeWidth * camera.zoom, 1);
      context.lineCap = "round";
      context.lineJoin = "round";
    }
    this.tracePath(context, camera, points);
    context.stroke();
    context.restore();
  }

  /**
   * Traces the smoothed stroke path from the PURE midpoint-quadratic
   * description ({@link smoothedStrokePath} — node-testable, AC5.8); a
   * lone point is traced as a zero-length segment so its round cap paints
   * a dot.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param points - stroke points in world coordinates.
   */
  private tracePath(
    context: CanvasRenderingContext2D,
    camera: Camera,
    points: readonly Vec2[],
  ): void {
    const smooth = smoothedStrokePath(points);
    const start = camera.worldToScreen(smooth.start);
    context.beginPath();
    context.moveTo(start.x, start.y);
    if (points.length === 1) {
      context.lineTo(start.x + 0.01, start.y);
      return;
    }
    const second = camera.worldToScreen(smooth.firstLineTo);
    context.lineTo(second.x, second.y);
    for (const quad of smooth.quads) {
      const control = camera.worldToScreen(quad.control);
      const end = camera.worldToScreen(quad.end);
      context.quadraticCurveTo(control.x, control.y, end.x, end.y);
    }
    const last = camera.worldToScreen(smooth.finalLineTo);
    context.lineTo(last.x, last.y);
  }

  /**
   * @returns the canvas CSS size derived from its backing store and DPR.
   */
  private cssSize(): { width: number; height: number } {
    if (this.canvas === null) {
      return { width: 0, height: 0 };
    }
    const dpr = window.devicePixelRatio || 1;
    return {
      width: this.canvas.width / dpr,
      height: this.canvas.height / dpr,
    };
  }
}

/**
 * Computes the world-space bounds of the visible viewport.
 *
 * @param camera - the viewport transform.
 * @param width - viewport width in CSS pixels.
 * @param height - viewport height in CSS pixels.
 * @returns the world-space bounding box of the screen rectangle.
 */
function worldViewport(
  camera: Camera,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const corners = [
    camera.screenToWorld(vec2(0, 0)),
    camera.screenToWorld(vec2(width, 0)),
    camera.screenToWorld(vec2(0, height)),
    camera.screenToWorld(vec2(width, height)),
  ];
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
}

/**
 * Computes the bounds of a stroke point list.
 *
 * @param points - stroke points in world coordinates.
 * @returns the axis-aligned bounds covering every point.
 */
function strokeBounds(points: readonly Vec2[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Injects an alpha into a functional CSS colour ("oklch(0.7 0.1 20)" →
 * "oklch(0.7 0.1 20 / 45%)"). Non-functional colours return unchanged —
 * they are used at full opacity instead.
 *
 * @param color - the base CSS colour string.
 * @param alpha - the alpha channel value (e.g. "45%").
 * @returns the colour with the alpha applied.
 */
function withAlpha(color: string, alpha: string): string {
  if (color.endsWith(")")) {
    return `${color.slice(0, -1)} / ${alpha})`;
  }
  return color;
}

/**
 * Traces a rounded rectangle path with `arcTo` corners (universally
 * supported — no reliance on the newer `roundRect`), for the connector
 * label chip.
 *
 * @param context - the canvas 2D context to trace on.
 * @param x - the chip's left edge.
 * @param y - the chip's top edge.
 * @param width - the chip's width.
 * @param height - the chip's height.
 * @param radius - the corner radius (clamped to half the smaller side).
 */
function chipRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/**
 * Resolves a draft endpoint's exit direction: glued drafts exit along their
 * anchor's outward vector (the rubber-band mirrors the committed geometry);
 * floating drafts have no exit hint.
 *
 * @param endpoint - the draft endpoint.
 * @param scene - the scene providing the glue target.
 * @returns the unit exit vector, or null while floating.
 */
function draftExit(endpoint: ConnectorEndpoint, scene: Scene): Vec2 | null {
  if (endpoint.objectId === null) {
    return null;
  }
  const target = scene.findById(endpoint.objectId);
  if (target === undefined || !target.visible) {
    return null;
  }
  return anchorExitVector(endpoint.anchorIndex);
}

/**
 * Computes the unit tangent pointing INTO the path end (screen space).
 *
 * @param shape - the connector path shape.
 * @returns the unit direction of the final path segment.
 */
function pathEndTangent(shape: {
  readonly points: readonly Vec2[];
  readonly bezier: boolean;
}): Vec2 {
  const points = shape.points;
  const end = points[points.length - 1] ?? vec2(0, 0);
  const previous = shape.bezier
    ? (points[1] ?? end) // bezier: tangent at the end is end − control
    : (points[points.length - 2] ?? end);
  return normalize(vec2(end.x - previous.x, end.y - previous.y));
}

/**
 * Computes the unit tangent pointing INTO the path start (screen space) —
 * the start arrow points opposite to the outgoing direction.
 *
 * @param shape - the connector path shape.
 * @returns the unit direction pointing into the start tip.
 */
function pathStartTangent(shape: {
  readonly points: readonly Vec2[];
  readonly bezier: boolean;
}): Vec2 {
  const points = shape.points;
  const start = points[0] ?? vec2(0, 0);
  const next = points[1] ?? start;
  return normalize(vec2(start.x - next.x, start.y - next.y));
}

/**
 * @param vector - the vector to normalise.
 * @returns the unit vector (zero vector passes through unchanged).
 */
function normalize(vector: Vec2): Vec2 {
  const length = Math.hypot(vector.x, vector.y);
  if (length === 0) {
    return vector;
  }
  return vec2(vector.x / length, vector.y / length);
}

/**
 * Computes the point on a box's boundary along the centre→target ray
 * (the knowledge-edge attachment point, R12.4).
 *
 * @param box - the object's world-space bounding box.
 * @param towards - the point the edge walks toward.
 * @returns the boundary point (the centre when the ray is degenerate).
 */
function boxEdgeToward(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  towards: Vec2,
): Vec2 {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) {
    return vec2(cx, cy);
  }
  const halfWidth = Math.abs(box.maxX - box.minX) / 2;
  const halfHeight = Math.abs(box.maxY - box.minY) / 2;
  const tx = dx === 0 ? Infinity : halfWidth / Math.abs(dx);
  const ty = dy === 0 ? Infinity : halfHeight / Math.abs(dy);
  const t = Math.min(tx, ty);
  return vec2(cx + dx * t, cy + dy * t);
}

/**
 * Truncates a display string with an ellipsis (فاز M1 — the
 * missing-video placeholder's original-name line).
 *
 * @param value - the string to shorten.
 * @param max - the maximum kept characters.
 * @returns the (possibly) ellipsised string.
 */
function ellipsize(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value;
}
