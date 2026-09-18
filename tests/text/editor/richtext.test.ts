/**
 * Rich text document model tests (node environment): plain-text
 * projections, legacy upgrades, emptiness, stable serialisation and the
 * first-strong-character direction heuristic (R3A.5/R3A.7).
 */
import { describe, expect, it } from "vitest";
import type { RichTextDocument } from "@/text/editor/richtext";
import {
  dominantTextDirection,
  emptyRichTextDocument,
  firstStrongCharacter,
  plainTextOfDocument,
  richTextDocumentIsEmpty,
  richTextDocumentsEqual,
  richTextFromPlainText,
  serializeRichText,
} from "@/text/editor/richtext";

describe("plainTextOfDocument", () => {
  it("joins paragraphs with newlines and trims trailing empties", () => {
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "سلام" }] },
        { type: "paragraph", content: [{ type: "text", text: "دنیا" }] },
        { type: "paragraph" },
      ],
    };
    expect(plainTextOfDocument(doc)).toBe("سلام\nدنیا");
  });

  it("keeps interior empty paragraphs as blank lines", () => {
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
      ],
    };
    expect(plainTextOfDocument(doc)).toBe("a\n\nb");
  });

  it("flattens list items line-by-line", () => {
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "یک" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "دو" }] },
              ],
            },
          ],
        },
      ],
    };
    expect(plainTextOfDocument(doc)).toBe("یک\nدو");
  });

  it("treats hard breaks as newlines inside the paragraph", () => {
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "خط اول" },
            { type: "hardBreak" },
            { type: "text", text: "خط دوم" },
          ],
        },
      ],
    };
    expect(plainTextOfDocument(doc)).toBe("خط اول\nخط دوم");
  });

  it("returns the empty string for null and empty docs", () => {
    expect(plainTextOfDocument(null)).toBe("");
    expect(plainTextOfDocument({ type: "doc" })).toBe("");
    expect(plainTextOfDocument({ type: "doc", content: [] })).toBe("");
  });
});

describe("richTextFromPlainText (legacy upgrade)", () => {
  it("splits paragraphs on newlines", () => {
    const doc = richTextFromPlainText("سلام\nworld");
    expect(doc.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "سلام" }] },
      { type: "paragraph", content: [{ type: "text", text: "world" }] },
    ]);
  });

  it("empty text becomes one empty paragraph (a caret target)", () => {
    expect(richTextFromPlainText("")).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(richTextFromPlainText("")).toEqual(emptyRichTextDocument());
  });

  it("round-trips through plainTextOfDocument", () => {
    expect(plainTextOfDocument(richTextFromPlainText("یک\nدو\n"))).toBe(
      "یک\nدو",
    );
  });
});

describe("richTextDocumentIsEmpty", () => {
  it("treats whitespace-only documents as empty", () => {
    expect(richTextDocumentIsEmpty(null)).toBe(true);
    expect(richTextDocumentIsEmpty(emptyRichTextDocument())).toBe(true);
    expect(
      richTextDocumentIsEmpty({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "   " }] },
        ],
      }),
    ).toBe(true);
    expect(
      richTextDocumentIsEmpty({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "x" }] },
        ],
      }),
    ).toBe(false);
  });
});

describe("serialisation equality", () => {
  it("compares documents through their JSON", () => {
    const a = richTextFromPlainText("یک");
    const b = richTextFromPlainText("یک");
    const c = richTextFromPlainText("دو");
    expect(richTextDocumentsEqual(a, b)).toBe(true);
    expect(richTextDocumentsEqual(a, c)).toBe(false);
    expect(richTextDocumentsEqual(null, null)).toBe(true);
    expect(serializeRichText(null)).toBe("");
  });
});

describe("direction heuristics", () => {
  it("firstStrongCharacter detects Persian, Latin and neutral text", () => {
    expect(firstStrongCharacter("۱۲۳ سلام")).toBe("rtl");
    expect(firstStrongCharacter("123 hello")).toBe("ltr");
    expect(firstStrongCharacter("...")).toBeNull();
    expect(firstStrongCharacter("")).toBeNull();
  });

  it("dominantTextDirection prefers explicit block dirs, then first strong", () => {
    expect(dominantTextDirection(richTextFromPlainText("hello world"))).toBe(
      "ltr",
    );
    expect(dominantTextDirection(richTextFromPlainText("سلام دنیا"))).toBe(
      "rtl",
    );
    expect(dominantTextDirection(null)).toBe("rtl");
    expect(
      dominantTextDirection({
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { dir: "ltr" },
            content: [{ type: "text", text: "سلام" }],
          },
        ],
      }),
    ).toBe("ltr");
    expect(
      dominantTextDirection({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "..." }] },
          { type: "paragraph", content: [{ type: "text", text: "English" }] },
        ],
      }),
    ).toBe("ltr");
  });
});
