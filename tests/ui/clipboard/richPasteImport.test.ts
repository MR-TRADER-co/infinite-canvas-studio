// @vitest-environment jsdom
/**
 * Unit tests for the فاز-۲۴ rich paste-in planner: a Word/Excel/web
 * `text/html` payload sanitises + parses into a RICH plan (formatting
 * survives), an unformatted or absent HTML payload keeps the exact
 * Phase-23 plain plan, over-long HTML falls back to plain, and nothing
 * importable yields null.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_PASTE_HTML_LENGTH,
  planRichTextPaste,
} from "@/ui/clipboard/richPasteImport";

describe("planRichTextPaste", () => {
  it("plans a RICH import for Word formatting (bold + fake list)", () => {
    const plan = planRichTextPaste(
      '<p class="MsoListParagraph" style="mso-list:l0">• یک</p>' +
        "<p><b>درشت</b> و متن ساده</p>",
      "• یک\nدرشت و متن ساده",
    );
    expect(plan).not.toBeNull();
    expect(plan?.kind).toBe("rich");
    if (plan?.kind === "rich") {
      expect(plan.doc.content?.[0]?.type).toBe("bulletList");
      expect(JSON.stringify(plan.doc)).toContain('"bold"');
      // The plain-text projection feeds the legacy `text` field.
      expect(plan.text).toContain("درشت");
    }
  });

  it("plans a RICH import for an Excel table even without plain text", () => {
    const plan = planRichTextPaste(
      "<table><tr><td>نام</td><td>مقدار</td></tr><tr><td>الف</td><td>۱۲</td></tr></table>",
      "",
    );
    expect(plan?.kind).toBe("rich");
    if (plan?.kind === "rich") {
      expect(plan.doc.content?.[0]?.type).toBe("table");
    }
  });

  it("plans PLAIN for unformatted HTML (Phase-23 behaviour intact)", () => {
    const plan = planRichTextPaste(
      "<p>خط اول</p><p>خط دوم</p>",
      "خط اول\nخط دوم",
    );
    expect(plan).toEqual({ kind: "plain", text: "خط اول\nخط دوم" });
  });

  it("plans PLAIN when the clipboard carries no HTML at all", () => {
    expect(planRichTextPaste("", "متن ساده")).toEqual({
      kind: "plain",
      text: "متن ساده",
    });
  });

  it("plans PLAIN for over-long HTML with usable plain text", () => {
    const huge = `<p><b>${"x".repeat(MAX_PASTE_HTML_LENGTH)}</b></p>`;
    const plan = planRichTextPaste(huge, "متن کوتاه");
    expect(plan).toEqual({ kind: "plain", text: "متن کوتاه" });
  });

  it("returns null when neither payload is importable", () => {
    expect(planRichTextPaste("", "")).toBeNull();
    expect(planRichTextPaste("", "   ")).toBeNull();
    expect(planRichTextPaste("", `${"x".repeat(8001)}`)).toBeNull();
  });

  it("never plans a rich import from a script payload", () => {
    const plan = planRichTextPaste(
      "<script>alert('evil')</script><p><b>ok</b></p>",
      "ok",
    );
    expect(plan?.kind).toBe("rich");
    if (plan?.kind === "rich") {
      expect(JSON.stringify(plan.doc)).not.toContain("alert");
    }
  });
});
