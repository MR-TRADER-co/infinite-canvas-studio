/**
 * Paste decision planner (R3B.5) — the PURE half of the editor's
 * `handlePaste`: given the clipboard payload and the caret context, decide
 * what should happen, without touching the DOM or the editor.
 *
 * Decision table (first match wins):
 *  1. caret inside a table AND the payload carries a table (HTML `<table>`
 *     or tabular plain text) → REJECT (ProseMirror has no nested tables,
 *     R6.6 Persian notice);
 *  2. `Ctrl+Shift+V` (shift held) with non-empty plain text → paste as
 *     PLAIN TEXT (all formatting stripped);
 *  3. non-empty HTML payload → SANITISED RICH HTML (the sanitiser runs in
 *     the editor handler; Word/Excel/web content keeps
 *     bold/italic/underline/strike/headings/lists/links, everything else
 *     is dropped);
 *  4. tabular plain text (TSV, R6.6) → convert to a real RTL table;
 *  5. otherwise → let ProseMirror's default paste run.
 */
import { parseTabularText } from "@/text/editor/richtext";

/** Pattern matching a clipboard HTML payload that carries a table. */
const HTML_TABLE_PATTERN = /<table[\s>]/i;

/** Inputs of the paste decision. */
export interface PasteDecisionInput {
  /** The `text/plain` clipboard payload ("" when absent). */
  readonly plain: string;
  /** The `text/html` clipboard payload ("" when absent). */
  readonly html: string;
  /** Whether Shift was held (Ctrl/Cmd+Shift+V = paste as plain text). */
  readonly shiftKey: boolean;
  /** Whether the caret/selection currently sits inside a table. */
  readonly selectionInTable: boolean;
}

/** What the editor's paste handler should do. */
export type PastePlan =
  | { readonly kind: "reject-nested-table" }
  | { readonly kind: "plain-text"; readonly text: string }
  | { readonly kind: "rich-html"; readonly html: string }
  | {
      readonly kind: "table-from-tabular";
      readonly cells: readonly (readonly string[])[];
    }
  | { readonly kind: "default" };

/**
 * Plans the paste action for a clipboard payload.
 *
 * @param input - the clipboard payload + caret context.
 * @returns the action the paste handler must execute.
 */
export function planClipboardPaste(input: PasteDecisionInput): PastePlan {
  const tabular = parseTabularText(input.plain);
  const htmlCarriesTable = HTML_TABLE_PATTERN.test(input.html);

  // 1. Nested tables are structurally impossible — reject with a notice.
  if (input.selectionInTable && (htmlCarriesTable || tabular !== null)) {
    return { kind: "reject-nested-table" };
  }

  // 2. Ctrl+Shift+V: the user explicitly asked for unformatted text.
  if (input.shiftKey && input.plain.length > 0) {
    return { kind: "plain-text", text: input.plain };
  }

  // 3. Rich HTML payloads go through the sanitiser.
  if (input.html.trim().length > 0) {
    return { kind: "rich-html", html: input.html };
  }

  // 4. Plain tabular text becomes a real table (R6.6).
  if (tabular !== null) {
    return { kind: "table-from-tabular", cells: tabular };
  }

  // 5. Plain text without tabs: ProseMirror's default paste.
  return { kind: "default" };
}
