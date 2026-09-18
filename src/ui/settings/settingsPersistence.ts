"use client";

/**
 * App-settings persistence (R8.1/R8.2): the settings the user expects to
 * survive a restart (theme, language, digit shaping, text defaults, grid
 * + snap defaults, autosave interval) persist in APP data — localStorage
 * under the project's key convention — never inside `.icb` project files.
 *
 * The flow (mirrors `panelState.ts`): boot hydrates the UI store from
 * the slot; a store subscription writes changes back (debounced writes
 * are unnecessary — the slot is tiny and writes are synchronous).
 */
import { useUiStore, type Language, type ThemeMode } from "@/ui/store/uiStore";

/** localStorage slot of the persisted settings. */
export const SETTINGS_STORAGE_KEY = "infinite-canvas-studio/settings/v1";

/** The persisted settings snapshot (a subset of the UI store). */
export interface SettingsSnapshot {
  readonly theme: ThemeMode;
  readonly language: Language;
  readonly persianDigits: boolean;
  readonly convertTypedDigits: boolean;
  readonly defaultFontFamily: string;
  /** Default font size of NEW text objects (the `fontSize` slice). */
  readonly fontSize: number;
  readonly gridSpacing: number;
  readonly snapEnabled: boolean;
  readonly snapSpacing: number;
  readonly autosaveIntervalSec: number;
  /** The one-way Markdown mirror toggle (R13.1, AC13.2). */
  readonly mirrorFolderEnabled: boolean;
}

/**
 * Reads the persisted snapshot.
 *
 * @returns the snapshot, or null when absent/corrupt (defaults apply).
 */
export function readSettings(): SettingsSnapshot | null {
  try {
    const raw = readSlot().getItem(SETTINGS_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return coerceSnapshot(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * Persists one snapshot (best-effort; storage failures are logged and
 * swallowed — settings persistence is a convenience, never a blocker).
 *
 * @param snapshot - the settings to persist.
 */
export function writeSettings(snapshot: SettingsSnapshot): void {
  try {
    readSlot().setItem(SETTINGS_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota/disabled storage: keep the session working.
  }
}

/**
 * Builds the current snapshot off the live UI store.
 *
 * @returns the snapshot of the store's current settings.
 */
export function snapshotOfStore(): SettingsSnapshot {
  const state = useUiStore.getState();
  return {
    theme: state.theme,
    language: state.language,
    persianDigits: state.persianDigits,
    convertTypedDigits: state.convertTypedDigits,
    defaultFontFamily: state.defaultFontFamily,
    fontSize: state.fontSize,
    gridSpacing: state.gridSpacing,
    snapEnabled: state.snapEnabled,
    snapSpacing: state.snapSpacing,
    autosaveIntervalSec: state.autosaveIntervalSec,
    mirrorFolderEnabled: state.mirrorFolderEnabled,
  };
}

/**
 * The persisted settings key list (documentation — the subscription
 * persists {@link snapshotOfStore} wholesale).
 */
const PERSISTED_KEYS: readonly string[] = [
  "theme",
  "language",
  "persianDigits",
  "convertTypedDigits",
  "defaultFontFamily",
  "fontSize",
  "gridSpacing",
  "snapEnabled",
  "snapSpacing",
  "autosaveIntervalSec",
  "mirrorFolderEnabled",
];

/**
 * Attaches the persist-on-change subscription + performs the boot
 * hydration. Idempotent (AppShell may mount twice under StrictMode).
 *
 * @returns a detacher (tests).
 */
export function attachSettingsPersistence(): () => void {
  hydrateOnce();
  return useUiStore.subscribe((state) => {
    void state;
    void PERSISTED_KEYS;
    writeSettings(snapshotOfStore());
  });
}

/** Whether this module already hydrated the store (module singleton). */
let hydrated = false;

/**
 * Boot hydration: reads the slot once and pushes it into the store.
 */
function hydrateOnce(): void {
  if (hydrated) {
    return;
  }
  hydrated = true;
  const snapshot = readSettings();
  if (snapshot !== null) {
    useUiStore.getState().hydrateSettings(snapshot);
  }
}

/**
 * Test seam: resets the hydration latch so the next attach hydrates
 * again, and (optionally) clears the slot.
 *
 * @param clearSlot - whether the storage slot is removed too.
 */
export function __resetSettingsPersistence(clearSlot: boolean = false): void {
  hydrated = false;
  if (clearSlot) {
    try {
      readSlot().removeItem(SETTINGS_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

/**
 * Coerces an unknown record into a snapshot (defensive: hand-edited or
 * corrupt slots never crash the boot — invalid fields fall back to the
 * store defaults by being dropped).
 *
 * @param raw - the parsed record.
 * @returns the validated snapshot.
 */
function coerceSnapshot(raw: Record<string, unknown>): SettingsSnapshot {
  const state = useUiStore.getState();
  const boolean_ = (value: unknown): boolean | undefined =>
    typeof value === "boolean" ? value : undefined;
  const number_ = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const string_ = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;
  const language =
    raw.language === "fa" || raw.language === "en" ? raw.language : undefined;
  const theme =
    raw.theme === "dark" || raw.theme === "light" ? raw.theme : undefined;
  const mirror =
    typeof raw.mirrorFolderEnabled === "boolean"
      ? raw.mirrorFolderEnabled
      : undefined;
  return {
    theme: theme ?? state.theme,
    language: language ?? state.language,
    persianDigits: boolean_(raw.persianDigits) ?? state.persianDigits,
    convertTypedDigits:
      boolean_(raw.convertTypedDigits) ?? state.convertTypedDigits,
    defaultFontFamily:
      string_(raw.defaultFontFamily) ?? state.defaultFontFamily,
    fontSize: number_(raw.fontSize) ?? state.fontSize,
    gridSpacing: number_(raw.gridSpacing) ?? state.gridSpacing,
    snapEnabled: boolean_(raw.snapEnabled) ?? state.snapEnabled,
    snapSpacing: number_(raw.snapSpacing) ?? state.snapSpacing,
    autosaveIntervalSec:
      number_(raw.autosaveIntervalSec) ?? state.autosaveIntervalSec,
    mirrorFolderEnabled: mirror ?? state.mirrorFolderEnabled,
  };
}

/** The memoised storage shim (SSR/tests: a memory map). */
let storageShim: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null =
  null;

/**
 * The storage shim (localStorage guarded; a SHARED memory fallback so
 * node-side read/write pairs see one slot).
 */
function readSlot(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    if (typeof window !== "undefined" && window.localStorage !== undefined) {
      return window.localStorage;
    }
  } catch {
    // fall through
  }
  if (storageShim === null) {
    const memory = new Map<string, string>();
    storageShim = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    };
  }
  return storageShim;
}
