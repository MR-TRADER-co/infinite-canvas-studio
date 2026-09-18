// @vitest-environment jsdom
/**
 * Unit tests for the audio import commit path (فاز A1 — RA1.3):
 * the SHARED placement rules (viewport-centre + cascade + snap, A.2.10),
 * ONE undo step per object, auto-select and the Persian notice — with a
 * stubbed AssetStore + a stubbed waveform generator.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEventMap } from "@/core/events/EventBus";
import { EventBus } from "@/core/events/EventBus";
import {
  commitAudioObject,
  importAudioFiles,
  type AudioImportServices,
  type PreparedAudioImport,
} from "@/ui/clipboard/audioImport";
import {
  resetPasteCascade,
  currentCascadeOffset,
} from "@/ui/clipboard/canvasImport";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { Selection } from "@/core/selection/Selection";
import { Scene } from "@/core/model/Scene";
import { useUiStore } from "@/ui/store/uiStore";
import { isAudioObject, type AudioObjectData } from "@/core/model/AudioObject";
import type { AssetStore } from "@/persistence/AssetStore";

vi.mock("@/media/WaveformGenerator", () => ({
  generateAudioWaveform: vi.fn(async () => ({
    blob: new Blob([new Uint8Array([1])], { type: "image/jpeg" }),
    thumbWidth: 480,
    thumbHeight: 160,
    durationMs: 5000,
  })),
}));

/** One prepared import (waveform generated, 5s). */
const PREPARED: PreparedAudioImport = {
  assetHash: "a".repeat(64),
  thumbHash: "b".repeat(64),
  originalName: "clip.mp3",
  mimeType: "audio/mpeg",
  durationMs: 5000,
};

/** Builds a fresh service bundle with a stubbed AssetStore. */
function makeServices() {
  const scene = new Scene();
  const bus = new EventBus<AppEventMap>();
  const notices: { messageKey: string; severity: string }[] = [];
  bus.on("ui:notice", (payload) => {
    notices.push({ messageKey: payload.messageKey, severity: payload.severity });
  });
  const assets = {
    currentProjectPath: () => null,
    setProjectPath: vi.fn(),
    syncProjectPath: vi.fn(async () => ({ relocated: true, missing: [] })),
    writeAsset: vi.fn(async () => "a".repeat(64)),
    exists: vi.fn(async () => true),
    assetUrl: vi.fn(() => "/api/assets/read?hash=x"),
  } satisfies AssetStore;
  const services: AudioImportServices = {
    scene,
    history: new HistoryManager(),
    selection: new Selection(),
    ids: new IdGenerator(),
    bus,
    assets,
  };
  return { services, notices, assets };
}

beforeEach(() => {
  resetPasteCascade();
  useUiStore.getState().setSnapEnabled(false);
});

/** The scene's first object, asserted to be audio. */
function firstAudio(services: AudioImportServices): AudioObjectData {
  const object = services.scene.objects[0];
  expect(object).toBeDefined();
  if (object === undefined) {
    throw new Error("expected an object");
  }
  expect(isAudioObject(object)).toBe(true);
  if (!isAudioObject(object)) {
    throw new Error("expected an audio object");
  }
  return object;
}

describe("commitAudioObject (فاز A1 — RA1.3)", () => {
  it("commits one object at the viewport centre with the image placement rule", () => {
    const { services, notices } = makeServices();
    // 1000×700 viewport at zoom 1 → visibleSpan 700 → 45% = 315 span;
    // the 3:1 chip → height 105.
    const ok = commitAudioObject(services, PREPARED, {
      width: 1000,
      height: 700,
    });
    expect(ok).toBe(true);
    const object = firstAudio(services);
    expect(object.width).toBe(315);
    expect(object.height).toBe(105);
    const camera = services.scene.camera;
    const centreWorld = camera.screenToWorld({ x: 500, y: 350 });
    expect(object.position.x + object.width / 2).toBeCloseTo(centreWorld.x, 0);
    expect(object.position.y + object.height / 2).toBeCloseTo(centreWorld.y, 0);
    // Auto-selected.
    expect(services.selection.ids).toContain(object.id);
    // The Persian notice fired once.
    expect(notices).toEqual([
      { messageKey: "audio.pastedNotice", severity: "info" },
    ]);
    // ONE undo step removes it entirely.
    expect(services.history.canUndo()).toBe(true);
    services.history.undo();
    expect(services.scene.objects).toHaveLength(0);
  });

  it("cascades a burst import (the shared offset rule)", () => {
    const { services } = makeServices();
    commitAudioObject(services, PREPARED, { width: 1000, height: 700 });
    commitAudioObject(services, PREPARED, { width: 1000, height: 700 });
    const first = firstAudio(services);
    const second = services.scene.objects[1];
    expect(second).toBeDefined();
    if (second === undefined || !isAudioObject(second)) {
      throw new Error("expected a second audio object");
    }
    // Two commits later the cascade module has advanced two 28px steps;
    // the objects themselves sit exactly ONE step apart.
    expect(currentCascadeOffset()).toBe(2 * 28);
    expect(second.position.x - first.position.x).toBeCloseTo(28, 3);
    expect(second.position.y - first.position.y).toBeCloseTo(28, 3);
  });

  it("lands on the exact drop point when provided", () => {
    const { services } = makeServices();
    commitAudioObject(services, PREPARED, { width: 1000, height: 700 }, {
      x: 42,
      y: 24,
    });
    const object = firstAudio(services);
    expect(object.position.x + object.width / 2).toBeCloseTo(42, 0);
    expect(object.position.y + object.height / 2).toBeCloseTo(24, 0);
  });
});

describe("importAudioFiles (فاز A1 — the ONE pipeline)", () => {
  it("stores, waveforms and commits each file; toasts on store failure", async () => {
    const { services, notices, assets } = makeServices();
    (assets.writeAsset as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("c".repeat(64))
      .mockResolvedValueOnce("d".repeat(64))
      .mockResolvedValueOnce(null);
    const file = new File([new Uint8Array([1, 2, 3])], "song.mp3", {
      type: "audio/mpeg",
    });
    const inserted = await importAudioFiles(services, [file], {
      width: 1000,
      height: 700,
    });
    expect(inserted).toBe(1);
    expect(services.scene.objects).toHaveLength(1);
    // writeAsset: audio bytes + waveform poster.
    expect(assets.writeAsset).toHaveBeenCalledTimes(2);
    expect(notices).toEqual([
      { messageKey: "audio.pastedNotice", severity: "info" },
    ]);
  });

  it("a failed store write aborts the file with the Persian error", async () => {
    const { services, notices, assets } = makeServices();
    (assets.writeAsset as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const file = new File([new Uint8Array([1])], "bad.mp3", {
      type: "audio/mpeg",
    });
    const inserted = await importAudioFiles(services, [file], null);
    expect(inserted).toBe(0);
    expect(services.scene.objects).toHaveLength(0);
    expect(notices).toEqual([
      { messageKey: "audio.importFailedNotice", severity: "error" },
    ]);
  });
});
