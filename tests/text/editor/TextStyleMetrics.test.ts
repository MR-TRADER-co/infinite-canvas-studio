// @vitest-environment jsdom
/**
 * Typography metric extensions tests (R3A.4/R3A.6): font size, line height
 * and letter spacing as `textStyle` mark attributes — JSON round-trips,
 * CSS rendering, and command clear behaviour.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { createTextExtensions } from "@/text/editor/extensions";

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

/** The textStyle mark attrs of the first text node. */
function textStyleAttrs(editor: Editor): Record<string, unknown> {
  const paragraph = editor.getJSON().content?.[0];
  const marks = paragraph?.content?.[0]?.marks ?? [];
  return marks.find((mark) => mark.type === "textStyle")?.attrs ?? {};
}

describe("FontSize / LineHeight / LetterSpacing extensions", () => {
  it("sets a span font size that round-trips through JSON and renders as px", () => {
    const editor = makeEditor();
    editor.commands.insertContent("متن");
    editor.commands.selectAll();
    expect(editor.commands.setFontSize(24)).toBe(true);
    expect(textStyleAttrs(editor)["fontSize"]).toBe(24);
    expect(editor.getHTML()).toContain("font-size: 24px");
    const json = editor.getJSON();
    editor.commands.setContent(json);
    expect(editor.getJSON()).toEqual(json);
    editor.destroy();
  });

  it("clears the span font size (falls back to the object base)", () => {
    const editor = makeEditor();
    editor.commands.insertContent("متن");
    editor.commands.selectAll();
    editor.commands.setFontSize(30);
    expect(editor.commands.unsetFontSize()).toBe(true);
    // removeEmptyTextStyle drops the now-empty mark entirely.
    expect(textStyleAttrs(editor)["fontSize"]).toBeUndefined();
    expect(editor.getHTML()).not.toContain("font-size");
    editor.destroy();
  });

  it("sets and clears line height (unitless multiplier)", () => {
    const editor = makeEditor();
    editor.commands.insertContent("text");
    editor.commands.selectAll();
    expect(editor.commands.setLineHeight(1.4)).toBe(true);
    expect(textStyleAttrs(editor)["lineHeight"]).toBe(1.4);
    expect(editor.getHTML()).toContain("line-height: 1.4");
    editor.commands.unsetLineHeight();
    expect(editor.getHTML()).not.toContain("line-height");
    editor.destroy();
  });

  it("sets and clears letter spacing (world units)", () => {
    const editor = makeEditor();
    editor.commands.insertContent("text");
    editor.commands.selectAll();
    expect(editor.commands.setLetterSpacing(2.5)).toBe(true);
    expect(textStyleAttrs(editor)["letterSpacing"]).toBe(2.5);
    expect(editor.getHTML()).toContain("letter-spacing: 2.5px");
    editor.commands.unsetLetterSpacing();
    expect(editor.getHTML()).not.toContain("letter-spacing");
    editor.destroy();
  });

  it("keeps all three metrics on one span simultaneously", () => {
    const editor = makeEditor();
    editor.commands.insertContent("hello");
    editor.commands.selectAll();
    editor.commands.setFontSize(18);
    editor.commands.setLineHeight(2);
    editor.commands.setLetterSpacing(1);
    const attrs = textStyleAttrs(editor);
    expect(attrs).toMatchObject({
      fontSize: 18,
      lineHeight: 2,
      letterSpacing: 1,
    });
    const html = editor.getHTML();
    expect(html).toContain("font-size: 18px");
    expect(html).toContain("line-height: 2");
    expect(html).toContain("letter-spacing: 1px");
    editor.destroy();
  });

  it("coexists with the packaged colour and font-family attributes", () => {
    const editor = makeEditor();
    editor.commands.insertContent("hello");
    editor.commands.selectAll();
    editor.commands.setColor("#b91c1c");
    editor.commands.setFontFamily("Tahoma");
    editor.commands.setFontSize(20);
    const attrs = textStyleAttrs(editor);
    expect(attrs).toMatchObject({
      color: "#b91c1c",
      fontFamily: "Tahoma",
      fontSize: 20,
    });
    editor.destroy();
  });
});
