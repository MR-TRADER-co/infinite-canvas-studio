/**
 * Unit tests for the Phase-23 image original-quality helpers: scale and
 * ratio readouts, drift detection, the centre-preserving full natural
 * reset and the width-preserving ratio reset (each feeding ONE
 * ResizeCommand so undo restores the drifted state exactly).
 */
import { describe, expect, it } from "vitest";
import {
  createImageObject,
  imageAspectRatio,
  imageInsertStateDrifted,
  imageNaturalAspectRatio,
  imageRatioDeviationPercent,
  imageScalePercent,
  imageSizeDrifted,
  insertStateResetPatch,
  naturalResetPatch,
  ratioResetPatch,
  type ImageObjectData,
} from "@/core/model/ImageObject";
import { vec2 } from "@/core/geometry/Vec2";

const SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

/** Natural 1600×900 image placed at (x, y) with the given placed size. */
function image(
  width: number,
  height: number,
  x = 100,
  y = 100,
): ReturnType<typeof createImageObject> {
  return createImageObject(
    "img-1",
    SRC,
    { width: 1600, height: 900 },
    vec2(x, y),
    { width, height },
    1,
  );
}

describe("readouts", () => {
  it("computes the scale percent against the natural width", () => {
    expect(imageScalePercent(image(1600, 900))).toBe(100);
    expect(imageScalePercent(image(800, 450))).toBe(50);
    expect(imageScalePercent(image(2400, 1350))).toBe(150);
  });

  it("computes current and natural ratios", () => {
    expect(imageNaturalAspectRatio(image(800, 500))).toBeCloseTo(16 / 9);
    expect(imageAspectRatio(image(800, 500))).toBeCloseTo(1.6);
  });

  it("measures the ratio deviation in percent", () => {
    expect(imageRatioDeviationPercent(image(1600, 900))).toBeCloseTo(0);
    expect(imageRatioDeviationPercent(image(800, 500))).toBeGreaterThan(5);
  });
});

describe("imageSizeDrifted", () => {
  it("stays false at the exact natural size", () => {
    expect(imageSizeDrifted(image(1600, 900))).toBe(false);
  });

  it("flags proportional scaling and ratio-only drift", () => {
    expect(imageSizeDrifted(image(800, 450))).toBe(true);
    expect(imageSizeDrifted(image(1600, 700))).toBe(true);
  });
});

describe("naturalResetPatch", () => {
  it("restores the natural size with the centre preserved", () => {
    const before = image(800, 400, 200, 300);
    const after = naturalResetPatch(before);
    expect(after).not.toBeNull();
    expect(after?.width).toBe(1600);
    expect(after?.height).toBe(900);
    const centreBefore = {
      x: before.position.x + before.width / 2,
      y: before.position.y + before.height / 2,
    };
    const centreAfter = {
      x: (after?.position.x ?? 0) + (after?.width ?? 0) / 2,
      y: (after?.position.y ?? 0) + (after?.height ?? 0) / 2,
    };
    expect(centreAfter.x).toBeCloseTo(centreBefore.x);
    expect(centreAfter.y).toBeCloseTo(centreBefore.y);
  });

  it("returns null when undrifted", () => {
    expect(naturalResetPatch(image(1600, 900))).toBeNull();
  });

  it("keeps every other field verbatim (one command, exact undo)", () => {
    const before = image(500, 500);
    const after = naturalResetPatch(before);
    expect(after?.id).toBe(before.id);
    expect(after?.src).toBe(before.src);
    expect(after?.kind).toBe("image");
    expect(after?.zIndex).toBe(before.zIndex);
  });
});

describe("ratioResetPatch", () => {
  it("keeps the width and recomputes the height from the natural ratio", () => {
    const before = image(800, 500, 40, 60);
    const after = ratioResetPatch(before);
    expect(after).not.toBeNull();
    expect(after?.width).toBe(800);
    expect(after?.height).toBe(450);
    // Vertical centre preserved on the new height.
    expect((after?.position.y ?? 0) + 225).toBeCloseTo(60 + 250);
  });

  it("returns null when the ratio already matches", () => {
    expect(ratioResetPatch(image(1600, 900))).toBeNull();
    expect(ratioResetPatch(image(800, 450))).toBeNull();
  });

  it("never returns a subpixel height", () => {
    const before = image(333, 100, 0, 0);
    const after = ratioResetPatch(before);
    expect(after).not.toBeNull();
    expect(after?.height).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(after?.height ?? 0)).toBe(true);
  });
});

describe("imageInsertStateDrifted (فاز ۳۴ — «زمان صفر»)", () => {
  it("stays false at the exact insert snapshot (even when placed ≠ natural)", () => {
    // A 2200×1400 photo clamped to a 480-wide placement at insert.
    const object = image(480, 305, 312, 96);
    expect(imageInsertStateDrifted(object)).toBe(false);
  });

  it("flags size, position and rotation drift separately", () => {
    expect(imageInsertStateDrifted({ ...image(480, 305), width: 300 })).toBe(true);
    expect(
      imageInsertStateDrifted({
        ...image(480, 305),
        position: vec2(401, 96),
      }),
    ).toBe(true);
    expect(
      imageInsertStateDrifted({ ...image(480, 305), rotation: 0.4 }),
    ).toBe(true);
  });

  it("tolerates sub-half-pixel jitter and sub-0.57° rotation noise", () => {
    const object = image(480, 305, 100, 100);
    expect(
      imageInsertStateDrifted({
        ...object,
        width: object.width + 0.4,
        position: vec2(object.position.x + 0.3, object.position.y),
        rotation: 0.009,
      }),
    ).toBe(false);
  });

  it("legacy objects without a snapshot fall back to natural drift", () => {
    const legacy: ImageObjectData = { ...image(800, 450), initial: undefined };
    expect(imageInsertStateDrifted(legacy)).toBe(true);
    const atNatural: ImageObjectData = {
      ...image(1600, 900),
      initial: undefined,
    };
    expect(imageInsertStateDrifted(atNatural)).toBe(false);
  });
});

describe("insertStateResetPatch (فاز ۳۴ — «بازنشانی به حالت درج»)", () => {
  it("restores the exact insert size AND position (no centre math)", () => {
    const before = { ...image(480, 305, 312, 96), width: 300, height: 260 };
    const after = insertStateResetPatch(before);
    expect(after).not.toBeNull();
    expect(after?.width).toBe(480);
    expect(after?.height).toBe(305);
    expect(after?.position.x).toBe(312);
    expect(after?.position.y).toBe(96);
    expect(after?.rotation).toBe(0);
  });

  it("restores rotation drift in the same single patch", () => {
    const before = { ...image(480, 305, 312, 96), rotation: Math.PI / 3 };
    const after = insertStateResetPatch(before);
    expect(after?.rotation).toBe(0);
    // Every non-transform field rides verbatim (one command, exact undo).
    expect(after?.id).toBe(before.id);
    expect(after?.src).toBe(before.src);
    expect(after?.initial).toBe(before.initial);
  });

  it("returns null when exactly at the insert state", () => {
    expect(insertStateResetPatch(image(480, 305))).toBeNull();
  });

  it("legacy objects without a snapshot degrade to the natural reset", () => {
    const legacy: ImageObjectData = {
      ...image(800, 400, 200, 300),
      initial: undefined,
    };
    const after = insertStateResetPatch(legacy);
    expect(after).not.toBeNull();
    // The فاز ۲۳ centre-preserving natural reset, not a fabricated insert.
    expect(after?.width).toBe(1600);
    expect(after?.height).toBe(900);
    expect(after?.position.x).toBeCloseTo(200 + 400 - 800, 5);
  });
});
