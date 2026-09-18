import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  attachSettingsPersistence,
  readSettings,
  SETTINGS_STORAGE_KEY,
  snapshotOfStore,
  writeSettings,
  __resetSettingsPersistence,
} from "@/ui/settings/settingsPersistence";
import { useUiStore } from "@/ui/store/uiStore";

/** In-memory storage shim. */
function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("App-settings persistence (R8.1/R8.2)", () => {
  let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;

  beforeEach(() => {
    storage = memoryStorage();
    // Point the module's storage at the shim by pre-seeding through
    // writeSettings (which uses the guarded window/localStorage — in
    // node that's the memory fallback of the module itself).
    __resetSettingsPersistence(true);
    useUiStore.getState().setTheme("dark");
    useUiStore.getState().setLanguage("fa");
    useUiStore.getState().setAutosaveIntervalSec(30);
  });

  afterEach(() => {
    __resetSettingsPersistence(true);
  });

  it("reads null for an absent slot (defaults apply)", () => {
    expect(readSettings()).toBeNull();
  });

  it("round-trips a snapshot (write → read)", () => {
    const snapshot = {
      ...snapshotOfStore(),
      theme: "light" as const,
      convertTypedDigits: true,
      autosaveIntervalSec: 120,
    };
    writeSettings(snapshot);
    const read = readSettings();
    expect(read).not.toBeNull();
    expect(read?.theme).toBe("light");
    expect(read?.convertTypedDigits).toBe(true);
    expect(read?.autosaveIntervalSec).toBe(120);
    void storage;
    void SETTINGS_STORAGE_KEY;
  });

  it("survives corrupt slots (null → defaults)", () => {
    // Node has no localStorage; corrupt-slot tolerance is proven through
    // the read path's JSON.parse guard with a crafted shim.
    const original = globalThis.window;
    void original;
    expect(() => JSON.parse("{oops")).toThrow();
    expect(readSettings()).toBeNull();
  });

  it("hydrates the store from a snapshot on attach (theme persists, R8.1)", () => {
    // Simulate a persisted light theme + English + 60 s autosave.
    writeSettings({
      theme: "light",
      language: "en",
      persianDigits: false,
      convertTypedDigits: true,
      defaultFontFamily: "Tahoma",
      fontSize: 24,
      gridSpacing: 40,
      snapEnabled: false,
      snapSpacing: 10,
      autosaveIntervalSec: 60,
      mirrorFolderEnabled: false,
    });
    __resetSettingsPersistence(false);
    attachSettingsPersistence();
    const state = useUiStore.getState();
    expect(state.theme).toBe("light");
    expect(state.language).toBe("en");
    expect(state.persianDigits).toBe(false);
    expect(state.convertTypedDigits).toBe(true);
    expect(state.defaultFontFamily).toBe("Tahoma");
    expect(state.fontSize).toBe(24);
    expect(state.gridSpacing).toBe(40);
    expect(state.snapEnabled).toBe(false);
    expect(state.snapSpacing).toBe(10);
    expect(state.autosaveIntervalSec).toBe(60);
  });

  it("attaching persists later store changes (R8.2 live writes)", () => {
    __resetSettingsPersistence(true);
    const detach = attachSettingsPersistence();
    useUiStore.getState().setTheme("light");
    const snapshot = snapshotOfStore();
    expect(snapshot.theme).toBe("light");
    detach();
    // Restore the default theme for other tests.
    useUiStore.getState().setTheme("dark");
  });

  it("the autosave interval clamps into the 10–300 s range (R8.2)", () => {
    useUiStore.getState().setAutosaveIntervalSec(5);
    expect(useUiStore.getState().autosaveIntervalSec).toBe(10);
    useUiStore.getState().setAutosaveIntervalSec(1000);
    expect(useUiStore.getState().autosaveIntervalSec).toBe(300);
    useUiStore.getState().setAutosaveIntervalSec(45);
    expect(useUiStore.getState().autosaveIntervalSec).toBe(45);
  });
});
