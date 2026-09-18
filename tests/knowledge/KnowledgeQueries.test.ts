/**
 * Live-query engine tests (R15.2): the four query kinds over an index
 * built by `buildKnowledgeIndex` — backlinks (with snippet + dedupe),
 * tag membership, broken links (with the missing title as detail) and
 * the orphan islands rule.
 */
import { describe, expect, it } from "vitest";
import { buildKnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import { runKnowledgeQuery } from "@/core/knowledge/KnowledgeQueries";
import { vec2 } from "@/core/geometry/Vec2";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";

/** Builds a plain-text text-box fixture. */
function textBox(id: string, text: string, name?: string): TextBoxObjectData {
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
    ...(name === undefined ? {} : { name }),
  };
}

describe("KnowledgeQueries (R15.2)", () => {
  it("backlinks: lists every source linking the target, with snippets, deduped", () => {
    const index = buildKnowledgeIndex([
      textBox("goal", "محتوای هدف", "هدف نهایی"),
      textBox("a", "رجوع به [[هدف نهایی]] در متن"),
      textBox("b", "باز هم [[هدف‌ نهایی]] با نیم‌فاصله"),
      textBox("c", "بدون پیوند"),
    ]);
    const result = runKnowledgeQuery(index, {
      type: "backlinks",
      target: "هدف نهایی",
    });
    expect(result.missingTarget).toBe(false);
    expect(result.total).toBe(2);
    const ids = result.rows.map((row) => row.objectId);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    // Persian/Arabic folding: «هدف‌ نهایی» (ZWNJ) matched «هدف نهایی».
    const rowB = result.rows.find((row) => row.objectId === "b");
    // The source title is its first line with the wiki markup stripped.
    expect(rowB?.title).toBe("باز هم با نیم‌فاصله");
    expect(rowB?.snippet).toContain("هدف");
  });

  it("backlinks: a missing target reports missingTarget (not a crash)", () => {
    const index = buildKnowledgeIndex([textBox("a", "فقط [[گمشده]]")]);
    const result = runKnowledgeQuery(index, {
      type: "backlinks",
      target: "چیزی که نیست",
    });
    expect(result.missingTarget).toBe(true);
    expect(result.rows).toHaveLength(0);
    // An empty target is missing too.
    expect(
      runKnowledgeQuery(index, { type: "backlinks", target: "  " })
        .missingTarget,
    ).toBe(true);
  });

  it("tag: lists every object carrying the tag", () => {
    const index = buildKnowledgeIndex([
      textBox("a", "یادداشت #مهم روز"),
      textBox("b", "دیگری با #مهم و #عادی"),
      textBox("c", "بدون برچسب"),
    ]);
    const result = runKnowledgeQuery(index, { type: "tag", target: "مهم" });
    expect(result.missingTarget).toBe(false);
    expect(result.total).toBe(2);
    expect(result.rows.map((row) => row.objectId).sort()).toEqual(["a", "b"]);
    expect(
      runKnowledgeQuery(index, { type: "tag", target: "نبود" }).missingTarget,
    ).toBe(true);
  });

  it("broken: one row per reference, detail = the missing title", () => {
    const index = buildKnowledgeIndex([
      textBox("a", "برو به [[الف گمشده]]"),
      textBox("b", "هم [[الف گمشده]] هم [[ب گمشده]]"),
    ]);
    const result = runKnowledgeQuery(index, { type: "broken", target: "" });
    expect(result.total).toBe(3);
    const details = result.rows.map((row) => row.detail);
    expect(details).toEqual(["الف گمشده", "الف گمشده", "ب گمشده"]);
    // Every row flies to its SOURCE (the only real object).
    expect(result.rows.every((row) => row.objectId !== null)).toBe(true);
    expect(result.rows[0]?.objectId).toBe("a");
  });

  it("orphans: only titled objects with no links, no backlinks and no tags", () => {
    const index = buildKnowledgeIndex([
      textBox("island", "جزیرهٔ تنها"), // orphan
      textBox("linked", "پیوند به [[هدف]]", "منبع"), // has outgoing (broken)
      textBox("goal", "محتوا", "هدف"), // has a backlink
      textBox("tagged", "برچسب‌دار #مهم"), // has a tag (its first line title)
    ]);
    const result = runKnowledgeQuery(index, { type: "orphans", target: "" });
    expect(result.total).toBe(1);
    expect(result.rows[0]?.objectId).toBe("island");
    expect(result.rows[0]?.title).toBe("جزیرهٔ تنها");
  });

  it("an empty index answers every query without throwing", () => {
    const index = buildKnowledgeIndex([]);
    expect(runKnowledgeQuery(index, { type: "broken", target: "" }).total).toBe(0);
    expect(runKnowledgeQuery(index, { type: "orphans", target: "" }).total).toBe(0);
    expect(
      runKnowledgeQuery(index, { type: "backlinks", target: "هدف" })
        .missingTarget,
    ).toBe(true);
    expect(
      runKnowledgeQuery(index, { type: "tag", target: "مهم" }).missingTarget,
    ).toBe(true);
  });
});
