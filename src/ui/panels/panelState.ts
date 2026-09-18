/**
 * Dock-panel open-state persistence (R7.1): the open/closed state of every
 * registered panel lives in localStorage, keyed by panel id and merged
 * over the registry's `defaultOpen` values on boot.
 *
 * SSR-safe: reads happen inside effects, never at module scope.
 */

/** localStorage key of the panel-state map. */
export const PANEL_STATE_STORAGE_KEY = "infinite-canvas-studio/panels/v1";

/**
 * Reads the persisted panel state, merged over the defaults.
 *
 * @param defaults - the registry's defaultOpen map.
 * @returns the effective open/closed map (defaults on any read error).
 */
export function readPanelState(
  defaults: Readonly<Record<string, boolean>>,
): Readonly<Record<string, boolean>> {
  if (typeof window === "undefined") {
    return defaults;
  }
  try {
    const raw = window.localStorage.getItem(PANEL_STATE_STORAGE_KEY);
    if (raw === null) {
      return defaults;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return defaults;
    }
    const persisted: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === "boolean") {
        persisted[id] = value;
      }
    }
    return { ...defaults, ...persisted };
  } catch {
    return defaults;
  }
}

/**
 * Persists the panel state.
 *
 * @param state - the open/closed map to write.
 */
export function writePanelState(
  state: Readonly<Record<string, boolean>>,
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(PANEL_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, quota) — view state is best-effort.
  }
}
