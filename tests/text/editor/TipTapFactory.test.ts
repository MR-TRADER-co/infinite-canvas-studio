// @vitest-environment jsdom
/**
 * Shared editor service tests (R3A.4 / AC3A.3 / AC3A.8):
 * - ONE editor instance ever (service reuse across loads);
 * - document swapping resets the internal undo history (the next object's
 *   Ctrl+Z must never replay the previous object's typing);
 * - static HTML serialization is identical to the live view's DOM.
 */
import { describe, expect, it } from "vitest";
import { undoDepth } from "@tiptap/pm/history";
import {
  getSharedTextEditor,
  renderRichTextHTML,
  textEditorInstanceCount,
} from "@/text/editor/TipTapFactory";
import {
  richTextFromPlainText,
  type RichTextDocument,
} from "@/text/editor/richtext";

/** The service under test (module singleton). */
const service = getSharedTextEditor();

/** A document with one Persian and one English paragraph. */
const MIXED_DOC: RichTextDocument = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "سلام دنیا" }] },
    { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
  ],
};

describe("TextEditorService (the one shared TipTap editor)", () => {
  it("reuses one editor instance across documents (AC3A.8)", () => {
    const before = textEditorInstanceCount();
    const first = service.getEditor();
    service.loadDocument(MIXED_DOC, "…", "obj-a");
    const second = service.getEditor();
    service.loadDocument(richTextFromPlainText("другой"), "…", "obj-b");
    expect(second).toBe(first);
    expect(textEditorInstanceCount()).toBe(before + 1);
  });

  it("loads documents with lossless JSON round-trips", () => {
    service.loadDocument(MIXED_DOC, "…", "obj-a");
    const loaded = service.getDocument();
    // The schema normalises block attrs (dir=auto, textAlign=null) on
    // load; the lossless contract is getJSON → setContent → getJSON.
    const json = JSON.parse(JSON.stringify(loaded));
    service.getEditor().commands.setContent(json);
    expect(JSON.parse(JSON.stringify(service.getDocument()))).toEqual(json);
    expect(loaded.content?.[0]?.content?.[0]?.text).toBe("سلام دنیا");
    expect(loaded.content?.[1]?.content?.[0]?.text).toBe("Hello world");
    // A null doc loads as an empty paragraph document.
    service.loadDocument(null, "…", "obj-c");
    const empty = service.getDocument();
    expect(empty.content?.[0]?.type).toBe("paragraph");
    const emptyJson = JSON.parse(JSON.stringify(empty));
    service.getEditor().commands.setContent(emptyJson);
    expect(JSON.parse(JSON.stringify(service.getDocument()))).toEqual(
      emptyJson,
    );
  });

  it("resets the internal undo history on every document swap (R3A.3)", () => {
    service.loadDocument(MIXED_DOC, "…", "obj-a");
    const editor = service.getEditor();
    editor.commands.insertContent("!");
    expect(undoDepth(editor.state)).toBeGreaterThan(0);
    // Swap to another object: the previous object's history must not leak.
    service.loadDocument(richTextFromPlainText("plain"), "…", "obj-b");
    expect(undoDepth(editor.state)).toBe(0);
    expect(service.currentObjectId).toBe("obj-b");
  });

  it("serializes static HTML identical to the live editor DOM", () => {
    service.loadDocument(MIXED_DOC, "…", "obj-a");
    const schema = service.getSchema();
    const staticHtml = renderRichTextHTML(schema, service.getDocument());
    // The live editor renders the same paragraphs with dir=auto; the
    // static serialization matches the live structure block-for-block.
    expect(staticHtml).toBe(
      '<p dir="auto">سلام دنیا</p><p dir="auto">Hello world</p>',
    );
  });

  it("mounts and detaches the host without re-creating the editor", () => {
    const before = textEditorInstanceCount();
    const container = document.createElement("div");
    document.body.appendChild(container);
    service.mount(container);
    expect(service.mountedIn()).toBe(container);
    expect(container.contains(service.getHost())).toBe(true);
    const proseMirror = service.getHost().querySelector(".ProseMirror");
    expect(proseMirror).not.toBeNull();
    service.detach();
    expect(service.mountedIn()).toBeNull();
    expect(container.contains(service.getHost())).toBe(false);
    expect(textEditorInstanceCount()).toBe(before);
  });

  it("updates the placeholder live (language switch)", () => {
    service.loadDocument(null, "first", "obj-p");
    service.setPlaceholder("دوم");
    expect(service.currentPlaceholder()).toBe("دوم");
    expect(service.currentPlaceholder()).not.toBe("first");
  });
});
