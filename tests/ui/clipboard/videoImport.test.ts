// @vitest-environment jsdom
/**
 * Unit tests for the video import commit path (فاز M1 — RM1.3):
 * the SHARED placement rules (viewport-centre + cascade + snap, A.2.10),
 * ONE undo step per object, auto-select and the Persian notice — with a
 * stubbed AssetStore (the byte-level store has its own suite).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEventMap } from "@/core/events/EventBus";
import { EventBus } from "@/core/events/EventBus";
import {
  commitVideoObject,
  type PreparedVideoImport,
  type VideoImportServices,
} from "@/ui/clipboard/videoImport";
import {
  resetPasteCascade,
  currentCascadeOffset,
} from "@/ui/clipboard/canvasImport";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { Selection } from "@/core/selection/Selection";
import { Scene } from "@/core/model/Scene";
import { useUiStore } from "@/ui/store/uiStore";
import { isVideoObject, type VideoObjectData } from "@/core/model/VideoObject";

/** One prepared import (1920×1080, 61.5s — thumbnail captured). */
const PREPARED: PreparedVideoImport = {
  assetHash: "a".repeat(64),
  thumbHash: "b".repeat(64),
  originalName: "clip.mp4",
  mimeType: "video/mp4",
  durationMs: 61_500,
  naturalWidth: 1920,
  naturalHeight: 1080,
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
  };
  const services: VideoImportServices = {
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
});

/** The scene's first object, asserted to be a video. */
function firstVideo(services: VideoImportServices): VideoObjectData {
  const object = services.scene.objects[0];
  expect(object).toBeDefined();
  if (object === undefined) {
    throw new Error("expected an object");
  }
  expect(isVideoObject(object)).toBe(true);
  if (!isVideoObject(object)) {
    throw new Error("expected a video object");
  }
  return object;
}

describe("commitVideoObject (فاز M1 — RM1.3)", () => {
  it("commits one object at the viewport centre with the image placement rule", () => {
    const { services, notices } = makeServices();
    // 1000×700 viewport at zoom 1 → visibleSpan 700 → 45% = 315 span.
    const ok = commitVideoObject(services, PREPARED, {
      width: 1000,
      height: 700,
    });
    expect(ok).toBe(true);
    const object = firstVideo(services);
    expect(object.width).toBe(315);
    expect(object.height).toBe(Math.round(315 * (1080 / 1920)));
    // Centred (the placed size is ROUNDED — half-unit tolerance):
    // position + half size == the viewport centre in world space.
    const camera = services.scene.camera;
    const centreWorld = camera.screenToWorld({ x: 500, y: 350 });
    expect(object.position.x + object.width / 2).toBeCloseTo(centreWorld.x, 0);
    expect(object.position.y + object.height / 2).toBeCloseTo(centreWorld.y, 0);
    // One undo step removes it entirely.
    expect(services.history.canUndo()).toBe(true);
    services.history.undo();
    expect(services.scene.objects).toHaveLength(0);
    // Auto-selected + the Persian notice.
    expect(services.selection.ids).toContain(object.id);
    expect(notices).toEqual([
      { messageKey: "video.pastedNotice", severity: "info" },
    ]);
  });

  it("commits at the EXACT drop point when one is provided", () => {
    const { services } = makeServices();
    commitVideoObject(services, PREPARED, { width: 800, height: 600 }, {
      x: 1000,
      y: 500,
    });
    const object = firstVideo(services);
    expect(object.position.x + object.width / 2).toBeCloseTo(1000, 0);
    expect(object.position.y + object.height / 2).toBeCloseTo(500, 0);
  });

  it("cascades successive commits (the shared burst stream with images)", () => {
    const { services } = makeServices();
    commitVideoObject(services, PREPARED, { width: 800, height: 600 });
    commitVideoObject(services, PREPARED, { width: 800, height: 600 });
    const first = firstVideo(services);
    const secondRaw = services.scene.objects[1];
    expect(secondRaw).toBeDefined();
    if (secondRaw === undefined || !isVideoObject(secondRaw)) {
      return;
    }
    expect(currentCascadeOffset()).toBe(2 * 28);
    // The second object's top-left sits one cascade step right/below
    // where a first-slot commit would have landed.
    expect(secondRaw.position.x - first.position.x).toBeCloseTo(28, 3);
    expect(secondRaw.position.y - first.position.y).toBeCloseTo(28, 3);
  });

  it("keeps the metadata + hashes on the committed object", () => {
    const { services } = makeServices();
    commitVideoObject(services, PREPARED, { width: 800, height: 600 });
    const object = firstVideo(services);
    expect(object.assetHash).toBe(PREPARED.assetHash);
    expect(object.thumbHash).toBe(PREPARED.thumbHash);
    expect(object.originalName).toBe("clip.mp4");
    expect(object.durationMs).toBe(61_500);
    expect(object.naturalWidth).toBe(1920);
    expect(object.mimeType).toBe("video/mp4");
    expect(object.rotation).toBe(0);
    expect(object.visible).toBe(true);
  });

  it("falls back to the default intrinsic size when capture failed (thumbHash null)", () => {
    const { services } = makeServices();
    const broken: PreparedVideoImport = {
      ...PREPARED,
      thumbHash: null,
      naturalWidth: 0,
      naturalHeight: 0,
    };
    commitVideoObject(services, broken, { width: 800, height: 600 });
    const object = firstVideo(services);
    expect(object.thumbHash).toBeNull();
    expect(object.naturalWidth).toBe(640);
    expect(object.naturalHeight).toBe(360);
    // The placed size still follows the span rule on the fallback dims.
    expect(object.width).toBe(270);
    expect(object.height).toBe(Math.round(270 * (360 / 640)));
  });
});
