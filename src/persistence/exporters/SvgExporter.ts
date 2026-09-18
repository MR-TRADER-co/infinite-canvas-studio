/**
 * SVG exporter (R8.7): vectorises the GEOMETRY of shapes, sticky notes
 * and frames (rect/ellipse primitives, rounded corners), and embeds the
 * TEXT LAYER as a single raster `<image>` — the documented limitation
 * (the dialog states it) that keeps Persian shaping, bidi and fonts
 * pixel-exact (the PNG pipeline's proven rasterization). Connectors,
 * freehand strokes and images join the raster layer too (their
 * z-interleaving with text cannot be split faithfully at vector level).
 *
 * Coordinates: the viewBox maps world units 1:1 (scale via width/height
 * attributes), so the file stays resolution-independent for the vector
 * part.
 */
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { objectBBox } from "@/core/model/SceneObject";
import { isShapeObject, type ShapeObjectData } from "@/core/model/ShapeObject";
import {
  isStickyNoteObject,
  type StickyNoteObjectData,
} from "@/core/model/StickyNoteObject";
import { isFrameObject, type FrameObjectData } from "@/core/model/FrameObject";
import { SHAPE_FILL_TOKEN } from "@/core/model/ShapeObject";
import { STROKE_COLOR_TOKEN } from "@/core/model/FreehandObject";
import {
  computeExportBounds,
  buildPinnedExportPlan,
  buildTextLayerHtml,
  exportProseCss,
  PngExportError,
  sceneViewOf,
  type PinnedExportPlan,
  type PngExportOptions,
} from "@/persistence/exporters/PngExporter";
import {
  collectEmbeddedFontFaces,
  rasterizeHtml,
} from "@/persistence/exporters/DomRasterizer";
import { bbox, type BBox } from "@/core/geometry/BBox";

/** Re-exported typed error (same failure family as the PNG pipeline). */
export { PngExportError as SvgExportError };

/** Options of one SVG export (a subset of the PNG options). */
export interface SvgExportOptions extends Pick<
  PngExportOptions,
  | "region"
  | "scale"
  | "palette"
  | "themeInk"
  | "themeBorder"
  | "themeMuted"
  | "renderRichHtml"
  | "padding"
  | "includePinned"
  | "pinnedViewport"
  | "viewportWorldFrame"
> {
  /** Whether the background rect is skipped (transparent SVG). */
  readonly transparent: boolean;
}

/** Result of one SVG export. */
export interface SvgExportResult {
  /** The SVG document (string). */
  readonly svg: string;
  /** Pixel width of the viewBox. */
  readonly width: number;
  /** Pixel height of the viewBox. */
  readonly height: number;
}

/** Default world-unit margin (mirrors the PNG pipeline). */
const DEFAULT_PADDING = 24;

/** Maximum exported pixel edge (raster layer guard). */
const MAX_EDGE_PIXELS = 16_384;

/**
 * Escapes XML text content.
 *
 * @param value - the raw text.
 * @returns the escaped text.
 */
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Formats a world coordinate for SVG attributes (2-decimals max).
 *
 * @param value - the coordinate.
 * @returns the formatted number.
 */
function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Vectorises one shape as an SVG element (fill + stroke + geometry).
 *
 * @param shape - the shape object.
 * @param palette - the resolved colours (tokens already mapped).
 * @returns the SVG fragment, or null for exotic shapes.
 */
function shapeSvg(
  shape: ShapeObjectData,
  palette: { fill: string; stroke: string },
): string | null {
  const x = num(shape.position.x);
  const y = num(shape.position.y);
  const w = num(shape.width);
  const h = num(shape.height);
  const style = `fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="${num(shape.strokeWidth)}"`;
  switch (shape.shapeKind) {
    case "rectangle":
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${style}/>`;
    case "roundedRectangle": {
      const radius = Math.min(shape.width, shape.height) * 0.16;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${num(radius)}" ${style}/>`;
    }
    case "ellipse":
      return `<ellipse cx="${num(shape.position.x + shape.width / 2)}" cy="${num(shape.position.y + shape.height / 2)}" rx="${num(shape.width / 2)}" ry="${num(shape.height / 2)}" ${style}/>`;
    case "triangle":
      return `<polygon points="${num(shape.position.x + shape.width / 2)},${y} ${num(shape.position.x + shape.width)},${num(shape.position.y + shape.height)} ${x},${num(shape.position.y + shape.height)}" ${style}/>`;
    case "diamond":
      return `<polygon points="${num(shape.position.x + shape.width / 2)},${y} ${num(shape.position.x + shape.width)},${num(shape.position.y + shape.height / 2)} ${num(shape.position.x + shape.width / 2)},${num(shape.position.y + shape.height)} ${x},${num(shape.position.y + shape.height / 2)}" ${style}/>`;
    default:
      // star + exotic kinds: rendered on the raster layer instead.
      return null;
  }
}

/**
 * Vectorises one sticky note (card + shadow-less simple rect).
 *
 * @param note - the sticky note object.
 * @param stroke - the resolved border colour.
 * @returns the SVG fragment.
 */
function stickySvg(note: StickyNoteObjectData, stroke: string): string {
  const x = num(note.position.x);
  const y = num(note.position.y);
  const w = num(note.width);
  const h = num(note.height);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${note.noteColor}" stroke="${stroke}" stroke-width="1"/>`;
}

/**
 * Vectorises one frame (body wash + title strip + border).
 *
 * @param frame - the frame object.
 * @param palette - the resolved colours.
 * @returns the SVG fragment.
 */
function frameSvg(
  frame: FrameObjectData,
  palette: { fill: string; stroke: string },
): string {
  const x = num(frame.position.x);
  const y = num(frame.position.y);
  const w = num(frame.width);
  const h = num(frame.height);
  const titleH = num(frame.titleHeight);
  const title = frame.title === "" ? escapeXml("") : escapeXml(frame.title);
  const titleText =
    title === ""
      ? ""
      : `<text x="${num(frame.position.x + frame.width - 10)}" y="${num(frame.position.y + frame.titleHeight / 2)}" text-anchor="end" dominant-baseline="middle" font-family="Vazirmatn, sans-serif" font-size="${num(frame.titleHeight * 0.5)}" font-weight="600" fill="${palette.stroke}" direction="rtl">${title}</text>`;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="${num(frame.strokeWidth)}"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${titleH}" fill="${palette.fill}" stroke="none"/>` +
    `<line x1="${x}" y1="${num(frame.position.y + frame.titleHeight)}" x2="${num(frame.position.x + frame.width)}" y2="${num(frame.position.y + frame.titleHeight)}" stroke="${palette.stroke}" stroke-width="1"/>` +
    titleText
  );
}

/**
 * Resolves a token colour against the palette.
 *
 * @param stored - the stored (token or literal) colour.
 * @param token - the token sentinel.
 * @param resolved - the palette colour for the token.
 * @returns the literal colour.
 */
function resolveColor(stored: string, token: string, resolved: string): string {
  return stored === token ? resolved : stored;
}

/**
 * Exports the framed region as an SVG document.
 *
 * @param scene - the live scene.
 * @param options - the export options.
 * @returns the SVG string + dimensions.
 * @throws PngExportError (typed) on every failure path.
 */
export async function exportToSvg(
  scene: Scene,
  options: SvgExportOptions,
): Promise<SvgExportResult> {
  const padding = options.padding ?? DEFAULT_PADDING;
  const rawBounds = computeExportBounds(
    scene,
    options.region,
    options.viewportWorldFrame,
  );
  if (rawBounds === null) {
    throw new PngExportError(
      "no-content",
      "nothing visible inside the export region",
    );
  }
  if (typeof document === "undefined") {
    throw new PngExportError("rasterization", "no DOM available");
  }
  const bounds = bbox(
    rawBounds.minX - padding,
    rawBounds.minY - padding,
    rawBounds.maxX + padding,
    rawBounds.maxY + padding,
  );
  const width = Math.max(
    1,
    Math.round((bounds.maxX - bounds.minX) * options.scale),
  );
  const height = Math.max(
    1,
    Math.round((bounds.maxY - bounds.minY) * options.scale),
  );
  if (width > MAX_EDGE_PIXELS || height > MAX_EDGE_PIXELS) {
    throw new PngExportError(
      "rasterization",
      `export size ${width}x${height} exceeds the ${MAX_EDGE_PIXELS}px raster limit`,
    );
  }

  // ── فاز ۲۸: the pinned-aware plan (excluded pinned objects vanish;
  // included ones become UNPINNED mapped clones riding the world paths).
  const plan = buildPinnedExportPlan(scene, bounds, options.scale, options);

  // ── vector layer: shapes + sticky cards + frames (world coords) ────
  const palette = {
    fill: options.palette.shapeFill,
    stroke: options.palette.stroke,
  };
  const vectorParts: string[] = [];
  for (const object of plan.canvasObjects) {
    if (!object.visible) {
      continue;
    }
    if (isShapeObject(object)) {
      const fragment = shapeSvg(object, {
        fill: resolveColor(object.fill, SHAPE_FILL_TOKEN, palette.fill),
        stroke: resolveColor(object.stroke, STROKE_COLOR_TOKEN, palette.stroke),
      });
      if (fragment !== null) {
        vectorParts.push(fragment);
      }
      continue;
    }
    if (isStickyNoteObject(object)) {
      vectorParts.push(stickySvg(object, palette.stroke));
      continue;
    }
    if (isFrameObject(object)) {
      vectorParts.push(frameSvg(object, palette));
    }
  }

  // ── raster layer: text (and every non-vectorised kind) ─────────────
  // The canvas layer renders everything EXCEPT the vectorised kinds at
  // scale; the text layer raster composites on top — one <image>.
  const rasterPng = await rasterComposite(scene, plan, bounds, options);

  const background = options.transparent
    ? ""
    : `<rect x="${num(bounds.minX)}" y="${num(bounds.minY)}" width="${num(bounds.maxX - bounds.minX)}" height="${num(bounds.maxY - bounds.minY)}" fill="${options.palette.background}"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="${num(bounds.minX)} ${num(bounds.minY)} ${num(bounds.maxX - bounds.minX)} ${num(bounds.maxY - bounds.minY)}">` +
    `<title>Infinite Canvas Studio export</title>` +
    background +
    vectorParts.join("") +
    (rasterPng !== null
      ? `<image x="${num(bounds.minX)}" y="${num(bounds.minY)}" width="${num(bounds.maxX - bounds.minX)}" height="${num(bounds.maxY - bounds.minY)}" href="${rasterPng}" preserveAspectRatio="none"/>`
      : "") +
    `</svg>`;
  return { svg, width, height };
}

/**
 * Renders the RASTER half of the export (text objects + every kind the
 * vector layer does not cover) onto an offscreen canvas, returning the
 * PNG data URL.
 *
 * @param scene - the live scene.
 * @param plan - the pinned-aware export plan (فاز ۲۸).
 * @param bounds - the padded export bounds.
 * @param options - the export options.
 * @returns the PNG data URL, or null when nothing rasterises.
 */
async function rasterComposite(
  scene: Scene,
  plan: PinnedExportPlan,
  bounds: BBox,
  options: SvgExportOptions,
): Promise<string | null> {
  // Gather the objects the raster covers: text + non-vector kinds. The
  // plan's canvasObjects carry the pinned mapped clones (unpinned — they
  // flow through the same filters as every world object).
  const rasterObjects = plan.canvasObjects.filter(
    (object) =>
      object.visible &&
      !(isShapeObject(object) && shapeVectorisable(object)) &&
      !isStickyNoteObject(object) &&
      !isFrameObject(object),
  );
  const textObjects = plan.textObjects;
  const nothingToRaster =
    rasterObjects.length === 0 && textObjects.length === 0;
  if (nothingToRaster) {
    return null;
  }

  const { Canvas2DRenderer } = await import("@/rendering/Canvas2DRenderer");
  const { Camera } = await import("@/core/camera/Camera");
  const pixelWidth = Math.max(
    1,
    Math.round((bounds.maxX - bounds.minX) * options.scale),
  );
  const pixelHeight = Math.max(
    1,
    Math.round((bounds.maxY - bounds.minY) * options.scale),
  );
  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const renderer = new Canvas2DRenderer();
  renderer.initialize(canvas);
  renderer.setPalette({ ...options.palette, background: "transparent" });
  renderer.setGridVisible(false);
  // A scene view of ONLY the raster objects: the renderer draws the
  // scene we hand it, so a filtered snapshot scene avoids the
  // double-draw of vectorised kinds.
  const filteredScene = sceneViewOf(scene, rasterObjects);
  await renderer.preloadImages(filteredScene);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const camera = new Camera(bounds.minX, bounds.minY, options.scale / dpr, 0);
  renderer.render(filteredScene, camera);
  renderer.dispose();

  // Text layer raster (same machinery as the PNG exporter).
  if (textObjects.length > 0) {
    const fontFaces = await collectEmbeddedFontFaces().catch(() => "");
    const html = buildTextLayerHtml(
      textObjects,
      bounds,
      options.scale,
      options,
      plan.textOverrides,
    );
    const css = exportProseCss(options);
    const context = canvas.getContext("2d");
    if (context !== null) {
      const image = await rasterizeHtml(
        html,
        pixelWidth,
        pixelHeight,
        `${css}\n${fontFaces}`,
      );
      context.drawImage(image, 0, 0);
    }
  }
  return canvas.toDataURL("image/png");
}

/**
 * Whether a shape is vectorised (vs. rasterised).
 *
 * @param shape - the shape object.
 * @returns whether shapeSvg covers its primitive.
 */
function shapeVectorisable(shape: ShapeObjectData): boolean {
  return (
    shape.shapeKind === "rectangle" ||
    shape.shapeKind === "roundedRectangle" ||
    shape.shapeKind === "ellipse" ||
    shape.shapeKind === "triangle" ||
    shape.shapeKind === "diamond"
  );
}

/**
 * Bounding box of every frame (the PDF frame-mode planner consumes it).
 *
 * @param scene - the live scene.
 * @returns the visible frames.
 */
export function visibleFrames(scene: Scene): readonly FrameObjectData[] {
  return scene.objects.filter(
    (object) => isFrameObject(object) && object.visible,
  ) as FrameObjectData[];
}

/**
 * The export bounds helper re-exported for planners.
 */
export { computeExportBounds as computeSvgExportBounds };

/**
 * @param object - any object.
 * @returns its bounds (helper for planners).
 */
export function boundsOf(object: SceneObjectData): BBox {
  return objectBBox(object);
}
