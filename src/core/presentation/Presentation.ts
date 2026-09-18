/**
 * Presentation-mode planning (R8.3): pure functions that turn the scene's
 * FRAME objects into an ordered slide sequence and resolve each slide's
 * content + bounds.
 *
 * Slide membership is GEOMETRIC (D-8.2): every non-frame object whose
 * bounds INTERSECT a frame's rectangle belongs to that frame's slide —
 * moving an object into a frame region is enough, no `parentId`
 * mutation, no history side effects. Objects touching from outside are
 * clipped by the presentation view, exactly like Figma frames.
 *
 * The sequence follows the scene's paint order (array order): frames
 * earlier in the objects array present earlier, matching the layers
 * panel's bottom-to-top intuition.
 */
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { rotatedObjectBBox, objectBBox } from "@/core/model/SceneObject";
import { isFrameObject, type FrameObjectData } from "@/core/model/FrameObject";
import { isTextBoxObject } from "@/core/model/TextBoxObject";
import { isStickyNoteObject } from "@/core/model/StickyNoteObject";
import { isPinnedObject } from "@/core/model/Pinned";
import type { BBox } from "@/core/geometry/BBox";
import { bbox } from "@/core/geometry/BBox";

/** One presentation slide: a frame + the objects presenting inside it. */
export interface PresentationSlide {
  /** The frame driving the slide (1-based title text drawn by the host). */
  readonly frame: FrameObjectData;
  /** Non-frame objects intersecting the frame rectangle, paint order. */
  readonly objects: readonly SceneObjectData[];
}

/**
 * Whether a world-space box intersects another (closed intervals; edges
 * touching count — a note flush against the frame border stays on the
 * slide).
 *
 * @param a - first box.
 * @param b - second box.
 * @returns whether the boxes intersect.
 */
function boxesIntersect(a: BBox, b: BBox): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
  );
}

/**
 * Frames the presentation runs through, in slide order (paint order).
 * Invisible frames are skipped (a hidden frame is a draft, not a slide).
 *
 * @param scene - the scene to present.
 * @returns the visible frame objects in document order.
 */
export function presentationFrames(scene: Scene): readonly FrameObjectData[] {
  return scene.objects.filter(
    (object) => isFrameObject(object) && object.visible,
  ) as FrameObjectData[];
}

/**
 * Builds the full slide sequence of the scene.
 *
 * @param scene - the scene to present.
 * @returns one slide per visible frame, in document order.
 */
export function presentationSlides(scene: Scene): PresentationSlide[] {
  return presentationFrames(scene).map((frame) => ({
    frame,
    objects: slideContent(scene.objects, frame),
  }));
}

/**
 * Resolves the content of one slide: every VISIBLE non-frame object whose
 * rotated bounds intersect the frame rectangle, in paint order. Frames
 * never nest into slides (a frame inside a frame is a design choice, not
 * content); freehand strokes, connectors, images, opaque placeholders,
 * text boxes and sticky notes all take part.
 *
 * فاز ۲۹: PINNED objects are excluded — their stored world position is
 * the stale pre-pin spot (the live render ignores it), so geometric
 * slide membership would resurrect a ghost of where the object USED to
 * be, and the DOM text layer would paint that ghost on the slide. A
 * pinned object is screen furniture of the EDITOR, not slide content —
 * the same default the export pipeline took (فاز ۲۸).
 *
 * @param objects - the scene's objects in paint order.
 * @param frame - the frame whose content is resolved.
 * @returns the slide's content objects.
 */
export function slideContent(
  objects: readonly SceneObjectData[],
  frame: FrameObjectData,
): readonly SceneObjectData[] {
  const frameBox = objectBBox(frame);
  return objects.filter(
    (object) =>
      object.visible &&
      !isFrameObject(object) &&
      !isPinnedObject(object) &&
      objectOnSlide(object, frameBox),
  );
}

/**
 * Whether an object belongs to a slide (geometric containment rule).
 *
 * @param object - the candidate object.
 * @param frameBox - the frame's rectangle.
 * @returns whether the object presents on this frame's slide.
 */
export function objectOnSlide(
  object: SceneObjectData,
  frameBox: BBox,
): boolean {
  return boxesIntersect(rotatedObjectBBox(object), frameBox);
}

/**
 * The world-space bounds a slide renders: the frame rectangle (the frame
 * IS the stage — content overflowing it clips in presentation mode).
 *
 * @param frame - the slide's frame.
 * @returns the frame's bounds.
 */
export function slideBounds(frame: FrameObjectData): BBox {
  return objectBBox(frame);
}

/**
 * The text-bearing objects of a slide (the DOM text layer mounts these
 * so links stay clickable in presentation mode — AC8.5).
 *
 * @param slide - the slide.
 * @returns its text boxes and sticky notes, paint order.
 */
export function slideTextObjects(
  slide: PresentationSlide,
): readonly SceneObjectData[] {
  return slide.objects.filter(
    (object) => isTextBoxObject(object) || isStickyNoteObject(object),
  );
}

/**
 * Padding added around a slide when fitting it to the screen (world
 * units — keeps the frame border from kissing the viewport edges).
 */
export const SLIDE_VIEW_PADDING = 24;

/**
 * Computes the uniform scale + offsets fitting a slide into a viewport
 * (letterboxed, never distorted).
 *
 * @param bounds - the slide bounds (world space).
 * @param viewport - the available screen area (CSS pixels).
 * @param padding - screen-space padding around the slide.
 * @returns the fit scale and the centred screen offset.
 */
export function fitSlideToViewport(
  bounds: BBox,
  viewport: { width: number; height: number },
  padding: number = SLIDE_VIEW_PADDING,
): { scale: number; offsetX: number; offsetY: number } {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
  const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(
    availableWidth / worldWidth,
    availableHeight / worldHeight,
  );
  const offsetX = (viewport.width - worldWidth * scale) / 2;
  const offsetY = (viewport.height - worldHeight * scale) / 2;
  return { scale, offsetX, offsetY };
}

/**
 * Union helper used by tests/hosts: the content bounds of a slide (all
 * content objects, NOT clipped to the frame).
 *
 * @param slide - the slide.
 * @returns the union bounds of the slide's objects, or the frame box when
 *          the slide is empty.
 */
export function slideContentBounds(slide: PresentationSlide): BBox {
  let bounds: BBox | null = null;
  for (const object of slide.objects) {
    const box = rotatedObjectBBox(object);
    bounds =
      bounds === null
        ? box
        : bbox(
            Math.min(bounds.minX, box.minX),
            Math.min(bounds.minY, box.minY),
            Math.max(bounds.maxX, box.maxX),
            Math.max(bounds.maxY, box.maxY),
          );
  }
  return bounds ?? slideBounds(slide.frame);
}
