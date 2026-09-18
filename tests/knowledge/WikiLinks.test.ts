/**
 * Wiki-link + tag parsing tests (Knowledge Pack, pack-Phase-11
 * rebuild): the `[[عنوان]]` grammar, the `#tag` grammar and the
 * Persian/Arabic key normalisation they share.
 */
import { describe, expect, it } from "vitest";
import {
  normaliseKnowledgeKey,
  parseWikiLinks,
  parseWikiTags,
  snippetAroundSpan,
} from "@/core/knowledge/WikiLinks";

describe("normaliseKnowledgeKey", () => {
  it("folds Arabic yeh/kaf to Persian (keyboard drift)", () => {
    expect(normaliseKnowledgeKey("كده")).toBe(normaliseKnowledgeKey("کده"));
    expect(normaliseKnowledgeKey("علي")).toBe(normaliseKnowledgeKey("علی"));
    expect(normaliseKnowledgeKey("علي")).not.toBe("علي");
  });

  it("drops ZWNJ so «می‌شود» and «میشود» match", () => {
    expect(normaliseKnowledgeKey("می\u200Cشود")).toBe(
      normaliseKnowledgeKey("میشود"),
    );
  });

  it("collapses whitespace runs and trims", () => {
    expect(normaliseKnowledgeKey("  طرح   بزرگ  ")).toBe(
      normaliseKnowledgeKey("طرح بزرگ"),
    );
  });

  it("casefolds latin keys", () => {
    expect(normaliseKnowledgeKey("RoadMap")).toBe("roadmap");
  });

  it("returns empty for whitespace-only input", () => {
    expect(normaliseKnowledgeKey("   ")).toBe("");
    expect(normaliseKnowledgeKey("\u200C\u200C")).toBe("");
  });
});

describe("parseWikiLinks", () => {
  it("extracts a single link with its span index", () => {
    const refs = parseWikiLinks("پیش از این [[طرح بزرگ]] پس از این");
    expect(refs.length).toBe(1);
    expect(refs[0]?.display).toBe("طرح بزرگ");
    expect(refs[0]?.key).toBe(normaliseKnowledgeKey("طرح بزرگ"));
    expect(refs[0]?.index).toBe(11);
  });

  it("extracts multiple links in document order", () => {
    const refs = parseWikiLinks("[[یک]] وسط [[دو]] پایان");
    expect(refs.map((ref) => ref.display)).toEqual(["یک", "دو"]);
  });

  it("skips empty and whitespace-only titles", () => {
    expect(parseWikiLinks("[[]] و [[   ]]")).toEqual([]);
  });

  it("does not match nested brackets (ends at the first ]])", () => {
    const refs = parseWikiLinks("[[اینجا ] نه]]");
    expect(refs.length).toBe(1);
    expect(refs[0]?.display).toBe("اینجا ] نه");
  });

  it("deduplicates repeated links by key (first occurrence wins)", () => {
    const refs = parseWikiLinks("[[طرح]] اول و [[طرح]] دوم و [[  طرح  ]] سوم");
    expect(refs.length).toBe(1);
    expect(refs[0]?.index).toBe(0);
  });

  it("keeps distinct titles that normalise apart", () => {
    const refs = parseWikiLinks("[[طرح]] و [[نقشه]]");
    expect(refs.length).toBe(2);
  });

  it("matches across normalisation (Arabic spelling resolves later)", () => {
    const refs = parseWikiLinks("ببین [[كده را تمیز کن]] را");
    expect(refs.length).toBe(1);
    expect(refs[0]?.key).toBe(normaliseKnowledgeKey("کده را تمیز کن"));
  });

  it("returns nothing for text without links", () => {
    expect(parseWikiLinks("بدون پیوند [تکی] نیز بدون")).toEqual([]);
  });
});

describe("parseWikiTags", () => {
  it("extracts a simple tag", () => {
    const tags = parseWikiTags("این یک یادداشت #مهم است");
    expect(tags.length).toBe(1);
    expect(tags[0]?.display).toBe("مهم");
  });

  it("extracts latin and hyphenated tags", () => {
    const tags = parseWikiTags("release notes #v2_1 and #follow-up");
    expect(tags.map((tag) => tag.display)).toEqual(["v2_1", "follow-up"]);
  });

  it("requires a word boundary before the #", () => {
    expect(parseWikiTags("کلمه#داخل")).toEqual([]);
    expect(parseWikiTags("a#b")).toEqual([]);
    expect(parseWikiTags("##دابل")).toEqual([]);
  });

  it("accepts a tag right after punctuation or start-of-text", () => {
    const tags = parseWikiTags("#شروع، و (پس از پرانتز) #پایان.");
    expect(tags.map((tag) => tag.display)).toEqual(["شروع", "پایان"]);
  });

  it("deduplicates by normalised key (Persian/Arabic drift folds)", () => {
    const tags = parseWikiTags("#كده و #کده");
    expect(tags.length).toBe(1);
    expect(tags[0]?.display).toBe("كده");
  });

  it("rejects numbers-only tags (at least one letter required)", () => {
    expect(parseWikiTags("شماره #۱۲۳۴ plain #123")).toEqual([]);
  });

  it("keeps tags that mix digits and letters", () => {
    const tags = parseWikiTags("نسخه #v2 و #فاز۱۴");
    expect(tags.map((tag) => tag.display)).toEqual(["v2", "فاز۱۴"]);
  });

  it("does not treat a ZWNJ before # as a word character", () => {
    const tags = parseWikiTags("می\u200Cشود#برچسب");
    expect(tags.map((tag) => tag.display)).toEqual(["برچسب"]);
  });
});

describe("snippetAroundSpan", () => {
  it("wraps the span with ellipses on trimmed sides", () => {
    const text = "متن بسیار طولانی پیش از پیوند [[هدف]] و پس از آن هم متنی هست";
    const snippet = snippetAroundSpan(
      text,
      text.indexOf("[[هدف]]"),
      "[[هدف]]".length,
    );
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("[[هدف]]");
  });

  it("leaves short texts untrimmed", () => {
    expect(snippetAroundSpan("کوتاه [[x]]", 6, 5)).toBe("کوتاه [[x]]");
  });
});
