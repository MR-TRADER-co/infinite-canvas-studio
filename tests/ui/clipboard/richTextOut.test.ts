/**
 * Unit tests for the فاز-۳۵ «خروج غنی از بوم» outbound serializer: the
 * pure RichTextDocument → semantic-HTML pipeline (headings/marks/lists/
 * tables/links, full escaping, scheme sanitising) and the object-level
 * aggregator (`richTextHtmlOfObjects`).
 */
import { describe, expect, it } from "vitest";
import {
  richTextDocumentToHtml,
  richTextHtmlOfObjects,
} from "@/ui/clipboard/richTextOut";
import type { RichTextDocument } from "@/text/editor/richtext";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Builds a doc from raw content (cast once, tests stay terse). */
function doc(content: unknown[]): RichTextDocument {
  return { type: "doc", content } as RichTextDocument;
}

/** A text node shorthand. */
function text(value: string, marks?: unknown[]): unknown {
  return { type: "text", text: value, ...(marks ? { marks } : {}) };
}

describe("richTextDocumentToHtml (فاز ۳۵)", () => {
  it("renders headings, paragraphs and hard breaks", () => {
    const html = richTextDocumentToHtml(
      doc([
        { type: "heading", attrs: { level: 2 }, content: [text("سرتیتر")] },
        {
          type: "paragraph",
          content: [text("خط اول"), { type: "hardBreak" }, text("خط دوم")],
        },
      ]),
    );
    expect(html).toBe("<h2>سرتیتر</h2><p>خط اول<br>خط دوم</p>");
  });

  it("clamps invalid heading levels", () => {
    const html = richTextDocumentToHtml(
      doc([{ type: "heading", attrs: { level: 9 }, content: [text("x")] }]),
    );
    expect(html).toBe("<h6>x</h6>");
  });

  it("renders the full mark stack with well-formed nesting", () => {
    const html = richTextDocumentToHtml(
      doc([
        {
          type: "paragraph",
          content: [
            text("مهم", [
              { type: "bold" },
              { type: "italic" },
              { type: "underline" },
            ]),
            text(" "),
            text("حذف‌شده", [{ type: "strike" }]),
            text(" "),
            text("کد", [{ type: "code" }]),
          ],
        },
      ]),
    );
    expect(html).toBe(
      "<p><strong><em><u>مهم</u></em></strong> <s>حذف‌شده</s> <code>کد</code></p>",
    );
  });

  it("keeps SAFE link hrefs and degrades unsafe schemes to text", () => {
    const html = richTextDocumentToHtml(
      doc([
        {
          type: "paragraph",
          content: [
            text("سایت", [
              { type: "link", attrs: { href: "https://example.com/page?a=1" } },
            ]),
            text(" بد", [
              { type: "link", attrs: { href: "javascript:alert(1)" } },
            ]),
            text(" نسبی", [{ type: "link", attrs: { href: "/docs/x" } }]),
          ],
        },
      ]),
    );
    expect(html).toBe(
      '<p><a href="https://example.com/page?a=1">سایت</a> بد<a href="/docs/x"> نسبی</a></p>',
    );
  });

  it("escapes every text node and href attribute (no markup injection)", () => {
    const html = richTextDocumentToHtml(
      doc([
        {
          type: "paragraph",
          content: [
            text('<script>alert("x")</script> & <b>"quoted"</b>'),
            text('لینک', [{ type: "link", attrs: { href: 'https://e.com/"><script>' } }]),
          ],
        },
      ]),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toContain('href="https://e.com/&quot;&gt;&lt;script&gt;"');
  });

  it("renders bullet and ordered lists with compact items", () => {
    const html = richTextDocumentToHtml(
      doc([
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [text("یک")] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [text("دو")] }] },
          ],
        },
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [text("سه")] }] },
          ],
        },
      ]),
    );
    expect(html).toBe("<ul><li>یک</li><li>دو</li></ul><ol><li>سه</li></ol>");
  });

  it("renders tables with the header row in thead and body rows in ONE tbody", () => {
    const html = richTextDocumentToHtml(
      doc([
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [text("ستون")] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [text("مقدار")] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [text("الف")] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [text("ب")] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [text("ج")] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [text("د")] }] },
              ],
            },
          ],
        },
      ]),
    );
    expect(html).toBe(
      "<table><thead><tr><th>ستون</th><th>مقدار</th></tr></thead>" +
        "<tbody><tr><td>الف</td><td>ب</td></tr><tr><td>ج</td><td>د</td></tr></tbody></table>",
    );
  });

  it("separates multi-paragraph cells with <br>", () => {
    const html = richTextDocumentToHtml(
      doc([
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    { type: "paragraph", content: [text("سطر ۱")] },
                    { type: "paragraph", content: [text("سطر ۲")] },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(html).toBe("<table><tbody><tr><td>سطر ۱<br>سطر ۲</td></tr></tbody></table>");
  });

  it("renders blockquote with inner paragraphs, codeBlock escaped, hr", () => {
    const html = richTextDocumentToHtml(
      doc([
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [text("نقل")] }],
        },
        { type: "codeBlock", content: [text("let x = 1 < 2;")] },
        { type: "horizontalRule" },
      ]),
    );
    expect(html).toBe(
      "<blockquote><p>نقل</p></blockquote><pre><code>let x = 1 &lt; 2;</code></pre><hr>",
    );
  });

  it("rides the dir attribute on direction-aware blocks only", () => {
    const html = richTextDocumentToHtml(
      doc([
        { type: "paragraph", attrs: { dir: "rtl" }, content: [text("سلام")] },
        { type: "heading", attrs: { level: 1, dir: "ltr" }, content: [text("Hi")] },
      ]),
    );
    expect(html).toBe('<p dir="rtl">سلام</p><h1 dir="ltr">Hi</h1>');
  });

  it("unwraps unknown nodes gracefully (text never lost)", () => {
    const html = richTextDocumentToHtml(
      doc([
        { type: "customWrapper", content: [text("داخل")] },
      ]),
    );
    expect(html).toBe("داخل");
  });
});

describe("richTextHtmlOfObjects (فاز ۳۵)", () => {
  /** A text-box object stub. */
  function textBox(
    text: string,
    docValue: RichTextDocument | null,
  ): SceneObjectData {
    return {
      kind: "textBox",
      id: "tb-1",
      position: { x: 0, y: 0 },
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      text,
      doc: docValue,
    } as unknown as SceneObjectData;
  }

  /** A sticky-note object stub. */
  function sticky(text: string): SceneObjectData {
    return {
      kind: "stickyNote",
      id: "sn-1",
      position: { x: 0, y: 0 },
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      text,
    } as unknown as SceneObjectData;
  }

  it("serialises a rich text box through its doc", () => {
    const html = richTextHtmlOfObjects([
      textBox("سرتیتر", doc([
        { type: "heading", attrs: { level: 3 }, content: [text("عنوان")] },
      ])),
    ]);
    expect(html).toBe("<h3>عنوان</h3>");
  });

  it("wraps PLAIN text boxes and sticky notes in escaped <p> lines", () => {
    const html = richTextHtmlOfObjects([
      textBox("خط ۱\nخط ۲", null),
      sticky("یادداشت <مهم>"),
    ]);
    expect(html).toBe(
      "<p>خط ۱</p><p>خط ۲</p><p><br></p><p>یادداشت &lt;مهم&gt;</p>",
    );
  });

  it("returns null when the selection carries no text-bearing object", () => {
    const shape = {
      kind: "shape",
      id: "sh-1",
    } as unknown as SceneObjectData;
    expect(richTextHtmlOfObjects([shape])).toBeNull();
    expect(richTextHtmlOfObjects([])).toBeNull();
  });

  it("skips empty text contributions entirely", () => {
    expect(richTextHtmlOfObjects([textBox("   ", null)])).toBeNull();
  });
});
