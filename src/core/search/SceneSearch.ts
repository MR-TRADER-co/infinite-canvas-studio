/**
 * Scene-wide search + outline extraction (R7.6/R7.7): the pure model the
 * Search and Outline panels render from.
 *
 * Text extraction reuses the persistence-layer doc flattener
 * (`plainTextOfDocument`) so table cells and nested lists are searched
 * exactly like paragraphs; the outline walker resolves H1/H2/H3 blocks in
 * z-order (document order). Everything here is pure + node-testable —
 * the panels subscribe to scene changes and call these helpers.
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { RichTextDocument } from "@/text/editor/richtext";
import { plainTextOfDocument } from "@/text/editor/richtext";
import {
  TAGS_PROPERTY,
  propertyValueEquals,
  type PropertyValue,
} from "@/core/model/Properties";
import {
  normaliseKnowledgeKey,
  parseWikiTags,
} from "@/core/knowledge/WikiLinks";

/** Search scope: object text content, object names, or both. */
export type SearchScope = "text" | "names" | "all";

/** One match inside one object. */
export interface SceneSearchMatch {
  /** The matched text. */
  readonly text: string;
  /** Character index of the match inside the object's searchable text. */
  readonly index: number;
  /** Snippet around the match (RTL panel renders it verbatim). */
  readonly snippet: string;
}

/** All matches of one object (a result row group). */
export interface SceneSearchGroup {
  /** The object the matches were found in. */
  readonly object: SceneObjectData;
  /** The object's display label (custom name or the kind label handled by UI). */
  readonly label: string | null;
  /** The matches, in document order. */
  readonly matches: readonly SceneSearchMatch[];
}

/** Options of a scene search. */
export interface SceneSearchOptions {
  /** The raw query (case-insensitive; Persian is caseless anyway). */
  readonly query: string;
  /** Where to look. */
  readonly scope: SearchScope;
  /**
   * Structured filters (pack R11.9): tag chips + property-equality
   * chips narrowing the results — a direct scan, the full query engine
   * is Phase 12. With a text query, groups must satisfy BOTH; with
   * filters alone, every matching object lists as a label-only group.
   */
  readonly filters?: SceneSearchFilters;
}

/** One property-equality chip. */
export interface PropertyFilterChip {
  /** The property name. */
  readonly name: string;
  /** The user's equality input. */
  readonly value: string;
}

/** The active structured filters of the search panel. */
export interface SceneSearchFilters {
  /** Tag display forms (matched folded against text #tags + property tags). */
  readonly tags: readonly string[];
  /** Property-equality chips (ANDed together). */
  readonly properties: readonly PropertyFilterChip[];
}

/** The no-filter constant (reference-stable for memo deps). */
export const NO_SEARCH_FILTERS: SceneSearchFilters = {
  tags: [],
  properties: [],
};

/** Snippet radius around a match, in characters. */
const SNIPPET_RADIUS = 24;

/**
 * Tests one object against a tag (folded): text `#tag`s of text-bearing
 * objects AND the structured `tags` property (R11.4) both count — the
 * direct-scan twin of the knowledge index's tag aggregation.
 *
 * @param object - the object to test.
 * @param tag - the tag's display form.
 * @returns whether the object carries the tag.
 */
export function objectHasTag(object: SceneObjectData, tag: string): boolean {
  const key = normaliseKnowledgeKey(tag);
  if (key.length === 0) {
    return false;
  }
  const propTags = object.properties?.[TAGS_PROPERTY];
  if (
    Array.isArray(propTags) &&
    propTags.some((item) => normaliseKnowledgeKey(item) === key)
  ) {
    return true;
  }
  const text = searchableTextOf(object);
  if (text === "") {
    return false;
  }
  return parseWikiTags(text).some((parsed) => parsed.key === key);
}

/**
 * Tests one object against every active filter (R11.9's direct scan):
 * all tags AND all property-equality chips must match.
 *
 * @param object - the object to test.
 * @param filters - the active filters.
 * @returns whether the object satisfies the whole filter set.
 */
export function objectMatchesFilters(
  object: SceneObjectData,
  filters: SceneSearchFilters,
): boolean {
  for (const tag of filters.tags) {
    if (!objectHasTag(object, tag)) {
      return false;
    }
  }
  for (const chip of filters.properties) {
    const value = object.properties?.[chip.name];
    if (value === undefined || !propertyValueEquals(value, chip.value)) {
      return false;
    }
  }
  return true;
}

/** Whether a filter set has any active chip. */
export function filtersActive(filters: SceneSearchFilters): boolean {
  return filters.tags.length > 0 || filters.properties.length > 0;
}

/**
 * Reads one object's property value as a display string (the chips' tooltip).
 *
 * @param value - the property value.
 * @returns the display form.
 */
export function propertyFilterLabel(value: PropertyValue): string {
  return Array.isArray(value) ? value.join(" · ") : String(value);
}

/**
 * @param object - the object to inspect.
 * @returns the searchable text content of a text-bearing object (empty
 *          for non-text kinds).
 */
export function searchableTextOf(object: SceneObjectData): string {
  if (object.kind === "textBox" || object.kind === "stickyNote") {
    const candidate = object as {
      text?: string;
      doc?: RichTextDocument | null;
    };
    const fromDoc = plainTextOfDocument(candidate.doc);
    if (fromDoc !== "") {
      return fromDoc;
    }
    return candidate.text ?? "";
  }
  return "";
}

/**
 * Searches the scene objects.
 *
 * @param objects - the scene objects in paint order.
 * @param options - the query + scope + structured filters.
 * @returns the non-empty match groups, grouped per object, in paint order.
 */
export function searchScene(
  objects: readonly SceneObjectData[],
  options: SceneSearchOptions,
): readonly SceneSearchGroup[] {
  const query = options.query.trim();
  const filters = options.filters ?? NO_SEARCH_FILTERS;
  const hasFilters = filtersActive(filters);
  if (query.length === 0) {
    // Filters alone browse: every object satisfying the chips lists as a
    // label-only group (a synthetic match carries the object's label).
    if (!hasFilters) {
      return [];
    }
    const groups: SceneSearchGroup[] = [];
    for (const object of objects) {
      if (!object.visible || !objectMatchesFilters(object, filters)) {
        continue;
      }
      groups.push({
        object,
        label: object.name ?? null,
        matches: [
          {
            text: object.name ?? "",
            index: 0,
            snippet: "",
          },
        ],
      });
    }
    return groups;
  }
  const needle = query.toLocaleLowerCase("fa-IR");
  const groups: SceneSearchGroup[] = [];
  for (const object of objects) {
    if (!object.visible) {
      continue;
    }
    if (hasFilters && !objectMatchesFilters(object, filters)) {
      continue;
    }
    const label = object.name ?? null;
    const sources: Array<{ text: string; kind: "text" | "name" }> = [];
    if (options.scope === "names" || options.scope === "all") {
      if (label !== null) {
        sources.push({ text: label, kind: "name" });
      }
    }
    if (options.scope === "text" || options.scope === "all") {
      sources.push({ text: searchableTextOf(object), kind: "text" });
    }
    const matches: SceneSearchMatch[] = [];
    for (const source of sources) {
      const haystack = source.text.toLocaleLowerCase("fa-IR");
      let from = haystack.indexOf(needle);
      while (from !== -1) {
        matches.push({
          text: source.text.slice(from, from + query.length),
          index: from,
          snippet: snippetAround(source.text, from, query.length),
        });
        from = haystack.indexOf(needle, from + needle.length);
      }
    }
    if (matches.length > 0) {
      groups.push({ object, label, matches });
    }
  }
  return groups;
}

/**
 * Builds the snippet around a match (bounded by the text's edges).
 *
 * @param text - the full text.
 * @param index - the match's start index.
 * @param length - the match's length.
 * @returns the snippet with an ellipsis on trimmed sides.
 */
function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

/** One outline entry: a heading inside a text object. */
export interface OutlineEntry {
  /** Id of the owning text object. */
  readonly objectId: string;
  /** Heading level (1–3). */
  readonly level: 1 | 2 | 3;
  /** The heading's text. */
  readonly text: string;
}

/**
 * Builds the document outline (R7.7): every H1/H2/H3 of every text object,
 * in z-order (document order). Empty headings are skipped; non-text kinds
 * contribute nothing.
 *
 * @param objects - the scene objects in paint order.
 * @returns the outline entries.
 */
export function buildOutline(
  objects: readonly SceneObjectData[],
): readonly OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const object of objects) {
    if (object.kind !== "textBox" && object.kind !== "stickyNote") {
      continue;
    }
    const candidate = object as {
      doc?: RichTextDocument | null;
      text?: string;
    };
    if (candidate.doc !== null && candidate.doc !== undefined) {
      for (const node of candidate.doc.content ?? []) {
        if (node?.type !== "heading") {
          continue;
        }
        const levelRaw = node.attrs?.level;
        if (levelRaw === 1 || levelRaw === 2 || levelRaw === 3) {
          const text = nodeText(node);
          if (text.trim() !== "") {
            entries.push({
              objectId: object.id,
              level: levelRaw,
              text: text.trim(),
            });
          }
        }
      }
      continue;
    }
    // Legacy plain-text boxes carry no headings — nothing to outline.
    void candidate.text;
  }
  return entries;
}

/**
 * Flattens a node's inline text.
 *
 * @param node - the JSON node.
 * @returns the concatenated text.
 */
function nodeText(node: {
  type?: string;
  text?: string;
  content?: unknown[];
}): string {
  if (typeof node.text === "string") {
    return node.text;
  }
  let out = "";
  for (const child of node.content ?? []) {
    if (typeof child === "object" && child !== null) {
      out += nodeText(child as Parameters<typeof nodeText>[0]);
    }
  }
  return out;
}
