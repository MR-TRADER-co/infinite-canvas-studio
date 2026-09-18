/**
 * Barrel of the TipTap extensions shared by the single canvas editor
 * (R3A.4) plus the typography constants the format UI renders.
 *
 * StarterKit provides the schema's block nodes (headings, lists, quote,
 * code) AND the history extension — the block-level toolbar UI arrives in
 * Phase 3B, this phase only registers the schema surface. Character-level
 * marks come from the standalone packages (Underline, TextStyle,
 * FontFamily, Color, Highlight, TextAlign, Subscript, Superscript,
 * Placeholder) plus the three custom metric extensions and the direction
 * extension (R3A.5). The table family (Phase 6 / R6.1) adds the table
 * block nodes with RTL direction, per-cell background and style presets
 * (R6.2–R6.5).
 */
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { CharacterCount } from "@tiptap/extension-character-count";
import type { Extensions } from "@tiptap/core";
import { Direction } from "./Direction";
import { FontSize, LineHeight, LetterSpacing } from "./TextStyleMetrics";
import { PersianKeys } from "./PersianKeys";
import { ListIndent } from "./ListIndent";
import { PersianDigitsInput } from "./PersianDigits";
import { createTableExtensions } from "./table";
import { countCharacters, countWords } from "@/text/editor/wordCount";

/** Font list entries rendered with live font previews (R3A.6/R3A.8). */
export interface FontOption {
  /** CSS font-family value stored in the textStyle mark. */
  readonly family: string;
  /** UI label (i18n key resolved by the consumer). */
  readonly labelKey:
    | "font.vazirmatn"
    | "font.tahoma"
    | "font.system"
    | "font.serif"
    | "font.mono";
}

/**
 * Curated font list: Vazirmatn first (the bundled default), then
 * Persian-capable system fallbacks and a few Latin classics.
 */
export const FONT_OPTIONS: readonly FontOption[] = [
  { family: "Vazirmatn", labelKey: "font.vazirmatn" },
  { family: "Tahoma", labelKey: "font.tahoma" },
  { family: "system-ui", labelKey: "font.system" },
  { family: "Georgia, serif", labelKey: "font.serif" },
  { family: "'Courier New', monospace", labelKey: "font.mono" },
];

/** The default font family applied to new text (R3A.8). */
export const DEFAULT_FONT_FAMILY = "Vazirmatn";

/** Curated text ink palette (theme-aware tokens first, then literals). */
export const TEXT_COLOR_PALETTE: readonly string[] = [
  "token://text",
  "#0a0a0a",
  "#f5f5f5",
  "#b91c1c",
  "#c2410c",
  "#a16207",
  "#15803d",
  "#0e7490",
  "#6d28d9",
  "#be185d",
];

/** Curated highlight palette (soft, readable behind dark ink). */
export const HIGHLIGHT_PALETTE: readonly string[] = [
  "transparent",
  "#fef08a",
  "#bbf7d0",
  "#bfdbfe",
  "#fbcfe8",
  "#fed7aa",
  "#e9d5ff",
  "#fecaca",
];

/** Font size stepper bounds (world units). */
export const FONT_SIZE_MIN = 6;
export const FONT_SIZE_MAX = 144;

/** Line height stepper bounds (unitless multiplier). */
export const LINE_HEIGHT_MIN = 0.8;
export const LINE_HEIGHT_MAX = 3;

/** Letter spacing bounds (world units). */
export const LETTER_SPACING_MIN = -2;
export const LETTER_SPACING_MAX = 24;

/**
 * Assembles the full extension set for the shared editor.
 *
 * Phase 3B additions (R3B.1–R3B.6): the Link extension (Ctrl+K dialog +
 * autolink + styled, never auto-opened), TaskList/TaskItem (togglable
 * checkmarks, multi-level, RTL markers), the Tab/Shift-Tab list-depth
 * behaviour, and CharacterCount with ZWNJ-aware Persian counters.
 *
 * @param placeholder - the placeholder shown while the edited doc is empty
 *        (a string, or a live getter for language switches).
 * @returns the extension list for the TipTap Editor.
 */
export function createTextExtensions(
  placeholder: string | (() => string),
): Extensions {
  return [
    // H1–H3 only (R3B.1): the toolbar, the sanitiser's h4–h6 downgrades and
    // the future outline (Phase 7) all key off exactly three levels.
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Underline,
    TextStyle,
    FontFamily,
    Color,
    Highlight,
    Subscript,
    Superscript,
    TextAlign.configure({
      types: ["heading", "paragraph"],
    }),
    Link.configure({
      // Links NEVER open from inside the canvas editor — the bubble menu
      // asks for confirmation and delegates to the OS browser (R3B.3).
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
      linkOnPaste: true,
      HTMLAttributes: {
        class: "rich-link",
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      },
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    Placeholder.configure({
      placeholder,
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
    }),
    CharacterCount.configure({
      // Persian-aware counters (R3B.6): ZWNJ is part of a word, never a
      // separator — both counters split ONLY on Unicode whitespace.
      wordCounter: (text: string) => countWords(text),
      textCounter: (text: string) => countCharacters(text),
    }),
    Direction,
    FontSize,
    LineHeight,
    LetterSpacing,
    PersianKeys,
    ListIndent,
    PersianDigitsInput,
    ...createTableExtensions(),
  ];
}
