/**
 * Unit tests for the document service (R4.5): lifecycle transitions
 * (new / open / dirty / save / read-only), the dirty-tracking suspension
 * during restores, the plugins passthrough holder (§1.7.4) and the
 * persisted last-disk-save baseline (R4.6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DocumentService,
  type DocumentState,
} from "@/persistence/DocumentService";
import { EventBus } from "@/core/events/EventBus";
import { LAST_DISK_SAVE_STORAGE_KEY } from "@/persistence/ProjectFile";

/**
 * The node test environment has no DOM: each test stubs the global window
 * with an in-memory localStorage fake (same pattern as the storage tests).
 */
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

/** Event recorder for the document-changed announcements. */
function recorder(): {
  states: DocumentState[];
  bus: EventBus<{ "project:document-changed": DocumentState }>;
} {
  const states: DocumentState[] = [];
  const bus = new EventBus<{ "project:document-changed": DocumentState }>();
  bus.on("project:document-changed", (state) => {
    states.push(state);
  });
  return { states, bus };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DocumentService — initial state", () => {
  it("starts as an untitled, clean, writable document", () => {
    const { bus } = recorder();
    const document = new DocumentService(bus as never);
    expect(document.state()).toEqual({
      path: null,
      name: null,
      dirty: false,
      readOnly: false,
    });
    expect(document.getPlugins()).toEqual({});
  });
});

describe("DocumentService — dirty tracking", () => {
  it("markDirty flips the flag and announces once", () => {
    const { states, bus } = recorder();
    const document = new DocumentService(bus as never);
    expect(document.markDirty()).toBe(true);
    expect(document.markDirty()).toBe(false);
    expect(document.isDirty()).toBe(true);
    expect(states).toHaveLength(1);
    expect(states[0]?.dirty).toBe(true);
  });

  it("markClean resets the flag and can adopt a path + name", () => {
    const { bus } = recorder();
    const document = new DocumentService(bus as never);
    document.markDirty();
    document.markClean("/home/z/boards/summer.icb");
    expect(document.isDirty()).toBe(false);
    expect(document.getPath()).toBe("/home/z/boards/summer.icb");
    expect(document.getName()).toBe("summer.icb");
  });

  it("suspends dirty tracking during document swaps (restores)", () => {
    const { bus } = recorder();
    const document = new DocumentService(bus as never);
    document.suspendDirtyTracking();
    expect(document.markDirty()).toBe(false);
    expect(document.isDirty()).toBe(false);
    document.resumeDirtyTracking();
    expect(document.markDirty()).toBe(true);
    expect(document.isDirty()).toBe(true);
  });

  it("a read-only document never marks dirty", () => {
    const { bus } = recorder();
    const document = new DocumentService(bus as never);
    document.setReadOnly(true);
    expect(document.markDirty()).toBe(false);
    expect(document.isDirty()).toBe(false);
  });
});

describe("DocumentService — lifecycle", () => {
  it("noteDiskSave refreshes path/name, clears dirty and persists the baseline", () => {
    const { bus } = recorder();
    const document = new DocumentService(bus as never);
    document.markDirty();
    const savedAt = 1700000000000;
    document.noteDiskSave("/home/z/boards/plan.icb", savedAt);
    expect(document.state()).toEqual({
      path: "/home/z/boards/plan.icb",
      name: "plan.icb",
      dirty: false,
      readOnly: false,
    });
    expect(document.lastDiskSaveAt()).toBe(savedAt);
    expect(window.localStorage.getItem(LAST_DISK_SAVE_STORAGE_KEY)).toBe(
      String(savedAt),
    );
  });

  it("openedFromDisk adopts the path (windows separators too) and baseline", () => {
    const { bus } = recorder();
    const document = new DocumentService(bus as never);
    document.openedFromDisk("C:\\Users\\me\\Documents\\board.icb");
    expect(document.getName()).toBe("board.icb");
    expect(document.isDirty()).toBe(false);
    expect(document.lastDiskSaveAt()).not.toBeNull();
  });

  it("markClean without a path keeps the current path and name", () => {
    const { bus } = recorder();
    const document = new DocumentService(bus as never);
    document.openedFromDisk("/tmp/a.icb");
    document.markDirty();
    document.markClean(null);
    expect(document.getPath()).toBe("/tmp/a.icb");
    expect(document.isDirty()).toBe(false);
    // A second markClean with no state change still announces once.
    const before = document.state();
    document.markClean(null);
    expect(document.state()).toEqual(before);
  });

  it("setReadOnly to the same value is a no-op (no announcement)", () => {
    const { states, bus } = recorder();
    const document = new DocumentService(bus as never);
    document.setReadOnly(false);
    expect(states).toHaveLength(0);
    document.setReadOnly(true);
    expect(document.isReadOnly()).toBe(true);
    document.setReadOnly(true);
    expect(states).toHaveLength(1);
  });

  it("openedFromDisk(readOnly) sets the flag and skips the baseline", () => {
    const { bus } = recorder();
    const document = new DocumentService(bus as never);
    document.openedFromDisk("/tmp/future.icb", true);
    expect(document.isReadOnly()).toBe(true);
    expect(document.lastDiskSaveAt()).toBeNull();
  });

  it("openNew resets everything including the plugins holder", () => {
    const { bus } = recorder();
    const document = new DocumentService(bus as never);
    document.openedFromDisk("/tmp/a.icb");
    document.setPlugins({ "acme.x": { keep: false } });
    document.markDirty();
    document.openNew();
    expect(document.state()).toEqual({
      path: null,
      name: null,
      dirty: false,
      readOnly: false,
    });
    expect(document.getPlugins()).toEqual({});
  });
});

describe("DocumentService — plugins passthrough (§1.7.4)", () => {
  it("stores and returns the raw section untouched", () => {
    const { bus } = recorder();
    const document = new DocumentService(bus as never);
    const plugins = { "acme.widget": { deep: { list: [1, 2] } } };
    document.setPlugins(plugins);
    expect(document.getPlugins()).toBe(plugins);
  });
});

describe("DocumentService — persisted baseline (R4.6)", () => {
  it("survives a service restart (new instance reads the storage)", () => {
    const { bus } = recorder();
    const first = new DocumentService(bus as never);
    first.noteDiskSave("/tmp/a.icb", 12345);
    const second = new DocumentService(bus as never);
    expect(second.lastDiskSaveAt()).toBe(12345);
  });

  it("treats corrupt storage as 'never saved'", () => {
    window.localStorage.setItem(LAST_DISK_SAVE_STORAGE_KEY, "not-a-number");
    const { bus } = recorder();
    expect(new DocumentService(bus as never).lastDiskSaveAt()).toBeNull();
  });
});
