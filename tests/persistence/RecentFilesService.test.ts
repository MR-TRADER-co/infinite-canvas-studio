/**
 * Unit tests for the recent files service (R4.7): ordering, de-duplication,
 * the ten-entry trim, corrupt-storage recovery, removal and clearing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRecentFilesStore,
  RecentFilesService,
  type RecentFileEntry,
} from "@/persistence/RecentFilesService";

/** A fresh service over an in-memory store (fresh per call). */
function makeService(): {
  service: RecentFilesService;
  store: MemoryRecentFilesStore;
} {
  const store = new MemoryRecentFilesStore();
  return { service: new RecentFilesService(store), store };
}

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

describe("RecentFilesService", () => {
  it("starts empty", () => {
    const { service } = makeService();
    expect(service.getRecentFiles()).toEqual([]);
  });

  it("records entries with a basename and timestamps, newest first", () => {
    const { service } = makeService();
    service.add("/home/z/a.icb");
    service.add("/home/z/b.icb");
    const entries = service.getRecentFiles();
    expect(entries.map((entry) => entry.path)).toEqual([
      "/home/z/b.icb",
      "/home/z/a.icb",
    ]);
    expect(entries[0]?.name).toBe("b.icb");
    expect(entries[0]?.openedAt).toBeTypeOf("number");
  });

  it("handles windows separators in the name derivation", () => {
    const { service } = makeService();
    service.add("C:\\Users\\me\\Documents\\board.icb");
    expect(service.getRecentFiles()[0]?.name).toBe("board.icb");
  });

  it("de-duplicates by exact path (re-open moves to the front)", () => {
    const { service } = makeService();
    service.add("/a.icb");
    service.add("/b.icb");
    service.add("/a.icb");
    const paths = service.getRecentFiles().map((entry) => entry.path);
    expect(paths).toEqual(["/a.icb", "/b.icb"]);
  });

  it("trims the list to the last TEN projects (R4.7)", () => {
    const { service } = makeService();
    for (let index = 0; index < 15; index += 1) {
      service.add(`/p/${index}.icb`);
    }
    const entries = service.getRecentFiles();
    expect(entries).toHaveLength(10);
    // Newest first: 14 … 5.
    expect(entries[0]?.path).toBe("/p/14.icb");
    expect(entries[9]?.path).toBe("/p/5.icb");
  });

  it("ignores blank paths", () => {
    const { service } = makeService();
    service.add("   ");
    expect(service.getRecentFiles()).toEqual([]);
  });

  it("removes single entries and clears the whole list", () => {
    const { service } = makeService();
    service.add("/a.icb");
    service.add("/b.icb");
    service.remove("/a.icb");
    expect(service.getRecentFiles().map((entry) => entry.path)).toEqual([
      "/b.icb",
    ]);
    service.clear();
    expect(service.getRecentFiles()).toEqual([]);
  });
});

describe("LocalRecentFilesStore (localStorage)", () => {
  it("round-trips entries through localStorage", () => {
    const service = new RecentFilesService();
    service.add("/home/z/boards/one.icb");
    // A fresh service over the SAME storage sees the entry.
    const reloaded = new RecentFilesService();
    expect(reloaded.getRecentFiles()[0]?.path).toBe("/home/z/boards/one.icb");
  });

  it("treats corrupt storage as an empty list (never crashes)", () => {
    window.localStorage.setItem(
      "infinite-canvas-studio/recent-files/v1",
      "{broken json",
    );
    const service = new RecentFilesService();
    expect(service.getRecentFiles()).toEqual([]);
  });

  it("drops malformed entries and keeps the well-formed ones", () => {
    const corrupt: unknown[] = [
      { path: "/good.icb", name: "good.icb", openedAt: 1 },
      { path: 42, name: "bad", openedAt: 1 },
      { name: "no-path", openedAt: 1 },
      { path: "/no-time.icb", name: "x", openedAt: Number.NaN },
    ];
    window.localStorage.setItem(
      "infinite-canvas-studio/recent-files/v1",
      JSON.stringify(corrupt),
    );
    const service = new RecentFilesService();
    const entries: readonly RecentFileEntry[] = service.getRecentFiles();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe("/good.icb");
  });
});
