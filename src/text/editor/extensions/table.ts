/**
 * TipTap table extensions (R6.1–R6.5): the prosemirror-tables family with
 * three project-specific augments on top:
 *
 * - `dir` attribute on the table node (R6.5): document-level table
 *   direction. `"rtl"` (the Persian-first default) renders column 1 on the
 *   RIGHT; `"ltr"` renders it on the left. The attribute round-trips
 *   through the serialized static HTML, so live and static rendering agree.
 * - `backgroundColor` attribute on cells and header cells (R6.4): per-cell
 *   background colour kept as an inline style on `<td>`/`<th>`.
 * - `valign` attribute on cells and header cells (R6.4): per-cell vertical
 *   alignment (top/middle/bottom) kept as `vertical-align` inline style —
 *   settable per cell AND per multi-cell selection, surviving save/load
 *   through the static HTML round-trip.
 * - `preset` attribute on the table node (R6.4): the named border/zebra
 *   style preset (see `TABLE_STYLE_PRESETS` and the CSS in globals.css)
 *   rendered as `data-table-preset` — theme-aware, zero per-cell data.
 *
 * Column resizing is enabled (R6.3): the columnresizing plugin stores
 * `colwidth` on cells and renders `<colgroup>` both live (node view) and
 * static (renderHTML), so drag-adjusted widths persist through save/load.
 */
import TableBase, {
  TableView as TableViewBase,
  type TableOptions,
} from "@tiptap/extension-table";
import TableRowBase from "@tiptap/extension-table-row";
import TableCellBase from "@tiptap/extension-table-cell";
import TableHeaderBase from "@tiptap/extension-table-header";
import type { Extensions } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** Document-level table direction (R6.5). */
export type TableDirection = "rtl" | "ltr";

/** Per-cell vertical alignment values (R6.4). */
export type CellVerticalAlign = "top" | "middle" | "bottom";

/** Every allowed vertical alignment (R6.4 menu order). */
export const CELL_VERTICAL_ALIGNMENTS: readonly CellVerticalAlign[] = [
  "top",
  "middle",
  "bottom",
];

/**
 * Parses/normalises a raw vertical-alignment value.
 *
 * @param value - the raw attribute / CSS value.
 * @returns "top" | "middle" | "bottom", or null when unset/invalid.
 */
export function coerceCellVerticalAlign(
  value: unknown,
): CellVerticalAlign | null {
  if (value === "top" || value === "middle" || value === "bottom") {
    return value;
  }
  // CSS `vertical-align: center` on table cells == middle.
  if (value === "center") {
    return "middle";
  }
  return null;
}

/** Named style presets rendered via `data-table-preset` (R6.4, ≥6). */
export const TABLE_STYLE_PRESETS = [
  "classic",
  "minimal",
  "zebra",
  "soft",
  "grid",
  "dark",
] as const;

/** Type of a named table style preset. */
export type TableStylePreset = (typeof TABLE_STYLE_PRESETS)[number];

/** Default preset applied to newly inserted tables. */
export const DEFAULT_TABLE_PRESET: TableStylePreset = "classic";

/** Default direction applied to newly inserted tables (Persian-first). */
export const DEFAULT_TABLE_DIRECTION: TableDirection = "rtl";

/**
 * Parses/normalises a raw preset string (e.g. from an imported JSON doc).
 *
 * @param value - the raw attribute value.
 * @returns a valid preset name (unknown values → the classic default).
 */
export function coerceTablePreset(value: unknown): TableStylePreset {
  return typeof value === "string" &&
    (TABLE_STYLE_PRESETS as readonly string[]).includes(value)
    ? (value as TableStylePreset)
    : "classic";
}

/**
 * Parses/normalises a raw table direction string.
 *
 * @param value - the raw attribute value.
 * @returns "rtl" or "ltr" (anything else → the RTL default).
 */
export function coerceTableDirection(value: unknown): TableDirection {
  return value === "ltr" ? "ltr" : "rtl";
}

/** Table node with `dir` + `preset` attributes and resizing enabled. */
const Table = TableBase.extend({
  addAttributes() {
    return {
      dir: {
        default: DEFAULT_TABLE_DIRECTION,
        parseHTML: (element) =>
          coerceTableDirection(element.getAttribute("dir")),
        renderHTML: (attributes) => ({
          dir: coerceTableDirection(attributes.dir),
        }),
      },
      preset: {
        default: DEFAULT_TABLE_PRESET,
        parseHTML: (element) =>
          coerceTablePreset(
            element.getAttribute("data-table-preset") ??
              element.getAttribute("preset"),
          ),
        renderHTML: (attributes) => ({
          "data-table-preset": coerceTablePreset(attributes.preset),
        }),
      },
    };
  },
});

/**
 * Live node view keeping `dir` + `data-table-preset` on the real `<table>`
 * element (the stock TableView only manages the colgroup; the static
 * serializer emits the attrs via renderHTML — this keeps live == static,
 * AC3A.1).
 */
class AttributedTableView extends TableViewBase {
  /** The real `<table>` element inside the wrapper (stock field). */
  declare readonly table: HTMLTableElement;

  /**
   * @param node - the table node.
   * @param cellMinWidth - the drag-resize minimum column width.
   * @param view - the editor view (unused by the stock view).
   */
  constructor(node: ProseMirrorNode, cellMinWidth: number, view?: EditorView) {
    super(node, cellMinWidth);
    this.syncTableAttributes(node);
    void view;
  }

  /**
   * @param node - the updated table node.
   * @returns whether the view handled the update.
   */
  update(node: ProseMirrorNode): boolean {
    const handled = super.update(node);
    if (handled) {
      this.syncTableAttributes(node);
    }
    return handled;
  }

  /** Mirrors the node's dir/preset attrs onto the table element. */
  private syncTableAttributes(node: ProseMirrorNode): void {
    this.table.setAttribute("dir", coerceTableDirection(node.attrs.dir));
    this.table.setAttribute(
      "data-table-preset",
      coerceTablePreset(node.attrs.preset),
    );
  }
}

/** Shared per-cell styling attributes (background + vertical alignment). */
const CELL_STYLE_ATTRIBUTES = {
  backgroundColor: {
    default: null as string | null,
    parseHTML: (element: HTMLElement): string | null =>
      element.style.backgroundColor || null,
    renderHTML: (
      attributes: Record<string, unknown>,
    ): Record<string, string> =>
      attributes.backgroundColor
        ? { style: `background-color: ${String(attributes.backgroundColor)}` }
        : {},
  },
  valign: {
    default: null as CellVerticalAlign | null,
    parseHTML: (element: HTMLElement): CellVerticalAlign | null =>
      coerceCellVerticalAlign(element.style.verticalAlign),
    renderHTML: (
      attributes: Record<string, unknown>,
    ): Record<string, string> =>
      attributes.valign
        ? { style: `vertical-align: ${String(attributes.valign)}` }
        : {},
  },
};

/** Cell node with per-cell background + vertical alignment (R6.4). */
const TableCell = TableCellBase.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...CELL_STYLE_ATTRIBUTES,
    };
  },
});

/** Header cell node with the same styling attributes (R6.4). */
const TableHeader = TableHeaderBase.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...CELL_STYLE_ATTRIBUTES,
    };
  },
});

/**
 * The configured table family for the shared editor.
 *
 * @param cellMinWidth - the minimum drag-resizable column width (R6.7).
 * @returns the four extensions (table/row/cell/header).
 */
export function createTableExtensions(cellMinWidth = 40): Extensions {
  return [
    Table.configure({
      resizable: true,
      lastColumnResizable: false,
      cellMinWidth,
      allowTableNodeSelection: false,
      View: AttributedTableView as unknown as NonNullable<TableOptions["View"]>,
    }),
    TableRowBase,
    TableCell,
    TableHeader,
  ];
}
