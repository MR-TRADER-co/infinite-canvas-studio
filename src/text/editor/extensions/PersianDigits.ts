/**
 * Persian-digit input rule (R8.2 `convertTypedDigits`): when the setting
 * is on, NEWLY TYPED ASCII digits inside rich-text editors become
 * Persian digits at the caret. Existing text is never rewritten (the
 * rule intercepts text input only — no document scans, no history
 * entries).
 *
 * The enabled probe is injected (`setPersianDigitsInputEnabled`) so this
 * text-layer module never imports the UI store (layering rule).
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/** ASCII → Persian digit mapping. */
const PERSIAN_DIGITS: readonly string[] = [
  "۰",
  "۱",
  "۲",
  "۳",
  "۴",
  "۵",
  "۶",
  "۷",
  "۸",
  "۹",
];

/** Module-level enabled probe (bound by the composition root). */
let enabledProbe: () => boolean = () => false;

/**
 * Binds the "is typed-digit conversion on?" probe (App.ts boot).
 *
 * @param probe - the live probe (reads the UI store's slice).
 */
export function setPersianDigitsInputEnabled(probe: () => boolean): void {
  enabledProbe = probe;
}

/** The input-rule extension id. */
export const PERSIAN_DIGITS_KEY = new PluginKey("persianDigitsInput");

/**
 * The extension: intercepts single-character text input and swaps ASCII
 * digits for Persian digits BEFORE they enter the document.
 */
export const PersianDigitsInput = Extension.create({
  name: "persianDigitsInput",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: PERSIAN_DIGITS_KEY,
        props: {
          handleTextInput: (view, from, to, text) => {
            if (!enabledProbe() || !/^[0-9]$/.test(text)) {
              return false;
            }
            const persian = PERSIAN_DIGITS[Number(text)];
            if (persian === undefined) {
              return false;
            }
            view.dispatch(view.state.tr.insertText(persian, from, to));
            return true;
          },
        },
      }),
    ];
  },
});
