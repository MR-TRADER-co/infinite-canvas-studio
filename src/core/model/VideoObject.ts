/**
 * Video object (فاز M1 — «رسانهٔ زنده»): a video placed on the canvas as a
 * LIGHTWEIGHT THUMBNAIL object.
 *
 * The video bytes NEVER ride inside the object payload — they live in the
 * sidecar AssetStore keyed by their SHA-256 content hash, so the `.icb`
 * stays KB-scale no matter how many videos the board carries (A.2.1). The
 * object stores hashes + metadata only:
 * - `assetHash` — the CURRENT video file (the converted asset after M2's
 *   offline conversion, the original until then);
 * - `thumbHash` — the imported poster JPEG (max 480px wide, q0.8); null
 *   when thumbnail capture failed → the renderer paints the generic
 *   film-icon fallback (the object stays valid);
 * - `origAssetHash` — the KEPT original when a conversion replaced it
 *   (M2); absent while the original is the current asset;
 * - `naturalWidth/Height` — the video's INTRINSIC pixel dimensions
 *   (mirrors the ImageObject naming so every sized-object consumer reads
 *   one truth), while `width/height` are the PLACED world size exactly
 *   like ImageObject — resize/rotate/group/z-order/undo therefore behave
 *   identically through the SHARED manipulation commands (A.2.7).
 *
 * Pure data + helpers only (core stays DOM/ffmpeg-free, A.4).
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";
import { placedImageSize } from "@/core/model/ImageObject";

/** Default intrinsic size when a video's metadata could not be read. */
export const VIDEO_FALLBACK_INTRINSIC = { width: 640, height: 360 } as const;

/**
 * @param object - the object to inspect.
 * @returns whether the object is a video object.
 */
export function isVideoObject(
  object: SceneObjectData,
): object is VideoObjectData {
  return object.kind === "video";
}

/** Data of a video object (see the module doc for the field contract). */
export interface VideoObjectData extends SceneObjectData {
  /** Discriminant: always `video`. */
  readonly kind: "video";
  /** SHA-256 hash of the current video file in the AssetStore. */
  readonly assetHash: string;
  /** SHA-256 hash of the poster JPEG; null when capture failed. */
  readonly thumbHash: string | null;
  /** The original file name (display + the missing-asset placeholder). */
  readonly originalName: string;
  /** MIME type of the current asset (e.g. `video/mp4`). */
  readonly mimeType: string;
  /** Playable duration in milliseconds (0 when unknown). */
  readonly durationMs: number;
  /** Intrinsic width of the video, in pixels. */
  readonly naturalWidth: number;
  /** Intrinsic height of the video, in pixels. */
  readonly naturalHeight: number;
  /** Placed width in world units (canvas space). */
  readonly width: number;
  /** Placed height in world units (canvas space). */
  readonly height: number;
  /** SHA-256 hash of the KEPT original when a conversion replaced it (M2). */
  readonly origAssetHash?: string;
}

/**
 * Builds a fresh video object.
 *
 * @param id - the unique object id (from the shared `IdGenerator`).
 * @param assets - the AssetStore hashes + captured metadata.
 * @param position - the world-space top-left corner.
 * @param placed - the placed size in world units (already aspect-corrected
 *        by the caller); defaults to the intrinsic size when omitted.
 * @param zIndex - the paint order (scene supplies `nextZIndex()`).
 * @returns the assembled video object data.
 */
export function createVideoObject(
  id: string,
  assets: {
    readonly assetHash: string;
    readonly thumbHash: string | null;
    readonly originalName: string;
    readonly mimeType: string;
    readonly durationMs: number;
    readonly naturalWidth: number;
    readonly naturalHeight: number;
    readonly origAssetHash?: string;
  },
  position: Vec2,
  placed?: { readonly width: number; readonly height: number },
  zIndex = 0,
): VideoObjectData {
  const natural = {
    width: assets.naturalWidth > 0 ? assets.naturalWidth : VIDEO_FALLBACK_INTRINSIC.width,
    height: assets.naturalHeight > 0 ? assets.naturalHeight : VIDEO_FALLBACK_INTRINSIC.height,
  };
  const width = Math.max(1, Math.round(placed?.width ?? natural.width));
  const height = Math.max(1, Math.round(placed?.height ?? natural.height));
  return {
    id,
    kind: "video",
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
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    width,
    height,
    ...(assets.origAssetHash !== undefined
      ? { origAssetHash: assets.origAssetHash }
      : {}),
  };
}

/**
 * Computes the placed size for an imported video: the intrinsic size
 * clamped to `maxSpan` on its longest edge so huge videos still fit the
 * visible canvas — the EXACT rule of image imports (A.2.10), shared
 * through {@link placedImageSize}.
 *
 * @param natural - the video's intrinsic size in pixels.
 * @param maxSpan - the largest allowed world-space edge.
 * @returns the aspect-correct placed size in world units.
 */
export function placedVideoSize(
  natural: { readonly width: number; readonly height: number },
  maxSpan: number,
): { readonly width: number; readonly height: number } {
  return placedImageSize(natural, maxSpan);
}

/**
 * Collects every AssetStore hash a scene's video objects reference (the
 * relocation caller's manifest — A.2.1's "moved into the sidecar on first
 * Save As" needs the full set: current + poster + kept original).
 *
 * @param objects - the scene objects to scan.
 * @returns the distinct, ordered hash list.
 */
export function collectVideoAssetHashes(
  objects: readonly SceneObjectData[],
): readonly string[] {
  const hashes: string[] = [];
  const seen = new Set<string>();
  for (const object of objects) {
    if (!isVideoObject(object)) {
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
 * The duration badge text of a video, pure: `m:ss` under an hour,
 * `h:mm:ss` above (timecodes read LTR even in the RTL chrome — the digit
 * SHAPING still follows the app's Persian-digits setting at the call
 * site, A.2.8).
 *
 * @param durationMs - the video duration in milliseconds.
 * @returns the latin-digit timecode (e.g. `4:07`, `1:02:03`).
 */
export function videoTimecodeLatin(durationMs: number): string {
  const total = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
