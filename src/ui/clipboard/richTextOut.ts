"use client";

/**
 * Rich text OUTBOUND serialization (فاز ۳۵ — «خروج غنی از بوم»).
 *
 * The mirror of the فاز ۲۴ rich INBOUND bridge: copying a text-bearing
 * selection outward used to flatten everything to `text/plain` — headings,
 * bold, lists and tables survived the trip INTO the canvas but died on the
 * way OUT to Word / Outlook / AI chats. This module serialises the
 * selection's rich `RichTextDocument`s into semantic, fully-ESCAPED,
 * scheme-sanitised `text/html` so the SAME structure that renders on the
 * canvas pastes into external consumers:
 *
 * - headings → `<h1..h6>` · paragraphs → `<p>` · `hardBreak` → `<br>`;
 * - bullet/ordered lists → `<ul>/<ol>/<li>` (paragraphs inside list items
 *   unwrap to inline content — Word renders compact list lines);
 * - tables → `<table>` with the all-header first row wrapped in `<thead>`
 *   (`tableHeader` → `<th>`, `tableCell` → `<td>`), body rows in ONE
 *   `<tbody>`;
 * - blockquote / codeBlock / horizontalRule → their semantic tags;
 * - marks → `<strong>/<em>/<u>/<s>/<code>` and SAFE `<a href>`
 *   (only http/https/mailto/relative survive — `javascript:` degrades to
 *   plain text, mirroring the inbound sanitizer's policy);
 * - every text node is HTML-escaped (`& < > " '`) — canvas text can never
 *   inject markup into the consumer's document;
 * - RTL/LTR parity: a block's `dir` attribute rides the same
 *   direction-aware elements the inbound sanitizer keeps.
 *
 * Pure and DOM-free (node-testable). Plain-text boxes and sticky notes
 * without a `doc` contribute escaped `<p>` lines — so a mixed selection
 * still copies out as one coherent HTML fragment.
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { RichTextDocument } from "@/text/editor/richtext";
import type { JSONContent } from "@tiptap/core";

/** Elements that may carry a `dir` attribute (the sanitizer's set). */
const DIR_AWARE = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "table",
  "td",
  "th",
]);

/** Link schemes safe to emit on an outbound `<a href>`. */
const SAFE_HREF_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Escapes a text node for HTML content (five entities — also safe inside
 * double-quoted attribute values).
 *
 * @param text - the raw canvas text.
 * @returns the escaped HTML string.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Validates an outbound link href (the inbound sanitizer's policy,
 * mirrored): http/https/mailto and relative URLs pass; everything else
 * (`javascript:`, `data:`, unknown schemes) is refused.
 *
 * @param href - the candidate href.
 * @returns whether the href may be emitted.
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
  // A colon-free (or oddly-coloned) value is a relative URL — safe.
  return true;
}

/** One opened inline mark: its opening and closing tags. */
interface OpenMark {
  readonly open: string;
  readonly close: string;
}

/**
 * Renders a text node WITH its mark stack (fixed emission order, closes in
 * reverse — well-formed nesting for any mark subset).
 *
 * @param marks - the text node's marks (may be undefined).
 * @param text - the raw text.
 * @returns the inline HTML.
 */
function renderMarks(
  marks: JSONContent["marks"],
  text: string,
): string {
  if (text === "" || marks === undefined || marks.length === 0) {
    return escapeHtml(text);
  }
  const opened: OpenMark[] = [];
  for (const mark of marks) {
    const type = mark.type ?? "";
    if (type === "bold") {
      opened.push({ open: "<strong>", close: "</strong>" });
    } else if (type === "italic") {
      opened.push({ open: "<em>", close: "</em>" });
    } else if (type === "underline") {
      opened.push({ open: "<u>", close: "</u>" });
    } else if (type === "strike") {
      opened.push({ open: "<s>", close: "</s>" });
    } else if (type === "code") {
      opened.push({ open: "<code>", close: "</code>" });
    } else if (type === "link") {
      const href =
        typeof mark.attrs?.href === "string" ? (mark.attrs.href as string) : "";
      if (isSafeHref(href)) {
        opened.push({
          open: `<a href="${escapeHtml(href)}">`,
          close: "</a>",
        });
      }
      // Unsafe schemes degrade to plain text (the sanitizer's policy).
    }
    // textStyle/sub/superscript/highlight: the inbound sanitizer strips
    // colours/alignment — outbound stays conservative and skips them.
  }
  if (opened.length === 0) {
    return escapeHtml(text);
  }
  return (
    opened.map((mark) => mark.open).join("") +
    escapeHtml(text) +
    opened
      .slice()
      .reverse()
      .map((mark) => mark.close)
      .join("")
  );
}

/**
 * Serialises a rich text document to a semantic HTML fragment.
 *
 * @param doc - the document (a `doc` root with block content).
 * @returns the HTML fragment (block-level elements, no `<html>` wrapper).
 */
export function richTextDocumentToHtml(doc: RichTextDocument): string {
  return (doc.content ?? [])
    .map((child) => renderNode(child, false))
    .join("");
}

/**
 * The `text/html` payload of a copied selection (فاز ۳۵): text-bearing
 * objects contribute their rich documents (or escaped `<p>` lines for
 * plain boxes / sticky notes); every other kind is skipped — mirroring
 * {@link plainTextOfObjects}. Multiple text objects join with a spacer
 * paragraph (the plain projection's blank-line parity).
 *
 * @param objects - the resolved top-level objects being copied outward.
 * @returns the HTML fragment, or null when the selection carries no
 *          text-bearing object (the rasterised / image paths own it).
 */
export function richTextHtmlOfObjects(
  objects: readonly SceneObjectData[],
): string | null {
  const fragments: string[] = [];
  for (const object of objects) {
    if (object.kind === "textBox") {
      const doc = (object as { doc?: RichTextDocument | null }).doc;
      if (doc !== null && doc !== undefined) {
        fragments.push(richTextDocumentToHtml(doc));
        continue;
      }
      fragments.push(
        plainLinesToHtml(
          "text" in object ? ((object as { text?: string }).text ?? "") : "",
        ),
      );
      continue;
    }
    if (object.kind === "stickyNote") {
      fragments.push(
        plainLinesToHtml(
          "text" in object ? ((object as { text?: string }).text ?? "") : "",
        ),
      );
    }
  }
  const textual = fragments.filter((fragment) => fragment.trim() !== "");
  if (textual.length === 0) {
    return null;
  }
  return textual.join("<p><br></p>");
}

/**
 * Wraps a plain-text projection into escaped `<p>` lines.
 *
 * @param text - the object's plain text (may be empty/undefined).
 * @returns the `<p>` sequence ("" for empty text).
 */
function plainLinesToHtml(text: string | undefined): string {
  const value = (text ?? "").replace(/\r\n?/g, "\n");
  if (value.trim() === "") {
    return "";
  }
  return value
    .split("\n")
    .map((line) =>
      line.trim() === "" ? "<p><br></p>" : `<p>${escapeHtml(line)}</p>`,
    )
    .join("");
}

/**
 * Renders one JSON node to HTML.
 *
 * @param node - the node.
 * @param inline - true inside containers whose block children unwrap
 *        (list items, table cells): paragraphs contribute inline content.
 * @returns the node's HTML.
 */
function renderNode(node: JSONContent, inline: boolean): string {
  const type = node.type ?? "";
  const dir =
    node.attrs?.dir === "rtl" || node.attrs?.dir === "ltr"
      ? ` dir="${node.attrs.dir as string}"`
      : "";
  switch (type) {
    case "text":
      return renderMarks(node.marks, node.text ?? "");
    case "hardBreak":
      return "<br>";
    case "paragraph":
      if (inline) {
        return renderChildren(node, "");
      }
      return `<p${dirAttr("p", dir)}>${renderChildren(node, "")}</p>`;
    case "heading": {
      const levelRaw = Number(node.attrs?.level ?? 2);
      const level = Number.isInteger(levelRaw)
        ? Math.min(6, Math.max(1, levelRaw))
        : 2;
      return `<h${level}${dirAttr(`h${level}`, dir)}>${renderChildren(node, "")}</h${level}>`;
    }
    case "bulletList":
      return `<ul${dirAttr("ul", dir)}>${renderChildren(node, "")}</ul>`;
    case "orderedList":
      return `<ol${dirAttr("ol", dir)}>${renderChildren(node, "")}</ol>`;
    case "listItem":
      return `<li${dirAttr("li", dir)}>${renderChildren(node, "<br>")}</li>`;
    case "blockquote":
      // Blockquote keeps its paragraphs as <p> (the canonical Word shape).
      return `<blockquote${dirAttr("blockquote", dir)}>${(node.content ?? [])
        .map((child) => renderNode(child, false))
        .join("")}</blockquote>`;
    case "codeBlock": {
      const text = (node.content ?? [])
        .map((child) => child.text ?? "")
        .join("");
      return `<pre${dirAttr("pre", dir)}><code>${escapeHtml(text)}</code></pre>`;
    }
    case "horizontalRule":
      return "<hr>";
    case "table":
      return `<table${dirAttr("table", dir)}>${renderTableRows(node)}</table>`;
    case "tableRow":
      // A bare row outside a table (defensive) renders its cells.
      return `<tr>${renderChildren(node, "")}</tr>`;
    case "tableHeader":
      return `<th${dirAttr("th", dir)}>${renderChildren(node, "<br>")}</th>`;
    case "tableCell":
      return `<td${dirAttr("td", dir)}>${renderChildren(node, "<br>")}</td>`;
    default:
      // Unknown nodes: render their children inline (graceful, never lossy
      // for the text they carry), skipping attr-less wrappers entirely.
      return renderChildren(node, "");
  }
}

/**
 * Renders a container's children, separating consecutive PARAGRAPH-level
 * children with the given separator (cells / list items want `<br>`
 * between their inner paragraphs; lists want none between items).
 *
 * @param node - the container node.
 * @param paragraphSeparator - the HTML inserted between two consecutive
 *        paragraph-level children ("" for none).
 * @returns the children's HTML.
 */
function renderChildren(
  node: JSONContent,
  paragraphSeparator: string,
): string {
  const children = node.content ?? [];
  let html = "";
  let previousWasParagraph = false;
  for (const child of children) {
    const childType = child.type ?? "";
    const isParagraphLevel = childType === "paragraph" || childType === "heading";
    if (
      paragraphSeparator !== "" &&
      isParagraphLevel &&
      previousWasParagraph
    ) {
      html += paragraphSeparator;
    }
    html += renderNode(child, true);
    previousWasParagraph = isParagraphLevel;
  }
  return html;
}

/**
 * Emits the direction attribute for direction-aware elements only.
 *
 * @param element - the element name being emitted.
 * @param dir - the pre-rendered ` dir="..."` snippet (or "").
 * @returns the attribute when the element may carry it.
 */
function dirAttr(element: string, dir: string): string {
  return dir === "" || DIR_AWARE.has(element) ? dir : "";
}

/**
 * Renders a table's rows: the all-header first row wraps in `<thead>`,
 * every other row joins ONE `<tbody>` (Word's clean import shape).
 *
 * @param table - the table node.
 * @returns the rows' HTML.
 */
function renderTableRows(table: JSONContent): string {
  const rows = table.content ?? [];
  const headerRow = rows.find(
    (row) =>
      (row.content ?? []).length > 0 &&
      (row.content ?? []).every((cell) => cell.type === "tableHeader"),
  );
  const parts: string[] = [];
  const bodyRows: string[] = [];
  for (const row of rows) {
    const cells = (row.content ?? [])
      .map((cell) => renderNode(cell, true))
      .join("");
    if (row === headerRow) {
      parts.push(`<thead><tr>${cells}</tr></thead>`);
    } else {
      bodyRows.push(`<tr>${cells}</tr>`);
    }
  }
  if (bodyRows.length > 0) {
    parts.push(`<tbody>${bodyRows.join("")}</tbody>`);
  }
  return parts.join("");
}
