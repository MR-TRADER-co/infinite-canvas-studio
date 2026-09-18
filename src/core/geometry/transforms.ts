/**
 * Pure affine transform helpers (translate/rotate/scale matrices).
 *
 * Matrices use the 6-element affine form `[a b c d e f]` matching the
 * Canvas 2D `setTransform` component order, so renderer code can apply them
 * directly. Point application follows the Canvas convention:
 * `x' = a·x + c·y + e` and `y' = b·x + d·y + f`.
 */
import { vec2 } from "@/core/geometry/Vec2";
import type { Vec2 } from "@/core/geometry/Vec2";

/** Affine 2D matrix in Canvas `setTransform` component order. */
export interface Mat3 {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/**
 * @returns the identity matrix.
 */
export function identityMat3(): Mat3 {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/**
 * Builds a translation matrix.
 *
 * @param tx - translation along x.
 * @param ty - translation along y.
 * @returns the matrix mapping `(x, y)` to `(x + tx, y + ty)`.
 */
export function translationMatrix(tx: number, ty: number): Mat3 {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

/**
 * Builds a rotation matrix around the origin.
 *
 * @param radians - rotation angle (counter-clockwise) around the origin.
 * @returns the rotation matrix.
 */
export function rotationMatrix(radians: number): Mat3 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/**
 * Builds a scale matrix.
 *
 * @param sx - scale factor along x.
 * @param sy - scale factor along y.
 * @returns the scale matrix.
 */
export function scaleMatrix(sx: number, sy: number): Mat3 {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/**
 * Composes two matrices (applies `m2` after `m1`).
 *
 * The result satisfies `applyMat3(multiplyMat3(m1, m2), p) ==
 * applyMat3(m2, applyMat3(m1, p))` for every point `p`.
 *
 * @param m1 - first matrix (applied first).
 * @param m2 - second matrix (applied second).
 * @returns the composed matrix.
 */
export function multiplyMat3(m1: Mat3, m2: Mat3): Mat3 {
  return {
    a: m2.a * m1.a + m2.c * m1.b,
    b: m2.b * m1.a + m2.d * m1.b,
    c: m2.a * m1.c + m2.c * m1.d,
    d: m2.b * m1.c + m2.d * m1.d,
    e: m2.a * m1.e + m2.c * m1.f + m2.e,
    f: m2.b * m1.e + m2.d * m1.f + m2.f,
  };
}

/**
 * Transforms a point by a matrix.
 *
 * @param matrix - the transform to apply.
 * @param point - the point to transform.
 * @returns the transformed point.
 */
export function applyMat3(matrix: Mat3, point: Vec2): Vec2 {
  return vec2(
    matrix.a * point.x + matrix.c * point.y + matrix.e,
    matrix.b * point.x + matrix.d * point.y + matrix.f,
  );
}
