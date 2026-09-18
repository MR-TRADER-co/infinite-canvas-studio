"use client";

/**
 * The VIDEO import pipeline (فاز M1 — RM1.3): the single funnel every
 * gesture — the «درج ویدئو…» file dialog, Explorer drag-and-drop and
 * clipboard paste — flows through, mirroring `canvasImport.ts`'s image
 * machinery gesture-for-gesture:
 *
 * 1. the ORIGINAL file is written into the sidecar AssetStore under its
 *    SHA-256 hash (identical imports dedupe — ACM1.4);
 * 2. the thumbnail service captures the poster frame + duration +
 *    dimensions (a failed capture keeps a VALID object with the
 *    film-icon fallback poster, A.2.2);
 * 3. the object commits through the SHARED placement core
 *    ({@link pastePlacementPosition} — the exact image rules of A.2.10:
 *    viewport centre or drop point, burst cascade, grid snap), one
 *    `AddObjectCommand`, auto-select and the Persian notice.
 *
 * Truly unknown extensions never reach here (the gesture classifiers
 * reject them with the Persian toast); the offline conversion gate for
 * unplayable-but-known containers arrives in Phase M2 (RM2.5).
 */
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import type { ImportServices } from "@/ui/clipboard/canvasImport";
import {
  PASTE_VIEWPORT_SPAN,
  pastePlacementPosition,
} from "@/ui/clipboard/canvasImport";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import {
  createVideoObject,
  placedVideoSize,
} from "@/core/model/VideoObject";
import type { AssetStore } from "@/persistence/AssetStore";
import { captureVideoThumbnail } from "@/media/ThumbnailService";
import {
  classifyVideoFiles,
  mimeTypeForVideoFile,
} from "@/media/videoFormats";
import {
  domPlayabilityProbe,
  routeVideoFile,
  type PlayabilityProbe,
} from "@/media/FormatProbe";
import { useUiStore } from "@/ui/store/uiStore";

/** The scene + asset services a video import commit needs (DI style). */
export interface VideoImportServices extends ImportServices {
  /** The sidecar AssetStore owning the video bytes. */
  readonly assets: AssetStore;
}

/** One prepared (stored + thumbnailed) video import. */
export interface PreparedVideoImport {
  readonly assetHash: string;
  readonly thumbHash: string | null;
  readonly originalName: string;
  readonly mimeType: string;
  readonly durationMs: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  /** The KEPT original's hash (M2 conversions). */
  readonly origAssetHash?: string;
}

export { classifyVideoFiles };

/**
 * The gated import funnel (فاز M2 — RM2.5): routes every video
 * candidate through the FormatProbe — playable files import directly
 * (the M1 path); files the browser cannot play QUEUE for the offline
 * conversion dialog (A.2.4); truly unknown extensions toast and create
 * nothing.
 *
 * @param services - the scene + asset services.
 * @param files - the video CANDIDATES (accepted-extension files AND
 *        video-typed foreign containers — both are the gate's input).
 * @param surfaceRect - the viewport rect for placement.
 * @param at - optional world centre (the drop point).
 * @param probe - the playability probe (injectable for tests; defaults
 *        to the DOM probe).
 * @returns how many objects imported directly (queued conversions are
 *          the dialog's business).
 */
export async function importOrQueueVideoFiles(
  services: VideoImportServices,
  files: readonly File[],
  surfaceRect: { readonly width: number; readonly height: number } | null,
  at?: Vec2,
  probe: PlayabilityProbe = domPlayabilityProbe(),
): Promise<number> {
  const queue: { file: File; at?: Vec2 }[] = [];
  let inserted = 0;
  for (const file of files) {
    const route = routeVideoFile(file, probe);
    if (route.kind === "unknown") {
      services.bus.emit("ui:notice", {
        messageKey: "video.unsupportedNotice",
        severity: "error",
      });
      continue;
    }
    if (route.kind === "convert") {
      queue.push({ file, at });
      continue;
    }
    const prepared = await prepareVideoAsset(services.assets, file);
    if (prepared === null) {
      services.bus.emit("ui:notice", {
        messageKey: "video.importFailedNotice",
        severity: "error",
      });
      continue;
    }
    if (commitVideoObject(services, prepared, surfaceRect, at)) {
      inserted += 1;
    }
  }
  if (queue.length > 0) {
    useUiStore.getState().queueVideoConversions(queue);
  }
  return inserted;
}

/**
 * Imports one CONVERTED video (فاز M2 — A.2.5): the ORIGINAL file is
 * kept in the sidecar (`origAssetHash`), the object points at the
 * CONVERTED asset, the poster is captured from the converted file and
 * the original file name is preserved for display.
 *
 * @param services - the scene + asset services.
 * @param original - the ORIGINAL file (kept verbatim).
 * @param converted - the offline-converted MP4.
 * @param surfaceRect - the viewport rect for placement.
 * @param at - optional world centre (the original drop point).
 * @returns whether the object was committed.
 */
export async function importConvertedVideoFile(
  services: VideoImportServices,
  original: File,
  converted: File,
  surfaceRect: { readonly width: number; readonly height: number } | null,
  at?: Vec2,
): Promise<boolean> {
  const origAssetHash = await services.assets.writeAsset(original);
  const assetHash = await services.assets.writeAsset(converted);
  if (origAssetHash === null || assetHash === null) {
    services.bus.emit("ui:notice", {
      messageKey: "video.importFailedNotice",
      severity: "error",
    });
    return false;
  }
  const thumbnail = await captureVideoThumbnail(converted);
  const thumbHash =
    thumbnail !== null ? await services.assets.writeAsset(thumbnail.blob) : null;
  return commitVideoObject(
    services,
    {
      assetHash,
      thumbHash,
      originalName: original.name,
      mimeType: "video/mp4",
      durationMs: thumbnail?.durationMs ?? 0,
      naturalWidth: thumbnail?.width ?? 0,
      naturalHeight: thumbnail?.height ?? 0,
      origAssetHash,
    },
    surfaceRect,
    at,
  );
}

/**
 * Stores one video file + captures its thumbnail (steps 1–2 of the
 * pipeline). A failed thumbnail keeps a valid import (null poster); a
 * failed STORE aborts this file (the object would render as missing).
 *
 * @param assets - the sidecar AssetStore.
 * @param file - the accepted video file.
 * @returns the prepared import, or null when the store write failed.
 */
export async function prepareVideoAsset(
  assets: AssetStore,
  file: File,
): Promise<PreparedVideoImport | null> {
  const assetHash = await assets.writeAsset(file);
  if (assetHash === null) {
    return null;
  }
  const thumbnail = await captureVideoThumbnail(file);
  const thumbHash =
    thumbnail !== null ? await assets.writeAsset(thumbnail.blob) : null;
  return {
    assetHash,
    thumbHash,
    originalName: file.name,
    mimeType: mimeTypeForVideoFile(file),
    durationMs: thumbnail?.durationMs ?? 0,
    naturalWidth: thumbnail?.width ?? 0,
    naturalHeight: thumbnail?.height ?? 0,
  };
}

/**
 * Commits one prepared video at the visible viewport centre — or an
 * exact world point (the drop point): the SHARED image placement rules
 * (A.2.10), one `AddObjectCommand` (one undo step), auto-select and the
 * Persian notice.
 *
 * @param services - the scene + asset services committing the object.
 * @param prepared - the stored + thumbnailed import.
 * @param surfaceRect - the viewport rect (client size); falls back to
 *        800×600 when unavailable.
 * @param at - optional world centre overriding the viewport centre.
 * @returns whether the object was committed.
 */
export function commitVideoObject(
  services: VideoImportServices,
  prepared: PreparedVideoImport,
  surfaceRect: { readonly width: number; readonly height: number } | null,
  at?: Vec2,
): boolean {
  const { scene, history, selection, ids, bus } = services;
  const camera = scene.camera;
  const rect =
    surfaceRect !== null ? surfaceRect : { width: 800, height: 600 };
  const centerScreen = vec2(rect.width / 2, rect.height / 2);
  const centerWorld =
    at !== undefined ? at : camera.screenToWorld(centerScreen);
  const visibleSpan = Math.max(
    1,
    Math.min(rect.width / camera.zoom, rect.height / camera.zoom),
  );
  const intrinsic = {
    width: prepared.naturalWidth > 0 ? prepared.naturalWidth : 640,
    height: prepared.naturalHeight > 0 ? prepared.naturalHeight : 360,
  };
  const placed = placedVideoSize(intrinsic, visibleSpan * PASTE_VIEWPORT_SPAN);
  const position = pastePlacementPosition(centerWorld, placed);
  const object = createVideoObject(ids.next(), prepared, position, placed, scene.nextZIndex());
  const command = new AddObjectCommand(scene, object);
  command.do();
  history.push(command);
  selection.replaceAll([object.id]);
  bus.emit("ui:notice", {
    messageKey: "video.pastedNotice",
    severity: "info",
  });
  return true;
}

/**
 * Imports a batch of accepted video files through the ONE pipeline
 * (store → thumbnail → commit). Unknown-extension rejection toasts are
 * the GESTURE bridge's job (`classifyVideoFiles` + the notice); this
 * function only receives already-accepted files.
 *
 * @param services - the scene + asset services.
 * @param files - the accepted video files (payload order).
 * @param surfaceRect - the viewport rect for placement.
 * @param at - optional world centre (the drop point).
 * @returns how many objects were committed.
 */
export async function importVideoFiles(
  services: VideoImportServices,
  files: readonly File[],
  surfaceRect: { readonly width: number; readonly height: number } | null,
  at?: Vec2,
): Promise<number> {
  let inserted = 0;
  for (const file of files) {
    const prepared = await prepareVideoAsset(services.assets, file);
    if (prepared === null) {
      services.bus.emit("ui:notice", {
        messageKey: "video.importFailedNotice",
        severity: "error",
      });
      continue;
    }
    if (commitVideoObject(services, prepared, surfaceRect, at)) {
      inserted += 1;
    }
  }
  return inserted;
}
