/**
 * Markdown interop round-trip tests (R13.1, AC13.1 adapted to the
 * rebuilt base): export a scene → re-import the files → titles,
 * identities (geometry/colours) and rich-text projections are
 * semantically identical; the shape is only summarized in index.md.
 */
import { describe, expect, it } from "vitest";
import {
  docToMarkdown,
  exportSceneToMarkdown,
  importMarkdownFiles,
  markdownToDoc,
  plainTextOf,
  slugify,
} from "@/persistence/MarkdownInterop";
import type { RichTextDocument } from "@/text/editor/richtext";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Deterministic id source for the importer. */
function idSource(): () => string {
  let next = 0;
  return () => `imp-${(next += 1)}`;
}

/** The Appendix-G-style fixture (adapted): 2 text + 1 sticky + 1 shape. */
function fixtureScene(): readonly SceneObjectData[] {
  const headingDoc = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "گزارش روزانه" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "متن " },
          { type: "text", text: "درشت", marks: [{ type: "bold" }] },
          { type: "text", text: " و [[پیوند ویکی]]" },
        ],
      },
    ],
  } as RichTextDocument;
  const paraDoc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "پاراگراف عادی با " },
          { type: "text", text: "ایتالیک", marks: [{ type: "italic" }] },
        ],
      },
    ],
  } as RichTextDocument;
  return [
    {
      kind: "textBox",
      id: "t1",
      position: { x: 0, y: 0 },
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      width: 320,
      height: 120,
      text: "گزارش روزانه\nمتن درشت و [[پیوند ویکی]]",
      doc: headingDoc,
      sizeMode: "fixed",
      fontSize: 20,
      color: "var(--foreground)",
    } as unknown as SceneObjectData,
    {
      kind: "textBox",
      id: "t2",
      position: { x: 400, y: 0 },
      rotation: 0,
      zIndex: 1,
      visible: true,
      locked: false,
      width: 300,
      height: 80,
      text: "پاراگراف عادی با ایتالیک",
      doc: paraDoc,
      sizeMode: "fixed",
      fontSize: 18,
      color: "var(--foreground)",
    } as unknown as SceneObjectData,
    {
      kind: "stickyNote",
      id: "s1",
      position: { x: 0, y: 200 },
      rotation: 0,
      zIndex: 2,
      visible: true,
      locked: false,
      width: 220,
      height: 220,
      text: "یادداشت مهم",
      fontSize: 18,
      noteColor: "oklch(0.87 0.14 85)",
      color: "oklch(0.30 0.03 55)",
    } as unknown as SceneObjectData,
    {
      kind: "shape",
      id: "sh1",
      position: { x: 500, y: 300 },
      rotation: 0,
      zIndex: 3,
      visible: true,
      locked: false,
    } as unknown as SceneObjectData,
  ];
}

describe("MarkdownExporter (R13.1)", () => {
  it("produces index.md + one file per text object, non-text summarized (lossy)", () => {
    const files = exportSceneToMarkdown(fixtureScene(), "پروژهٔ آزمایشی");
    expect(files[0]?.path).toBe("index.md");
    const paths = files.map((file) => file.path);
    expect(paths).toContain("گزارش-روزانه.md");
    expect(paths).toContain("پاراگراف-عادی-با-ایتالیک.md");
    expect(paths).toContain("یادداشت-مهم.md");
    expect(paths).not.toContain("sh1.md");
    expect(files[0]?.content).toContain("پروژهٔ آزمایشی");
    // The shape's id is summarized in the index.
    expect(files[0]?.content).toContain("sh1");
  });

  it("deduplicates colliding slugs", () => {
    const twin = fixtureScene().map((object) =>
      object.id === "t2" ? { ...object, text: "گزارش روزانه\nx" } : object,
    );
    const files = exportSceneToMarkdown(twin, "p");
    const mdPaths = files
      .map((file) => file.path)
      .filter((path) => path.endsWith(".md") && path !== "index.md");
    expect(new Set(mdPaths).size).toBe(mdPaths.length);
  });

  it("carries identity frontmatter + rich runs in the body", () => {
    const files = exportSceneToMarkdown(fixtureScene(), "p");
    const heading = files.find((file) => file.path === "گزارش-روزانه.md");
    expect(heading).toBeDefined();
    expect(heading?.content.startsWith("---\n")).toBe(true);
    expect(heading?.content).toContain("kind: textBox");
    expect(heading?.content).toContain("id: t1");
    expect(heading?.content).toContain("# گزارش روزانه");
    expect(heading?.content).toContain("**درشت**");
    expect(heading?.content).toContain("[[پیوند ویکی]]");
  });
});

describe("MarkdownImporter (R13.1)", () => {
  it("round-trips titles, geometry, colours and the text projection (AC13.1)", () => {
    const exported = exportSceneToMarkdown(fixtureScene(), "p");
    const textFiles = exported.filter((file) => file.path !== "index.md");
    const imported = importMarkdownFiles(
      textFiles.map((file) => ({ name: file.path, content: file.content })),
      idSource(),
    );
    expect(imported.length).toBe(3);

    const byOriginal = new Map(
      imported.map((entry) => {
        const draft = entry.object as Record<string, unknown>;
        return [draft.importedFromId as string, draft];
      }),
    );
    // Text 1: identity + geometry + colour + text.
    const t1 = byOriginal.get("t1") as Record<string, unknown>;
    expect(t1.width).toBe(320);
    expect(t1.fontSize).toBe(20);
    expect(t1.position).toEqual({ x: 0, y: 0 });
    expect(plainTextOf(t1.doc as RichTextDocument)).toBe(
      "گزارش روزانه\nمتن درشت و [[پیوند ویکی]]",
    );
    // Sticky: kind + note colour survive.
    const s1 = byOriginal.get("s1") as Record<string, unknown>;
    expect(s1.kind).toBe("stickyNote");
    expect(s1.noteColor).toBe("oklch(0.87 0.14 85)");
    expect(plainTextOf(s1.doc as RichTextDocument)).toBe("یادداشت مهم");
  });

  it("rebuilds heading + bold structure through markdown-it", () => {
    const doc = markdownToDoc("# تیتر\n\nپاراگراف **درشت**");
    expect(doc.type).toBe("doc");
    const blocks = doc.content ?? [];
    expect(blocks[0]?.type).toBe("heading");
    expect(
      (blocks[0]?.attrs as { level?: number } | undefined)?.level,
    ).toBe(1);
    const runs = (blocks[1]?.content ?? []) as Array<{
      type: string;
      text?: string;
      marks?: Array<{ type: string }>;
    }>;
    const bold = runs.find((run) => run.marks?.[0]?.type === "bold");
    expect(bold?.text).toBe("درشت");
  });

  it("degrades a corrupt frontmatter block to defaults (never a crash)", () => {
    const imported = importMarkdownFiles(
      [{ name: "x.md", content: "---\nyaml: [broken\n---\n\n# سلام" }],
      idSource(),
    );
    expect(imported.length).toBe(1);
    expect(
      plainTextOf(imported[0]?.object.doc as RichTextDocument),
    ).toBe("سلام");
  });
});

describe("docToMarkdown + slugify helpers", () => {
  it("projects docs with headings and marks", () => {
    const md = docToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "H2" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "a " },
              { type: "text", text: "b", marks: [{ type: "bold" }] },
              { type: "text", text: " " },
              { type: "text", text: "c", marks: [{ type: "code" }] },
            ],
          },
        ],
      } as RichTextDocument,
      "",
    );
    expect(md).toBe("## H2\na **b** `c`");
  });

  it("keeps Persian letters in slugs and falls back when empty", () => {
    expect(slugify("سلام دنیا ۱۲!", "fb")).toBe("سلام-دنیا-۱۲");
    expect(slugify("!!!", "fallback")).toBe("fallback");
  });
});
