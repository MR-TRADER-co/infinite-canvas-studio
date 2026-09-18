/**
 * Migration contract: one step of the project-file version chain.
 *
 * PHASE 0 STUB — fully implemented in a later phase.
 */

/** One migration step between consecutive file versions. */
export interface Migration {
  /** File version this step migrates from. */
  readonly fromVersion: number;
  /** File version this step migrates to. */
  readonly toVersion: number;
  /**
   * Transforms a payload of `fromVersion` into one of `toVersion`.
   *
   * @param data - the payload to transform.
   * @returns the transformed payload.
   */
  migrate(data: unknown): unknown;
}
