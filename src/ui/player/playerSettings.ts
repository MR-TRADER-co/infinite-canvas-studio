/**
 * Floating-player APP settings (فاز M2 — A.2.3): the window's last
 * position/size/volume/speed persist in app data (a dedicated
 * localStorage slot — NEVER the project file) and rehydrate on boot.
 */

/** The persisted player chrome state. */
export interface PlayerSettings {
  /** Window left in CSS pixels (clamped on restore). */
  readonly x: number;
  /** Window top in CSS pixels (clamped on restore). */
  readonly y: number;
  /** Window width (≥ 320, A.2.3's minimum). */
  readonly width: number;
  /** Window height (≥ 240, A.2.3's minimum). */
  readonly height: number;
  /** Volume 0..1. */
  readonly volume: number;
  /** Whether the player was muted. */
  readonly muted: boolean;
  /** Playback speed (one of 0.5 / 1 / 1.5 / 2). */
  readonly speed: number;
}

/** Storage slot (the app-data convention, never inside `.icb`). */
const PLAYER_SETTINGS_KEY = "infinite-canvas-studio/player/v1";

/** The default window (A.2.3: 640px wide, 16:9-ish, centred). */
export const PLAYER_DEFAULTS: PlayerSettings = {
  x: 0,
  y: 0,
  width: 640,
  height: 400,
  volume: 1,
  muted: false,
  speed: 1,
};

/** The allowed speeds (RM2.2). */
export const PLAYER_SPEEDS: readonly number[] = [0.5, 1, 1.5, 2];

/**
 * Reads the persisted settings (defaults for absent/corrupt slots).
 *
 * @returns the player settings.
 */
export function readPlayerSettings(): PlayerSettings {
  if (typeof window === "undefined") {
    return PLAYER_DEFAULTS;
  }
  try {
    const raw = window.localStorage.getItem(PLAYER_SETTINGS_KEY);
    if (raw === null) {
      return PLAYER_DEFAULTS;
    }
    const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
    return normalise(parsed);
  } catch {
    return PLAYER_DEFAULTS;
  }
}

/**
 * Persists the settings (best-effort — a quota error never breaks the
 * player).
 *
 * @param settings - the state to write.
 */
export function writePlayerSettings(settings: PlayerSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      PLAYER_SETTINGS_KEY,
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
function normalise(raw: Partial<PlayerSettings>): PlayerSettings {
  const clamp = (
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  const speed = PLAYER_SPEEDS.includes(raw.speed as number)
    ? (raw.speed as number)
    : 1;
  return {
    x: clamp(raw.x, -8192, 8192, PLAYER_DEFAULTS.x),
    y: clamp(raw.y, -8192, 8192, PLAYER_DEFAULTS.y),
    width: clamp(raw.width, 320, 3840, PLAYER_DEFAULTS.width),
    height: clamp(raw.height, 240, 2160, PLAYER_DEFAULTS.height),
    volume: clamp(raw.volume, 0, 1, PLAYER_DEFAULTS.volume),
    muted: raw.muted === true,
    speed,
  };
}
