/**
 * Live-document range resolution (R3B.8): maps a match's LOGICAL text
 * offsets (the plain-text projection) to ProseMirror document positions in
 * the LIVE shared editor, so Find & Replace navigation can select the exact
 * range inside the object's open editor.
 *
 * The walk mirrors `plainTextOfDocument` line semantics (paragraph /
 * heading / code blocks each emit one line, `\n` separators between lines,
 * hard breaks inside) — the same rules the pure model's splicer follows,
 * so offsets stay consistent between search, splice and selection.
 */
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/** A resolved ProseMirror range. */
export interface DocRange {
  /** Selection start (inclusive, absolute doc position). */
  readonly from: number;
  /** Selection end (exclusive, absolute doc position). */
  readonly to: number;
}

/** Node types that emit their own line in the plain-text projection. */
const LINE_BLOCK_NODES = new Set(["paragraph", "heading", "codeBlock"]);

/**
 * Resolves a logical text range to editor document positions.
 *
 * @param editor - the shared editor holding the searched object's document.
 * @param start - logical start offset (inclusive) in the plain projection.
 * @param end - logical end offset (exclusive) in the plain projection.
 * @returns the doc range, or null when the offsets do not intersect any
 *          text node (e.g. the document changed after the search).
 */
export function resolveDocRange(
  editor: Editor,
  start: number,
  end: number,
): DocRange | null {
  if (end <= start) {
    return null;
  }
  const doc = editor.state.doc;
  let logical = 0;
  let firstLine = true;
  let from: number | null = null;
  let to: number | null = null;

  const visit = (node: PMNode, pos: number): boolean => {
    const type = node.type.name;
    if (node.isText && typeof node.text === "string") {
      const nodeLogicalStart = logical;
      logical += node.text.length;
      if (from === null && start >= nodeLogicalStart && start < logical) {
        from = pos + 1 + (start - nodeLogicalStart);
      }
      if (to === null && end > nodeLogicalStart && end <= logical) {
        to = pos + 1 + (end - nodeLogicalStart);
      }
      return false; // text nodes have no children
    }
    if (type === "hardBreak") {
      logical += 1;
      return false;
    }
    if (LINE_BLOCK_NODES.has(type)) {
      if (!firstLine) {
        logical += 1; // the "\n" separator before every line but the first
      }
      firstLine = false;
    }
    return true; // descend
  };

  doc.descendants(visit);
  if (from === null || to === null) {
    return null;
  }
  return { from, to };
}

/**
 * Selects a logical range inside the live editor (navigation highlight).
 *
 * @param editor - the shared editor (focused afterwards).
 * @param start - logical start offset.
 * @param end - logical end offset.
 * @returns whether the selection was applied.
 */
export function selectLogicalRange(
  editor: Editor,
  start: number,
  end: number,
): boolean {
  const range = resolveDocRange(editor, start, end);
  if (range === null) {
    return false;
  }
  return editor
    .chain()
    .focus()
    .setTextSelection({ from: range.from, to: range.to })
    .run();
}
