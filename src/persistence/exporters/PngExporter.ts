/**
 * PNG exporter (R4.8): renders the scene (whole board, the current
 * selection, or a chosen bbox) offscreen at 1x/2x by COMPOSITING the
 * canvas layer (shapes, connectors, strokes, images, opaque
 * placeholders — a fresh {@link Canvas2DRenderer} with the export
 * transform) and the rasterized text layer ({@link DomRasterizer}: the
 * SVG-foreignObject technique with Vazirmatn embedded as base64, so
 * Persian text, bidi, lists and rotated boxes export with correct
 * fonts — AC4.7).
 *
 * A transparent background option skips the theme fill; every failure
 * (no content, unavailable fonts, rasterization) surfaces a TYPED error
 * — content is never silently dropped.
 */
import {
  Canvas2DRenderer,
  type RenderPalette,
} from "@/rendering/Canvas2DRenderer";
import { Camera } from "@/core/camera/Camera";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import {
  isTextBoxObject,
  type TextBoxObjectData,
} from "@/core/model/TextBoxObject";
import {
  isStickyNoteObject,
  type StickyNoteObjectData,
  STICKY_LINE_HEIGHT,
  STICKY_PADDING_X,
  STICKY_PADDING_Y,
} from "@/core/model/StickyNoteObject";
import {
  TEXT_LINE_HEIGHT,
  TEXT_PADDING_X,
  TEXT_PADDING_Y,
} from "@/core/model/TextBoxObject";
import { rotatedObjectBBox } from "@/core/model/SceneObject";
import { bbox, type BBox } from "@/core/geometry/BBox";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";
import {
  isPinnedObject,
  type ViewportSize,
} from "@/core/model/Pinned";
import { TEXT_COLOR_TOKEN } from "@/core/model/TextBoxObject";
import type { RichTextDocument } from "@/text/editor/richtext";
import {
  collectEmbeddedFontFaces,
  DomRasterizerError,
  rasterizeHtml,
} from "@/persistence/exporters/DomRasterizer";

/** What the export frames. */
export type ExportRegion =
  | { readonly mode: "scene" }
  | { readonly mode: "selection"; readonly ids: readonly string[] }
  | { readonly mode: "bbox"; readonly box: BBox };

/** Options of one PNG export. */
export interface PngExportOptions {
  /** The framed region (whole board / selection / explicit box). */
  readonly region: ExportRegion;
  /** Pixel scale (1 = 1 world unit → 1 px, 2 = the AC4.7 crispness). */
  readonly scale: number;
  /** Whether the background fill is skipped (transparent PNG). */
  readonly transparent: boolean;
  /** Theme palette the canvas layer paints with. */
  readonly palette: RenderPalette;
  /** Ink colour text tokens resolve to (theme foreground). */
  readonly themeInk: string;
  /** Border colour of exported tables. */
  readonly themeBorder: string;
  /** Muted panel colour of exported code blocks/quotes. */
  readonly themeMuted: string;
  /** World-unit margin around the framed content (default 24). */
  readonly padding?: number;
  /**
   * فاز ۲۸ «شامل اشیای سنجاق‌شده»: when true, pinned-to-screen objects
   * join the export at their ON-SCREEN RELATIVE positions (the anchor
   * fraction of the export image, footprint scaled to the same relative
   * size). Default false — the board exports exactly the world content.
   */
  readonly includePinned?: boolean;
  /**
   * The live canvas viewport in CSS pixels — the reference the pinned
   * footprint is scaled against (`object px · export/viewport`). Falls
   * back to the stored pixel sizes when absent (headless callers).
   */
  readonly pinnedViewport?: ViewportSize;
  /**
   * فاز ۳۱: the live camera's viewport expressed in WORLD units — the
   * fallback frame when the region pins down to NOTHING exportable (a
   * board holding only pinned objects). The mapped pinned clones place
   * themselves as anchor fractions of the final bounds, so framing the
   * viewport reproduces what the user sees on screen (WYSIWYG). Absent
   * for headless callers — a truly empty scene still fails honestly with
   * `no-content`.
   */
  readonly viewportWorldFrame?: BBox;
  /**
   * Rich-text HTML renderer (the shared editor's
   * `renderRichTextHTML(schema, doc)` bound closure) — injected so this
   * module stays free of text/editor imports and node-testable.
   */
  readonly renderRichHtml: (doc: RichTextDocument) => string;
}

/** Typed export failure (surfaced as a Persian error, never silent). */
export class PngExportError extends Error {
  /**
   * @param kind - the machine-readable failure kind.
   * @param message - the developer-facing detail.
   */
  public constructor(
    public readonly kind: "no-content" | "fonts" | "rasterization",
    message: string,
  ) {
    super(message);
    this.name = "PngExportError";
  }
}

/** Default world-unit margin around the framed content. */
const DEFAULT_PADDING = 24;

/** Maximum exported pixel edge (memory guard: 16384 = canvas limit). */
const MAX_EDGE_PIXELS = 16_384;

/**
 * Computes the world-space bounds of the export region.
 *
 * فاز ۲۸: pinned objects are SKIPPED — their stored world position is the
 * stale pre-pin spot (rendering ignores it while pinned), so it must never
 * frame the export. When included, they overlay the image as anchor
 * fractions of the final bounds instead (see {@link buildPinnedExportPlan}).
 *
 * فاز ۳۱: when the region pins down to NOTHING (a board holding only
 * pinned objects — or a selection of only pinned objects), the provided
 * `viewportWorldFrame` (the live camera's viewport in world units) frames
 * the export instead of failing: the mapped pinned clones sit at their
 * on-screen relative positions, so the file reproduces the user's view.
 * The fallback NEVER applies to a scene without visible pinned objects —
 * a truly empty board still returns null (the honest `no-content`).
 *
 * @param scene - the scene providing the objects.
 * @param region - the framed region.
 * @param viewportWorldFrame - optional world-space viewport frame used as
 * the fallback for pins-only regions (live callers pass the camera's view;
 * headless callers omit it to keep the legacy behaviour).
 * @returns the framed bounds, or null when nothing (visible) is framed.
 */
export function computeExportBounds(
  scene: Scene,
  region: ExportRegion,
  viewportWorldFrame?: BBox | null,
): BBox | null {
  let bounds: BBox | null = null;
  const absorb = (object: SceneObjectData): void => {
    if (!object.visible || isPinnedObject(object)) {
      return;
    }
    const box = rotatedObjectBBox(object);
    bounds =
      bounds === null
        ? box
        : bbox(
            Math.min(bounds.minX, box.minX),
            Math.min(bounds.minY, box.minY),
            Math.max(bounds.maxX, box.maxX),
            Math.max(bounds.maxY, box.maxY),
          );
  };
  if (region.mode === "bbox") {
    bounds = region.box;
  } else if (region.mode === "scene") {
    for (const object of scene.objects) {
      absorb(object);
    }
  } else {
    const wanted = new Set(region.ids);
    for (const object of scene.objects) {
      if (wanted.has(object.id)) {
        absorb(object);
      }
    }
  }
  if (
    bounds === null &&
    viewportWorldFrame != null &&
    scene.objects.some(
      (object) => object.visible && isPinnedObject(object),
    )
  ) {
    // فاز ۳۱: a pins-only board frames the live viewport — the pinned
    // clones' anchor-fraction placement maps 1:1 onto what the user sees.
    return viewportWorldFrame;
  }
  return bounds;
}

/**
 * Placement of one pinned object mapped into the EXPORT image's world
 * bounds (فاز ۲۸): the anchor fraction of the export image becomes a world
 * position, and the on-screen footprint (a fraction of the live viewport)
 * becomes the same fraction of the export image — WYSIWYG for screen
 * furniture.
 */
export interface PinnedExportPlacement {
  /** World-space top-left the mapped clone renders at. */
  readonly position: Vec2;
  /** Mapped width in world units. */
  readonly width: number;
  /** Mapped height in world units. */
  readonly height: number;
}

/**
 * Maps one pinned object into the export bounds.
 *
 * Position: `bounds.min + anchor · bounds.size` — the anchor fraction of
 * the EXPORT IMAGE (scale-independent). Size: with a viewport, the on-screen
 * footprint (`object px · world/viewport` per axis — the relative footprint,
 * so a note covering 15% of the screen covers 15% of the image); without
 * one, the stored pixel size at the export scale (a headless fallback).
 *
 * @param object - the pinned object (must carry numeric width/height).
 * @param bounds - the padded export bounds (the image's world rect).
 * @param scale - the export pixel scale.
 * @param viewport - the live viewport in CSS px, or null when unknown.
 * @returns the mapped placement.
 */
export function pinnedExportPlacement(
  object: SceneObjectData & { readonly width: number; readonly height: number },
  bounds: BBox,
  scale: number,
  viewport: ViewportSize | null,
): PinnedExportPlacement {
  const anchor = object.pinAnchor ?? vec2(0, 0);
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxY - bounds.minY;
  const position = vec2(
    bounds.minX + anchor.x * worldWidth,
    bounds.minY + anchor.y * worldHeight,
  );
  if (viewport === null || viewport.width <= 0 || viewport.height <= 0) {
    // Headless fallback: the stored pixel size at the export scale (the
    // object lands at its anchor at exactly its on-screen pixel size).
    return {
      position,
      width: object.width / scale,
      height: object.height / scale,
    };
  }
  return {
    position,
    width: (object.width * worldWidth) / viewport.width,
    height: (object.height * worldHeight) / viewport.height,
  };
}

/** Per-object text-layer transform override (pinned text kinds, فاز ۲۸). */
export interface TextLayerOverride {
  /** Div origin in DEVICE pixels (the translate() part). */
  readonly originX: number;
  readonly originY: number;
  /** X scale (the div keeps its stored px size; CSS scales it). */
  readonly scaleX: number;
  /** Y scale. */
  readonly scaleY: number;
}

/**
 * The pinned-aware rendering plan of one export (فاز ۲۸): the object list
 * the canvas/vector layers draw (unpinned objects + mapped clones for the
 * included pinned ones — clones are UNPINNED, so they ride the regular
 * world pass: every per-kind drawer, culling and the image cache work
 * unchanged, and no pin chrome can ever leak), and the text-layer objects
 * with per-object transform overrides (pinned text/sticky keep their
 * stored size and scale via CSS — text must never REFLOW).
 */
export interface PinnedExportPlan {
  /** Canvas/vector-layer objects in paint order (pinned clones LAST —
   * pinned furniture floats above the world, mirroring the live pass). */
  readonly canvasObjects: readonly SceneObjectData[];
  /** Text-layer objects (unpinned + included pinned, original sizes). */
  readonly textObjects: readonly SceneObjectData[];
  /** Transform overrides for the pinned text-layer objects (by id). */
  readonly textOverrides: ReadonlyMap<string, TextLayerOverride>;
}

/**
 * Builds the pinned-aware export plan.
 *
 * @param scene - the live scene.
 * @param bounds - the padded export bounds.
 * @param scale - the export pixel scale.
 * @param options - `includePinned` + `pinnedViewport`.
 * @returns the plan (empty maps/lists when no pinned object is included).
 */
export function buildPinnedExportPlan(
  scene: Scene,
  bounds: BBox,
  scale: number,
  options: Pick<PngExportOptions, "includePinned" | "pinnedViewport">,
): PinnedExportPlan {
  const worldObjects: SceneObjectData[] = [];
  const pinnedClones: SceneObjectData[] = [];
  const textObjects: SceneObjectData[] = [];
  const textOverrides = new Map<string, TextLayerOverride>();
  const includePinned = options.includePinned === true;
  const viewport =
    options.pinnedViewport !== undefined &&
    options.pinnedViewport.width > 0 &&
    options.pinnedViewport.height > 0
      ? options.pinnedViewport
      : null;
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxY - bounds.minY;
  const pixelWidth = worldWidth * scale;
  const pixelHeight = worldHeight * scale;
  const isTextKind = (object: SceneObjectData): boolean =>
    isTextBoxObject(object) || isStickyNoteObject(object);
  for (const object of scene.objects) {
    if (!isPinnedObject(object)) {
      worldObjects.push(object);
      if (object.visible && isTextKind(object)) {
        textObjects.push(object);
      }
      continue;
    }
    if (!includePinned || !object.visible) {
      // Excluded: pinned objects never render at their stale world spot.
      continue;
    }
    const sized = object as SceneObjectData & {
      readonly width: number;
      readonly height: number;
    };
    if (typeof sized.width !== "number" || typeof sized.height !== "number") {
      continue;
    }
    const anchor = object.pinAnchor ?? vec2(0, 0);
    const placement = pinnedExportPlacement(sized, bounds, scale, viewport);
    // The mapped clone: UNPINNED (rides the world pass), same id (glue
    // lookups — connector endpoints — resolve to the mapped spot). The
    // typed cast mirrors the withManualSizeMode precedent: the union's
    // sized variants all carry width/height.
    const clone = {
      ...sized,
      pinned: false,
      pinAnchor: undefined,
      position: placement.position,
      width: placement.width,
      height: placement.height,
    } as SceneObjectData;
    pinnedClones.push(clone);
    if (isTextKind(object)) {
      // The DOM div keeps its STORED size (no reflow) and CSS-scales to
      // the same relative footprint the canvas clone would take.
      textObjects.push(object);
      textOverrides.set(object.id, {
        originX: anchor.x * pixelWidth,
        originY: anchor.y * pixelHeight,
        scaleX: viewport === null ? 1 : pixelWidth / viewport.width,
        scaleY: viewport === null ? 1 : pixelHeight / viewport.height,
      });
    }
  }
  return {
    canvasObjects: [...worldObjects, ...pinnedClones],
    textObjects,
    textOverrides,
  };
}

/**
 * Builds a read-only scene-like view over an object subset (the renderers'
 * public surface only reads `objects` during one render call — the
 * SvgExporter precedent, shared for the pinned-aware export views).
 *
 * @param scene - the source scene.
 * @param objects - the objects the view exposes.
 * @returns the subset view.
 */
export function sceneViewOf(
  scene: Scene,
  objects: readonly SceneObjectData[],
): Scene {
  const view = Object.create(scene) as Scene;
  Object.defineProperty(view, "objects", {
    get: () => objects,
    configurable: true,
  });
  return view;
}

/**
 * Builds the offscreen text layer HTML: one absolutely-positioned div
 * per text-bearing object, transformed EXACTLY like the live
 * {@link TextLayerView} renders it (translate → rotate → scale about the
 * centre), so the export is pixel-faithful at any rotation (AC4.7).
 *
 * فاز ۲۸: objects present in `overrides` (the pinned ones) use THEIR
 * transform — device-pixel origin + per-axis CSS scale — instead of the
 * world-space derivation, so the stored div size never reflows.
 *
 * @param objects - the scene objects in paint order.
 * @param bounds - the padded export bounds.
 * @param scale - the export pixel scale.
 * @param options - ink/border/muted colours + the rich HTML renderer.
 * @param overrides - per-id transform overrides (pinned text kinds).
 * @returns the HTML fragment (positioned inside a relative root).
 */
export function buildTextLayerHtml(
  objects: readonly SceneObjectData[],
  bounds: BBox,
  scale: number,
  options: Pick<
    PngExportOptions,
    "themeInk" | "themeBorder" | "themeMuted" | "renderRichHtml"
  >,
  overrides?: ReadonlyMap<string, TextLayerOverride>,
): string {
  const parts: string[] = [];
  for (const object of objects) {
    if (!object.visible) {
      continue;
    }
    if (isTextBoxObject(object)) {
      parts.push(
        textBoxHtml(object, bounds, scale, options, overrides?.get(object.id)),
      );
    } else if (isStickyNoteObject(object)) {
      parts.push(
        stickyNoteHtml(object, bounds, scale, options, overrides?.get(object.id)),
      );
    }
  }
  return parts.join("");
}

/**
 * @param value - plain text to HTML-escape.
 * @returns the escaped text.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Builds one text box's export div (rich document when present, plain
 * legacy text otherwise). The composition MIRRORS the live
 * {@link TextLayerView} EXACTLY: the div sits at the layer origin with
 * `transform-origin: 0 0` (the live view's `origin-top-left` class) and
 * `transform: translate(origin) scale(s) + centre-pivot rotation`
 * (فاز ۳۰: the object's own rotation spins around its CENTRE, the
 * canvas drawers'/hit-testing's convention) — the same browser CSS
 * engine composes the same string, so the export is pixel-identical to
 * the on-screen layer at every scale and rotation.
 */
function textBoxHtml(
  object: TextBoxObjectData,
  bounds: BBox,
  scale: number,
  options: Pick<PngExportOptions, "themeInk" | "renderRichHtml">,
  override?: TextLayerOverride,
): string {
  const originX = override?.originX ?? (object.position.x - bounds.minX) * scale;
  const originY = override?.originY ?? (object.position.y - bounds.minY) * scale;
  const scaleX = override?.scaleX ?? scale;
  const scaleY = override?.scaleY ?? scale;
  const content =
    object.doc !== null
      ? options.renderRichHtml(object.doc)
      : `<p>${escapeHtml(object.text)}</p>`;
  const color =
    object.color === TEXT_COLOR_TOKEN ? options.themeInk : object.color;
  return (
    `<div class="text-object-view" dir="auto" lang="fa" style="` +
    `position:absolute;left:0;top:0;width:${object.width}px;` +
    `height:${object.height}px;font-size:${object.fontSize}px;` +
    `line-height:${TEXT_LINE_HEIGHT};padding:${TEXT_PADDING_Y}px ${TEXT_PADDING_X}px;` +
    `color:${color};white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;` +
    `background:transparent;transform-origin:0 0;` +
    `transform:translate(${originX}px, ${originY}px) ` +
    `scale(${scaleX}, ${scaleY})` +
    `${centrePivotRotation(object.width, object.height, object.rotation)};">` +
    `${content}</div>`
  );
}

/**
 * Builds the centre-pivot rotation suffix of an export div's transform
 * (فاز ۳۰ — mirrors the live view's {@link TextObjectView} composition):
 * `translate(centre) rotate(θ) translate(−centre)` pivots the object's
 * own rotation around its centre while `transform-origin: 0 0` keeps
 * translate/scale anchored at the top-left. Empty at rest.
 *
 * @param width - the object's width in local pixels.
 * @param height - the object's height in local pixels.
 * @param rotation - the object's rotation in radians.
 * @returns the transform suffix (possibly empty).
 */
function centrePivotRotation(
  width: number,
  height: number,
  rotation: number,
): string {
  if (rotation === 0) {
    return "";
  }
  const cx = width / 2;
  const cy = height / 2;
  return (
    ` translate(${cx}px, ${cy}px) rotate(${rotation}rad) ` +
    `translate(${-cx}px, ${-cy}px)`
  );
}

/**
 * Builds one sticky note's export div (pastel card + plain text) — the
 * same translate/scale + centre-pivot rotation composition +
 * `transform-origin: 0 0` as the live view (see {@link textBoxHtml}).
 */
function stickyNoteHtml(
  object: StickyNoteObjectData,
  bounds: BBox,
  scale: number,
  options: Pick<PngExportOptions, "themeInk" | "renderRichHtml">,
  override?: TextLayerOverride,
): string {
  const originX = override?.originX ?? (object.position.x - bounds.minX) * scale;
  const originY = override?.originY ?? (object.position.y - bounds.minY) * scale;
  const scaleX = override?.scaleX ?? scale;
  const scaleY = override?.scaleY ?? scale;
  const color =
    object.color === TEXT_COLOR_TOKEN ? options.themeInk : object.color;
  return (
    `<div class="text-object-view sticky-note-view" dir="auto" lang="fa" style="` +
    `position:absolute;left:0;top:0;width:${object.width}px;` +
    `height:${object.height}px;font-size:${object.fontSize}px;` +
    `line-height:${STICKY_LINE_HEIGHT};padding:${STICKY_PADDING_Y}px ${STICKY_PADDING_X}px;` +
    `color:${color};background-color:${object.noteColor};` +
    `border-radius:4px;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:break-word;` +
    `border-top:1px solid rgba(255,255,255,0.35);` +
    `box-shadow:0 1px 2px rgba(0,0,0,0.22), 0 6px 18px -6px rgba(0,0,0,0.32);` +
    `transform-origin:0 0;transform:translate(${originX}px, ${originY}px) ` +
    `scale(${scaleX}, ${scaleY})` +
    `${centrePivotRotation(object.width, object.height, object.rotation)};">` +
    `<p>${escapeHtml(object.text)}</p></div>`
  );
}

/**
 * The static-rendering subset of the prose styles (the .text-object-view
 * rules of globals.css, rewritten with literal colours — CSS variables
 * cannot resolve inside the rasterized SVG context).
 *
 * @param options - the theme colours.
 * @returns the CSS block embedded into the export SVG.
 */
export function exportProseCss(
  options: Pick<PngExportOptions, "themeInk" | "themeBorder" | "themeMuted">,
): string {
  return `
.text-object-view p, .text-object-view h1, .text-object-view h2,
.text-object-view h3, .text-object-view ul, .text-object-view ol,
.text-object-view blockquote, .text-object-view pre { margin: 0; }
.text-object-view h1, .text-object-view h2, .text-object-view h3 {
  line-height: 1.3; font-weight: 700; letter-spacing: -0.01em; margin: 0.45em 0 0.18em;
}
.text-object-view > h1:first-child, .text-object-view > h2:first-child,
.text-object-view > h3:first-child { margin-top: 0; }
.text-object-view h1 { font-size: 2em; font-weight: 800; }
.text-object-view h2 { font-size: 1.55em; }
.text-object-view h3 { font-size: 1.25em; font-weight: 600; }
.text-object-view blockquote {
  border-inline-start: 3px solid ${options.themeMuted};
  padding-inline-start: 0.75em; margin: 0.3em 0; color: ${options.themeMuted};
}
.text-object-view pre {
  font-family: "Cascadia Mono", "Courier New", monospace; font-size: 0.85em;
  line-height: 1.5; background: ${options.themeMuted}; border-radius: 0.4em;
  padding: 0.45em 0.6em; margin: 0.3em 0; white-space: pre-wrap;
  overflow-wrap: break-word; direction: ltr; text-align: start;
}
.text-object-view code {
  font-family: "Cascadia Mono", "Courier New", monospace; font-size: 0.88em;
  background: ${options.themeMuted}; border-radius: 0.25em; padding: 0.08em 0.3em;
}
.text-object-view hr {
  border: none; border-top: 1px solid ${options.themeBorder}; margin: 0.55em 0;
}
.text-object-view ul, .text-object-view ol {
  padding-inline-start: 1.4em; margin: 0.15em 0; list-style-position: outside;
}
.text-object-view ul { list-style-type: disc; }
.text-object-view ol { list-style-type: decimal; }
.text-object-view li { margin: 0.05em 0; }
.text-object-view li > p { margin: 0; }
.text-object-view ul[data-type="taskList"] { list-style: none; padding-inline-start: 0.4em; }
.text-object-view ul[data-type="taskList"] li {
  display: flex; align-items: flex-start; gap: 0.4em;
}
.text-object-view ul[data-type="taskList"] li > label { flex: none; }
.text-object-view mark {
  padding: 0 0.1em; border-radius: 0.15em; color: inherit;
  background: rgba(255, 250, 100, 0.55);
}
.text-object-view a { color: inherit; text-decoration: underline; }
.text-object-view table {
  border-collapse: collapse; table-layout: fixed; width: 100%; margin: 0;
  position: relative;
}
.text-object-view td, .text-object-view th {
  border: 1px solid ${options.themeBorder}; padding: 4px 8px;
  vertical-align: top; text-align: start; position: relative;
  overflow-wrap: break-word; min-width: 24px; line-height: inherit;
}
.text-object-view th { font-weight: 600; }
.text-object-view table[data-table-preset="classic"] th {
  background: ${options.themeMuted};
}
.text-object-view table[data-table-preset="minimal"],
.text-object-view table[data-table-preset="minimal"] td,
.text-object-view table[data-table-preset="minimal"] th {
  border: 0; border-bottom: 1px solid ${options.themeBorder};
}
.text-object-view table[data-table-preset="minimal"] th {
  border-bottom: 2px solid ${options.themeInk}; background: transparent;
}
.text-object-view table[data-table-preset="zebra"] th {
  background: ${options.themeMuted};
}
.text-object-view table[data-table-preset="zebra"] tbody tr:nth-child(even) td {
  background: ${options.themeMuted};
}
`.trim();
}

/**
 * Exports the framed region of the scene as a PNG blob.
 *
 * @param scene - the live scene (objects + image sources).
 * @param options - the export options (see {@link PngExportOptions}).
 * @returns the PNG blob.
 * @throws PngExportError with a typed kind on every failure path.
 */
export async function exportToPng(
  scene: Scene,
  options: PngExportOptions,
): Promise<Blob> {
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
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxY - bounds.minY;
  const pixelWidth = Math.max(1, Math.round(worldWidth * options.scale));
  const pixelHeight = Math.max(1, Math.round(worldHeight * options.scale));
  if (pixelWidth > MAX_EDGE_PIXELS || pixelHeight > MAX_EDGE_PIXELS) {
    throw new PngExportError(
      "rasterization",
      `export size ${pixelWidth}x${pixelHeight} exceeds the ${MAX_EDGE_PIXELS}px canvas limit`,
    );
  }

  // ── فاز ۲۸: the pinned-aware plan (excluded pinned objects vanish;
  // included ones become UNPINNED mapped clones riding the world pass).
  const plan = buildPinnedExportPlan(scene, bounds, options.scale, options);

  // ── canvas layer: a fresh renderer over an offscreen canvas ──────────
  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const renderer = new Canvas2DRenderer();
  renderer.initialize(canvas);
  renderer.setPalette({
    ...options.palette,
    background: options.transparent
      ? "transparent"
      : options.palette.background,
  });
  renderer.setGridVisible(false);
  await renderer.preloadImages(scene);
  // The renderer pipeline draws in CSS px then multiplies by the env DPR
  // (`cssSize = canvas.width / devicePixelRatio`); the export camera's
  // zoom compensates so the DEVICE pixels land at exactly `scale` per
  // world unit. The VIEW scene carries no pinned object — the renderer's
  // screen-space pinned pass stays idle, so no pin chrome can leak.
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const camera = new Camera(bounds.minX, bounds.minY, options.scale / dpr, 0);
  renderer.render(sceneViewOf(scene, plan.canvasObjects), camera);
  renderer.dispose();

  // ── text layer: rasterized DOM (SVG foreignObject + embedded fonts) ──
  const textObjects = plan.textObjects;
  if (textObjects.length > 0) {
    let fontFaces = "";
    try {
      fontFaces = await collectEmbeddedFontFaces();
    } catch (error) {
      if (error instanceof DomRasterizerError) {
        throw new PngExportError("fonts", error.message);
      }
      throw error;
    }
    const html = buildTextLayerHtml(
      textObjects,
      bounds,
      options.scale,
      options,
      plan.textOverrides,
    );
    const css = exportProseCss(options);
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new PngExportError("rasterization", "2d context unavailable");
    }
    let image: HTMLImageElement;
    try {
      image = await rasterizeHtml(
        html,
        pixelWidth,
        pixelHeight,
        `${css}\n${fontFaces}`,
      );
    } catch (error) {
      if (error instanceof DomRasterizerError) {
        throw new PngExportError("rasterization", error.message);
      }
      throw error;
    }
    context.drawImage(image, 0, 0);
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/png");
  });
  if (blob === null) {
    throw new PngExportError("rasterization", "canvas.toBlob returned null");
  }
  return blob;
}
