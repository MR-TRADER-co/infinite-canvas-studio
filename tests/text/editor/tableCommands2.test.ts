// @vitest-environment jsdom
/**
 * Live editor table-command tests (R6.2/R6.3/R6.4/R6.5/R6.8, AC6.8):
 * per-cell vertical alignment (set/probe/round-trip/static HTML/one undo
 * step), axis-aware cell splitting (horizontal keeps colspan, vertical
 * keeps rowspan), uniform column distribution (doc-level colwidth writes
 * + the pure planner), direction-aware visual column insertion, the RTL
 * rendering contract (dir attribute on the live table element) and the
 * direction-aware navigation (Tab/goToNextCell follows the logical order
 * that RTL renders right-to-left).
 */
import { describe, expect, it } from "vitest";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection, goToNextCell } from "@tiptap/pm/tables";
import { undoDepth } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { getSharedTextEditor } from "@/text/editor/TipTapFactory";
import { renderRichTextHTML } from "@/text/editor/TipTapFactory";
import type { RichTextDocument } from "@/text/editor/richtext";
import {
  canSplitCellAlongAxis,
  currentCellVerticalAlign,
  distributeTableColumns,
  findTableAncestor,
  insertColumnVisual,
  logicalInsertForSide,
  planColumnDistribution,
  selectedCellPositions,
  setCellVerticalAlign,
  splitCellAlongAxis,
  tableColumnWidths,
} from "@/text/editor/tableCommands";

/** The service under test (module singleton). */
const service = getSharedTextEditor();

/** Cell node JSON shape used by the hand-built table documents. */
interface CellSpec {
  readonly colspan?: number;
  readonly rowspan?: number;
  readonly colwidth?: number[] | null;
  readonly text?: string;
  readonly valign?: string | null;
}

/** Builds a table document JSON from a row×cell spec matrix. */
function tableDocument(
  rows: readonly (readonly CellSpec[])[],
  dir: "rtl" | "ltr" = "rtl",
): RichTextDocument {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        attrs: { dir, preset: "classic" },
        content: rows.map((cells, rowIndex) => ({
          type: "tableRow",
          content: cells.map((cell) => ({
            type: rowIndex === 0 ? "tableHeader" : "tableCell",
            attrs: {
              colspan: cell.colspan ?? 1,
              rowspan: cell.rowspan ?? 1,
              colwidth: cell.colwidth ?? null,
              backgroundColor: null,
              valign: cell.valign ?? null,
            },
            content: [
              {
                type: "paragraph",
                ...(cell.text === undefined
                  ? {}
                  : { content: [{ type: "text", text: cell.text }] }),
              },
            ],
          })),
        })),
      },
    ],
  };
}

/** Loads a document and places the caret inside the Nth cell's paragraph. */
function caretIntoCell(index: number): void {
  const editor = service.getEditor();
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      // The first text position inside the cell's first paragraph.
      positions.push(pos + node.nodeSize - 2);
    }
    return true;
  });
  const target = positions[index];
  expect(target, `cell #${index} not found`).not.toBeUndefined();
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, target ?? 0),
    ),
  );
}

/** Collects the cell nodes of the loaded document in document order. */
function cells(): {
  node: ProseMirrorNode;
  pos: number;
}[] {
  const found: { node: ProseMirrorNode; pos: number }[] = [];
  service.getEditor().state.doc.descendants((node, pos) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      found.push({ node, pos });
    }
    return true;
  });
  return found;
}

describe("setCellVerticalAlign (R6.4 — per cell AND per selection)", () => {
  it("a caret sets its own cell's alignment and one undo restores it", () => {
    service.loadDocument(
      tableDocument([
        [{}, {}],
        [{}, {}],
      ]),
      "",
      "obj-va1",
    );
    const editor = service.getEditor();
    caretIntoCell(1);
    expect(setCellVerticalAlign(editor, "middle")).toBe(true);
    expect(cells()[1]?.node.attrs.valign).toBe("middle");
    expect(cells()[0]?.node.attrs.valign).toBeNull();
    // One undo step (R6.8).
    expect(undoDepth(editor.state)).toBeGreaterThan(0);
    editor.commands.undo();
    expect(cells()[1]?.node.attrs.valign).toBeNull();
  });

  it("a multi-cell CellSelection sets every covered cell at once", () => {
    service.loadDocument(
      tableDocument([[{ text: "a" }, { text: "b" }, { text: "c" }]]),
      "",
      "obj-va2",
    );
    const editor = service.getEditor();
    const positions = cells();
    const anchor = positions[0]?.pos as number;
    const head = positions[1]?.pos as number;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        new CellSelection(
          editor.state.doc.resolve(anchor),
          editor.state.doc.resolve(head),
        ),
      ),
    );
    expect(selectedCellPositions(editor)).toHaveLength(2);
    expect(setCellVerticalAlign(editor, "bottom")).toBe(true);
    expect(cells()[0]?.node.attrs.valign).toBe("bottom");
    expect(cells()[1]?.node.attrs.valign).toBe("bottom");
    expect(cells()[2]?.node.attrs.valign).toBeNull();
  });

  it("currentCellVerticalAlign resolves the shared value (null on mix)", () => {
    service.loadDocument(
      tableDocument([
        [{ valign: "top" }, { valign: "top" }],
        [{ valign: "middle" }, {}],
      ]),
      "",
      "obj-va3",
    );
    const editor = service.getEditor();
    caretIntoCell(0);
    expect(currentCellVerticalAlign(editor)).toBe("top");
    caretIntoCell(2);
    expect(currentCellVerticalAlign(editor)).toBe("middle");
    caretIntoCell(3);
    expect(currentCellVerticalAlign(editor)).toBeNull();
  });

  it("survives the JSON document round-trip and the static HTML render", () => {
    service.loadDocument(
      tableDocument([[{ valign: "middle", text: "میانه" }], [{}]]),
      "",
      "obj-va4",
    );
    const doc = service.getDocument();
    const cell = doc.content?.[0]?.content?.[0]?.content?.[0];
    expect(cell?.attrs?.valign).toBe("middle");
    // Static render carries the inline style (AC3A.1 live == static).
    const html = renderRichTextHTML(service.getSchema(), doc);
    expect(html).toContain("vertical-align: middle");
  });
});

describe("splitCellAlongAxis (R6.2 — split cell h + v)", () => {
  it("vertical split carves a colspan-2 cell into two rowspan-keeping cells", () => {
    // Row 0: one cell spanning both columns; row 1: two unit cells.
    service.loadDocument(
      tableDocument([
        [{ colspan: 2, colwidth: [30, 40], text: "M" }],
        [{ text: "a" }, { text: "b" }],
      ]),
      "",
      "obj-sp1",
    );
    const editor = service.getEditor();
    caretIntoCell(0);
    expect(canSplitCellAlongAxis(editor, "column")).toBe(true);
    expect(canSplitCellAlongAxis(editor, "row")).toBe(false);
    expect(splitCellAlongAxis(editor, "column")).toBe(true);
    // Row 0 now has TWO cells, each colspan 1; the colwidth is carved.
    const rowCells = cells().slice(0, 2);
    expect(rowCells[0]?.node.attrs.colspan).toBe(1);
    expect(rowCells[1]?.node.attrs.colspan).toBe(1);
    expect(rowCells[0]?.node.attrs.colwidth).toEqual([30]);
    expect(rowCells[1]?.node.attrs.colwidth).toEqual([40]);
    expect(rowCells.map((cell) => cell.node.textContent)).toEqual(["M", ""]);
    expect(rowCells.map((cell) => cell.node.attrs.rowspan)).toEqual([1, 1]);
  });

  it("horizontal split carves a rowspan-2 cell into one cell per row", () => {
    // Column 0: one cell spanning both rows; column 1: two unit cells.
    service.loadDocument(
      tableDocument([
        [{ rowspan: 2, text: "M" }, { text: "a" }],
        [{ text: "b" }],
      ]),
      "",
      "obj-sp2",
    );
    const editor = service.getEditor();
    caretIntoCell(0);
    expect(canSplitCellAlongAxis(editor, "row")).toBe(true);
    expect(splitCellAlongAxis(editor, "row")).toBe(true);
    // The merged cell collapses to rowspan 1 and a new cell joins row 1.
    const all = cells();
    expect(all).toHaveLength(4);
    expect(all[0]?.node.attrs.rowspan).toBe(1);
    // Row 1 now holds TWO cells (the new split cell + the existing one).
    const table = findTableAncestor(editor)?.node;
    expect(table?.childCount).toBe(2);
    expect(table?.child(1)?.childCount).toBe(2);
  });

  it("one undo step restores the merged cell (R6.8)", () => {
    service.loadDocument(
      tableDocument([[{ colspan: 2 }], [{}, {}]]),
      "",
      "obj-sp3",
    );
    const editor = service.getEditor();
    caretIntoCell(0);
    splitCellAlongAxis(editor, "column");
    const after = JSON.stringify(service.getDocument());
    expect(after).not.toContain('"colspan":2');
    editor.commands.undo();
    const restored = JSON.stringify(service.getDocument());
    expect(restored).toContain('"colspan":2');
  });

  it("a 1×1 cell refuses both axis splits", () => {
    service.loadDocument(
      tableDocument([
        [{}, {}],
        [{}, {}],
      ]),
      "",
      "obj-sp4",
    );
    const editor = service.getEditor();
    caretIntoCell(2);
    expect(canSplitCellAlongAxis(editor, "row")).toBe(false);
    expect(canSplitCellAlongAxis(editor, "column")).toBe(false);
    expect(splitCellAlongAxis(editor, "row")).toBe(false);
    expect(splitCellAlongAxis(editor, "column")).toBe(false);
  });
});

describe("planColumnDistribution (R6.3 — the pure planner)", () => {
  it("distributes the total equally, remainder to the first columns", () => {
    expect(planColumnDistribution([100, 60, 20])).toEqual([60, 60, 60]);
    expect(planColumnDistribution([10, 10, 10])).toEqual([10, 10, 10]);
    expect(planColumnDistribution([12, 11, 9])).toEqual([11, 11, 10]);
    expect(planColumnDistribution([7])).toEqual([7]);
  });

  it("the minimum wins when the total cannot honour it", () => {
    expect(planColumnDistribution([50, 50, 50], 40)).toEqual([50, 50, 50]);
    expect(planColumnDistribution([30, 30, 30], 40)).toEqual([40, 40, 40]);
  });

  it("handles empty input and non-positive widths", () => {
    expect(planColumnDistribution([])).toEqual([]);
    expect(planColumnDistribution([0, -10, 9])).toEqual([3, 3, 3]);
  });
});

describe("distributeTableColumns (R6.3 — the doc-level write)", () => {
  it("writes the equal share onto every cell's colwidth", () => {
    service.loadDocument(
      tableDocument([
        [
          { colwidth: [100], text: "a" },
          { colwidth: [60], text: "b" },
          { colwidth: [20], text: "c" },
        ],
        [{ colwidth: [100] }, { colwidth: [60] }, { colwidth: [20] }],
      ]),
      "",
      "obj-dist1",
    );
    const editor = service.getEditor();
    caretIntoCell(0);
    expect(distributeTableColumns(editor, { minWidth: 40 })).toBe(true);
    for (const cell of cells()) {
      expect(cell.node.attrs.colwidth).toEqual([60]);
    }
    // One undo step (R6.8).
    editor.commands.undo();
    expect(cells()[0]?.node.attrs.colwidth).toEqual([100]);
  });

  it("carves spans: a colspan-2 cell gets the two-column slice", () => {
    service.loadDocument(
      tableDocument([
        [{ colspan: 2, colwidth: [100, 50] }, { colwidth: [20] }],
        [{}, {}, {}],
      ]),
      "",
      "obj-dist2",
    );
    const editor = service.getEditor();
    caretIntoCell(0);
    expect(distributeTableColumns(editor, { minWidth: 10 })).toBe(true);
    const first = cells()[0]?.node.attrs.colwidth;
    expect(first).toEqual([57, 57]);
    expect(cells()[1]?.node.attrs.colwidth).toEqual([56]);
  });

  it("bails on never-resized auto tables without a fallback", () => {
    service.loadDocument(
      tableDocument([
        [{}, {}],
        [{}, {}],
      ]),
      "",
      "obj-dist3",
    );
    const editor = service.getEditor();
    caretIntoCell(0);
    expect(distributeTableColumns(editor, { minWidth: 40 })).toBe(false);
  });

  it("tableColumnWidths gathers per-column widths with null gaps", () => {
    service.loadDocument(
      tableDocument([[{ colwidth: [100] }, {}, { colwidth: [20] }]]),
      "",
      "obj-dist4",
    );
    const editor = service.getEditor();
    const table = findTableAncestor(editor);
    expect(table).not.toBeNull();
    if (table !== null) {
      expect(tableColumnWidths(table.node, 3)).toEqual([100, null, 20]);
    }
  });
});

describe("direction-aware column insertion (R6.2 / R6.5)", () => {
  it("logicalInsertForSide maps visual sides to logical inserts", () => {
    // RTL renders column 1 rightmost — growing leftwards is logical AFTER.
    expect(logicalInsertForSide("rtl", "left")).toBe("after");
    expect(logicalInsertForSide("rtl", "right")).toBe("before");
    expect(logicalInsertForSide("ltr", "left")).toBe("before");
    expect(logicalInsertForSide("ltr", "right")).toBe("after");
  });

  it("insertColumnVisual grows the table and keeps the doc valid", () => {
    service.loadDocument(
      tableDocument([
        [{ text: "A" }, { text: "B" }],
        [{ text: "a" }, { text: "b" }],
      ]),
      "rtl",
      "obj-dir1",
    );
    const editor = service.getEditor();
    caretIntoCell(0);
    expect(insertColumnVisual(editor, "left")).toBe(true);
    // Logical order after the "visual left" (RTL) insert: A, NEW, B.
    const row0 = cells().slice(0, 3);
    expect(row0).toHaveLength(3);
    const texts = row0.map((cell) => cell.node.textContent);
    expect(texts).toEqual(["A", "", "B"]);
  });
});

describe("RTL table rendering + navigation (R6.5 / AC6.8)", () => {
  it("the live table element carries dir=rtl (column 1 renders right)", () => {
    service.loadDocument(
      tableDocument([[{ text: "۱" }, { text: "۲" }]]),
      "",
      "obj-rtl",
    );
    const editor = service.getEditor();
    const table = findTableAncestor(editor);
    expect(table).not.toBeNull();
    if (table !== null) {
      const dom = editor.view.nodeDOM(table.pos);
      expect(dom).not.toBeNull();
      const element = dom instanceof Element ? dom : null;
      const tableElement =
        element instanceof HTMLTableElement
          ? element
          : (element?.querySelector("table") ?? null);
      expect(tableElement?.getAttribute("dir")).toBe("rtl");
    }
  });

  it("goToNextCell advances the logical order (visually LEFT in RTL)", () => {
    service.loadDocument(
      tableDocument([[{ text: "۱" }, { text: "۲" }, { text: "۳" }]]),
      "rtl",
      "obj-nav",
    );
    const editor = service.getEditor();
    caretIntoCell(0);
    // The Tab keymap's command: caret in the FIRST cell moves to the
    // LOGICAL second cell — which dir=rtl renders to the LEFT.
    const command = goToNextCell(1);
    expect(command(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
    const inSecond = cells()[1];
    expect(inSecond).toBeDefined();
    const { from } = editor.state.selection;
    expect(from).toBeGreaterThan(inSecond?.pos as number);
    expect(from).toBeLessThan(
      (inSecond?.pos as number) + (inSecond?.node.nodeSize as number),
    );
  });
});
