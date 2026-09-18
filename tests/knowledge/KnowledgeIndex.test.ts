/**
 * Knowledge-index tests (Knowledge Pack, pack-Phase-11 rebuild): title
 * resolution (name > first heading > first line), directed links +
 * backlinks, broken (unresolved) titles, ambiguity and the tag index.
 */
import { describe, expect, it } from "vitest";
import {
  buildKnowledgeIndex,
  EMPTY_KNOWLEDGE_INDEX,
  objectTitleOf,
} from "@/core/knowledge/KnowledgeIndex";
import { vec2 } from "@/core/geometry/Vec2";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import type { RichTextDocument } from "@/text/editor/richtext";

/** Builds a text-box fixture with PLAIN text (doc-less legacy path). */
function textBox(id: string, text: string, name?: string): TextBoxObjectData {
  return {
    id,
    kind: "textBox",
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    width: 200,
    height: 60,
    text,
    doc: null,
    sizeMode: "fixed",
    fontSize: 20,
    color: "token://text",
    ...(name === undefined ? {} : { name }),
  };
}

/** Builds a text-box fixture carrying a rich-text doc. */
function docTextBox(
  id: string,
  doc: RichTextDocument | null,
  text = "",
): TextBoxObjectData {
  return { ...textBox(id, text), doc };
}

/** A doc whose first block is an H1. */
function docWithHeading(level: 1 | 2 | 3, text: string): RichTextDocument {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level }, content: [{ type: "text", text }] },
    ],
  } as unknown as RichTextDocument;
}

/** A minimal non-text object (a frame-ish shape) with a name. */
function namedShape(id: string, name: string): SceneObjectData {
  return {
    id,
    kind: "frame",
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    width: 100,
    height: 80,
    titleHeight: 28,
    title: "",
    fill: "accent",
    stroke: "primary",
    strokeWidth: 2,
    name,
  } as unknown as SceneObjectData;
}

describe("objectTitleOf", () => {
  it("prefers the custom name", () => {
    expect(objectTitleOf(textBox("a", "خط اول", "نام دلخواه"))?.display).toBe(
      "نام دلخواه",
    );
  });

  it("falls back to the first heading when unnamed", () => {
    const object = docTextBox("a", docWithHeading(1, "سرفصل اصلی"));
    expect(objectTitleOf(object)?.display).toBe("سرفصل اصلی");
  });

  it("falls back to the first non-empty line", () => {
    expect(objectTitleOf(textBox("a", "\n\nخط اول متن\nخط دوم"))?.display).toBe(
      "خط اول متن",
    );
  });

  it("truncates very long first lines with an ellipsis", () => {
    const long = "x".repeat(80);
    const title = objectTitleOf(textBox("a", long));
    expect(title?.display.endsWith("…")).toBe(true);
    expect((title?.display.length ?? 0) <= 49).toBe(true);
  });

  it("resolves nothing for empty text objects", () => {
    expect(objectTitleOf(textBox("a", ""))).toBeNull();
    expect(objectTitleOf(textBox("a", "   \n  "))).toBeNull();
  });

  it("resolves nothing for unnamed non-text objects", () => {
    expect(objectTitleOf(namedShape("f", ""))).toBeNull();
  });
});

describe("buildKnowledgeIndex", () => {
  it("returns the shared empty index for an empty scene", () => {
    const index = buildKnowledgeIndex([]);
    expect(index.titles.size).toBe(0);
    expect(index.outgoing.size).toBe(0);
    expect(index).toBe(EMPTY_KNOWLEDGE_INDEX);
  });

  it("resolves a link by name and records the backlink", () => {
    const source = textBox("src", "برای جزئیات [[نقشه راه]] را ببین.");
    const target = textBox("dst", "متن مقصد", "نقشه راه");
    const index = buildKnowledgeIndex([source, target]);

    const out = index.outgoing.get("src") ?? [];
    expect(out.length).toBe(1);
    expect(out[0]?.resolvedIds).toEqual(["dst"]);

    const back = index.backlinks.get("dst") ?? [];
    expect(back.length).toBe(1);
    expect(back[0]?.sourceId).toBe("src");
    expect(back[0]?.snippet).toContain("[[نقشه راه]]");
  });

  it("resolves links by first heading and by first line too", () => {
    const headingTarget = docTextBox(
      "h1",
      docWithHeading(2, "معماری سامانه"),
    );
    const lineTarget = textBox("l1", "برنامهٔ هفته");
    const source = textBox(
      "src",
      "هم [[معماری سامانه]] و هم [[برنامهٔ هفته]]",
    );
    const index = buildKnowledgeIndex([source, headingTarget, lineTarget]);
    const out = index.outgoing.get("src") ?? [];
    expect(out.length).toBe(2);
    expect(out.every((link) => link.resolvedIds.length === 1)).toBe(true);
    expect(index.backlinks.get("h1")?.length).toBe(1);
    expect(index.backlinks.get("l1")?.length).toBe(1);
  });

  it("records unresolved titles as broken (red links)", () => {
    const source = textBox("src", "[[چیزی که وجود ندارد]]");
    const index = buildKnowledgeIndex([source]);
    const out = index.outgoing.get("src") ?? [];
    expect(out[0]?.resolvedIds).toEqual([]);
    const broken = index.brokenTitles.get(out[0]?.key ?? "") ?? [];
    expect(broken.length).toBe(1);
    expect(broken[0]?.sourceId).toBe("src");
  });

  it("folds Persian/Arabic drift when resolving", () => {
    const target = textBox("dst", "", "كده نهایی"); // Arabic kaf in the NAME
    const source = textBox("src", "به [[کده نهایی]] نگاه کن"); // Persian kaf
    const index = buildKnowledgeIndex([target, source]);
    const out = index.outgoing.get("src") ?? [];
    expect(out[0]?.resolvedIds).toEqual(["dst"]);
  });

  it("resolves ambiguous titles to EVERY owner (and backlinks on each)", () => {
    const first = textBox("a", "", "هم‌نام");
    const second = textBox("b", "", "هم‌نام");
    const source = textBox("src", "برو به [[هم‌نام]]");
    const index = buildKnowledgeIndex([first, second, source]);
    const out = index.outgoing.get("src") ?? [];
    expect([...(out[0]?.resolvedIds ?? [])].sort()).toEqual(["a", "b"]);
    expect(index.backlinks.get("a")?.length).toBe(1);
    expect(index.backlinks.get("b")?.length).toBe(1);
  });

  it("allows self-links (an object linking to its own title)", () => {
    const object = textBox("a", "خودارجاع به [[عنوان من]]", "عنوان من");
    const index = buildKnowledgeIndex([object]);
    const out = index.outgoing.get("a") ?? [];
    expect(out[0]?.resolvedIds).toEqual(["a"]);
    expect(index.backlinks.get("a")?.length).toBe(1);
  });

  it("indexes tags per object and globally", () => {
    const a = textBox("a", "یادداشت #فکر و #ایده");
    const b = textBox("b", "بعدی #ایده دیگری");
    const index = buildKnowledgeIndex([a, b]);
    expect(index.objectTags.get("a")).toEqual(["فکر", "ایده"]);
    expect(index.objectTags.get("b")).toEqual(["ایده"]);
    expect([...(index.tags.get("ایده")?.objectIds ?? [])].sort()).toEqual(["a", "b"]);
    expect(index.tags.get("فکر")?.objectIds).toEqual(["a"]);
  });

  it("ignores links/tags of NON-text objects entirely", () => {
    const shape = namedShape("f", "قاب نامدار");
    const index = buildKnowledgeIndex([shape]);
    expect(index.titles.get("قاب نامدار")?.objectIds).toEqual(["f"]);
    expect(index.outgoing.size).toBe(0);
    expect(index.tags.size).toBe(0);
  });

  it("stays immutable across rebuilds (fresh snapshots)", () => {
    const first = buildKnowledgeIndex([textBox("a", "متن")]);
    const second = buildKnowledgeIndex([textBox("a", "متن"), textBox("b", "[[متن]]")]);
    expect(first.backlinks.size).toBe(0);
    expect(second.backlinks.size).toBe(1);
    expect(first.backlinks.size).toBe(0);
  });
});
