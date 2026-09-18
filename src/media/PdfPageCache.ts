/**
 * PdfPageCache (فاز P1 — A.2.2): the LRU keep-alive of the pages the
 * canvas actually shows — the PosterBitmapCache's exact discipline
 * applied one level up, at the (assetHash, page) → poster-hash level.
 *
 * Rendering a page poster is expensive (pdf.js + offscreen canvas), so
 * a page flipped away and flipped back must NOT re-render: the cache
 * keeps the STORED poster hash of every (asset, page) pair it has seen
 * (capped, LRU-evicted — the AssetStore keeps the bytes regardless,
 * content-addressed dedupe means nothing is ever orphaned). The bitmap
 * decode itself rides the SHARED {@link PosterBitmapCache} through the
 * normal asset URL — one `<img>` decode per poster, reused by every
 * frame, autosave and zoom (A.2.2's decode-once law).
 *
 * Pure-ish module: no pdf.js import (the renderer service feeds it);
 * unit-testable in isolation.
 */

/** Default entry cap (mirrors the PosterBitmapCache's ~100). */
export const PDF_PAGE_CACHE_CAPACITY = 100;

/** One cache entry: the STORED poster hash of one rendered page. */
export interface PdfPageCacheSlot {
  /** The AssetStore hash of the page's poster JPEG. */
  readonly posterHash: string;
}

/** The (assetHash, page) → poster-hash LRU (decode-once, capped). */
export class PdfPageCache {
  private readonly slots = new Map<string, PdfPageCacheSlot>();
  private readonly capacity: number;
  private hits = 0;
  private misses = 0;

  /**
   * @param capacity - the maximum cached entries (LRU eviction above).
   */
  public constructor(capacity: number = PDF_PAGE_CACHE_CAPACITY) {
    this.capacity = Math.max(1, capacity);
  }

  /** @returns the cache's entry count (test hook). */
  public get size(): number {
    return this.slots.size;
  }

  /** @returns how many lookups HIT (test hook — the no-storm proof). */
  public get lookupHits(): number {
    return this.hits;
  }

  /** @returns how many lookups MISSED (test hook). */
  public get lookupMisses(): number {
    return this.misses;
  }

  /**
   * Looks a rendered page up (a hit refreshes the LRU recency).
   *
   * @param assetHash - the PDF's AssetStore hash.
   * @param page - the 1-based page number.
   * @returns the stored poster hash, or undefined when unseen.
   */
  public lookup(assetHash: string, page: number): string | undefined {
    const key = PdfPageCache.keyOf(assetHash, page);
    const slot = this.slots.get(key);
    if (slot === undefined) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    // LRU touch: re-insert at the map's tail.
    this.slots.delete(key);
    this.slots.set(key, slot);
    return slot.posterHash;
  }

  /**
   * Records a freshly rendered page poster.
   *
   * @param assetHash - the PDF's AssetStore hash.
   * @param page - the 1-based page number.
   * @param posterHash - the STORED poster JPEG's AssetStore hash.
   */
  public remember(assetHash: string, page: number, posterHash: string): void {
    const key = PdfPageCache.keyOf(assetHash, page);
    this.slots.delete(key);
    this.slots.set(key, { posterHash });
    this.evictIfNeeded();
  }

  /**
   * Drops every cached entry of one asset (the object was deleted or
   * its bytes changed — never happens with content addressing, but the
   * seam exists for correctness).
   *
   * @param assetHash - the PDF's AssetStore hash.
   */
  public forgetAsset(assetHash: string): void {
    const prefix = `${assetHash}|`;
    for (const key of [...this.slots.keys()]) {
      if (key.startsWith(prefix)) {
        this.slots.delete(key);
      }
    }
  }

  /** Clears the cache (test hook). */
  public clear(): void {
    this.slots.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** @returns the composite cache key of one (asset, page) pair. */
  private static keyOf(assetHash: string, page: number): string {
    return `${assetHash}|${Math.max(1, Math.floor(page))}`;
  }

  /** Evicts the least-recently-used entries above the capacity. */
  private evictIfNeeded(): void {
    while (this.slots.size > this.capacity) {
      const oldest = this.slots.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.slots.delete(oldest);
    }
  }
}

/** The process-wide shared page-poster hash cache (wheel flips reuse it). */
export const pdfPageCache = new PdfPageCache();

/** Test seam: resets the shared instance's state. */
export function resetPdfPageCache(): void {
  pdfPageCache.clear();
}
