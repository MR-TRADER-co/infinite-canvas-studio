/**
 * Unit tests for the فاز-۳۴ «کیفیت اصلی» import decision seam: which
 * imported images keep their ORIGINAL bytes (byte-identical pass-through)
 * and which take the proportional localStorage-sanity fallback. Pure
 * logic — the DOM decode pipeline just executes this plan.
 */
import { describe, expect, it } from "vitest";
import { planImageImport } from "@/ui/clipboard/canvasImport";
import {
  MAX_IMAGE_DIMENSION,
  MAX_INLINE_IMAGE_BYTES,
} from "@/core/model/ImageObject";

describe("planImageImport (فاز ۳۴ — «کیفیت اصلی»)", () => {
  it("passes ordinary photos through byte-identical", () => {
    // A 2200×1400 web photo, 900 KB — ABOVE the old 1600 cap, still
    // original bytes (the regression the user reported).
    expect(planImageImport({ width: 2200, height: 1400 }, 900_000)).toEqual({
      kind: "passthrough",
    });
    // 4K screenshot exactly at the cap edge.
    expect(planImageImport({ width: 4096, height: 2304 }, 1_800_000)).toEqual({
      kind: "passthrough",
    });
    // Tiny GIF/BMP/SVG-ish payloads — any MIME rides through.
    expect(planImageImport({ width: 320, height: 240 }, 40_000)).toEqual({
      kind: "passthrough",
    });
  });

  it("rescales proportionally past the dimension cap", () => {
    const plan = planImageImport({ width: 8192, height: 4096 }, 1_000_000);
    expect(plan.kind).toBe("rescale");
    if (plan.kind === "rescale") {
      expect(plan.width).toBe(MAX_IMAGE_DIMENSION);
      expect(plan.height).toBe(2048);
    }
    const portrait = planImageImport({ width: 2000, height: 12000 }, 500_000);
    expect(portrait.kind).toBe("rescale");
    if (portrait.kind === "rescale") {
      expect(portrait.height).toBe(MAX_IMAGE_DIMENSION);
      expect(portrait.width).toBe(Math.round((2000 * 4096) / 12000));
    }
  });

  it("rescales oversized-but-in-dimension payloads (localStorage sanity)", () => {
    const plan = planImageImport(
      { width: 3000, height: 2000 },
      MAX_INLINE_IMAGE_BYTES + 1,
    );
    // Within the pixel cap but over the byte cap → fallback keeps the
    // intrinsic size (scale 1) but forces the re-encode path.
    expect(plan.kind).toBe("rescale");
    if (plan.kind === "rescale") {
      expect(plan.width).toBe(3000);
      expect(plan.height).toBe(2000);
    }
  });

  it("never produces a degenerate rescale size", () => {
    const plan = planImageImport({ width: 1, height: 100_000 }, 10_000);
    expect(plan.kind).toBe("rescale");
    if (plan.kind === "rescale") {
      expect(plan.width).toBeGreaterThanOrEqual(1);
      expect(plan.height).toBe(MAX_IMAGE_DIMENSION);
    }
  });
});
