/**
 * Direction extension (R3A.5): every text block carries a `dir` attribute.
 *
 * The default is `dir="auto"` — the browser's bidi algorithm detects each
 * paragraph's base direction from its first strong character (UAX #9), so
 * mixed Persian/Latin/numeral paragraphs coexist correctly WITHOUT manual
 * re-ordering. An explicit `rtl`/`ltr` (the toolbar toggle) overrides the
 * auto detection for that block; `unsetTextDirection` returns it to auto.
 */
import { Extension, type Editor } from "@tiptap/core";

/** Block direction values (the DOM `dir` attribute subset we use). */
export type TextDirection = "rtl" | "ltr" | "auto";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textDirection: {
      /** Sets an explicit direction on every selected text block. */
      setTextDirection: (
        direction: Exclude<TextDirection, "auto">,
      ) => ReturnType;
      /** Returns every selected text block to `dir="auto"`. */
      unsetTextDirection: () => ReturnType;
    };
  }
}

/** Block node types carrying the `dir` attribute (list CONTAINERS are
 * included so list markers and their padding flip to the correct side for
 * RTL paragraphs — R3B.2). */
const DIRECTION_TYPES = [
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "taskList",
  "bulletList",
  "orderedList",
  "blockquote",
] as const;

/** Persian numerals etc. stay neutral — only strong characters decide. */
export const Direction = Extension.create({
  name: "direction",

  addOptions() {
    return {
      types: [...DIRECTION_TYPES],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          dir: {
            default: "auto",
            parseHTML: (element) => {
              const dir = element.getAttribute("dir");
              return dir === "rtl" || dir === "ltr" ? dir : "auto";
            },
            renderHTML: (attributes) => ({
              dir: attributes.dir ?? "auto",
            }),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextDirection:
        (direction) =>
        ({ commands }) =>
          this.options.types.every((type: string) =>
            commands.updateAttributes(type, { dir: direction }),
          ),
      unsetTextDirection:
        () =>
        ({ commands }) =>
          this.options.types.every((type: string) =>
            commands.resetAttributes(type, "dir"),
          ),
    };
  },
});

/**
 * Reads the effective direction of the block at the caret/selection.
 *
 * @param editor - the shared editor.
 * @returns the block's `dir` value (explicit or "auto").
 */
export function currentBlockDirection(editor: Editor): TextDirection {
  const attrs = {
    ...editor.getAttributes("paragraph"),
    ...editor.getAttributes("heading"),
  };
  const dir = attrs.dir;
  return dir === "rtl" || dir === "ltr" ? dir : "auto";
}
