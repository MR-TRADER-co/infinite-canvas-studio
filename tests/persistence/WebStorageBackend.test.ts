/**
 * Unit tests for the localStorage-backed autosave slot.
 *
 * The node test environment has no DOM, so each test stubs the global window
 * with an in-memory localStorage fake (vi.stubGlobal, restored via
 * vi.unstubAllGlobals in afterEach).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebStorageBackend } from "@/persistence/StorageBackend";
import { AUTOSAVE_STORAGE_KEY } from "@/persistence/ProjectFile";

/** Failure switch the storage stub honours once flipped. */
interface FailureSwitch {
  throws: boolean;
}

/** Builds an in-memory localStorage stub honouring the failure switch. */
function makeLocalStorage(failure: FailureSwitch = { throws: false }) {
  const store = new Map<string, string>();
  const guard = (): void => {
    if (failure.throws) {
      throw new Error("storage blocked");
    }
  };
  return {
    getItem(key: string): string | null {
      guard();
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      guard();
      store.set(key, value);
    },
    removeItem(key: string): void {
      guard();
      store.delete(key);
    },
    clear(): void {
      guard();
      store.clear();
    },
    key(index: number): string | null {
      guard();
      return [...store.keys()][index] ?? null;
    },
    get length(): number {
      return store.size;
    },
  };
}

describe("WebStorageBackend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("degrades to disabled when window is missing entirely", async () => {
    const backend = new WebStorageBackend("test-slot");
    expect(await backend.read()).toBeNull();
    expect(await backend.write("x")).toBe(false);
    expect(await backend.clear()).toBe(false);
  });

  it("round-trips a written payload and reports success", async () => {
    vi.stubGlobal("window", { localStorage: makeLocalStorage() });
    const backend = new WebStorageBackend("test-slot");
    expect(await backend.write("payload-1")).toBe(true);
    expect(await backend.read()).toBe("payload-1");
    expect(await backend.write("payload-2")).toBe(true);
    expect(await backend.read()).toBe("payload-2");
  });

  it("reads null before anything was written", async () => {
    vi.stubGlobal("window", { localStorage: makeLocalStorage() });
    const backend = new WebStorageBackend("test-slot");
    expect(await backend.read()).toBeNull();
  });

  it("clear removes the slot and reports success", async () => {
    vi.stubGlobal("window", { localStorage: makeLocalStorage() });
    const backend = new WebStorageBackend("test-slot");
    await backend.write("payload-1");
    expect(await backend.clear()).toBe(true);
    expect(await backend.read()).toBeNull();
  });

  it("clear on an absent slot still reports success", async () => {
    vi.stubGlobal("window", { localStorage: makeLocalStorage() });
    const backend = new WebStorageBackend("never-written");
    expect(await backend.clear()).toBe(true);
  });

  it("degrades to disabled when localStorage access throws (probe fails)", async () => {
    const windowStub: { localStorage: unknown } = {
      localStorage: makeLocalStorage(),
    };
    // Save the original descriptor so the localStorage can be restored after.
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      windowStub,
      "localStorage",
    );
    Object.defineProperty(windowStub, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    vi.stubGlobal("window", windowStub);
    const backend = new WebStorageBackend("test-slot");
    expect(await backend.read()).toBeNull();
    expect(await backend.write("x")).toBe(false);
    expect(await backend.clear()).toBe(false);
    // Restore the original localStorage descriptor after the test.
    if (originalDescriptor) {
      Object.defineProperty(windowStub, "localStorage", originalDescriptor);
    }
    expect(windowStub.localStorage).toBeDefined();
  });

  it("degrades per-operation when localStorage breaks after the probe", async () => {
    const failure: FailureSwitch = { throws: false };
    vi.stubGlobal("window", { localStorage: makeLocalStorage(failure) });
    const backend = new WebStorageBackend("test-slot");
    await backend.write("payload-1");
    failure.throws = true;
    expect(await backend.read()).toBeNull();
    expect(await backend.write("payload-2")).toBe(false);
    expect(await backend.clear()).toBe(false);
  });

  it("isolates backends with different custom keys", async () => {
    vi.stubGlobal("window", { localStorage: makeLocalStorage() });
    const alpha = new WebStorageBackend("slot-alpha");
    const beta = new WebStorageBackend("slot-beta");
    await alpha.write("A");
    await beta.write("B");
    expect(await alpha.read()).toBe("A");
    expect(await beta.read()).toBe("B");
    await alpha.clear();
    expect(await alpha.read()).toBeNull();
    expect(await beta.read()).toBe("B");
  });

  it("defaults to the shared autosave storage key", async () => {
    vi.stubGlobal("window", { localStorage: makeLocalStorage() });
    const writer = new WebStorageBackend();
    const reader = new WebStorageBackend(AUTOSAVE_STORAGE_KEY);
    await writer.write("autosave-payload");
    expect(await reader.read()).toBe("autosave-payload");
    expect(AUTOSAVE_STORAGE_KEY).toBe("infinite-canvas-studio/autosave/v1");
  });
});
