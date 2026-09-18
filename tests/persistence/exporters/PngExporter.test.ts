/**
 * Unit tests for the PNG exporter's PURE planning surfaces (R4.8): the
 * export bounds computation (scene / selection / bbox, rotation-aware,
 * visibility-filtered) and the text-layer HTML builder (positions,
 * rotations, rich content, sticky cards). The rasterizer itself needs a
 * real browser; its pure helpers (base64) are covered too.
 */
import { describe, expect, it } from "vitest";
import {
  buildTextLayerHtml,
  computeExportBounds,
  exportProseCss,
  exportToPng,
  PngExportError,
} from "@/persistence/exporters/PngExporter";
import {
  canRasterize,
  collectEmbeddedFontFaces,
  testing,
} from "@/persistence/exporters/DomRasterizer";
import { Scene } from "@/core/model/Scene";
import { Camera } from "@/core/camera/Camera";
import { vec2 } from "@/core/geometry/Vec2";
import { bbox } from "@/core/geometry/BBox";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import type { StickyNoteObjectData } from "@/core/model/StickyNoteObject";
import { DARK_PALETTE } from "@/rendering/Canvas2DRenderer";

/** A shape fixture at a world rect. */
function shapeAt(
  id: string,
  x: number,
  y: number,
  w = 100,
  h = 80,
): ShapeObjectData {
  return {
    id,
    kind: "shape",
    position: vec2(x, y),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    shapeKind: "rectangle",
    width: w,
    height: h,
    fill: "#fff",
    stroke: "#000",
    strokeWidth: 1,
  };
}

/** A text box fixture. */
function textBoxAt(
  id: string,
  x: number,
  y: number,
  rotation = 0,
): TextBoxObjectData {
  return {
    id,
    kind: "textBox",
    position: vec2(x, y),
    rotation,
    zIndex: 1,
    visible: true,
    locked: false,
    width: 200,
    height: 60,
    text: "سلام",
    doc: { type: "doc", content: [{ type: "paragraph" }] },
    sizeMode: "fixed",
    fontSize: 20,
    color: "token://text",
  };
}

/** The renderer options the HTML builder needs. */
const htmlOptions = {
  themeInk: "#ff0000",
  themeBorder: "#00ff00",
  themeMuted: "#0000ff",
  renderRichHtml: (doc: unknown) =>
    `<p>rendered:${JSON.stringify(doc).length}</p>`,
};

describe("computeExportBounds (R4.8 — the frame planner)", () => {
  it("frames the whole scene (rotation-aware union)", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("a", 0, 0, 100, 80));
    scene.add(shapeAt("b", 200, 200, 50, 50));
    const bounds = computeExportBounds(scene, { mode: "scene" });
    // Shapes pad their bounds by strokeWidth/2 (0.5 here).
    expect(bounds).toEqual(bbox(-0.5, -0.5, 250.5, 250.5));
  });

  it("covers ROTATED objects with their rotated footprint", () => {
    const scene = new Scene(new Camera());
    const rotated: ShapeObjectData = {
      ...shapeAt("r", 0, 0, 100, 100),
      rotation: Math.PI / 4,
    };
    scene.add(rotated);
    const bounds = computeExportBounds(scene, { mode: "scene" });
    // A 45° square of 100×100 covers ~141.4 around its centre (50, 50).
    const size = (bounds?.maxX ?? 0) - (bounds?.minX ?? 0);
    expect(size).toBeGreaterThan(140);
    expect(size).toBeLessThan(143);
  });

  it("skips invisible objects", () => {
    const scene = new Scene(new Camera());
    scene.add({ ...shapeAt("hidden", 500, 500), visible: false });
    scene.add(shapeAt("visible", 0, 0, 10, 10));
    const bounds = computeExportBounds(scene, { mode: "scene" });
    expect(bounds).toEqual(bbox(-0.5, -0.5, 10.5, 10.5));
  });

  it("frames the selection by ids", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("a", 0, 0, 10, 10));
    scene.add(shapeAt("b", 100, 100, 10, 10));
    const bounds = computeExportBounds(scene, {
      mode: "selection",
      ids: ["b"],
    });
    expect(bounds).toEqual(bbox(99.5, 99.5, 110.5, 110.5));
  });

  it("returns the explicit bbox verbatim", () => {
    const scene = new Scene(new Camera());
    const box = bbox(-5, -5, 55, 55);
    expect(computeExportBounds(scene, { mode: "bbox", box })).toBe(box);
  });

  it("returns null for an empty scene / empty selection", () => {
    const scene = new Scene(new Camera());
    expect(computeExportBounds(scene, { mode: "scene" })).toBeNull();
    scene.add(shapeAt("a", 0, 0));
    expect(
      computeExportBounds(scene, { mode: "selection", ids: [] }),
    ).toBeNull();
  });
});

describe("buildTextLayerHtml (the DOM compositing plan)", () => {
  it("positions one text box at its world offset scaled", () => {
    const objects = [textBoxAt("t1", 100, 50)];
    const html = buildTextLayerHtml(
      objects,
      bbox(0, 0, 400, 300),
      2,
      htmlOptions,
    );
    expect(html).toContain("translate(200px, 100px)");
    expect(html).toContain("width:200px");
    expect(html).toContain("font-size:20px");
    // فاز ۲۸: the transform is per-axis (`scale(sx, sy)`) so pinned
    // overrides can size the axes independently; a uniform export scale
    // still renders `scale(s, s)`.
    expect(html).toContain("scale(2, 2)");
    expect(html).toContain("color:#ff0000");
  });

  it("applies the object rotation around the centre (AC4.7, فاز ۳۰)", () => {
    const objects = [textBoxAt("t1", 0, 0, 1.5)];
    const html = buildTextLayerHtml(
      objects,
      bbox(0, 0, 300, 300),
      1,
      htmlOptions,
    );
    expect(html).toContain("transform-origin:0 0");
    // The centre-pivot triplet: translate(centre) rotate(θ)
    // translate(−centre) — with origin 0 0 the rotation pivots around
    // the element's centre (the canvas drawers' convention), not its
    // top-left. textBoxAt's fixture is 200×60 → centre (100, 30).
    expect(html).toContain("translate(100px, 30px) rotate(1.5rad)");
    expect(html).toContain("translate(-100px, -30px)");
  });

  it("keeps the minimal transform for unrotated objects", () => {
    const objects = [textBoxAt("t1", 0, 0)];
    const html = buildTextLayerHtml(
      objects,
      bbox(0, 0, 300, 300),
      1,
      htmlOptions,
    );
    expect(html).toContain("transform:translate(0px, 0px) scale(1, 1);");
    expect(html).not.toContain("rotate(");
  });

  it("renders the rich document through the injected renderer (R4.1)", () => {
    const objects = [textBoxAt("t1", 0, 0)];
    const html = buildTextLayerHtml(
      objects,
      bbox(0, 0, 300, 300),
      1,
      htmlOptions,
    );
    expect(html).toContain("rendered:");
  });

  it("renders sticky notes with their card colour + plain text", () => {
    const note: StickyNoteObjectData = {
      id: "s1",
      kind: "stickyNote",
      position: vec2(10, 10),
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      width: 220,
      height: 220,
      text: "یادداشت مهم",
      fontSize: 18,
      noteColor: "#f59e0b",
      color: "oklch(0.30 0.03 55)",
    };
    const html = buildTextLayerHtml(
      [note],
      bbox(0, 0, 400, 400),
      1,
      htmlOptions,
    );
    expect(html).toContain("background-color:#f59e0b");
    expect(html).toContain("یادداشت مهم");
    expect(html).toContain("sticky-note-view");
  });

  it("skips invisible text objects", () => {
    const objects = [{ ...textBoxAt("t1", 0, 0), visible: false }];
    expect(
      buildTextLayerHtml(objects, bbox(0, 0, 300, 300), 1, htmlOptions),
    ).toBe("");
  });

  it("escapes plain legacy text (no injection)", () => {
    const legacy: TextBoxObjectData = {
      ...textBoxAt("t2", 0, 0),
      doc: null,
      text: '<script>alert("x")</script>',
    };
    const html = buildTextLayerHtml(
      [legacy],
      bbox(0, 0, 300, 300),
      1,
      htmlOptions,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("exportProseCss", () => {
  it("embeds the theme colours as literals (no CSS variables)", () => {
    const css = exportProseCss({
      themeInk: "#111111",
      themeBorder: "#222222",
      themeMuted: "#333333",
    });
    expect(css).toContain("#111111");
    expect(css).toContain("#222222");
    expect(css).toContain("#333333");
    expect(css).not.toContain("var(--");
    // The typographic rules for headings/lists/tables are present.
    expect(css).toContain(".text-object-view h1");
    expect(css).toContain(".text-object-view table");
    expect(css).toContain('ul[data-type="taskList"]');
  });
});

describe("exportToPng — early error paths (node-reachable)", () => {
  const options = {
    region: { mode: "scene" as const },
    scale: 1,
    transparent: false,
    palette: DARK_PALETTE,
    themeInk: "#111",
    themeBorder: "#222",
    themeMuted: "#333",
    renderRichHtml: () => "",
  };

  it("throws no-content for an empty scene before touching the DOM", async () => {
    const scene = new Scene(new Camera());
    await expect(exportToPng(scene, options)).rejects.toMatchObject({
      kind: "no-content",
    });
  });

  it("throws rasterization when the DOM is unavailable", async () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("a", 0, 0, 10, 10));
    await expect(exportToPng(scene, options)).rejects.toMatchObject({
      kind: "rasterization",
      message: "no DOM available",
    });
  });
});

describe("PngExportError", () => {
  it("carries a machine-readable kind", () => {
    const error = new PngExportError("no-content", "empty");
    expect(error.kind).toBe("no-content");
    expect(error.message).toBe("empty");
    expect(error.name).toBe("PngExportError");
  });
});

describe("DomRasterizer pure helpers", () => {
  it("base64-encodes byte buffers", () => {
    const encoded = testing.arrayBufferToBase64(
      new Uint8Array([72, 105]).buffer,
    );
    expect(encoded).toBe("SGk=");
  });

  it("finds no font faces when no stylesheets exist (node)", async () => {
    expect(testing.collectVazirmatnFaceRules()).toEqual([]);
    // The memoised collection returns an empty block (system-font
    // fallback quality) rather than throwing.
    await expect(collectEmbeddedFontFaces()).resolves.toBe("");
  });

  it("reports rasterization availability per environment", () => {
    expect(canRasterize()).toBe(false);
  });
});

describe("palette passthrough", () => {
  it("the theme palettes remain exportable constants", () => {
    expect(DARK_PALETTE.background).toBeTruthy();
    expect(DARK_PALETTE.opaqueLabel).toBe("شیء ناشناخته");
  });
});
