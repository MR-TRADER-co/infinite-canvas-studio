/**
 * Unit tests for the pure Find & Replace model (R3B.8 / AC3B.8): plain
 * substring matching across objects (logical order, ZWNJ intact) and the
 * document splicer with line-aware offsets.
 */
import { describe, expect, it } from "vitest";
import type { RichTextDocument } from "@/text/editor/richtext";
import { plainTextOfDocument } from "@/text/editor/richtext";
import {
  findMatches,
  replaceRangeInDocument,
  type FindTarget,
} from "@/text/find/FindReplaceModel";

/** Persian targets across several objects (AC3B.8: 5+ objects). */
const TARGETS: readonly FindTarget[] = [
  { id: "a", kind: "textBox", text: "سلام دنیا" },
  { id: "b", kind: "textBox", text: "می‌خواهم سلام بگویم" },
  { id: "c", kind: "stickyNote", text: "یادداشت ساده" },
  { id: "d", kind: "textBox", text: "سلام و باز هم سلام" },
  { id: "e", kind: "textBox", text: "hello world" },
];

describe("findMatches", () => {
  it("finds a Persian query across 5+ objects", () => {
    const matches = findMatches(TARGETS, "سلام");
    expect(matches.map((match) => match.objectId)).toEqual([
      "a",
      "b",
      "d",
      "d",
    ]);
  });

  it("returns occurrences in document order with per-object indices", () => {
    const matches = findMatches(TARGETS, "سلام");
    expect(matches[3]).toMatchObject({ objectId: "d", occurrence: 1 });
    expect(matches[3]?.start).toBe(14);
    expect(matches[3]?.end).toBe(18);
  });

  it("matches ZWNJ-containing words as plain substrings (no normalisation)", () => {
    const matches = findMatches(TARGETS, "می‌خواهم");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.objectId).toBe("b");
  });

  it("is case-sensitive plain substring (no tricks)", () => {
    const matches = findMatches(TARGETS, "Hello");
    expect(matches).toHaveLength(0);
    expect(findMatches(TARGETS, "hello")).toHaveLength(1);
  });

  it("returns nothing for empty queries", () => {
    expect(findMatches(TARGETS, "")).toEqual([]);
  });

  it("builds display snippets around each hit", () => {
    const [match] = findMatches(
      [{ id: "x", kind: "textBox", text: "abcdefghij" }],
      "efg",
    );
    expect(match?.snippet.hit).toBe("efg");
    expect(match?.snippet.before).toBe("abcd");
    expect(match?.snippet.after).toBe("hij");
  });
});

describe("replaceRangeInDocument", () => {
  /** Builds a two-paragraph document: "سلام دنیا" + "خوبی؟". */
  function twoParagraphDoc(): RichTextDocument {
    return {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "سلام دنیا" }] },
        { type: "paragraph", content: [{ type: "text", text: "خوبی؟" }] },
      ],
    };
  }

  it("splices a match inside the FIRST paragraph (offset 0)", () => {
    const doc = twoParagraphDoc();
    const replaced = replaceRangeInDocument(doc, 0, 4, "درود");
    expect(replaced).not.toBeNull();
    expect(plainTextOfDocument(doc)).toBe("درود دنیا\nخوبی؟");
  });

  it("splices a match in the SECOND paragraph with the line separator offset", () => {
    const doc = twoParagraphDoc();
    // logical: "سلام دنیا\nخوبی؟" — "خوبی" starts at 10
    const replaced = replaceRangeInDocument(doc, 10, 14, "چطوری");
    expect(replaced).not.toBeNull();
    expect(plainTextOfDocument(doc)).toBe("سلام دنیا\nچطوری؟");
  });

  it("replaces a ZWNJ-joined compound by exact substring offsets", () => {
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "می‌خواهم بروم" }],
        },
      ],
    };
    const logical = plainTextOfDocument(doc);
    const start = logical.indexOf("می‌خواهم");
    const replaced = replaceRangeInDocument(
      doc,
      start,
      start + "می‌خواهم".length,
      "دوست دارم",
    );
    expect(replaced).not.toBeNull();
    expect(plainTextOfDocument(doc)).toBe("دوست دارم بروم");
  });

  it("splices a match spanning TWO text nodes with different marks", () => {
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "سلا", marks: [{ type: "bold" }] },
            { type: "text", text: "م", marks: [{ type: "italic" }] },
          ],
        },
      ],
    };
    // logical text "سلام" — replace [0,5)
    const replaced = replaceRangeInDocument(doc, 0, 5, "درود");
    expect(replaced).not.toBeNull();
    expect(plainTextOfDocument(doc)).toBe("درود");
  });

  it("prunes text nodes emptied by the splice", () => {
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "حذف", marks: [{ type: "bold" }] }],
        },
      ],
    };
    const replaced = replaceRangeInDocument(doc, 0, 3, "");
    expect(replaced).not.toBeNull();
    expect(plainTextOfDocument(doc)).toBe("");
    // The emptied text node is gone; the paragraph survives.
    expect(doc.content?.[0]?.content).toBeUndefined();
  });

  it("returns null when the range intersects no text", () => {
    const doc = twoParagraphDoc();
    // Range beyond the document's logical length.
    expect(replaceRangeInDocument(doc, 100, 105, "x")).toBeNull();
  });

  it("keeps marks of the first intersecting text node (replacement inherits them)", () => {
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "قدیمی", marks: [{ type: "bold" }] }],
        },
      ],
    };
    replaceRangeInDocument(doc, 0, 5, "نو");
    const text = doc.content?.[0]?.content?.[0];
    expect(text?.marks).toEqual([{ type: "bold" }]);
    expect(text?.text).toBe("نو");
  });
});
