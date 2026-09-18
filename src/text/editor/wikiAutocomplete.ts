/**
 * Wiki-link autocomplete helpers (Knowledge Pack R11.5 completion):
 * the PURE detection/ranking logic behind the `[[` suggestion popup.
 *
 * The popup itself is a DOM-level surface that works identically over
 * BOTH text-editing paths of this app — the legacy sticky-note
 * contenteditable session and the shared TipTap (`.ProseMirror`)
 * editor — because both are contenteditable roots sharing the same
 * caret/selection APIs.
 */
import { normaliseKnowledgeKey } from "@/core/knowledge/WikiLinks";

/** The maximum rows the popup lists (keeps it glanceable). */
export const WIKI_SUGGESTION_LIMIT = 8;

/** The longest query the popup still serves (guards pasted blobs). */
const MAX_QUERY_LENGTH = 80;

/** An open `[[query` span whose caret sits at its end. */
export interface OpenWikiQuery {
  /** Character index of the opening `[` inside the probed text. */
  readonly start: number;
  /** The typed text between `[[` and the caret (may be empty). */
  readonly query: string;
}

/**
 * Detects an OPEN wiki-link span ending at the caret: the text before
 * the caret must contain a `[[` with NO closing `]]` after it (the
 * wiki grammar's spans always end at the FIRST `]]`, so any `]]` after
 * the last `[[` means that span is closed).
 *
 * A newline inside the query means the span would cross block nodes —
 * never one link — so it is treated as closed. Empty queries (`[[`
 * alone) are still open (the popup then lists the first titles).
 *
 * @param textBeforeCaret - the plain text of the anchor text node up
 *        to the caret.
 * @returns the open span, or null when the caret is not inside one.
 */
export function detectOpenWikiQuery(
  textBeforeCaret: string,
): OpenWikiQuery | null {
  const lastOpen = textBeforeCaret.lastIndexOf("[[");
  if (lastOpen === -1) {
    return null;
  }
  const query = textBeforeCaret.slice(lastOpen + 2);
  if (query.includes("]]")) {
    return null;
  }
  if (/[\n\r]/.test(query)) {
    return null;
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return null;
  }
  return { start: lastOpen, query };
}

/**
 * Ranks title suggestions for a typed query: `startsWith` matches come
 * first, `contains` matches after, each bucket keeping the index's
 * document order (first appearance). Persian/Arabic keyboard drift
 * (ي/ك → ی/ک, ZWNJ, case) is folded through the knowledge normaliser
 * so «هدف» finds «هدف نهایی» across keyboards.
 *
 * An empty query returns the first titles in document order (the
 * "browse" mode of the popup).
 *
 * @param query - the raw typed query between `[[` and the caret.
 * @param titles - the display forms of every indexed title, in
 *        document order.
 * @returns the ranked display forms, capped at
 *          {@link WIKI_SUGGESTION_LIMIT} rows.
 */
export function rankWikiSuggestions(
  query: string,
  titles: readonly string[],
): readonly string[] {
  const key = normaliseKnowledgeKey(query);
  const startsWith: string[] = [];
  const contains: string[] = [];
  for (const title of titles) {
    const titleKey = normaliseKnowledgeKey(title);
    if (titleKey.length === 0) {
      continue;
    }
    if (key.length === 0 || titleKey.startsWith(key)) {
      startsWith.push(title);
    } else if (titleKey.includes(key)) {
      contains.push(title);
    }
  }
  return [...startsWith, ...contains].slice(0, WIKI_SUGGESTION_LIMIT);
}

/**
 * Decides whether the "create new" row should appear for a query: it
 * shows whenever the query is non-empty and no existing title matches
 * it EXACTLY (by the normalised key) — the dangling-link magic then
 * auto-resolves the day an object with that title appears.
 *
 * @param query - the raw typed query.
 * @param titles - the display forms of every indexed title.
 * @returns true when the create-new row should render.
 */
export function shouldOfferCreateNew(
  query: string,
  titles: readonly string[],
): boolean {
  const key = normaliseKnowledgeKey(query);
  if (key.length === 0) {
    return false;
  }
  return !titles.some(
    (title) => normaliseKnowledgeKey(title) === key,
  );
}
