// @vitest-environment jsdom
/**
 * Unit tests for the فاز-۲۴ HTML import (Word → rich text document):
 * schema-faithful parsing of the SANITISED clipboard subset (headings,
 * bold/italic/underline/strike marks, lists — including Word's fake-list
 * conversion — tables, links), the rich-vs-plain decision predicate and
 * the null fallbacks (no DOM, empty fragment, throwing adapter).
 */
import { describe, expect, it } from "vitest";
import {
  documentIsRichlyFormatted,
  richTextFromSanitizedHTML,
  type HtmlImportDom,
} from "@/text/editor/htmlImport";
import { sanitizePastedHTML } from "@/text/editor/pasteSanitizer";
import { getSharedTextEditor } from "@/text/editor/TipTapFactory";
import { richTextFromPlainText } from "@/text/editor/richtext";

/** The shared editor's schema — the parse contract under test. */
const schema = getSharedTextEditor().getSchema();

/** Sanitises + parses one clipboard HTML payload in one step. */
function importHtml(html: string): ReturnType<typeof richTextFromSanitizedHTML> {
  return richTextFromSanitizedHTML(sanitizePastedHTML(html).html, schema);
}

describe("richTextFromSanitizedHTML", () => {
  it("parses headings, bold/italic/underline/strike and links", () => {
    const doc = importHtml(
      '<h1>سرتیتر</h1>' +
        '<p><b>درشت</b> <i>مورب</i> <u>زیرخط</u> <s>خط‌خورده</s> ' +
        '<a href="https://example.com">پیوند</a></p>',
    );
    expect(doc).not.toBeNull();
    const blocks = doc?.content ?? [];
    expect(blocks[0]?.type).toBe("heading");
    expect(blocks[0]?.attrs?.level).toBe(1);
    const paragraph = blocks[1]?.content ?? [];
    const marks = new Set(
      paragraph.flatMap((node) => (node.marks ?? []).map((mark) => mark.type)),
    );
    expect(marks).toContain("bold");
    expect(marks).toContain("italic");
    expect(marks).toContain("underline");
    expect(marks).toContain("strike");
    expect(marks).toContain("link");
    expect(paragraph.some((node) => node.text === "پیوند")).toBe(true);
  });

  it("converts Word fake lists into REAL schema lists", () => {
    // Word emits list paragraphs as styled <p class=MsoListParagraph> with
    // literal bullet glyphs — the sanitiser converts them BEFORE parsing.
    const doc = importHtml(
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">• یک</p>' +
        '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">• دو</p>',
    );
    expect(doc).not.toBeNull();
    expect(doc?.content?.[0]?.type).toBe("bulletList");
    const items = doc?.content?.[0]?.content ?? [];
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.type === "listItem")).toBe(true);
  });

  it("parses Word tables into real rich tables with spans", () => {
    const doc = importHtml(
      "<table><tr><td>الف</td><td colspan=\"2\">ب</td></tr><tr><td>ج</td><td>د</td><td>ه</td></tr></table>",
    );
    expect(doc).not.toBeNull();
    const table = doc?.content?.[0];
    expect(table?.type).toBe("table");
    expect(table?.content).toHaveLength(2);
    expect(table?.content?.[0]?.content?.[1]?.attrs?.colspan).toBe(2);
  });

  it("keeps the dir attribute of RTL/LTR blocks", () => {
    const doc = importHtml('<p dir="rtl">سلام</p><p dir="ltr">hello</p>');
    expect(doc?.content?.[0]?.attrs?.dir).toBe("rtl");
    expect(doc?.content?.[1]?.attrs?.dir).toBe("ltr");
  });

  it("returns null for an empty fragment", () => {
    expect(richTextFromSanitizedHTML("", schema)).toBeNull();
    expect(richTextFromSanitizedHTML("   ", schema)).toBeNull();
  });

  it("returns null when the injected DOM adapter throws", () => {
    const throwing: HtmlImportDom = {
      parseHTML: () => {
        throw new Error("boom");
      },
    };
    expect(richTextFromSanitizedHTML("<p>x</p>", schema, throwing)).toBeNull();
  });

  it("never lets a script payload through to the document", () => {
    const doc = importHtml(
      "<p>متنی</p><script>alert('x')</script>",
    );
    expect(doc).not.toBeNull();
    expect(JSON.stringify(doc)).not.toContain("alert");
  });
});

describe("documentIsRichlyFormatted", () => {
  it("is false for plain paragraphs (even multiple)", () => {
    expect(documentIsRichlyFormatted(richTextFromPlainText("یک\nدو"))).toBe(
      false,
    );
  });

  it("is false for null", () => {
    expect(documentIsRichlyFormatted(null)).toBe(false);
  });

  it("is true for marked text runs", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "درشت", marks: [{ type: "bold" }] }],
        },
      ],
    };
    expect(documentIsRichlyFormatted(doc)).toBe(true);
  });

  it("is true for non-paragraph blocks and tables", () => {
    expect(
      documentIsRichlyFormatted({
        type: "doc" as const,
        content: [{ type: "heading", attrs: { level: 2 } }],
      }),
    ).toBe(true);
    expect(
      documentIsRichlyFormatted({
        type: "doc" as const,
        content: [{ type: "table", content: [] }],
      }),
    ).toBe(true);
    expect(
      documentIsRichlyFormatted({
        type: "doc" as const,
        content: [{ type: "bulletList", content: [] }],
      }),
    ).toBe(true);
  });
});
