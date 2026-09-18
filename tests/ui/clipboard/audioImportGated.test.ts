// @vitest-environment jsdom
/**
 * The A2 import-GATE unit tests (فاز A2 — RA2.5): the funnel routes
 * playable files straight in, queues wav/flac (+ mislabels) for the
 * conversion dialog, and rejects unknown extensions with the Persian
 * toast — verified with stub services + a stubbed waveform generator.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEventMap } from "@/core/events/EventBus";
import { EventBus } from "@/core/events/EventBus";
import {
  importOrQueueAudioFiles,
  type AudioImportServices,
} from "@/ui/clipboard/audioImport";
import { resetPasteCascade } from "@/ui/clipboard/canvasImport";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { Selection } from "@/core/selection/Selection";
import { Scene } from "@/core/model/Scene";
import { useUiStore } from "@/ui/store/uiStore";
import type { AssetStore } from "@/persistence/AssetStore";

vi.mock("@/media/WaveformGenerator", () => ({
  generateAudioWaveform: vi.fn(async () => ({
    blob: new Blob([new Uint8Array([1])], { type: "image/jpeg" }),
    thumbWidth: 480,
    thumbHeight: 160,
    durationMs: 5000,
  })),
}));

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
  return { services, notices };
}

beforeEach(() => {
  resetPasteCascade();
  useUiStore.getState().setSnapEnabled(false);
  useUiStore.getState().clearAudioConversions();
});

describe("importOrQueueAudioFiles (فاز A2 — RA2.5, the gate)", () => {
  it("playable files import DIRECTLY (probe probably)", async () => {
    const { services } = makeServices();
    const file = new File([new Uint8Array([1])], "song.mp3", {
      type: "audio/mpeg",
    });
    const inserted = await importOrQueueAudioFiles(
      services,
      [file],
      { width: 1000, height: 700 },
      undefined,
      () => "probably",
    );
    expect(inserted).toBe(1);
    expect(services.scene.objects).toHaveLength(1);
    expect(useUiStore.getState().pendingAudioConversions).toHaveLength(0);
  });

  it("wav/flac QUEUE for the conversion dialog (never an object yet)", async () => {
    const { services } = makeServices();
    const wav = new File([new Uint8Array([1])], "tone.wav", { type: "audio/wav" });
    const flac = new File([new Uint8Array([2])], "voice.flac", { type: "audio/flac" });
    const inserted = await importOrQueueAudioFiles(
      services,
      [wav, flac],
      null,
      undefined,
      () => "probably",
    );
    expect(inserted).toBe(0);
    expect(services.scene.objects).toHaveLength(0);
    const queue = useUiStore.getState().pendingAudioConversions;
    expect(queue).toHaveLength(2);
    expect(queue[0]?.file.name).toBe("tone.wav");
    expect(queue[1]?.file.name).toBe("voice.flac");
  });

  it("a video-typed mislabel (renamed .mp4) queues for conversion (-vn)", async () => {
    const { services } = makeServices();
    const fake = new File([new Uint8Array([3])], "fake.mp3", { type: "video/mp4" });
    await importOrQueueAudioFiles(
      services,
      [fake],
      null,
      undefined,
      () => "probably",
    );
    expect(useUiStore.getState().pendingAudioConversions).toHaveLength(1);
  });

  it("unknown extensions toast and create NOTHING", async () => {
    const { services, notices } = makeServices();
    const file = new File([new Uint8Array([1])], "weird.xyz", {
      type: "application/octet-stream",
    });
    const inserted = await importOrQueueAudioFiles(
      services,
      [file],
      null,
      undefined,
      () => "probably",
    );
    expect(inserted).toBe(0);
    expect(services.scene.objects).toHaveLength(0);
    expect(notices).toEqual([
      { messageKey: "audio.unsupportedNotice", severity: "error" },
    ]);
    expect(useUiStore.getState().pendingAudioConversions).toHaveLength(0);
  });

  it("a probe-refused direct file queues (probe \"\" ⇒ convert)", async () => {
    const { services } = makeServices();
    const file = new File([new Uint8Array([1])], "odd.m4a", { type: "audio/mp4" });
    await importOrQueueAudioFiles(
      services,
      [file],
      null,
      undefined,
      () => "",
    );
    expect(useUiStore.getState().pendingAudioConversions).toHaveLength(1);
  });
});
