/**
 * PosterBitmapCache (فاز M1 — A.2.2): the renderer's decode-once LRU
 * bitmap cache for video posters.
 *
 * Each poster hash resolves to ONE `<img>` decode, reused by every frame,
 * every autosave pass and every zoom/pan repaint — the decode-call
 * counter (ACM1.10's test hook) proves no re-decode storm. The cache is
 * a module-level singleton shared by ALL renderers (the live canvas AND
 * the exporters' offscreen instances), capped at ~100 entries; the
 * least-recently-used entry evicts (its `<img>` is simply dropped — the
 * browser HTTP cache still holds the bytes, so a re-fetch is cheap and
 * the next decode is one reload away).
 */

/** The cache's entry states. */
export type PosterEntryState = "loading" | "ready" | "broken";

/** One resolved cache entry. */
export interface PosterEntry {
  /** The decoded element (null until ready, or when broken). */
  readonly image: HTMLImageElement | null;
  /** The entry's lifecycle state. */
  readonly state: PosterEntryState;
}

/** Default entry cap (~100 per A.2.2). */
export const POSTER_CACHE_CAPACITY = 100;

/** One LRU cache entry (the insertion/update order IS the recency). */
interface CacheSlot {
  readonly image: HTMLImageElement;
  state: PosterEntryState;
}

/** The shared poster bitmap cache (decode-once, LRU, capped). */
export class PosterBitmapCache {
  private readonly slots = new Map<string, CacheSlot>();
  private readonly capacity: number;
  private notifier: (() => void) | null = null;
  private decodeCount = 0;

  /**
   * @param capacity - the maximum cached entries (LRU eviction above).
   */
  public constructor(capacity: number = POSTER_CACHE_CAPACITY) {
    this.capacity = Math.max(1, capacity);
  }

  /** @returns how many DISTINCT decodes this cache started (test hook). */
  public get decodes(): number {
    return this.decodeCount;
  }

  /** @returns the number of cached entries. */
  public get size(): number {
    return this.slots.size;
  }

  /**
   * Installs the repaint notifier invoked when a poster finishes
   * decoding (the host wires it to its dirty-flag, like the renderer's
   * own image notifier).
   *
   * @param notifier - the repaint request callback, or null to clear.
   */
  public setNotifier(notifier: (() => void) | null): void {
    this.notifier = notifier;
  }

  /**
   * Looks a poster up WITHOUT touching a new decode (a cache hit
   * refreshes the LRU recency).
   *
   * @param url - the resolved poster URL.
   * @returns the entry (loading/broken entries carry a null image).
   */
  public lookup(url: string): PosterEntry {
    const slot = this.slots.get(url);
    if (slot === undefined) {
      return { image: null, state: "loading" };
    }
    // LRU touch: re-insert at the map's tail.
    this.slots.delete(url);
    this.slots.set(url, slot);
    return { image: slot.state === "ready" ? slot.image : null, state: slot.state };
  }

  /**
   * Resolves (and lazily starts decoding) a poster: a cache miss creates
   * the `<img>`, kicks off the decode and returns `loading`; the decode
   * completion announces itself through the installed notifier.
   *
   * @param url - the resolved poster URL.
   * @returns the entry (ready entries carry the decoded element).
   */
  public resolve(url: string): PosterEntry {
    const hit = this.lookup(url);
    if (this.slots.has(url)) {
      return hit;
    }
    const image = new Image();
    image.decoding = "async";
    this.decodeCount += 1;
    const slot: CacheSlot = { image, state: "loading" };
    image.onload = () => {
      slot.state =
        image.complete && image.naturalWidth > 0 ? "ready" : "broken";
      this.notifier?.();
    };
    image.onerror = () => {
      slot.state = "broken";
      this.notifier?.();
    };
    image.src = url;
    this.slots.set(url, slot);
    this.evictIfNeeded();
    // The src assignment may have settled SYNCHRONOUSLY (data URLs,
    // stubbed tests) — report the live state, not a stale "loading".
    return {
      image: slot.state === "ready" ? slot.image : null,
      state: slot.state,
    };
  }

  /**
   * Preloads a poster to completion (the export path must render it
   * synchronously — a late decode would drop it from the exported
   * raster, mirroring `preloadImages`).
   *
   * @param url - the resolved poster URL.
   * @returns whether the poster decoded (a failed URL resolves false).
   */
  public preload(url: string): Promise<boolean> {
    const entry = this.resolve(url);
    if (entry.state === "ready") {
      return Promise.resolve(true);
    }
    if (entry.state === "broken") {
      return Promise.resolve(false);
    }
    const slot = this.slots.get(url);
    if (slot === undefined) {
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      const settle = (): void => {
        resolve(slot.state === "ready");
      };
      slot.image.addEventListener("load", settle, { once: true });
      slot.image.addEventListener("error", settle, { once: true });
      // A slot that already settled between resolve() and now still
      // resolves through the immediate state check.
      if (slot.state !== "loading") {
        settle();
      }
    });
  }

  /** Clears the cache (test hook). */
  public clear(): void {
    this.slots.clear();
    this.decodeCount = 0;
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

/** The process-wide shared instance (live canvas + exporters). */
export const posterBitmapCache = new PosterBitmapCache();

/** Test seam: resets the shared instance's state. */
export function resetPosterBitmapCache(): void {
  posterBitmapCache.clear();
  posterBitmapCache.setNotifier(null);
}
