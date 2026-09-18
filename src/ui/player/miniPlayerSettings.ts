/**
 * Floating MINI-player APP settings (فاز A2 — A.2.3): the audio window's
 * last position/size/volume/speed persist in app data (a dedicated
 * localStorage slot — NEVER the project file) and rehydrate on boot.
 *
 * Mirrors `playerSettings.ts` (the video window's) with the audio
 * contract's own defaults: default 400×120, minimum 320×100 (A.2.3).
 */

/** The persisted mini-player chrome state. */
export interface MiniPlayerSettings {
  /** Window left in CSS pixels (clamped on restore). */
  readonly x: number;
  /** Window top in CSS pixels (clamped on restore). */
  readonly y: number;
  /** Window width (≥ 320, A.2.3's minimum). */
  readonly width: number;
  /** Window height (≥ 100, A.2.3's minimum). */
  readonly height: number;
  /** Volume 0..1. */
  readonly volume: number;
  /** Whether the player was muted. */
  readonly muted: boolean;
  /** Playback speed (one of 0.5 / 1 / 1.5 / 2). */
  readonly speed: number;
}

/** Storage slot (the app-data convention, never inside `.icb`). */
const MINI_PLAYER_SETTINGS_KEY = "infinite-canvas-studio/mini-player/v1";

/** The default window (A.2.3: 400×120, centred). */
export const MINI_PLAYER_DEFAULTS: MiniPlayerSettings = {
  x: 0,
  y: 0,
  width: 400,
  height: 120,
  volume: 1,
  muted: false,
  speed: 1,
};

/** Minimum footprint (A.2.3). */
export const MINI_PLAYER_MIN_WIDTH = 320;
export const MINI_PLAYER_MIN_HEIGHT = 100;

/** The allowed speeds (RM2.2's set). */
export const MINI_PLAYER_SPEEDS: readonly number[] = [0.5, 1, 1.5, 2];

/**
 * Reads the persisted settings (defaults for absent/corrupt slots).
 *
 * @returns the mini-player settings.
 */
export function readMiniPlayerSettings(): MiniPlayerSettings {
  if (typeof window === "undefined") {
    return MINI_PLAYER_DEFAULTS;
  }
  try {
    const raw = window.localStorage.getItem(MINI_PLAYER_SETTINGS_KEY);
    if (raw === null) {
      return MINI_PLAYER_DEFAULTS;
    }
    const parsed = JSON.parse(raw) as Partial<MiniPlayerSettings>;
    return normalise(parsed);
  } catch {
    return MINI_PLAYER_DEFAULTS;
  }
}

/**
 * Persists the settings (best-effort — a quota error never breaks the
 * player).
 *
 * @param settings - the state to write.
 */
export function writeMiniPlayerSettings(settings: MiniPlayerSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      MINI_PLAYER_SETTINGS_KEY,
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
function normalise(raw: Partial<MiniPlayerSettings>): MiniPlayerSettings {
  const clamp = (
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  const speed = MINI_PLAYER_SPEEDS.includes(raw.speed as number)
    ? (raw.speed as number)
    : 1;
  return {
    x: clamp(raw.x, -8192, 8192, MINI_PLAYER_DEFAULTS.x),
    y: clamp(raw.y, -8192, 8192, MINI_PLAYER_DEFAULTS.y),
    width: clamp(raw.width, MINI_PLAYER_MIN_WIDTH, 3840, MINI_PLAYER_DEFAULTS.width),
    height: clamp(raw.height, MINI_PLAYER_MIN_HEIGHT, 2160, MINI_PLAYER_DEFAULTS.height),
    volume: clamp(raw.volume, 0, 1, MINI_PLAYER_DEFAULTS.volume),
    muted: raw.muted === true,
    speed,
  };
}
