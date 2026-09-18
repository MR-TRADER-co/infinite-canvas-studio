/**
 * Static-text cache policy tests (R13.5) — virtual clock.
 */
import { describe, expect, it } from "vitest";
import {
  COLD_AFTER_MS,
  CACHE_CAP,
  StaticTextCache,
} from "@/rendering/StaticTextCache";

/** A controllable virtual clock. */
function virtualClock(startAt = 1000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let current = startAt;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("StaticTextCache policy (R13.5)", () => {
  it("goes cold exactly 5s after the last warm event", () => {
    const clock = virtualClock();
    const cache = new StaticTextCache(clock.now);
    cache.markWarm("a");
    clock.advance(COLD_AFTER_MS - 1);
    expect(cache.isCold("a")).toBe(false);
    clock.advance(1);
    expect(cache.isCold("a")).toBe(true);
  });

  it("never goes cold while an edit session is active", () => {
    const clock = virtualClock();
    const cache = new StaticTextCache(clock.now);
    cache.markEditing("a");
    clock.advance(60_000);
    expect(cache.isCold("a")).toBe(false);
  });

  it("warming again restarts the timer and drops the stale bitmap", () => {
    const clock = virtualClock();
    const cache = new StaticTextCache(clock.now);
    cache.setEntryFactory(() => ({ bitmap: true }));
    cache.markWarm("a");
    clock.advance(COLD_AFTER_MS + 10);
    const signature = StaticTextCache.signatureOf(
      "a",
      { doc: null, text: "x", fontSize: 20, color: "c", width: 10, height: 10 },
      1,
      1,
    );
    expect(cache.rasterIfDue("a", signature)).toEqual({ bitmap: true });
    expect(cache.isNodeHidden("a")).toBe(true);
    cache.markWarm("a");
    expect(cache.isCold("a")).toBe(false);
    expect(cache.isNodeHidden("a")).toBe(false);
  });

  it("invalidates on a content-signature mismatch (stale bitmaps never draw)", () => {
    const clock = virtualClock();
    const cache = new StaticTextCache(clock.now);
    const sig1 = StaticTextCache.signatureOf(
      "a",
      { doc: null, text: "one", fontSize: 20, color: "c", width: 10, height: 10 },
      1,
      1,
    );
    cache.put("a", sig1, "bitmap-1");
    const sig2 = StaticTextCache.signatureOf(
      "a",
      { doc: null, text: "two", fontSize: 20, color: "c", width: 10, height: 10 },
      1,
      1,
    );
    expect(cache.get("a", sig2)).toBeNull();
  });

  it("flags a zoom drift > 2× for lazy re-raster but keeps serving the stale bitmap", () => {
    const clock = virtualClock();
    const cache = new StaticTextCache(clock.now);
    const atZoom1 = StaticTextCache.signatureOf(
      "a",
      { doc: null, text: "x", fontSize: 20, color: "c", width: 10, height: 10 },
      1,
      1,
    );
    cache.put("a", atZoom1, "bitmap-1");
    const atZoom25 = StaticTextCache.signatureOf(
      "a",
      { doc: null, text: "x", fontSize: 20, color: "c", width: 10, height: 10 },
      2.5,
      1,
    );
    expect(cache.get("a", atZoom25)).toEqual({
      bitmap: "bitmap-1",
      needsReraster: true,
    });
    const atZoom18 = StaticTextCache.signatureOf(
      "a",
      { doc: null, text: "x", fontSize: 20, color: "c", width: 10, height: 10 },
      1.8,
      1,
    );
    expect(cache.get("a", atZoom18)?.needsReraster).toBe(false);
  });

  it("evicts beyond the 300-entry LRU cap (oldest first, nodes re-show)", () => {
    const clock = virtualClock();
    const cache = new StaticTextCache(clock.now);
    const sig = (id: string) =>
      StaticTextCache.signatureOf(
        id,
        { doc: null, text: "x", fontSize: 20, color: "c", width: 10, height: 10 },
        1,
        1,
      );
    for (let index = 0; index < CACHE_CAP + 5; index += 1) {
      const id = `obj-${index}`;
      cache.markWarm(id);
      cache.put(id, sig(id), `bitmap-${index}`);
    }
    expect(cache.size).toBe(CACHE_CAP);
    expect(cache.get("obj-0", sig("obj-0"))).toBeNull();
    expect(cache.get("obj-1", sig("obj-1"))).toBeNull();
    expect(cache.isNodeHidden("obj-0")).toBe(false);
    expect(
      cache.get(`obj-${CACHE_CAP + 4}`, sig(`obj-${CACHE_CAP + 4}`)),
    ).not.toBeNull();
  });

  it("rasterIfDue produces bitmaps through the factory only when due", () => {
    const clock = virtualClock();
    const cache = new StaticTextCache(clock.now);
    let produced = 0;
    cache.setEntryFactory(() => {
      produced += 1;
      return { fresh: true };
    });
    const signature = StaticTextCache.signatureOf(
      "a",
      { doc: null, text: "x", fontSize: 20, color: "c", width: 10, height: 10 },
      1,
      1,
    );
    cache.markWarm("a");
    expect(cache.rasterIfDue("a", signature)).toBeNull();
    expect(produced).toBe(0);
    clock.advance(COLD_AFTER_MS + 1);
    expect(cache.rasterIfDue("a", signature)).toEqual({ fresh: true });
    expect(produced).toBe(1);
    expect(cache.rasterIfDue("a", signature)).toBeNull();
    expect(produced).toBe(1);
  });

  it("removes dropped objects entirely", () => {
    const cache = new StaticTextCache();
    cache.markWarm("gone");
    cache.remove("gone");
    expect(cache.isCold("gone")).toBe(false);
  });
});
