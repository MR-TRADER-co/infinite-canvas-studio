/**
 * The live-query engine (R15.2): PURE functions that run one
 * {@link QuerySpec} against an immutable {@link KnowledgeIndex}
 * snapshot, producing the display rows of a query card.
 *
 * Four query kinds:
 *   - `backlinks` — every object that links `[[target]]` (with snippet);
 *   - `tag`       — every object carrying `#target`;
 *   - `broken`    — every unresolved `[[…]]` in the project (with the
 *                    missing title as the row detail);
 *   - `orphans`   — titled objects with no links in, no links out and no
 *                    tags (the knowledge islands).
 *
 * Results are computed on demand (renderer + inspector call this per
 * frame/per render with the service's current snapshot) — never stored
 * on the object, never in undo.
 */
import type { KnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import type { QuerySpec, QueryType } from "@/core/model/QueryObject";
import { normaliseKnowledgeKey } from "@/core/knowledge/WikiLinks";

/** One result row of a live query. */
export interface QueryRow {
  /** The referenced object (fly-to target); null only for ghost rows. */
  readonly objectId: string | null;
  /** The row's display title ("" = untitled — the UI substitutes). */
  readonly title: string;
  /** Snippet around the reference (backlinks only). */
  readonly snippet?: string;
  /** Secondary detail (broken: the missing title; filter: the column). */
  readonly detail?: string;
  /** The row's group label (structured filter cards with groupBy only). */
  readonly group?: string;
}

/** The full result of running one query against an index. */
export interface KnowledgeQueryResult {
  /** The matched rows (document order; never null entries). */
  readonly rows: readonly QueryRow[];
  /** Whether the given target title/tag does not exist in the index. */
  readonly missingTarget: boolean;
  /** The total match count (== rows.length; kept for forward-compat). */
  readonly total: number;
}

/** The empty result singleton (queries over an empty index). */
export const EMPTY_QUERY_RESULT: KnowledgeQueryResult = {
  rows: [],
  missingTarget: false,
  total: 0,
};

/** Display truncation of row snippets. */
const SNIPPET_MAX = 96;

/** Truncates a snippet for one display line. */
function truncateSnippet(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > SNIPPET_MAX
    ? `${collapsed.slice(0, SNIPPET_MAX - 1)}…`
    : collapsed;
}

/** Resolves the display title of one object id ("" when untitled). */
function titleOf(index: KnowledgeIndex, objectId: string): string {
  return index.objectTitle.get(objectId)?.display ?? "";
}

/**
 * Runs the `backlinks` query: who links to the title `target`?
 *
 * @param index - the knowledge snapshot.
 * @param target - the normalised target title key.
 * @returns the union of the backlink rows of every object owning the
 *          title (deduped by source id), or `missingTarget`.
 */
function runBacklinks(
  index: KnowledgeIndex,
  target: string,
): KnowledgeQueryResult {
  const entry = index.titles.get(target);
  if (entry === undefined || entry.objectIds.length === 0) {
    return { rows: [], missingTarget: true, total: 0 };
  }
  const seen = new Set<string>();
  const rows: QueryRow[] = [];
  for (const objectId of entry.objectIds) {
    const backlinks = index.backlinks.get(objectId) ?? [];
    for (const backlink of backlinks) {
      if (seen.has(backlink.sourceId)) {
        continue;
      }
      seen.add(backlink.sourceId);
      rows.push({
        objectId: backlink.sourceId,
        title: titleOf(index, backlink.sourceId),
        snippet: truncateSnippet(backlink.snippet),
      });
    }
  }
  return { rows, missingTarget: false, total: rows.length };
}

/**
 * Runs the `tag` query: every object carrying `#target`.
 *
 * @param index - the knowledge snapshot.
 * @param target - the normalised tag key.
 * @returns one row per tagged object, or `missingTarget`.
 */
function runTag(
  index: KnowledgeIndex,
  target: string,
): KnowledgeQueryResult {
  const tag = index.tags.get(target);
  if (tag === undefined) {
    return { rows: [], missingTarget: true, total: 0 };
  }
  const rows: QueryRow[] = tag.objectIds.map((objectId) => ({
    objectId,
    title: titleOf(index, objectId),
  }));
  return { rows, missingTarget: false, total: rows.length };
}

/**
 * Runs the `broken` query: every unresolved `[[…]]` in the project.
 *
 * @param index - the knowledge snapshot.
 * @returns one row per referencing source; `detail` carries the missing
 *          title (the row flies to the SOURCE, the only real object).
 */
function runBroken(index: KnowledgeIndex): KnowledgeQueryResult {
  const rows: QueryRow[] = [];
  const brokenKeys = [...index.brokenTitles.keys()].sort();
  for (const key of brokenKeys) {
    const refs = index.brokenTitles.get(key) ?? [];
    for (const ref of refs) {
      rows.push({
        objectId: ref.sourceId,
        title: titleOf(index, ref.sourceId),
        detail: ref.display,
      });
    }
  }
  return { rows, missingTarget: false, total: rows.length };
}

/**
 * Runs the `orphans` query: titled objects with no outgoing links, no
 * backlinks and no tags — the islands of the knowledge graph.
 *
 * @param index - the knowledge snapshot.
 * @returns one row per island object.
 */
function runOrphans(index: KnowledgeIndex): KnowledgeQueryResult {
  const rows: QueryRow[] = [];
  const objectIds = [...index.objectTitle.keys()].sort();
  for (const objectId of objectIds) {
    const hasOutgoing = (index.outgoing.get(objectId) ?? []).length > 0;
    const hasIncoming = (index.backlinks.get(objectId) ?? []).length > 0;
    const hasTags = (index.objectTags.get(objectId) ?? []).length > 0;
    if (!hasOutgoing && !hasIncoming && !hasTags) {
      rows.push({
        objectId,
        title: titleOf(index, objectId),
      });
    }
  }
  return { rows, missingTarget: false, total: rows.length };
}

/**
 * Runs one live query against a knowledge snapshot.
 *
 * @param index - the immutable knowledge index (the service's current).
 * @param spec - the query specification.
 * @returns the query result (never null; `missingTarget` explains an
 *          empty targeted result).
 */
export function runKnowledgeQuery(
  index: KnowledgeIndex,
  spec: QuerySpec,
): KnowledgeQueryResult {
  const type: QueryType = spec.type;
  if (type === "broken") {
    return runBroken(index);
  }
  if (type === "orphans") {
    return runOrphans(index);
  }
  const target = normaliseKnowledgeKey(spec.target);
  if (target === "") {
    return { rows: [], missingTarget: true, total: 0 };
  }
  if (type === "backlinks") {
    return runBacklinks(index, target);
  }
  return runTag(index, target);
}
