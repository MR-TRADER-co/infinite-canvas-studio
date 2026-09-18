/**
 * The poster-frame seek point of an imported video (فاز M1 — A.2.2).
 *
 * PURE and unit-tested (ACM1.7): `min(1s, 10% of the duration)` — early
 * enough to avoid black fade-ins on short clips, late enough to skip the
 * flat first frames of longer ones.
 */

/**
 * Picks the thumbnail seek point of a video.
 *
 * @param durationMs - the video's duration in milliseconds (from
 *        `loadedmetadata`); non-finite or non-positive values clamp to 0.
 * @returns the seek position in SECONDS (≤ 1).
 */
export function pickTimestamp(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }
  const tenPercentSeconds = (durationMs / 1000) * 0.1;
  return Math.min(1, tenPercentSeconds);
}
