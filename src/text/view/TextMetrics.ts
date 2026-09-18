/**
 * Pure text-box content geometry (R3A.7): how a box's width/height follow
 * its rendered content.
 *
 * - FIXED: the width stays (text wraps); the height grows with content.
 * - AUTO: the width grows to the longest line up to a maximum, then wraps;
 *   the height grows like fixed.
 *
 * Growth anchoring: the top edge always stays put (height grows downward);
 * the width's anchor follows the dominant text direction — RTL boxes grow
 * leftward (the RIGHT edge stays fixed), LTR boxes grow rightward — so the
 * object never appears to drift while typing (AC3A.6).
 *
 * Pure math only: the DOM layer measures the natural sizes and feeds them
 * here; unit tests pin the anchor/clamp rules without a layout engine.
 */
import type { TextBoxSizeMode } from "@/core/model/TextBoxObject";
import { TEXT_PADDING_X } from "@/core/model/TextBoxObject";

/** Maximum width an auto box may grow to before it wraps (world units). */
export const TEXT_AUTO_MAX_WIDTH = 640;

/** Inputs of the content geometry resolution. */
export interface ContentGeometryInput {
  /** The box's current size mode. */
  readonly mode: TextBoxSizeMode;
  /** Measured natural (longest-line) width incl. padding, world units. */
  readonly naturalWidth: number;
  /** Measured wrapped height at the target width incl. padding. */
  readonly naturalHeight: number;
  /** The box's current x position (world units). */
  readonly currentX: number;
  /** The box's current width (world units). */
  readonly currentWidth: number;
  /** Dominant text direction of the document. */
  readonly direction: "rtl" | "ltr";
  /** Base font size — drives the minimum caret width (world units). */
  readonly fontSize: number;
}

/** Resolved geometry after a content change. */
export interface ContentGeometryResult {
  /** New x position (anchored per direction). */
  readonly x: number;
  /** New width (clamped per mode). */
  readonly width: number;
  /** New height (content-driven, min one line). */
  readonly height: number;
}

/**
 * Resolves the box geometry after a content change.
 *
 * @param input - the measured + current state.
 * @returns the new position/width/height.
 */
export function resolveContentGeometry(
  input: ContentGeometryInput,
): ContentGeometryResult {
  const minWidth = 2 * TEXT_PADDING_X + Math.max(input.fontSize * 0.75, 8);
  let width: number;
  if (input.mode === "auto") {
    width = Math.min(
      Math.max(input.naturalWidth, minWidth),
      TEXT_AUTO_MAX_WIDTH,
    );
  } else {
    width = input.currentWidth;
  }
  // Height always follows content (min one line: the height measurement of
  // a non-empty doc already includes one line; a zero guards degenerate
  // reads).
  const height = Math.max(input.naturalHeight, input.fontSize * 0.75);
  // Width anchor: RTL pins the right edge (x + width), LTR pins the left.
  const x =
    input.mode === "auto" && input.direction === "rtl"
      ? input.currentX - (width - input.currentWidth)
      : input.currentX;
  return { x, width, height };
}
