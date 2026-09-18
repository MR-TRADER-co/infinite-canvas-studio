/**
 * Unit tests for the paste decision planner (R3B.5): the pure decision
 * table behind the editor's handlePaste.
 */
import { describe, expect, it } from "vitest";
import { planClipboardPaste } from "@/text/editor/pastePlanner";

describe("planClipboardPaste", () => {
  it("rejects an HTML table pasted inside a table cell", () => {
    const plan = planClipboardPaste({
      plain: "a\tb",
      html: "<table><tr><td>x</td></tr></table>",
      shiftKey: false,
      selectionInTable: true,
    });
    expect(plan.kind).toBe("reject-nested-table");
  });

  it("rejects tabular plain text pasted inside a table cell", () => {
    const plan = planClipboardPaste({
      plain: "a\tb\n1\t2",
      html: "",
      shiftKey: false,
      selectionInTable: true,
    });
    expect(plan.kind).toBe("reject-nested-table");
  });

  it("allows non-table HTML inside a table cell", () => {
    const plan = planClipboardPaste({
      plain: "x",
      html: "<p><b>x</b></p>",
      shiftKey: false,
      selectionInTable: true,
    });
    expect(plan.kind).toBe("rich-html");
  });

  it("Ctrl+Shift+V pastes plain text even with HTML on the clipboard", () => {
    const plan = planClipboardPaste({
      plain: "سلام\nدنیا",
      html: "<p><b>سلام</b></p>",
      shiftKey: true,
      selectionInTable: false,
    });
    expect(plan.kind).toBe("plain-text");
    if (plan.kind === "plain-text") {
      expect(plan.text).toBe("سلام\nدنیا");
    }
  });

  it("falls back to default when Shift is held but plain text is empty", () => {
    const plan = planClipboardPaste({
      plain: "",
      html: "<p>x</p>",
      shiftKey: true,
      selectionInTable: false,
    });
    expect(plan.kind).toBe("rich-html");
  });

  it("routes rich HTML payloads through the sanitiser path", () => {
    const plan = planClipboardPaste({
      plain: "text",
      html: "<p style='color:red'>Word content</p>",
      shiftKey: false,
      selectionInTable: false,
    });
    expect(plan.kind).toBe("rich-html");
    if (plan.kind === "rich-html") {
      expect(plan.html).toContain("Word content");
    }
  });

  it("converts tabular plain text (TSV) into a table document", () => {
    const plan = planClipboardPaste({
      plain: "سرستون\tستون۲\nمقدار۱\tمقدار۲",
      html: "",
      shiftKey: false,
      selectionInTable: false,
    });
    expect(plan.kind).toBe("table-from-tabular");
    if (plan.kind === "table-from-tabular") {
      expect(plan.cells).toHaveLength(2);
      expect(plan.cells[0]).toEqual(["سرستون", "ستون۲"]);
    }
  });

  it("lets ProseMirror handle plain single-line text", () => {
    const plan = planClipboardPaste({
      plain: "سلام",
      html: "",
      shiftKey: false,
      selectionInTable: false,
    });
    expect(plan.kind).toBe("default");
  });
});
