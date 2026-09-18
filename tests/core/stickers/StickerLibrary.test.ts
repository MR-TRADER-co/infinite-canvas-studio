/** Sticker-library search + catalogue invariants (R12.1). */
import { describe, expect, it } from "vitest";
import {
  CURATED_STICKERS,
  isStickerCategoryId,
  normalizeStickerQuery,
  searchStickers,
  stickersOfCategory,
  STICKER_CATEGORIES,
  STICKER_LIBRARY,
} from "@/core/stickers/StickerLibrary";

describe("Sticker library catalogue (R12.1)", () => {
  it("keeps every emoji unique (React keys + search identity)", () => {
    const seen = new Set<string>();
    for (const entry of STICKER_LIBRARY) {
      expect(seen.has(entry.emoji)).toBe(false);
      seen.add(entry.emoji);
    }
  });

  it("gives every entry a known category and at least one keyword", () => {
    for (const entry of STICKER_LIBRARY) {
      expect(isStickerCategoryId(entry.category)).toBe(true);
      expect(entry.keywords.length).toBeGreaterThan(0);
      for (const keyword of entry.keywords) {
        expect(keyword.trim()).not.toBe("");
      }
    }
  });

  it("covers every curated quick-palette glyph in the library", () => {
    const libraryEmojis = new Set(
      STICKER_LIBRARY.map((entry) => entry.emoji),
    );
    for (const emoji of CURATED_STICKERS) {
      expect(libraryEmojis.has(emoji)).toBe(true);
    }
  });

  it("exposes every category id in the tab list and a non-empty grid", () => {
    expect(STICKER_CATEGORIES.length).toBe(9);
    for (const category of STICKER_CATEGORIES) {
      expect(stickersOfCategory(category.id).length).toBeGreaterThan(0);
    }
  });
});

describe("normalizeStickerQuery (R12.1)", () => {
  it("folds case, trims and collapses whitespace", () => {
    expect(normalizeStickerQuery("  Star   Name ")).toBe("star name");
  });

  it("unifies Arabic yeh/kaf with their Persian twins", () => {
    expect(normalizeStickerQuery("كتاب")).toBe("کتاب");
    expect(normalizeStickerQuery("يك")).toBe("یک");
  });

  it("turns ZWNJ into a plain space", () => {
    expect(normalizeStickerQuery("می\u200cشود")).toBe("می شود");
  });
});

describe("searchStickers (R12.1)", () => {
  it("matches Persian keywords by substring", () => {
    const results = searchStickers("ستا");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((entry) => entry.emoji === "⭐")).toBe(true);
  });

  it("matches English keywords case-insensitively", () => {
    const results = searchStickers("ROCKET");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((entry) => entry.emoji === "🚀")).toBe(true);
  });

  it("finds through Arabic-typed Persian (yeh/kaf unification)", () => {
    // «كدنویسی» typed with Arabic ك — normalises to «کدنویسی» and finds
    // the laptop's keyword; «تيراندازی» typed with Arabic ي finds the target.
    const byKaf = searchStickers("كدنویسی");
    expect(byKaf.some((entry) => entry.emoji === "💻")).toBe(true);
    const byYeh = searchStickers("تيراندازی");
    expect(byYeh.some((entry) => entry.emoji === "🎯")).toBe(true);
  });

  it("matches pasted emoji glyphs directly", () => {
    const results = searchStickers("🔥");
    expect(results.some((entry) => entry.emoji === "🔥")).toBe(true);
  });

  it("matches multi-word needles inside keywords", () => {
    const results = searchStickers("thumbs up");
    expect(results.some((entry) => entry.emoji === "👍")).toBe(true);
  });

  it("returns nothing for empty or whitespace queries", () => {
    expect(searchStickers("")).toEqual([]);
    expect(searchStickers("   ")).toEqual([]);
  });

  it("returns nothing for gibberish", () => {
    expect(searchStickers("zzzzq")).toEqual([]);
  });
});
