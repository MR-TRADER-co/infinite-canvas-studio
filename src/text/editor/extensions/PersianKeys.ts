/**
 * Persian keyboard essentials (R3A.8): the ZWNJ insertion shortcut.
 *
 * `Ctrl/Cmd+Shift+Space` inserts U+200C (ZERO WIDTH NON-JOINER) so words
 * like «می‌خواهم» keep their true half-space join — no menu, no manual
 * Unicode entry. The shortcut is documented in the toolbar tooltip.
 */
import { Extension } from "@tiptap/core";

/** The zero-width non-joiner character. */
export const ZWNJ = "\u200C";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    persianKeys: {
      /** Inserts one ZWNJ (U+200C) at the caret. */
      insertZwnj: () => ReturnType;
    };
  }
}

/** ZWNJ + future Persian input helpers (Phase 3B: Persian digits). */
export const PersianKeys = Extension.create({
  name: "persianKeys",

  addCommands() {
    return {
      insertZwnj:
        () =>
        ({ commands }) =>
          commands.insertContent(ZWNJ),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-Space": () => this.editor.commands.insertZwnj(),
    };
  },
});
