/**
 * Renderer abstraction decoupling the render loop from Canvas 2D
 * (WebGL/PixiJS upgrade path — CLAUDE.md §1.2).
 *
 * A single `requestAnimationFrame` loop drives the active renderer from one
 * dirty-flag; the scene model stays the single source of truth.
 *
 * PHASE 0 STUB — fully implemented in a later phase.
 */
import type { Camera } from "@/core/camera/Camera";
import type { Scene } from "@/core/model/Scene";

/** Backend-agnostic renderer contract. */
export interface IRenderer {
  /**
   * Prepares the renderer for its target canvas.
   *
   * @param canvas - the canvas element to draw into.
   */
  initialize(canvas: HTMLCanvasElement): void;
  /**
   * Draws one frame of the scene through the given camera.
   *
   * @param scene - the scene model to render.
   * @param camera - the viewport transform to render with.
   */
  render(scene: Scene, camera: Camera): void;
  /** Releases backend resources. */
  dispose(): void;
}
