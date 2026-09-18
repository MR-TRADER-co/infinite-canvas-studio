/**
 * Unit tests for the فاز-۳۶ «جدول به ورد» Word exporter: the pure ZIP
 * writer (CRC-32 + STORE central directory), the WordprocessingML body
 * serializer (headings/marks/lists/links/escaping/RTL) — with the TABLE
 * pipeline (grid planning, gridSpan/vMerge merges, bidiVisual, header
 * rows, colwidth travel, shading) as the phase's core ask — and the
 * object aggregator + full .docx assembly.
 */
import { describe, expect, it } from "vitest";
import {
  buildWordDocxBytes,
  crc32,
  escapeXml,
  isRtlText,
  wordBodyOfDocument,
  wordBodyOfObjects,
  WORD_EXPORT_FILENAME,
  zipStoreFiles,
} from "@/persistence/exporters/WordExporter";
import type { RichTextDocument } from "@/text/editor/richtext";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Builds a doc from raw content (cast once, tests stay terse). */
function doc(content: unknown[]): RichTextDocument {
  return { type: "doc", content } as RichTextDocument;
}

/** A text node shorthand. */
function text(value: string, marks?: unknown[]): unknown {
  return { type: "text", text: value, ...(marks ? { marks } : {}) };
}

/** A table cell shorthand. */
function cell(value: string, attrs?: Record<string, unknown>): unknown {
  return {
    type: "tableCell",
    ...(attrs ? { attrs } : {}),
    content: [{ type: "paragraph", content: [text(value)] }],
  };
}

/** A header cell shorthand. */
function header(value: string): unknown {
  return {
    type: "tableHeader",
    content: [{ type: "paragraph", content: [text(value)] }],
  };
}

/** A row shorthand. */
function row(...cells: unknown[]): unknown {
  return { type: "tableRow", content: cells };
}

/** A text box object carrying a rich doc. */
function richBox(document: RichTextDocument): SceneObjectData {
  return {
    id: "box-1",
    kind: "textBox",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    locked: false,
    name: null,
    doc: document,
    text: "",
  } as unknown as SceneObjectData;
}

/** A plain text box object (no doc). */
function plainBox(value: string): SceneObjectData {
  return {
    id: "box-2",
    kind: "textBox",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    locked: false,
    name: null,
    doc: null,
    text: value,
  } as unknown as SceneObjectData;
}

describe("crc32 / zipStoreFiles (فاز ۳۶)", () => {
  it("computes the canonical CRC-32 vectors", () => {
    const encoder = new TextEncoder();
    expect(crc32(encoder.encode(""))).toBe(0x00000000);
    expect(crc32(encoder.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(encoder.encode("The quick brown fox jumps over the lazy dog"))).toBe(
      0x414fa339,
    );
  });

  it("packs entries into a structurally valid STORE archive", () => {
    const encoder = new TextEncoder();
    const archive = zipStoreFiles([
      { name: "[Content_Types].xml", data: encoder.encode("<types/>") },
      { name: "word/document.xml", data: encoder.encode("<w:document/>") },
    ]);
    // Local header magic + version + STORE + UTF-8 flag.
    expect(archive[0]).toBe(0x50);
    expect(archive[1]).toBe(0x4b);
    expect(archive[2]).toBe(0x03);
    expect(archive[3]).toBe(0x04);
    const view = new DataView(archive.buffer, archive.byteOffset);
    expect(view.getUint16(4, true)).toBe(20);
    expect(view.getUint16(8, true)).toBe(0); // method STORE
    expect(view.getUint16(6, true)).toBe(0x0800); // UTF-8 names
    // Both entry names appear in the archive (local + central directory).
    const raw = new TextDecoder().decode(archive);
    expect(raw.includes("[Content_Types].xml")).toBe(true);
    expect(raw.includes("word/document.xml")).toBe(true);
    // End-of-central-directory magic at the very end.
    const tail = archive.length - 22;
    expect(view.getUint32(tail, true)).toBe(0x06054b50);
    expect(view.getUint16(tail + 8, true)).toBe(2); // entries on disk
    expect(view.getUint16(tail + 10, true)).toBe(2); // total entries
  });

  it("is deterministic (same input → same bytes)", () => {
    const encoder = new TextEncoder();
    const entries = [
      { name: "a.xml", data: encoder.encode("hello") },
      { name: "b/c.xml", data: encoder.encode("سلام") },
    ];
    expect(zipStoreFiles(entries)).toEqual(zipStoreFiles(entries));
  });
});

describe("escapeXml / isRtlText", () => {
  it("escapes the five XML entities", () => {
    expect(escapeXml(`a & <b> "c" 'd'`)).toBe(
      "a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;",
    );
  });

  it("detects Persian/Arabic as RTL and Latin as LTR", () => {
    expect(isRtlText("سلام دنیا")).toBe(true);
    expect(isRtlText("hello world")).toBe(false);
    expect(isRtlText("")).toBe(false);
  });
});

describe("wordBodyOfDocument — blocks (فاز ۳۶)", () => {
  it("renders paragraphs with bidi for Persian, LTR for English", () => {
    const body = wordBodyOfDocument(
      doc([
        { type: "paragraph", content: [text("سلام")] },
        { type: "paragraph", content: [text("hello")] },
        { type: "paragraph", attrs: { dir: "rtl" }, content: [text("mixed")] },
      ]),
    );
    expect(body).toContain("<w:bidi/>");
    expect(body).toContain("<w:t xml:space=\"preserve\">سلام</w:t>");
    expect(body).toContain("<w:t xml:space=\"preserve\">hello</w:t>");
    // The explicit dir=rtl paragraph is bidi even with Latin text.
    expect(body.match(/<w:bidi\/>/g)?.length).toBe(2);
  });

  it("maps headings to Word heading styles with clamped levels", () => {
    const body = wordBodyOfDocument(
      doc([
        { type: "heading", attrs: { level: 1 }, content: [text("H1")] },
        { type: "heading", attrs: { level: 9 }, content: [text("H9")] },
      ]),
    );
    expect(body).toContain('<w:pStyle w:val="Heading1"/>');
    expect(body).toContain('<w:pStyle w:val="Heading6"/>');
  });

  it("maps the mark stack onto run properties", () => {
    const body = wordBodyOfDocument(
      doc([
        {
          type: "paragraph",
          content: [
            text("bold", [{ type: "bold" }]),
            text("italic", [{ type: "italic" }]),
            text("under", [{ type: "underline" }]),
            text("struck", [{ type: "strike" }]),
            text("sub", [{ type: "subscript" }]),
            text("sup", [{ type: "superscript" }]),
            text("code", [{ type: "code" }]),
          ],
        },
      ]),
    );
    expect(body).toContain("<w:b/><w:bCs/>");
    expect(body).toContain("<w:i/><w:iCs/>");
    expect(body).toContain('<w:u w:val="single"/>');
    expect(body).toContain("<w:strike/>");
    expect(body).toContain('<w:vertAlign w:val="subscript"/>');
    expect(body).toContain('<w:vertAlign w:val="superscript"/>');
    expect(body).toContain('w:ascii="Consolas"');
  });

  it("collects safe hyperlinks as relationships and degrades unsafe ones", () => {
    const body = wordBodyOfDocument(
      doc([
        {
          type: "paragraph",
          content: [
            text("سایت", [
              { type: "link", attrs: { href: "https://example.com" } },
            ]),
            text(" ", [
              { type: "link", attrs: { href: "javascript:alert(1)" } },
            ]),
            text(" بد", [
              { type: "link", attrs: { href: "mailto:a@b.c" } },
            ]),
          ],
        },
      ]),
    );
    expect(body).toContain('<w:hyperlink r:id="rId1000">');
    expect(body).toContain('w:val="0563C1"');
    // The unsafe scheme degraded to a plain run (no second hyperlink).
    expect(body.match(/<w:hyperlink/g)?.length).toBe(2);
    // Escaping survives inside runs.
    expect(body).toContain("xml:space=\"preserve\"");
  });

  it("renders lists with the bullet/decimal numbering ids", () => {
    const body = wordBodyOfDocument(
      doc([
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [text("یک")] }] },
          ],
        },
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [text("دو")] }] },
          ],
        },
      ]),
    );
    expect(body).toContain('<w:numId w:val="1"/>');
    expect(body).toContain('<w:numId w:val="2"/>');
    expect(body).toContain('<w:ilvl w:val="0"/>');
  });

  it("renders blockquote, codeBlock and horizontalRule approximations", () => {
    const body = wordBodyOfDocument(
      doc([
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [text("نقل")] }],
        },
        { type: "codeBlock", content: [text("let x = 1;")] },
        { type: "horizontalRule" },
      ]),
    );
    expect(body).toContain("w:left=\"720\"");
    expect(body).toContain("<w:pBdr>");
    expect(body).toContain("let x = 1;");
  });

  it("escapes text nodes (canvas text can never inject OOXML)", () => {
    const body = wordBodyOfDocument(
      doc([{ type: "paragraph", content: [text(`<w:t> & "x"`) ] }]),
    );
    expect(body).toContain("&lt;w:t&gt; &amp; &quot;x&quot;");
  });
});

describe("wordBodyOfDocument — TABLES (the phase's core ask)", () => {
  it("renders a real Word table: tbl/tblGrid/borders/bidiVisual/tblHeader", () => {
    const body = wordBodyOfDocument(
      doc([
        {
          type: "table",
          attrs: { dir: "rtl", preset: "classic" },
          content: [
            row(header("نام"), header("مقدار")),
            row(cell("الف"), cell("۱")),
          ],
        },
      ]),
    );
    expect(body).toContain("<w:tbl>");
    expect(body).toContain("<w:tblGrid>");
    expect(body).toContain("<w:gridCol");
    expect(body).toContain("<w:tblBorders>");
    expect(body).toContain("<w:bidiVisual/>"); // RTL column order
    expect(body).toContain("<w:tblHeader/>"); // header repeats on page 2
    expect(body).toContain("<w:shd"); // header fill
    expect(body).toContain("<w:b/><w:bCs/>"); // header runs bold
    // Every table is followed by a paragraph (Word's shape rule).
    expect(body.endsWith("</w:tbl><w:p/>")).toBe(true);
  });

  it("emits LTR tables without bidiVisual", () => {
    const body = wordBodyOfDocument(
      doc([
        {
          type: "table",
          attrs: { dir: "ltr" },
          content: [row(cell("a"), cell("b"))],
        },
      ]),
    );
    expect(body).not.toContain("<w:bidiVisual/>");
  });

  it("spans columns with gridSpan", () => {
    const body = wordBodyOfDocument(
      doc([
        {
          type: "table",
          content: [
            row(header("عنوان")),
            row(cell("a"), cell("b")),
            row(cell("پهن", { colspan: 2 })),
          ],
        },
      ]),
    );
    expect(body).toContain('<w:gridSpan w:val="2"/>');
  });

  it("materialises rowspan continuations with vMerge restart/continue", () => {
    const body = wordBodyOfDocument(
      doc([
        {
          type: "table",
          content: [
            row(header("a"), header("b")),
            row(cell("بلند", { rowspan: 2 }), cell("۱")),
            row(cell("۲")),
          ],
        },
      ]),
    );
    expect(body).toContain('<w:vMerge w:val="restart"/>');
    expect(body).toContain("<w:vMerge/>");
    // 3 rows total: header + 2 body rows.
    expect(body.match(/<w:tr>/g)?.length).toBe(3);
  });

  it("carries per-cell background colour and vertical alignment", () => {
    const body = wordBodyOfDocument(
      doc([
        {
          type: "table",
          content: [
            row(
              cell("x", { backgroundColor: "#ffcc00", valign: "middle" }),
            ),
          ],
        },
      ]),
    );
    expect(body).toContain('w:fill="FFCC00"');
    expect(body).toContain('<w:vAlign w:val="center"/>');
  });

  it("travels drag-resized colwidth into gridCol widths", () => {
    const body = wordBodyOfDocument(
      doc([
        {
          type: "table",
          content: [
            row(
              cell("a", { colspan: 2, colwidth: [120, 60] }),
              cell("b", { colwidth: [240] }),
            ),
          ],
        },
      ]),
    );
    // 120px→1800tw, 60px→900tw, 240px→3600tw.
    expect(body).toContain('<w:gridCol w:w="1800"/>');
    expect(body).toContain('<w:gridCol w:w="900"/>');
    expect(body).toContain('<w:gridCol w:w="3600"/>');
    expect(body).toContain('<w:tcW w:w="2700" w:type="dxa"/>'); // spanned
  });

  it("applies the minimal preset's lighter border colour", () => {
    const body = wordBodyOfDocument(
      doc([
        {
          type: "table",
          attrs: { preset: "minimal" },
          content: [row(cell("x"))],
        },
      ]),
    );
    expect(body).toContain('w:color="BFBFBF"');
  });
});

describe("wordBodyOfObjects (the فاز ۳۵ aggregation parity)", () => {
  it("serialises rich docs, plain boxes and sticky notes; skips the rest", () => {
    const sticky = {
      id: "s1",
      kind: "stickyNote",
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      text: "یادداشت",
    } as unknown as SceneObjectData;
    const image = {
      id: "i1",
      kind: "image",
      src: "data:",
    } as unknown as SceneObjectData;
    const parsed = wordBodyOfObjects([richBox(doc([
      { type: "paragraph", content: [text("غنی")] },
    ])), plainBox("خط یک\nخط دو"), sticky, image]);
    expect(parsed).not.toBeNull();
    expect(parsed?.body).toContain("غنی");
    expect(parsed?.body).toContain("خط یک");
    expect(parsed?.body).toContain("یادداشت");
    // Joined with spacer paragraphs; image contributed nothing.
    expect(parsed?.body).toContain("<w:p/>");
  });

  it("returns null for text-free selections", () => {
    const image = {
      id: "i1",
      kind: "image",
      src: "data:",
    } as unknown as SceneObjectData;
    expect(wordBodyOfObjects([image])).toBeNull();
    expect(wordBodyOfObjects([])).toBeNull();
    expect(wordBodyOfObjects([plainBox("   ")])).toBeNull();
  });
});

describe("buildWordDocxBytes (the full package)", () => {
  it("assembles a valid .docx archive with every part", () => {
    const bytes = buildWordDocxBytes([
      richBox(
        doc([
          { type: "heading", attrs: { level: 1 }, content: [text("گزارش")] },
          {
            type: "table",
            attrs: { dir: "rtl" },
            content: [
              row(header("ستون"), header("مقدار")),
              row(cell("الف"), cell("۱")),
            ],
          },
        ]),
      ),
    ]);
    expect(bytes).not.toBeNull();
    expect(bytes!.length).toBeGreaterThan(2000);
    const raw = new TextDecoder().decode(bytes!);
    // Every OOXML part is packed.
    expect(raw.includes("[Content_Types].xml")).toBe(true);
    expect(raw.includes("_rels/.rels")).toBe(true);
    expect(raw.includes("word/document.xml")).toBe(true);
    expect(raw.includes("word/styles.xml")).toBe(true);
    expect(raw.includes("word/numbering.xml")).toBe(true);
    expect(raw.includes("word/_rels/document.xml.rels")).toBe(true);
    // The document part carries the real content.
    expect(raw.includes("گزارش")).toBe(true);
    expect(raw.includes("w:styleId=\"Heading1\"")).toBe(true);
    expect(raw.includes("<w:bidi/>")).toBe(true); // RTL section + paragraphs
  });

  it("returns null when nothing is exportable", () => {
    expect(buildWordDocxBytes([])).toBeNull();
  });

  it("exposes the download filename as a .docx", () => {
    expect(WORD_EXPORT_FILENAME.endsWith(".docx")).toBe(true);
  });
});
