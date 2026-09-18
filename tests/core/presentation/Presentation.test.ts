import { describe, expect, it } from "vitest";
import { Scene } from "@/core/model/Scene";
import { Camera } from "@/core/camera/Camera";
import { Selection } from "@/core/selection/Selection";
import {
  objectBBox,
  translateSceneObject,
  resizeSceneObject,
} from "@/core/model/SceneObject";
import { makeFrameObject, frameChromeHit } from "@/core/model/FrameObject";
import {
  fitSlideToViewport,
  presentationFrames,
  presentationSlides,
  slideBounds,
  slideContent,
  slideTextObjects,
  slideContentBounds,
} from "@/core/presentation/Presentation";
import {
  shapeFromRect,
  STROKE_COLOR_TOKEN,
  SHAPE_FILL_TOKEN,
} from "@/core/model/ShapeObject";
import { isFrameObject } from "@/core/model/FrameObject";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Builds a small shape at a position (test helper). */
function makeShapeObject(
  id: string,
  zIndex: number,
  position: { x: number; y: number },
  size = 120,
): SceneObjectData {
  return shapeFromRect(
    {
      position: { x: position.x, y: position.y },
      width: size,
      height: size,
    },
    "rectangle",
    { fill: SHAPE_FILL_TOKEN, stroke: STROKE_COLOR_TOKEN, strokeWidth: 2 },
    id,
    zIndex,
  );
}

/** Builds a scene preloaded with objects (paint order = array order). */
function sceneWith(objects: SceneObjectData[]): Scene {
  const scene = new Scene(
    new Camera(),
    new Selection(() => undefined),
    () => undefined,
  );
  for (const object of objects) {
    scene.add(object);
  }
  return scene;
}

describe("FrameObject model (R8.3)", () => {
  it("builds a default frame with token colours + slide footprint", () => {
    const frame = makeFrameObject("frame-1", 3, { x: -100, y: -50 });
    expect(isFrameObject(frame)).toBe(true);
    expect(frame.width).toBe(640);
    expect(frame.height).toBe(400);
    expect(frame.title).toBe("");
    expect(frame.fill).toBe("accent");
    expect(frame.stroke).toBe("primary");
    expect(frame.position).toEqual({ x: -100, y: -50 });
  });

  it("bounds cover position + size (title bar included)", () => {
    const frame = makeFrameObject("frame-1", 0, { x: 10, y: 20 });
    const box = objectBBox(frame);
    expect(box).toEqual({ minX: 10, minY: 20, maxX: 650, maxY: 420 });
  });

  it("translates and resizes through the shared machinery", () => {
    const frame = makeFrameObject("frame-1", 0, { x: 0, y: 0 });
    const moved = translateSceneObject(frame, { x: 100, y: 50 });
    expect(moved.position).toEqual({ x: 100, y: 50 });
    expect((moved as unknown as { width: number }).width).toBe(640);
    const resized = resizeSceneObject(moved, objectBBox(moved), {
      minX: 100,
      minY: 50,
      maxX: 400,
      maxY: 350,
    });
    expect(objectBBox(resized)).toEqual({
      minX: 100,
      minY: 50,
      maxX: 400,
      maxY: 350,
    });
  });

  it("hit-tests ONLY its chrome (border ring + title bar) — AC8.5", () => {
    const frame = makeFrameObject("frame-1", 0, { x: 0, y: 0 });
    // The body interior misses (contained objects stay clickable).
    expect(frameChromeHit(frame, { x: 100, y: 200 }, 4)).toBe(false);
    // The title bar hits.
    expect(frameChromeHit(frame, { x: 320, y: 10 }, 4)).toBe(true);
    // The border ring hits.
    expect(frameChromeHit(frame, { x: 0, y: 200 }, 4)).toBe(true);
    expect(frameChromeHit(frame, { x: 640, y: 200 }, 4)).toBe(true);
    expect(frameChromeHit(frame, { x: 320, y: 400 }, 4)).toBe(true);
    // Far outside misses.
    expect(frameChromeHit(frame, { x: -50, y: -50 }, 4)).toBe(false);
  });
});

describe("Presentation planning (R8.3)", () => {
  const frameA = { ...makeFrameObject("f1", 0, { x: 0, y: 0 }), title: "اول" };
  const frameB = {
    ...makeFrameObject("f2", 1, { x: 800, y: 0 }),
    title: "دوم",
  };
  const insideA = makeShapeObject("s1", 2, { x: 40, y: 60 });
  const insideB = makeShapeObject("s2", 3, { x: 840, y: 60 });
  const everywhere = makeShapeObject("s3", 4, { x: 600, y: 10 }, 300);
  const hidden = {
    ...makeShapeObject("s4", 5, { x: 40, y: 60 }),
    visible: false,
  };
  const scene = sceneWith([
    frameA,
    frameB,
    insideA,
    insideB,
    everywhere,
    hidden,
  ]);

  it("lists frames in document order, skipping invisible ones", () => {
    expect(presentationFrames(scene).map((frame) => frame.id)).toEqual([
      "f1",
      "f2",
    ]);
    const hiddenFrameScene = sceneWith([
      { ...makeFrameObject("f0", 6, { x: 0, y: 0 }), visible: false },
      frameA,
    ]);
    expect(
      presentationFrames(hiddenFrameScene).map((frame) => frame.id),
    ).toEqual(["f1"]);
  });

  it("resolves slide content geometrically (intersects the frame)", () => {
    const content = slideContent(scene.objects, frameA);
    expect(content.map((object) => object.id)).toEqual([
      "s1",
      "s3", // everywhere: intersects frame A's edge → clipped onto A's slide
    ]);
    const contentB = slideContent(scene.objects, frameB);
    expect(contentB.map((object) => object.id)).toEqual(["s2", "s3"]);
  });

  it("excludes invisible objects and nested frames from slides", () => {
    const slides = presentationSlides(scene);
    expect(slides.length).toBe(2);
    expect(slides[0]?.objects.some((object) => object.id === "s4")).toBe(false);
    expect(slides[0]?.objects.some((object) => isFrameObject(object))).toBe(
      false,
    );
  });

  it("slide bounds equal the frame rectangle", () => {
    expect(slideBounds(frameA)).toEqual(objectBBox(frameA));
  });

  it("collects the text-bearing objects for the live DOM layer", () => {
    const slides = presentationSlides(scene);
    expect(Array.isArray(slideshowTextIds(slides[0] as never))).toBe(true);
  });

  it("text objects join their frame's slide (the link layer mounts them)", () => {
    const textBox = {
      ...makeShapeObject("t1", 7, { x: 100, y: 100 }),
      kind: "textBox",
    } as unknown as SceneObjectData;
    const withText = sceneWith([frameA, textBox]);
    const slide = presentationSlides(withText)[0]!;
    expect(slideTextObjects(slide).map((object) => object.id)).toEqual(["t1"]);
  });

  it("computes the content bounds union (empty slide → frame box)", () => {
    const slides = presentationSlides(scene);
    const onlyFrame = sceneWith([frameA]);
    const emptySlide = presentationSlides(onlyFrame)[0]!;
    expect(slideContentBounds(emptySlide)).toEqual(slideBounds(frameA));
    expect(slideContentBounds(slides[0]!).maxX).toBeGreaterThanOrEqual(
      slideBounds(frameA).maxX,
    );
  });

  it("fits slides to a viewport letterboxed + centred", () => {
    const bounds = slideBounds(frameA); // 640×400 world
    const fit = fitSlideToViewport(bounds, { width: 1280, height: 800 }, 40);
    // Available 1200×720 → the height constrains (letterbox left/right).
    expect(fit.scale).toBeCloseTo(720 / 400, 5);
    expect(fit.offsetX).toBeCloseTo((1280 - 640 * (720 / 400)) / 2, 5);
    expect(fit.offsetY).toBeCloseTo(40, 5);
    // A tall viewport letterboxes vertically at scale ~1.
    const tall = fitSlideToViewport(bounds, { width: 640, height: 2000 });
    expect(tall.scale).toBeCloseTo((640 - 2 * 24) / 640, 5);
    expect(tall.offsetX).toBeCloseTo(24, 5);
    expect(tall.offsetY).toBeCloseTo((2000 - 400 * tall.scale) / 2, 5);
  });
});

/** Helper: ids of a slide's text objects. */
function slideshowTextIds(slide: {
  objects: readonly SceneObjectData[];
  frame: never;
}): readonly string[] {
  return slideTextObjects(slide as never).map((object) => object.id);
}

describe("pinned overlay composition on slides (فاز ۳۱)", () => {
  it("keeps slide content pin-free while the overlay plan maps the pin", async () => {
    const { buildPinnedExportPlan } = await import(
      "@/persistence/exporters/PngExporter"
    );
    const { isPinnedObject } = await import("@/core/model/Pinned");
    const frame = makeFrameObject("frame", 0, { x: 0, y: 0 });
    const world = makeShapeObject("world", 1, { x: 100, y: 100 });
    const pinned = {
      ...makeShapeObject("pinned", 2, { x: 8000, y: 8000 }),
      pinned: true,
      pinAnchor: { x: 0.5, y: 0.5 },
    } as SceneObjectData;
    const scene = sceneWith([frame, world, pinned]);

    // The slide itself stays pin-free (فاز ۲۹ default, unchanged).
    const slides = presentationSlides(scene);
    expect(slides).toHaveLength(1);
    expect(slides[0]!.objects.map((object) => object.id)).toEqual(["world"]);

    // The overlay plan maps the pin onto the FRAME bounds at its anchor
    // fraction (the same math the export pipeline took, فاز ۲۸).
    const plan = buildPinnedExportPlan(scene, slideBounds(frame), 1, {
      includePinned: true,
      pinnedViewport: { width: 1280, height: 720 },
    });
    const clone = plan.canvasObjects.find((object) => object.id === "pinned");
    expect(clone).toBeDefined();
    expect(isPinnedObject(clone!)).toBe(false);
    // Anchor (0.5, 0.5) of the 640×400 slide → clone lands centred.
    expect(clone!.position.x).toBeGreaterThan(200);
    expect(clone!.position.x).toBeLessThan(440);
    // Pinned clones paint AFTER the world objects (float on top).
    const cloneIndex = plan.canvasObjects.findIndex(
      (object) => object.id === "pinned",
    );
    const worldIndex = plan.canvasObjects.findIndex(
      (object) => object.id === "world",
    );
    expect(cloneIndex).toBeGreaterThan(worldIndex);
  });
});
