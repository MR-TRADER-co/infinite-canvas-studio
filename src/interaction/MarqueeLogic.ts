/**
 * Marquee logic: the rectangle-drag state machine behind multi-select.
 *
 * The rectangle is computed in world space; intersecting objects are
 * determined by model hit-testing on every visible, unlocked object — never
 * by DOM geometry. An object joins the selection when the rectangle
 * SUBSTANTIALLY intersects its (rotation-covering) bounds: the intersection
 * covers at least half the object's area, or the object's centre lies inside
 * the rectangle (the degenerate-box escape hatch for thin connectors).
 * A corner clip that grazes an object does not select it (AC2.2). Grouped
 * children resolve to their enclosing group, so a marquee over members
 * selects the group.
 */
import type { BBox } from "@/core/geometry/BBox";
import { bbox } from "@/core/geometry/BBox";
import { bboxIntersection, pointInBBox } from "@/core/geometry/hitTest";
import type { Vec2 } from "@/core/geometry/Vec2";
import type { Scene } from "@/core/model/Scene";
import { rotatedObjectBBox } from "@/core/model/SceneObject";
import { resolveTopLevelId } from "@/core/model/GroupObject";
import { isPinnedObject } from "@/core/model/Pinned";
import type { SceneSpatialIndex } from "@/core/spatial/SceneSpatialIndex";

/** Minimum fraction of the object's area the marquee must cover. */
const SUBSTANTIAL_AREA_RATIO = 0.5;

/** State machine for the selection rectangle. */
export class MarqueeLogic {
  /** World-space drag anchor, or null while inactive. */
  private start: Vec2 | null = null;

  /** Current world-space pointer position, or null while inactive. */
  private current: Vec2 | null = null;

  /**
   * @param scene - the scene whose objects the finished rectangle selects.
   * @param index - optional R-tree broad phase (R7.10): only objects
   *        whose bounds intersect the rectangle get the precise
   *        substantial-intersection test.
   */
  public constructor(
    private readonly scene: Scene,
    private readonly index?: SceneSpatialIndex,
  ) {}

  /**
   * Starts a marquee gesture.
   *
   * @param start - world-space point where the drag began.
   */
  public begin(start: Vec2): void {
    this.start = start;
    this.current = start;
  }

  /**
   * Extends the marquee rectangle.
   *
   * @param current - current world-space pointer position.
   */
  public update(current: Vec2): void {
    if (this.start === null) {
      return;
    }
    this.current = current;
  }

  /**
   * Ends the gesture and resolves the selection.
   *
   * A gesture that never moved tests the degenerate start-point rectangle,
   * so a plain click on empty canvas selects every object whose bounds
   * substantially cover that point.
   *
   * @returns ids of the top-level objects substantially intersecting the
   *          rectangle (empty when the gesture was never begun).
   */
  public end(): readonly string[] {
    const rect = this.rect;
    this.start = null;
    this.current = null;
    if (rect === null) {
      return [];
    }
    const ids = new Set<string>();
    const candidates =
      this.index !== undefined
        ? this.index.objectsIntersecting(rect)
        : this.scene.objects;
    for (const object of candidates) {
      if (!object.visible || object.locked || isPinnedObject(object)) {
        continue;
      }
      if (substantialBBoxIntersection(rotatedObjectBBox(object), rect)) {
        ids.add(resolveTopLevelId(this.scene, object.id));
      }
    }
    return [...ids];
  }

  /** Aborts an in-flight gesture without selecting. */
  public reset(): void {
    this.start = null;
    this.current = null;
  }

  /**
   * @returns the current marquee rectangle (normalised, so `min ≤ max` on
   * both axes regardless of the drag direction), or null while inactive.
   */
  get rect(): BBox | null {
    if (this.start === null || this.current === null) {
      return null;
    }
    return bbox(
      Math.min(this.start.x, this.current.x),
      Math.min(this.start.y, this.current.y),
      Math.max(this.start.x, this.current.x),
      Math.max(this.start.y, this.current.y),
    );
  }
}

/**
 * Tests whether a rectangle substantially intersects a box: the shared area
 * covers at least half the box's area, or the box's centre lies inside the
 * rectangle.
 *
 * @param box - the object's (covering) bounds.
 * @param rect - the marquee rectangle.
 * @returns whether the intersection is substantial.
 */
export function substantialBBoxIntersection(box: BBox, rect: BBox): boolean {
  const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  if (pointInBBox(center, rect)) {
    return true;
  }
  const intersection = bboxIntersection(box, rect);
  if (intersection === null) {
    return false;
  }
  const boxArea = (box.maxX - box.minX) * (box.maxY - box.minY);
  if (boxArea <= 0) {
    // Degenerate (zero-area) boxes: touching is substantial — they cannot
    // cover area at all, so the centre rule above already decided.
    return false;
  }
  const sharedArea =
    (intersection.maxX - intersection.minX) *
    (intersection.maxY - intersection.minY);
  return sharedArea / boxArea >= SUBSTANTIAL_AREA_RATIO;
}
