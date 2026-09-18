/**
 * Unit tests for the poster seek point (فاز M1 — A.2.2, ACM1.7):
 * `min(1s, 10% of the duration)`, with hostile inputs clamped to 0.
 */
import { describe, expect, it } from "vitest";
import { pickTimestamp } from "@/media/pickTimestamp";

describe("pickTimestamp (فاز M1 — A.2.2)", () => {
  it("seeks 10% into short clips", () => {
    expect(pickTimestamp(5_000)).toBeCloseTo(0.5, 10);
  });

  it("caps at one second for longer clips", () => {
    expect(pickTimestamp(20_000)).toBe(1);
    expect(pickTimestamp(3_600_000)).toBe(1);
  });

  it("returns 0 exactly at the boundary of a 10s clip", () => {
    expect(pickTimestamp(10_000)).toBe(1);
    expect(pickTimestamp(9_999)).toBeCloseTo(0.9999, 10);
  });

  it("clamps degenerate durations to 0", () => {
    expect(pickTimestamp(0)).toBe(0);
    expect(pickTimestamp(-100)).toBe(0);
    expect(pickTimestamp(Number.NaN)).toBe(0);
    expect(pickTimestamp(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
