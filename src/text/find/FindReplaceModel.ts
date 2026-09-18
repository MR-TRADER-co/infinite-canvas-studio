/**
 * Find & Replace model (R3B.8) — the PURE half: plain-substring search over
 * the logical text projection of every text-bearing scene object, plus the
 * document splicer that applies a replacement to a TipTap JSON document at
 * logical-text offsets.
 *
 * Matching contract (per spec): plain substring on the LOGICAL text order —
 * case-sensitive, no normalisation tricks, no regex. RTL text is just a
 * string: the Unicode bidi algorithm governs DISPLAY, never storage order,
 * so logical-order matching is automatically bidi-correct.
 *
 * The projection used for offsets is `plainTextOfDocument` (blocks joined
 * with `\n`); the splicer walks the SAME structure, so a match's
 * [start, end) always lands on the same characters the searcher saw.
 */
import type { JSONContent } from "@tiptap/core";
import type { RichTextDocument } from "@/text/editor/richtext";

/** Object kinds whose text is searchable (R3B.8 scope: ALL text objects). */
export type SearchableObjectKind = "textBox" | "stickyNote";

/** One searchable object as the model sees it. */
export interface FindTarget {
  /** Scene object id. */
  readonly id: string;
  /** Object kind (textBox | stickyNote). */
  readonly kind: SearchableObjectKind;
  /** The object's plain-text projection (object.text). */
  readonly text: string;
}

/** One match of the query inside one object. */
export interface FindMatch {
  /** The object containing the match. */
  readonly objectId: string;
  /** Match start offset in the object's plain-text projection. */
  readonly start: number;
  /** Match end offset (exclusive). */
  readonly end: number;
  /** Zero-based occurrence index of this match WITHIN its object. */
  readonly occurrence: number;
  /** Snippet around the match for UI display (16 chars each side). */
  readonly snippet: {
    readonly before: string;
    readonly hit: string;
    readonly after: string;
  };
}

/** Characters of context kept on each side of a match snippet. */
const SNIPPET_CONTEXT = 16;

/**
 * Finds every plain-substring occurrence of the query across the targets,
 * in document (z) order.
 *
 * @param targets - the searchable objects.
 * @param query - the query string (empty → no matches).
 * @returns the ordered match list (object order, then offset order).
 */
export function findMatches(
  targets: readonly FindTarget[],
  query: string,
): FindMatch[] {
  if (query.length === 0) {
    return [];
  }
  const matches: FindMatch[] = [];
  for (const target of targets) {
    if (target.text.length === 0) {
      continue;
    }
    let occurrence = 0;
    let offset = target.text.indexOf(query);
    while (offset !== -1) {
      matches.push({
        objectId: target.id,
        start: offset,
        end: offset + query.length,
        occurrence,
        snippet: snippetOf(target.text, offset, offset + query.length),
      });
      occurrence += 1;
      offset = target.text.indexOf(query, offset + query.length);
    }
  }
  return matches;
}

/**
 * Builds the display snippet around a match.
 *
 * @param text - the object's plain text.
 * @param start - match start offset.
 * @param end - match end offset.
 * @returns the before/hit/after snippet parts.
 */
function snippetOf(
  text: string,
  start: number,
  end: number,
): FindMatch["snippet"] {
  const before = text.slice(Math.max(0, start - SNIPPET_CONTEXT), start);
  const hit = text.slice(start, end);
  const after = text.slice(end, end + SNIPPET_CONTEXT);
  return { before, hit, after };
}

/**
 * One contiguous text run inside the JSON document, with its logical offset
 * (the offset the plain-text projection assigns to its first character).
 */
interface TextSpan {
  /** The text-node JSON object (mutated in place by the splicer). */
  readonly node: JSONContent & { text: string };
  /** Logical offset of the node's first character. */
  readonly start: number;
  /** Logical offset one past the node's last character. */
  readonly end: number;
}

/** Leaf block node types that emit their own line in the projection. */
const LINE_BLOCK_NODES = new Set(["paragraph", "heading", "codeBlock"]);

/**
 * Walks the document exactly like `plainTextOfDocument` and collects every
 * text node as a positioned span: line blocks (paragraph / heading /
 * codeBlock) each emit one line, `\n` separators advance the logical offset
 * by one BETWEEN lines, hard breaks advance it inside a line. The offsets
 * therefore match the projection character-for-character — a match found
 * on `object.text` lands on the same characters here.
 *
 * @param doc - the document to walk.
 * @returns the positioned text spans in logical order.
 */
function collectTextSpans(doc: RichTextDocument): TextSpan[] {
  const spans: TextSpan[] = [];
  let logical = 0;
  let firstLine = true;
  const walk = (node: JSONContent): void => {
    if (node.type === "text" && typeof node.text === "string") {
      const typed = node as JSONContent & { text: string };
      spans.push({
        node: typed,
        start: logical,
        end: logical + typed.text.length,
      });
      logical += typed.text.length;
      return;
    }
    if (node.type === "hardBreak") {
      logical += 1; // the projection emits "\n"
      return;
    }
    const isLineBlock =
      node.type !== undefined && LINE_BLOCK_NODES.has(node.type);
    if (isLineBlock && !firstLine) {
      logical += 1; // the '\n' separator before every line but the first
    }
    if (isLineBlock) {
      firstLine = false;
    }
    for (const child of node.content ?? []) {
      walk(child);
    }
  };
  for (const child of doc.content ?? []) {
    walk(child);
  }
  return spans;
}

/**
 * Splices a replacement into the document's logical text range [start, end).
 *
 * The walk mirrors the plain-text projection; text is edited per text node
 * (a match spanning several nodes — e.g. across a line break — is cut in
 * each affected node, with the replacement inserted at the match's START
 * position in the first intersecting node). Text nodes emptied by the
 * splice are pruned from their parents; blocks are never removed.
 *
 * @param doc - the document to edit (MUTATED in place; clone first when
 *        immutability is required).
 * @param start - logical start offset (inclusive).
 * @param end - logical end offset (exclusive).
 * @param replacement - the replacement text.
 * @returns the mutated document (same reference), or null when the range
 *          does not intersect any text span (nothing changed).
 */
export function replaceRangeInDocument(
  doc: RichTextDocument,
  start: number,
  end: number,
  replacement: string,
): RichTextDocument | null {
  const spans = collectTextSpans(doc);
  let firstIntersecting = -1;
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    if (span !== undefined && span.end > start && span.start < end) {
      firstIntersecting = index;
      break;
    }
  }
  if (firstIntersecting === -1) {
    return null;
  }
  let touched = false;
  // Edit from the LAST span to the first: local offsets were computed from
  // the original texts, and earlier spans' offsets stay valid regardless.
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index];
    if (span === undefined || span.end <= start || span.start >= end) {
      continue;
    }
    const localStart = Math.max(0, start - span.start);
    const localEnd = Math.min(span.node.text.length, end - span.start);
    const insertion = index === firstIntersecting ? replacement : "";
    const nextText =
      span.node.text.slice(0, localStart) +
      insertion +
      span.node.text.slice(localEnd);
    if (nextText !== span.node.text) {
      touched = true;
    }
    if (nextText.length === 0) {
      // Mark for the pruning pass (an empty text node is schema-invalid);
      // `pruneEmptyTextNodes` removes it from its parent right after.
      span.node.text = "";
    } else {
      span.node.text = nextText;
    }
  }
  if (!touched) {
    return null;
  }
  pruneEmptyTextNodes(doc);
  return doc;
}

/**
 * Removes text nodes emptied by a previous splice from their parent blocks.
 *
 * {@link replaceRangeInDocument} leaves `text`-less nodes in the tree; this
 * pass prunes them so the JSON stays schema-clean before `setContent`.
 *
 * @param node - the subtree to prune (mutated in place).
 * @returns whether the node itself should stay in its parent's content.
 */
function pruneEmptyTextNodes(node: JSONContent): boolean {
  if (node.type === "text") {
    return typeof node.text === "string" && node.text.length > 0;
  }
  if (node.content !== undefined) {
    node.content = node.content.filter((child) => pruneEmptyTextNodes(child));
    if (node.content.length === 0) {
      delete node.content;
    }
  }
  return true;
}
