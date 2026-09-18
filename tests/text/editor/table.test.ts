/**
 * Phase 6 table document tests (node environment, R6.1/R6.5/R6.6): the
 * table document builder (structure, header row, RTL default), the
 * table-aware emptiness contract (a table survives session commits),
 * TSV clipboard parsing and the tabular→table conversion.
 */
import { describe, expect, it } from "vitest";
import type { RichTextDocument } from "@/text/editor/richtext";
import {
  createTableDocument,
  documentContainsTable,
  parseTabularText,
  plainTextOfDocument,
  richTextDocumentIsEmpty,
  tabularToTableDocument,
} from "@/text/editor/richtext";
import { planTextCommit } from "@/text/commands/TextCommit";
import { textBoxFromRect } from "@/core/model/TextBoxObject";

describe("createTableDocument", () => {
  it("builds rows × cols cells with a header first row (R6.1)", () => {
    const doc = createTableDocument(3, 4);
    const table = doc.content?.[0];
    expect(table?.type).toBe("table");
    expect(table?.attrs).toMatchObject({ dir: "rtl", preset: "classic" });
    const rows = table?.content ?? [];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.type).toBe("tableRow");
    expect(rows[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(rows[1]?.content?.[0]?.type).toBe("tableCell");
    expect(rows[0]?.content).toHaveLength(4);
    for (const row of rows) {
      for (const cell of row.content ?? []) {
        expect(cell.content).toEqual([{ type: "paragraph" }]);
      }
    }
  });

  it("clamps non-positive dimensions to one cell", () => {
    const doc = createTableDocument(0, -3);
    const table = doc.content?.[0];
    expect(table?.content).toHaveLength(1);
    expect(table?.content?.[0]?.content).toHaveLength(1);
  });

  it("supports an explicit LTR direction and headerless mode (R6.5)", () => {
    const doc = createTableDocument(2, 2, { dir: "ltr", withHeaderRow: false });
    const table = doc.content?.[0];
    expect(table?.attrs?.dir).toBe("ltr");
    expect(table?.content?.[0]?.content?.[0]?.type).toBe("tableCell");
  });

  it("round-trips through JSON losslessly (persistence contract)", () => {
    const doc = createTableDocument(4, 3);
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});

describe("documentContainsTable / emptiness", () => {
  it("detects tables at the doc root", () => {
    expect(documentContainsTable(createTableDocument(2, 2))).toBe(true);
  });

  it("detects tables nested after paragraphs", () => {
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "قبل" }] },
        ...(createTableDocument(2, 2).content ?? []),
      ],
    };
    expect(documentContainsTable(doc)).toBe(true);
  });

  it("an empty-celled table is NOT an empty document (R6.1 commit guard)", () => {
    expect(richTextDocumentIsEmpty(createTableDocument(3, 3))).toBe(false);
    expect(plainTextOfDocument(createTableDocument(3, 3))).toBe("");
  });

  it("planTextCommit keeps a freshly created empty-celled table (add)", () => {
    const object = textBoxFromRect(
      { minX: 0, minY: 0, maxX: 300, maxY: 120 },
      "",
      20,
      "obj-table",
      1,
      "fixed",
    );
    const doc = createTableDocument(3, 3);
    const plan = planTextCommit({
      object,
      newlyCreated: true,
      newText: "",
      newDocJSON: JSON.stringify(doc),
      newDocHasTable: true,
    });
    expect(plan).toEqual({ action: "add", recordHistory: true });
  });

  it("planTextCommit never auto-removes an emptied table box (update path)", () => {
    const object = textBoxFromRect(
      { minX: 0, minY: 0, maxX: 300, maxY: 120 },
      "",
      20,
      "obj-table",
      1,
      "fixed",
    );
    const doc = createTableDocument(2, 2);
    const plan = planTextCommit({
      object,
      newlyCreated: false,
      newText: "",
      newDocJSON: JSON.stringify(doc),
      newDocHasTable: true,
      baselineDocJSON: JSON.stringify(createTableDocument(1, 1)),
    });
    expect(plan.action).not.toBe("remove");
    expect(plan.action).toBe("update");
  });
});

describe("parseTabularText (R6.6)", () => {
  it("parses Excel TSV rows and cells", () => {
    const cells = parseTabularText("a\tb\tc\n1\t2\t3\n4\t5\t6");
    expect(cells).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("normalises CRLF line endings", () => {
    const cells = parseTabularText("a\tb\r\n1\t2");
    expect(cells).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("drops a trailing blank row", () => {
    const cells = parseTabularText("a\tb\n1\t2\n\t");
    expect(cells).toHaveLength(2);
  });

  it("rejects single-row and tab-free text", () => {
    expect(parseTabularText("a\tb")).toBeNull();
    expect(parseTabularText("a\nb")).toBeNull();
    expect(parseTabularText("")).toBeNull();
  });
});

describe("tabularToTableDocument (R6.6)", () => {
  it("builds a header-row table carrying the cell texts (RTL default)", () => {
    const doc = tabularToTableDocument([
      ["نام", "نمره"],
      ["علی", "۱۸"],
    ]);
    const table = doc.content?.[0];
    expect(table?.type).toBe("table");
    expect(table?.attrs?.dir).toBe("rtl");
    expect(table?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(table?.content?.[0]?.content?.[0]?.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "نام" }] },
    ]);
    expect(table?.content?.[1]?.content?.[1]?.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "۱۸" }] },
    ]);
  });

  it("keeps blank cells as empty paragraphs", () => {
    const doc = tabularToTableDocument(
      [
        ["a", ""],
        ["", "d"],
      ],
      "ltr",
    );
    const rows = doc.content?.[0]?.content ?? [];
    expect(rows[0]?.content?.[1]?.content).toEqual([{ type: "paragraph" }]);
    expect(rows[1]?.content?.[0]?.content).toEqual([{ type: "paragraph" }]);
    expect(doc.content?.[0]?.attrs?.dir).toBe("ltr");
  });
});
