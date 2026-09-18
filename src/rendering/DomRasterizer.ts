/**
 * Rasterizes the DOM text overlay into an image so text objects appear in
 * PNG/PDF exports (Canvas 2D cannot draw rich text with full fidelity).
 *
 * PHASE 0 STUB — fully implemented in a later phase.
 */

/** Options controlling rasterization output. */
export interface RasterizeOptions {
  /** Output width in pixels. */
  readonly width: number;
  /** Output height in pixels. */
  readonly height: number;
  /** Device pixel ratio to render at. */
  readonly pixelRatio: number;
}

/** Converts overlay DOM into a PNG data URL. */
export class DomRasterizer {
  /**
   * Rasterizes a DOM subtree into a PNG data URL.
   *
   * @param _element - the DOM subtree to rasterize.
   * @param _options - output size and density.
   * @returns a PNG data URL, or null when unavailable (always null in
   *          Phase 0).
   */
  public async rasterize(
    _element: HTMLElement,
    _options: RasterizeOptions,
  ): Promise<string | null> {
    return null;
  }
}
