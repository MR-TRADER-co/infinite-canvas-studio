/**
 * فاز ۲۶ «کیفیت انتخاب» — the selection-chrome pure helpers: the
 * multi-select per-object outline style and the COUNT chip layout
 * (above the frame's top-right corner, RTL-first, viewport-clipped).
 */
import { describe, expect, it } from "vitest";
import {
  DARK_SELECTION_COLORS,
  LIGHT_SELECTION_COLORS,
  perObjectOutlineStyle,
  selectionCountChipRect,
} from "@/rendering/HandlesRenderer";

describe("perObjectOutlineStyle (فاز ۲۶ multi-select strength)", () => {
  it("single selections keep the subtle palette hairline", () => {
    const single = perObjectOutlineStyle(false, DARK_SELECTION_COLORS);
    expect(single.color).toBe(DARK_SELECTION_COLORS.objectOutline);
    expect(single.lineWidth).toBe(1);
  });

  it("multi selections paint every member at 75 % accent alpha, 1.5 px (dark theme)", () => {
    const multi = perObjectOutlineStyle(true, DARK_SELECTION_COLORS);
    expect(multi.color).toBe("oklch(0.72 0.17 340 / 75%)");
    expect(multi.lineWidth).toBe(1.5);
  });

  it("multi selections paint every member at 75 % accent alpha, 1.5 px (light theme)", () => {
    const multi = perObjectOutlineStyle(true, LIGHT_SELECTION_COLORS);
    expect(multi.color).toBe("oklch(0.55 0.21 340 / 75%)");
    expect(multi.lineWidth).toBe(1.5);
  });

  it("injects the alpha into functional colours without touching the palette", () => {
    const before = DARK_SELECTION_COLORS.accent;
    perObjectOutlineStyle(true, DARK_SELECTION_COLORS);
    expect(DARK_SELECTION_COLORS.accent).toBe(before);
  });
});

describe("selectionCountChipRect (فاز ۲۶ count chip layout)", () => {
  it("rides ABOVE the frame's top edge, right-aligned with the right edge", () => {
    const chip = selectionCountChipRect(
      { x: 100, y: 200, width: 300, height: 150 },
      10,
    );
    // width = max(18, 10 + 16) = 26; x = 100 + 300 - 26 = 374;
    // y = 200 - 18 - 7 = 175.
    expect(chip).toEqual({ x: 374, y: 175, width: 26, height: 18 });
  });

  it("is at least as wide as tall (a pill, never a sliver)", () => {
    const chip = selectionCountChipRect(
      { x: 0, y: 100, width: 50, height: 50 },
      0,
    );
    expect(chip.width).toBeGreaterThanOrEqual(chip.height);
    expect(chip.width).toBe(18);
  });

  it("flips INSIDE the frame when the chip would clip the viewport's top", () => {
    const chip = selectionCountChipRect(
      { x: 100, y: 10, width: 300, height: 150 },
      10,
    );
    // Above would be 10 - 18 - 7 = -15 → flip inside: 10 + 7 = 17.
    expect(chip.y).toBe(17);
  });

  it("stays above the frame when there is exactly enough room", () => {
    const chip = selectionCountChipRect(
      { x: 100, y: 25, width: 300, height: 150 },
      10,
    );
    // 25 - 18 - 7 = 0 — exactly at the edge, not negative → stays above.
    expect(chip.y).toBe(0);
  });

  it("clamps the left edge so wide labels never cross the screen", () => {
    const chip = selectionCountChipRect(
      { x: 10, y: 200, width: 40, height: 40 },
      120,
    );
    // Unclamped x would be 10 + 40 - 152 = -102 → clamped to 4.
    expect(chip.x).toBe(4);
    expect(chip.width).toBe(136);
  });

  it("honours the sizing overrides (tests + future tuning)", () => {
    const chip = selectionCountChipRect(
      { x: 0, y: 100, width: 200, height: 100 },
      10,
      { height: 24, padX: 5, gap: 10 },
    );
    // width = max(24, 10 + 10) = 24; x = 200 - 24 = 176; y = 100 - 24 - 10 = 66.
    expect(chip).toEqual({ x: 176, y: 66, width: 24, height: 24 });
  });
});
