/**
 * The plugin marketplace catalog tests (the «فروشگاه افزونه‌ها» round):
 * entry projection + the curated category map, Persian-aware query
 * filtering, install-state merging, and the featured split.
 */
import { describe, expect, it } from "vitest";
import {
  CATALOG_SOURCES,
  CATEGORY_ORDER,
  entryFromManifest,
  filterEntries,
  mergeInstallStates,
  normaliseQueryText,
  splitFeatured,
  type CatalogEntry,
  type StatusLike,
} from "@/plugins/host/pluginCatalog";

/** A realistic manifest fixture (the real dailynotes shape). */
const DAILYNOTES_MANIFEST = {
  id: "dailynotes",
  name: "یادداشت روزانه (Daily Notes)",
  version: "1.0.0",
  permissions: ["storage", "datahub", "scene"],
  description: "ژورنال روزانهٔ جلالی روی بوم",
};

/** Builds a full catalog from the bundled-source ids + stub manifests. */
function fullCatalog(): CatalogEntry[] {
  return CATALOG_SOURCES.map(({ id, source }) =>
    entryFromManifest(
      id,
      id === "dailynotes"
        ? DAILYNOTES_MANIFEST
        : {
            id,
            name: `پلاگین ${id}`,
            version: "1.0.0",
            permissions: ["storage"],
            description: `توضیح ${id}`,
          },
      source,
    ),
  );
}

describe("pluginCatalog.entryFromManifest", () => {
  it("projects the manifest fields", () => {
    const entry = entryFromManifest(
      "dailynotes",
      DAILYNOTES_MANIFEST,
      "firstparty",
    );
    expect(entry.id).toBe("dailynotes");
    expect(entry.name).toBe("یادداشت روزانه (Daily Notes)");
    expect(entry.description).toBe("ژورنال روزانهٔ جلالی روی بوم");
    expect(entry.version).toBe("1.0.0");
    expect(entry.permissions).toEqual(["storage", "datahub", "scene"]);
    expect(entry.iconUrl).toBe("/plugins-firstparty/dailynotes/icon.svg");
    expect(entry.source).toBe("firstparty");
  });

  it("assigns the curated categories", () => {
    const byId = new Map(
      fullCatalog().map((entry) => [entry.id, entry] as const),
    );
    expect(byId.get("dailynotes")?.category).toBe("productivity");
    expect(byId.get("planner")?.category).toBe("productivity");
    expect(byId.get("calendar")?.category).toBe("knowledge");
    expect(byId.get("reporter")?.category).toBe("insight");
    expect(byId.get("ai-analyst")?.category).toBe("insight");
    expect(byId.get("sticky-shape-pack")?.category).toBe("sample");
  });

  it("marks exactly dailynotes as featured", () => {
    const featured = fullCatalog().filter((entry) => entry.featured);
    expect(featured.map((entry) => entry.id)).toEqual(["dailynotes"]);
  });

  it("samples point at the sample asset path", () => {
    const entry = entryFromManifest(
      "sticky-shape-pack",
      { name: "Pack" },
      "sample",
    );
    expect(entry.iconUrl).toBe("/plugins-sample/sticky-shape-pack/icon.svg");
  });

  it("degrades missing/invalid fields", () => {
    const entry = entryFromManifest("mystery", {}, "firstparty");
    expect(entry.name).toBe("mystery");
    expect(entry.version).toBe("1.0.0");
    expect(entry.description).toContain("توضیح");
    expect(entry.permissions).toEqual([]);
    // Unknown ids land in the sample category (never crash).
    expect(entry.category).toBe("sample");
    expect(entry.featured).toBe(false);
  });

  it("ignores non-string permissions entries", () => {
    const entry = entryFromManifest(
      "x",
      { permissions: ["storage", 42, null, "datahub"] },
      "firstparty",
    );
    expect(entry.permissions).toEqual(["storage", "datahub"]);
  });
});

describe("pluginCatalog.normaliseQueryText", () => {
  it("folds ZWNJ to a space and collapses whitespace", () => {
    expect(normaliseQueryText("یادداشت‌های\u200cروزانه")).toBe(
      "یادداشت های روزانه",
    );
  });

  it("maps Arabic Yeh/Kaf to Persian", () => {
    expect(normaliseQueryText("كتاب ي")).toBe("کتاب ی");
  });

  it("strips tashkeel + bidi marks and lowercases", () => {
    expect(normaliseQueryText("CaSE\u064b\u200f")).toBe("case");
  });
});

describe("pluginCatalog.filterEntries", () => {
  it("empty query + all = everything in order", () => {
    const catalog = fullCatalog();
    expect(filterEntries(catalog, { query: "", category: "all" })).toEqual(
      catalog,
    );
  });

  it("category chip narrows the catalog", () => {
    const insight = filterEntries(fullCatalog(), {
      query: "",
      category: "insight",
    });
    expect(insight.map((entry) => entry.id)).toEqual([
      "reporter",
      "ai-analyst",
    ]);
  });

  it("query matches name (ZWNJ-insensitive)", () => {
    const hits = filterEntries(fullCatalog(), {
      // The ZWNJ variant still matches the spaced name.
      query: "یادداشت\u200cروزانه",
      category: "all",
    });
    expect(hits.map((entry) => entry.id)).toContain("dailynotes");
  });

  it("query matches the latin id", () => {
    const hits = filterEntries(fullCatalog(), {
      query: "analyst",
      category: "all",
    });
    expect(hits.map((entry) => entry.id)).toEqual(["ai-analyst"]);
  });

  it("query + category compose (AND)", () => {
    const hits = filterEntries(fullCatalog(), {
      query: "پلاگین",
      category: "insight",
    });
    expect(hits.map((entry) => entry.id)).toEqual(["reporter", "ai-analyst"]);
    // The dailynotes-only description term finds nothing in the insight
    // category (AND, not OR).
    expect(
      filterEntries(fullCatalog(), { query: "ژورنال", category: "insight" }),
    ).toEqual([]);
    // …but finds the journal itself under «همه».
    expect(
      filterEntries(fullCatalog(), { query: "ژورنال", category: "all" }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["dailynotes"]);
  });

  it("no match → empty (not an error)", () => {
    expect(
      filterEntries(fullCatalog(), { query: "zzzz-ناموجود", category: "all" }),
    ).toEqual([]);
  });

  it("does not mutate the input", () => {
    const catalog = fullCatalog();
    const snapshot = [...catalog];
    filterEntries(catalog, { query: "پلاگین", category: "all" });
    expect(catalog).toEqual(snapshot);
  });
});

describe("pluginCatalog.mergeInstallStates", () => {
  it("absent when the manager has no row", () => {
    const cards = mergeInstallStates(fullCatalog(), []);
    expect(cards.every((card) => card.installState === "absent")).toBe(true);
  });

  it("running/stopped/error map from runtimeState", () => {
    const rows: StatusLike[] = [
      {
        record: { manifest: { id: "dailynotes" } },
        runtimeState: "running",
      },
      {
        record: { manifest: { id: "planner" } },
        runtimeState: "stopped",
      },
      {
        record: { manifest: { id: "reporter" } },
        runtimeState: "error",
      },
      {
        record: { manifest: { id: "calendar" } },
        runtimeState: "starting",
      },
      {
        record: { manifest: { id: "ai-analyst" } },
        runtimeState: "off",
      },
    ];
    const byId = new Map(
      mergeInstallStates(fullCatalog(), rows).map(
        (card) => [card.id, card.installState] as const,
      ),
    );
    expect(byId.get("dailynotes")).toBe("running");
    expect(byId.get("planner")).toBe("stopped");
    expect(byId.get("reporter")).toBe("error");
    // starting shows as running; off as stopped.
    expect(byId.get("calendar")).toBe("running");
    expect(byId.get("ai-analyst")).toBe("stopped");
    expect(byId.get("sticky-shape-pack")).toBe("absent");
  });

  it("keeps the catalog order + entries verbatim", () => {
    const catalog = fullCatalog();
    const cards = mergeInstallStates(catalog, []);
    expect(cards.map((card) => card.id)).toEqual(catalog.map((e) => e.id));
    expect(cards[0]?.name).toBe(catalog[0]?.name);
  });
});

describe("pluginCatalog.splitFeatured", () => {
  it("separates the featured card from the rest", () => {
    const cards = mergeInstallStates(fullCatalog(), []);
    const { featured, rest } = splitFeatured(cards);
    expect(featured?.id).toBe("dailynotes");
    expect(rest.some((card) => card.featured)).toBe(false);
    expect(rest).toHaveLength(cards.length - 1);
  });

  it("no featured (filtered out) → null + untouched rest", () => {
    const insight = filterEntries(fullCatalog(), {
      query: "",
      category: "insight",
    });
    const cards = mergeInstallStates(insight, []);
    const { featured, rest } = splitFeatured(cards);
    expect(featured).toBeNull();
    expect(rest).toEqual(cards);
  });
});

describe("pluginCatalog constants", () => {
  it("CATEGORY_ORDER has the four curated categories", () => {
    expect(CATEGORY_ORDER).toEqual([
      "productivity",
      "insight",
      "knowledge",
      "sample",
    ]);
  });

  it("every catalog source id is unique", () => {
    const ids = CATALOG_SOURCES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
