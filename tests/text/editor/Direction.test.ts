// @vitest-environment jsdom
/**
 * Direction extension tests (R3A.5 / AC3A.4):
 * - every block carries a `dir` attribute, defaulting to `auto`
 *   (per-paragraph bidi auto-detection by first strong character);
 * - the explicit RTL/LTR toggle stamps the block's `dir`;
 * - unsetting returns blocks to auto;
 * - auto-detected RTL (Persian) and LTR (English) paragraphs coexist in
 *   one object, each keeping its own direction;
 * - the document round-trips losslessly (JSON → setContent → JSON).
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { createTextExtensions } from "@/text/editor/extensions";
import {
  currentBlockDirection,
  Direction,
  type TextDirection,
} from "@/text/editor/extensions/Direction";

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

/** Types text into the editor at the caret (single transaction). */
function type(editor: Editor, text: string): void {
  editor.commands.insertContent(text);
}

/** The paragraph nodes of the current document. */
function paragraphs(editor: Editor): Array<{ attrs: Record<string, unknown> }> {
  return (editor.getJSON().content ?? []).map((node) => ({
    attrs: node.attrs ?? {},
  }));
}

describe("Direction extension", () => {
  it("registers under the name 'direction'", () => {
    expect(Direction.name).toBe("direction");
  });

  it('renders every paragraph with dir="auto" by default', () => {
    const editor = makeEditor();
    type(editor, "سلام");
    expect(editor.getHTML()).toContain('<p dir="auto">');
    editor.destroy();
  });

  it("stamps an explicit RTL direction on the selected block", () => {
    const editor = makeEditor();
    type(editor, "hello");
    expect(editor.commands.setTextDirection("rtl")).toBe(true);
    expect(editor.getHTML()).toContain('<p dir="rtl">');
    const [paragraph] = paragraphs(editor);
    expect(paragraph?.attrs["dir"]).toBe("rtl");
    editor.destroy();
  });

  it("stamps an explicit LTR direction and round-trips it through JSON", () => {
    const editor = makeEditor();
    type(editor, "سلام");
    editor.commands.setTextDirection("ltr");
    const json = editor.getJSON();
    expect(json.content?.[0]?.attrs?.["dir"]).toBe("ltr");
    // Round-trip: JSON → setContent → JSON is lossless.
    editor.commands.setContent(json);
    expect(editor.getJSON()).toEqual(json);
    editor.destroy();
  });

  it("unsetting returns the block to auto (attr resets to the default)", () => {
    const editor = makeEditor();
    type(editor, "سلام");
    editor.commands.setTextDirection("rtl");
    expect(editor.commands.unsetTextDirection()).toBe(true);
    const json = editor.getJSON();
    // TipTap serializes the full attrs object: the reset restores the
    // schema default "auto" (never a stale explicit value).
    expect(json.content?.[0]?.attrs?.["dir"]).toBe("auto");
    expect(editor.getHTML()).toContain('<p dir="auto">');
    editor.destroy();
  });

  it("lets RTL (Persian) and LTR (English) paragraphs coexist, each auto-detected", () => {
    const editor = makeEditor();
    type(editor, "این یک پاراگراف فارسی است");
    editor.commands.enter();
    type(editor, "This paragraph is English");
    const html = editor.getHTML();
    expect(html).toContain('<p dir="auto">این یک پاراگراف فارسی است</p>');
    expect(html).toContain('<p dir="auto">This paragraph is English</p>');
    // Two paragraphs, both on the auto default (per-block detection).
    expect(paragraphs(editor).every((p) => p.attrs["dir"] === "auto")).toBe(
      true,
    );
    editor.destroy();
  });

  it("reports the current block direction (explicit or auto)", () => {
    const editor = makeEditor();
    type(editor, "mixed");
    expect(currentBlockDirection(editor)).toBe<TextDirection>("auto");
    editor.commands.setTextDirection("rtl");
    expect(currentBlockDirection(editor)).toBe<TextDirection>("rtl");
    editor.commands.setTextDirection("ltr");
    expect(currentBlockDirection(editor)).toBe<TextDirection>("ltr");
    editor.destroy();
  });

  it("applies the direction to every selected block (multi-paragraph selection)", () => {
    const editor = makeEditor();
    type(editor, "یک");
    editor.commands.enter();
    type(editor, "دو");
    editor.commands.selectAll();
    editor.commands.setTextDirection("ltr");
    const dirs = paragraphs(editor).map((p) => p.attrs["dir"]);
    expect(dirs).toEqual(["ltr", "ltr"]);
    editor.destroy();
  });
});
