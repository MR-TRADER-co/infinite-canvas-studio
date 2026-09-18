/**
 * Camera: the world-space viewport transform (pan, zoom, rotation).
 *
 * Transform convention (invertible by construction):
 * `worldToScreen(p)` applies, in order:
 *   1. translate by `(-x, -y)`  — the camera anchor `(x, y)` maps to screen `(0, 0)`,
 *   2. rotate by `rotation`     — the viewport rotation in radians,
 *   3. scale by `zoom`          — `zoom` MUST stay strictly positive.
 * `screenToWorld` applies the exact inverse chain. The camera anchor maps to
 * the screen origin for every rotation, and with `rotation = 0` the mapping
 * reduces to `screen = (world - anchor) * zoom`.
 *
 * The camera is plain mutable state; controllers translate input intents
 * into camera updates, and both renderers consume it every frame.
 *
 * NOTE (later phase): hot paths may cache the composed matrices; the math
 * lives in `core/geometry/transforms.ts` so caching is a drop-in change.
 */
import {
  applyMat3,
  multiplyMat3,
  rotationMatrix,
  scaleMatrix,
  translationMatrix,
} from "@/core/geometry/transforms";
import { vec2 } from "@/core/geometry/Vec2";
import type { Vec2 } from "@/core/geometry/Vec2";
import type { BBox } from "@/core/geometry/BBox";

/** Viewport transform mapping world space to screen space and back. */
export class Camera {
  /**
   * @param x - world x coordinate shown at the viewport origin.
   * @param y - world y coordinate shown at the viewport origin.
   * @param zoom - scale factor (1 = 100%), must stay strictly positive.
   * @param rotation - viewport rotation in radians.
   */
  public constructor(
    public x = 0,
    public y = 0,
    public zoom = 1,
    public rotation = 0,
  ) {}

  /**
   * Maps a world-space point to screen space.
   *
   * @param worldPoint - point in world coordinates.
   * @returns the screen-space point.
   */
  public worldToScreen(worldPoint: Vec2): Vec2 {
    // scale ∘ rotation ∘ translation(-anchor)
    const m = multiplyMat3(
      multiplyMat3(
        translationMatrix(-this.x, -this.y),
        rotationMatrix(this.rotation),
      ),
      scaleMatrix(this.zoom, this.zoom),
    );
    return applyMat3(m, worldPoint);
  }

  /**
   * Maps a screen-space point back to world space.
   *
   * @param screenPoint - point in screen (viewport) coordinates.
   * @returns the world-space point.
   */
  public screenToWorld(screenPoint: Vec2): Vec2 {
    // translation(anchor) ∘ rotation(-θ) ∘ scale(1/zoom)
    const m = multiplyMat3(
      multiplyMat3(
        scaleMatrix(1 / this.zoom, 1 / this.zoom),
        rotationMatrix(-this.rotation),
      ),
      translationMatrix(this.x, this.y),
    );
    return applyMat3(m, screenPoint);
  }

  /**
   * Maps the world-space origin to screen space (convenience for the
   * origin marker and grid rendering).
   *
   * @returns the screen-space position of world `(0, 0)`.
   */
  public worldOriginToScreen(): Vec2 {
    return this.worldToScreen(vec2(0, 0));
  }

  /**
   * Computes the world-space rectangle visible through the viewport.
   *
   * The result is the axis-aligned world BBox covering every world point
   * that maps into the viewport rect `(0, 0)–(width, height)` — the exact
   * inverse of the screen corners (rotation-aware: the visible region is a
   * rotated quad in world space, so the bbox is its tight axis-aligned
   * cover).
   *
   * @param viewport - viewport size in CSS pixels.
   * @returns the visible world bounds.
   */
  public visibleWorldBBox(viewport: { width: number; height: number }): BBox {
    const corners: Vec2[] = [
      this.screenToWorld(vec2(0, 0)),
      this.screenToWorld(vec2(viewport.width, 0)),
      this.screenToWorld(vec2(0, viewport.height)),
      this.screenToWorld(vec2(viewport.width, viewport.height)),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }
}
