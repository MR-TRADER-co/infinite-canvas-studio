/**
 * Floating PDF-viewer APP settings (فاز P2 — A.2.3): the window's last
 * position/size/internal-zoom persist in app data (a dedicated
 * localStorage slot — NEVER the project file) and rehydrate on boot.
 * Mirrors `playerSettings.ts` / `miniPlayerSettings.ts` exactly.
 */

/** The persisted PDF viewer chrome state. */
export interface PdfViewerSettings {
  /** Window left in CSS pixels (clamped on restore). */
  readonly x: number;
  /** Window top in CSS pixels (clamped on restore). */
  readonly y: number;
  /** Window width (≥ 400, A.2.3's minimum). */
  readonly width: number;
  /** Window height (≥ 500, A.2.3's minimum). */
  readonly height: number;
  /** Internal zoom (0.5–3; 1 = fit-width at the viewer's base scale). */
  readonly zoom: number;
}

/** Storage slot (the app-data convention, never inside `.icb`). */
const PDF_VIEWER_SETTINGS_KEY = "infinite-canvas-studio/pdf-viewer/v1";

/** The default window (A.2.3: 800×600, centred). */
export const PDF_VIEWER_DEFAULTS: PdfViewerSettings = {
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  zoom: 1,
};

/** The internal-zoom clamp bounds. */
export const PDF_VIEWER_MIN_ZOOM = 0.5;
export const PDF_VIEWER_MAX_ZOOM = 3;

/** Minimum window footprint (A.2.3). */
export const PDF_VIEWER_MIN_WIDTH = 400;
export const PDF_VIEWER_MIN_HEIGHT = 500;

/** The zoom step of the +/- keys and buttons (RP2.2). */
export const PDF_VIEWER_ZOOM_STEP = 0.25;

/**
 * Reads the persisted settings (defaults for absent/corrupt slots).
 *
 * @returns the PDF viewer settings.
 */
export function readPdfViewerSettings(): PdfViewerSettings {
  if (typeof window === "undefined") {
    return PDF_VIEWER_DEFAULTS;
  }
  try {
    const raw = window.localStorage.getItem(PDF_VIEWER_SETTINGS_KEY);
    if (raw === null) {
      return PDF_VIEWER_DEFAULTS;
    }
    const parsed = JSON.parse(raw) as Partial<PdfViewerSettings>;
    return normalise(parsed);
  } catch {
    return PDF_VIEWER_DEFAULTS;
  }
}

/**
 * Persists the settings (best-effort — a quota error never breaks the
 * viewer).
 *
 * @param settings - the state to write.
 */
export function writePdfViewerSettings(settings: PdfViewerSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      PDF_VIEWER_SETTINGS_KEY,
      JSON.stringify(settings),
    );
  } catch {
    // Quota/serialization failures are silent by design.
  }
}

/**
 * Clamps a partial record onto the defaults (the defensive reader).
 *
 * @param raw - the parsed partial settings.
 * @returns the normalised settings.
 */
function normalise(raw: Partial<PdfViewerSettings>): PdfViewerSettings {
  const clamp = (
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  return {
    x: clamp(raw.x, -8192, 8192, PDF_VIEWER_DEFAULTS.x),
    y: clamp(raw.y, -8192, 8192, PDF_VIEWER_DEFAULTS.y),
    width: clamp(raw.width, PDF_VIEWER_MIN_WIDTH, 3840, PDF_VIEWER_DEFAULTS.width),
    height: clamp(raw.height, PDF_VIEWER_MIN_HEIGHT, 2160, PDF_VIEWER_DEFAULTS.height),
    zoom: clamp(raw.zoom, PDF_VIEWER_MIN_ZOOM, PDF_VIEWER_MAX_ZOOM, PDF_VIEWER_DEFAULTS.zoom),
  };
}
