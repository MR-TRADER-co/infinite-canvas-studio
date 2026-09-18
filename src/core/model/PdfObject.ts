/**
 * PDF object (فاز P1 — «سند روی بوم»): a PDF file placed on the canvas
 * as a LIGHTWEIGHT page-thumbnail object.
 *
 * The PDF bytes NEVER ride inside the object payload — they live in the
 * sidecar AssetStore keyed by their SHA-256 content hash (the EXACT
 * VideoObject/AudioObject contract, A.2.1/A.2.6), so the `.icb` stays
 * KB-scale. The object stores hashes + metadata only:
 * - `assetHash` — the ORIGINAL PDF file (pdf.js reads it natively — no
 *   conversion is ever needed, A.2.4);
 * - `thumbHash` — the current page's poster JPEG (max 1000px wide,
 *   q0.8, rendered offscreen by pdf.js); null when the capture failed →
 *   the renderer paints the generic document-glyph fallback plate (the
 *   object stays valid, A.2.2);
 * - `pageCount` — total pages (captured at import, ≥ 1);
 * - `currentPage` — the 1-based page the thumbnail shows (the wheel
 *   over the object flips it, RP1.5; the viewer opens at it, RP2.1);
 * - `naturalWidth/naturalHeight` — page 1's intrinsic size at scale 1
 *   (mirrors VideoObject so every sized-object consumer reads one
 *   truth), while `width/height` are the PLACED world size exactly like
 *   ImageObject — resize (aspect-locked by default)/rotate/group/
 *   z-order/undo therefore behave identically through the SHARED
 *   manipulation commands (A.2.7).
 *
 * Pure data + helpers only (core stays DOM/pdf.js-free, A.4).
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";
import { placedImageSize } from "@/core/model/ImageObject";

/** Default intrinsic size when a poster could not be captured. */
export const PDF_FALLBACK_INTRINSIC = { width: 595, height: 842 } as const;

/**
 * @param object - the object to inspect.
 * @returns whether the object is a PDF object.
 */
export function isPdfObject(
  object: SceneObjectData,
): object is PdfObjectData {
  return object.kind === "pdf";
}

/** Data of a PDF object (see the module doc for the field contract). */
export interface PdfObjectData extends SceneObjectData {
  /** Discriminant: always `pdf`. */
  readonly kind: "pdf";
  /** SHA-256 hash of the original PDF file in the AssetStore. */
  readonly assetHash: string;
  /** SHA-256 hash of the CURRENT page's poster JPEG; null when capture failed. */
  readonly thumbHash: string | null;
  /** The original file name (display + the missing-asset placeholder). */
  readonly originalName: string;
  /** Total page count (≥ 1, captured at import). */
  readonly pageCount: number;
  /** The 1-based page the thumbnail currently shows. */
  readonly currentPage: number;
  /** Intrinsic width of page 1 at scale 1, in PDF units. */
  readonly naturalWidth: number;
  /** Intrinsic height of page 1 at scale 1, in PDF units. */
  readonly naturalHeight: number;
  /** Placed width in world units (canvas space). */
  readonly width: number;
  /** Placed height in world units (canvas space). */
  readonly height: number;
}

/**
 * Clamps a 1-based page number into `[1, pageCount]`.
 *
 * @param page - the requested page (any number; NaN → 1).
 * @param pageCount - the total page count (≤ 0 → treated as 1).
 * @returns the clamped page.
 */
export function clampPdfPage(page: number, pageCount: number): number {
  const total = Number.isFinite(pageCount) && pageCount >= 1 ? Math.floor(pageCount) : 1;
  if (!Number.isFinite(page)) {
    return 1;
  }
  return Math.min(total, Math.max(1, Math.floor(page)));
}

/**
 * Builds a fresh PDF object.
 *
 * @param id - the unique object id (from the shared `IdGenerator`).
 * @param assets - the AssetStore hashes + captured metadata.
 * @param position - the world-space top-left corner.
 * @param placed - the placed size in world units (already aspect-corrected
 *        by the caller); defaults to the intrinsic size when omitted.
 * @param zIndex - the paint order (scene supplies `nextZIndex()`).
 * @returns the assembled PDF object data.
 */
export function createPdfObject(
  id: string,
  assets: {
    readonly assetHash: string;
    readonly thumbHash: string | null;
    readonly originalName: string;
    readonly pageCount: number;
    readonly currentPage: number;
    readonly naturalWidth: number;
    readonly naturalHeight: number;
  },
  position: Vec2,
  placed?: { readonly width: number; readonly height: number },
  zIndex = 0,
): PdfObjectData {
  const natural = {
    width: assets.naturalWidth > 0 ? assets.naturalWidth : PDF_FALLBACK_INTRINSIC.width,
    height: assets.naturalHeight > 0 ? assets.naturalHeight : PDF_FALLBACK_INTRINSIC.height,
  };
  const pageCount = Math.max(1, Math.floor(assets.pageCount));
  const width = Math.max(1, Math.round(placed?.width ?? natural.width));
  const height = Math.max(1, Math.round(placed?.height ?? natural.height));
  return {
    id,
    kind: "pdf",
    position: vec2(position.x, position.y),
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    assetHash: assets.assetHash,
    thumbHash: assets.thumbHash,
    originalName: assets.originalName,
    pageCount,
    currentPage: clampPdfPage(assets.currentPage, pageCount),
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    width,
    height,
  };
}

/**
 * Computes the placed size for an imported PDF: the intrinsic page size
 * clamped to `maxSpan` on its longest edge so huge pages still fit the
 * visible canvas — the EXACT rule of image/video/audio imports (A.2.10),
 * shared through {@link placedImageSize}.
 *
 * @param natural - the page's intrinsic size in PDF units.
 * @param maxSpan - the largest allowed world-space edge.
 * @returns the aspect-correct placed size in world units.
 */
export function placedPdfSize(
  natural: { readonly width: number; readonly height: number },
  maxSpan: number,
): { readonly width: number; readonly height: number } {
  return placedImageSize(natural, maxSpan);
}

/**
 * Collects every AssetStore hash a scene's PDF objects reference (the
 * relocation manifest — the first Save As must move the full set:
 * original + every captured page poster).
 *
 * @param objects - the scene objects to scan.
 * @returns the distinct, ordered hash list.
 */
export function collectPdfAssetHashes(
  objects: readonly SceneObjectData[],
): readonly string[] {
  const hashes: string[] = [];
  const seen = new Set<string>();
  for (const object of objects) {
    if (!isPdfObject(object)) {
      continue;
    }
    for (const hash of [object.assetHash, object.thumbHash]) {
      if (hash !== null && hash !== undefined && !seen.has(hash)) {
        seen.add(hash);
        hashes.push(hash);
      }
    }
  }
  return hashes;
}

/**
 * The page badge text of a PDF, pure: `current / count` with latin
 * digits (the digit SHAPING follows the app's Persian-digits setting at
 * the call site through the palette formatter, A.2.8).
 *
 * @param current - the 1-based current page.
 * @param pageCount - the total page count.
 * @returns the latin-digit badge (e.g. `2 / 10`).
 */
export function pdfPageBadgeLatin(current: number, pageCount: number): string {
  const total = Math.max(1, Math.floor(pageCount));
  const page = clampPdfPage(current, total);
  return `${page} / ${total}`;
}
