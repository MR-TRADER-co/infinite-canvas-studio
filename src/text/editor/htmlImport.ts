/**
 * HTML → rich-text-document import (فاز ۲۴ — «پیوند غنی Word»).
 *
 * The INBOUND half of the Word bridge: a sanitised clipboard `text/html`
 * payload (already reduced to the schema-allowed subset by
 * {@link sanitizePastedHTML}) is parsed into a TipTap JSON document through
 * ProseMirror's own DOM parser bound to the SHARED editor schema — the
 * exact parse rules the live editor applies to its own pastes, so
 * bold/italic/underline/strike, headings, (fake-list-converted) lists,
 * tables with spans, links, block quotes, code blocks, `hr`s and `dir`
 * attributes all land identically.
 *
 * Also owns two pure decision helpers:
 * - {@link documentIsRichlyFormatted}: whether a document carries formatting
 *   BEYOND plain paragraphs (drives the rich-vs-plain paste-in fallback);
 * - nothing here performs I/O — the DOM parse adapter is injectable and the
 *   ambient `DOMParser` is used when present (browser + jsdom tests).
 */
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import type { Schema } from "@tiptap/pm/model";
import type { RichTextDocument } from "./richtext";

/** Injected DOM capability (kept tiny for node-side tests). */
export interface HtmlImportDom {
  /** Parses an HTML string into a Document (`new DOMParser().parseFromString`). */
  readonly parseHTML: (html: string) => Document;
}

/**
 * Parses the ambient DOMParser when available.
 *
 * @returns the ambient DOM adapter, or null in pure node runtimes.
 */
function ambientDom(): HtmlImportDom | null {
  const parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (parser === undefined) {
    return null;
  }
  return {
    parseHTML: (html: string): Document =>
      new parser().parseFromString(html, "text/html"),
  };
}

/**
 * Parses a SANITISED clipboard HTML fragment into a rich text document
 * through the shared editor schema's DOM parse rules.
 *
 * @param html - the sanitised HTML (script/style/handler-free subset).
 * @param schema - the shared TipTap editor's ProseMirror schema.
 * @param dom - injected DOM adapter; defaults to the ambient DOMParser.
 * @returns the parsed document, or null when no DOM exists / the fragment
 *          parses to nothing (the caller falls back to plain text).
 */
export function richTextFromSanitizedHTML(
  html: string,
  schema: Schema,
  dom?: HtmlImportDom | null,
): RichTextDocument | null {
  const adapter = dom ?? ambientDom();
  if (adapter === null || html.trim().length === 0) {
    return null;
  }
  try {
    const parsed = adapter.parseHTML(html);
    const node = ProseMirrorDOMParser.fromSchema(schema).parse(parsed.body);
    const json = node.toJSON() as unknown;
    if (
      json === null ||
      typeof json !== "object" ||
      (json as { type?: unknown }).type !== "doc"
    ) {
      return null;
    }
    const doc = json as RichTextDocument;
    return (doc.content ?? []).length > 0 ? doc : null;
  } catch {
    // A malformed fragment (or a DOM-less runtime) must never break the
    // paste bridge — the plain-text fallback takes over.
    return null;
  }
}

/**
 * Whether a document carries formatting beyond plain paragraphs: any
 * non-paragraph block, any marked text run or any table makes the payload
 * "rich" (worth a rich text-box import); a bare multi-paragraph document
 * stays on the plain path so simple pastes keep their exact Phase-23
 * sizing and behaviour.
 *
 * @param doc - the parsed document to inspect.
 * @returns whether the document is formatted beyond plain paragraphs.
 */
export function documentIsRichlyFormatted(
  doc: RichTextDocument | null | undefined,
): boolean {
  if (doc === null || doc === undefined) {
    return false;
  }
  let rich = false;
  const walk = (node: {
    readonly type?: string;
    readonly marks?: readonly unknown[];
    readonly content?: readonly unknown[];
  }): void => {
    if (rich) {
      return;
    }
    if (node.type !== "doc" && node.type !== "paragraph" && node.type !== "text") {
      rich = true;
      return;
    }
    if (node.type === "text" && (node.marks?.length ?? 0) > 0) {
      rich = true;
      return;
    }
    for (const child of node.content ?? []) {
      if (rich) {
        return;
      }
      walk(child as Parameters<typeof walk>[0]);
    }
  };
  walk(doc);
  return rich;
}
