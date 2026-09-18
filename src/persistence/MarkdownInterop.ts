/**
 * Markdown interop (R13.1): the round-trip between scene objects and a
 * FOLDER of `.md` files.
 *
 * Export: every text-bearing object (text boxes + sticky notes) becomes
 * one `.md` file named by its title slug, carrying a YAML frontmatter
 * block (identity, geometry, kind + colours) and the rich text projected
 * to Markdown (headings, bold/italic/strike/code runs, `[[wiki]]` chips
 * inline). Non-text objects are summarised in the lossy `index.md` map —
 * documented in the export dialog (AC13.1).
 *
 * Import: `.md` files come back as text-box drafts — frontmatter restores
 * the identity/geometry/colours; markdown-it tokenises the body into the
 * TipTap document (headings, paragraph runs, inline marks; `[[..]]` stays
 * literal text — the wiki-chip semantics return with the knowledge pack).
 *
 * Pure modules: js-yaml + markdown-it only, no DOM — node-testable.
 */
import { dump as yamlDump, load as yamlLoad } from "js-yaml";
import MarkdownIt from "markdown-it";
import type {
  RichTextDocument,
} from "@/text/editor/richtext";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** One exported file (path relative to the export root). */
export interface MarkdownExportFile {
  /** The file path (`index.md` or `<slug>.md`). */
  readonly path: string;
  /** The UTF-8 file content. */
  readonly content: string;
}

/** A pickable `.md` file handed to the importer. */
export interface MarkdownInputFile {
  /** The file's base name (for slug fallbacks). */
  readonly name: string;
  /** The UTF-8 file content. */
  readonly content: string;
}

/** A draft text-box object produced by the importer. */
export interface ImportedMarkdownObject {
  /** The draft object data (kind `textBox`; sticky when frontmatter says). */
  readonly object: Record<string, unknown>;
}

/** Frontmatter carried by every exported file (round-trip identity). */
interface MarkdownFrontmatter {
  readonly kind: string;
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly color?: string;
  readonly noteColor?: string;
  readonly title?: string;
  readonly tags?: readonly string[];
}

const MD = new MarkdownIt({ html: false, linkify: false, typographer: false });

/** Cap for slug length (file names stay filesystem-friendly). */
const SLUG_MAX = 48;

/**
 * Builds a filesystem-safe slug from a title (Persian letters kept;
 * anything else collapses to dashes).
 *
 * @param title - the object's title (first heading or first line).
 * @param fallback - used when the title carries no usable characters.
 * @returns the slug.
 */
export function slugify(title: string, fallback: string): string {
  const slug = title
    .trim()
    .replace(/[\u200c\s]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX);
  return slug !== "" ? slug : fallback;
}

/**
 * Resolves an object's display title: the first heading/first line of its
 * text, else the object id.
 *
 * @param object - the text-bearing object.
 * @returns the title (may be empty-string, callers fall back).
 */
export function titleOf(object: Record<string, unknown>): string {
  const text = typeof object.text === "string" ? object.text : "";
  const firstLine = text.split("\n").find((line) => line.trim() !== "");
  if (firstLine === undefined) {
    return "";
  }
  return firstLine.replace(/^#+\s*/, "").trim();
}

/**
 * Projects a TipTap document to Markdown text (headings, paragraphs,
 * bold/italic/strike/code marks — the round-trip subset).
 *
 * @param doc - the rich text document (null → plain text).
 * @param plainText - the object's plain-text projection (legacy path).
 * @returns the Markdown body.
 */
export function docToMarkdown(
  doc: RichTextDocument | null,
  plainText: string,
): string {
  if (doc === null || doc.content === undefined) {
    return plainText;
  }
  const lines: string[] = [];
  for (const block of doc.content) {
    if (block.type === "heading") {
      const level = block.attrs?.level;
      const prefix = "#".repeat(
        typeof level === "number" && level >= 1 && level <= 6 ? level : 2,
      );
      lines.push(`${prefix} ${runsToMarkdown(block)}`);
      continue;
    }
    if (block.type === "paragraph" || block.type === "blockquote") {
      const line = runsToMarkdown(block);
      lines.push(line === "" ? "" : line);
      continue;
    }
    if (block.type === "codeBlock") {
      lines.push("```");
      lines.push(runsToMarkdown(block, false));
      lines.push("```");
      continue;
    }
    if (block.type === "bulletList" || block.type === "orderedList") {
      for (const item of block.content ?? []) {
        const line = runsToMarkdown(item);
        if (line !== "") {
          lines.push(`- ${line}`);
        }
      }
    }
  }
  return lines.join("\n");
}

/**
 * Projects one node's inline runs to Markdown (marks wrapped).
 *
 * @param node - the node whose `content` runs are projected.
 * @param marks - whether to wrap with inline marks (code blocks skip).
 * @returns the inline Markdown text.
 */
function runsToMarkdown(
  node: { content?: unknown[] },
  marks = true,
): string {
  const runs = node.content;
  if (!Array.isArray(runs)) {
    return "";
  }
  const parts: string[] = [];
  for (const run of runs) {
    if (typeof run !== "object" || run === null) {
      continue;
    }
    const record = run as unknown as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      parts.push(applyMarks(record.text, record.marks, marks));
      continue;
    }
    if (record.type === "hardBreak") {
      parts.push("  \n");
      continue;
    }
    // Nested blocks inside list items etc. — flatten.
    parts.push(runsToMarkdown(record, marks));
  }
  return parts.join("");
}

/**
 * Wraps one text run with its inline marks.
 *
 * @param text - the run's text.
 * @param marks - the run's mark descriptors.
 * @param enabled - whether marks apply at all.
 * @returns the wrapped text.
 */
function applyMarks(
  text: string,
  marks: unknown,
  enabled: boolean,
): string {
  if (!enabled || !Array.isArray(marks)) {
    return text;
  }
  let out = text;
  for (const mark of marks) {
    if (typeof mark !== "object" || mark === null) {
      continue;
    }
    const type = (mark as Record<string, unknown>).type;
    if (type === "bold") {
      out = `**${out}**`;
    } else if (type === "italic") {
      out = `*${out}*`;
    } else if (type === "strike") {
      out = `~~${out}~~`;
    } else if (type === "code") {
      out = `\`${out}\``;
    }
  }
  return out;
}

/**
 * Exports a whole scene to the Markdown file set.
 *
 * @param objects - every scene object.
 * @param projectName - the document name (for the index header).
 * @returns the export files (index.md first).
 */
export function exportSceneToMarkdown(
  objects: readonly SceneObjectData[],
  projectName: string,
): MarkdownExportFile[] {
  const files: MarkdownExportFile[] = [];
  const usedPaths = new Set<string>(["index.md"]);
  const textObjects: SceneObjectData[] = [];
  const otherSummaries: string[] = [];

  for (const object of objects) {
    if (object.kind === "textBox" || object.kind === "stickyNote") {
      textObjects.push(object);
      continue;
    }
    otherSummaries.push(
      `- ${summaryLine(object)} (${object.kind} \`${object.id}\`)`,
    );
  }

  for (const object of textObjects) {
    const record = object as unknown as Record<string, unknown>;
    const title =
      titleOf(object as unknown as Record<string, unknown>) || object.id;
    const slug = uniquePath(
      `${slugify(title, object.id)}.md`,
      usedPaths,
    );
    usedPaths.add(slug);
    const frontmatter: MarkdownFrontmatter = {
      kind: object.kind,
      id: object.id,
      x: round(object.position.x),
      y: round(object.position.y),
      width: round(numberOr(record.width, 0)),
      height: round(numberOr(record.height, 0)),
      ...(numberOr(record.fontSize, 0) > 0
        ? { fontSize: numberOr(record.fontSize, 0) }
        : {}),
      ...(typeof record.fontFamily === "string" && record.fontFamily !== ""
        ? { fontFamily: record.fontFamily }
        : {}),
      ...(typeof record.color === "string" && record.color !== ""
        ? { color: record.color }
        : {}),
      ...(typeof record.noteColor === "string" && record.noteColor !== ""
        ? { noteColor: record.noteColor }
        : {}),
      ...(title !== "" ? { title } : {}),
    };
    const body = docToMarkdown(
      (record.doc as RichTextDocument | null | undefined) ?? null,
      typeof record.text === "string" ? record.text : "",
    );
    files.push({
      path: slug,
      content: assembleFile(frontmatter, body),
    });
  }

  const index = [
    `# ${projectName}`,
    "",
    `> خروجی Markdown — ${toPersianDigits(String(textObjects.length))} فایل متنی.`,
    "",
    "## فایل‌ها",
    ...(files.length > 0
      ? files.map((file) => `- [${file.path.replace(/\.md$/, "")}](./${file.path})`)
      : ["- (بدون شیء متنی)"]),
    "",
    "## اشیاءٔ غیرمتنی (خلاصهٔ افتادگی‌دار)",
    ...(otherSummaries.length > 0 ? otherSummaries : ["- (بدون شیء غیرمتنی)"]),
    "",
  ].join("\n");
  return [{ path: "index.md", content: index }, ...files];
}

/**
 * Assembles frontmatter + body into one file.
 *
 * @param frontmatter - the identity block.
 * @param body - the Markdown body.
 * @returns the file content.
 */
function assembleFile(
  frontmatter: MarkdownFrontmatter,
  body: string,
): string {
  const yamlBlock = yamlDump(frontmatter, {
    lineWidth: 100,
    noRefs: true,
  });
  return `---\n${yamlBlock}---\n\n${body}\n`;
}

/**
 * Summarises a non-text object for index.md (lossy by design).
 *
 * @param object - the object.
 * @returns the one-line summary.
 */
function summaryLine(object: SceneObjectData): string {
  const record = object as unknown as Record<string, unknown>;
  const name =
    typeof record.title === "string" && record.title !== ""
      ? record.title
      : typeof record.label === "string" && record.label !== ""
        ? record.label
        : object.id;
  return name;
}

/**
 * Imports `.md` files into draft text-box objects.
 *
 * @param files - the picked files.
 * @param idFor - allocates a fresh object id per file.
 * @returns the drafts (one per importable file, in order).
 */
export function importMarkdownFiles(
  files: readonly MarkdownInputFile[],
  idFor: () => string,
): ImportedMarkdownObject[] {
  const imported: ImportedMarkdownObject[] = [];
  for (const file of files) {
    const parsed = splitFrontmatter(file.content);
    const front = parsed.front;
    const doc = markdownToDoc(parsed.body);
    const draft = draftFromFrontmatter(front, file, idFor);
    imported.push({
      object: {
        ...draft,
        doc,
        text: plainTextOf(doc),
      },
    });
  }
  return imported;
}

/** The split of a frontmatter file. */
interface SplitFile {
  readonly front: Record<string, unknown>;
  readonly body: string;
}

/**
 * Splits a `---` frontmatter block from the body (absent block → empty).
 *
 * @param content - the raw file content.
 * @returns the split.
 */
function splitFrontmatter(content: string): SplitFile {
  if (!content.startsWith("---")) {
    return { front: {}, body: content };
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return { front: {}, body: content };
  }
  let yamlText = content.slice(3, end).trim();
  if (yamlText.endsWith("---")) {
    yamlText = yamlText.slice(0, -3);
  }
  let front: Record<string, unknown> = {};
  try {
    const loaded = yamlLoad(yamlText);
    if (typeof loaded === "object" && loaded !== null) {
      front = loaded as Record<string, unknown>;
    }
  } catch {
    // A corrupt block imports as an empty one — the body still loads.
  }
  const body = content.slice(end + 4).replace(/^\s*\n/, "");
  return { front, body };
}

/**
 * Converts a Markdown body into a TipTap document (headings, paragraphs,
 * inline marks; `[[..]]` stays literal text).
 *
 * @param body - the Markdown body.
 * @returns the rich text document.
 */
export function markdownToDoc(body: string): RichTextDocument {
  const tokens = MD.parse(body, {});
  const blocks: Record<string, unknown>[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }
    if (token.type === "heading_open") {
      const level = Number(/^h(\d)$/.exec(token.tag)?.[1] ?? 2);
      const inline = tokens[index + 1];
      index += 2;
      blocks.push({
        type: "heading",
        attrs: { level: Math.min(6, Math.max(1, level)) },
        content: inlineRuns(inline),
      });
      continue;
    }
    if (token.type === "paragraph_open") {
      const inline = tokens[index + 1];
      index += 2;
      blocks.push({ type: "paragraph", content: inlineRuns(inline) });
      continue;
    }
    if (token.type === "fence") {
      blocks.push({
        type: "codeBlock",
        content:
          token.content.trim() === ""
            ? []
            : [{ type: "text", text: token.content.replace(/\n$/, "") }],
      });
      continue;
    }
    if (token.type === "bullet_list_open") {
      // Consume until the matching close; each first-level item becomes
      // one paragraph line (the round-trip subset).
      for (let scan = index + 1; scan < tokens.length; scan += 1) {
        const inner = tokens[scan];
        if (inner === undefined || inner.type === "bullet_list_close") {
          index = scan;
          break;
        }
        if (inner.type === "inline") {
          blocks.push({ type: "paragraph", content: inlineRuns(inner) });
        }
      }
    }
  }
  if (blocks.length === 0) {
    blocks.push({ type: "paragraph", content: [] });
  }
  return { type: "doc", content: blocks } as RichTextDocument;
}

/**
 * Projects one markdown-it inline token to TipTap text runs.
 *
 * @param inline - the inline token.
 * @returns the runs (empty when no children).
 */
function inlineRuns(inline: unknown): Record<string, unknown>[] {
  const token = inline as { children?: unknown[] } | undefined;
  if (token === undefined || !Array.isArray(token.children)) {
    return [];
  }
  const runs: Record<string, unknown>[] = [];
  // markdown-it expresses inline marks through OPEN/CLOSE delimiter tokens
  // around plain text tokens — a small stack converts them to TipTap marks.
  const openMarks: Array<"bold" | "italic" | "strike"> = [];
  for (const child of token.children) {
    const record = child as unknown as Record<string, unknown>;
    if (typeof record !== "object" || record === null) {
      continue;
    }
    if (record.type === "strong_open") {
      openMarks.push("bold");
      continue;
    }
    if (record.type === "em_open") {
      openMarks.push("italic");
      continue;
    }
    if (record.type === "s_open") {
      openMarks.push("strike");
      continue;
    }
    if (
      record.type === "strong_close" ||
      record.type === "em_close" ||
      record.type === "s_close"
    ) {
      openMarks.pop();
      continue;
    }
    if (
      record.type === "text" &&
      typeof record.content === "string" &&
      record.content !== ""
    ) {
      runs.push({
        type: "text",
        text: record.content,
        ...(openMarks.length > 0
          ? { marks: openMarks.map((mark) => ({ type: mark })) }
          : {}),
      });
      continue;
    }
    if (record.type === "code_inline") {
      runs.push({
        type: "text",
        text: record.content,
        marks: [{ type: "code" }],
      });
    }
  }
  return runs;
}

/**
 * Builds the draft object data from the frontmatter (validated
 * defensively — a missing field falls back to the default geometry).
 *
 * @param front - the frontmatter record.
 * @param file - the source file (slug fallback).
 * @param idFor - allocates the object id.
 * @returns the draft's base fields (doc/text added by the caller).
 */
function draftFromFrontmatter(
  front: Record<string, unknown>,
  file: MarkdownInputFile,
  idFor: () => string,
): Record<string, unknown> {
  const kind =
    front.kind === "stickyNote" ? "stickyNote" : "textBox";
  const num = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const str = (value: unknown, fallback: string): string =>
    typeof value === "string" && value !== "" ? value : fallback;
  return {
    kind,
    id: idFor(),
    // Round-trip identity: the ORIGINAL id is preserved through a
    // dedicated field (the draft's id is fresh — the scene reseeds).
    importedFromId: typeof front.id === "string" ? front.id : undefined,
    position: { x: num(front.x, 0), y: num(front.y, 0) },
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    width: Math.max(120, num(front.width, 320)),
    height: Math.max(60, num(front.height, 120)),
    fontSize: Math.max(8, num(front.fontSize, kind === "stickyNote" ? 18 : 20)),
    ...(typeof front.fontFamily === "string" && front.fontFamily !== ""
      ? { fontFamily: front.fontFamily }
      : {}),
    color: str(front.color, "var(--foreground)"),
    ...(kind === "stickyNote"
      ? { noteColor: str(front.noteColor, "oklch(0.87 0.14 85)") }
      : { sizeMode: "fixed" }),
    ...(typeof front.title === "string" && front.title !== ""
      ? { name: front.title }
      : {}),
  };
}

/**
 * Projects a TipTap doc back to plain text (the object's `text` field).
 *
 * @param doc - the document.
 * @returns the plain-text projection.
 */
export function plainTextOf(doc: RichTextDocument): string {
  const lines: string[] = [];
  for (const block of doc.content ?? []) {
    const text = collectText(block);
    lines.push(text);
  }
  return lines.join("\n");
}

/**
 * Recursively collects a node's text.
 *
 * @param node - the node.
 * @returns its concatenated text.
 */
function collectText(node: Record<string, unknown>): string {
  if (typeof node.text === "string") {
    return node.text;
  }
  if (!Array.isArray(node.content)) {
    return "";
  }
  return (node.content as Record<string, unknown>[])
    .map(collectText)
    .join("");
}

/**
 * @param value - a maybe-number.
 * @param fallback - used when not finite.
 * @returns the number.
 */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

/**
 * @param value - rounds to 2 decimals for stable YAML.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * De-duplicates an export path (title collisions get -2, -3, …).
 *
 * @param path - the candidate path.
 * @param used - the taken paths.
 * @returns a unique path.
 */
function uniquePath(path: string, used: ReadonlySet<string>): string {
  if (!used.has(path)) {
    return path;
  }
  const base = path.replace(/\.md$/, "");
  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = `${base}-${counter}.md`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}.md`;
}

/** Persian digit mapping for the index header. */
const PERSIAN_DIGITS: Readonly<Record<string, string>> = {
  "0": "۰",
  "1": "۱",
  "2": "۲",
  "3": "۳",
  "4": "۴",
  "5": "۵",
  "6": "۶",
  "7": "۷",
  "8": "۸",
  "9": "۹",
};

/**
 * @param value - the latin-digit string.
 * @returns the Persian-digit rendering.
 */
function toPersianDigits(value: string): string {
  return value.replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[digit] ?? digit);
}
