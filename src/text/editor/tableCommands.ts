/**
 * Editor-level table operations (R6.2–R6.5): the structural helpers the
 * table toolbar, the context menu commands and the command palette run
 * against the live shared editor. TipTap's built-in commands cover
 * rows/columns/merge/headers; the project-specific augments (table `dir`,
 * table `preset`, cell `backgroundColor`, cell `valign` R6.4, axis-aware
 * cell splitting R6.2, uniform column distribution R6.3, direction-aware
 * visual column insertion R6.2) go through ProseMirror transactions
 * dispatched via the editor view — they land in the TipTap history, so
 * every change is one undo step (R6.8).
 */
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { CellSelection, selectedRect } from "@tiptap/pm/tables";
import { currentBlockDirection } from "./extensions/Direction";
import {
  coerceCellVerticalAlign,
  coerceTableDirection,
  coerceTablePreset,
  type CellVerticalAlign,
  type TableDirection,
  type TableStylePreset,
} from "./extensions/table";

/** Anything with a ProseMirror state (selection probes). */
export interface SelectionHost {
  readonly state: EditorState;
}

/** Anything with a ProseMirror state + view (dispatching helpers). */
export interface EditorHost extends SelectionHost {
  readonly view: EditorView;
}

/** Names of the two cell node kinds. */
const CELL_NODE_TYPES = new Set(["tableCell", "tableHeader"]);

/**
 * Collects the document positions of every cell covered by the selection
 * (R6.4 per-cell styling contract): a caret resolves its own ancestor
 * cell; a CellSelection iterates its covered cells through the library's
 * own `forEachCell` (the from/to range alone misses the head cell); a
 * plain text range covers each intersecting cell.
 *
 * @param host - anything exposing an editor state.
 * @returns the covered cell positions (empty outside tables).
 */
export function selectedCellPositions(host: SelectionHost): number[] {
  const { selection } = host.state;
  if (selection instanceof CellSelection) {
    const positions: number[] = [];
    selection.forEachCell((node, pos) => {
      if (CELL_NODE_TYPES.has(node.type.name)) {
        positions.push(pos);
      }
    });
    return positions;
  }
  const positions: number[] = [];
  host.state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (CELL_NODE_TYPES.has(node.type.name)) {
      positions.push(pos);
    }
    return true;
  });
  if (positions.length === 0 && isSelectionInTable(host)) {
    // Caret inside a cell without a text selection: nodesBetween over a
    // collapsed range yields nothing — resolve the ancestor cell instead.
    const { $from } = selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (CELL_NODE_TYPES.has(node.type.name)) {
        positions.push($from.before(depth));
        break;
      }
    }
  }
  return positions;
}

/** An resolved table ancestor: the node and its document position. */
export interface TableAncestor {
  /** The table node containing the selection. */
  readonly node: ProseMirrorNode;
  /** The position of the table node in the document. */
  readonly pos: number;
}

/**
 * Finds the table node containing the selection (if any).
 *
 * @param host - anything exposing an editor state (Editor or raw view).
 * @returns the table node + position, or null when the caret is outside
 *          every table.
 */
export function findTableAncestor(host: SelectionHost): TableAncestor | null {
  const { $from } = host.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "table") {
      return { node, pos: $from.before(depth) };
    }
  }
  return null;
}

/**
 * @param host - anything exposing an editor state.
 * @returns whether the selection (caret or range) sits inside a table.
 */
export function isSelectionInTable(host: SelectionHost): boolean {
  return findTableAncestor(host) !== null;
}

/**
 * Resolves the direction attribute of the table containing the selection.
 *
 * @param host - anything exposing an editor state.
 * @returns the table direction, or null outside tables.
 */
export function currentTableDirection(
  host: SelectionHost,
): TableDirection | null {
  return coerceTableDirection(findTableAncestor(host)?.node.attrs.dir);
}

/**
 * Resolves the preset attribute of the table containing the selection.
 *
 * @param host - anything exposing an editor state.
 * @returns the preset name, or null outside tables.
 */
export function currentTablePreset(
  host: SelectionHost,
): TableStylePreset | null {
  return coerceTablePreset(findTableAncestor(host)?.node.attrs.preset);
}

/**
 * Sets the `dir` attribute of the table containing the selection (R6.5).
 *
 * @param host - the editor host (state + view).
 * @param dir - the new direction.
 * @returns whether a table was found and updated.
 */
export function setTableDirection(
  host: EditorHost,
  dir: TableDirection,
): boolean {
  const table = findTableAncestor(host);
  if (table === null) {
    return false;
  }
  const attrs = { ...table.node.attrs, dir };
  host.view.dispatch(host.state.tr.setNodeMarkup(table.pos, undefined, attrs));
  return true;
}

/**
 * Sets the `preset` attribute of the table containing the selection (R6.4).
 *
 * @param host - the editor host (state + view).
 * @param preset - the preset name.
 * @returns whether a table was found and updated.
 */
export function setTablePreset(
  host: EditorHost,
  preset: TableStylePreset,
): boolean {
  const table = findTableAncestor(host);
  if (table === null) {
    return false;
  }
  const attrs = { ...table.node.attrs, preset };
  host.view.dispatch(host.state.tr.setNodeMarkup(table.pos, undefined, attrs));
  return true;
}

/**
 * Sets the background colour of every cell covered by the selection
 * (R6.4): a caret updates its own cell; a cell range (drag or Ctrl-drag)
 * updates each covered cell; `null` clears the colour.
 *
 * @param host - the editor host (state + view).
 * @param color - the CSS colour, or null to clear.
 * @returns whether at least one cell was updated.
 */
export function setCellBackground(
  host: EditorHost,
  color: string | null,
): boolean {
  const cellPositions = selectedCellPositions(host);
  if (cellPositions.length === 0) {
    return false;
  }
  let transaction = host.state.tr;
  for (const pos of cellPositions) {
    const node = transaction.doc.nodeAt(pos);
    if (node === null) {
      continue;
    }
    const attrs = { ...node.attrs, backgroundColor: color };
    transaction = transaction.setNodeMarkup(pos, undefined, attrs);
  }
  host.view.dispatch(transaction);
  return true;
}

/**
 * Sets the vertical alignment of every cell covered by the selection
 * (R6.4): a caret updates its own cell; a cell range (drag or Ctrl-drag)
 * updates each covered cell — "per cell AND per selection".
 *
 * @param host - the editor host (state + view).
 * @param align - the vertical alignment (null = theme default = top).
 * @returns whether at least one cell was updated.
 */
export function setCellVerticalAlign(
  host: EditorHost,
  align: CellVerticalAlign | null,
): boolean {
  const cellPositions = selectedCellPositions(host);
  if (cellPositions.length === 0) {
    return false;
  }
  let transaction = host.state.tr;
  for (const pos of cellPositions) {
    const node = transaction.doc.nodeAt(pos);
    if (node === null) {
      continue;
    }
    const attrs = { ...node.attrs, valign: align };
    transaction = transaction.setNodeMarkup(pos, undefined, attrs);
  }
  host.view.dispatch(transaction);
  return true;
}

/**
 * Resolves the shared vertical alignment of the selected cells (the menu's
 * active state), preferring null on mismatch.
 *
 * @param host - anything exposing an editor state.
 * @returns the alignment, or null when no cell/alignment is active.
 */
export function currentCellVerticalAlign(
  host: SelectionHost,
): CellVerticalAlign | null {
  const positions = selectedCellPositions(host);
  if (positions.length === 0) {
    return null;
  }
  let shared: CellVerticalAlign | null | undefined;
  for (const pos of positions) {
    const node = host.state.doc.nodeAt(pos);
    if (node === null) {
      continue;
    }
    const value = coerceCellVerticalAlign(node.attrs.valign);
    if (shared === undefined) {
      shared = value;
    } else if (shared !== value) {
      shared = null;
    }
  }
  return shared === undefined ? null : shared;
}

/**
 * Resolves the shared background colour of the selected cells (for the
 * palette's active swatch), preferring null on mismatch.
 *
 * @param host - anything exposing an editor state.
 * @returns the CSS colour, or null when no cell/colour is active.
 */
export function currentCellBackground(host: SelectionHost): string | null {
  const { selection } = host.state;
  let found: string | null | undefined;
  const consider = (value: unknown): void => {
    const color = typeof value === "string" && value !== "" ? value : null;
    if (found === undefined) {
      found = color;
    } else if (found !== color) {
      found = null;
    }
  };
  host.state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (CELL_NODE_TYPES.has(node.type.name)) {
      consider(node.attrs.backgroundColor);
    }
    return true;
  });
  if (found === undefined && isSelectionInTable(host)) {
    const { $from } = selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (CELL_NODE_TYPES.has(node.type.name)) {
        consider(node.attrs.backgroundColor);
        break;
      }
    }
  }
  return found === undefined ? null : found;
}

/**
 * Inserts a table at the caret inheriting the surrounding block direction
 * (R6.5): Persian paragraphs create RTL tables (column 1 on the right),
 * Latin paragraphs create LTR ones.
 *
 * @param editor - the shared editor.
 * @param rows - the row count.
 * @param cols - the column count.
 * @param withHeaderRow - whether the first row is a header row.
 * @returns whether the insert ran.
 */
export function insertTableInheritingDirection(
  editor: Editor,
  rows: number,
  cols: number,
  withHeaderRow = true,
): boolean {
  const blockDir = currentBlockDirection(editor);
  const ran = editor
    .chain()
    .focus()
    .insertTable({ rows, cols, withHeaderRow })
    .run();
  if (ran && blockDir === "ltr") {
    // The node defaults build RTL tables; flip an LTR surrounding.
    setTableDirection(editor, "ltr");
  }
  return ran;
}

/* ── Axis-aware cell splitting (R6.2: "split cell h + v") ───────────────
 * TipTap's stock `splitCell` fully explodes a merged cell into unit
 * cells. The table menu needs the two ONE-AXIS variants Word offers:
 * splitting a 2×2 merged cell HORIZONTALLY keeps two row-spanning cells
 * (one per row, colspan intact); VERTICALLY it keeps two column cells
 * (rowspan intact). Both are modelled on the stock algorithm (position
 * resolution through TableMap.positionAt) so insert order, colwidth
 * carving and selection restore match the library's own behaviour. */

/** The two split axes offered by the table menu (R6.2). */
export type SplitCellAxis = "row" | "column";

/**
 * Resolves the single selected cell (caret cell or a single-cell
 * CellSelection) — the split target.
 *
 * @param host - anything exposing an editor state.
 * @returns the cell node + its position, or null (no cell / multi-cell).
 */
function resolveSplitTarget(
  host: SelectionHost,
): { node: ProseMirrorNode; pos: number } | null {
  const { selection } = host.state;
  if (selection instanceof CellSelection) {
    if (selection.$anchorCell.pos !== selection.$headCell.pos) {
      return null;
    }
    const node = selection.$anchorCell.nodeAfter;
    if (node === null || node === undefined) {
      return null;
    }
    return { node, pos: selection.$anchorCell.pos };
  }
  // Caret: walk up to the ancestor cell.
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (CELL_NODE_TYPES.has(node.type.name)) {
      return { node, pos: $from.before(depth) };
    }
  }
  return null;
}

/**
 * Whether an axis split is applicable: the target cell's span along the
 * axis must exceed one (a 1×1 cell can never split).
 *
 * @param host - anything exposing an editor state.
 * @param axis - the split axis.
 * @returns whether {@link splitCellAlongAxis} would act.
 */
export function canSplitCellAlongAxis(
  host: SelectionHost,
  axis: SplitCellAxis,
): boolean {
  const target = resolveSplitTarget(host);
  if (target === null) {
    return false;
  }
  return axis === "row"
    ? target.node.attrs.rowspan > 1
    : target.node.attrs.colspan > 1;
}

/**
 * Splits the selected merged cell along ONE axis (R6.2): "row" keeps the
 * colspan and gives every spanned row its own cell (horizontal split);
 * "column" keeps the rowspan and gives every spanned column its own cell
 * (vertical split). One transaction → one undo step (R6.8).
 *
 * @param host - the editor host (state + view).
 * @param axis - the split axis.
 * @returns whether the split ran (span ≤ 1 along the axis → false).
 */
export function splitCellAlongAxis(
  host: EditorHost,
  axis: SplitCellAxis,
): boolean {
  const target = resolveSplitTarget(host);
  if (target === null || !canSplitCellAlongAxis(host, axis)) {
    return false;
  }
  const { node: cellNode, pos: cellPos } = target;
  const cellType = cellNode.type;
  const rect = selectedRect(host.state);
  const tr = host.state.tr;
  const colwidth = cellNode.attrs.colwidth as number[] | null;
  let lastInserted: number | null = null;
  if (axis === "row") {
    // Horizontal split: one new cell per spanned row BELOW the origin,
    // each keeping the full colspan (and its colwidth list).
    const attrs = { ...cellNode.attrs, rowspan: 1 };
    for (let row = rect.top + 1; row < rect.bottom; row += 1) {
      const pos = rect.map.positionAt(row, rect.left, rect.table);
      const at = tr.mapping.map(pos + rect.tableStart, 1);
      const created = cellType.createAndFill(attrs);
      if (created !== null) {
        tr.insert(at, created);
        lastInserted = at;
      }
    }
    // Origin cell: rowspan collapses to one, colspan/colwidth untouched.
    tr.setNodeMarkup(cellPos, undefined, attrs);
  } else {
    // Vertical split: one new cell per spanned column RIGHT of the
    // origin, each keeping the full rowspan with a carved colwidth.
    const baseAttrs = { ...cellNode.attrs, colspan: 1 };
    const after = cellPos + cellNode.nodeSize;
    for (let col = rect.left + 1; col < rect.right; col += 1) {
      const attrs = {
        ...baseAttrs,
        colwidth:
          colwidth !== null && colwidth[col - rect.left] != null
            ? [colwidth[col - rect.left] as number]
            : null,
      };
      const at = tr.mapping.map(after, 1);
      const created = cellType.createAndFill(attrs);
      if (created !== null) {
        tr.insert(at, created);
        lastInserted = at;
      }
    }
    // Origin cell: colspan collapses to one with its carved colwidth.
    const originAttrs = {
      ...baseAttrs,
      colwidth:
        colwidth !== null && colwidth[0] != null
          ? [colwidth[0] as number]
          : null,
    };
    tr.setNodeMarkup(cellPos, undefined, originAttrs);
  }
  const { selection } = host.state;
  if (selection instanceof CellSelection && lastInserted !== null) {
    tr.setSelection(
      new CellSelection(
        tr.doc.resolve(selection.$anchorCell.pos),
        tr.doc.resolve(lastInserted),
      ),
    );
  }
  host.view.dispatch(tr);
  return true;
}

/* ── Uniform column distribution (R6.3) ───────────────────────────────── */

/**
 * Pure planner: distributes a total width across N columns equally with a
 * per-column minimum. When the total cannot honour the minimum (total <
 * count × minimum) every column takes the minimum and the total grows;
 * otherwise the equal share already clears the minimum and the sum is
 * preserved exactly, leftover pixels going to the FIRST columns.
 *
 * @param widths - the current per-column widths (length = column count).
 * @param minWidth - the per-column minimum (non-positive → no clamping).
 * @returns the distributed widths (same length).
 */
export function planColumnDistribution(
  widths: readonly number[],
  minWidth = 0,
): number[] {
  const count = widths.length;
  if (count === 0) {
    return [];
  }
  const total = widths.reduce((sum, width) => sum + Math.max(0, width), 0);
  const minimum = Math.max(0, minWidth);
  if (minimum > 0 && total < count * minimum) {
    // The minimum wins over exact-sum preservation.
    return Array.from({ length: count }, () => minimum);
  }
  const share = Math.floor(total / count);
  const result = Array.from({ length: count }, () => share);
  let remainder = total - share * count;
  for (let index = 0; remainder > 0 && index < count; index += 1) {
    result[index] = (result[index] ?? share) + 1;
    remainder -= 1;
  }
  return result;
}

/**
 * Gathers the per-column widths of a table node from its cells' `colwidth`
 * attributes (the column-resizing storage): the first non-null entry per
 * grid column wins; columns never resized yield null.
 *
 * @param table - the table node.
 * @param columnCount - the grid column count (TableMap width).
 * @returns per-column width or null when the column was never resized.
 */
export function tableColumnWidths(
  table: ProseMirrorNode,
  columnCount: number,
): (number | null)[] {
  const widths: (number | null)[] = Array.from(
    { length: columnCount },
    () => null,
  );
  table.forEach((row) => {
    if (row.type.name !== "tableRow") {
      return;
    }
    let column = 0;
    row.forEach((cell) => {
      const colspan = Math.max(1, cell.attrs.colspan ?? 1);
      const colwidth = cell.attrs.colwidth as number[] | null;
      for (
        let index = 0;
        index < colspan && column + index < columnCount;
        index += 1
      ) {
        const value = colwidth?.[index] ?? null;
        if (value !== null && widths[column + index] === null) {
          widths[column + index] = value;
        }
      }
      column += colspan;
    });
  });
  return widths;
}

/** Options of {@link distributeTableColumns}. */
export interface DistributeColumnsOptions {
  /** Minimum per-column width (the resize plugin's cellMinWidth). */
  readonly minWidth?: number;
  /** Fallback width for never-resized columns (DOM measure failed). */
  readonly fallbackWidth?: number;
}

/**
 * Uniformly distributes the widths of the table containing the selection
 * (R6.3): the CURRENT total stays fixed, every column gets an equal share
 * (clamped by the minimum). Widths write back through every cell's
 * `colwidth` attribute — the same channel the drag-resize plugin uses, so
 * the live colgroup AND the serialized document both update. One
 * transaction → one undo step (R6.8).
 *
 * @param host - the editor host (state + view).
 * @param options - min/fallback widths.
 * @returns whether a table was found and redistributed.
 */
export function distributeTableColumns(
  host: EditorHost,
  options: DistributeColumnsOptions = {},
): boolean {
  const table = findTableAncestor(host);
  if (table === null) {
    return false;
  }
  const { minWidth = 0, fallbackWidth = 0 } = options;
  const columnCount = countGridColumns(table.node);
  const current = tableColumnWidths(table.node, columnCount);
  // Never-resized columns adopt the MEASURED fallback only (a zero
  // fallback — auto layout, no DOM measurement — makes the whole pass
  // bail rather than inventing widths).
  const resolved = current.map((width) => width ?? fallbackWidth);
  const total = resolved.reduce((sum, width) => sum + Math.max(0, width), 0);
  if (total <= 0) {
    // Auto-layout table that was never drag-resized and carries no
    // measurable fallback — nothing sensible to distribute.
    return false;
  }
  const distributed = planColumnDistribution(resolved, minWidth);
  let tr = host.state.tr;
  table.node.forEach((row, rowOffset) => {
    if (row.type.name !== "tableRow") {
      return;
    }
    let column = 0;
    row.forEach((cell, cellOffset) => {
      const colspan = Math.max(1, cell.attrs.colspan ?? 1);
      const slice = distributed.slice(column, column + colspan);
      const attrs = {
        ...cell.attrs,
        colwidth: slice.length === colspan ? [...slice] : null,
      };
      const pos = table.pos + 1 + rowOffset + 1 + cellOffset;
      tr = tr.setNodeMarkup(pos, undefined, attrs);
      column += colspan;
    });
  });
  host.view.dispatch(tr);
  return true;
}

/**
 * Counts the grid columns of a table node (max of the per-row colspan
 * sums — handles rows shorter than the first).
 *
 * @param table - the table node.
 * @returns the grid column count.
 */
function countGridColumns(table: ProseMirrorNode): number {
  let width = 0;
  table.forEach((row) => {
    if (row.type.name !== "tableRow") {
      return;
    }
    let rowWidth = 0;
    row.forEach((cell) => {
      rowWidth += Math.max(1, cell.attrs.colspan ?? 1);
    });
    width = Math.max(width, rowWidth);
  });
  return width;
}

/**
 * Measures the live DOM width of a table, divided by its grid column
 * count — the distribution fallback for never-resized (auto-layout)
 * tables whose `colwidth` attributes are all null. Returns 0 whenever
 * the table or its element is unreachable (headless/jsdom contexts).
 *
 * @param host - the editor host (state + view).
 * @param table - the resolved table ancestor (null → 0).
 * @returns the per-column DOM width, or 0 when unmeasurable.
 */
export function measureTableColumnFallbackWidth(
  host: EditorHost,
  table: TableAncestor | null,
): number {
  if (table === null) {
    return 0;
  }
  const dom = host.view.nodeDOM(table.pos);
  if (dom === null) {
    return 0;
  }
  const element =
    dom instanceof HTMLTableElement
      ? dom
      : dom instanceof HTMLElement
        ? (dom.querySelector("table") ?? dom)
        : null;
  if (element === null) {
    return 0;
  }
  const total = element.clientWidth;
  if (total <= 0) {
    return 0;
  }
  const columns = countGridColumns(table.node);
  return columns > 0 ? total / columns : 0;
}

/* ── Direction-aware visual column insertion (R6.2) ───────────────────── */

/** Physical side a column insert targets (VISUAL semantics, R6.2). */
export type VisualColumnSide = "left" | "right";

/**
 * Resolves which LOGICAL TipTap command inserts a column on the given
 * VISUAL side under the table's current direction (R6.2 "direction-aware
 * for RTL"): RTL renders column 1 rightmost, so the logical "after" side
 * is visually LEFT.
 *
 * @param direction - the table direction.
 * @param side - the visual side to insert on.
 * @returns the logical insert: "before" (lower column index) or "after".
 */
export function logicalInsertForSide(
  direction: TableDirection,
  side: VisualColumnSide,
): "before" | "after" {
  if (direction === "rtl") {
    // Column 1 sits on the right: growing leftwards = logically after.
    return side === "left" ? "after" : "before";
  }
  return side === "left" ? "before" : "after";
}

/**
 * Inserts a column on the VISUAL side of the caret's column, honouring
 * the table direction (R6.2). RTL: "left" = logical after; LTR: "left" =
 * logical before.
 *
 * @param editor - the shared editor.
 * @param side - the visual side.
 * @returns whether the insert ran.
 */
export function insertColumnVisual(
  editor: Editor,
  side: VisualColumnSide,
): boolean {
  const direction = currentTableDirection(editor) ?? "rtl";
  const logical = logicalInsertForSide(direction, side);
  const chain = editor.chain().focus();
  return logical === "before"
    ? chain.addColumnBefore().run()
    : chain.addColumnAfter().run();
}

/**
 * Whether a visual column insert is available (caret in a table and the
 * logical insert applicable).
 *
 * @param editor - the shared editor.
 * @returns whether {@link insertColumnVisual} can act.
 */
export function canInsertColumnVisual(editor: Editor): boolean {
  return isSelectionInTable(editor) && editor.can().addColumnBefore();
}

/**
 * Toggles the direction of the table containing the selection (R6.5).
 *
 * @param host - the editor host (state + view).
 * @returns whether a table was found and flipped.
 */
export function toggleTableDirection(host: EditorHost): boolean {
  const current = currentTableDirection(host);
  if (current === null) {
    return false;
  }
  return setTableDirection(host, current === "rtl" ? "ltr" : "rtl");
}
