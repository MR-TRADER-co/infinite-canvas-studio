import { describe, expect, it } from "vitest";
import {
  detectOpenWikiQuery,
  rankWikiSuggestions,
  shouldOfferCreateNew,
  WIKI_SUGGESTION_LIMIT,
} from "@/text/editor/wikiAutocomplete";

describe("detectOpenWikiQuery", () => {
  it("returns null when no [[ was typed", () => {
    expect(detectOpenWikiQuery("سلام دنیا")).toBeNull();
    expect(detectOpenWikiQuery("متن [ تنها ] با براکت تکی")).toBeNull();
    expect(detectOpenWikiQuery("")).toBeNull();
  });

  it("returns null when the last [[ span is closed", () => {
    expect(detectOpenWikiQuery("[[هدف نهایی]]")).toBeNull();
    expect(detectOpenWikiQuery("پیش [[الف]] و [[ب]] بعد")).toBeNull();
    expect(detectOpenWikiQuery("پیش [[الف]] متن بیشتر")).toBeNull();
  });

  it("detects an open span with its start offset and query", () => {
    const open = detectOpenWikiQuery("رجوع به [[هت");
    expect(open).not.toBeNull();
    expect(open?.start).toBe(8);
    expect(open?.query).toBe("هت");
  });

  it("treats bare [[ as open with an empty query", () => {
    const open = detectOpenWikiQuery("رجوع به [[");
    expect(open).not.toBeNull();
    expect(open?.query).toBe("");
    expect(open?.start).toBe(8);
  });

  it("uses the LAST [[ when several are open (grammar-consistent)", () => {
    const open = detectOpenWikiQuery("[[اول [[دوم");
    expect(open?.start).toBe(6);
    expect(open?.query).toBe("دوم");
  });

  it("rejects queries that cross a newline (block boundary)", () => {
    expect(detectOpenWikiQuery("[[خط اول\nخط دوم")).toBeNull();
  });

  it("rejects oversized queries (paste-blob guard)", () => {
    expect(detectOpenWikiQuery(`[[${"الف".repeat(60)}`)).toBeNull();
  });
});

describe("rankWikiSuggestions", () => {
  const titles = [
    "هدف نهایی",
    "هدف میانی",
    "یادداشت جلسه",
    "هدف‌ها",
    "کتابخانه",
  ];

  it("ranks startsWith matches before contains matches", () => {
    expect(rankWikiSuggestions("هدف", titles)).toEqual([
      "هدف نهایی",
      "هدف میانی",
      "هدف‌ها",
    ]);
  });

  it("keeps document order inside each bucket", () => {
    const ranked = rankWikiSuggestions("هدف", [
      "زیرهدف دوم",
      "هدف",
      "زیرهدف اول",
    ]);
    expect(ranked).toEqual(["هدف", "زیرهدف دوم", "زیرهدف اول"]);
  });

  it("folds Persian/Arabic keyboard drift and case", () => {
    // Arabic yeh/kaf + Latin case must still match (normaliseKnowledgeKey).
    expect(rankWikiSuggestions("هدف", titles)).toContain("هدف نهایی");
    expect(rankWikiSuggestions("GOAL", ["Goal", "Other"])).toEqual(["Goal"]);
  });

  it("returns the first titles in order for an empty query", () => {
    expect(rankWikiSuggestions("", titles)).toEqual([
      "هدف نهایی",
      "هدف میانی",
      "یادداشت جلسه",
      "هدف‌ها",
      "کتابخانه",
    ]);
  });

  it("caps the rows at the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => `عنوان ${i}`);
    expect(rankWikiSuggestions("", many).length).toBe(WIKI_SUGGESTION_LIMIT);
  });

  it("returns nothing for a query with no matches", () => {
    expect(rankWikiSuggestions("zzz", titles)).toEqual([]);
  });
});

describe("shouldOfferCreateNew", () => {
  it("offers creation only for non-empty queries", () => {
    expect(shouldOfferCreateNew("", ["هدف"])).toBe(false);
  });

  it("refuses creation when an exact (normalised) title exists", () => {
    expect(shouldOfferCreateNew("هدف نهایي", ["هدف نهایی"])).toBe(false);
    // Arabic yeh folds onto the Persian title — same key.
    expect(shouldOfferCreateNew("هدف نهایي", ["هدف نهایی"])).toBe(false);
  });

  it("offers creation for unknown titles (the dangling-link magic)", () => {
    expect(shouldOfferCreateNew("مقاله بعدی", ["کتابخانه"])).toBe(true);
  });
});
