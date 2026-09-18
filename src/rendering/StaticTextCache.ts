/**
 * The static-text raster cache (R13.5): keeps large canvases at ≥55fps
 * with thousands of text objects by rasterizing COLD text into bitmaps.
 *
 * Policy (pure, virtual-clock testable):
 * - A text object goes COLD 5s after its last WARM event (edit-exit,
 *   selection change) as long as no edit session is active.
 * - A cold object's DOM node hides (`cold-text-hidden`) and the canvas
 *   draws the cached bitmap instead (the renderer's cold-text pass).
 * - The bitmap rasterizes at the CURRENT zoom × DPR; a zoom drift
 *   larger than 2× from the raster zoom triggers a LAZY re-raster (the
 *   stale bitmap keeps drawing until the fresh one lands — never a
 *   blank frame).
 * - Invalidation: a signature mismatch (content/geometry/font), an
 *   edit-enter (warm, no visual jump — the DOM node re-shows
 *   immediately), or a scene removal.
 * - The store is an LRU capped at 300 entries.
 *
 * The DOM/canvas integration (rasterize via SVG foreignObject, hide the
 * node, draw the bitmap) lives in the ColdTextController; this module
 * owns the policy so it stays node-testable.
 */

/** Milliseconds after the last warm event before an object goes cold. */
export const COLD_AFTER_MS = 5000;

/** LRU capacity (entries). */
export const CACHE_CAP = 300;

/** Zoom drift beyond this ratio triggers a lazy re-raster. */
export const ZOOM_DRIFT_RATIO = 2;

/** The cacheable signature of one text object's visual state. */
export interface TextCacheSignature {
  /** A stable hash of the content + visual fields (doc identity, fonts). */
  readonly contentHash: string;
  /** Rendered width at raster time (CSS pixels). */
  readonly width: number;
  /** Rendered height at raster time (CSS pixels). */
  readonly height: number;
  /** The zoom the bitmap was rasterized at. */
  readonly zoom: number;
  /** The device pixel ratio the bitmap was rasterized at. */
  readonly pixelRatio: number;
}

/** One cached bitmap entry. */
export interface ColdTextEntry {
  /** The object id. */
  readonly id: string;
  /** The signature the bitmap was rasterized under. */
  readonly signature: TextCacheSignature;
  /** The rasterized bitmap (an ImageBitmap or HTMLCanvasElement). */
  readonly bitmap: unknown;
  /** LRU touch stamp (monotonic counter). */
  touchedAt: number;
}

/** The per-object thermal state tracked by the policy. */
interface ThermalState {
  /** Last warm timestamp (epoch ms of the virtual clock). */
  lastWarmAt: number;
  /** Whether an edit session is currently active on the object. */
  editing: boolean;
  /** Whether the object's DOM node is currently hidden (cold). */
  hidden: boolean;
}

/**
 * The policy store: thermal states + the LRU bitmap cache.
 *
 * All timestamps come from an injected clock — tests pass a virtual one.
 */
export class StaticTextCache {
  private readonly thermal = new Map<string, ThermalState>();
  private readonly entries = new Map<string, ColdTextEntry>();
  private lruCounter = 0;
  private clock: () => number;
  private entryFactory:
    | ((id: string, signature: TextCacheSignature) => unknown)
    | null = null;

  /**
   * @param clock - the epoch-ms clock (tests inject a virtual one).
   */
  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  /**
   * Installs the bitmap producer (the controller's rasterizer). Tests
   * install a stub; production passes the foreignObject rasterizer.
   *
   * @param factory - produces a bitmap for a signature (null → no-op).
   */
  public setEntryFactory(
    factory:
      | ((id: string, signature: TextCacheSignature) => unknown)
      | null,
  ): void {
    this.entryFactory = factory;
  }

  /**
   * Marks an object WARM (edit-enter, edit-exit, selection change) — the
   * DOM node shows, the cold timer restarts.
   *
   * @param id - the object id.
   */
  public markWarm(id: string): void {
    this.thermal.set(id, {
      lastWarmAt: this.clock(),
      editing: false,
      hidden: false,
    });
    this.entries.delete(id);
  }

  /**
   * Marks an object as under an ACTIVE edit session (never cold, never
   * hidden — the editor DOM must stay live).
   *
   * @param id - the object id.
   */
  public markEditing(id: string): void {
    this.thermal.set(id, {
      lastWarmAt: this.clock(),
      editing: true,
      hidden: false,
    });
    this.entries.delete(id);
  }

  /**
   * Whether the object should currently be COLD (its DOM node hidden and
   * the bitmap drawn) — true when the warm window elapsed and no edit is
   * active.
   *
   * @param id - the object id.
   * @returns whether the object is due for cold rasterization.
   */
  public isCold(id: string): boolean {
    const state = this.thermal.get(id);
    if (state === undefined || state.editing) {
      return false;
    }
    return this.clock() - state.lastWarmAt >= COLD_AFTER_MS;
  }

  /**
   * Stores a rasterized bitmap (LRU eviction beyond the cap) and marks
   * the object's node hidden.
   *
   * @param id - the object id.
   * @param signature - the signature the bitmap was rasterized under.
   * @param bitmap - the bitmap.
   */
  public put(
    id: string,
    signature: TextCacheSignature,
    bitmap: unknown,
  ): void {
    this.entries.set(id, {
      id,
      signature,
      bitmap,
      touchedAt: (this.lruCounter += 1),
    });
    const state = this.thermal.get(id);
    if (state !== undefined) {
      this.thermal.set(id, { ...state, hidden: true });
    }
    this.evictBeyondCap();
  }

  /**
   * Fetches the cached bitmap when it is STILL VALID for the given
   * signature + current zoom (a content mismatch invalidates; a zoom
   * drift > 2× asks for a lazy re-raster but STILL returns the stale
   * bitmap — never a blank frame).
   *
   * @param id - the object id.
   * @param signature - the object's CURRENT signature.
   * @returns the bitmap, or null when nothing usable is cached.
   */
  public get(
    id: string,
    signature: TextCacheSignature,
  ): { bitmap: unknown; needsReraster: boolean } | null {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return null;
    }
    entry.touchedAt = this.lruCounter += 1;
    if (entry.signature.contentHash !== signature.contentHash) {
      // Content changed: the stale bitmap must NOT draw.
      this.entries.delete(id);
      return null;
    }
    const drift =
      Math.max(entry.signature.zoom, signature.zoom) /
      Math.min(entry.signature.zoom, signature.zoom);
    return {
      bitmap: entry.bitmap,
      needsReraster:
        drift > ZOOM_DRIFT_RATIO ||
        entry.signature.width !== signature.width ||
        entry.signature.height !== signature.height,
    };
  }

  /**
   * Whether an object's DOM node should carry the hidden class.
   *
   * @param id - the object id.
   * @returns whether the node hides.
   */
  public isNodeHidden(id: string): boolean {
    return this.thermal.get(id)?.hidden === true;
  }

  /**
   * Warms + un-hides every tracked object (a mass invalidation — used on
   * mode switches where live DOM must return, e.g. entering a tool that
   * needs hit-testing parity).
   */
  public warmAll(): void {
    for (const id of [...this.thermal.keys()]) {
      this.markWarm(id);
    }
  }

  /**
   * Drops one object entirely (scene removal).
   *
   * @param id - the object id.
   */
  public remove(id: string): void {
    this.thermal.delete(id);
    this.entries.delete(id);
  }

  /** @returns the number of cached bitmaps (LRU bookkeeping surface). */
  public get size(): number {
    return this.entries.size;
  }

  /** @returns the ids currently hidden (the controller's hide list). */
  public hiddenIds(): readonly string[] {
    return [...this.thermal.entries()]
      .filter(([, state]) => state.hidden)
      .map(([id]) => id);
  }

  /**
   * Produces the signature for an object's current visual state (the
   * content hash covers the doc identity + fonts + colours; geometry
   * stays separate so a pure move reuses the bitmap).
   *
   * @param id - the object id.
   * @param fields - the object's visual fields.
   * @param zoom - the current camera zoom.
   * @param pixelRatio - the device pixel ratio.
   * @returns the signature.
   */
  public static signatureOf(
    id: string,
    fields: {
      doc: unknown;
      text: string;
      fontSize: number;
      fontFamily?: string;
      color: string;
      width: number;
      height: number;
    },
    zoom: number,
    pixelRatio: number,
  ): TextCacheSignature {
    let hash = 5381;
    const material = `${id}|${JSON.stringify(fields.doc)}|${fields.text}|${fields.fontSize}|${fields.fontFamily ?? ""}|${fields.color}`;
    for (let index = 0; index < material.length; index += 1) {
      hash = ((hash << 5) + hash + material.charCodeAt(index)) | 0;
    }
    return {
      contentHash: `h${(hash >>> 0).toString(36)}`,
      width: fields.width,
      height: fields.height,
      zoom,
      pixelRatio,
    };
  }

  /** Evicts the least-recently-touched entries beyond the cap. */
  private evictBeyondCap(): void {
    while (this.entries.size > CACHE_CAP) {
      let oldestId: string | null = null;
      let oldestTouch = Infinity;
      for (const [id, entry] of this.entries) {
        if (entry.touchedAt < oldestTouch) {
          oldestTouch = entry.touchedAt;
          oldestId = id;
        }
      }
      if (oldestId === null) {
        return;
      }
      this.entries.delete(oldestId);
      const state = this.thermal.get(oldestId);
      if (state !== undefined) {
        this.thermal.set(oldestId, { ...state, hidden: false });
      }
    }
  }

  /**
   * The controller-facing raster decision for one frame: whether the
   * object should rasterize NOW (cold + nothing cached, or a flagged
   * lazy re-raster), producing the bitmap through the installed factory.
   *
   * @param id - the object id.
   * @param signature - the current signature.
   * @returns the fresh bitmap when a raster is due, else null.
   */
  public rasterIfDue(
    id: string,
    signature: TextCacheSignature,
  ): unknown {
    if (!this.isCold(id) || this.entryFactory === null) {
      return null;
    }
    const cached = this.get(id, signature);
    if (cached !== null && !cached.needsReraster) {
      return null;
    }
    const bitmap = this.entryFactory(id, signature);
    if (bitmap !== null && bitmap !== undefined) {
      this.put(id, signature, bitmap);
      return bitmap;
    }
    return null;
  }
}
