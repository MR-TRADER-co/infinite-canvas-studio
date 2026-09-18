/**
 * Unit tests for the name-badge policy (which objects show their user
 * name as a floating chip outside their frame): sticky notes, images and
 * table-bearing text boxes qualify; plain text boxes, shapes and other
 * kinds do not; `hasNameBadge` additionally requires a non-empty name.
 */
import { describe, expect, it } from "vitest";
import { hasNameBadge, showsNameBadge } from "@/core/model/NameBadge";
import { createImageObject, isImageObject } from "@/core/model/ImageObject";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import type { StickyNoteObjectData } from "@/core/model/StickyNoteObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import type { RichTextDocument } from "@/text/editor/richtext";
import { vec2 } from "@/core/geometry/Vec2";

/** A rich document whose body holds one table node. */
const TABLE_DOC: RichTextDocument = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableCell", content: [] }] },
      ],
    },
  ],
};

/** A plain rich document (paragraph only). */
const PLAIN_DOC: RichTextDocument = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/** Base fields shared by every fixture below. */
const base = {
  rotation: 0,
  zIndex: 1,
  visible: true,
  locked: false,
} as const;

/** Builds a sticky note fixture. */
function sticky(name?: string): StickyNoteObjectData {
  return {
    ...base,
    id: "sticky-1",
    kind: "stickyNote",
    name,
    position: vec2(0, 0),
    width: 200,
    height: 200,
    text: "یادداشت",
    noteColor: "#fef08a",
    color: "#0a0a0a",
    fontSize: 16,
  };
}

/** Builds a text box fixture with the given document. */
function textBox(
  doc: RichTextDocument | null,
  name?: string,
): TextBoxObjectData {
  return {
    ...base,
    id: "text-1",
    kind: "textBox",
    name,
    position: vec2(0, 0),
    width: 200,
    height: 100,
    text: "",
    doc,
    sizeMode: "auto",
    fontSize: 16,
    color: "#0a0a0a",
  };
}

/** Builds a minimal non-qualified kind fixture. */
function shape(name?: string): ShapeObjectData {
  return {
    ...base,
    id: "shape-1",
    kind: "shape",
    name,
    position: vec2(0, 0),
    shapeKind: "rectangle",
    width: 100,
    height: 100,
    fill: "#ffffff",
    stroke: "#000000",
    strokeWidth: 2,
  };
}

/** Builds an image fixture through the real factory. */
function image(name?: string): SceneObjectData {
  return {
    ...createImageObject(
      "img-1",
      "data:image/png;base64,x",
      { width: 64, height: 48 },
      vec2(0, 0),
    ),
    name,
  };
}

describe("showsNameBadge (kind qualification)", () => {
  it("sticky notes qualify", () => {
    expect(showsNameBadge(sticky())).toBe(true);
  });

  it("images qualify (and the guard narrows the kind)", () => {
    const object = image();
    expect(showsNameBadge(object)).toBe(true);
    expect(isImageObject(object)).toBe(true);
  });

  it("text boxes qualify ONLY when their document contains a table", () => {
    expect(showsNameBadge(textBox(TABLE_DOC))).toBe(true);
    expect(showsNameBadge(textBox(PLAIN_DOC))).toBe(false);
    expect(showsNameBadge(textBox(null))).toBe(false);
  });

  it("shapes and other kinds never qualify", () => {
    expect(showsNameBadge(shape())).toBe(false);
  });
});

describe("hasNameBadge (name + qualification)", () => {
  it("requires a non-empty name on qualified kinds", () => {
    expect(hasNameBadge(sticky())).toBe(false);
    expect(hasNameBadge(sticky(""))).toBe(false);
    expect(hasNameBadge(sticky("برچسب من"))).toBe(true);
    expect(hasNameBadge(image("عکس تختگاه"))).toBe(true);
    expect(hasNameBadge(textBox(TABLE_DOC, "جدول فروش"))).toBe(true);
  });

  it("ignores names on non-qualified kinds", () => {
    expect(hasNameBadge(shape("مستطیل"))).toBe(false);
    expect(hasNameBadge(textBox(PLAIN_DOC, "متن ساده"))).toBe(false);
  });
});
