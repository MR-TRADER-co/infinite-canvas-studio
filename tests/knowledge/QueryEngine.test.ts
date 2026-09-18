/**
 * The structured scene-query engine tests (Knowledge Pack R12.1,
 * law §1.7.9): every operator over every wire type, the tag/text/link/
 * kind surfaces, sort/group/limit, determinism, the recursion guard
 * and the spec normaliser.
 */
import { describe, expect, it } from "vitest";
import { buildKnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import { Scene } from "@/core/model/Scene";
import { vec2 } from "@/core/geometry/Vec2";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import type { PropertyValue } from "@/core/model/Properties";
import {
  DEFAULT_SCENE_QUERY_SPEC,
  MAX_QUERY_FILTERS,
  QUERY_LIMIT_DEFAULT,
  QUERY_LIMIT_MAX,
  normalizeSceneQuerySpec,
  queryColumnValue,
  runSceneQuery,
} from "@/core/knowledge/QueryEngine";

/** Builds a text-box fixture with optional structured properties. */
function textBox(
  id: string,
  text: string,
  properties?: Record<string, PropertyValue>,
  name?: string,
): TextBoxObjectData {
  return {
    id,
    kind: "textBox",
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    width: 200,
    height: 60,
    text,
    doc: null,
    sizeMode: "fixed",
    fontSize: 20,
    color: "token://text",
    ...(properties === undefined ? {} : { properties }),
    ...(name === undefined ? {} : { name }),
  };
}

/** The R12.1 fixture family (Appendix G spirit): tasks with properties. */
function taskFixture() {
  const objects = [
    textBox(
      "t1",
      "طراحی رابط کاربری #طراحی",
      { وضعیت: "در انتظار", اولویت: 3, انجام: false, مهلت: "2026-09-10" },
      "کار اول",
    ),
    textBox(
      "t2",
      "بازبینی کد #طراحی",
      { وضعیت: "در حال انجام", اولویت: 8, انجام: false, مهلت: "2026-09-02" },
      "کار دوم",
    ),
    textBox(
      "t3",
      "آماده‌سازی انتشار",
      { وضعیت: "تمام‌شده", اولویت: 5, انجام: true, مهلت: "2026-08-28" },
      "کار سوم",
    ),
    textBox("note", "یادداشت آزاد بدون ویژگی"),
  ];
  const scene = new Scene();
  objects.forEach((object) => scene.add(object));
  return { scene, index: buildKnowledgeIndex(objects) };
}

describe("normalizeSceneQuerySpec (R12.1)", () => {
  it("accepts the minimal valid spec and defaults the limit", () => {
    const spec = normalizeSceneQuerySpec({ filters: [] });
    expect(spec).not.toBeNull();
    expect(spec?.filters).toEqual([]);
    expect(spec?.limit).toBe(QUERY_LIMIT_DEFAULT);
  });

  it("refuses non-object shapes", () => {
    expect(normalizeSceneQuerySpec(null)).toBeNull();
    expect(normalizeSceneQuerySpec("filters")).toBeNull();
    expect(normalizeSceneQuerySpec([1, 2])).toBeNull();
  });

  it("drops invalid filter entries and keeps valid ones", () => {
    const spec = normalizeSceneQuerySpec({
      filters: [
        { prop: "اولویت", op: "gt", value: "2" },
        { prop: "", op: "eq", value: "x" },
        { prop: "ok", op: "wildcard", value: "y" },
        { prop: "ok2", op: "eq", value: 7 },
        null,
      ],
    });
    expect(spec?.filters).toEqual([
      { prop: "اولویت", op: "gt", value: "2" },
    ]);
  });

  it("caps filters, clamps the limit and cleans the tag lists", () => {
    const many = Array.from({ length: MAX_QUERY_FILTERS + 5 }, (_, i) => ({
      prop: `p${i}`,
      op: "eq",
      value: "v",
    }));
    const spec = normalizeSceneQuerySpec({
      filters: many,
      limit: 5000,
      tagsAll: ["مهم", " ", "مهم", "x".repeat(60)],
      tagsAny: [],
    });
    expect(spec?.filters).toHaveLength(MAX_QUERY_FILTERS);
    expect(spec?.limit).toBe(QUERY_LIMIT_MAX);
    expect(spec?.tagsAll).toEqual(["مهم", "x".repeat(32)]);
    expect(spec?.tagsAny).toBeUndefined();
  });

  it("validates sortBy/groupBy and drops empty text", () => {
    const spec = normalizeSceneQuerySpec({
      sortBy: { prop: "اولویت", dir: "down" },
      groupBy: "  ",
      text: "   ",
      linksTo: "هدف",
    });
    expect(spec?.sortBy).toBeUndefined();
    expect(spec?.groupBy).toBeUndefined();
    expect(spec?.text).toBeUndefined();
    expect(spec?.linksTo).toBe("هدف");
  });
});

describe("runSceneQuery — filters (R12.1)", () => {
  it("eq matches folded Persian strings", () => {
    const { scene, index } = taskFixture();
    const result = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "وضعیت", op: "eq", value: "در انتظار" }],
    });
    expect(result.rows.map((row) => row.objectId)).toEqual(["t1"]);
  });

  it("eq over a tags value matches when ANY item equals", () => {
    const objects = [
      textBox("a", "اول", { tags: ["طراحی", "جلسه"] }),
      textBox("b", "دوم", { tags: ["تست"] }),
    ];
    const index = buildKnowledgeIndex(objects);
    const scene = new Scene();
    objects.forEach((object) => scene.add(object));
    const result = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "tags", op: "eq", value: "جلسه" }],
    });
    expect(result.rows.map((row) => row.objectId)).toEqual(["a"]);
  });

  it("ne treats a missing value as not-equal (and empty needle = exists)", () => {
    const { scene, index } = taskFixture();
    const missing = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "وضعیت", op: "ne", value: "تمام‌شده" }],
    });
    // note has NO وضعیت (missing → ne passes); t1/t2 differ from the value.
    expect(missing.rows.map((row) => row.objectId)).toEqual(["t1", "t2", "note"]);

    const exists = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "وضعیت", op: "ne", value: "" }],
    });
    expect(exists.rows.map((row) => row.objectId)).toEqual(["t1", "t2", "t3"]);
  });

  it("gt/lt compare numbers (with Persian digits) and ISO dates", () => {
    const { scene, index } = taskFixture();
    const high = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "اولویت", op: "gt", value: "۴" }],
    });
    expect(high.rows.map((row) => row.objectId).sort()).toEqual(["t2", "t3"]);

    const early = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "مهلت", op: "lt", value: "2026-09-01" }],
    });
    expect(early.rows.map((row) => row.objectId)).toEqual(["t3"]);
  });

  it("gt/lt compare TEXT-TYPED numbers numerically (the E2E-found case)", () => {
    // The inspector's add-property flow defaults to the TEXT type, so a
    // «اولویت» property can hold the STRING "8" — a Persian-digit
    // needle must still compare numerically, never codepoint-wise.
    const objects = [
      textBox("a", "اول", { اولویت: "3" }),
      textBox("b", "دوم", { اولویت: "8" }),
      textBox("c", "سوم", { اولویت: "5" }),
    ];
    const index = buildKnowledgeIndex(objects);
    const scene = new Scene();
    objects.forEach((object) => scene.add(object));
    const high = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "اولویت", op: "gt", value: "۴" }],
    });
    expect(high.rows.map((row) => row.objectId).sort()).toEqual(["b", "c"]);
    const low = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "اولویت", op: "lt", value: "۵" }],
    });
    expect(low.rows.map((row) => row.objectId)).toEqual(["a"]);
  });

  it("eq over booleans accepts the truthy/falsy spellings", () => {
    const { scene, index } = taskFixture();
    const done = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "انجام", op: "eq", value: "بله" }],
    });
    expect(done.rows.map((row) => row.objectId)).toEqual(["t3"]);
    const notDone = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "انجام", op: "eq", value: "خیر" }],
    });
    expect(notDone.rows.map((row) => row.objectId).sort()).toEqual(["t1", "t2"]);
  });

  it("contains/startsWith fold over Persian keyboard drift", () => {
    const objects = [
      textBox("a", "یادداشت", { وضعیت: "در حال انجام" }),
      textBox("b", "دیگری", { وضعیت: "در انتظار بررسی" }),
    ];
    const index = buildKnowledgeIndex(objects);
    const scene = new Scene();
    objects.forEach((object) => scene.add(object));
    const contains = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "وضعیت", op: "contains", value: "انجام" }],
    });
    expect(contains.rows.map((row) => row.objectId)).toEqual(["a"]);
    const starts = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "وضعیت", op: "startsWith", value: "در حال" }],
    });
    expect(starts.rows.map((row) => row.objectId)).toEqual(["a"]);
  });

  it("the title pseudo-prop filters by knowledge title", () => {
    const { scene, index } = taskFixture();
    const result = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "title", op: "contains", value: "کار" }],
    });
    expect(result.rows.map((row) => row.objectId).sort()).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("the kind pseudo-prop filters by object kind", () => {
    const { scene, index } = taskFixture();
    const result = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [{ prop: "kind", op: "eq", value: "textBox" }],
    });
    expect(result.total).toBe(4);
  });

  it("multiple filters AND together", () => {
    const { scene, index } = taskFixture();
    const result = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      filters: [
        { prop: "وضعیت", op: "ne", value: "تمام‌شده" },
        { prop: "اولویت", op: "gt", value: "4" },
      ],
    });
    expect(result.rows.map((row) => row.objectId)).toEqual(["t2"]);
  });
});

describe("runSceneQuery — tags / text / links / kinds", () => {
  it("tagsAll requires every folded tag; tagsAny at least one", () => {
    const objects = [
      textBox("a", "یادداشت #مهم #فوری"),
      textBox("b", "یادداشت #مهم"),
      textBox("c", "یادداشت #عادی"),
    ];
    const index = buildKnowledgeIndex(objects);
    const scene = new Scene();
    objects.forEach((object) => scene.add(object));
    const all = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      tagsAll: ["مهم", "فوری"],
    });
    expect(all.rows.map((row) => row.objectId)).toEqual(["a"]);
    const any = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      tagsAny: ["فوری", "عادی"],
    });
    expect(any.rows.map((row) => row.objectId).sort()).toEqual(["a", "c"]);
  });

  it("the structured tags property folds into the same index surface", () => {
    const objects = [
      textBox("a", "بدون هشتگ متن", { tags: ["مهم"] }),
      textBox("b", "با #مهم در متن"),
    ];
    const index = buildKnowledgeIndex(objects);
    const scene = new Scene();
    objects.forEach((object) => scene.add(object));
    const result = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      tagsAll: ["مهم"],
    });
    expect(result.rows.map((row) => row.objectId).sort()).toEqual(["a", "b"]);
  });

  it("text is a folded substring over the searchable text", () => {
    const { scene, index } = taskFixture();
    const result = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      text: "انتشار",
    });
    expect(result.rows.map((row) => row.objectId)).toEqual(["t3"]);
  });

  it("linksTo matches objects whose outgoing links hit the title", () => {
    const objects = [
      textBox("target", "محتوای هدف", undefined, "هدف مقدس"),
      textBox("a", "پیوند به [[هدف مقدس]]"),
      textBox("b", "بدون پیوند"),
    ];
    const index = buildKnowledgeIndex(objects);
    const scene = new Scene();
    objects.forEach((object) => scene.add(object));
    const result = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      linksTo: "هدف مقدس",
    });
    expect(result.rows.map((row) => row.objectId)).toEqual(["a"]);
  });

  it("kinds restrict the scan set", () => {
    const { scene, index } = taskFixture();
    const result = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      kinds: ["stickyNote"],
    });
    expect(result.total).toBe(0);
  });

  it("excludeIds is the recursion guard", () => {
    const { scene, index } = taskFixture();
    const result = runSceneQuery(scene, index, DEFAULT_SCENE_QUERY_SPEC, [
      "t1",
      "t2",
    ]);
    expect(result.rows.map((row) => row.objectId)).toEqual(["t3", "note"]);
  });
});

describe("runSceneQuery — sort / group / limit", () => {
  it("sortBy numbers asc and desc, missing values always last", () => {
    const { scene, index } = taskFixture();
    const asc = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      sortBy: { prop: "اولویت", dir: "asc" },
    });
    expect(asc.rows.map((row) => row.objectId)).toEqual([
      "t1",
      "t3",
      "t2",
      "note",
    ]);
    expect(asc.rows.map((row) => row.sortValue)).toEqual([
      "3",
      "5",
      "8",
      "",
    ]);
    const desc = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      sortBy: { prop: "اولویت", dir: "desc" },
    });
    expect(desc.rows.map((row) => row.objectId)).toEqual([
      "t2",
      "t3",
      "t1",
      "note",
    ]);
  });

  it("sortBy is deterministic (the id tie-break)", () => {
    const objects = [
      textBox("b", "y", { وضعیت: "یک" }),
      textBox("a", "x", { وضعیت: "یک" }),
      textBox("c", "z", { وضعیت: "یک" }),
    ];
    const index = buildKnowledgeIndex(objects);
    const scene = new Scene();
    objects.forEach((object) => scene.add(object));
    const first = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      sortBy: { prop: "وضعیت", dir: "asc" },
    });
    const second = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      sortBy: { prop: "وضعیت", dir: "asc" },
    });
    expect(first.rows.map((row) => row.objectId)).toEqual(["a", "b", "c"]);
    expect(second).toEqual(first);
  });

  it("groupBy buckets rows with formatted values + counts", () => {
    const { scene, index } = taskFixture();
    const result = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      groupBy: "انجام",
      sortBy: { prop: "title", dir: "asc" },
    });
    // t3 = true (✓ via formatPropertyValue), then the ungrouped note.
    expect(result.groups).toEqual([
      { value: "✗", count: 2 },
      { value: "✓", count: 1 },
      { value: "", count: 1 },
    ]);
    const t3 = result.rows.find((row) => row.objectId === "t3");
    expect(t3?.group).toBe("✓");
  });

  it("limit caps rows while total reports the full match count", () => {
    const { scene, index } = taskFixture();
    const result = runSceneQuery(scene, index, {
      ...DEFAULT_SCENE_QUERY_SPEC,
      limit: 2,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(4);
  });
});

describe("queryColumnValue (R12.2)", () => {
  it("formats properties, the title pseudo prop and missing values", () => {
    const objects = [textBox("t1", "متن", { اولویت: 7 }, "عنوان اصلی")];
    const index = buildKnowledgeIndex(objects);
    expect(queryColumnValue(objects[0]!, index, "اولویت")).toBe("7");
    expect(queryColumnValue(objects[0]!, index, "title")).toBe("عنوان اصلی");
    expect(queryColumnValue(objects[0]!, index, "نبود")).toBe("");
  });
});
