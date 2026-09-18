/**
 * The knowledge-graph builder (Knowledge Pack, pack-Phase-11 rebuild):
 * a PURE fold over the scene objects producing the wiki-link index —
 * titles, directed links, backlinks, broken (unresolved) titles and
 * tags.
 *
 * An object's TITLE (the `[[…]]` resolution target) is:
 *   1. its custom name, else
 *   2. its first heading (H1/H2/H3, document order), else
 *   3. its first non-empty text line (truncated for display).
 *
 * All matching goes through {@link normaliseKnowledgeKey} so Persian/
 * Arabic keyboard drift still resolves. The index is an immutable
 * snapshot per rebuild — the service (see KnowledgeService) owns the
 * schedule.
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import { TAGS_PROPERTY } from "@/core/model/Properties";
import { searchableTextOf } from "@/core/search/SceneSearch";
import {
  normaliseKnowledgeKey,
  parseWikiLinks,
  parseWikiTags,
  snippetAroundSpan,
} from "@/core/knowledge/WikiLinks";
import {
  resolveLinkTarget,
  type ObjectLinkEntry,
} from "@/core/knowledge/LinkRegistry";

/** The resolved title of one object. */
export interface KnowledgeTitle {
  /** The matching key. */
  readonly key: string;
  /** The display form. */
  readonly display: string;
}

/** How a link came to exist — drives row icons in the UI surfaces. */
export type KnowledgeLinkKind = "wiki" | "manual" | "plugin";

/** One outgoing `[[title]]` link of an object. */
export interface OutgoingWikiLink {
  /** The link target's title key. */
  readonly key: string;
  /** The typed title (display). */
  readonly display: string;
  /** The resolved object ids (empty = broken/red link). */
  readonly resolvedIds: readonly string[];
  /** How the link exists (wiki = parsed text; manual/plugin = registry). */
  readonly kind: KnowledgeLinkKind;
  /** Registry entry id (manual/plugin links only). */
  readonly linkId?: string;
}

/** One backlink row (who links TO an object). */
export interface KnowledgeBacklink {
  /** The linking (source) object id. */
  readonly sourceId: string;
  /** The typed title (display). */
  readonly display: string;
  /** Snippet around the link inside the source text. */
  readonly snippet: string;
  /** How the link exists (wiki = parsed text; manual/plugin = registry). */
  readonly kind: KnowledgeLinkKind;
  /** Registry entry id (manual/plugin links only). */
  readonly linkId?: string;
}

/** One unresolved title and who references it. */
export interface BrokenWikiLink {
  /** The source object id that references the missing title. */
  readonly sourceId: string;
  /** The typed title (display). */
  readonly display: string;
  /** How the link exists (wiki = parsed text; manual/plugin = registry). */
  readonly kind: KnowledgeLinkKind;
}

/** A tag summary row. */
export interface KnowledgeTag {
  /** The matching key. */
  readonly key: string;
  /** The display form (first spelling seen). */
  readonly display: string;
  /** The objects carrying the tag. */
  readonly objectIds: readonly string[];
}

/** The immutable knowledge graph of one scene snapshot. */
export interface KnowledgeIndex {
  /** Title key → the objects owning that title. */
  readonly titles: ReadonlyMap<string, KnowledgeTitle & { objectIds: readonly string[] }>;
  /** Per-object resolved title. */
  readonly objectTitle: ReadonlyMap<string, KnowledgeTitle>;
  /** Source object id → its outgoing links (deduped by key). */
  readonly outgoing: ReadonlyMap<string, readonly OutgoingWikiLink[]>;
  /** Target object id → the backlinks pointing at it. */
  readonly backlinks: ReadonlyMap<string, readonly KnowledgeBacklink[]>;
  /** Broken title key → the references that could not resolve. */
  readonly brokenTitles: ReadonlyMap<string, readonly BrokenWikiLink[]>;
  /** Tag key → the tag summary. */
  readonly tags: ReadonlyMap<string, KnowledgeTag>;
  /** Object id → its tag keys (document order). */
  readonly objectTags: ReadonlyMap<string, readonly string[]>;
  /** Registry link entry id → its resolved target object id (null = dangling). */
  readonly linkResolution: ReadonlyMap<string, string | null>;
}

/** Display truncation of first-line fallback titles. */
const FALLBACK_TITLE_MAX = 48;

/**
 * Strips wiki-link (`[[…]]`) and tag (`#برچسب`) markup from a fallback
 * title line. A line that is ONLY markup («[[تنها]] #تنها») is a link
 * note, not a titled note — it must NOT become a resolution target of
 * its own links (see the knowledge stats fixture).
 *
 * @param line - the raw first line / heading text.
 * @returns the plain text (whitespace collapsed, trimmed; may be "").
 */
function stripKnowledgeMarkup(line: string): string {
  return line
    .replace(/\[\[.*?\]\]/g, " ")
    .replace(/#[\p{L}\p{N}_\u200C-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts the first heading's text (H1/H2/H3, document order) from a
 * rich-text object's document.
 *
 * @param object - the text-bearing object.
 * @returns the heading text, or null when the document has no heading.
 */
function firstHeadingOf(object: SceneObjectData): string | null {
  const candidate = object as {
    doc?: { content?: unknown[] } | null;
  };
  const content = candidate.doc?.content;
  if (!Array.isArray(content)) {
    return null;
  }
  for (const node of content) {
    if (typeof node !== "object" || node === null) {
      continue;
    }
    const typed = node as {
      type?: string;
      attrs?: { level?: unknown };
      content?: unknown[];
    };
    if (
      typed.type === "heading" &&
      (typed.attrs?.level === 1 ||
        typed.attrs?.level === 2 ||
        typed.attrs?.level === 3)
    ) {
      const text = flattenNodeText(typed);
      if (text.trim() !== "") {
        return text;
      }
    }
  }
  return null;
}

/**
 * Flattens a node's inline text (same walk as the outline builder).
 *
 * @param node - the JSON node.
 * @returns the concatenated text.
 */
function flattenNodeText(node: {
  text?: string;
  content?: unknown[];
}): string {
  if (typeof node.text === "string") {
    return node.text;
  }
  let out = "";
  for (const child of node.content ?? []) {
    if (typeof child === "object" && child !== null) {
      out += flattenNodeText(child as { text?: string; content?: unknown[] });
    }
  }
  return out;
}

/** The shared empty index (all lookups miss, iteration is empty). */
export const EMPTY_KNOWLEDGE_INDEX: KnowledgeIndex = {
  titles: new Map(),
  objectTitle: new Map(),
  outgoing: new Map(),
  backlinks: new Map(),
  brokenTitles: new Map(),
  tags: new Map(),
  objectTags: new Map(),
  linkResolution: new Map(),
};

/**
 * Resolves one object's title (name > first heading > first line).
 *
 * @param object - the object to inspect.
 * @returns the title, or null when the object has no usable title.
 */
export function objectTitleOf(
  object: SceneObjectData,
): KnowledgeTitle | null {
  const named = object.name;
  if (typeof named === "string" && named.trim() !== "") {
    const display = named.replace(/\s+/g, " ").trim();
    const key = normaliseKnowledgeKey(display);
    if (key !== "") {
      return { key, display };
    }
  }
  if (object.kind !== "textBox" && object.kind !== "stickyNote") {
    return null;
  }
  const text = searchableTextOf(object);
  if (text === "") {
    return null;
  }
  // First heading beats first line — a titled document links by its
  // heading even when custom names are absent. Markup-only headings
  // fall through to the first line (a heading that is just a link is
  // not a title).
  const heading = firstHeadingOf(object);
  if (heading !== null) {
    const display = stripKnowledgeMarkup(heading);
    const key = normaliseKnowledgeKey(display);
    if (key !== "") {
      return { key, display };
    }
  }
  const firstLine =
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? "";
  if (firstLine === "") {
    return null;
  }
  // The fallback title is the PLAIN first line — wiki links and tags
  // are stripped, and a line that is nothing BUT markup yields no
  // title at all.
  const plain = stripKnowledgeMarkup(firstLine);
  if (plain === "") {
    return null;
  }
  const display =
    plain.length > FALLBACK_TITLE_MAX
      ? `${plain.slice(0, FALLBACK_TITLE_MAX)}…`
      : plain;
  return { key: normaliseKnowledgeKey(plain), display };
}

/**
 * Builds the knowledge index of a scene snapshot.
 *
 * @param objects - the scene objects (any order; the graph is
 *        order-independent except display spellings, where the FIRST
 *        occurrence of a key wins).
 * @param links - the LinkRegistry entries (pack R11.2/R11.6 — manual
 *        and plugin links fold in as projections; none by default).
 * @returns the immutable index.
 */
export function buildKnowledgeIndex(
  objects: readonly SceneObjectData[],
  links: readonly ObjectLinkEntry[] = [],
): KnowledgeIndex {
  if (objects.length === 0) {
    // The shared singleton keeps empty-scene snapshots reference-equal
    // (cheap identity checks downstream, no per-rebuild allocation).
    return EMPTY_KNOWLEDGE_INDEX;
  }
  const titles = new Map<
    string,
    KnowledgeTitle & { objectIds: string[] }
  >();
  const objectTitle = new Map<string, KnowledgeTitle>();
  const outgoing = new Map<string, OutgoingWikiLink[]>();
  const backlinks = new Map<string, KnowledgeBacklink[]>();
  const brokenTitles = new Map<string, BrokenWikiLink[]>();
  const tags = new Map<string, KnowledgeTag & { objectIds: string[] }>();
  const objectTags = new Map<string, string[]>();
  const linkResolution = new Map<string, string | null>();
  const objectsById = new Map<string, SceneObjectData>(
    objects.map((object) => [object.id, object]),
  );

  // Pass 1 — titles.
  for (const object of objects) {
    const title = objectTitleOf(object);
    if (title === null) {
      continue;
    }
    objectTitle.set(object.id, title);
    const existing = titles.get(title.key);
    if (existing === undefined) {
      titles.set(title.key, {
        ...title,
        objectIds: [object.id],
      });
    } else if (!existing.objectIds.includes(object.id)) {
      existing.objectIds.push(object.id);
    }
  }

  // Pass 2 — links + tags (text-bearing objects only).
  for (const object of objects) {
    if (object.kind !== "textBox" && object.kind !== "stickyNote") {
      continue;
    }
    const text = searchableTextOf(object);
    if (text === "") {
      continue;
    }
    const links: OutgoingWikiLink[] = [];
    const seenKeys = new Set<string>();
    for (const ref of parseWikiLinks(text)) {
      if (seenKeys.has(ref.key)) {
        continue;
      }
      seenKeys.add(ref.key);
      const resolved = titles.get(ref.key)?.objectIds ?? [];
      links.push({
        key: ref.key,
        display: ref.display,
        resolvedIds: [...resolved],
        kind: "wiki",
      });
      const snippet = snippetAroundSpan(text, ref.index, ref.display.length + 4);
      if (resolved.length > 0) {
        for (const targetId of resolved) {
          const rows = backlinks.get(targetId) ?? [];
          if (
            !rows.some(
              (row) => row.sourceId === object.id && row.display === ref.display,
            )
          ) {
            rows.push({
              sourceId: object.id,
              display: ref.display,
              snippet,
              kind: "wiki",
            });
            backlinks.set(targetId, rows);
          }
        }
      } else {
        const rows = brokenTitles.get(ref.key) ?? [];
        if (!rows.some((row) => row.sourceId === object.id)) {
          rows.push({ sourceId: object.id, display: ref.display, kind: "wiki" });
          brokenTitles.set(ref.key, rows);
        }
      }
    }
    if (links.length > 0) {
      outgoing.set(object.id, links);
    }
    const tagKeys: string[] = [];
    for (const tag of parseWikiTags(text)) {
      if (!tagKeys.includes(tag.key)) {
        tagKeys.push(tag.key);
      }
      const existing = tags.get(tag.key);
      if (existing === undefined) {
        tags.set(tag.key, {
          key: tag.key,
          display: tag.display,
          objectIds: [object.id],
        });
      } else if (!existing.objectIds.includes(object.id)) {
        existing.objectIds.push(object.id);
      }
    }
    if (tagKeys.length > 0) {
      objectTags.set(object.id, tagKeys);
    }
  }

  // Pass 3 — the structured `tags` property (pack R11.4): every object
  // KIND can carry tags through its properties record (not just
  // text-bearing objects); they fold into the SAME tag index so the
  // graph stats, the live queries and the search chips see one truth.
  for (const object of objects) {
    const propTags = object.properties?.[TAGS_PROPERTY];
    if (!Array.isArray(propTags) || propTags.length === 0) {
      continue;
    }
    const existing = objectTags.get(object.id) ?? [];
    for (const raw of propTags) {
      const key = normaliseKnowledgeKey(raw);
      if (key.length === 0 || existing.includes(key)) {
        continue;
      }
      existing.push(key);
      const tag = tags.get(key);
      if (tag === undefined) {
        tags.set(key, {
          key,
          display: raw.trim(),
          objectIds: [object.id],
        });
      } else if (!tag.objectIds.includes(object.id)) {
        tag.objectIds.push(object.id);
      }
    }
    if (existing.length > 0) {
      objectTags.set(object.id, existing);
    }
  }

  // Pass 4 — the LinkRegistry entries (pack R11.2/R11.6): every manual
  // and plugin link folds in as projections. Resolution = the stored
  // target when it still exists, else the TitleIndex lookup on the
  // title snapshot (the Obsidian dangling magic); entries whose SOURCE
  // object is gone are inert (no rows anywhere — undo of the deletion
  // re-activates them without any bookkeeping).
  for (const entry of links) {
    const source = objectsById.get(entry.sourceId);
    if (source === undefined) {
      linkResolution.set(entry.id, null);
      continue;
    }
    const resolvedTargetId = resolveLinkTarget(
      entry,
      (id) => objectsById.has(id),
      (key) => titles.get(key)?.objectIds ?? [],
    );
    linkResolution.set(entry.id, resolvedTargetId);
    const key = normaliseKnowledgeKey(entry.targetTitle);
    const display =
      resolvedTargetId !== null
        ? (objectTitle.get(resolvedTargetId)?.display ?? entry.targetTitle)
        : entry.targetTitle;
    const rows = outgoing.get(entry.sourceId) ?? [];
    if (!rows.some((row) => row.linkId === entry.id)) {
      rows.push({
        key,
        display,
        resolvedIds: resolvedTargetId === null ? [] : [resolvedTargetId],
        kind: entry.kind,
        linkId: entry.id,
      });
      outgoing.set(entry.sourceId, rows);
    }
    if (resolvedTargetId !== null) {
      const backrows = backlinks.get(resolvedTargetId) ?? [];
      if (!backrows.some((row) => row.linkId === entry.id)) {
        backrows.push({
          sourceId: entry.sourceId,
          display: objectTitle.get(entry.sourceId)?.display ?? entry.targetTitle,
          snippet: entry.label ?? "",
          kind: entry.kind,
          linkId: entry.id,
        });
        backlinks.set(resolvedTargetId, backrows);
      }
    } else if (key !== "") {
      const brokenRows = brokenTitles.get(key) ?? [];
      if (!brokenRows.some((row) => row.sourceId === entry.sourceId)) {
        brokenRows.push({
          sourceId: entry.sourceId,
          display: entry.targetTitle,
          kind: entry.kind,
        });
        brokenTitles.set(key, brokenRows);
      }
    }
  }

  return {
    titles,
    objectTitle,
    outgoing,
    backlinks,
    brokenTitles,
    tags,
    objectTags,
    linkResolution,
  };
}
