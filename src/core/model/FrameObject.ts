/**
 * Frame object (R8.3): a titled rectangular container that sequences the
 * presentation mode («حالت ارائه») — one frame per slide.
 *
 * Geometry mirrors the shape contract (`position` = top-left corner,
 * `width`/`height` in world units) so the shared manipulation machinery
 * (bbox, translate, resize, marquee, R-tree) covers frames with zero
 * extra code. The TITLE BAR strip (`titleHeight`) carries the frame
 * label; hit-testing deliberately restricts frame picking to the border
 * ring + title bar so objects living INSIDE a frame stay directly
 * clickable (the container never swallows clicks).
 *
 * Containment is GEOMETRIC (an object belongs to the frame whose bounds
 * cover it — computed at presentation/export time, never persisted): no
 * `parentId` mutation, no extra history entries, and moving an object
 * into a frame just works (D-8.2). Children clip visually only in
 * presentation mode (the editor keeps showing overflow, Figma-style).
 *
 * Theme-adaptive colours follow the token precedent (DECISIONS #17).
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import { STROKE_COLOR_TOKEN } from "@/core/model/FreehandObject";
import { SHAPE_FILL_TOKEN } from "@/core/model/ShapeObject";

/** Default frame footprint (world units) — a 16:10 slide-ish board. */
export const DEFAULT_FRAME_WIDTH = 640;

/** Default frame height (world units). */
export const DEFAULT_FRAME_HEIGHT = 400;

/** Default title-bar height (world units). */
export const DEFAULT_FRAME_TITLE_HEIGHT = 28;

/** Data of a frame object. */
export interface FrameObjectData extends SceneObjectData {
  /** Discriminant: always `frame`. */
  readonly kind: "frame";
  /** Frame width in world units (≥ 0; `position` is the top-left corner). */
  readonly width: number;
  /** Frame height in world units (≥ 0). */
  readonly height: number;
  /** Height of the title bar strip (world units, > 0). */
  readonly titleHeight: number;
  /** User-visible frame title drawn in the title bar (may be empty). */
  readonly title: string;
  /** Body fill colour: a CSS colour string or the {@link SHAPE_FILL_TOKEN}. */
  readonly fill: string;
  /** Border colour: a CSS colour string or `STROKE_COLOR_TOKEN`. */
  readonly stroke: string;
  /** Border width in world units. */
  readonly strokeWidth: number;
  /**
   * Auto-layout definition (R13.4): while present, child positions inside
   * the frame are DERIVED — the LayoutService computes row/column slots
   * ordered by the children's current geometry (a manual drag inside the
   * frame reorders instead of free-moving). Absent = free placement.
   */
  readonly layout?: FrameLayout;
}

/** Auto-layout direction. */
export type FrameLayoutDir = "row" | "column";

/** The frame's auto-layout definition (R13.4). */
export interface FrameLayout {
  /** Slot direction: a single row or a single column. */
  readonly dir: FrameLayoutDir;
  /** Gap between neighbouring slots (world units, ≥ 0). */
  readonly gap: number;
  /** Inner padding of the frame body (world units, ≥ 0). */
  readonly padding: number;
  /** When "fill", slot widths stretch to the frame's inner width. */
  readonly itemWidth?: "fill";
}

/**
 * Defensively parses a persisted layout definition.
 *
 * @param value - the raw field read from a file.
 * @returns the validated layout, or null when malformed (the frame falls
 *          back to free placement — never a load failure).
 */
export function parseFrameLayout(value: unknown): FrameLayout | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const dir = raw.dir;
  const gap = raw.gap;
  const padding = raw.padding;
  if (
    (dir !== "row" && dir !== "column") ||
    typeof gap !== "number" ||
    !Number.isFinite(gap) ||
    gap < 0 ||
    typeof padding !== "number" ||
    !Number.isFinite(padding) ||
    padding < 0
  ) {
    return null;
  }
  return {
    dir,
    gap,
    padding,
    ...(raw.itemWidth === "fill" ? { itemWidth: "fill" } : {}),
  };
}

/**
 * Type guard narrowing a generic scene object to its frame variant.
 *
 * @param object - the object to test.
 * @returns whether `object` carries frame data.
 */
export function isFrameObject(
  object: SceneObjectData,
): object is FrameObjectData {
  return object.kind === "frame";
}

/**
 * Builds a default frame instance for the catalog factory (R8.3):
 * token colours + the standard slide footprint.
 *
 * @param id - the object id.
 * @param zIndex - the paint order slot.
 * @param position - the top-left corner (default: origin).
 * @returns the frame object data.
 */
export function makeFrameObject(
  id: string,
  zIndex: number,
  position: { x: number; y: number } = { x: 0, y: 0 },
): FrameObjectData {
  return {
    kind: "frame",
    id,
    position: { x: position.x, y: position.y },
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    width: DEFAULT_FRAME_WIDTH,
    height: DEFAULT_FRAME_HEIGHT,
    titleHeight: DEFAULT_FRAME_TITLE_HEIGHT,
    title: "",
    fill: SHAPE_FILL_TOKEN,
    stroke: STROKE_COLOR_TOKEN,
    strokeWidth: 2,
  };
}

/**
 * Whether a world point hits the frame's INTERACTIVE chrome — the border
 * ring (half the stroke width + tolerance thick) or the title-bar strip.
 * The body interior deliberately MISSES so contained objects stay
 * clickable (see the module doc).
 *
 * @param frame - the frame to test.
 * @param point - the world-space point.
 * @param tolerance - world-space pick tolerance.
 * @returns whether the point hits the frame chrome.
 */
export function frameChromeHit(
  frame: FrameObjectData,
  point: { x: number; y: number },
  tolerance: number,
): boolean {
  const minX = frame.position.x;
  const minY = frame.position.y;
  const maxX = minX + frame.width;
  const maxY = minY + frame.height;
  const insideOuter =
    point.x >= minX - tolerance &&
    point.x <= maxX + tolerance &&
    point.y >= minY - tolerance &&
    point.y <= maxY + tolerance;
  if (!insideOuter) {
    return false;
  }
  // Title bar strip (across the full width, one titleHeight tall).
  if (point.y <= minY + frame.titleHeight + tolerance) {
    return true;
  }
  // Border ring: inside the outer box but NOT the inner box inset by the
  // band width. The band is at least the tolerance so thin borders stay
  // grabbable.
  const band = Math.max(tolerance, frame.strokeWidth / 2);
  const innerMinX = minX + band;
  const innerMinY = minY + band;
  const innerMaxX = maxX - band;
  const innerMaxY = maxY - band;
  const insideInner =
    point.x > innerMinX &&
    point.x < innerMaxX &&
    point.y > innerMinY &&
    point.y < innerMaxY;
  return !insideInner;
}
