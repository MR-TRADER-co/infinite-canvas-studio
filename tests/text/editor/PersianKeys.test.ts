// @vitest-environment jsdom
/**
 * Persian keyboard essentials tests (R3A.8 / AC3A.5): the ZWNJ command and
 * the Ctrl+Shift+Space shortcut insert U+200C — «می‌خواهم» keeps its true
 * half-space join.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { createTextExtensions } from "@/text/editor/extensions";
import { ZWNJ, PersianKeys } from "@/text/editor/extensions/PersianKeys";

/** Creates a fresh editor with the full Phase 3A extension set. */
function makeEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: createTextExtensions("…"),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
}

/** The concatenated text of the document. */
function textOf(editor: Editor): string {
  return editor.state.doc.textBetween(
    0,
    editor.state.doc.content.size,
    "\n",
    "\n",
  );
}

describe("PersianKeys (ZWNJ) extension", () => {
  it("registers under the name 'persianKeys'", () => {
    expect(PersianKeys.name).toBe("persianKeys");
  });

  it("insertZwnj inserts U+200C at the caret", () => {
    const editor = makeEditor();
    editor.commands.insertContent("می");
    expect(editor.commands.insertZwnj()).toBe(true);
    editor.commands.insertContent("خواهم");
    const text = textOf(editor);
    expect(text).toBe(`می${ZWNJ}خواهم`);
    expect(text).toContain("\u200C");
    expect(text).not.toContain(" ");
    editor.destroy();
  });

  it("the ZWNJ survives the JSON round-trip byte-exactly", () => {
    const editor = makeEditor();
    editor.commands.insertContent("می");
    editor.commands.insertZwnj();
    editor.commands.insertContent("کنم");
    const json = editor.getJSON();
    const roundTripped = JSON.parse(JSON.stringify(json));
    editor.commands.setContent(roundTripped);
    expect(textOf(editor)).toBe("می\u200Cکنم");
    editor.destroy();
  });

  it("binds Mod-Shift-Space: a synthetic Ctrl+Shift+Space keydown inserts ZWNJ", () => {
    const editor = makeEditor();
    editor.commands.insertContent("نیم");
    editor.commands.focus("end");
    const dom = editor.view.dom as HTMLElement;
    dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        code: "Space",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    editor.commands.insertContent("فاصله");
    expect(textOf(editor)).toBe(`نیم${ZWNJ}فاصله`);
    editor.destroy();
  });
});
