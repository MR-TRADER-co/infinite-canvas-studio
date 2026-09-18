/**
 * Text box object: a free-standing rich text container rendered by the DOM
 * overlay layer (Phase 3A).
 *
 * Content is a TipTap JSON document (`doc`, R3A.4) with a plain-text
 * projection (`text`) kept for legacy consumers — both live inline on the
 * immutable object data (DECISIONS #36), so scene commands (add/update/
 * remove), history and persistence handle text edits with zero extra
 * plumbing. `doc === null` marks legacy/plain objects (pre-3A autosaves or
 * not-yet-edited boxes): they render as plain text and upgrade to a rich
 * document on the first edit session. Geometry follows the shape
 * convention: `position` is the top-left corner, `width`/`height` are world
 * units and `objectBBox`/`resizeSceneObject`'s generic sized-kind paths
 * apply. `sizeMode` selects the box's growth behaviour (R3A.7).
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";
import { bbox, type BBox } from "@/core/geometry/BBox";
import type { RichTextDocument } from "@/text/editor/richtext";

/** How the box's width follows its content (R3A.7). */
export type TextBoxSizeMode = "fixed" | "auto";

/** Palette token resolved by the DOM text layer to the theme's ink colour. */
export const TEXT_COLOR_TOKEN = "token://text";

/** Default font size of a new text box, in world units. */
export const DEFAULT_TEXT_FONT_SIZE = 20;

/** Default width of a tap-created text box, in world units. */
export const DEFAULT_TEXT_WIDTH = 260;

/** Default height of a tap-created text box, in world units. */
export const DEFAULT_TEXT_HEIGHT = 64;

/** Line height multiplier applied to the font size (readability, Persian). */
export const TEXT_LINE_HEIGHT = 1.65;

/** Horizontal padding inside the box, in world units. */
export const TEXT_PADDING_X = 12;

/** Vertical padding inside the box, in world units. */
export const TEXT_PADDING_Y = 8;

/** Data of a rich text box object. */
export interface TextBoxObjectData extends SceneObjectData {
  /** Discriminant: always `textBox`. */
  readonly kind: "textBox";
  /** Box width in world units. */
  readonly width: number;
  /** Box height in world units. */
  readonly height: number;
  /** Plain text projection (paragraphs joined by `\n`). */
  readonly text: string;
  /** TipTap JSON document — the source of truth (null = legacy plain box). */
  readonly doc: RichTextDocument | null;
  /** Width behaviour: fixed (wraps) or auto (grows to the longest line). */
  readonly sizeMode: TextBoxSizeMode;
  /** Font size in world units (the base size spans inherit). */
  readonly fontSize: number;
  /** Base font family (CSS stack); absent = the default sans stack (R7.2). */
  readonly fontFamily?: string;
  /** Ink colour: the palette token or a literal CSS colour. */
  readonly color: string;
  /** Font weight override (R13.3 text styles; absent = the editor default). */
  readonly fontWeight?: number;
  /** Line-height override (R13.3 text styles; absent = the base contract). */
  readonly lineHeight?: number;
  /** Named-style reference (R13.3; absent = unstyled). */
  readonly styleId?: string;
}

/**
 * @param object - the object to inspect.
 * @returns whether the object is a text box.
 */
export function isTextBoxObject(
  object: SceneObjectData,
): object is TextBoxObjectData {
  return object.kind === "textBox";
}

/**
 * Computes the default rectangle for a tap-created text box: the box's
 * top-left sits slightly up-left of the tap so the caret lands near the
 * click point (the first line's vertical centre aligns with the tap).
 *
 * @param world - the world-space tap point.
 * @returns the default box rectangle.
 */
export function defaultTextBoxRect(world: Vec2): BBox {
  const top = world.y - DEFAULT_TEXT_HEIGHT / 2;
  return bbox(
    world.x,
    top,
    world.x + DEFAULT_TEXT_WIDTH,
    top + DEFAULT_TEXT_HEIGHT,
  );
}

/**
 * Assembles a complete text box object from a rectangle.
 *
 * @param rect - the box rectangle in world units.
 * @param text - the initial plain text (usually empty for interactive
 *        creation; commit-time text lands via the edit session).
 * @param fontSize - font size in world units.
 * @param id - the object id (from the shared `IdGenerator`).
 * @param zIndex - the paint order value.
 * @param sizeMode - width behaviour (drag-out = fixed, tap = auto).
 * @returns the assembled text box data.
 */
export function textBoxFromRect(
  rect: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  },
  text: string,
  fontSize: number,
  id: string,
  zIndex: number,
  sizeMode: TextBoxSizeMode = "auto",
): TextBoxObjectData {
  return {
    kind: "textBox",
    id,
    position: vec2(rect.minX, rect.minY),
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    width: Math.max(0, rect.maxX - rect.minX),
    height: Math.max(0, rect.maxY - rect.minY),
    text,
    doc: null,
    sizeMode,
    fontSize,
    color: TEXT_COLOR_TOKEN,
  };
}

/**
 * Converts an auto-width box to fixed on a manual width change (R3A.7:
 * dragging the width handle pins the box; height stays content-driven).
 *
 * @param before - the object before the resize.
 * @param after - the assembled after snapshot.
 * @returns `after` unchanged, or with `sizeMode: "fixed"` when a textBox's
 *          width was manually changed while it was auto.
 */
export function withManualSizeMode<T extends SceneObjectData>(
  before: SceneObjectData,
  after: T,
): T {
  if (before.kind === "textBox" && after.kind === "textBox") {
    const textBox = before as TextBoxObjectData;
    const afterBox = after as unknown as TextBoxObjectData;
    if (textBox.sizeMode === "auto" && afterBox.width !== textBox.width) {
      return { ...after, sizeMode: "fixed" } as T;
    }
  }
  return after;
}
