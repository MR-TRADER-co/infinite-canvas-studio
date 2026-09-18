/**
 * Text content geometry tests (R3A.7 / AC3A.6): FIXED vs AUTO width
 * behaviour, the AUTO maximum clamp, the minimum caret width, and the
 * direction-aware growth anchor (RTL pins the right edge, LTR the left).
 */
import { describe, expect, it } from "vitest";
import { TEXT_PADDING_X } from "@/core/model/TextBoxObject";
import {
  resolveContentGeometry,
  TEXT_AUTO_MAX_WIDTH,
} from "@/text/view/TextMetrics";

/** Base inputs of a 20-unit font box measured at natural 150×64. */
const BASE = {
  mode: "fixed" as const,
  naturalWidth: 150,
  naturalHeight: 64,
  currentX: 40,
  currentWidth: 220,
  direction: "rtl" as const,
  fontSize: 20,
};

describe("resolveContentGeometry", () => {
  it("FIXED mode keeps the current width; height follows content", () => {
    const result = resolveContentGeometry({
      ...BASE,
      mode: "fixed",
      naturalHeight: 90,
    });
    expect(result.width).toBe(220);
    expect(result.height).toBe(90);
    expect(result.x).toBe(40);
  });

  it("AUTO mode grows the width to the natural width", () => {
    const result = resolveContentGeometry({ ...BASE, mode: "auto" });
    expect(result.width).toBe(150);
  });

  it("AUTO mode clamps the width to the maximum, then wraps", () => {
    const result = resolveContentGeometry({
      ...BASE,
      mode: "auto",
      naturalWidth: 5000,
    });
    expect(result.width).toBe(TEXT_AUTO_MAX_WIDTH);
  });

  it("AUTO mode enforces a minimum caret width on empty documents", () => {
    const result = resolveContentGeometry({
      ...BASE,
      mode: "auto",
      naturalWidth: 0,
    });
    expect(result.width).toBe(2 * TEXT_PADDING_X + 15);
  });

  it("RTL AUTO growth pins the right edge (the box grows leftward)", () => {
    const result = resolveContentGeometry({
      ...BASE,
      mode: "auto",
      direction: "rtl",
    });
    // x + width invariant: the RIGHT edge stays at currentX + currentWidth.
    expect(result.x + result.width).toBe(BASE.currentX + BASE.currentWidth);
    expect(result.x).toBe(BASE.currentX - (150 - 220));
  });

  it("RTL AUTO shrink keeps the right edge too (no drift, AC3A.6)", () => {
    const result = resolveContentGeometry({
      ...BASE,
      mode: "auto",
      currentWidth: 300,
      direction: "rtl",
    });
    // Shrinking from 300 to the natural 150 grows the box leftward: the
    // RIGHT edge stays pinned at currentX + currentWidth.
    expect(result.x + result.width).toBe(BASE.currentX + 300);
    expect(result.x).toBe(BASE.currentX + 150);
  });

  it("LTR AUTO growth pins the left edge", () => {
    const result = resolveContentGeometry({
      ...BASE,
      mode: "auto",
      direction: "ltr",
    });
    expect(result.x).toBe(BASE.currentX);
  });

  it("FIXED growth never shifts the anchor regardless of direction", () => {
    const rtl = resolveContentGeometry({
      ...BASE,
      mode: "fixed",
      direction: "rtl",
    });
    const ltr = resolveContentGeometry({
      ...BASE,
      mode: "fixed",
      direction: "ltr",
    });
    expect(rtl.x).toBe(BASE.currentX);
    expect(ltr.x).toBe(BASE.currentX);
  });

  it("height floors at a fraction of the font size (degenerate reads)", () => {
    const result = resolveContentGeometry({ ...BASE, naturalHeight: 0 });
    expect(result.height).toBe(15);
  });
});
