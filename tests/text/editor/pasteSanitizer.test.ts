// @vitest-environment jsdom
/**
 * Unit tests for the paste sanitiser (R3B.5 / AC3B.5): script injection
 * blocked, event handlers stripped, inline styles/classes dropped,
 * comments removed, remote images dropped (data: kept), dangerous URL
 * schemes sanitised, Word fake lists converted, structure (bold/heading/
 * list/link/table) preserved.
 */
import { describe, expect, it } from "vitest";
import { sanitizePastedHTML } from "@/text/editor/pasteSanitizer";

describe("sanitizePastedHTML", () => {
  it("strips <script> elements entirely (including their payload)", () => {
    const result = sanitizePastedHTML(
      "<p>سلام</p><script>alert('x')</script><p>دنیا</p>",
    );
    expect(result.html).not.toContain("script");
    expect(result.html).not.toContain("alert");
    expect(result.html).toContain("سلام");
    expect(result.html).toContain("دنیا");
  });

  it("strips style/link/meta/noscript blocks", () => {
    const result = sanitizePastedHTML(
      "<style>.a{color:red}</style><p>x</p><link rel=stylesheet href=evil.css><meta charset=utf-8>",
    );
    expect(result.html).not.toContain("style");
    expect(result.html).not.toContain("link");
    expect(result.html).not.toContain("meta");
    expect(result.html).toContain("<p>x</p>");
  });

  it("removes inline event handlers (on*)", () => {
    const result = sanitizePastedHTML(
      '<p onclick="alert(1)" onmouseover="evil()">text</p><a href="https://x.com" onclick="evil()">l</a>',
    );
    expect(result.html).not.toContain("onclick");
    expect(result.html).not.toContain("onmouseover");
    expect(result.html).toContain("https://x.com");
  });

  it("removes inline style attributes and classes", () => {
    const result = sanitizePastedHTML(
      '<p style="color:red; font-size:20px" class="MsoNormal">text</p>',
    );
    expect(result.html).not.toContain("style=");
    expect(result.html).not.toContain("class=");
    expect(result.html).toContain("text");
  });

  it("strips HTML comments", () => {
    const result = sanitizePastedHTML(
      "<p>a</p><!-- hidden payload --><p>b</p>",
    );
    expect(result.html).not.toContain("hidden payload");
    expect(result.html).not.toContain("<!--");
  });

  it("drops remote images and counts them, keeps data: images", () => {
    const result = sanitizePastedHTML(
      '<p>a</p><img src="https://evil.com/x.png"><img src="data:image/png;base64,iVBOR"><p>b</p>',
    );
    expect(result.droppedRemoteImages).toBe(1);
    expect(result.html).not.toContain("evil.com");
    expect(result.html).toContain("data:image/png");
  });

  it("blocks javascript: hrefs but keeps https/http/mailto", () => {
    const result = sanitizePastedHTML(
      '<a href="javascript:alert(1)">bad</a><a href="https://good.com">good</a><a href="mailto:a@b.c">mail</a>',
    );
    expect(result.html).not.toContain("javascript");
    expect(result.html).toContain("https://good.com");
    expect(result.html).toContain("mailto:a@b.c");
    expect(result.html).toContain(">bad</a>");
  });

  it("keeps the formatting the rich schema understands", () => {
    const html =
      "<h1>سرتیتر</h1><p><b>درشت</b> <i>مورب</i> <u>زیرخط</u> <s>خط‌خورده</s></p>" +
      "<ul><li>یکی</li><li>دو</li></ul><blockquote>نقل</blockquote><pre>code</pre><hr>";
    const result = sanitizePastedHTML(html);
    expect(result.html).toContain("<h1");
    expect(result.html).toContain("<b>");
    expect(result.html).toContain("<i>");
    expect(result.html).toContain("<u>");
    expect(result.html).toContain("<ul>");
    expect(result.html).toContain("<li>");
    expect(result.html).toContain("<blockquote>");
    expect(result.html).toContain("<pre>");
    expect(result.html).toContain("<hr>");
  });

  it("unwraps unknown containers so their content survives", () => {
    const result = sanitizePastedHTML(
      "<div><span>سلام</span> <section><font>دنیا</font></section></div>",
    );
    expect(result.html).toContain("سلام");
    expect(result.html).toContain("دنیا");
    expect(result.html).not.toContain("<div");
    expect(result.html).not.toContain("<span");
    expect(result.html).not.toContain("<font");
  });

  it("downgrades h4/h5 to h3 and h6 to a paragraph", () => {
    const result = sanitizePastedHTML("<h4>a</h4><h5>b</h5><h6>c</h6>");
    expect(result.html.match(/<h3>/g)?.length).toBe(2);
    expect(result.html).not.toContain("<h4");
    expect(result.html).not.toContain("<h6");
    expect(result.html).toContain("<p>c</p>");
  });

  it("converts Word fake bullet list paragraphs into a real ul", () => {
    const wordHtml =
      '<p class="MsoListParagraph" style="margin-left:36.0pt;mso-list:l0 level1 lfo1">· مورد اول</p>' +
      '<p class="MsoListParagraph" style="margin-left:36.0pt;mso-list:l0 level1 lfo1">· مورد دوم</p>';
    const result = sanitizePastedHTML(wordHtml);
    expect(result.convertedWordListItems).toBe(2);
    expect(result.html).toContain("<ul>");
    expect(result.html).not.toContain("MsoListParagraph");
    expect(result.html).toContain("مورد اول");
    expect(result.html).not.toContain("·");
  });

  it("converts Word fake numbered list paragraphs into a real ol", () => {
    const wordHtml =
      '<p style="mso-list:l1 level1 lfo2">1. نخست</p>' +
      '<p style="mso-list:l1 level1 lfo2">2. دوم</p>';
    const result = sanitizePastedHTML(wordHtml);
    expect(result.html).toContain("<ol>");
    expect(result.html).toContain("نخست");
    expect(result.html).toContain("دوم");
    expect(result.html).not.toContain("mso-list");
  });

  it("keeps table structure (Phase 6 tables survive the pipeline)", () => {
    const result = sanitizePastedHTML(
      '<table><tr><td dir="rtl">یک</td><td>دو</td></tr></table>',
    );
    expect(result.html).toContain("<table");
    expect(result.html).toContain("<td");
    expect(result.html).toContain('dir="rtl"');
  });

  it("keeps data-checked on li (task lists round-trip)", () => {
    const result = sanitizePastedHTML(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">انجام شد</li></ul>',
    );
    expect(result.html).toContain('data-checked="true"');
  });

  it("returns the input untouched when no DOM parser is injectable", () => {
    const result = sanitizePastedHTML("<p>raw</p>", null);
    expect(result.html).toBe("<p>raw</p>");
  });
});
