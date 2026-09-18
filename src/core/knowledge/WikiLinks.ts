/**
 * Wiki-link + tag parsing (Knowledge Pack, pack-Phase-11 rebuild):
 * the PURE text grammar that turns free-form object text into a
 * knowledge graph.
 *
 * Syntax (deliberately tiny and lossless — the Markdown interop keeps
 * both forms VERBATIM in exports/imports, see DECISIONS #34d):
 * - `[[عنوان]]` — a wiki link to the object whose TITLE matches
 *   «عنوان» (custom name, else first heading, else first line).
 * - `#برچسب` — a tag on the owning object (word-boundary anchored).
 *
 * Normalisation folds the common Persian/Arabic spelling drift so links
 * still resolve across keyboards: Arabic ي/ك → Persian ی/ک, ZWNJ is
 * dropped, runs of whitespace collapse, latin casefolds.
 */

/** A parsed `[[title]]` reference. */
export interface WikiLinkRef {
  /** The normalised matching key (use for resolution). */
  readonly key: string;
  /** The raw title as typed (trimmed) — the display form. */
  readonly display: string;
  /** Character index of the whole `[[…]]` span in the source text. */
  readonly index: number;
}

/** A parsed `#tag` reference. */
export interface WikiTagRef {
  /** The normalised matching key. */
  readonly key: string;
  /** The raw tag as typed (without `#`, trimmed). */
  readonly display: string;
  /** Character index of the `#` in the source text. */
  readonly index: number;
}

/** Longest title/tag we accept (guards pathological inputs). */
const MAX_LEN = 96;

/** Characters that may not precede a `#tag` (it would be mid-word). */
const TAG_BOUNDARY_EXCLUDED = /[\p{L}\p{N}_#]/u;

/**
 * Decides whether a `#` at `index` sits at a word boundary.
 *
 * A word character IMMEDIATELY before the `#` reads as mid-word and
 * rejects the tag («کلمه#داخل») — with one Persian carve-out: when the
 * backward run contains a ZWNJ («می‌شود#برچسب»), the ZWNJ is NOT a
 * word character, so the token is already split by an invisible join
 * and the `#` reads as a fresh tag start rather than a continuation
 * of one long word. A directly preceding `#` («##دابل») always
 * rejects.
 *
 * @param text - the full source text.
 * @param index - the character index of the `#`.
 * @returns true when a tag may start at `index`.
 */
function tagStartsAtBoundary(text: string, index: number): boolean {
  if (index === 0) {
    return true; // start-of-text is always a boundary
  }
  const first = text[index - 1] ?? "";
  if (first === "#") {
    return false; // «##دابل» — a doubled hash is never a tag start
  }
  if (!TAG_BOUNDARY_EXCLUDED.test(first)) {
    return true; // space, punctuation, ZWNJ … — a boundary
  }
  // `first` extends a word — walk the run back; a ZWNJ inside it
  // still splits the token, so the `#` counts as a boundary.
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = text[i] ?? "";
    if (ch === "\u200C") {
      return true;
    }
    if (!TAG_BOUNDARY_EXCLUDED.test(ch)) {
      return false; // the run ended as one solid word
    }
  }
  return false; // the whole prefix is a single word — mid-word `#`
}

/**
 * Normalises a title or tag into its matching key.
 *
 * @param raw - the user-typed text.
 * @returns the folded key (empty when nothing usable remains).
 */
export function normaliseKnowledgeKey(raw: string): string {
  return raw
    .replace(/\u064A/g, "\u06CC") // Arabic yeh → Persian yeh
    .replace(/\u0643/g, "\u06A9") // Arabic kaf → Persian kaf
    .replace(/\u200C/g, "") // ZWNJ drops
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fa-IR")
    .slice(0, MAX_LEN);
}

/**
 * Parses every `[[title]]` reference in a text (document order). A
 * title may contain SINGLE brackets («[[اینجا ] نه]]» → «اینجا ] نه»)
 * but the span always ends at the FIRST `]]` — nested bracket
 * structures are never balanced/matched. An empty/whitespace-only
 * title is skipped, never a link.
 *
 * @param text - the object's plain text.
 * @returns the references (deduplicated by key, first occurrence wins).
 */
export function parseWikiLinks(text: string): readonly WikiLinkRef[] {
  const out: WikiLinkRef[] = [];
  const seen = new Set<string>();
  // Content = any char except `]`, or a `]` not followed by another
  // `]` (so the span terminates at the first `]]`).
  const pattern = /\[\[((?:[^\]]|\](?!\]))*)\]\]/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[1] ?? "";
    const display = raw.replace(/\s+/g, " ").trim();
    if (display.length === 0) {
      continue;
    }
    const key = normaliseKnowledgeKey(display);
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      key,
      display: display.slice(0, MAX_LEN),
      index: match.index ?? 0,
    });
  }
  return out;
}

/**
 * Parses every `#tag` in a text. A tag starts at a `#` that is NOT
 * preceded by a letter/digit/underscore/`#`, continues over letters,
 * digits, `_` and `-`, and must contain at least one letter (so
 * «#۱۲۳» — a bare number — is not a tag). Unique by key, in order.
 *
 * @param text - the object's plain text.
 * @returns the tags (deduplicated by key, first occurrence wins).
 */
export function parseWikiTags(text: string): readonly WikiTagRef[] {
  const out: WikiTagRef[] = [];
  const seen = new Set<string>();
  // ZWNJ sits in the CONTINUATION class so Persian tags like
  // «#برنامه‌ریزی» match whole (the key normalisation drops it later).
  const pattern = /#([\p{L}\p{N}_][\p{L}\p{N}_\u200C-]{0,95})/gu;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    // Boundary: the `#` must not continue a solid word (see
    // tagStartsAtBoundary for the ZWNJ carve-out).
    if (!tagStartsAtBoundary(text, index)) {
      continue;
    }
    const raw = match[1] ?? "";
    // At least one letter somewhere — numbers-only tags are noise.
    if (!/[\p{L}]/u.test(raw)) {
      continue;
    }
    const key = normaliseKnowledgeKey(raw);
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ key, display: raw, index });
  }
  return out;
}

/**
 * Builds a short snippet around a span (for backlink rows).
 *
 * @param text - the source text.
 * @param index - the span's start index.
 * @param length - the span's length.
 * @returns the snippet with ellipses on trimmed sides.
 */
export function snippetAroundSpan(
  text: string,
  index: number,
  length: number,
): string {
  const radius = 20;
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}
