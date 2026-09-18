/**
 * Background grid drawing (dot or line grid) in world space.
 *
 * The grid spacing is zoom-adaptive: the base world spacing doubles/halves
 * (powers of two) so the on-screen dot density stays bounded at any zoom.
 * Every 5th grid intersection draws a stronger "major" dot (the same
 * two-scale rhythm as the Phase 0 CSS grid). The world origin (0, 0) is
 * marked with a small crosshair that stays put in world space.
 */
import type { Camera } from "@/core/camera/Camera";

/** Grid visual styles. */
export type GridStyle = "dots" | "lines";

/** Colours of the grid layers (theme-dependent, injected by the host). */
export interface GridColors {
  /** Colour of the minor (per-cell) dots. */
  readonly minor: string;
  /** Colour of the major (every 5th cell) dots. */
  readonly major: string;
  /** Colour of the world-origin crosshair. */
  readonly origin: string;
}

/** Default dark-theme grid colours (oklch works in Canvas 2D). */
export const DARK_GRID_COLORS: GridColors = {
  minor: "oklch(1 0 0 / 6%)",
  major: "oklch(1 0 0 / 12%)",
  origin: "oklch(1 0 0 / 28%)",
};

/** Default light-theme grid colours. */
export const LIGHT_GRID_COLORS: GridColors = {
  minor: "oklch(0.145 0 0 / 10%)",
  major: "oklch(0.145 0 0 / 18%)",
  origin: "oklch(0.145 0 0 / 32%)",
};

/** Base world-space grid spacing (20 world units per cell at 100% — the
 *  R5.5 snap default, so snapped edges land on the visible dots; every
 *  adaptive level is a power-of-two multiple and therefore still on-grid).
 *  R8.2: the user-configurable default (the Settings dialog's canvas
 *  section) REPLACES this base at runtime. */
const BASE_SPACING = 20;

/** Screen-space bounds the dot density is kept between (CSS pixels). */
const MIN_SCREEN_SPACING = 16;
const MAX_SCREEN_SPACING = 64;

/** Draws the infinite background grid under the scene. */
export class GridRenderer {
  /** Current colours of the grid layers. */
  private colors: GridColors;

  /** Base world-space cell spacing (R8.2 user-configurable). */
  private baseSpacing: number = BASE_SPACING;

  /**
   * @param style - whether to draw a dot grid or a line grid.
   * @param colors - theme-dependent grid colours (defaults: dark theme).
   */
  public constructor(
    public readonly style: GridStyle = "dots",
    colors: GridColors = DARK_GRID_COLORS,
  ) {
    this.colors = colors;
  }

  /**
   * Replaces the grid colours (theme switch).
   *
   * @param colors - the new grid colours.
   */
  public setColors(colors: GridColors): void {
    this.colors = colors;
  }

  /**
   * Replaces the base cell spacing (R8.2 — the Settings dialog's canvas
   * section; the next frame reflects the change).
   *
   * @param spacing - the base world-space spacing (≥ 1).
   */
  public setBaseSpacing(spacing: number): void {
    this.baseSpacing = Math.max(1, spacing);
  }

  /**
   * @returns the effective base spacing (test probe).
   */
  public getBaseSpacing(): number {
    return this.baseSpacing;
  }

  /**
   * Draws the grid for the current viewport.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform (grid spacing adapts to zoom).
   */
  public drawGrid(context: CanvasRenderingContext2D, camera: Camera): void {
    const width = context.canvas.width / (window.devicePixelRatio || 1);
    const height = context.canvas.height / (window.devicePixelRatio || 1);
    const spacing = this.adaptiveSpacing(camera.zoom);
    if (spacing <= 0) {
      return;
    }

    // World-space viewport bounds (screen corners mapped back to world).
    const corners = [
      camera.screenToWorld({ x: 0, y: 0 }),
      camera.screenToWorld({ x: width, y: 0 }),
      camera.screenToWorld({ x: 0, y: height }),
      camera.screenToWorld({ x: width, y: height }),
    ];
    const minX = Math.min(...corners.map((c) => c.x));
    const maxX = Math.max(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y));
    const maxY = Math.max(...corners.map((c) => c.y));

    this.drawDots(context, camera, spacing, minX, minY, maxX, maxY);
    this.drawOriginMarker(context, camera);
  }

  /**
   * Draws the two-scale dot field using exact integer cell indices (no
   * floating-point drift in the major-dot classification).
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   * @param spacing - world-space cell spacing.
   * @param minX - first world x to cover.
   * @param minY - first world y to cover.
   * @param maxX - last world x to cover.
   * @param maxY - last world y to cover.
   */
  private drawDots(
    context: CanvasRenderingContext2D,
    camera: Camera,
    spacing: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): void {
    const firstCol = Math.floor(minX / spacing);
    const lastCol = Math.ceil(maxX / spacing);
    const firstRow = Math.floor(minY / spacing);
    const lastRow = Math.ceil(maxY / spacing);
    for (let col = firstCol; col <= lastCol; col += 1) {
      const isMajorCol = col % 5 === 0;
      for (let row = firstRow; row <= lastRow; row += 1) {
        const isMajor = isMajorCol && row % 5 === 0;
        const screen = camera.worldToScreen({
          x: col * spacing,
          y: row * spacing,
        });
        context.fillStyle = isMajor ? this.colors.major : this.colors.minor;
        const size = isMajor ? 1.5 : 1;
        context.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);
      }
    }
  }

  /**
   * Draws the world-origin crosshair marker.
   *
   * @param context - the canvas 2D context to draw with.
   * @param camera - the viewport transform.
   */
  private drawOriginMarker(
    context: CanvasRenderingContext2D,
    camera: Camera,
  ): void {
    const origin = camera.worldOriginToScreen();
    const arm = 10;
    context.strokeStyle = this.colors.origin;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(origin.x - arm, origin.y);
    context.lineTo(origin.x + arm, origin.y);
    context.moveTo(origin.x, origin.y - arm);
    context.lineTo(origin.x, origin.y + arm);
    context.stroke();
    context.fillStyle = this.colors.origin;
    context.beginPath();
    context.arc(origin.x, origin.y, 2, 0, Math.PI * 2);
    context.fill();
  }

  /**
   * Picks this renderer's adaptive spacing (base-aware, R8.2).
   *
   * @param zoom - the current camera zoom.
   * @returns the world-space grid spacing.
   */
  private adaptiveSpacing(zoom: number): number {
    return adaptiveSpacing(zoom, this.baseSpacing);
  }
}

/**
 * Picks the world spacing whose on-screen size stays in the target band.
 *
 * @param zoom - the current camera zoom.
 * @param base - the base world spacing (R8.2 user-configurable).
 * @returns the world-space grid spacing (a power-of-two multiple of the base).
 */
function adaptiveSpacing(zoom: number, base: number): number {
  let spacing = base;
  while (spacing * zoom < MIN_SCREEN_SPACING) {
    spacing *= 2;
  }
  while (spacing * zoom > MAX_SCREEN_SPACING) {
    spacing /= 2;
  }
  return spacing;
}
