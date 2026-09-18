/**
 * Scene search + outline tests (R7.6/R7.7/AC7.6/AC7.7): text extraction
 * from rich-text docs (table cells included), scope filters, grouping,
 * snippets, and the H1/H2/H3 outline in z-order.
 */
import { describe, expect, it } from "vitest";
import {
  buildOutline,
  searchableTextOf,
  searchScene,
} from "@/core/search/SceneSearch";
import { vec2 } from "@/core/geometry/Vec2";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import type { RichTextDocument } from "@/text/editor/richtext";

/** Builds a text box fixture carrying a rich-text doc. */
function makeTextBox(
  id: string,
  doc: RichTextDocument | null,
  text = "",
): TextBoxObjectData {
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
    doc,
    sizeMode: "fixed",
    fontSize: 20,
    color: "token://text",
  };
}

/** A doc with two headings + a paragraph. */
const DOC: RichTextDocument = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "طرح کلی محصول" }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "بخش بازار" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "رشد ۲۰ درصدی فروش" }],
    },
  ],
} as unknown as RichTextDocument;

/** A doc whose table cells carry searchable Persian text. */
const TABLE_DOC: RichTextDocument = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "گزارش" }],
                },
              ],
            },
            {
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "فروش" }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
} as unknown as RichTextDocument;

describe("searchableTextOf (R7.6)", () => {
  it("flattens rich-text docs (table cells included)", () => {
    const box = makeTextBox("t1", TABLE_DOC);
    const text = searchableTextOf(box);
    expect(text).toContain("گزارش");
    expect(text).toContain("فروش");
  });

  it("falls back to the plain text projection for legacy boxes", () => {
    const box = makeTextBox("t2", null, "متن ساده قدیمی");
    expect(searchableTextOf(box)).toBe("متن ساده قدیمی");
  });

  it("ignores non-text kinds", () => {
    const shape = {
      id: "s",
      kind: "shape",
      position: vec2(0, 0),
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
    } as unknown as SceneObjectData;
    expect(searchableTextOf(shape)).toBe("");
  });
});

describe("searchScene (R7.6/AC7.6)", () => {
  const objects: SceneObjectData[] = [
    makeTextBox("a", DOC),
    { ...makeTextBox("b", null, "فروش سال گذشته"), name: "گزارش فروش" },
    makeTextBox("hidden", null, "فروش پنهان"),
  ];
  const visible = objects.map((object, index) =>
    index === 2 ? { ...object, visible: false } : object,
  );

  it("finds Persian matches across 10+ objects grouped per object", () => {
    const many: SceneObjectData[] = [];
    for (let i = 0; i < 12; i += 1) {
      many.push(makeTextBox(`t${i}`, null, `یادداشت شمارهٔ ${i} دربارهٔ فروش`));
    }
    const groups = searchScene(many, { query: "فروش", scope: "text" });
    expect(groups).toHaveLength(12);
    for (const group of groups) {
      expect(group.matches.length).toBe(1);
      expect(group.matches[0]?.snippet).toContain("فروش");
    }
  });

  it("groups multiple matches per object in document order", () => {
    const groups = searchScene([makeTextBox("m", null, "فروش و فروش دوباره")], {
      query: "فروش",
      scope: "text",
    });
    expect(groups[0]?.matches).toHaveLength(2);
    expect(groups[0]?.matches[0]?.index).toBe(0);
  });

  it("the names scope matches object names only", () => {
    const groups = searchScene(visible, { query: "گزارش", scope: "names" });
    expect(groups.map((group) => group.object.id)).toEqual(["b"]);
  });

  it("the text scope skips object names", () => {
    const groups = searchScene(visible, { query: "گزارش فروش", scope: "text" });
    // "گزارش فروش" as a phrase exists in neither text body.
    expect(groups).toHaveLength(0);
  });

  it("the all scope searches both", () => {
    const groups = searchScene(visible, { query: "گزارش", scope: "all" });
    expect(groups.map((group) => group.object.id)).toEqual(["b"]);
  });

  it("skips invisible objects", () => {
    const groups = searchScene(visible, { query: "پنهان", scope: "text" });
    expect(groups).toHaveLength(0);
  });

  it("an empty query returns nothing", () => {
    expect(searchScene(visible, { query: "  ", scope: "all" })).toHaveLength(0);
  });
});

describe("buildOutline (R7.7/AC7.7)", () => {
  it("collects H1/H2/H3 in z-order (document order)", () => {
    const second = makeTextBox("b", {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "جمع‌بندی" }],
        },
      ],
    } as unknown as RichTextDocument);
    const outline = buildOutline([makeTextBox("a", DOC), second]);
    expect(outline.map((entry) => entry.text)).toEqual([
      "طرح کلی محصول",
      "بخش بازار",
      "جمع‌بندی",
    ]);
    expect(outline[0]?.level).toBe(1);
    expect(outline[1]?.level).toBe(2);
    expect(outline[2]?.level).toBe(3);
    expect(outline[0]?.objectId).toBe("a");
    expect(outline[2]?.objectId).toBe("b");
  });

  it("skips empty headings and ignores H4+ none (schema only has 1–3)", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [] },
        { type: "paragraph", content: [{ type: "text", text: "بی‌سرصفحه" }] },
      ],
    } as unknown as RichTextDocument;
    expect(buildOutline([makeTextBox("x", doc)])).toHaveLength(0);
  });

  it("legacy plain boxes contribute nothing", () => {
    expect(buildOutline([makeTextBox("legacy", null, "متن")])).toHaveLength(0);
  });
});
