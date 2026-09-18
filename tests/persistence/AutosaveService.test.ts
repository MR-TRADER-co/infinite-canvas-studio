/**
 * Unit tests for the autosave service (interval, manual save, flush hooks).
 *
 * The node test environment has no DOM, so window/document are stubbed with
 * minimal EventTarget fakes for the attachWindowFlush cases (restored in
 * afterEach via vi.unstubAllGlobals so listeners never leak across tests).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/core/events/EventBus";
import { AutosaveService } from "@/persistence/AutosaveService";
import { VersionedSerializer } from "@/persistence/VersionedSerializer";
import { vec2 } from "@/core/geometry/Vec2";
import type {
  AppEventMap,
  PersistenceSaveFailedEvent,
  PersistenceSavedEvent,
} from "@/core/events/EventBus";
import type { ProjectData } from "@/persistence/ProjectFile";
import type { FreehandObjectData } from "@/core/model/FreehandObject";
import type { IProjectStorage } from "@/persistence/StorageBackend";

/** Minimal DOM EventTarget stand-in (the node environment has no DOM). */
class FakeEventTarget {
  private readonly listeners = new Map<
    string,
    Set<(event: { type: string }) => void>
  >();

  public addEventListener(
    type: string,
    listener: (event: { type: string }) => void,
  ): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  public removeEventListener(
    type: string,
    listener: (event: { type: string }) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  public dispatchEvent(event: { type: string }): boolean {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
      listener(event);
    }
    return true;
  }
}

/** Builds a tiny valid project payload for the real serializer. */
function makeProjectData(): ProjectData {
  const stroke: FreehandObjectData = {
    id: "obj-1",
    kind: "freehand",
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    points: [vec2(0, 0), vec2(10, 10)],
    strokeColor: "primary",
    strokeWidth: 2,
    strokeStyle: "solid",
  };
  return { camera: { x: 0, y: 0, zoom: 1, rotation: 0 }, objects: [stroke] };
}

/** Wires a service harness: real serializer + event bus, fake storage. */
function createHarness() {
  const serializer = new VersionedSerializer();
  const projectData = makeProjectData();
  const getProjectData = vi.fn<() => ProjectData>(() => projectData);
  const read = vi.fn<() => Promise<string | null>>().mockResolvedValue(null);
  const write = vi
    .fn<(contents: string) => Promise<boolean>>()
    .mockResolvedValue(true);
  const clear = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  const storage: IProjectStorage = { read, write, clear };
  const bus = new EventBus<AppEventMap>();
  const saved = vi.fn<(payload: PersistenceSavedEvent) => void>();
  const failed = vi.fn<(payload: PersistenceSaveFailedEvent) => void>();
  bus.on("persistence:saved", saved);
  bus.on("persistence:save-failed", failed);
  const service = new AutosaveService({
    serializer,
    getProjectData,
    storage,
    bus,
  });
  return {
    serializer,
    projectData,
    getProjectData,
    read,
    write,
    clear,
    storage,
    bus,
    saved,
    failed,
    service,
  };
}

/** Flushes pending microtasks without advancing the faked clock. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("AutosaveService", () => {
  let h: ReturnType<typeof createHarness>;
  let fakeWindow: FakeEventTarget;
  let fakeDocument: FakeEventTarget;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeWindow = new FakeEventTarget();
    fakeDocument = new FakeEventTarget();
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    h = createHarness();
  });

  afterEach(() => {
    // Stops the timer and detaches the flush listeners while the stubs are live.
    h.service.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts clean", () => {
    expect(h.service.isDirty()).toBe(false);
  });

  it("markDirty flags unsaved changes", () => {
    h.service.markDirty();
    expect(h.service.isDirty()).toBe(true);
  });

  describe("start (interval)", () => {
    it("does not save while the project is clean", async () => {
      h.service.start(1000);
      await vi.advanceTimersByTimeAsync(5000);
      expect(h.write).not.toHaveBeenCalled();
      expect(h.saved).not.toHaveBeenCalled();
    });

    it("saves on the tick after markDirty and clears the dirty flag", async () => {
      h.service.start(1000);
      h.service.markDirty();
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.write).toHaveBeenCalledTimes(1);
      expect(h.write).toHaveBeenCalledWith(
        h.serializer.serialize(h.projectData),
      );
      expect(h.service.isDirty()).toBe(false);
      expect(h.saved).toHaveBeenCalledTimes(1);
      expect(h.saved).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "auto" }),
      );
      expect(h.saved.mock.calls[0]?.[0]?.timestamp).toBeGreaterThan(0);
      // Clean again: further ticks stay silent.
      await vi.advanceTimersByTimeAsync(5000);
      expect(h.write).toHaveBeenCalledTimes(1);
    });

    it("uses the 30 s default interval when start() gets no argument (R4.6)", async () => {
      h.service.start();
      h.service.markDirty();
      await vi.advanceTimersByTimeAsync(29_999);
      expect(h.write).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(h.write).toHaveBeenCalledTimes(1);
    });

    it("restarting the timer replaces the previous interval", async () => {
      h.service.start(100);
      h.service.markDirty();
      h.service.start(1000);
      await vi.advanceTimersByTimeAsync(500);
      expect(h.write).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(500);
      expect(h.write).toHaveBeenCalledTimes(1);
    });

    it("does not fire a second save while a previous one is in flight", async () => {
      let release: (ok: boolean) => void = () => {};
      const pending = new Promise<boolean>((resolve) => {
        release = resolve;
      });
      h.write.mockImplementation(() => pending);
      h.service.start(1000);
      h.service.markDirty();
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.write).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(h.write).toHaveBeenCalledTimes(1);
      release(true);
      await flushMicrotasks();
      expect(h.saved).toHaveBeenCalledTimes(1);
    });

    it("stop() halts the periodic saves", async () => {
      h.service.start(1000);
      h.service.markDirty();
      h.service.stop();
      await vi.advanceTimersByTimeAsync(10000);
      expect(h.write).not.toHaveBeenCalled();
    });
  });

  describe("saveNow", () => {
    it("writes the serialized payload, emits persistence:saved and clears the dirty flag", async () => {
      h.service.markDirty();
      const ok = await h.service.saveNow("manual");
      expect(ok).toBe(true);
      expect(h.write).toHaveBeenCalledTimes(1);
      expect(h.write).toHaveBeenCalledWith(
        h.serializer.serialize(h.projectData),
      );
      expect(h.getProjectData).toHaveBeenCalledTimes(1);
      expect(h.service.isDirty()).toBe(false);
      expect(h.failed).not.toHaveBeenCalled();
      expect(h.saved).toHaveBeenCalledTimes(1);
      expect(h.saved).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "manual" }),
      );
      expect(h.saved.mock.calls[0]?.[0]?.timestamp).toBeGreaterThan(0);
    });

    it("saves even when the project is clean (explicit save)", async () => {
      await expect(h.service.saveNow("manual")).resolves.toBe(true);
      expect(h.write).toHaveBeenCalledTimes(1);
      expect(h.service.isDirty()).toBe(false);
    });

    it("defaults the save reason to auto", async () => {
      await h.service.saveNow();
      expect(h.saved).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "auto" }),
      );
    });

    it("reports failure and keeps the dirty flag when the write is rejected", async () => {
      h.write.mockResolvedValue(false);
      h.service.markDirty();
      await expect(h.service.saveNow("manual")).resolves.toBe(false);
      expect(h.saved).not.toHaveBeenCalled();
      expect(h.failed).toHaveBeenCalledTimes(1);
      expect(h.failed).toHaveBeenCalledWith({
        reason: "storage write rejected",
      });
      expect(h.service.isDirty()).toBe(true);
    });

    it("reports failure with the error message when the write throws", async () => {
      h.write.mockRejectedValue(new Error("disk on fire"));
      h.service.markDirty();
      await expect(h.service.saveNow("manual")).resolves.toBe(false);
      expect(h.failed).toHaveBeenCalledTimes(1);
      expect(h.failed).toHaveBeenCalledWith({ reason: "disk on fire" });
      expect(h.service.isDirty()).toBe(true);
    });

    it("reports failure with a generic reason for non-Error rejections", async () => {
      h.write.mockRejectedValue("boom");
      h.service.markDirty();
      await expect(h.service.saveNow("manual")).resolves.toBe(false);
      expect(h.failed).toHaveBeenCalledWith({ reason: "unknown save error" });
      expect(h.service.isDirty()).toBe(true);
    });

    it("skips reentrant calls: a second saveNow while one is in flight returns false", async () => {
      let release: (ok: boolean) => void = () => {};
      const pending = new Promise<boolean>((resolve) => {
        release = resolve;
      });
      h.write.mockImplementation(() => pending);
      const first = h.service.saveNow("manual");
      await expect(h.service.saveNow("manual")).resolves.toBe(false);
      expect(h.write).toHaveBeenCalledTimes(1);
      expect(h.getProjectData).toHaveBeenCalledTimes(1);
      release(true);
      await expect(first).resolves.toBe(true);
      expect(h.write).toHaveBeenCalledTimes(1);
      expect(h.saved).toHaveBeenCalledTimes(1);
    });
  });

  describe("clearStorage", () => {
    it("clears the slot and resets the dirty flag", async () => {
      h.service.markDirty();
      await expect(h.service.clearStorage()).resolves.toBe(true);
      expect(h.clear).toHaveBeenCalledTimes(1);
      expect(h.service.isDirty()).toBe(false);
      expect(h.write).not.toHaveBeenCalled();
    });

    it("propagates a backend failure", async () => {
      h.clear.mockResolvedValue(false);
      await expect(h.service.clearStorage()).resolves.toBe(false);
    });
  });

  describe("attachWindowFlush", () => {
    it("saves when the tab becomes hidden while dirty", async () => {
      h.service.attachWindowFlush();
      h.service.markDirty();
      fakeDocument.dispatchEvent({ type: "visibilitychange" });
      await flushMicrotasks();
      expect(h.write).toHaveBeenCalledTimes(1);
      expect(h.service.isDirty()).toBe(false);
      expect(h.saved).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "flush" }),
      );
    });

    it("saves on beforeunload while dirty", async () => {
      h.service.attachWindowFlush();
      h.service.markDirty();
      fakeWindow.dispatchEvent({ type: "beforeunload" });
      await flushMicrotasks();
      expect(h.write).toHaveBeenCalledTimes(1);
      expect(h.saved).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "flush" }),
      );
    });

    it("does not save when the project is clean", () => {
      h.service.attachWindowFlush();
      fakeDocument.dispatchEvent({ type: "visibilitychange" });
      fakeWindow.dispatchEvent({ type: "beforeunload" });
      expect(h.write).not.toHaveBeenCalled();
      expect(h.saved).not.toHaveBeenCalled();
    });

    it("does not save while a save is already in flight", async () => {
      let release: (ok: boolean) => void = () => {};
      const pending = new Promise<boolean>((resolve) => {
        release = resolve;
      });
      h.write.mockImplementation(() => pending);
      h.service.attachWindowFlush();
      h.service.markDirty();
      fakeDocument.dispatchEvent({ type: "visibilitychange" });
      await flushMicrotasks();
      // The in-flight save owns the write; the second flush must be skipped.
      fakeWindow.dispatchEvent({ type: "beforeunload" });
      await flushMicrotasks();
      expect(h.write).toHaveBeenCalledTimes(1);
      release(true);
      await flushMicrotasks();
      expect(h.saved).toHaveBeenCalledTimes(1);
    });

    it("the returned detacher removes the flush listeners", () => {
      const detach = h.service.attachWindowFlush();
      detach();
      h.service.markDirty();
      fakeDocument.dispatchEvent({ type: "visibilitychange" });
      fakeWindow.dispatchEvent({ type: "beforeunload" });
      expect(h.write).not.toHaveBeenCalled();
    });

    it("stop() detaches the flush listeners", () => {
      h.service.attachWindowFlush();
      h.service.stop();
      h.service.markDirty();
      fakeDocument.dispatchEvent({ type: "visibilitychange" });
      fakeWindow.dispatchEvent({ type: "beforeunload" });
      expect(h.write).not.toHaveBeenCalled();
    });
  });
});
