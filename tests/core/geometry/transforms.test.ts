/** Unit tests for the pure affine transform helpers. */
import { describe, expect, it } from "vitest";
import {
  applyMat3,
  identityMat3,
  multiplyMat3,
  rotationMatrix,
  scaleMatrix,
  translationMatrix,
} from "@/core/geometry/transforms";
import { vec2 } from "@/core/geometry/Vec2";

/** Compares two points with a tolerance (floating-point safe). */
function expectVecClose(
  actual: { x: number; y: number },
  x: number,
  y: number,
): void {
  expect(Math.abs(actual.x - x)).toBeLessThan(1e-9);
  expect(Math.abs(actual.y - y)).toBeLessThan(1e-9);
}

describe("transforms", () => {
  it("identityMat3 maps every point to itself", () => {
    expectVecClose(applyMat3(identityMat3(), vec2(3, -7)), 3, -7);
  });

  it("translationMatrix shifts points", () => {
    const m = translationMatrix(10, -4);
    expectVecClose(applyMat3(m, vec2(1, 1)), 11, -3);
    expectVecClose(applyMat3(m, vec2(0, 0)), 10, -4);
  });

  it("rotationMatrix rotates counter-clockwise around the origin", () => {
    const quarter = rotationMatrix(Math.PI / 2);
    // (1, 0) rotated by +90° CCW → (0, 1).
    expectVecClose(applyMat3(quarter, vec2(1, 0)), 0, 1);
    // (0, 1) rotated by +90° CCW → (-1, 0).
    expectVecClose(applyMat3(quarter, vec2(0, 1)), -1, 0);
  });

  it("rotationMatrix(π) maps (x, y) to (-x, -y)", () => {
    const half = rotationMatrix(Math.PI);
    const p = applyMat3(half, vec2(2, 5));
    expect(Math.abs(p.x + 2)).toBeLessThan(1e-9);
    expect(Math.abs(p.y + 5)).toBeLessThan(1e-9);
  });

  it("scaleMatrix scales components", () => {
    expectVecClose(applyMat3(scaleMatrix(2, 3), vec2(4, 5)), 8, 15);
  });

  it("multiplyMat3 composes left-to-right (m2 applied after m1)", () => {
    const translate = translationMatrix(5, 0);
    const scale = scaleMatrix(2, 2);
    const composed = multiplyMat3(translate, scale);
    // translate first: (1,1) → (6,1); then scale: → (12,2).
    expectVecClose(applyMat3(composed, vec2(1, 1)), 12, 2);
  });

  it("composition order matters (scale-then-translate differs)", () => {
    const translate = translationMatrix(5, 0);
    const scale = scaleMatrix(2, 2);
    const scaleFirst = multiplyMat3(scale, translate);
    // scale first: (1,1) → (2,2); then translate: → (7,2).
    expectVecClose(applyMat3(scaleFirst, vec2(1, 1)), 7, 2);
  });

  it("composition is associative", () => {
    const a = translationMatrix(3, -2);
    const b = rotationMatrix(0.7);
    const c = scaleMatrix(1.5, 0.5);
    const left = multiplyMat3(multiplyMat3(a, b), c);
    const right = multiplyMat3(a, multiplyMat3(b, c));
    const p = vec2(4, 9);
    const fromLeft = applyMat3(left, p);
    const fromRight = applyMat3(right, p);
    expect(Math.abs(fromLeft.x - fromRight.x)).toBeLessThan(1e-9);
    expect(Math.abs(fromLeft.y - fromRight.y)).toBeLessThan(1e-9);
  });

  it("translation and rotation composition matches manual math", () => {
    // rotate 90° then translate by (10, 20): (1,0) → (0,1) → (10,21).
    const m = multiplyMat3(
      rotationMatrix(Math.PI / 2),
      translationMatrix(10, 20),
    );
    expectVecClose(applyMat3(m, vec2(1, 0)), 10, 21);
  });
});
