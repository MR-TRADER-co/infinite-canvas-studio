/**
 * Structured search-filter tests (pack R11.9): the direct-scan tag and
 * property-equality chips over scene objects, including the filters-only
 * browse mode, plus the knowledge index's property-tags aggregation
 * (pack R11.4).
 */
import { describe, expect, it } from "vitest";
import type { SceneObjectData } from "@/core/model/SceneObject";
import {
  filtersActive,
  NO_SEARCH_FILTERS,
  objectHasTag,
  objectMatchesFilters,
  searchScene,
  type SceneSearchFilters,
} from "@/core/search/SceneSearch";
import { TAGS_PROPERTY } from "@/core/model/Properties";
import { buildKnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";

/** Builds a minimal sticky-like object for the scans. */
function stickyOf(
  id: string,
  fields: {
    text?: string;
    properties?: Record<string, unknown>;
  } = {},
): SceneObjectData {
  return {
    id,
    kind: "stickyNote",
    position: { x: 0, y: 0 },
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    width: 100,
    height: 100,
    text: fields.text ?? "",
    ...(fields.properties === undefined
      ? {}
      : { properties: fields.properties }),
  } as SceneObjectData;
}

describe("objectHasTag (text #tags + the properties tags field)", () => {
  it("matches text hashtags with Persian folding", () => {
    const object = stickyOf("a", { text: "جلسهٔ فردا #مهم است" });
    expect(objectHasTag(object, "مهم")).toBe(true);
    expect(objectHasTag(object, "غیرمهم")).toBe(false);
  });

  it("matches the structured tags property on ANY kind", () => {
    const object = stickyOf("b", {
      properties: { [TAGS_PROPERTY]: ["فوری"] },
    });
    expect(objectHasTag(object, "فوری")).toBe(true);
    expect(objectHasTag(object, "مهم")).toBe(false);
  });

  it("rejects empty tags", () => {
    const object = stickyOf("c", { text: "plain" });
    expect(objectHasTag(object, "  ")).toBe(false);
  });
});

describe("objectMatchesFilters (the R11.9 direct scan)", () => {
  const a = stickyOf("a", {
    text: "#مهم",
    properties: { owner: "سارا", priority: 2 },
  });
  const b = stickyOf("b", {
    properties: { owner: "رضا", priority: 5, [TAGS_PROPERTY]: ["فوری"] },
  });
  const c = stickyOf("c", { text: "بدون ویژگی" });

  it("ANDs every active chip", () => {
    const filters: SceneSearchFilters = {
      tags: ["مهم"],
      properties: [{ name: "owner", value: "سارا" }],
    };
    expect(objectMatchesFilters(a, filters)).toBe(true);
    expect(objectMatchesFilters(b, filters)).toBe(false);
    expect(objectMatchesFilters(c, filters)).toBe(false);
  });

  it("matches property equality across value shapes", () => {
    expect(
      objectMatchesFilters(a, {
        tags: [],
        properties: [{ name: "priority", value: "2" }],
      }),
    ).toBe(true);
    expect(
      objectMatchesFilters(b, {
        tags: [],
        properties: [{ name: "owner", value: "سارا" }],
      }),
    ).toBe(false);
  });

  it("an empty filter set matches everything", () => {
    expect(objectMatchesFilters(a, NO_SEARCH_FILTERS)).toBe(true);
    expect(filtersActive(NO_SEARCH_FILTERS)).toBe(false);
    expect(filtersActive({ tags: ["x"], properties: [] })).toBe(true);
  });
});

describe("searchScene with filters", () => {
  const a = stickyOf("a", { text: "هدف نهایی #مهم", properties: { owner: "سارا" } });
  const b = stickyOf("b", { text: "هدف دوم", properties: { owner: "رضا" } });
  const objects = [a, b];

  it("narrows text matches by the chips (AND)", () => {
    const groups = searchScene(objects, {
      query: "هدف",
      scope: "all",
      filters: { tags: ["مهم"], properties: [] },
    });
    expect(groups.map((group) => group.object.id)).toEqual(["a"]);
  });

  it("filters ALONE browse: matching objects list with no query", () => {
    const groups = searchScene(objects, {
      query: "",
      scope: "all",
      filters: { tags: [], properties: [{ name: "owner", value: "سارا" }] },
    });
    expect(groups.map((group) => group.object.id)).toEqual(["a"]);
    // Every group carries at least one row so the UI renders it.
    expect(groups[0]?.matches.length).toBeGreaterThan(0);
  });

  it("hides objects failing the property equality", () => {
    const groups = searchScene(objects, {
      query: "",
      scope: "all",
      filters: { tags: [], properties: [{ name: "owner", value: "ناشناس" }] },
    });
    expect(groups).toEqual([]);
  });

  it("no query + no filters stays empty (the legacy behaviour)", () => {
    expect(searchScene(objects, { query: "", scope: "all" })).toEqual([]);
  });
});

describe("KnowledgeIndex property-tags aggregation (R11.4)", () => {
  it("folds the structured tags property into the tag index", () => {
    const index = buildKnowledgeIndex([
      stickyOf("a", { properties: { [TAGS_PROPERTY]: ["مهم", "فوری"] } }),
      stickyOf("b", { text: "یادداشت #مهم" }),
    ]);
    // Text tags collect in Pass 2, property tags in Pass 3 — the ids are
    // a set (order deterministic per pass, not per document order).
    const important = index.tags.get("مهم");
    expect(important?.objectIds).toEqual(["b", "a"]);
    expect(index.tags.get("فوری")?.objectIds).toEqual(["a"]);
    expect(index.objectTags.get("a")).toEqual(["مهم", "فوری"]);
  });

  it("merges text tags and property tags on the SAME object (dedup)", () => {
    const index = buildKnowledgeIndex([
      stickyOf("a", {
        text: "با #مهم",
        properties: { [TAGS_PROPERTY]: ["مهم"] },
      }),
    ]);
    expect(index.tags.get("مهم")?.objectIds).toEqual(["a"]);
    expect(index.objectTags.get("a")).toEqual(["مهم"]);
  });

  it("ignores non-array or empty tags properties", () => {
    const index = buildKnowledgeIndex([
      stickyOf("a", { properties: { [TAGS_PROPERTY]: [] } }),
    ]);
    expect(index.tags.size).toBe(0);
  });
});
