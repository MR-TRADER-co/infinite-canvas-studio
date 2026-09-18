"use client";

/**
 * Rich paste-in planner (فاز ۲۴ — «پیوند غنی Word»).
 *
 * Decides how an external clipboard payload that carries `text/html`
 * (Microsoft Word, Excel, Google Docs, a web page …) lands on the canvas:
 * sanitise → parse through the shared editor schema → measure whether the
 * document is formatted beyond plain paragraphs. Formatted payloads become
 * a RICH text box (bold/lists/tables/headings/links survive); plain ones
 * keep the exact Phase-23 plain-text behaviour (identical sizing).
 *
 * The planner is deterministic and side-effect-free apart from the lazily
 * created shared editor (its schema is the parse contract); jsdom tests
 * exercise it directly.
 */
import { sanitizePastedHTML } from "@/text/editor/pasteSanitizer";
import { getSharedTextEditor } from "@/text/editor/TipTapFactory";
import {
  documentIsRichlyFormatted,
  richTextFromSanitizedHTML,
} from "@/text/editor/htmlImport";
import {
  plainTextOfDocument,
  richTextDocumentIsEmpty,
  type RichTextDocument,
} from "@/text/editor/richtext";
import { isImportablePasteText } from "@/core/clipboard/DropPayload";

/** Largest `text/html` payload the planner will sanitise (chars). */
export const MAX_PASTE_HTML_LENGTH = 200_000;

/** The outcome of planning one clipboard paste-in. */
export type RichPastePlan =
  | {
      /** A formatted document: import as a rich text box. */
      readonly kind: "rich";
      readonly doc: RichTextDocument;
      /** The document's plain-text projection (the `text` field). */
      readonly text: string;
    }
  | {
      /** No formatting worth a rich box: the Phase-23 plain path. */
      readonly kind: "plain";
      readonly text: string;
    };

/**
 * Plans one paste-in for an (html, plain) clipboard pair.
 *
 * @param html - the raw `text/html` payload ("" when the clipboard carries
 *        none — Word and browsers always pair it with `text/plain`).
 * @param plain - the raw `text/plain` payload.
 * @returns the plan, or null when NEITHER payload is importable (empty,
 *          over-long HTML without usable plain text).
 */
export function planRichTextPaste(
  html: string,
  plain: string,
): RichPastePlan | null {
  if (html.trim().length > 0 && html.length <= MAX_PASTE_HTML_LENGTH) {
    const sanitized = sanitizePastedHTML(html);
    if (sanitized.html.trim().length > 0) {
      const doc = richTextFromSanitizedHTML(
        sanitized.html,
        getSharedTextEditor().getSchema(),
      );
      if (
        doc !== null &&
        !richTextDocumentIsEmpty(doc) &&
        documentIsRichlyFormatted(doc)
      ) {
        return { kind: "rich", doc, text: plainTextOfDocument(doc) };
      }
    }
  }
  // No (usable) HTML: the plain payload decides — Phase-23 behaviour.
  if (isImportablePasteText(plain)) {
    return { kind: "plain", text: plain };
  }
  return null;
}
