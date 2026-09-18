/**
 * PdfPageCache tests (فاز P1 — A.2.2): the (asset, page) → poster-hash
 * LRU — hit/miss counting, recency eviction, per-asset forget and the
 * decode-once proof (no re-render storms).
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  PdfPageCache,
  pdfPageCache,
  resetPdfPageCache,
} from "@/media/PdfPageCache";

describe("PdfPageCache (فاز P1)", () => {
  beforeEach(() => {
    resetPdfPageCache();
  });

  it("misses unseen pages, remembers rendered ones", () => {
    const cache = new PdfPageCache();
    expect(cache.lookup("a".repeat(8), 1)).toBeUndefined();
    expect(cache.lookupMisses).toBe(1);
    cache.remember("a".repeat(8), 1, "poster-1");
    expect(cache.lookup("a".repeat(8), 1)).toBe("poster-1");
    expect(cache.lookupHits).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("evicts the least-recently-used above the capacity", () => {
    const cache = new PdfPageCache(2);
    cache.remember("asset", 1, "p1");
    cache.remember("asset", 2, "p2");
    expect(cache.size).toBe(2);
    // Touch page 1 → page 2 becomes the LRU victim.
    cache.lookup("asset", 1);
    cache.remember("asset", 3, "p3");
    expect(cache.size).toBe(2);
    expect(cache.lookup("asset", 2)).toBeUndefined();
    expect(cache.lookup("asset", 1)).toBe("p1");
    expect(cache.lookup("asset", 3)).toBe("p3");
  });

  it("forgets one asset's pages wholesale", () => {
    const cache = new PdfPageCache();
    cache.remember("a", 1, "a1");
    cache.remember("a", 2, "a2");
    cache.remember("b", 1, "b1");
    cache.forgetAsset("a");
    expect(cache.size).toBe(1);
    expect(cache.lookup("a", 1)).toBeUndefined();
    expect(cache.lookup("b", 1)).toBe("b1");
  });

  it("shares the process-wide instance", () => {
    pdfPageCache.remember("shared", 4, "poster");
    expect(pdfPageCache.lookup("shared", 4)).toBe("poster");
  });
});
