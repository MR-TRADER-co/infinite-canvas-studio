/**
 * Unit tests for the presentation pin parity (فاز ۲۹ — «هم‌ترازی سنجاش
 * در نقشه و ارائه»): pinned objects are screen furniture of the EDITOR,
 * never slide content — their stale pre-pin world position must not
 * resurrect a ghost on a slide (the DOM text layer would paint it).
 */
import { describe, expect, it } from "vitest";
import { Scene } from "@/core/model/Scene";
import { Camera } from "@/core/camera/Camera";
import { Selection } from "@/core/selection/Selection";
import { vec2 } from "@/core/geometry/Vec2";
import { makeFrameObject } from "@/core/model/FrameObject";
import type { SceneObjectData } from "@/core/model/SceneObject";
import {
  shapeFromRect,
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN,
} from "@/core/model/ShapeObject";
import { stickyNoteFromRect } from "@/core/model/StickyNoteObject";
import {
  presentationSlides,
  slideContent,
  slideTextObjects,
} from "@/core/presentation/Presentation";

/** Builds a top-level shape fixture inside the frame's rectangle. */
function makeShape(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): SceneObjectData {
  return shapeFromRect(
    { position: vec2(x, y), width, height },
    "rectangle",
    { fill: SHAPE_FILL_TOKEN, stroke: STROKE_COLOR_TOKEN, strokeWidth: 0 },
    id,
    0,
  );
}

/** Builds a sticky note whose stored world position intersects the frame. */
function makeSticky(
  id: string,
  x: number,
  y: number,
): SceneObjectData {
  return stickyNoteFromRect(
    { minX: x, minY: y, maxX: x + 160, maxY: y + 160 },
    "#f4c430",
    "متن یادداشت",
    16,
    id,
    1,
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

describe("presentation pin parity (فاز ۲۹)", () => {
  const frame = makeFrameObject("frame-1", 0, { x: 0, y: 0 });

  it("a pinned sticky intersecting the frame is NOT slide content", () => {
    // The sticky's STALE world position sits inside the frame — but it is
    // pinned (renders on the editor screen, not on the board).
    const pinnedSticky: SceneObjectData = {
      ...makeSticky("pinned-sticky", 40, 40),
      pinned: true,
      pinAnchor: vec2(0.25, 0.25),
    };
    const content = slideContent([frame, pinnedSticky], frame);
    expect(content.map((object) => object.id)).toEqual([]);
  });

  it("an unpinned sticky in the same spot IS slide content", () => {
    const freeSticky = makeSticky("free-sticky", 40, 40);
    const content = slideContent([frame, freeSticky], frame);
    expect(content.map((object) => object.id)).toEqual(["free-sticky"]);
  });

  it("the text layer never mounts a pinned text-bearing ghost", () => {
    const pinnedSticky: SceneObjectData = {
      ...makeSticky("pinned-sticky", 40, 40),
      pinned: true,
      pinAnchor: vec2(0.5, 0.5),
    };
    const slides = presentationSlides(sceneWith([frame, pinnedSticky]));
    expect(slides).toHaveLength(1);
    const slide = slides[0]!;
    expect(slide.objects).toHaveLength(0);
    expect(slideTextObjects(slide)).toHaveLength(0);
  });

  it("mixed scenes keep only the unpinned content on slides", () => {
    const pinnedShape: SceneObjectData = {
      ...makeShape("pinned-shape", 200, 100, 80, 80),
      pinned: true,
      pinAnchor: vec2(0.75, 0.75),
    };
    const freeShape = makeShape("free-shape", 60, 60, 50, 50);
    const freeSticky = makeSticky("free-sticky", 300, 120);
    const slides = presentationSlides(
      sceneWith([frame, pinnedShape, freeShape, freeSticky]),
    );
    const slide = slides[0]!;
    expect(slide.objects.map((object) => object.id)).toEqual([
      "free-shape",
      "free-sticky",
    ]);
    // Text objects: only the free sticky (the pinned sticky is filtered).
    expect(slideTextObjects(slide).map((object) => object.id)).toEqual([
      "free-sticky",
    ]);
  });
});
