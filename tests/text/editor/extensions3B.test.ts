// @vitest-environment jsdom
/**
 * Phase 3B extension integration tests (R3B.1–R3B.6): the shared editor's
 * REAL extension set drives block formatting, lists (incl. task lists with
 * the "[] " input rule), links and the ZWNJ-aware CharacterCount storage.
 *
 * Markdown input rules (R3B.4) are tested BEHAVIOURALLY: the input-rules
 * plugin's own `handleTextInput` prop is invoked exactly the way
 * ProseMirror invokes it on real typing (verified path — insertContent
 * does not trigger rules in TipTap v2).
 */
import { describe, expect, it } from "vitest";
import {
  getSharedTextEditor,
  textEditorInstanceCount,
} from "@/text/editor/TipTapFactory";
import type { RichTextDocument } from "@/text/editor/richtext";

/** The shared service under test. */
const service = getSharedTextEditor();

/** Loads a plain-text document into the shared editor. */
function load(text: string): void {
  const paragraphs = text.split("\n").map((line) => ({
    type: "paragraph",
    content: line.length === 0 ? undefined : [{ type: "text", text: line }],
  }));
  const doc: RichTextDocument = { type: "doc", content: paragraphs };
  service.loadDocument(doc, "", "test");
}

/** Selects the whole document (block-level commands apply everywhere). */
function selectAll(): void {
  service.getEditor().commands.selectAll();
}

/**
 * Fires the input-rules plugin's handleTextInput exactly as ProseMirror
 * does on real typing: the doc already holds everything but the LAST
 * character, the caret sits after it, and only the final character is
 * "typed" (insertContent does NOT trigger rules in TipTap v2 — this is
 * the verified behavioural path).
 *
 * @param pattern - the full shortcut text (e.g. "# " or "**درشت**").
 * @returns whether a rule matched and transformed the document.
 */
function typeShortcut(pattern: string): boolean {
  const typed = pattern.slice(-1);
  const before = pattern.slice(0, -1);
  load(before);
  const editor = service.getEditor();
  const caret = before.length + 1;
  editor.commands.setTextSelection(caret);
  const plugins = editor.state.plugins.filter(
    (plugin) =>
      typeof (plugin.props as Record<string, unknown>).handleTextInput ===
      "function",
  );
  let applied = false;
  for (const plugin of plugins) {
    const handler = (
      plugin.props as unknown as {
        handleTextInput: (
          view: unknown,
          from: number,
          to: number,
          text: string,
        ) => boolean;
      }
    ).handleTextInput;
    if (handler(editor.view, caret, caret, typed)) {
      applied = true;
    }
  }
  return applied;
}

describe("Phase 3B extensions on the shared editor", () => {
  it("keeps the ONE shared instance contract (AC3A.8)", () => {
    const editor = service.getEditor();
    const before = textEditorInstanceCount();
    expect(service.getEditor()).toBe(editor);
    expect(textEditorInstanceCount()).toBe(before);
  });

  it("applies heading levels and stores them cleanly in the doc JSON (R3B.1)", () => {
    load("سرتیتر");
    selectAll();
    expect(
      service.getEditor().chain().focus().setHeading({ level: 1 }).run(),
    ).toBe(true);
    const doc = service.getDocument();
    expect(doc.content?.[0]?.type).toBe("heading");
    expect(doc.content?.[0]?.attrs?.level).toBe(1);
    // Round-trip: re-loading the JSON keeps the heading.
    service.loadDocument(doc, "", "test");
    expect(service.getEditor().isActive("heading", { level: 1 })).toBe(true);
  });

  it("toggles blockquote (R3B.1)", () => {
    load("متن");
    selectAll();
    expect(service.getEditor().chain().focus().toggleBlockquote().run()).toBe(
      true,
    );
    expect(service.getDocument().content?.[0]?.type).toBe("blockquote");
  });

  it("toggles code block (R3B.1)", () => {
    load("متن");
    selectAll();
    expect(service.getEditor().chain().focus().toggleCodeBlock().run()).toBe(
      true,
    );
    expect(service.getDocument().content?.[0]?.type).toBe("codeBlock");
  });

  it("inserts a horizontal rule (R3B.1)", () => {
    load("a");
    const editor = service.getEditor();
    editor.commands.setTextSelection(0);
    expect(editor.chain().focus().setHorizontalRule().run()).toBe(true);
    expect(service.getDocument().content?.[0]?.type).toBe("horizontalRule");
  });

  it("creates bullet/ordered/task lists with toggle commands (R3B.2)", () => {
    load("مورد");
    selectAll();
    expect(service.getEditor().chain().focus().toggleBulletList().run()).toBe(
      true,
    );
    expect(service.getDocument().content?.[0]?.type).toBe("bulletList");
    load("مورد");
    selectAll();
    expect(service.getEditor().chain().focus().toggleOrderedList().run()).toBe(
      true,
    );
    expect(service.getDocument().content?.[0]?.type).toBe("orderedList");
    load("مورد");
    selectAll();
    expect(service.getEditor().chain().focus().toggleTaskList().run()).toBe(
      true,
    );
    expect(service.getDocument().content?.[0]?.type).toBe("taskList");
    expect(service.getDocument().content?.[0]?.content?.[0]?.type).toBe(
      "taskItem",
    );
  });

  it("toggles a task item's checkbox through its attrs (R3B.2, click parity)", () => {
    load("کار");
    selectAll();
    service.getEditor().chain().focus().toggleTaskList().run();
    const item = service.getDocument().content?.[0]?.content?.[0];
    expect(item?.attrs?.checked).toBe(false);
    service
      .getEditor()
      .chain()
      .focus()
      .updateAttributes("taskItem", { checked: true })
      .run();
    expect(
      service.getDocument().content?.[0]?.content?.[0]?.attrs?.checked,
    ).toBe(true);
  });

  it("sinks and lifts list items (R3B.2 Tab/Shift+Tab semantics)", () => {
    // A two-item bullet list, caret inside the SECOND item's text.
    const doc: RichTextDocument = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "یک" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "دو" }] },
              ],
            },
          ],
        },
      ],
    };
    service.loadDocument(doc, "", "test");
    const editor = service.getEditor();
    let caret = 1;
    editor.state.doc.descendants((node, pos) => {
      if (node.text === "دو") {
        caret = pos + 1;
        return false;
      }
      return true;
    });
    editor.commands.setTextSelection(caret);
    // Sink the second item one level (Tab semantics): it nests INSIDE the
    // first item as a child bulletList.
    expect(editor.commands.sinkListItem("listItem")).toBe(true);
    expect(
      service.getDocument().content?.[0]?.content?.[0]?.content?.[1]?.type,
    ).toBe("bulletList");
    // Lift it back (Shift+Tab semantics): the second item returns to the
    // top level with a plain paragraph.
    editor.commands.setTextSelection(caret + 2);
    expect(editor.commands.liftListItem("listItem")).toBe(true);
    expect(
      service.getDocument().content?.[0]?.content?.[1]?.content?.[0]?.type,
    ).toBe("paragraph");
  });

  it("applies and removes links on a selection (R3B.3)", () => {
    load("مستندات");
    const editor = service.getEditor();
    editor.commands.setTextSelection({ from: 1, to: 9 });
    expect(
      editor.chain().focus().setLink({ href: "https://example.com" }).run(),
    ).toBe(true);
    expect(editor.isActive("link")).toBe(true);
    expect(editor.getAttributes("link").href).toBe("https://example.com");
    const doc = service.getDocument();
    const marks = doc.content?.[0]?.content?.[0]?.marks ?? [];
    expect(marks.some((mark) => mark.type === "link")).toBe(true);
    expect(editor.chain().focus().unsetLink().run()).toBe(true);
    expect(editor.isActive("link")).toBe(false);
  });

  it("counts words and characters with ZWNJ awareness (R3B.6 / AC3B.6)", () => {
    load("می‌خواهم بروم");
    const storage = service.getEditor().storage.characterCount as {
      words: () => number;
      characters: () => number;
    };
    expect(storage.words()).toBe(2);
    expect(storage.characters()).toBe("می‌خواهم بروم".length);
  });

  it("registers every Phase 3B extension (R3B.1–R3B.6)", () => {
    const extensions = service
      .getEditor()
      .extensionManager.extensions.map((ext) => ext.name);
    expect(extensions).toContain("heading");
    expect(extensions).toContain("bulletList");
    expect(extensions).toContain("orderedList");
    expect(extensions).toContain("taskList");
    expect(extensions).toContain("taskItem");
    expect(extensions).toContain("blockquote");
    expect(extensions).toContain("codeBlock");
    expect(extensions).toContain("horizontalRule");
    expect(extensions).toContain("link");
    expect(extensions).toContain("characterCount");
    expect(extensions).toContain("listIndent");
  });

  it("fires the markdown input rules on typed shortcuts (R3B.4 / AC3B.4)", () => {
    // Each rule fires with the pattern minus its LAST character already in
    // the doc (real typing) and the final character typed at the caret.
    const cases: Array<{ typed: string; check: () => boolean; label: string }> =
      [
        {
          typed: "# ",
          label: "H1",
          check: () => service.getEditor().isActive("heading", { level: 1 }),
        },
        {
          typed: "## ",
          label: "H2",
          check: () => service.getEditor().isActive("heading", { level: 2 }),
        },
        {
          typed: "### ",
          label: "H3",
          check: () => service.getEditor().isActive("heading", { level: 3 }),
        },
        {
          typed: "- ",
          label: "bullet",
          check: () => service.getEditor().isActive("bulletList"),
        },
        {
          typed: "1. ",
          label: "ordered",
          check: () => service.getEditor().isActive("orderedList"),
        },
        {
          typed: "> ",
          label: "quote",
          check: () => service.getEditor().isActive("blockquote"),
        },
        {
          typed: "[ ] ",
          label: "task",
          check: () => service.getEditor().isActive("taskList"),
        },
        { typed: "**درشت**", label: "bold", check: () => markApplied("bold") },
        {
          typed: "*مورب*",
          label: "italic",
          check: () => markApplied("italic"),
        },
        {
          typed: "~~خط‌خورده~~",
          label: "strike",
          check: () => markApplied("strike"),
        },
        { typed: "`کد`", label: "code", check: () => markApplied("code") },
      ];
    for (const testCase of cases) {
      const applied = typeShortcut(testCase.typed);
      expect(applied, `input rule "${testCase.label}" fired`).toBe(true);
      expect(
        testCase.check(),
        `input rule "${testCase.label}" transformed the doc`,
      ).toBe(true);
    }
  });
});

/**
 * Checks that a MARK landed on the document text (mark input rules remove
 * the stored mark at the caret, so `isActive` reads false right after —
 * the mark lives on the text node itself).
 *
 * @param markType - the mark's schema name.
 * @returns whether any text node in the current document carries the mark.
 */
function markApplied(markType: string): boolean {
  let found = false;
  service.getDocument().content?.[0]?.content?.[0]?.marks?.forEach((mark) => {
    if (mark.type === markType) {
      found = true;
    }
  });
  return found;
}
