"use client";

/**
 * The AUDIO import pipeline (فاز A1 — RA1.3): the single funnel every
 * gesture — the «درج صوت…» file dialog, Explorer drag-and-drop and
 * clipboard paste — flows through, mirroring `videoImport.ts`'s
 * machinery gesture-for-gesture:
 *
 * 1. the ORIGINAL file is written into the sidecar AssetStore under its
 *    SHA-256 hash (identical imports dedupe — ACA1.4);
 * 2. the WaveformGenerator decodes the clip and renders the waveform
 *    JPEG + duration (a failed generation keeps a VALID object with the
 *    audio-note fallback plate, A.2.2 Attempt 2);
 * 3. the object commits through the SHARED placement core
 *    ({@link pastePlacementPosition} — the exact image/video rules of
 *    A.2.10: viewport centre or drop point, burst cascade, grid snap),
 *    one `AddObjectCommand`, auto-select and the Persian notice.
 *
 * Truly unknown extensions never reach here (the gesture classifiers
 * reject them with the Persian toast); the offline conversion gate for
 * wav/flac arrives in Phase A2 (RM2.5's twin — the funnel is structured
 * so the gate slots in without touching the commit path).
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
  AUDIO_FALLBACK_INTRINSIC,
  createAudioObject,
  placedAudioSize,
} from "@/core/model/AudioObject";
import type { AssetStore } from "@/persistence/AssetStore";
import { generateAudioWaveform } from "@/media/WaveformGenerator";
import {
  domAudioPlayabilityProbe,
  routeAudioFile,
  type PlayabilityProbe,
} from "@/media/FormatProbe";
import {
  classifyAudioFiles,
  mimeTypeForAudioFile,
} from "@/media/audioFormats";
import { useUiStore } from "@/ui/store/uiStore";

/** The scene + asset services an audio import commit needs (DI style). */
export interface AudioImportServices extends ImportServices {
  /** The sidecar AssetStore owning the audio bytes. */
  readonly assets: AssetStore;
}

/** One prepared (stored + waveformed) audio import. */
export interface PreparedAudioImport {
  readonly assetHash: string;
  readonly thumbHash: string | null;
  readonly originalName: string;
  readonly mimeType: string;
  readonly durationMs: number;
  /** The KEPT original's hash (A2 conversions). */
  readonly origAssetHash?: string;
}

export { classifyAudioFiles };

/**
 * Imports a batch of accepted audio files through the ONE pipeline
 * (store → waveform → commit). Unknown-extension rejection toasts are
 * the GESTURE bridge's job (`classifyAudioFiles` + the notice); this
 * function only receives already-accepted files.
 *
 * @param services - the scene + asset services.
 * @param files - the accepted audio files (payload order).
 * @param surfaceRect - the viewport rect for placement.
 * @param at - optional world centre (the drop point).
 * @returns how many objects were committed.
 */
export async function importAudioFiles(
  services: AudioImportServices,
  files: readonly File[],
  surfaceRect: { readonly width: number; readonly height: number } | null,
  at?: Vec2,
): Promise<number> {
  let inserted = 0;
  for (const file of files) {
    const prepared = await prepareAudioAsset(services.assets, file);
    if (prepared === null) {
      services.bus.emit("ui:notice", {
        messageKey: "audio.importFailedNotice",
        severity: "error",
      });
      continue;
    }
    if (commitAudioObject(services, prepared, surfaceRect, at)) {
      inserted += 1;
      if (prepared.thumbHash === null) {
        // A corrupt/undecodable clip still lands (A.2.2 Attempt 2) —
        // but the artist hears WHY the plate is an icon (fixture d).
        services.bus.emit("ui:notice", {
          messageKey: "audio.waveformFailedNotice",
          severity: "error",
        });
      }
    }
  }
  return inserted;
}

/**
 * Imports one CONVERTED audio clip (فاز A2 — A.2.5): the ORIGINAL file
 * is kept in the sidecar (`origAssetHash`), the object points at the
 * CONVERTED MP3 asset, the waveform is regenerated from the converted
 * file and the original file name is preserved for display.
 *
 * @param services - the scene + asset services.
 * @param original - the ORIGINAL file (kept verbatim).
 * @param converted - the offline-converted MP3.
 * @param surfaceRect - the viewport rect for placement.
 * @param at - optional world centre (the original drop point).
 * @returns whether the object was committed.
 */
export async function importConvertedAudioFile(
  services: AudioImportServices,
  original: File,
  converted: File,
  surfaceRect: { readonly width: number; readonly height: number } | null,
  at?: Vec2,
): Promise<boolean> {
  const origAssetHash = await services.assets.writeAsset(original);
  const assetHash = await services.assets.writeAsset(converted);
  if (origAssetHash === null || assetHash === null) {
    services.bus.emit("ui:notice", {
      messageKey: "audio.importFailedNotice",
      severity: "error",
    });
    return false;
  }
  const waveform = await generateAudioWaveform(converted);
  const thumbHash =
    waveform !== null ? await services.assets.writeAsset(waveform.blob) : null;
  return commitAudioObject(
    services,
    {
      assetHash,
      thumbHash,
      originalName: original.name,
      mimeType: "audio/mpeg",
      durationMs: waveform?.durationMs ?? 0,
      origAssetHash,
    },
    surfaceRect,
    at,
  );
}

/**
 * Stores one audio file + generates its waveform thumbnail (steps 1–2 of
 * the pipeline). A failed waveform keeps a valid import (null poster);
 * a failed STORE aborts this file (the object would render as missing).
 *
 * @param assets - the sidecar AssetStore.
 * @param file - the accepted audio file.
 * @returns the prepared import, or null when the store write failed.
 */
export async function prepareAudioAsset(
  assets: AssetStore,
  file: File,
): Promise<PreparedAudioImport | null> {
  const assetHash = await assets.writeAsset(file);
  if (assetHash === null) {
    return null;
  }
  const waveform = await generateAudioWaveform(file);
  const thumbHash =
    waveform !== null ? await assets.writeAsset(waveform.blob) : null;
  return {
    assetHash,
    thumbHash,
    originalName: file.name,
    mimeType: mimeTypeForAudioFile(file),
    durationMs: waveform?.durationMs ?? 0,
  };
}

/**
 * Commits one prepared audio clip at the visible viewport centre — or
 * an exact world point (the drop point): the SHARED image/video
 * placement rules (A.2.10), one `AddObjectCommand` (one undo step),
 * auto-select and the Persian notice.
 *
 * @param services - the scene + asset services committing the object.
 * @param prepared - the stored + waveformed import.
 * @param surfaceRect - the viewport rect (client size); falls back to
 *        800×600 when unavailable.
 * @param at - optional world centre overriding the viewport centre.
 * @returns whether the object was committed.
 */
export function commitAudioObject(
  services: AudioImportServices,
  prepared: PreparedAudioImport,
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
  // The waveform chip's intrinsic 3:1 footprint (the fallback plate
  // shares it — the placed size never jitters when a poster is absent).
  const intrinsic = {
    width: AUDIO_FALLBACK_INTRINSIC.width,
    height: AUDIO_FALLBACK_INTRINSIC.height,
  };
  const placed = placedAudioSize(intrinsic, visibleSpan * PASTE_VIEWPORT_SPAN);
  const position = pastePlacementPosition(centerWorld, placed);
  const object = createAudioObject(ids.next(), prepared, position, placed, scene.nextZIndex());
  const command = new AddObjectCommand(scene, object);
  command.do();
  history.push(command);
  selection.replaceAll([object.id]);
  bus.emit("ui:notice", {
    messageKey: "audio.pastedNotice",
    severity: "info",
  });
  return true;
}

/**
 * The gated import funnel (فاز A2 — RA2.5/A.2.4): routes every audio
 * candidate through the FormatProbe — playable files import directly
 * (the A1 path); `.wav`/`.flac` (and probe-refused or video-typed
 * mislabels) QUEUE for the offline conversion dialog; truly unknown
 * extensions toast and create nothing.
 *
 * @param services - the scene + asset services.
 * @param files - the audio CANDIDATES (accepted-extension files AND
 *        audio-typed foreign containers — both are the gate's input).
 * @param surfaceRect - the viewport rect for placement.
 * @param at - optional world centre (the drop point).
 * @param probe - the playability probe (injectable for tests; defaults
 *        to the detached-`<audio>` DOM probe).
 * @returns how many objects imported directly (queued conversions are
 *          the dialog's business).
 */
export async function importOrQueueAudioFiles(
  services: AudioImportServices,
  files: readonly File[],
  surfaceRect: { readonly width: number; readonly height: number } | null,
  at?: Vec2,
  probe: PlayabilityProbe = domAudioPlayabilityProbe(),
): Promise<number> {
  const queue: { file: File; at?: Vec2 }[] = [];
  let inserted = 0;
  for (const file of files) {
    const route = routeAudioFile(file, probe);
    if (route.kind === "unknown") {
      services.bus.emit("ui:notice", {
        messageKey: "audio.unsupportedNotice",
        severity: "error",
      });
      continue;
    }
    if (route.kind === "convert") {
      queue.push({ file, at });
      continue;
    }
    const prepared = await prepareAudioAsset(services.assets, file);
    if (prepared === null) {
      services.bus.emit("ui:notice", {
        messageKey: "audio.importFailedNotice",
        severity: "error",
      });
      continue;
    }
    if (commitAudioObject(services, prepared, surfaceRect, at)) {
      inserted += 1;
      if (prepared.thumbHash === null) {
        // A corrupt/undecodable clip still lands (A.2.2 Attempt 2) —
        // but the artist hears WHY the plate is an icon (fixture d).
        services.bus.emit("ui:notice", {
          messageKey: "audio.waveformFailedNotice",
          severity: "error",
        });
      }
    }
  }
  if (queue.length > 0) {
    useUiStore.getState().queueAudioConversions(queue);
  }
  return inserted;
}
