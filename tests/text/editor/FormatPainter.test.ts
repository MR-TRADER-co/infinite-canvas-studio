// @vitest-environment jsdom
/**
 * Format Painter tests (R7.5/AC7.5): the fingerprint capture (inline
 * marks + block node) and the REPLACE-semantics application — bold +
 * colour + heading level transferring between two different documents.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { createTextExtensions } from "@/text/editor/extensions";
import {
  applyFormat,
  captureFormat,
  clearPaintFormat,
  copyFormatFrom,
  hasPaintFormat,
  pasteFormatOnto,
} from "@/text/editor/FormatPainter";

/** Creates a fresh editor with the full extension set. */
function makeEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: createTextExtensions("…"),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
}

/** Selects the whole document (all text). */
function selectAll(editor: Editor): void {
  editor.commands.focus();
  editor.commands.selectAll();
}

describe("captureFormat (R7.5)", () => {
  it("captures bold + text colour + the heading block", () => {
    const editor = makeEditor();
    // A span carries the inline style so the parser builds the
    // textStyle mark (a bare <strong style> drops the colour).
    editor.commands.setContent(
      `<h1><strong><span style="color: #e11d48">تیتر رنگی</span></strong></h1>`,
    );
    selectAll(editor);
    const fingerprint = captureFormat(editor);
    expect(fingerprint).not.toBeNull();
    const names = fingerprint?.marks.map((mark) => mark.name) ?? [];
    expect(names).toContain("bold");
    expect(names).toContain("textStyle");
    const textStyle = fingerprint?.marks.find(
      (mark) => mark.name === "textStyle",
    );
    // jsdom normalises hex colours to rgb().
    expect(String(textStyle?.attrs.color)).toMatch(/225,\s*29,\s*72/);
    expect(fingerprint?.block?.name).toBe("heading");
    expect(fingerprint?.block?.attrs.level).toBe(1);
    editor.destroy();
  });

  it("captures a plain paragraph with no marks", () => {
    const editor = makeEditor();
    editor.commands.insertContent("متن ساده");
    const fingerprint = captureFormat(editor);
    expect(fingerprint?.marks).toHaveLength(0);
    expect(fingerprint?.block?.name).toBe("paragraph");
    editor.destroy();
  });
});

describe("applyFormat (R7.5/AC7.5)", () => {
  it("transfers bold + colour + heading level onto another document", () => {
    const source = makeEditor();
    source.commands.setContent(
      `<h2><strong><span style="color: #0ea5e9">منبع</span></strong></h2>`,
    );
    selectAll(source);
    const fingerprint = captureFormat(source);

    const target = makeEditor();
    target.commands.insertContent("مقصد بدون قالب");
    selectAll(target);
    expect(fingerprint).not.toBeNull();
    expect(
      applyFormat(target, fingerprint as NonNullable<typeof fingerprint>),
    ).toBe(true);

    const html = target.getHTML();
    expect(html).toContain("<h2");
    expect(html).toContain("<strong");
    expect(html.toLowerCase()).toContain("color");
    source.destroy();
    target.destroy();
  });

  it("REPLACE semantics: the target's previous marks are stripped", () => {
    const source = makeEditor();
    source.commands.setContent("<p>ساده</p>");
    selectAll(source);
    const fingerprint = captureFormat(source);

    const target = makeEditor();
    target.commands.setContent("<p><em><s>متن خط‌خوردهٔ مورب</s></em></p>");
    selectAll(target);
    applyFormat(target, fingerprint as NonNullable<typeof fingerprint>);
    const html = target.getHTML();
    expect(html).not.toContain("<em>");
    expect(html).not.toContain("<s>");
    source.destroy();
    target.destroy();
  });
});

describe("painter clipboard (R7.5)", () => {
  it("copy → has → apply onto another editor → clear", () => {
    clearPaintFormat();
    expect(hasPaintFormat()).toBe(false);
    expect(pasteFormatOnto(makeEditor())).toBe(false);

    const source = makeEditor();
    source.commands.setContent("<h3><strong>منبع</strong></h3>");
    selectAll(source);
    expect(copyFormatFrom(source)).toBe(true);
    expect(hasPaintFormat()).toBe(true);

    const target = makeEditor();
    target.commands.insertContent("هدف");
    selectAll(target);
    expect(pasteFormatOnto(target)).toBe(true);
    expect(target.getHTML()).toContain("<h3");

    clearPaintFormat();
    expect(hasPaintFormat()).toBe(false);
    source.destroy();
    target.destroy();
  });
});
