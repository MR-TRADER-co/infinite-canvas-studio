/**
 * Rich text document model: the TipTap JSON document exchanged between the
 * editor, the object model and persistence (CLAUDE.md §1.1).
 *
 * The document is the plain TipTap `JSONContent` tree — schema-typed by the
 * shared editor (see `text/editor/TipTapFactory`) — so serialisation
 * round-trips losslessly through `JSON.parse(JSON.stringify(doc))`
 * (`editor.getJSON()` → `editor.commands.setContent(doc)`).
 *
 * All helpers here are pure and DOM-free (node-testable): plain-text
 * conversion for legacy objects and the commit planner, emptiness checks,
 * stable serialisation for change detection and direction heuristics for the
 * RTL growth anchor.
 */
import type { JSONContent } from "@tiptap/core";

/** A rich text document (TipTap JSON with a `doc` root). */
export type RichTextDocument = JSONContent & { readonly type: "doc" };

/**
 * Block node types the direction global attribute applies to (R3A.5). Block
 * nodes beyond paragraphs (headings, list items) exist in the schema but get
 * no toolbar UI until Phase 3B.
 */
export const DIRECTION_BLOCK_TYPES: readonly string[] = [
  "paragraph",
  "heading",
  "listItem",
  "blockquote",
];

/**
 * @returns an empty document with one empty paragraph (a caret target).
 */
export function emptyRichTextDocument(): RichTextDocument {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

/* ── Phase 6 (R6.1/R6.5): table documents ─────────────────────────────── */

/** Default column width of a generated table, in world units (R6.7). */
export const TABLE_COL_WIDTH = 110;

/** Default row height of a generated table, in world units (R6.7). */
export const TABLE_ROW_HEIGHT = 36;

/** Maximum grid-picker dimensions (spec: larger via dialog, later). */
export const TABLE_MAX_ROWS = 8;
export const TABLE_MAX_COLS = 10;

/** Default dimensions of a new table (the picker's initial value). */
export const DEFAULT_TABLE_ROWS = 3;
export const DEFAULT_TABLE_COLS = 3;

/** Options of {@link createTableDocument}. */
export interface CreateTableDocumentOptions {
  /** Direction attribute of the table node (default RTL, R6.5). */
  readonly dir?: "rtl" | "ltr";
  /** Style preset name (default "classic", R6.4). */
  readonly preset?: string;
  /** Whether the first row renders as a header row (default true). */
  readonly withHeaderRow?: boolean;
}

/**
 * Builds a table document: one table node with `rows × cols` empty cells
 * (R6.1). Column 1 is the FIRST row cell — with the RTL `dir` attribute it
 * renders on the RIGHT (R6.5).
 *
 * @param rows - the row count (clamped to ≥1).
 * @param cols - the column count (clamped to ≥1).
 * @param options - direction/preset/header-row options.
 * @returns the document containing exactly the table.
 */
export function createTableDocument(
  rows: number,
  cols: number,
  options: CreateTableDocumentOptions = {},
): RichTextDocument {
  const rowCount = Math.max(1, Math.floor(rows));
  const colCount = Math.max(1, Math.floor(cols));
  const rowNodes: JSONContent[] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const isHeader = rowIndex === 0 && options.withHeaderRow !== false;
    const cells: JSONContent[] = [];
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      cells.push({
        type: isHeader ? "tableHeader" : "tableCell",
        content: [{ type: "paragraph" }],
      });
    }
    rowNodes.push({ type: "tableRow", content: cells });
  }
  const table: JSONContent = {
    type: "table",
    attrs: { dir: options.dir ?? "rtl", preset: options.preset ?? "classic" },
    content: rowNodes,
  };
  return { type: "doc", content: [table] };
}

/**
 * @param doc - the document to inspect.
 * @returns whether the document contains at least one table node (a table
 *          with empty cells is still content — it must never be treated as
 *          an "empty" box and auto-removed on session end).
 */
export function documentContainsTable(
  doc: RichTextDocument | null | undefined,
): boolean {
  if (doc === null || doc === undefined) {
    return false;
  }
  const walk = (node: JSONContent): boolean => {
    if (node.type === "table") {
      return true;
    }
    return (node.content ?? []).some(walk);
  };
  return (doc.content ?? []).some(walk);
}

/* ── Phase 6 (R6.6): tabular clipboard text parsing ───────────────────── */

/**
 * Parses clipboard tabular text (Excel/Sheets plain-text paste: rows on
 * `\n`, cells on `\t`) into a cell matrix (R6.6).
 *
 * @param text - the pasted plain text.
 * @returns the cell matrix, or null when the text is not tabular (no tab,
 *          a single row, or blank).
 */
export function parseTabularText(text: string): string[][] | null {
  if (!text.includes("\t")) {
    return null;
  }
  const rows = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((row) => row.split("\t"));
  while (rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    if (lastRow === undefined || !lastRow.every((cell) => cell.trim() === "")) {
      break;
    }
    rows.pop();
  }
  if (rows.length < 2) {
    return null;
  }
  return rows;
}

/**
 * Converts a parsed cell matrix into a table document (the first row is
 * the header row — Excel semantics, R6.6).
 *
 * @param cells - the cell matrix (rows × cell texts).
 * @param dir - the table direction attribute.
 * @returns the document containing the table.
 */
export function tabularToTableDocument(
  cells: readonly (readonly string[])[],
  dir: "rtl" | "ltr" = "rtl",
): RichTextDocument {
  const rows: JSONContent[] = cells.map((row, rowIndex) => ({
    type: "tableRow",
    content: row.map((cell) => ({
      type: rowIndex === 0 ? "tableHeader" : "tableCell",
      content:
        cell.trim() === ""
          ? [{ type: "paragraph" }]
          : [{ type: "paragraph", content: [{ type: "text", text: cell }] }],
    })),
  }));
  return {
    type: "doc",
    content: [
      { type: "table", attrs: { dir, preset: "classic" }, content: rows },
    ],
  };
}

/**
 * Converts plain text (paragraphs joined by `\n`, the Phase-2 contract) into
 * a document of plain paragraphs — the upgrade path for legacy objects whose
 * `doc` is null.
 *
 * @param text - the plain text.
 * @returns the document (always at least one paragraph).
 */
export function richTextFromPlainText(text: string): RichTextDocument {
  const paragraphs = (text.length > 0 ? text.split("\n") : [""]).map((line) => {
    const paragraph: JSONContent = { type: "paragraph" };
    if (line.length > 0) {
      paragraph.content = [{ type: "text", text: line }];
    }
    return paragraph;
  });
  return { type: "doc", content: paragraphs };
}

/**
 * Extracts the plain-text projection of a document (block texts joined by
 * `\n`, hard breaks as `\n`) — kept on the object for legacy consumers
 * (layers outline, word count in Phase 3B) and cheap equality checks.
 *
 * @param doc - the document to flatten.
 * @returns the plain text.
 */
export function plainTextOfDocument(
  doc: RichTextDocument | null | undefined,
): string {
  if (doc === null || doc === undefined) {
    return "";
  }
  const lines: string[] = [];
  let current: string | null = null;
  const startLine = (): void => {
    if (current === null) {
      current = "";
    }
  };
  const flush = (): void => {
    if (current !== null) {
      lines.push(current);
      current = null;
    }
  };
  const walk = (node: JSONContent): void => {
    if (node.type === "text") {
      startLine();
      current += node.text ?? "";
      return;
    }
    if (node.type === "hardBreak") {
      startLine();
      current += "\n";
      return;
    }
    const isLineBlock =
      node.type !== undefined && LINE_BLOCK_NODES.has(node.type);
    if (isLineBlock) {
      flush();
      startLine();
    }
    for (const child of node.content ?? []) {
      walk(child);
    }
    if (isLineBlock) {
      flush();
    }
  };
  for (const child of doc.content ?? []) {
    walk(child);
  }
  flush();
  // Trim trailing empty lines so the projection has no phantom paragraphs.
  while (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}

/** Leaf block node types that emit their own line in the projection. */
const LINE_BLOCK_NODES = new Set(["paragraph", "heading", "codeBlock"]);

/**
 * Concatenates every text descendant of a node (no line breaks) — the
 * first-strong-character scan input for one block.
 *
 * @param node - the node to flatten.
 * @returns the concatenated text.
 */
function nodeText(node: JSONContent): string {
  if (node.type === "text") {
    return node.text ?? "";
  }
  let text = "";
  for (const child of node.content ?? []) {
    text += nodeText(child);
  }
  return text;
}

/**
 * @param doc - the document to inspect.
 * @returns whether the document has no visible text (whitespace-only counts
 *          as empty — matches the commit planner's plain-text contract).
 *          A document containing a table is NEVER empty (R6.1: a fresh
 *          empty-celled table must survive the session commit).
 */
export function richTextDocumentIsEmpty(
  doc: RichTextDocument | null | undefined,
): boolean {
  if (documentContainsTable(doc)) {
    return false;
  }
  return plainTextOfDocument(doc).trim() === "";
}

/**
 * Stable serialisation used for change detection (the commit planner
 * compares before/after documents through this string).
 *
 * @param doc - the document to serialise.
 * @returns the JSON string.
 */
export function serializeRichText(
  doc: RichTextDocument | null | undefined,
): string {
  return doc === null || doc === undefined ? "" : JSON.stringify(doc);
}

/**
 * @param a - one document (or null).
 * @param b - the other document (or null).
 * @returns whether both serialise to the same JSON.
 */
export function richTextDocumentsEqual(
  a: RichTextDocument | null | undefined,
  b: RichTextDocument | null | undefined,
): boolean {
  return serializeRichText(a) === serializeRichText(b);
}

/**
 * Resolves the document's dominant direction (R3A.7): the direction of the
 * first block that carries one, else the direction of the first strong
 * character, defaulting to RTL (Persian-first product).
 *
 * @param doc - the document to inspect.
 * @returns "rtl" or "ltr".
 */
export function dominantTextDirection(
  doc: RichTextDocument | null | undefined,
): "rtl" | "ltr" {
  for (const block of doc?.content ?? []) {
    const explicit = block.attrs?.dir;
    if (explicit === "rtl" || explicit === "ltr") {
      return explicit;
    }
    const strong = firstStrongCharacter(nodeText(block));
    if (strong !== null) {
      return strong;
    }
  }
  return "rtl";
}

/**
 * Unicode ranges of RTL strong characters (Arabic script incl. Persian,
 * Hebrew). Used for the first-strong-character heuristic (UAX #9 lite).
 */
const RTL_STRONG =
  /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** Latin strong characters. */
const LTR_STRONG = /[A-Za-z\u00C0-\u024F]/;

/**
 * Finds the direction of the first strong (directional) character.
 *
 * @param text - the text to scan.
 * @returns "rtl" | "ltr", or null when no strong character exists.
 */
export function firstStrongCharacter(text: string): "rtl" | "ltr" | null {
  for (const character of text) {
    if (RTL_STRONG.test(character)) {
      return "rtl";
    }
    if (LTR_STRONG.test(character)) {
      return "ltr";
    }
  }
  return null;
}
