/**
 * Unit tests for the PosterBitmapCache (فاز M1 — A.2.2 / ACM1.10): the
 * decode-once LRU contract — one decode per URL, repeated lookups hit
 * the cache (the decode counter proves it), the LRU evicts at capacity
 * and broken URLs surface their state.
 *
 * The `Image` global is stubbed with a controllable fake (no jsdom
 * decode needed); load/error fire synchronously on `src` assignment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PosterBitmapCache } from "@/media/PosterBitmapCache";

/** A controllable fake HTMLImageElement (src assignment fires the event). */
class FakeImage {
  public complete = false;
  public naturalWidth = 0;
  public naturalHeight = 0;
  public decoding = "";
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  private _src = "";

  public get src(): string {
    return this._src;
  }

  public set src(value: string) {
    this._src = value;
    if (value.startsWith("good:")) {
      this.complete = true;
      this.naturalWidth = 480;
      this.naturalHeight = 270;
      this.onload?.();
    } else if (value.startsWith("bad:")) {
      this.complete = true;
      this.onload?.();
    } else {
      this.onerror?.();
    }
  }

  public addEventListener(_type: string, listener: () => void): void {
    // preload()'s settle listeners — fire immediately for determinism.
    listener();
  }
}

describe("PosterBitmapCache (فاز M1 — ACM1.10)", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes each URL exactly ONCE — repeated lookups never re-decode", () => {
    const cache = new PosterBitmapCache(10);
    // The synchronous fake settles DURING the resolve → ready at once.
    const first = cache.resolve("good:one");
    expect(first.state).toBe("ready");
    expect(first.image).not.toBeNull();
    const second = cache.resolve("good:one");
    expect(second.state).toBe("ready");
    expect(second.image).not.toBeNull();
    const third = cache.lookup("good:one");
    expect(third.state).toBe("ready");
    expect(cache.decodes).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("evicts the least-recently-used entry above the capacity", () => {
    const cache = new PosterBitmapCache(2);
    cache.resolve("good:a");
    cache.resolve("good:b");
    // Touch "a" so "b" becomes the LRU.
    cache.lookup("good:a");
    cache.resolve("good:c");
    expect(cache.size).toBe(2);
    expect(cache.lookup("good:b").state).toBe("loading");
    expect(cache.lookup("good:a").state).toBe("ready");
    // "b" was evicted → resolving it again decodes a second time.
    cache.resolve("good:b");
    expect(cache.decodes).toBe(4);
  });

  it("surfaces broken URLs as the broken state", () => {
    const cache = new PosterBitmapCache(10);
    const entry = cache.resolve("error:pixel");
    expect(entry.state).toBe("broken");
    expect(entry.image).toBeNull();
  });

  it("preloads to completion (the export path)", async () => {
    const cache = new PosterBitmapCache(10);
    const ok = await cache.preload("good:poster");
    expect(ok).toBe(true);
    const bad = await cache.preload("error:other");
    expect(bad).toBe(false);
  });

  it("announces decode completion through the installed notifier", () => {
    const cache = new PosterBitmapCache(10);
    const notifier = vi.fn();
    cache.setNotifier(notifier);
    cache.resolve("good:x");
    expect(notifier).toHaveBeenCalledTimes(1);
    cache.setNotifier(null);
  });
});
