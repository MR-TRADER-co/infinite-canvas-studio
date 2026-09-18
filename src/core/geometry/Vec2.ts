/**
 * 2D vector/point primitives for world and screen space.
 *
 * All helpers are pure functions; vectors are immutable value objects.
 */

/** A point or vector in 2D space. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** The zero vector `(0, 0)`. */
export const ZERO: Vec2 = { x: 0, y: 0 };

/**
 * Builds a vector from components.
 *
 * @param x - horizontal component.
 * @param y - vertical component.
 * @returns the vector `(x, y)`.
 */
export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

/**
 * Adds two vectors.
 *
 * @param a - left operand.
 * @param b - right operand.
 * @returns the vector sum `a + b`.
 */
export function vecAdd(a: Vec2, b: Vec2): Vec2 {
  return vec2(a.x + b.x, a.y + b.y);
}

/**
 * Subtracts two vectors.
 *
 * @param a - left operand.
 * @param b - right operand.
 * @returns the vector difference `a - b`.
 */
export function vecSubtract(a: Vec2, b: Vec2): Vec2 {
  return vec2(a.x - b.x, a.y - b.y);
}

/**
 * Scales a vector by a scalar.
 *
 * @param v - vector to scale.
 * @param factor - scalar multiplier.
 * @returns the scaled vector `v * factor`.
 */
export function vecScale(v: Vec2, factor: number): Vec2 {
  return vec2(v.x * factor, v.y * factor);
}

/**
 * @param v - vector to measure.
 * @returns the Euclidean length `|v|`.
 */
export function vecLength(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/**
 * @param a - first point.
 * @param b - second point.
 * @returns the Euclidean distance between `a` and `b`.
 */
export function vecDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
