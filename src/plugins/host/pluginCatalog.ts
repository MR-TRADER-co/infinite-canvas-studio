/**
 * The plugin marketplace catalog (the «فروشگاه افزونه‌ها» round).
 *
 * Pure, side-effect-free catalog logic: the known bundled sources (the
 * five first-party plugins + the official sample), manifest → entry
 * projection with the curated category map, query/category filtering with
 * Persian text normalisation, and the merge with the LIVE install states
 * from the LifecycleManager (not installed / running / stopped / error).
 *
 * The dialog fetches the manifests (offline public assets) and owns the
 * consent + install flow; everything decided here is deterministic and
 * unit-tested (tests/plugins/marketplaceCatalog.test.ts).
 */

/** The curated marketplace categories (fa labels live in i18n). */
export type CatalogCategory =
  | "productivity"
  | "insight"
  | "knowledge"
  | "sample";

/** Where a catalog entry's package can be fetched from. */
export type CatalogSource = "firstparty" | "sample";

/** One marketplace catalog entry (projected from a plugin manifest). */
export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly permissions: readonly string[];
  readonly category: CatalogCategory;
  readonly source: CatalogSource;
  /** The public-asset icon URL (fetched for the card tile). */
  readonly iconUrl: string;
  /** Curated: the editor's pick shown as the featured banner. */
  readonly featured: boolean;
}

/** The live install state of one catalog entry. */
export type InstallState = "absent" | "running" | "stopped" | "error";

/** A catalog entry merged with its live install state (a market card). */
export interface MarketCard extends CatalogEntry {
  readonly installState: InstallState;
}

/** The curated category per bundled plugin id. */
const CATEGORY_BY_ID: Readonly<Record<string, CatalogCategory>> = {
  calendar: "knowledge",
  dailynotes: "productivity",
  planner: "productivity",
  reporter: "insight",
  "ai-analyst": "insight",
  "sticky-shape-pack": "sample",
};

/** The featured plugin id (the editor's pick banner). */
const FEATURED_ID = "dailynotes";

/** Every bundled catalog source, in curated display order. */
export const CATALOG_SOURCES: readonly {
  readonly id: string;
  readonly source: CatalogSource;
}[] = [
  { id: "dailynotes", source: "firstparty" },
  { id: "planner", source: "firstparty" },
  { id: "calendar", source: "firstparty" },
  { id: "reporter", source: "firstparty" },
  { id: "ai-analyst", source: "firstparty" },
  { id: "sticky-shape-pack", source: "sample" },
] as const;

/** The filter chip categories (the curated order in the UI). */
export const CATEGORY_ORDER: readonly CatalogCategory[] = [
  "productivity",
  "insight",
  "knowledge",
  "sample",
] as const;

/**
 * Projects one fetched manifest into a catalog entry.
 *
 * @param id - the plugin id (the catalog source id).
 * @param manifest - the parsed manifest value (loose — validated lazily).
 * @param source - where the package fetches from.
 * @returns the catalog entry; unknown ids land in «نمونه و آموزش».
 */
export function entryFromManifest(
  id: string,
  manifest: unknown,
  source: CatalogSource,
): CatalogEntry {
  const record = (manifest ?? {}) as {
    name?: unknown;
    description?: unknown;
    version?: unknown;
    permissions?: unknown;
  };
  const permissions = Array.isArray(record.permissions)
    ? record.permissions.filter(
        (permission): permission is string => typeof permission === "string",
      )
    : [];
  return {
    id,
    name: typeof record.name === "string" ? record.name : id,
    description:
      typeof record.description === "string"
        ? record.description
        : "توضیحاتی برای این افزونه ثبت نشده است.",
    version: typeof record.version === "string" ? record.version : "1.0.0",
    permissions,
    category: CATEGORY_BY_ID[id] ?? "sample",
    source,
    iconUrl:
      source === "firstparty"
        ? `/plugins-firstparty/${id}/icon.svg`
        : `/plugins-sample/${id}/icon.svg`,
    featured: id === FEATURED_ID,
  };
}

/**
 * Normalises Persian/English query text for matching: strips the ZWNJ,
 * Arabic Yeh/Kaf variants → Persian, tashkeel, and folds whitespace.
 *
 * @param text - the raw query or field text.
 * @returns the normalised form.
 */
export function normaliseQueryText(text: string): string {
  return text
    .replace(/\u200c/g, " ")
    .replace(/[\u0640\u064b-\u0652\u0670]/g, "")
    .replace(/\u064a/g, "\u06cc")
    .replace(/\u0643/g, "\u06a9")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The filter passed to {@link filterEntries}. */
export interface CatalogFilter {
  /** The free-text query (matches name, description, and id). */
  readonly query: string;
  /** The active category chip; `"all"` disables the category filter. */
  readonly category: CatalogCategory | "all";
}

/**
 * Filters catalog entries by the query + category chip.
 *
 * @param entries - the full catalog.
 * @param filter - the active filter.
 * @returns the filtered entries (stable input order).
 */
export function filterEntries(
  entries: readonly CatalogEntry[],
  filter: CatalogFilter,
): CatalogEntry[] {
  const query = normaliseQueryText(filter.query);
  const wantCategory = filter.category !== "all";
  return entries.filter((entry) => {
    if (wantCategory && entry.category !== filter.category) {
      return false;
    }
    if (query.length === 0) {
      return true;
    }
    const haystack = normaliseQueryText(
      `${entry.name} ${entry.description} ${entry.id}`,
    );
    return haystack.includes(query);
  });
}

/** The shape the merge expects from the manager's `listStatus()`. */
export interface StatusLike {
  readonly record: {
    readonly manifest: { readonly id: string };
  };
  readonly runtimeState: "off" | "starting" | "running" | "stopped" | "error";
}

/**
 * Merges the catalog with the live install rows.
 *
 * @param entries - the full catalog.
 * @param rows - `LifecycleManager.listStatus()` (any superset shape).
 * @returns the market cards (stable catalog order).
 */
export function mergeInstallStates(
  entries: readonly CatalogEntry[],
  rows: readonly StatusLike[],
): MarketCard[] {
  const stateById = new Map<string, InstallState>();
  for (const row of rows) {
    const state: InstallState =
      row.runtimeState === "running"
        ? "running"
        : row.runtimeState === "error"
          ? "error"
          : row.runtimeState === "starting"
            ? "running"
            : "stopped";
    stateById.set(row.record.manifest.id, state);
  }
  return entries.map((entry) => ({
    ...entry,
    installState: stateById.get(entry.id) ?? "absent",
  }));
}

/**
 * Splits the filtered cards into the featured banner + the grid.
 *
 * @param cards - the filtered market cards.
 * @returns the featured card (when it survived the filter) + the rest.
 */
export function splitFeatured(
  cards: readonly MarketCard[],
): {
  readonly featured: MarketCard | null;
  readonly rest: readonly MarketCard[];
} {
  const index = cards.findIndex((card) => card.featured);
  if (index === -1) {
    return { featured: null, rest: cards };
  }
  return {
    featured: cards[index] as MarketCard,
    rest: [...cards.slice(0, index), ...cards.slice(index + 1)],
  };
}
