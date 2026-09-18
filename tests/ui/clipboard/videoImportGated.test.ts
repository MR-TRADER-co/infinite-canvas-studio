// @vitest-environment jsdom
/**
 * Unit tests for the gated import funnel + converted imports
 * (فاز M2 — RM2.5): playable files commit directly, unplayable ones
 * QUEUE for the conversion dialog, unknown ones toast, and the
 * CONVERTED import keeps the original + points at the converted asset.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEventMap } from "@/core/events/EventBus";
import { EventBus } from "@/core/events/EventBus";

// jsdom has no media pipeline — the thumbnail capture would hang until
// its 15s timeout. The gate logic under test only needs the capture to
// RESOLVE (null = film-icon fallback poster), so the service is mocked.
vi.mock("@/media/ThumbnailService", () => ({
  captureVideoThumbnail: async () => null,
}));

import {
  importConvertedVideoFile,
  importOrQueueVideoFiles,
  type VideoImportServices,
} from "@/ui/clipboard/videoImport";
import { useUiStore } from "@/ui/store/uiStore";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { Selection } from "@/core/selection/Selection";
import { Scene } from "@/core/model/Scene";
import { isVideoObject } from "@/core/model/VideoObject";

/** A playable probe (everything "maybe"). */
const playable = () => "maybe" as const;
/** A refusing probe (everything ""). */
const refuses = () => "" as const;

/** Builds a fresh service bundle with a scripted AssetStore. */
function makeServices() {
  const scene = new Scene();
  const bus = new EventBus<AppEventMap>();
  const notices: { messageKey: string; severity: string }[] = [];
  bus.on("ui:notice", (payload) => {
    notices.push({ messageKey: payload.messageKey, severity: payload.severity });
  });
  const written: Blob[] = [];
  let counter = 0;
  const assets = {
    currentProjectPath: () => null,
    setProjectPath: vi.fn(),
    syncProjectPath: vi.fn(async () => ({ relocated: true, missing: [] })),
    writeAsset: vi.fn(async (blob: Blob) => {
      written.push(blob);
      counter += 1;
      return `${counter}`.padStart(64, "0").replace(/ /g, String(counter));
    }),
    exists: vi.fn(async () => true),
    assetUrl: vi.fn(() => "/api/assets/read?hash=x"),
  };
  const services: VideoImportServices = {
    scene,
    history: new HistoryManager(),
    selection: new Selection(),
    ids: new IdGenerator(),
    bus,
    assets,
  };
  return { services, notices, written };
}

beforeEach(() => {
  useUiStore.getState().clearVideoConversions();
  useUiStore.getState().setSnapEnabled(false);
});

describe("importOrQueueVideoFiles (فاز M2 — RM2.5)", () => {
  it("commits playable files directly (the M1 path)", async () => {
    const { services, notices } = makeServices();
    const file = new File([new Uint8Array([1])], "clip.mp4", {
      type: "video/mp4",
    });
    // Stub the DOM-heavy thumbnail capture via the jsdom limitation:
    // jsdom's <video> never loads metadata → captureVideoThumbnail
    // resolves null → the object keeps the film-icon fallback poster.
    const inserted = await importOrQueueVideoFiles(
      services,
      [file],
      { width: 800, height: 600 },
      undefined,
      playable,
    );
    expect(inserted).toBe(1);
    expect(services.scene.objects).toHaveLength(1);
    expect(useUiStore.getState().pendingVideoConversions).toHaveLength(0);
    expect(notices.some((n) => n.messageKey === "video.pastedNotice")).toBe(true);
  });

  it("queues unplayable files for the conversion dialog", async () => {
    const { services } = makeServices();
    const avi = new File([new Uint8Array([1])], "old.avi", {
      type: "video/x-msvideo",
    });
    const inserted = await importOrQueueVideoFiles(
      services,
      [avi],
      { width: 800, height: 600 },
      undefined,
      refuses,
    );
    expect(inserted).toBe(0);
    expect(services.scene.objects).toHaveLength(0);
    const queue = useUiStore.getState().pendingVideoConversions;
    expect(queue).toHaveLength(1);
    expect(queue[0]?.file.name).toBe("old.avi");
  });

  it("splits mixed payloads: direct + queued + toasted", async () => {
    const { services, notices } = makeServices();
    const mp4 = new File([new Uint8Array([1])], "a.mp4", { type: "video/mp4" });
    const mov = new File([new Uint8Array([1])], "b.mov", {
      type: "video/quicktime",
    });
    const junk = new File([new Uint8Array([1])], "c.xyz");
    const inserted = await importOrQueueVideoFiles(
      services,
      [mp4, mov, junk],
      { width: 800, height: 600 },
      undefined,
      refuses,
    );
    expect(inserted).toBe(0);
    // This probe refuses EVERYTHING: the mp4 AND the mov queue; the
    // .xyz toasts; nothing imports.
    expect(
      useUiStore.getState().pendingVideoConversions.map((q) => q.file.name),
    ).toEqual(["a.mp4", "b.mov"]);
    expect(
      notices.some((n) => n.messageKey === "video.unsupportedNotice"),
    ).toBe(true);
    expect(useUiStore.getState().pendingVideoConversions).toHaveLength(2);
  });
});

describe("importConvertedVideoFile (فاز M2 — A.2.5)", () => {
  it("keeps the ORIGINAL and points at the converted asset", async () => {
    const { services } = makeServices();
    const original = new File([new Uint8Array([9, 9])], "legacy.avi", {
      type: "video/x-msvideo",
    });
    const converted = new File([new Uint8Array([1, 2, 3, 4])], "converted.mp4", {
      type: "video/mp4",
    });
    const ok = await importConvertedVideoFile(services, original, converted, {
      width: 800,
      height: 600,
    });
    expect(ok).toBe(true);
    const object = services.scene.objects[0];
    expect(object).toBeDefined();
    if (object === undefined || !isVideoObject(object)) {
      throw new Error("expected a video object");
    }
    // originalName preserved; the object plays the CONVERTED mp4.
    expect(object.originalName).toBe("legacy.avi");
    expect(object.mimeType).toBe("video/mp4");
    // BOTH files were written (original + converted), distinct hashes.
    expect(services.assets.writeAsset).toHaveBeenCalledTimes(2);
    // The kept original's hash rides the object (A.2.5).
    expect(typeof object.origAssetHash).toBe("string");
    expect(object.origAssetHash).not.toBeNull();
    expect(object.origAssetHash).not.toBe(object.assetHash);
  });

  it("fails cleanly when the store write fails (nothing commits)", async () => {
    const { services, notices } = makeServices();
    services.assets.writeAsset = vi.fn(async () => null);
    const ok = await importConvertedVideoFile(
      services,
      new File([new Uint8Array([1])], "x.avi"),
      new File([new Uint8Array([2])], "y.mp4"),
      { width: 800, height: 600 },
    );
    expect(ok).toBe(false);
    expect(services.scene.objects).toHaveLength(0);
    expect(notices.some((n) => n.messageKey === "video.importFailedNotice")).toBe(
      true,
    );
  });
});
