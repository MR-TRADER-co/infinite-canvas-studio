/**
 * Unit tests for the Tauri app-data storage (R4.6): outside the Tauri
 * shell the slot degrades to the localStorage backend — the node test
 * environment (window stubbed, no __TAURI__ internals) exercises exactly
 * that fallback path end-to-end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TauriAppDataStorage } from "@/persistence/TauriAppDataStorage";
import { AUTOSAVE_STORAGE_KEY } from "@/persistence/ProjectFile";

/** In-memory localStorage stub (the node environment has no DOM). */
function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: makeLocalStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TauriAppDataStorage — the web fallback", () => {
  it("reads null when the fallback slot is empty", async () => {
    const storage = new TauriAppDataStorage();
    await expect(storage.read()).resolves.toBeNull();
  });

  it("writes + reads the payload through the localStorage fallback", async () => {
    const storage = new TauriAppDataStorage();
    await expect(storage.write("payload-v2")).resolves.toBe(true);
    await expect(storage.read()).resolves.toBe("payload-v2");
    expect(window.localStorage.getItem(AUTOSAVE_STORAGE_KEY)).toBe(
      "payload-v2",
    );
  });

  it("clears the fallback slot", async () => {
    const storage = new TauriAppDataStorage();
    await storage.write("payload");
    await expect(storage.clear()).resolves.toBe(true);
    await expect(storage.read()).resolves.toBeNull();
  });
});
