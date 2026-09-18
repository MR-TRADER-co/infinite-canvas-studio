/**
 * Unit tests for the فاز ۲۸ pinned-export surfaces (PURE, node-safe):
 * the bounds exclusion (stale pre-pin world boxes never frame the
 * export), the anchor→image placement math (relative footprint),
 * the pinned-aware export plan (mapped UNPINNED clones + text-layer
 * transform overrides) and the text-layer override rendering.
 */
import { describe, expect, it } from "vitest";
import {
  buildPinnedExportPlan,
  buildTextLayerHtml,
  computeExportBounds,
  pinnedExportPlacement,
  sceneViewOf,
} from "@/persistence/exporters/PngExporter";
import { planPdfPages } from "@/persistence/exporters/PdfExporter";
import { Scene } from "@/core/model/Scene";
import { Camera } from "@/core/camera/Camera";
import { vec2 } from "@/core/geometry/Vec2";
import { bbox } from "@/core/geometry/BBox";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import type { StickyNoteObjectData } from "@/core/model/StickyNoteObject";
import { isPinnedObject } from "@/core/model/Pinned";

/** A shape fixture at a world rect (optionally pinned at an anchor). */
function shapeAt(
  id: string,
  x: number,
  y: number,
  w = 100,
  h = 80,
  pinned = false,
  anchorX = 0,
  anchorY = 0,
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
    ...(pinned ? { pinned: true, pinAnchor: vec2(anchorX, anchorY) } : {}),
  };
}

/** A sticky note fixture (optionally pinned at an anchor). */
function stickyAt(
  id: string,
  x: number,
  y: number,
  pinned = false,
  anchorX = 0,
  anchorY = 0,
): StickyNoteObjectData {
  return {
    id,
    kind: "stickyNote",
    position: vec2(x, y),
    rotation: 0,
    zIndex: 1,
    visible: true,
    locked: false,
    width: 220,
    height: 220,
    text: "سنجاق",
    noteColor: "#fef08a",
    fontSize: 16,
    color: "token://text",
    ...(pinned ? { pinned: true, pinAnchor: vec2(anchorX, anchorY) } : {}),
  };
}

/** The HTML-builder options (theme literals + a stub rich renderer). */
const htmlOptions = {
  themeInk: "#1c1917",
  themeBorder: "#57534e",
  themeMuted: "#a8a29e",
  renderRichHtml: (doc: unknown) => `<p>rich:${JSON.stringify(doc).length}</p>`,
};

describe("computeExportBounds — pinned objects never frame the export (فاز ۲۸)", () => {
  it("skips a far-away PINNED object's stale world box", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("world", 0, 0, 100, 80));
    scene.add(shapeAt("pinned", 9000, 9000, 100, 80, true, 0.4, 0.3));
    const bounds = computeExportBounds(scene, { mode: "scene" });
    expect(bounds).toEqual(bbox(-0.5, -0.5, 100.5, 80.5));
  });

  it("returns null when ONLY pinned objects are framed", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("pinned", 0, 0, 100, 80, true, 0.5, 0.5));
    expect(computeExportBounds(scene, { mode: "scene" })).toBeNull();
    expect(
      computeExportBounds(scene, { mode: "selection", ids: ["pinned"] }),
    ).toBeNull();
  });

  it("still frames an UNPINNED object at the same spot", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("free", 9000, 9000, 100, 80));
    const bounds = computeExportBounds(scene, { mode: "scene" });
    expect(bounds?.minX).toBeGreaterThan(8000);
  });
});

describe("computeExportBounds — the pins-only viewport fallback (فاز ۳۱)", () => {
  const viewFrame = bbox(-640, -268, 640, 268);

  it("frames the provided viewport when the board holds ONLY pinned objects", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("pinned", 0, 0, 100, 80, true, 0.5, 0.5));
    const bounds = computeExportBounds(scene, { mode: "scene" }, viewFrame);
    expect(bounds).toEqual(viewFrame);
  });

  it("frames the viewport for a selection of only pinned objects", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("pinned", 0, 0, 100, 80, true, 0.2, 0.8));
    const bounds = computeExportBounds(
      scene,
      { mode: "selection", ids: ["pinned"] },
      viewFrame,
    );
    expect(bounds).toEqual(viewFrame);
  });

  it("stays null for a pins-only board WITHOUT a frame (headless callers)", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("pinned", 0, 0, 100, 80, true, 0.5, 0.5));
    expect(computeExportBounds(scene, { mode: "scene" })).toBeNull();
    expect(
      computeExportBounds(scene, { mode: "scene" }, undefined),
    ).toBeNull();
    expect(computeExportBounds(scene, { mode: "scene" }, null)).toBeNull();
  });

  it("stays null for a TRULY empty board even with a viewport frame", () => {
    const scene = new Scene(new Camera());
    expect(computeExportBounds(scene, { mode: "scene" }, viewFrame)).toBeNull();
  });

  it("ignores INVISIBLE pinned objects for the fallback", () => {
    const scene = new Scene(new Camera());
    const hidden: ShapeObjectData = {
      ...shapeAt("ghost", 0, 0, 100, 80, true, 0.5, 0.5),
      visible: false,
    };
    scene.add(hidden);
    expect(computeExportBounds(scene, { mode: "scene" }, viewFrame)).toBeNull();
  });

  it("never lets the fallback override real world content", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("world", 500, 400, 100, 80));
    scene.add(shapeAt("pinned", 9000, 9000, 100, 80, true, 0.4, 0.3));
    const bounds = computeExportBounds(scene, { mode: "scene" }, viewFrame);
    expect(bounds).toEqual(bbox(499.5, 399.5, 600.5, 480.5));
  });

  it("plans ONE viewport-framed PDF page for a pins-only board (fit-all)", () => {
    const scene = new Scene(new Camera());
    scene.add(stickyAt("pinned", 0, 0, true, 0.5, 0.5));
    const pages = planPdfPages(scene, "fit-all", viewFrame);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.region).toEqual({ mode: "bbox", box: viewFrame });
    // Without the frame the board plans NO pages (the legacy behaviour).
    expect(planPdfPages(scene, "fit-all")).toHaveLength(0);
    expect(planPdfPages(scene, "fit-all", null)).toHaveLength(0);
  });
});

describe("pinnedExportPlacement — the anchor→image math (فاز ۲۸)", () => {
  const bounds = bbox(0, 0, 1000, 500);

  it("maps the anchor to the same fraction of the export image", () => {
    const placement = pinnedExportPlacement(
      shapeAt("p", 0, 0, 200, 100, true, 0.25, 0.5),
      bounds,
      2,
      { width: 1280, height: 640 },
    );
    expect(placement.position.x).toBeCloseTo(250, 10);
    expect(placement.position.y).toBeCloseTo(250, 10);
  });

  it("scales the footprint to the same RELATIVE size (per axis)", () => {
    // viewport 1000×500 → kx = 1000/1000 = 1, ky = 500/500 = 1.
    const same = pinnedExportPlacement(
      shapeAt("p", 0, 0, 200, 100, true, 0, 0),
      bounds,
      2,
      { width: 1000, height: 500 },
    );
    expect(same.width).toBeCloseTo(200, 10);
    expect(same.height).toBeCloseTo(100, 10);
    // A WIDER viewport shrinks the on-screen fraction.
    const wider = pinnedExportPlacement(
      shapeAt("p", 0, 0, 200, 100, true, 0, 0),
      bounds,
      2,
      { width: 2000, height: 500 },
    );
    expect(wider.width).toBeCloseTo(100, 10);
    expect(wider.height).toBeCloseTo(100, 10);
  });

  it("is scale-independent in world units (the pixel scale cancels)", () => {
    const at1 = pinnedExportPlacement(
      shapeAt("p", 0, 0, 200, 100, true, 0.3, 0.7),
      bounds,
      1,
      { width: 1000, height: 500 },
    );
    const at2 = pinnedExportPlacement(
      shapeAt("p", 0, 0, 200, 100, true, 0.3, 0.7),
      bounds,
      2,
      { width: 1000, height: 500 },
    );
    expect(at1.width).toBeCloseTo(at2.width, 10);
    expect(at1.height).toBeCloseTo(at2.height, 10);
  });

  it("falls back to the stored pixel size at the export scale when headless", () => {
    const placement = pinnedExportPlacement(
      shapeAt("p", 0, 0, 200, 100, true, 0.5, 0.5),
      bounds,
      2,
      null,
    );
    expect(placement.width).toBeCloseTo(100, 10);
    expect(placement.height).toBeCloseTo(50, 10);
  });

  it("treats a degenerate viewport as headless", () => {
    const placement = pinnedExportPlacement(
      shapeAt("p", 0, 0, 200, 100, true, 0, 0),
      bounds,
      1,
      { width: 0, height: 0 },
    );
    expect(placement.width).toBeCloseTo(200, 10);
  });

  it("keeps UNCLAMPED anchors (a فاز ۲۷ resize may park off-screen)", () => {
    const placement = pinnedExportPlacement(
      shapeAt("p", 0, 0, 50, 50, true, -0.2, 1.4),
      bounds,
      1,
      { width: 1000, height: 500 },
    );
    expect(placement.position.x).toBeCloseTo(-200, 10);
    expect(placement.position.y).toBeCloseTo(700, 10);
  });
});

describe("buildPinnedExportPlan (فاز ۲۸)", () => {
  const bounds = bbox(0, 0, 1000, 500);

  it("EXCLUDES pinned objects by default (no clone, no text ghost)", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("world", 0, 0, 100, 80));
    scene.add(shapeAt("pinned", 500, 500, 100, 80, true, 0.4, 0.4));
    scene.add(stickyAt("psticky", 600, 600, true, 0.6, 0.6));
    const plan = buildPinnedExportPlan(scene, bounds, 2, {});
    expect(plan.canvasObjects.map((o) => o.id)).toEqual(["world"]);
    expect(plan.textObjects).toHaveLength(0);
    expect(plan.textOverrides.size).toBe(0);
  });

  it("maps included pinned objects to UNPINNED clones (canvas kinds)", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("world", 0, 0, 100, 80));
    scene.add(shapeAt("pinned", 500, 500, 200, 100, true, 0.25, 0.5));
    const plan = buildPinnedExportPlan(scene, bounds, 2, {
      includePinned: true,
      pinnedViewport: { width: 1000, height: 500 },
    });
    expect(plan.canvasObjects).toHaveLength(2);
    const clone = plan.canvasObjects[1]!;
    expect(clone.id).toBe("pinned");
    expect(isPinnedObject(clone)).toBe(false);
    expect(clone.pinAnchor).toBeUndefined();
    expect(clone.position.x).toBeCloseTo(250, 10);
    expect(clone.position.y).toBeCloseTo(250, 10);
    expect((clone as SceneObjectData & { width: number }).width).toBeCloseTo(200, 10);
    expect((clone as SceneObjectData & { height: number }).height).toBeCloseTo(100, 10);
  });

  it("paints the pinned clones LAST (pinned furniture floats on top)", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("pinnedA", 500, 500, 50, 50, true, 0.1, 0.1));
    scene.add(shapeAt("world", 0, 0, 100, 80));
    scene.add(shapeAt("pinnedB", 500, 500, 50, 50, true, 0.9, 0.9));
    const plan = buildPinnedExportPlan(scene, bounds, 1, {
      includePinned: true,
      pinnedViewport: { width: 1000, height: 500 },
    });
    expect(plan.canvasObjects.map((o) => o.id)).toEqual([
      "world",
      "pinnedA",
      "pinnedB",
    ]);
  });

  it("overrides the text transform for pinned text kinds (no reflow)", () => {
    const scene = new Scene(new Camera());
    scene.add(stickyAt("psticky", 600, 600, true, 0.4, 0.3));
    const plan = buildPinnedExportPlan(scene, bounds, 2, {
      includePinned: true,
      pinnedViewport: { width: 1000, height: 500 },
    });
    expect(plan.textObjects.map((o) => o.id)).toEqual(["psticky"]);
    // The original (stored-size) object rides the text layer…
    expect((plan.textObjects[0]! as SceneObjectData & { width: number }).width).toBe(220);
    // …while the CANVAS clone is resized for the vector/card path.
    expect((plan.canvasObjects[0]! as SceneObjectData & { width: number }).width).toBeCloseTo(220, 10);
    const override = plan.textOverrides.get("psticky");
    expect(override).toBeDefined();
    expect(override?.originX).toBeCloseTo(0.4 * 2000, 10);
    expect(override?.originY).toBeCloseTo(0.3 * 1000, 10);
    expect(override?.scaleX).toBeCloseTo(2, 10);
    expect(override?.scaleY).toBeCloseTo(2, 10);
  });

  it("skips invisible pinned objects even when included", () => {
    const scene = new Scene(new Camera());
    scene.add({ ...shapeAt("hidden", 500, 500, 50, 50, true, 0.5, 0.5), visible: false });
    const plan = buildPinnedExportPlan(scene, bounds, 1, {
      includePinned: true,
      pinnedViewport: { width: 1000, height: 500 },
    });
    expect(plan.canvasObjects).toHaveLength(0);
  });

  it("degrades to the stored pixel size without a viewport", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("pinned", 500, 500, 200, 100, true, 0.5, 0.5));
    const plan = buildPinnedExportPlan(scene, bounds, 2, {
      includePinned: true,
    });
    const clone = plan.canvasObjects[0]!;
    expect((clone as SceneObjectData & { width: number }).width).toBeCloseTo(100, 10);
    expect((clone as SceneObjectData & { height: number }).height).toBeCloseTo(50, 10);
    const override = plan.textOverrides.get("pinned");
    expect(override).toBeUndefined();
  });

  it("keeps the world objects shared by reference (no accidental clones)", () => {
    const scene = new Scene(new Camera());
    const world = shapeAt("world", 0, 0, 100, 80);
    scene.add(world);
    const plan = buildPinnedExportPlan(scene, bounds, 1, {
      includePinned: true,
    });
    expect(plan.canvasObjects[0]).toBe(world);
  });
});

describe("buildTextLayerHtml — transform overrides (فاز ۲۸)", () => {
  const bounds = bbox(0, 0, 1000, 500);

  it("renders a pinned sticky at the override origin + per-axis scale", () => {
    const html = buildTextLayerHtml(
      [stickyAt("ps", 600, 600, true, 0.4, 0.3)],
      bounds,
      2,
      htmlOptions,
      new Map([
        [
          "ps",
          {
            originX: 0.4 * 2000,
            originY: 0.3 * 1000,
            scaleX: 2,
            scaleY: 3,
          },
        ],
      ]),
    );
    expect(html).toContain("translate(800px, 300px)");
    expect(html).toContain("scale(2, 3)");
    // The div keeps its STORED size (the CSS scale does the sizing).
    expect(html).toContain("width:220px");
    expect(html).toContain("height:220px");
  });

  it("falls back to the world transform when no override is given", () => {
    const html = buildTextLayerHtml(
      [stickyAt("free", 100, 50)],
      bounds,
      2,
      htmlOptions,
    );
    expect(html).toContain("translate(200px, 100px)");
    expect(html).toContain("scale(2, 2)");
  });
});

describe("sceneViewOf (the shared plan view)", () => {
  it("exposes the subset objects while inheriting the scene", () => {
    const scene = new Scene(new Camera());
    scene.add(shapeAt("a", 0, 0));
    scene.add(shapeAt("b", 100, 100));
    const view = sceneViewOf(scene, [scene.objects[1]!]);
    expect(view.objects).toHaveLength(1);
    expect(view.objects[0]!.id).toBe("b");
    // The parent scene is untouched.
    expect(scene.objects).toHaveLength(2);
  });
});
