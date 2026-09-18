/**
 * Primitive shape object (rectangle, ellipse, triangle, ...).
 *
 * Geometry lives directly on the object as `width`/`height` measured from
 * `position` (the world-space top-left corner) — axis-aligned like every
 * other sized kind, so `objectBBox`, `translateSceneObject` and all R4
 * manipulation machinery work on shapes with zero extra code. Rotation
 * (later phase) will pivot around the shape centre.
 *
 * Theme-adaptive colours follow the stroke-token precedent (DECISIONS #17):
 * `fill` may store {@link SHAPE_FILL_TOKEN} and `stroke` may store
 * `STROKE_COLOR_TOKEN`; the renderer resolves both against the active
 * palette, literal CSS colours pass through unchanged.
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import { STROKE_COLOR_TOKEN } from "@/core/model/FreehandObject";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";

/** Primitive geometries a shape object can use. */
export type ShapeKind =
  | "rectangle"
  | "roundedRectangle"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "star";

/** Every shape kind in picker order (toolbar + tests iterate this). */
export const SHAPE_KINDS: readonly ShapeKind[] = [
  "rectangle",
  "roundedRectangle",
  "ellipse",
  "triangle",
  "diamond",
  "star",
];

/**
 * Palette token stored in `fill` for theme-adaptive shape fills: the
 * renderer maps it to the active palette's accent-tinted fill colour.
 */
export const SHAPE_FILL_TOKEN = "accent";

/** Data of a primitive shape object. */
export interface ShapeObjectData extends SceneObjectData {
  /** Discriminant: always `shape`. */
  readonly kind: "shape";
  /** Primitive geometry used by this object. */
  readonly shapeKind: ShapeKind;
  /** Shape width in world units (≥ 0; `position` is the top-left corner). */
  readonly width: number;
  /** Shape height in world units (≥ 0). */
  readonly height: number;
  /** Fill colour: a CSS colour string or the {@link SHAPE_FILL_TOKEN}. */
  readonly fill: string;
  /** Stroke colour: a CSS colour string or `STROKE_COLOR_TOKEN`. */
  readonly stroke: string;
  /** Stroke width in world units. */
  readonly strokeWidth: number;
}

/**
 * Type guard narrowing a generic scene object to its shape variant.
 *
 * @param object - the object to test.
 * @returns whether `object` carries primitive-shape data.
 */
export function isShapeObject(
  object: SceneObjectData,
): object is ShapeObjectData {
  return object.kind === "shape";
}

/** Visual style of newly created shapes, resolved at creation time. */
export interface ShapeStyle {
  /** Fill colour (token or literal). */
  readonly fill: string;
  /** Stroke colour (token or literal). */
  readonly stroke: string;
  /** Stroke width in world units. */
  readonly strokeWidth: number;
}

/** Rectangle placement produced by a drag gesture (world space). */
export interface ShapeRect {
  /** Top-left corner of the normalised rectangle. */
  readonly position: Vec2;
  /** Width (≥ 0). */
  readonly width: number;
  /** Height (≥ 0). */
  readonly height: number;
}

/**
 * Normalises a drag gesture into an axis-aligned rectangle.
 *
 * The rectangle spans `anchor` and `current` regardless of drag direction
 * (right/left/up/down all produce `min` corner + positive size). When
 * `constrainSquare` is set (Shift), the rectangle grows to a square with
 * the larger absolute delta, keeping the drag's directional signs.
 *
 * @param anchor - world-space point where the drag began.
 * @param current - current world-space pointer position.
 * @param constrainSquare - whether the result is forced to a square.
 * @returns the normalised rectangle.
 */
export function normalizedRectFromDrag(
  anchor: Vec2,
  current: Vec2,
  constrainSquare: boolean,
): ShapeRect {
  const dx = current.x - anchor.x;
  const dy = current.y - anchor.y;
  if (!constrainSquare) {
    return {
      position: vec2(
        Math.min(anchor.x, current.x),
        Math.min(anchor.y, current.y),
      ),
      width: Math.abs(dx),
      height: Math.abs(dy),
    };
  }
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const endX = anchor.x + size * (sx === 0 ? 1 : sx);
  const endY = anchor.y + size * (sy === 0 ? 1 : sy);
  return {
    position: vec2(Math.min(anchor.x, endX), Math.min(anchor.y, endY)),
    width: Math.abs(endX - anchor.x),
    height: Math.abs(endY - anchor.y),
  };
}

/**
 * Rectangle of a default-sized shape centred on a tap point.
 *
 * @param center - world-space tap position.
 * @param size - full width/height of the default shape.
 * @returns the centred rectangle.
 */
export function defaultShapeRect(center: Vec2, size: number): ShapeRect {
  return {
    position: vec2(center.x - size / 2, center.y - size / 2),
    width: size,
    height: size,
  };
}

/**
 * Assembles a complete shape object from a placement rectangle.
 *
 * @param rect - the drag/tap rectangle in world space.
 * @param shapeKind - the primitive geometry.
 * @param style - fill/stroke style (tokens or literals).
 * @param id - allocated object id.
 * @param zIndex - paint order for the new object.
 * @returns the assembled shape data.
 */
export function shapeFromRect(
  rect: ShapeRect,
  shapeKind: ShapeKind,
  style: ShapeStyle,
  id: string,
  zIndex: number,
): ShapeObjectData {
  return {
    id,
    kind: "shape",
    name: undefined,
    parentId: undefined,
    position: rect.position,
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    shapeKind,
    width: rect.width,
    height: rect.height,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
  };
}

/** Re-exported for one-stop imports at style-definition sites. */
export { STROKE_COLOR_TOKEN };
