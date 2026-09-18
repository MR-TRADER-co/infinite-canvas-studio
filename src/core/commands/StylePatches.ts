/**
 * Pure planning of inspector style patches (no side effects).
 *
 * The inspector edits a possibly mixed selection: the same user intent ("set
 * stroke width ۴") maps to different fields per object kind (shapes carry
 * `strokeWidth`, text boxes don't). This module owns that mapping as one pure
 * function so the UI hook stays a thin command dispatcher and the matrix is
 * unit-testable without a DOM (CLAUDE.md §1.5 domain purity).
 *
 * Incompatible requests are silently dropped per object — a batch restyle
 * over a mixed selection simply skips objects the change does not apply to
 * (DECISIONS #41), and a patch that would change nothing returns `null` so
 * the hook never pushes empty history entries.
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import { isShapeObject } from "@/core/model/ShapeObject";
import { isFreehandObject } from "@/core/model/FreehandObject";
import { isTextBoxObject } from "@/core/model/TextBoxObject";
import { isStickyNoteObject } from "@/core/model/StickyNoteObject";
import { isStickerObject } from "@/core/model/StickerObject";
import { isConnectorObject } from "@/core/model/ConnectorObject";
import type {
  ArrowStyle,
  ConnectorObjectData,
  ConnectorRoutingKind,
} from "@/core/model/ConnectorObject";
import type { StrokeStyleKind } from "@/core/model/FreehandObject";
import type { ObjectPatch } from "@/core/commands/UpdateObjectCommand";

/** Lower stroke-width bound, in world units. */
export const STROKE_WIDTH_MIN = 1;

/** Upper stroke-width bound, in world units. */
export const STROKE_WIDTH_MAX = 48;

/** Lower font-size bound, in world units. */
export const FONT_SIZE_MIN = 8;

/** Upper font-size bound, in world units. */
export const FONT_SIZE_MAX = 96;

/**
 * Requested style changes; every field is optional so a single control edit
 * (one swatch click, one width pick) plans a minimal patch.
 */
export interface StyleChanges {
  /** Fill colour for shapes. */
  readonly fill?: string;
  /** Stroke colour for shapes. */
  readonly stroke?: string;
  /** Stroke colour for freehand strokes. */
  readonly strokeColor?: string;
  /** Stroke width for shapes and freehand strokes. */
  readonly strokeWidth?: number;
  /** Font size for text boxes and sticky notes. */
  readonly fontSize?: number;
  /** Ink colour for text boxes and sticky notes. */
  readonly color?: string;
  /** Base font family for text boxes and sticky notes ("" clears, R7.2). */
  readonly fontFamily?: string;
  /** Card background colour for sticky notes. */
  readonly noteColor?: string;
  /** Dash pattern for freehand strokes and connectors. */
  readonly strokeStyle?: StrokeStyleKind;
  /** Routing strategy for connectors. */
  readonly routingKind?: ConnectorRoutingKind;
  /** Start arrowhead for connectors. */
  readonly startArrow?: ArrowStyle;
  /** End arrowhead for connectors. */
  readonly endArrow?: ArrowStyle;
  /** Emoji glyph for stickers (R11.1). */
  readonly emoji?: string;
}

/**
 * Clamps a stroke width into the editable range (rounded, 1–48).
 *
 * @param value - the requested stroke width.
 * @returns the clamped stroke width.
 */
export function clampStrokeWidth(value: number): number {
  return Math.min(
    STROKE_WIDTH_MAX,
    Math.max(STROKE_WIDTH_MIN, Math.round(value)),
  );
}

/**
 * Clamps a font size into the editable range (rounded, 8–96).
 *
 * @param value - the requested font size.
 * @returns the clamped font size.
 */
export function clampFontSize(value: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)));
}

/**
 * Plans the patch one style change applies to one object.
 *
 * Kind matrix: shapes take `fill`/`stroke`/`strokeWidth`; freehand strokes
 * take `strokeColor`/`strokeWidth`/`strokeStyle`; text boxes take
 * `fontSize`/`color`; sticky notes take `noteColor`/`fontSize`/`color`;
 * connectors take `strokeColor`/`strokeWidth`/`strokeStyle`/`routingKind`/
 * `startArrow`/`endArrow`; every other kind (and empty changes) yields
 * `null`. Numeric fields are clamped; a field whose clamped value equals
 * the object's current value is dropped so the patch only carries real
 * changes.
 *
 * @param object - the object being restyled.
 * @param changes - the requested style changes.
 * @returns the kind-valid patch, or `null` when nothing would change.
 */
export function planStylePatch(
  object: SceneObjectData,
  changes: StyleChanges,
): ObjectPatch | null {
  const patch: ObjectPatch = {};

  if (isStickerObject(object)) {
    // R11.1: the emoji picker restyles the glyph (empty strings refuse —
    // a sticker without its glyph is meaningless).
    if (
      changes.emoji !== undefined &&
      changes.emoji.length > 0 &&
      changes.emoji !== object.emoji
    ) {
      patch.emoji = changes.emoji;
    }
    return Object.keys(patch).length > 0 ? patch : null;
  }

  if (isShapeObject(object)) {
    if (changes.fill !== undefined && changes.fill !== object.fill) {
      patch.fill = changes.fill;
    }
    if (changes.stroke !== undefined && changes.stroke !== object.stroke) {
      patch.stroke = changes.stroke;
    }
    if (changes.strokeWidth !== undefined) {
      const clamped = clampStrokeWidth(changes.strokeWidth);
      if (clamped !== object.strokeWidth) {
        patch.strokeWidth = clamped;
      }
    }
  } else if (isFreehandObject(object)) {
    if (
      changes.strokeColor !== undefined &&
      changes.strokeColor !== object.strokeColor
    ) {
      patch.strokeColor = changes.strokeColor;
    }
    if (changes.strokeWidth !== undefined) {
      const clamped = clampStrokeWidth(changes.strokeWidth);
      if (clamped !== object.strokeWidth) {
        patch.strokeWidth = clamped;
      }
    }
    if (
      changes.strokeStyle !== undefined &&
      changes.strokeStyle !== object.strokeStyle
    ) {
      patch.strokeStyle = changes.strokeStyle;
    }
  } else if (isConnectorObject(object)) {
    const connector: ConnectorObjectData = object;
    if (
      changes.strokeColor !== undefined &&
      changes.strokeColor !== connector.strokeColor
    ) {
      patch.strokeColor = changes.strokeColor;
    }
    if (changes.strokeWidth !== undefined) {
      const clamped = clampStrokeWidth(changes.strokeWidth);
      if (clamped !== connector.strokeWidth) {
        patch.strokeWidth = clamped;
      }
    }
    if (
      changes.strokeStyle !== undefined &&
      changes.strokeStyle !== connector.strokeStyle
    ) {
      patch.strokeStyle = changes.strokeStyle;
    }
    if (
      changes.routingKind !== undefined &&
      changes.routingKind !== connector.routingKind
    ) {
      patch.routingKind = changes.routingKind;
    }
    if (
      changes.startArrow !== undefined &&
      changes.startArrow !== connector.startArrow
    ) {
      patch.startArrow = changes.startArrow;
    }
    if (
      changes.endArrow !== undefined &&
      changes.endArrow !== connector.endArrow
    ) {
      patch.endArrow = changes.endArrow;
    }
  } else if (isTextBoxObject(object)) {
    if (changes.fontSize !== undefined) {
      const clamped = clampFontSize(changes.fontSize);
      if (clamped !== object.fontSize) {
        patch.fontSize = clamped;
      }
    }
    if (changes.color !== undefined && changes.color !== object.color) {
      patch.color = changes.color;
    }
    if (changes.fontFamily !== undefined) {
      patch.fontFamily =
        changes.fontFamily === "" ? undefined : changes.fontFamily;
    }
  } else if (isStickyNoteObject(object)) {
    if (
      changes.noteColor !== undefined &&
      changes.noteColor !== object.noteColor
    ) {
      patch.noteColor = changes.noteColor;
    }
    if (changes.fontSize !== undefined) {
      const clamped = clampFontSize(changes.fontSize);
      if (clamped !== object.fontSize) {
        patch.fontSize = clamped;
      }
    }
    if (changes.color !== undefined && changes.color !== object.color) {
      patch.color = changes.color;
    }
    if (changes.fontFamily !== undefined) {
      patch.fontFamily =
        changes.fontFamily === "" ? undefined : changes.fontFamily;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
