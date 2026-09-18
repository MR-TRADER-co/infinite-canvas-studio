/** Unit tests for the 2D vector helpers. */
import { describe, expect, it } from "vitest";
import {
  ZERO,
  vec2,
  vecAdd,
  vecDistance,
  vecLength,
  vecScale,
  vecSubtract,
} from "@/core/geometry/Vec2";

describe("Vec2 helpers", () => {
  it("vec2 builds a vector from components", () => {
    expect(vec2(3, -4)).toEqual({ x: 3, y: -4 });
    expect(ZERO).toEqual({ x: 0, y: 0 });
  });

  it("vecAdd sums two vectors", () => {
    expect(vecAdd(vec2(1, 2), vec2(3, 5))).toEqual({ x: 4, y: 7 });
    expect(vecAdd(vec2(-1, 4), ZERO)).toEqual({ x: -1, y: 4 });
  });

  it("vecSubtract subtracts the second vector from the first", () => {
    expect(vecSubtract(vec2(5, 7), vec2(2, 3))).toEqual({ x: 3, y: 4 });
    expect(vecSubtract(vec2(1, 1), vec2(1, 1))).toEqual({ x: 0, y: 0 });
  });

  it("vecScale multiplies both components", () => {
    expect(vecScale(vec2(2, -3), 2)).toEqual({ x: 4, y: -6 });
    expect(vecScale(vec2(7, 9), 0)).toEqual({ x: 0, y: 0 });
    expect(vecScale(vec2(1, 1), -1)).toEqual({ x: -1, y: -1 });
  });

  it("vecLength computes the Euclidean length", () => {
    expect(vecLength(ZERO)).toBe(0);
    expect(vecLength(vec2(3, 4))).toBe(5);
    expect(vecLength(vec2(-3, 4))).toBe(5);
  });

  it("vecDistance computes the distance between points", () => {
    expect(vecDistance(vec2(0, 0), vec2(3, 4))).toBe(5);
    expect(vecDistance(vec2(1, 1), vec2(1, 1))).toBe(0);
    expect(vecDistance(vec2(-1, -1), vec2(2, 3))).toBe(5);
  });
});
