/**
 * List indentation (R3B.2): Tab / Shift+Tab change the nesting depth of the
 * list item (bullet, ordered OR task) at the caret.
 *
 * TipTap v2 ships the `sinkListItem` / `liftListItem` commands but binds no
 * Tab shortcut by default (Tab is reserved for focus traversal); lists on a
 * canvas have no focus-traversal semantics, so binding it here is safe and
 * matches every mainstream editor (Word, Google Docs, Notion).
 *
 * The extension returns false when the caret is not in a list, so ProseMirror
 * falls through to the next handler (Tab does nothing in plain paragraphs —
 * inserting tab characters on a canvas is meaningless).
 */
import { Extension, type Editor } from "@tiptap/core";

/** Node types whose items sink/lift (bullet+ordered share "listItem"). */
const LIST_ITEM_TYPES = ["listItem", "taskItem"] as const;

/**
 * Sinks the current list item one level deeper (bullet, ordered and task
 * items all share the item semantics).
 *
 * @param editor - the shared editor.
 * @returns whether a list item was sunk.
 */
function sinkCurrentItem(editor: Editor): boolean {
  for (const type of LIST_ITEM_TYPES) {
    if (editor.commands.sinkListItem(type)) {
      return true;
    }
  }
  return false;
}

/**
 * Lifts the current list item one level shallower; lifting the LAST
 * top-level item dissolves the list (paragraph promotion).
 *
 * @param editor - the shared editor.
 * @returns whether a list item was lifted.
 */
function liftCurrentItem(editor: Editor): boolean {
  for (const type of LIST_ITEM_TYPES) {
    if (editor.commands.liftListItem(type)) {
      return true;
    }
  }
  return false;
}

/** Tab / Shift+Tab list-depth keyboard behaviour. */
export const ListIndent = Extension.create({
  name: "listIndent",

  addKeyboardShortcuts() {
    const editor = this.editor;
    return {
      Tab: () => sinkCurrentItem(editor),
      "Shift-Tab": () => liftCurrentItem(editor),
    };
  },
});
