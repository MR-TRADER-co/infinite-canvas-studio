/**
 * Audio object (فاز A1 — the audio extension): an audio file placed on
 * the canvas as a LIGHTWEIGHT THUMBNAIL object.
 *
 * The audio bytes NEVER ride inside the object payload — they live in the
 * sidecar AssetStore keyed by their SHA-256 content hash (the EXACT
 * VideoObject contract, A.2.1/A.2.6), so the `.icb` stays KB-scale. The
 * object stores hashes + metadata only:
 * - `assetHash` — the CURRENT audio file (the converted MP3 after A2's
 *   offline conversion, the original until then);
 * - `thumbHash` — the generated waveform JPEG (max 480px wide, q0.8);
 *   null when generation failed → the renderer paints the generic
 *   audio-note fallback plate (the object stays valid, A.2.2);
 * - `origAssetHash` — the KEPT original when a conversion replaced it
 *   (A2); absent while the original is the current asset;
 * - `durationMs` — the decoded duration (0 when unknown);
 * - `width/height` — the PLACED world size exactly like ImageObject —
 *   resize (aspect-locked by default)/rotate/group/z-order/undo behave
 *   identically through the SHARED manipulation commands (A.2.7).
 *
 * Pure data + helpers only (core stays DOM/ffmpeg-free, A.4).
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";
import { placedImageSize } from "@/core/model/ImageObject";
import { videoTimecodeLatin } from "@/core/model/VideoObject";

/** Default intrinsic size when a waveform could not be generated. */
export const AUDIO_FALLBACK_INTRINSIC = { width: 480, height: 160 } as const;

/**
 * @param object - the object to inspect.
 * @returns whether the object is an audio object.
 */
export function isAudioObject(
  object: SceneObjectData,
): object is AudioObjectData {
  return object.kind === "audio";
}

/** Data of an audio object (see the module doc for the field contract). */
export interface AudioObjectData extends SceneObjectData {
  /** Discriminant: always `audio`. */
  readonly kind: "audio";
  /** SHA-256 hash of the current audio file in the AssetStore. */
  readonly assetHash: string;
  /** SHA-256 hash of the waveform JPEG; null when generation failed. */
  readonly thumbHash: string | null;
  /** The original file name (display + the missing-asset placeholder). */
  readonly originalName: string;
  /** MIME type of the current asset (e.g. `audio/mpeg`). */
  readonly mimeType: string;
  /** Playable duration in milliseconds (0 when unknown). */
  readonly durationMs: number;
  /** Placed width in world units (canvas space). */
  readonly width: number;
  /** Placed height in world units (canvas space). */
  readonly height: number;
  /** SHA-256 hash of the KEPT original when a conversion replaced it (A2). */
  readonly origAssetHash?: string;
}

/**
 * Builds a fresh audio object.
 *
 * @param id - the unique object id (from the shared `IdGenerator`).
 * @param assets - the AssetStore hashes + generated metadata.
 * @param position - the world-space top-left corner.
 * @param placed - the placed size in world units (already
 *        aspect-corrected by the caller); defaults to the intrinsic size
 *        when omitted.
 * @param zIndex - the paint order (scene supplies `nextZIndex()`).
 * @returns the assembled audio object data.
 */
export function createAudioObject(
  id: string,
  assets: {
    readonly assetHash: string;
    readonly thumbHash: string | null;
    readonly originalName: string;
    readonly mimeType: string;
    readonly durationMs: number;
    readonly origAssetHash?: string;
  },
  position: Vec2,
  placed?: { readonly width: number; readonly height: number },
  zIndex = 0,
): AudioObjectData {
  // The waveform JPEG and the fallback plate share the 3:1 media-chip
  // ratio — one intrinsic keeps the placed footprint stable whether the
  // waveform generated or not.
  const natural = AUDIO_FALLBACK_INTRINSIC;
  const width = Math.max(1, Math.round(placed?.width ?? natural.width));
  const height = Math.max(1, Math.round(placed?.height ?? natural.height));
  return {
    id,
    kind: "audio",
    position: vec2(position.x, position.y),
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    assetHash: assets.assetHash,
    thumbHash: assets.thumbHash,
    originalName: assets.originalName,
    mimeType: assets.mimeType,
    durationMs: Math.max(0, Math.round(assets.durationMs)),
    width,
    height,
    ...(assets.origAssetHash !== undefined
      ? { origAssetHash: assets.origAssetHash }
      : {}),
  };
}

/**
 * Computes the placed size for an imported audio clip: the intrinsic
 * (waveform) size clamped to `maxSpan` on its longest edge — the EXACT
 * rule of image/video imports (A.2.10), shared through
 * {@link placedImageSize}.
 *
 * @param natural - the waveform's intrinsic size in pixels.
 * @param maxSpan - the largest allowed world-space edge.
 * @returns the aspect-correct placed size in world units.
 */
export function placedAudioSize(
  natural: { readonly width: number; readonly height: number },
  maxSpan: number,
): { readonly width: number; readonly height: number } {
  return placedImageSize(natural, maxSpan);
}

/**
 * Collects every AssetStore hash a scene's audio objects reference (the
 * relocation manifest — the first Save As must move the full set:
 * current + waveform + kept original).
 *
 * @param objects - the scene objects to scan.
 * @returns the distinct, ordered hash list.
 */
export function collectAudioAssetHashes(
  objects: readonly SceneObjectData[],
): readonly string[] {
  const hashes: string[] = [];
  const seen = new Set<string>();
  for (const object of objects) {
    if (!isAudioObject(object)) {
      continue;
    }
    for (const hash of [object.assetHash, object.thumbHash, object.origAssetHash]) {
      if (hash !== null && hash !== undefined && !seen.has(hash)) {
        seen.add(hash);
        hashes.push(hash);
      }
    }
  }
  return hashes;
}

/**
 * The duration badge text of an audio clip — the SAME media timecode
 * core the video badge uses (`m:ss` under an hour, `h:mm:ss` above),
 * reused verbatim (A.2.8: the digit SHAPING still follows the app's
 * Persian-digits setting at the call site).
 *
 * @param durationMs - the audio duration in milliseconds.
 * @returns the latin-digit timecode (e.g. `4:07`, `1:02:03`).
 */
export function audioTimecodeLatin(durationMs: number): string {
  return videoTimecodeLatin(durationMs);
}
