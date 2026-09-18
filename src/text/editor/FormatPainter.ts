/**
 * Format Painter (R7.5): copies the rich-text FORMATTING of the current
 * selection — inline marks with their attributes (bold, italic, colour,
 * font size, …) plus the active BLOCK node (heading level, paragraph,
 * quote) — and re-applies it onto another selection in the same or a
 * different text object.
 *
 * The fingerprint is a plain serialisable snapshot, so the painter state
 * survives object switches (module-level clipboard) and is unit-testable
 * without React. Application REPLACES the target's formatting: marks are
 * cleared first, then each captured mark is set, then the block turns
 * into the captured block (AC7.5: bold + colour + heading level
 * transfer).
 */
import type { Editor } from "@tiptap/core";
import type { Mark as PMMark, Node as PMNode } from "@tiptap/pm/model";

/** One captured inline mark with its attributes. */
export interface CapturedMark {
  /** Mark type name (e.g. "bold", "textStyle"). */
  readonly name: string;
  /** The mark's attributes (e.g. { color: "#f00" }). */
  readonly attrs: Readonly<Record<string, unknown>>;
}

/** The captured block node. */
export interface CapturedBlock {
  /** Block node type name (e.g. "heading", "paragraph"). */
  readonly name: string;
  /** Block attributes (heading level, …). */
  readonly attrs: Readonly<Record<string, unknown>>;
}

/** The full formatting fingerprint of one selection. */
export interface TextFormatFingerprint {
  /** Inline marks active on the selection. */
  readonly marks: readonly CapturedMark[];
  /** The block node the selection sits in. */
  readonly block: CapturedBlock | null;
}

/**
 * Captures the formatting of the editor's current selection: the marks
 * of the first marked text in the range (or the caret's stored marks),
 * plus the block node the selection starts in. Whole-document selections
 * (AllSelection) resolve to the first top-level block.
 *
 * @param editor - the live shared editor.
 * @returns the fingerprint, or null when the doc has no block yet.
 */
export function captureFormat(editor: Editor): TextFormatFingerprint | null {
  const { state } = editor;
  const { selection } = state;
  let marks: readonly PMMark[] | null = null;
  if (!selection.empty) {
    // Range selection: the first marked text node in the range defines
    // the inline formatting (an unmarked range captures "plain").
    state.doc.nodesBetween(selection.from, selection.to, (node) => {
      if (marks === null && node.isText && node.marks.length > 0) {
        marks = node.marks;
      }
      return marks === null;
    });
  } else {
    marks = state.storedMarks ?? selection.$from.marks();
  }
  const resolvedMarks: readonly PMMark[] = marks ?? [];
  let block: PMNode = selection.$from.parent;
  if (block.type.name === "doc") {
    // AllSelection sits at the doc level: use the first top-level block.
    block = state.doc.firstChild ?? block;
  }
  if (block.type.name === "doc") {
    return null;
  }
  return {
    marks: resolvedMarks.map((mark) => ({
      name: mark.type.name,
      attrs: { ...(mark.attrs ?? {}) },
    })),
    block: {
      name: block.type.name,
      attrs: { ...(block.attrs ?? {}) },
    },
  };
}

/**
 * Applies a fingerprint onto the editor's current selection.
 *
 * @param editor - the live shared editor.
 * @param fingerprint - the captured formatting.
 * @returns whether an editor command chain ran.
 */
export function applyFormat(
  editor: Editor,
  fingerprint: TextFormatFingerprint,
): boolean {
  return editor
    .chain()
    .focus()
    .unsetAllMarks()
    .command(({ commands }) => {
      let ok = true;
      // Replace semantics: every captured mark is set fresh.
      for (const mark of fingerprint.marks) {
        const attrs = cleanAttrs(mark.attrs);
        ok = commands.setMark(mark.name, attrs) && ok;
      }
      const block = fingerprint.block;
      if (block !== null && block.name !== "doc") {
        const attrs = cleanAttrs(block.attrs);
        if (block.name === "paragraph") {
          ok = commands.setParagraph() && ok;
        } else if (block.name === "heading") {
          const rawLevel = attrs.level;
          const level: 1 | 2 | 3 =
            rawLevel === 1 || rawLevel === 2 || rawLevel === 3 ? rawLevel : 1;
          ok = commands.setHeading({ level }) && ok;
        } else {
          // Best-effort for quote/code blocks: update the block attributes
          // in place (structural conversion stays the toolbar's job).
          ok = commands.updateAttributes(block.name, attrs) && ok;
        }
      }
      return ok;
    })
    .run();
}

/**
 * Strips null/undefined attribute values.
 *
 * @param attrs - the raw attributes.
 * @returns the cleaned attribute record.
 */
function cleanAttrs(
  attrs: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/** Module-level painter clipboard (survives object switches, R7.5). */
let clipboard: TextFormatFingerprint | null = null;

/**
 * Copies the current editor selection's formatting into the clipboard.
 *
 * @param editor - the live shared editor.
 * @returns whether a fingerprint was captured.
 */
export function copyFormatFrom(editor: Editor): boolean {
  const fingerprint = captureFormat(editor);
  if (fingerprint === null) {
    return false;
  }
  clipboard = fingerprint;
  return true;
}

/**
 * Applies the clipboard's formatting onto the editor's current selection.
 *
 * @param editor - the live shared editor.
 * @returns whether formatting existed and a command chain ran.
 */
export function pasteFormatOnto(editor: Editor): boolean {
  if (clipboard === null) {
    return false;
  }
  return applyFormat(editor, clipboard);
}

/** @returns whether the painter clipboard holds a fingerprint. */
export function hasPaintFormat(): boolean {
  return clipboard !== null;
}

/** Clears the painter clipboard. */
export function clearPaintFormat(): void {
  clipboard = null;
}
