/**
 * The structured scene-query engine (Knowledge Pack R12.1, law §1.7.9):
 * the ONLY query mechanism over the scene — a JSON-serializable
 * {@link SceneQuerySpec} executed as pure functions against a scene
 * snapshot + the knowledge index. No DSL, no eval — the same spec shape
 * is shared by the on-canvas filter cards (R12.2), the search panel
 * (R12.7) and the datahub `scene.query v1` contract (R12.6).
 *
 * Query surface (the pack's contract):
 *   filters:  [{prop, op: eq|ne|gt|lt|contains|startsWith, value}] —
 *             `prop` addresses a structured property OR the pseudo
 *             props `title` / `kind`;
 *   tagsAll / tagsAny: folded tag-key membership;
 *   text:     a substring over the object's searchable text;
 *   linksTo:  a title key — objects linking at it (wiki + manual);
 *   kinds:    object-kind allowlist;
 *   limit:    1..200 (default 100; total reports pre-limit matches);
 *   sortBy:   {prop, dir} — numeric when both values are numbers,
 *             deterministic codepoint order otherwise (missing values
 *             always sort LAST, regardless of direction);
 *   groupBy:  a property whose formatted value becomes the row's group
 *             (groups surface in first-appearance order with counts).
 *
 * Rows are `{objectId, title, sortValue, group?}` — never the live object
 * (the caller flies/looks up by id). The engine is deterministic: the
 * same scene + index + spec always produce the byte-identical row order
 * (the object id is the final tie-break).
 *
 * Pure module: no DOM, no React, no Tauri — fully node-testable.
 */
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { KnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import type { PropertyValue } from "@/core/model/Properties";
import { formatPropertyValue, isTagsValue } from "@/core/model/Properties";
import { searchableTextOf } from "@/core/search/SceneSearch";
import { normaliseKnowledgeKey } from "@/core/knowledge/WikiLinks";

/** The filter operators (§1.7.9's closed set). */
export type QueryOperator =
  | "eq"
  | "ne"
  | "gt"
  | "lt"
  | "contains"
  | "startsWith";

/** Every legal operator (validation + the spec editor's options). */
export const QUERY_OPERATORS: readonly QueryOperator[] = [
  "eq",
  "ne",
  "gt",
  "lt",
  "contains",
  "startsWith",
] as const;

/** One property filter. */
export interface QueryFilter {
  /** The property name, or the pseudo prop `title` / `kind`. */
  readonly prop: string;
  /** The comparison. */
  readonly op: QueryOperator;
  /** The user's (string) comparison value. */
  readonly value: string;
}

/** One sort directive. */
export interface QuerySort {
  /** The property name, or the pseudo prop `title` / `kind`. */
  readonly prop: string;
  /** The direction. */
  readonly dir: "asc" | "desc";
}

/** The structured query specification (JSON-serializable, law §1.7.9). */
export interface SceneQuerySpec {
  /** Property filters (AND). */
  readonly filters: readonly QueryFilter[];
  /** Every tag key must be carried (folded match). */
  readonly tagsAll?: readonly string[];
  /** At least one tag key must be carried (folded match). */
  readonly tagsAny?: readonly string[];
  /** A substring over the object's searchable text (folded). */
  readonly text?: string;
  /** A title key — objects whose outgoing links point at it. */
  readonly linksTo?: string;
  /** The object-kind allowlist (internal ids, e.g. `stickyNote`). */
  readonly kinds?: readonly string[];
  /** The row cap (1..200; `total` reports the pre-limit match count). */
  readonly limit: number;
  /** The sort directive (optional — insertion order otherwise). */
  readonly sortBy?: QuerySort;
  /** A property whose formatted value groups the rows. */
  readonly groupBy?: string;
}

/** One result row (never the live object — the id is the handle). */
export interface SceneQueryRow {
  /** The matched object (fly-to target). */
  readonly objectId: string;
  /** The display title ("" = untitled; the UI substitutes). */
  readonly title: string;
  /** The formatted sort value ("" when the sort prop is absent). */
  readonly sortValue: string;
  /** The formatted group value (present only when groupBy is set). */
  readonly group?: string;
}

/** One group summary (first-appearance order after sorting). */
export interface SceneQueryGroup {
  /** The formatted group value ("" = the ungrouped bucket). */
  readonly value: string;
  /** The matched rows in the bucket (pre-limit). */
  readonly count: number;
}

/** The full result of one structured query. */
export interface SceneQueryResult {
  /** The matched rows (capped at the spec's limit; sorted). */
  readonly rows: readonly SceneQueryRow[];
  /** The TOTAL match count before the limit was applied. */
  readonly total: number;
  /** The group summaries (empty unless groupBy is set). */
  readonly groups: readonly SceneQueryGroup[];
}

/** The hard row cap (protects the card + the datahub contract). */
export const QUERY_LIMIT_MAX = 200;

/** The default row cap when the spec omits one. */
export const QUERY_LIMIT_DEFAULT = 100;

/** The maximum filters per spec (the editor mirrors the cap). */
export const MAX_QUERY_FILTERS = 8;

/** The pseudo property addressing the object's knowledge title. */
export const QUERY_PSEUDO_TITLE = "title";

/** The pseudo property addressing the object's kind id. */
export const QUERY_PSEUDO_KIND = "kind";

/** The pseudo props (offered by the spec editor's prop selects). */
export const QUERY_PSEUDO_PROPS: readonly string[] = [
  QUERY_PSEUDO_TITLE,
  QUERY_PSEUDO_KIND,
] as const;

/** The all-matching default spec (a filter card's fresh state). */
export const DEFAULT_SCENE_QUERY_SPEC: SceneQuerySpec = {
  filters: [],
  limit: QUERY_LIMIT_DEFAULT,
};

/** Maximum length of a filter value (sanity, like QUERY_TARGET_MAX). */
const FILTER_VALUE_MAX = 200;

/** Maximum entries in the tag/kind lists. */
const LIST_MAX = 16;

/** Truthy spellings a boolean `eq` accepts (the R11.9 precedent). */
const TRUTHY = /^(true|1|بله|آره|بله|✓)$/i;
const FALSY = /^(false|0|خیر|نه|✗)$/i;

/**
 * Folds one string for query comparisons (Persian keyboard drift —
 * ي/ی، ك/ک، ZWNJ, whitespace — plus case). Codepoint-stable: the fold
 * never reorders characters, so comparisons stay deterministic.
 *
 * @param raw - the string to fold.
 * @returns the folded key.
 */
function foldForQuery(raw: string): string {
  return raw
    .replace(/\u064A/g, "\u06CC")
    .replace(/\u0643/g, "\u06A9")
    .replace(/\u200C/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fa-IR");
}

/**
 * Parses a number from possibly-Persian digits (the properties editor's
 * coercion rules, reused so `gt ۱۰۰` matches `100`).
 *
 * @param raw - the user's input.
 * @returns the number, or null when it does not parse.
 */
function parseLooseNumber(raw: string): number | null {
  const text = raw
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  if (text.length === 0) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolves the raw value a filter/sort/group prop addresses.
 *
 * @param object - the object being tested.
 * @param index - the knowledge snapshot (title lookups).
 * @param prop - the property name or pseudo prop.
 * @returns the raw value, or undefined when absent.
 */
function resolvePropValue(
  object: SceneObjectData,
  index: KnowledgeIndex,
  prop: string,
): PropertyValue | undefined {
  if (prop === QUERY_PSEUDO_TITLE) {
    return index.objectTitle.get(object.id)?.display;
  }
  if (prop === QUERY_PSEUDO_KIND) {
    return object.kind;
  }
  return object.properties?.[prop];
}

/**
 * Tests one value against one filter (the operator semantics).
 *
 * @param value - the object's raw value (undefined = absent).
 * @param filter - the filter to satisfy.
 * @returns whether the value passes the filter.
 */
function valueMatchesFilter(
  value: PropertyValue | undefined,
  filter: QueryFilter,
): boolean {
  const needle = filter.value.trim();
  if (filter.op === "ne" && needle.length === 0) {
    // `ne ""` reads as the existence check «این ویژگی را دارد» — a
    // MISSING value fails it; an empty-string value fails it too.
    return !(
      value === undefined ||
      (typeof value === "string" && value.trim() === "")
    );
  }
  if (value === undefined) {
    // A missing value is "not equal" to everything — and nothing else.
    return filter.op === "ne";
  }
  if (isTagsValue(value)) {
    const items = value.map((item) => foldForQuery(item));
    const folded = foldForQuery(needle);
    switch (filter.op) {
      case "eq":
        return items.includes(folded);
      case "ne":
        return !items.includes(folded);
      case "contains":
        return items.some((item) => item.includes(folded));
      case "startsWith":
        return items.some((item) => item.startsWith(folded));
      default:
        return false; // (arrays do not order)
    }
  }
  if (typeof value === "number") {
    const parsed = parseLooseNumber(needle);
    if (parsed === null) {
      return filter.op === "ne";
    }
    switch (filter.op) {
      case "eq":
        return value === parsed;
      case "ne":
        return value !== parsed;
      case "gt":
        return value > parsed;
      case "lt":
        return value < parsed;
      case "contains":
        return String(value).includes(foldForQuery(needle));
      case "startsWith":
        return String(value).startsWith(foldForQuery(needle));
    }
  }
  if (typeof value === "boolean") {
    const truthy = TRUTHY.test(needle);
    const falsy = FALSY.test(needle);
    if (filter.op === "eq" || filter.op === "ne") {
      const equals = (value && truthy) || (!value && falsy);
      return filter.op === "eq" ? equals : !equals;
    }
    return false;
  }
  const item = foldForQuery(String(value));
  const folded = foldForQuery(needle);
  switch (filter.op) {
    case "eq":
      return item === folded;
    case "ne":
      return item !== folded;
    case "gt": {
      // Numeric-first: text-typed numbers («۸» as a string) compare
      // numerically with Persian-digit needles (the E2E-found case).
      const a = parseLooseNumber(String(value));
      const b = parseLooseNumber(needle);
      if (a !== null && b !== null) {
        return a > b;
      }
      return String(value) > needle;
    }
    case "lt": {
      const a = parseLooseNumber(String(value));
      const b = parseLooseNumber(needle);
      if (a !== null && b !== null) {
        return a < b;
      }
      return String(value) < needle;
    }
    case "contains":
      return item.includes(folded);
    case "startsWith":
      return item.startsWith(folded);
  }
}

/**
 * Compares two raw values for sorting: numeric when BOTH are numbers
 * (or numeric strings), codepoint order otherwise — always
 * deterministic, never locale-dependent.
 *
 * @param a - the first value.
 * @param b - the second value.
 * @returns the sign of a − b.
 */
function compareValues(a: PropertyValue, b: PropertyValue): number {
  const aNumber = typeof a === "number"
    ? a
    : typeof a === "string"
      ? parseLooseNumber(a)
      : null;
  const bNumber = typeof b === "number"
    ? b
    : typeof b === "string"
      ? parseLooseNumber(b)
      : null;
  if (aNumber !== null && bNumber !== null) {
    return aNumber - bNumber;
  }
  const aText = typeof a === "string" || typeof a === "number"
    ? String(a)
    : formatPropertyValue(a);
  const bText = typeof b === "string" || typeof b === "number"
    ? String(b)
    : formatPropertyValue(b);
  return aText < bText ? -1 : aText > bText ? 1 : 0;
}

/**
 * Formats a prop for a row's `sortValue` / `group` display.
 *
 * @param value - the raw value.
 * @returns the display string ("" for absent).
 */
function formatSortValue(value: PropertyValue | undefined): string {
  if (value === undefined) {
    return "";
  }
  return formatPropertyValue(value);
}

/**
 * Cleans a string list (tags/kinds): trimmed, de-duplicated, capped.
 *
 * @param raw - the unknown wire value.
 * @param maxItem - the per-item length cap.
 * @returns the clean list, or undefined when nothing survives.
 */
function cleanList(
  raw: unknown,
  maxItem: number,
): readonly string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const cleaned = item.trim().slice(0, maxItem);
    if (cleaned.length === 0 || seen.has(cleaned) || out.length >= LIST_MAX) {
      continue;
    }
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out.length === 0 ? undefined : out;
}

/**
 * Validates an unknown JSON blob into a {@link SceneQuerySpec} (the
 * persistence read path + the datahub `run` entry). Lenient by design
 * (§1.7.4 — the unknown-data law): garbage ENTRIES drop, a garbage
 * SHAPE returns null. A spec whose filters all drop is still valid (the
 * all-match query, capped).
 *
 * @param raw - the wire value.
 * @returns the validated spec, or null when the shape is wrong.
 */
export function normalizeSceneQuerySpec(
  raw: unknown,
): SceneQuerySpec | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;

  // Filters — drop invalid entries, cap at MAX_QUERY_FILTERS.
  const filters: QueryFilter[] = [];
  if (Array.isArray(record.filters)) {
    for (const entry of record.filters) {
      if (filters.length >= MAX_QUERY_FILTERS) {
        break;
      }
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const prop = (entry as Record<string, unknown>).prop;
      const op = (entry as Record<string, unknown>).op;
      const value = (entry as Record<string, unknown>).value;
      const cleanProp =
        typeof prop === "string" ? prop.trim().slice(0, 40) : "";
      const opValid =
        typeof op === "string" &&
        (QUERY_OPERATORS as readonly string[]).includes(op);
      if (
        cleanProp.length === 0 ||
        !opValid ||
        typeof value !== "string" ||
        value.length > FILTER_VALUE_MAX
      ) {
        continue;
      }
      filters.push({
        prop: cleanProp,
        op: op as QueryOperator,
        value,
      });
    }
  }

  // Limit — clamp to 1..200 (invalid → the default).
  const limitRaw = record.limit;
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.round(limitRaw), 1), QUERY_LIMIT_MAX)
      : QUERY_LIMIT_DEFAULT;

  // sortBy — {prop, dir} with a validated dir.
  let sortBy: QuerySort | undefined;
  const sortRaw = record.sortBy;
  if (
    typeof sortRaw === "object" &&
    sortRaw !== null &&
    !Array.isArray(sortRaw)
  ) {
    const prop = (sortRaw as Record<string, unknown>).prop;
    const dir = (sortRaw as Record<string, unknown>).dir;
    const cleanProp = typeof prop === "string" ? prop.trim().slice(0, 40) : "";
    if (
      cleanProp.length > 0 &&
      (dir === "asc" || dir === "desc")
    ) {
      sortBy = { prop: cleanProp, dir };
    }
  }

  // groupBy — a non-empty property name.
  const groupRaw = record.groupBy;
  const groupBy =
    typeof groupRaw === "string" && groupRaw.trim().length > 0
      ? groupRaw.trim().slice(0, 40)
      : undefined;

  // text / linksTo — trimmed, capped, empty drops.
  const textRaw = record.text;
  const text =
    typeof textRaw === "string" && textRaw.trim().length > 0
      ? textRaw.trim().slice(0, FILTER_VALUE_MAX)
      : undefined;
  const linksRaw = record.linksTo;
  const linksTo =
    typeof linksRaw === "string" && linksRaw.trim().length > 0
      ? linksRaw.trim().slice(0, FILTER_VALUE_MAX)
      : undefined;

  return {
    filters,
    tagsAll: cleanList(record.tagsAll, 32),
    tagsAny: cleanList(record.tagsAny, 32),
    text,
    linksTo,
    kinds: cleanList(record.kinds, 24)?.map((kind) => kind.toLowerCase()),
    limit,
    sortBy,
    groupBy,
  };
}

/**
 * Runs one structured query against a scene + knowledge snapshot.
 *
 * @param scene - the scene to scan (insertion order = the base order).
 * @param index - the knowledge index (titles, tags, outgoing links).
 * @param spec - the validated query specification.
 * @param excludeIds - ids to skip (the R12.2 recursion guard — a filter
 *        card never matches itself).
 * @returns the rows (capped, sorted, grouped) + the pre-limit total.
 */
export function runSceneQuery(
  scene: Scene,
  index: KnowledgeIndex,
  spec: SceneQuerySpec,
  excludeIds?: readonly string[],
): SceneQueryResult {
  const excluded =
    excludeIds !== undefined && excludeIds.length > 0
      ? new Set(excludeIds)
      : null;
  const foldedTagsAll = spec.tagsAll?.map((tag) =>
    normaliseKnowledgeKey(tag),
  );
  const foldedTagsAny = spec.tagsAny?.map((tag) =>
    normaliseKnowledgeKey(tag),
  );
  const linksToKey =
    spec.linksTo !== undefined ? normaliseKnowledgeKey(spec.linksTo) : null;
  const foldedText = spec.text !== undefined ? foldForQuery(spec.text) : null;
  const kinds =
    spec.kinds !== undefined && spec.kinds.length > 0
      ? new Set(spec.kinds)
      : null;

  interface Match {
    readonly object: SceneObjectData;
    readonly sortRaw: PropertyValue | undefined;
    readonly groupValue: string | undefined;
  }
  const matches: Match[] = [];

  for (const object of scene.objects) {
    if (excluded?.has(object.id)) {
      continue;
    }
    if (kinds !== null && !kinds.has(object.kind)) {
      continue;
    }
    if (foldedTagsAll !== undefined) {
      const carried = new Set(index.objectTags.get(object.id) ?? []);
      if (foldedTagsAll.some((tag) => !carried.has(tag))) {
        continue;
      }
    }
    if (foldedTagsAny !== undefined) {
      const carried = new Set(index.objectTags.get(object.id) ?? []);
      if (!foldedTagsAny.some((tag) => carried.has(tag))) {
        continue;
      }
    }
    if (linksToKey !== null) {
      const outgoing = index.outgoing.get(object.id) ?? [];
      if (!outgoing.some((link) => link.key === linksToKey)) {
        continue;
      }
    }
    if (foldedText !== null && foldedText.length > 0) {
      const haystack = foldForQuery(searchableTextOf(object));
      if (!haystack.includes(foldedText)) {
        continue;
      }
    }
    let passes = true;
    for (const filter of spec.filters) {
      if (
        !valueMatchesFilter(
          resolvePropValue(object, index, filter.prop),
          filter,
        )
      ) {
        passes = false;
        break;
      }
    }
    if (!passes) {
      continue;
    }
    matches.push({
      object,
      sortRaw:
        spec.sortBy === undefined
          ? undefined
          : resolvePropValue(object, index, spec.sortBy.prop),
      groupValue:
        spec.groupBy === undefined
          ? undefined
          : formatSortValue(resolvePropValue(object, index, spec.groupBy)),
    });
  }

  // Sort — deterministic: value order, missing LAST, id as the tie-break.
  const direction = spec.sortBy?.dir === "desc" ? -1 : 1;
  const sorted = spec.sortBy === undefined
    ? matches
    : [...matches].sort((a, b) => {
        if (a.sortRaw === undefined && b.sortRaw === undefined) {
          return a.object.id < b.object.id ? -1 : 1;
        }
        if (a.sortRaw === undefined) {
          return 1; // (missing always last)
        }
        if (b.sortRaw === undefined) {
          return -1;
        }
        const by = compareValues(a.sortRaw, b.sortRaw) * direction;
        if (by !== 0) {
          return by;
        }
        return a.object.id < b.object.id ? -1 : 1;
      });

  // Groups — first-appearance order, pre-limit counts.
  const groups: SceneQueryGroup[] = [];
  if (spec.groupBy !== undefined) {
    const counts = new Map<string, number>();
    for (const match of sorted) {
      const key = match.groupValue ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    groups.push(
      ...[...counts.entries()].map(([value, count]) => ({ value, count })),
    );
  }

  const capped = sorted.slice(0, Math.max(1, Math.min(spec.limit, QUERY_LIMIT_MAX)));
  return {
    rows: capped.map((match) => ({
      objectId: match.object.id,
      title: index.objectTitle.get(match.object.id)?.display ?? "",
      sortValue: formatSortValue(match.sortRaw),
      group: match.groupValue,
    })),
    total: sorted.length,
    groups,
  };
}

/**
 * Resolves one display column value of an object (the card's + the
 * inspector's results tables): the formatted property value, or the
 * pseudo props' display (title/kind).
 *
 * @param object - the row's object.
 * @param index - the knowledge snapshot.
 * @param prop - the column's property name (or pseudo prop).
 * @returns the formatted value ("" when absent).
 */
export function queryColumnValue(
  object: SceneObjectData,
  index: KnowledgeIndex,
  prop: string,
): string {
  if (prop === QUERY_PSEUDO_TITLE) {
    return index.objectTitle.get(object.id)?.display ?? "";
  }
  if (prop === QUERY_PSEUDO_KIND) {
    return object.kind;
  }
  const value = object.properties?.[prop];
  return value === undefined ? "" : formatPropertyValue(value);
}
