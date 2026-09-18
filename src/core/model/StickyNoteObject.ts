/**
 * Sticky note object: a coloured card carrying editable text, rendered by the
 * DOM overlay layer (same architecture as text boxes, per CLAUDE.md §1.3 —
 * text-bearing objects always live in the DOM overlay).
 *
 * The text content lives inline on the object data (DECISIONS #36) so scene
 * commands, history and future persistence handle edits with zero extra
 * plumbing. Geometry follows the shape convention: `position` is the
 * top-left corner, `width`/`height` are world units and the generic
 * sized-kind paths of `objectBBox`/`resizeSceneObject` apply.
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";
import { bbox, type BBox } from "@/core/geometry/BBox";

/** Default ink of a sticky note: a warm near-black that stays readable on
 *  every light pastel card (independent of the UI theme). */
export const DEFAULT_STICKY_INK = "oklch(0.30 0.03 55)";

/** Default background of a new sticky note (classic post-it amber). */
export const DEFAULT_STICKY_NOTE_COLOR = "oklch(0.87 0.14 85)";

/**
 * Curated card palette (light pastels, warm/neutral family that harmonises
 * with the canvas accent; blue/indigo deliberately omitted). The first entry
 * is the default. Every colour keeps dark ink readable.
 */
export const STICKY_NOTE_COLORS: readonly string[] = [
  DEFAULT_STICKY_NOTE_COLOR, // amber
  "oklch(0.90 0.14 98)", // yellow
  "oklch(0.89 0.11 55)", // peach
  "oklch(0.89 0.10 20)", // coral
  "oklch(0.89 0.09 350)", // rose pastel
  "oklch(0.87 0.12 145)", // green
  "oklch(0.88 0.08 195)", // teal
  "oklch(0.86 0.07 310)", // lilac
];

/** Default font size of a sticky note, in world units. */
export const DEFAULT_STICKY_FONT_SIZE = 18;

/** Default width of a tap-created sticky note, in world units (square card). */
export const DEFAULT_STICKY_WIDTH = 220;

/** Default height of a tap-created sticky note, in world units. */
export const DEFAULT_STICKY_HEIGHT = 220;

/** Line height multiplier applied to the note font size (readability, Persian). */
export const STICKY_LINE_HEIGHT = 1.6;

/** Horizontal padding inside the note card, in world units. */
export const STICKY_PADDING_X = 14;

/** Vertical padding inside the note card, in world units. */
export const STICKY_PADDING_Y = 12;

/** Minimum width enforced when a drag creates a note, in world units. */
export const STICKY_MIN_WIDTH = 80;

/** Minimum height enforced when a drag creates a note, in world units. */
export const STICKY_MIN_HEIGHT = 80;

/** Data of a sticky note object. */
export interface StickyNoteObjectData extends SceneObjectData {
  /** Discriminant: always `stickyNote`. */
  readonly kind: "stickyNote";
  /** Card width in world units. */
  readonly width: number;
  /** Card height in world units. */
  readonly height: number;
  /** Plain text content (paragraphs joined by `\n`). */
  readonly text: string;
  /** Font size in world units. */
  readonly fontSize: number;
  /** Base font family (CSS stack); absent = the default sans stack (R7.2). */
  readonly fontFamily?: string;
  /** Background colour of the card, as a CSS colour string. */
  readonly noteColor: string;
  /** Ink colour: the palette token or a literal CSS colour. */
  readonly color: string;
}

/**
 * @param object - the object to inspect.
 * @returns whether the object is a sticky note.
 */
export function isStickyNoteObject(
  object: SceneObjectData,
): object is StickyNoteObjectData {
  return object.kind === "stickyNote";
}

/**
 * Computes the default rectangle for a tap-created sticky note: a
 * `DEFAULT_STICKY_WIDTH × DEFAULT_STICKY_HEIGHT` card centred on the tap so
 * the note appears exactly under the pointer.
 *
 * @param world - the world-space tap point.
 * @returns the default card rectangle.
 */
export function defaultStickyNoteRect(world: Vec2): BBox {
  return bbox(
    world.x - DEFAULT_STICKY_WIDTH / 2,
    world.y - DEFAULT_STICKY_HEIGHT / 2,
    world.x + DEFAULT_STICKY_WIDTH / 2,
    world.y + DEFAULT_STICKY_HEIGHT / 2,
  );
}

/**
 * Assembles a complete sticky note object from a rectangle.
 *
 * @param rect - the card rectangle in world units.
 * @param noteColor - the background colour of the card.
 * @param text - the initial text content (usually empty for interactive
 *        creation; commit-time text lands via the edit session).
 * @param fontSize - font size in world units.
 * @param id - the object id (from the shared `IdGenerator`).
 * @param zIndex - the paint order value.
 * @returns the assembled sticky note data.
 */
export function stickyNoteFromRect(
  rect: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  },
  noteColor: string,
  text: string,
  fontSize: number,
  id: string,
  zIndex: number,
): StickyNoteObjectData {
  return {
    kind: "stickyNote",
    id,
    position: vec2(rect.minX, rect.minY),
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    width: Math.max(0, rect.maxX - rect.minX),
    height: Math.max(0, rect.maxY - rect.minY),
    text,
    fontSize,
    noteColor,
    color: DEFAULT_STICKY_INK,
  };
}
