// @vitest-environment jsdom
/**
 * Unit tests for the فاز-۲۴ XML normaliser of the DOM rasterizer: the
 * browser's HTML serialisation leaves VOID elements unclosed (`<col>` of
 * rich-text tables, `<br>` hard breaks, `<hr>`, `<img>`), which is INVALID
 * XML and made the whole SVG rasterization fail to load — every PNG/SVG
 * export of a canvas containing a table died silently. The normaliser's
 * DOMParser → XMLSerializer round-trip closes every void element and
 * escapes entities.
 */
import { describe, expect, it } from "vitest";
import { testing } from "@/persistence/exporters/DomRasterizer";

const { xmlNormalizeFragment } = testing;

describe("xmlNormalizeFragment", () => {
  it("closes void <col> elements of rich-text tables", () => {
    const html =
      '<table dir="rtl" data-table-preset="classic">' +
      '<colgroup><col style="min-width: 40px;"><col style="min-width: 40px;"></colgroup>' +
      "<tbody><tr><td>الف</td></tr></tbody></table>";
    const normalized = xmlNormalizeFragment(html);
    expect(normalized).toContain("<col ");
    // Every <col> must be self-closed (XML-valid) — not an unclosed void.
    expect(normalized).not.toMatch(/<col\s[^>]*[^\/]>/);
    // The closed form must be re-parseable XML.
    const parsed = new DOMParser().parseFromString(
      `<root xmlns="http://www.w3.org/1999/xhtml">${normalized}</root>`,
      "application/xml",
    );
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(parsed.querySelectorAll("col")).toHaveLength(2);
  });

  it("closes <br> hard breaks and <hr> rules", () => {
    const normalized = xmlNormalizeFragment("<p>خط اول<br>خط دوم</p><hr>");
    expect(normalized).toMatch(/<br[^>]*\/>/);
    expect(normalized).toMatch(/<hr[^>]*\/>/);
    const parsed = new DOMParser().parseFromString(
      `<root xmlns="http://www.w3.org/1999/xhtml">${normalized}</root>`,
      "application/xml",
    );
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(parsed.querySelectorAll("br")).toHaveLength(1);
  });

  it("keeps ordinary rich content intact (h1/ul/strong)", () => {
    const html = "<h1>سرتیتر</h1><ul><li><p>یک</p></li></ul><p><strong>مهم</strong></p>";
    const normalized = xmlNormalizeFragment(html);
    expect(normalized).toContain("<h1");
    expect(normalized).toContain("<strong>مهم</strong>");
    expect(normalized).toContain("<li>");
    const parsed = new DOMParser().parseFromString(
      `<root xmlns="http://www.w3.org/1999/xhtml">${normalized}</root>`,
      "application/xml",
    );
    expect(parsed.querySelector("parsererror")).toBeNull();
  });

  it("survives empty input", () => {
    expect(xmlNormalizeFragment("")).toBe("");
  });
});
