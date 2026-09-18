"use client";

/**
 * The Word (.docx) exporter (فاز ۳۶ — «جدول به ورد»).
 *
 * The user's contract: canvas text/tables must be able to travel OUT as a
 * real Word Office FILE — not just through the clipboard. فاز ۳۵ already
 * ships `text/html` on the OS clipboard (structure survives a manual
 * paste-into-Word); this module closes the remaining gap with a
 * self-contained, dependency-free .docx generator:
 *
 * - a MINIMAL ZIP writer (STORE method + CRC-32) in pure TypeScript —
 *   no new npm dependency, deterministic output, node-testable;
 * - Office Open XML WordprocessingML: `word/document.xml` with REAL Word
 *   tables (`w:tbl` + `w:tblGrid` + borders + `w:gridSpan`/`w:vMerge`
 *   merge support + `w:bidiVisual` for RTL column order + repeating
 *   header rows), headings as Word heading styles, bold/italic/underline/
 *   strike/sub/sup/code runs, SAFE external hyperlinks (relationship-
 *   based, the فاز ۳۵ scheme policy mirrored), bullet/ordered lists via
 *   `word/numbering.xml`, blockquote/code-block/hr approximations, and
 *   per-paragraph `w:bidi` with RTL auto-detection so Persian content
 *   opens correctly in Word;
 * - the SAME object-aggregation semantics as `richTextHtmlOfObjects`
 *   (فاز ۳۵): rich docs serialise, plain text boxes / sticky notes
 *   contribute plain paragraphs, multiple text objects join with a
 *   spacer paragraph, non-text objects are skipped.
 *
 * Pure and DOM-free except the two thin leaf helpers
 * ({@link wordDocumentBlob} / {@link downloadWordDocument}) which guard
 * their browser globals and never throw.
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { RichTextDocument } from "@/text/editor/richtext";
import type { JSONContent } from "@tiptap/core";
import { downloadBlob } from "@/ui/clipboard/blobDownload";

/* ── Part A — the minimal ZIP writer (STORE + CRC-32) ─────────────────── */

/** CRC-32 (IEEE 802.3) lookup table (poly 0xEDB88320). */
const CRC_TABLE: readonly number[] = (() => {
  const table: number[] = new Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * CRC-32 of a byte payload (IEEE 802.3, reflected, init/final xor).
 *
 * @param bytes - the payload.
 * @returns the unsigned CRC-32 (e.g. 0xcbf43926 for "123456789").
 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    const table = CRC_TABLE[(crc ^ byte) & 0xff] ?? 0;
    crc = (crc >>> 8) ^ table;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** One file to pack into the archive. */
export interface ZipEntryInput {
  /** The entry path (UTF-8, `/`-separated). */
  readonly name: string;
  /** The file bytes (stored UNCOMPRESSED — method 0). */
  readonly data: Uint8Array;
}

/**
 * A deterministic fixed DOS timestamp (2024-01-01 00:00) so the archive
 * bytes are reproducible for tests — ((2024-1980)<<9)|(1<<5)|1 = 0x5821.
 */
const ZIP_DOS_DATE = 0x5821;

/**
 * Packs the entries into a minimal ZIP archive (STORE — no compression).
 * Word accepts stored OOXML parts happily; the deterministic timestamp
 * keeps `buildWordDocxBytes` byte-stable for the same input.
 *
 * @param entries - the files (at least one; names must be non-empty).
 * @returns the archive bytes (`PK\x03\x04…`).
 */
export function zipStoreFiles(entries: readonly ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localTotal = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer, local.byteOffset, 30);
    localView.setUint32(0, 0x04034b50, true); // local file header signature
    localView.setUint16(4, 20, true); // version needed (2.0)
    localView.setUint16(6, 0x0800, true); // general purpose: UTF-8 names
    localView.setUint16(8, 0, true); // method: STORE
    localView.setUint16(10, 0, true); // mod time
    localView.setUint16(12, ZIP_DOS_DATE, true); // mod date
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true); // compressed size
    localView.setUint32(22, entry.data.length, true); // uncompressed size
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true); // extra field length
    local.set(nameBytes, 30);
    localChunks.push(local, entry.data);
    localTotal += local.length + entry.data.length;

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer, central.byteOffset, 46);
    centralView.setUint32(0, 0x02014b50, true); // central directory signature
    centralView.setUint16(4, 20, true); // version made by
    centralView.setUint16(6, 20, true); // version needed
    centralView.setUint16(8, 0x0800, true); // UTF-8 names
    centralView.setUint16(10, 0, true); // method: STORE
    centralView.setUint16(12, 0, true); // mod time
    centralView.setUint16(14, ZIP_DOS_DATE, true); // mod date
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true); // extra length
    centralView.setUint16(32, 0, true); // comment length
    centralView.setUint16(34, 0, true); // disk start
    centralView.setUint16(36, 0, true); // internal attrs
    centralView.setUint32(38, 0, true); // external attrs
    centralView.setUint32(42, localTotal - local.length - entry.data.length, true); // offset
    central.set(nameBytes, 46);
    centralChunks.push(central);
  }
  const centralTotal = centralChunks.reduce(
    (sum, chunk) => sum + chunk.length,
    0,
  );
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // end-of-central-directory signature
  eocdView.setUint16(4, 0, true); // disk number
  eocdView.setUint16(6, 0, true); // disk with central directory
  eocdView.setUint16(8, entries.length, true); // entries on this disk
  eocdView.setUint16(10, entries.length, true); // total entries
  eocdView.setUint32(12, centralTotal, true); // central directory size
  eocdView.setUint32(16, localTotal, true); // central directory offset
  eocdView.setUint16(20, 0, true); // comment length

  const out = new Uint8Array(localTotal + centralTotal + eocd.length);
  let cursor = 0;
  for (const chunk of [...localChunks, ...centralChunks, eocd]) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

/* ── Part B — OOXML helpers ───────────────────────────────────────────── */

/**
 * Escapes a text node for XML content / attribute values (five entities).
 *
 * @param text - the raw text.
 * @returns the escaped XML string.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Link schemes safe to emit on an outbound Word hyperlink (فاز ۳۵ parity). */
const SAFE_HREF_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Validates an outbound link href (the فاز ۳۵ policy, mirrored).
 *
 * @param href - the candidate href.
 * @returns whether the href may become a Word hyperlink.
 */
function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed === "") {
    return false;
  }
  if (/^[\w.+~-]*:/.test(trimmed)) {
    try {
      return SAFE_HREF_SCHEMES.has(new URL(trimmed).protocol);
    } catch {
      return false;
    }
  }
  return true;
}

/** RTL script ranges (Arabic, Hebrew, extensions, presentation forms). */
const RTL_SCRIPT = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/**
 * Whether the text contains RTL-script characters (Persian/Arabic/Hebrew)
 * — drives per-paragraph `w:bidi` auto-detection for content that never
 * carried an explicit `dir` attribute.
 *
 * @param text - the text to probe.
 * @returns whether RTL characters are present.
 */
export function isRtlText(text: string): boolean {
  return RTL_SCRIPT.test(text);
}

/** One collected external hyperlink (document.xml.rels entry). */
interface WordLink {
  /** The relationship id used in `w:hyperlink r:id`. */
  readonly rid: string;
  /** The target href (already validated safe). */
  readonly href: string;
}

/** Mutable serialization context (link collection with dedupe). */
interface WordSerialContext {
  readonly links: WordLink[];
  readonly seenHrefs: Map<string, string>;
}

/**
 * Registers (or reuses) a safe href as a document relationship.
 *
 * @param ctx - the serialization context.
 * @param href - the validated href.
 * @returns the relationship id, or null when the href is unsafe (the run
 *          degrades to plain text — the sanitizer's policy).
 */
function linkRid(ctx: WordSerialContext, href: string): string | null {
  if (!isSafeHref(href)) {
    return null;
  }
  const seen = ctx.seenHrefs.get(href);
  if (seen !== undefined) {
    return seen;
  }
  const rid = `rId${1000 + ctx.links.length}`;
  ctx.links.push({ rid, href });
  ctx.seenHrefs.set(href, rid);
  return rid;
}

/** Normalises a CSS hex colour (`#rgb`/`#rrggbb`) to OOXML `w:fill` form. */
function cssHexFill(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const match = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (match !== null) {
    return (match[1] ?? "").toUpperCase();
  }
  const short = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (short !== null) {
    const [r = "0", g = "0", b = "0"] = (short[1] ?? "").split("");
    return `${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

/** Clamps an integer attribute to a sane range. */
function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

/* ── Part C — inline content (runs) ──────────────────────────────────── */

/**
 * The `w:rPr` CHILDREN of a run for its mark set (no wrapper element).
 *
 * @param marks - the text node's marks (may be undefined).
 * @param rtlRun - whether the run should also carry `w:rtl` (paragraph is
 *        bidi AND the run text is RTL-script).
 * @param forceBold - header cells render bold.
 * @returns the run-properties children XML ("" when unmarked).
 */
function runPropsOf(
  marks: JSONContent["marks"],
  rtlRun: boolean,
  forceBold: boolean,
): string {
  let props = "";
  if (forceBold) {
    props += "<w:b/><w:bCs/>";
  }
  let monospace = false;
  for (const mark of marks ?? []) {
    switch (mark.type ?? "") {
      case "bold":
        props += "<w:b/><w:bCs/>";
        break;
      case "italic":
        props += "<w:i/><w:iCs/>";
        break;
      case "underline":
        props += '<w:u w:val="single"/>';
        break;
      case "strike":
        props += "<w:strike/>";
        break;
      case "code":
        monospace = true;
        break;
      case "subscript":
        props += '<w:vertAlign w:val="subscript"/>';
        break;
      case "superscript":
        props += '<w:vertAlign w:val="superscript"/>';
        break;
      case "textStyle": {
        const color = cssHexFill(mark.attrs?.color);
        if (color !== null) {
          props += `<w:color w:val="${color}"/>`;
        }
        break;
      }
      default:
        break;
    }
  }
  if (monospace) {
    props =
      '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' +
      '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' +
      props;
  }
  if (rtlRun) {
    props += "<w:rtl/>";
  }
  return props;
}

/**
 * One text run (`w:r`) with explicit rPr children, preserving spaces.
 *
 * @param text - the raw text.
 * @param props - the rPr children ("" for none).
 * @returns the run XML ("" for empty text).
 */
function rawRun(text: string, props: string): string {
  if (text === "") {
    return "";
  }
  const rPr = props === "" ? "" : `<w:rPr>${props}</w:rPr>`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

/** Inline rendering options. */
interface InlineOptions {
  /** Force-bold every run (table header cells). */
  readonly bold?: boolean;
  /** The paragraph is bidi (enables per-run `w:rtl`). */
  readonly rtl?: boolean;
}

/**
 * Renders the INLINE children of one container node (text, hardBreak) —
 * link marks wrap their run in a `w:hyperlink` with the classic hyperlink
 * look; unsafe schemes degrade to plain text (the فاز ۳۵ policy).
 *
 * @param node - the container (paragraph/cell/listItem…).
 * @param ctx - the serialization context.
 * @param options - inline rendering options.
 * @returns the inline runs XML.
 */
function renderInline(
  node: JSONContent,
  ctx: WordSerialContext,
  options: InlineOptions = {},
): string {
  const bold = options.bold === true;
  const rtl = options.rtl === true;
  let out = "";
  for (const child of node.content ?? []) {
    const type = child.type ?? "";
    if (type === "text") {
      const text = child.text ?? "";
      const marks = child.marks ?? [];
      const linkMark = marks.find((mark) => (mark.type ?? "") === "link");
      if (linkMark !== undefined) {
        const href =
          typeof linkMark.attrs?.href === "string"
            ? (linkMark.attrs.href as string)
            : "";
        const rid = linkRid(ctx, href);
        if (rid !== null) {
          const other = marks.filter((mark) => mark !== linkMark);
          const props =
            '<w:color w:val="0563C1"/><w:u w:val="single"/>' +
            runPropsOf(other, false, bold);
          out += `<w:hyperlink r:id="${rid}">${rawRun(text, props)}</w:hyperlink>`;
          continue;
        }
        // Unsafe scheme: degrade to the plain run below.
      }
      out += rawRun(text, runPropsOf(marks, rtl && isRtlText(text), bold));
    } else if (type === "hardBreak") {
      out += "<w:r><w:br/></w:r>";
    } else {
      // Unknown inline nodes: contribute their children (never lossy).
      out += renderInline(child, ctx, options);
    }
  }
  return out;
}

/* ── Part D — block content ───────────────────────────────────────────── */

/** Paragraph assembly options. */
interface ParagraphOptions {
  /** Word paragraph style id (e.g. `Heading2`). */
  readonly style?: string;
  /** Explicit direction (`true` emits `w:bidi`). */
  readonly bidi?: boolean;
  /** List numbering (numId + level). */
  readonly numbering?: { readonly numId: number; readonly level: number };
  /** Indentation in twentieths of a point. */
  readonly indent?: { readonly left: number; readonly right?: number };
  /** Extra paragraph-property children (e.g. borders). */
  readonly extra?: string;
  /** Force-bold the runs (table header cells). */
  readonly bold?: boolean;
}

/**
 * Assembles one `w:p`.
 *
 * @param runs - the inline content (may be "").
 * @param options - the paragraph properties.
 * @returns the paragraph XML.
 */
function paragraph(runs: string, options: ParagraphOptions = {}): string {
  let props = "";
  if (options.style !== undefined) {
    props += `<w:pStyle w:val="${options.style}"/>`;
  }
  if (options.numbering !== undefined) {
    props += `<w:numPr><w:ilvl w:val="${options.numbering.level}"/><w:numId w:val="${options.numbering.numId}"/></w:numPr>`;
  }
  if (options.indent !== undefined) {
    props += `<w:ind w:left="${options.indent.left}"${
      options.indent.right !== undefined
        ? ` w:right="${options.indent.right}"`
        : ""
    }/>`;
  }
  if (options.extra !== undefined) {
    props += options.extra;
  }
  if (options.bidi === true) {
    props += "<w:bidi/>";
  }
  const pPr = props === "" ? "" : `<w:pPr>${props}</w:pPr>`;
  return `<w:p>${pPr}${runs}</w:p>`;
}

/**
 * Collects a node's whole text (for RTL auto-detection).
 *
 * @param node - the node.
 * @returns its concatenated text.
 */
function stringifyNodeText(node: JSONContent): string {
  if (node.type === "text") {
    return node.text ?? "";
  }
  return (node.content ?? []).map(stringifyNodeText).join("");
}

/**
 * Resolves a block's effective direction: explicit attr first, then RTL
 * auto-detection over the block's whole text.
 *
 * @param node - the block node.
 * @returns whether the paragraph should be `w:bidi`.
 */
function blockIsRtl(node: JSONContent): boolean {
  const dir = node.attrs?.dir;
  if (dir === "rtl") {
    return true;
  }
  if (dir === "ltr") {
    return false;
  }
  return isRtlText(stringifyNodeText(node));
}

/**
 * Renders ONE block node (or paragraph fallback) as Word XML.
 *
 * @param node - the block node.
 * @param ctx - the serialization context.
 * @param list - the active list stack (kind per open level).
 * @returns the block's XML.
 */
function renderBlock(
  node: JSONContent,
  ctx: WordSerialContext,
  list: readonly ("bullet" | "ordered")[],
): string {
  const type = node.type ?? "";
  switch (type) {
    case "paragraph":
      return paragraph(renderInline(node, ctx, { rtl: blockIsRtl(node) }), {
        bidi: blockIsRtl(node),
      });
    case "heading": {
      const level = clampInt(node.attrs?.level, 1, 6, 2);
      return paragraph(renderInline(node, ctx, { rtl: blockIsRtl(node) }), {
        style: `Heading${level}`,
        bidi: blockIsRtl(node),
      });
    }
    case "bulletList":
    case "orderedList": {
      const kind = type === "bulletList" ? "bullet" : "ordered";
      return (node.content ?? [])
        .map((child) => renderBlock(child, ctx, [...list, kind]))
        .join("");
    }
    case "listItem": {
      // Compact Word shape: the item's inner paragraphs join into ONE
      // numbered paragraph (line breaks between them — فاز ۳۵ parity);
      // nested lists recurse with the extended stack.
      const kind = list[list.length - 1] ?? "bullet";
      const level = Math.min(list.length - 1, 2);
      const parts: string[] = [];
      for (const child of node.content ?? []) {
        if (
          child.type === "paragraph" ||
          child.type === "heading" ||
          child.type === "table"
        ) {
          parts.push(renderInline(child, ctx, { rtl: blockIsRtl(node) }));
        } else {
          parts.push(renderBlock(child, ctx, list));
        }
      }
      return paragraph(parts.join("<w:r><w:br/></w:r>"), {
        numbering: { numId: kind === "bullet" ? 1 : 2, level },
        bidi: blockIsRtl(node),
      });
    }
    case "blockquote": {
      // The Word quote look: indented paragraphs with a side bar.
      const bar =
        '<w:pBdr><w:left w:val="single" w:sz="18" w:space="4" w:color="C9C9C9"/></w:pBdr>';
      return (node.content ?? [])
        .map((child) =>
          child.type === "paragraph"
            ? paragraph(renderInline(child, ctx, { rtl: blockIsRtl(node) }), {
                indent: { left: 720, right: 720 },
                extra: bar,
                bidi: blockIsRtl(node),
              })
            : renderBlock(child, ctx, list),
        )
        .join("");
    }
    case "codeBlock": {
      const text = (node.content ?? [])
        .map((child) => child.text ?? "")
        .join("");
      return text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) =>
          paragraph(
            line === ""
              ? ""
              : rawRun(
                  line,
                  '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/>',
                ),
            { indent: { left: 360 } },
          ),
        )
        .join("");
    }
    case "horizontalRule":
      return paragraph("", {
        extra:
          '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr>',
      });
    case "table":
      return renderWordTable(node, ctx);
    default:
      // Unknown blocks: unwrap their children as blocks (graceful).
      return (node.content ?? [])
        .map((child) => renderBlock(child, ctx, list))
        .join("");
  }
}

/* ── Part E — the Word table (the phase's core ask) ───────────────────── */

/** One planned cell of the grid walk. */
interface CellPlan {
  readonly kind: "cell" | "merge";
  /** The zero-based grid column the cell starts at. */
  readonly col: number;
  readonly colspan: number;
  /** For real cells: the rowspan (merges always render as 1 visually). */
  readonly rowspan: number;
  readonly isHeader: boolean;
  readonly node: JSONContent | null;
}

/**
 * Walks the table rows into a COLUMN-ALIGNED cell plan, materialising the
 * cells spanned-over by earlier rowspans as virtual `merge` cells (the
 * prosemirror model omits them; Word's `w:vMerge` requires them).
 *
 * @param table - the table node.
 * @returns one plan per row.
 */
function planTableRows(table: JSONContent): CellPlan[][] {
  const rows = (table.content ?? []).filter(
    (row) => (row.type ?? "") === "tableRow",
  );
  const pending = new Map<number, number>();
  const plans: CellPlan[][] = [];
  for (const row of rows) {
    const cells = (row.content ?? []).filter(
      (cell) => cell.type === "tableCell" || cell.type === "tableHeader",
    );
    const plan: CellPlan[] = [];
    let col = 0;
    const drainPending = (): void => {
      while ((pending.get(col) ?? 0) > 0) {
        plan.push({
          kind: "merge",
          col,
          colspan: 1,
          rowspan: 1,
          isHeader: false,
          node: null,
        });
        const left = (pending.get(col) ?? 0) - 1;
        if (left <= 0) {
          pending.delete(col);
        } else {
          pending.set(col, left);
        }
        col += 1;
      }
    };
    for (const cell of cells) {
      drainPending();
      const colspan = clampInt(cell.attrs?.colspan, 1, 64, 1);
      const rowspan = clampInt(cell.attrs?.rowspan, 1, 100, 1);
      plan.push({
        kind: "cell",
        col,
        colspan,
        rowspan,
        isHeader: (cell.type ?? "") === "tableHeader",
        node: cell,
      });
      if (rowspan > 1) {
        for (let i = 0; i < colspan; i += 1) {
          pending.set(col + i, rowspan - 1);
        }
      }
      col += colspan;
    }
    drainPending();
    plans.push(plan);
  }
  return plans;
}

/** The A4 text column width in twips (11906 − 2×1440 margins). */
const A4_TEXT_TWIPS = 9026;

/**
 * Derives the column widths (twips) from the first row's `colwidth`
 * attributes (drag-resized columns travel out!), falling back to an
 * equal split of the A4 text column.
 *
 * @param plans - the walked rows.
 * @returns one width per grid column (twips).
 */
function tableColumnWidths(plans: readonly CellPlan[][]): number[] {
  const widths: number[] = [];
  const firstRow = plans[0] ?? [];
  for (const cell of firstRow) {
    const raw = cell.node?.attrs?.colwidth;
    if (Array.isArray(raw)) {
      for (const value of raw) {
        const px = clampInt(value, 20, 2000, 0);
        widths.push(px > 0 ? px * 15 : 0);
      }
    } else {
      widths.push(0);
    }
  }
  const columnCount = plans.reduce(
    (max, row) =>
      Math.max(
        max,
        row.reduce((end, cell) => Math.max(end, cell.col + cell.colspan), 0),
      ),
    0,
  );
  const equal = Math.max(
    1,
    Math.floor(A4_TEXT_TWIPS / Math.max(1, columnCount)),
  );
  while (widths.length < columnCount) {
    widths.push(equal);
  }
  return widths.slice(0, columnCount).map((width) => (width > 0 ? width : equal));
}

/** Border lookups per table style preset (the R6.4 presets, Word-side). */
const PRESET_BORDERS: Readonly<Record<string, { readonly color: string; readonly all: boolean }>> = {
  classic: { color: "8C8C8C", all: true },
  minimal: { color: "BFBFBF", all: false },
  zebra: { color: "A6A6A6", all: true },
  soft: { color: "D9D9D9", all: false },
  grid: { color: "808080", all: true },
  dark: { color: "595959", all: true },
};

/** The border look when the preset attr is unknown (classic). */
const FALLBACK_BORDERS: { readonly color: string; readonly all: boolean } = {
  color: "8C8C8C",
  all: true,
};

/**
 * Renders a table node as a REAL Word table: `w:tbl` with `w:tblGrid`,
 * inline borders (preset-aware), `w:bidiVisual` for RTL column order,
 * repeating header rows (`w:tblHeader`), `w:gridSpan`/`w:vMerge` merges,
 * per-cell shading (`backgroundColor` or the classic header fill) and
 * `w:vAlign`. A trailing empty paragraph follows (Word's shape rule: a
 * table may never butt against the section properties).
 *
 * @param table - the table node.
 * @param ctx - the serialization context.
 * @returns the table XML.
 */
function renderWordTable(table: JSONContent, ctx: WordSerialContext): string {
  const plans = planTableRows(table);
  if (plans.length === 0) {
    return "";
  }
  const dir = table.attrs?.dir === "ltr" ? "ltr" : "rtl";
  const presetKey =
    typeof table.attrs?.preset === "string" &&
    PRESET_BORDERS[table.attrs.preset as string] !== undefined
      ? (table.attrs.preset as string)
      : "classic";
  const borders = PRESET_BORDERS[presetKey] ?? FALLBACK_BORDERS;
  const widths = tableColumnWidths(plans);

  const borderXml = (tag: string): string =>
    `<w:${tag} w:val="single" w:sz="4" w:space="0" w:color="${borders.color}"/>`;
  const tblBorders =
    `<w:tblBorders>${borderXml("top")}${borderXml("left")}${borderXml("bottom")}${borderXml("right")}${borderXml("insideH")}${borderXml("insideV")}</w:tblBorders>`;

  const rowsXml = plans
    .map((row) => {
      const isHeaderRow = row.some((cell) => cell.kind === "cell" && cell.isHeader);
      const trPr = isHeaderRow ? "<w:trPr><w:tblHeader/></w:trPr>" : "";
      const cellsXml = row
        .map((cell) => {
          const spanWidth = widths
            .slice(cell.col, cell.col + cell.colspan)
            .reduce((sum, width) => sum + width, 0);
          let tcPr = `<w:tcW w:w="${spanWidth}" w:type="dxa"/>`;
          if (cell.colspan > 1) {
            tcPr += `<w:gridSpan w:val="${cell.colspan}"/>`;
          }
          if (cell.kind === "cell" && cell.rowspan > 1) {
            tcPr += '<w:vMerge w:val="restart"/>';
          }
          if (cell.kind === "merge") {
            tcPr += "<w:vMerge/>";
          }
          let shading = "";
          let vAlign = "";
          if (cell.kind === "cell" && cell.node !== null) {
            const fill = cssHexFill(cell.node.attrs?.backgroundColor);
            shading =
              fill !== null
                ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`
                : cell.isHeader
                  ? '<w:shd w:val="clear" w:color="auto" w:fill="EDEDED"/>'
                  : "";
            const valign = cell.node.attrs?.valign;
            if (valign === "top" || valign === "middle" || valign === "bottom") {
              vAlign = `<w:vAlign w:val="${valign === "middle" ? "center" : valign}"/>`;
            }
          }
          const runs =
            cell.kind === "cell" && cell.node !== null
              ? renderInline(cell.node, ctx, {
                  bold: cell.isHeader,
                  rtl: blockIsRtl(cell.node),
                })
              : "";
          const cellParagraph =
            runs === ""
              ? "<w:p/>"
              : paragraph(runs, { bidi: cell.node !== null && blockIsRtl(cell.node) });
          return `<w:tc><w:tcPr>${tcPr}${shading}${vAlign}</w:tcPr>${cellParagraph}</w:tc>`;
        })
        .join("");
      return `<w:tr>${trPr}${cellsXml}</w:tr>`;
    })
    .join("");

  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  const bidiVisual = dir === "rtl" ? "<w:bidiVisual/>" : "";
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${bidiVisual}${tblBorders}` +
    '<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${grid}</w:tblGrid>` +
    `${rowsXml}` +
    "</w:tbl><w:p/>"
  );
}

/* ── Part F — document assembly ───────────────────────────────────────── */

/**
 * Serialises a rich text document into Word body XML.
 *
 * @param doc - the document.
 * @param ctx - the serialization context (collects hyperlinks).
 * @returns the body content XML.
 */
export function wordBodyOfDocument(
  doc: RichTextDocument,
  ctx: WordSerialContext = { links: [], seenHrefs: new Map() },
): string {
  return (doc.content ?? [])
    .map((child) => renderBlock(child, ctx, []))
    .join("");
}

/**
 * Wraps plain text into Word paragraphs (one per line; RTL per line).
 *
 * @param text - the object's plain text.
 * @returns the paragraphs XML ("" for blank text).
 */
function plainLinesToWordParagraphs(text: string | undefined): string {
  const value = (text ?? "").replace(/\r\n?/g, "\n");
  if (value.trim() === "") {
    return "";
  }
  return value
    .split("\n")
    .map((line) =>
      paragraph(
        line === ""
          ? ""
          : rawRun(line, isRtlText(line) ? "<w:rtl/>" : ""),
        { bidi: isRtlText(line) },
      ),
    )
    .join("");
}

/** The aggregated Word body plus its collected hyperlinks. */
export interface WordBody {
  /** The `w:body` content XML. */
  readonly body: string;
  /** The external hyperlinks (for document.xml.rels). */
  readonly links: readonly WordLink[];
}

/**
 * The Word body of a set of objects (the فاز ۳۵ aggregation semantics):
 * rich text boxes contribute their documents, plain boxes and sticky
 * notes contribute plain paragraphs, everything else is skipped. Multiple
 * text objects join with an empty spacer paragraph.
 *
 * @param objects - the objects being exported.
 * @returns the body + links, or null when nothing text-bearing remains.
 */
export function wordBodyOfObjects(
  objects: readonly SceneObjectData[],
): WordBody | null {
  const ctx: WordSerialContext = { links: [], seenHrefs: new Map() };
  const fragments: string[] = [];
  for (const object of objects) {
    if (object.kind === "textBox") {
      const doc = (object as { doc?: RichTextDocument | null }).doc;
      if (doc !== null && doc !== undefined) {
        fragments.push(wordBodyOfDocument(doc, ctx));
        continue;
      }
      fragments.push(
        plainLinesToWordParagraphs(
          "text" in object ? ((object as { text?: string }).text ?? "") : "",
        ),
      );
      continue;
    }
    if (object.kind === "stickyNote") {
      fragments.push(
        plainLinesToWordParagraphs(
          "text" in object ? ((object as { text?: string }).text ?? "") : "",
        ),
      );
    }
  }
  const textual = fragments.filter((fragment) => fragment.trim() !== "");
  if (textual.length === 0) {
    return null;
  }
  return { body: textual.join("<w:p/>"), links: ctx.links };
}

/* ── Part G — the OOXML package parts (static XML) ────────────────────── */

/** XML declaration every part shares. */
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** `[Content_Types].xml` — the package's part inventory. */
function contentTypesXml(): string {
  return (
    XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    "</Types>"
  );
}

/** `_rels/.rels` — the package root relationship (→ document.xml). */
function rootRelsXml(): string {
  return (
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>"
  );
}

/** `word/_rels/document.xml.rels` — the collected external hyperlinks. */
function documentRelsXml(links: readonly WordLink[]): string {
  return (
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    links
      .map(
        (link) =>
          `<Relationship Id="${link.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(link.href)}" TargetMode="External"/>`,
      )
      .join("") +
    "</Relationships>"
  );
}

/** `word/styles.xml` — doc defaults + Normal + Heading1..6. */
function stylesXml(): string {
  const heading = (id: string, halfPoints: number, outline: number): string =>
    `<w:style w:type="paragraph" w:styleId="Heading${id}"><w:name w:val="heading ${id}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${outline}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/><w:color w:val="1F1F1F"/></w:rPr></w:style>`;
  return (
    XML_DECL +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heading("1", 32, 0) +
    heading("2", 28, 1) +
    heading("3", 24, 2) +
    heading("4", 22, 3) +
    heading("5", 21, 4) +
    heading("6", 20, 5) +
    "</w:styles>"
  );
}

/** `word/numbering.xml` — bullet (numId 1) + decimal (numId 2), 3 levels. */
function numberingXml(): string {
  const bulletLevel = (level: number, glyph: string, font: string): string =>
    `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${glyph}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + level * 720}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr></w:lvl>`;
  const decimalLevel = (level: number): string =>
    `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${level + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + level * 720}" w:hanging="360"/></w:pPr></w:lvl>`;
  return (
    XML_DECL +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
    bulletLevel(0, "\u2022", "Symbol") +
    bulletLevel(1, "o", "Courier New") +
    bulletLevel(2, "\u25AA", "Arial") +
    "</w:abstractNum>" +
    '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' +
    decimalLevel(0) +
    decimalLevel(1) +
    decimalLevel(2) +
    "</w:abstractNum>" +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
    "</w:numbering>"
  );
}

/**
 * `word/document.xml` — the body plus an A4 section (mirrored margins when
 * the body reads RTL-dominant).
 *
 * @param body - the body content XML.
 * @param rtlSection - whether the section direction is RTL.
 * @returns the document part XML.
 */
function documentXml(body: string, rtlSection: boolean): string {
  return (
    XML_DECL +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' +
    body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>' +
    (rtlSection ? "<w:bidi/>" : "") +
    "</w:sectPr></w:body></w:document>"
  );
}

/* ── Part H — the public export surface ───────────────────────────────── */

/** Suggested file name of the Word export download. */
export const WORD_EXPORT_FILENAME = "infinite-canvas-word.docx";

/** The .docx MIME type. */
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Builds the complete .docx archive bytes for the given objects.
 *
 * @param objects - the text-bearing objects to export.
 * @returns the archive bytes, or null when nothing text-bearing remains.
 */
export function buildWordDocxBytes(
  objects: readonly SceneObjectData[],
): Uint8Array | null {
  const parsed = wordBodyOfObjects(objects);
  if (parsed === null) {
    return null;
  }
  const rtlSection = isRtlText(parsed.body.replace(/<[^>]+>/g, ""));
  const encoder = new TextEncoder();
  const parts: ZipEntryInput[] = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypesXml()) },
    { name: "_rels/.rels", data: encoder.encode(rootRelsXml()) },
    {
      name: "word/document.xml",
      data: encoder.encode(documentXml(parsed.body, rtlSection)),
    },
    { name: "word/styles.xml", data: encoder.encode(stylesXml()) },
    { name: "word/numbering.xml", data: encoder.encode(numberingXml()) },
    {
      name: "word/_rels/document.xml.rels",
      data: encoder.encode(documentRelsXml(parsed.links)),
    },
  ];
  return zipStoreFiles(parts);
}

/**
 * Builds the .docx as a Blob (the download payload).
 *
 * @param objects - the text-bearing objects to export.
 * @returns the document blob, or null when empty/unsupported runtime.
 */
export function wordDocumentBlob(
  objects: readonly SceneObjectData[],
): Blob | null {
  if (typeof Blob === "undefined") {
    return null;
  }
  const bytes = buildWordDocxBytes(objects);
  if (bytes === null) {
    return null;
  }
  return new Blob([bytes as unknown as BlobPart], { type: DOCX_MIME });
}

/**
 * Triggers the browser download of the Word export (fail-safe).
 *
 * @param objects - the text-bearing objects to export.
 * @param name - the suggested file name.
 * @returns whether the download was triggered.
 */
export function downloadWordDocument(
  objects: readonly SceneObjectData[],
  name: string = WORD_EXPORT_FILENAME,
): boolean {
  const blob = wordDocumentBlob(objects);
  if (blob === null) {
    return false;
  }
  return downloadBlob(blob, name);
}
