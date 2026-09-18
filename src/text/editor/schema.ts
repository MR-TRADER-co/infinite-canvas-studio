/**
 * Rich text schema description: the block and mark types the shared TipTap
 * schema supports (CLAUDE.md §1.1), mirroring the extension set registered
 * by `text/editor/extensions` (R3A.4).
 *
 * Block nodes beyond the paragraph exist in the schema (StarterKit) but get
 * no toolbar UI until Phase 3B; the lists stay in sync with
 * {@link DIRECTION_BLOCK_TYPES} and the line-emitter set of
 * `plainTextOfDocument`.
 */

/** Block node types the rich text schema supports. */
export type TextBlockType =
  | "doc"
  | "paragraph"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "listItem"
  | "blockquote"
  | "codeBlock"
  | "horizontalRule";

/** Inline mark types the rich text schema supports. */
export type TextMarkType =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "textStyle"
  | "subscript"
  | "superscript"
  | "highlight";

/** Attributes contributed to the `textStyle` mark by custom extensions. */
export type TextStyleAttribute =
  "fontFamily" | "color" | "fontSize" | "lineHeight" | "letterSpacing";

/** Node attributes of the paragraph family (direction + alignment). */
export type ParagraphAttribute = "dir" | "textAlign";

/** Placeholder description of the shared ProseMirror schema. */
export interface TextDocSchema {
  /** Block node types enabled in the schema. */
  readonly blocks: readonly TextBlockType[];
  /** Inline mark types enabled in the schema. */
  readonly marks: readonly TextMarkType[];
  /** Custom attributes layered onto the `textStyle` mark. */
  readonly textStyleAttributes: readonly TextStyleAttribute[];
  /** Block-level attributes layered onto text blocks (R3A.5). */
  readonly paragraphAttributes: readonly ParagraphAttribute[];
}

/** The schema surface this phase registers (kept literal for tests). */
export const TEXT_SCHEMA: TextDocSchema = {
  blocks: [
    "doc",
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "listItem",
    "blockquote",
    "codeBlock",
    "horizontalRule",
  ],
  marks: [
    "bold",
    "italic",
    "underline",
    "strike",
    "code",
    "textStyle",
    "subscript",
    "superscript",
    "highlight",
  ],
  textStyleAttributes: [
    "fontFamily",
    "color",
    "fontSize",
    "lineHeight",
    "letterSpacing",
  ],
  paragraphAttributes: ["dir", "textAlign"],
} as const;
