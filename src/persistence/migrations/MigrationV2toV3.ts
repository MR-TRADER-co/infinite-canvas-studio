/**
 * Migration step 2 → 3 (R13.3): adds the named-styles section to the
 * project file.
 *
 * v2 (R4.2):
 * ```json
 * { "schemaVersion": 2, "meta": {…}, "camera": {…},
 *   "scene": { "objects": […] }, "plugins": {} }
 * ```
 *
 * v3 (R13.3):
 * ```json
 * { "schemaVersion": 3, "meta": {…}, "camera": {…},
 *   "scene": { "objects": […] }, "plugins": {},
 *   "styles": { "version": 1, "styles": [] } }
 * ```
 *
 * The step is purely additive — every existing field passes through
 * untouched; files without a styles section gain the empty one (built-in
 * styles are re-materialised at boot and never persisted).
 */
import type { Migration } from "@/persistence/migrations/Migration";

/** One registered migration step of the project-file chain. */
export class MigrationV2toV3 implements Migration {
  public readonly fromVersion = 2;
  public readonly toVersion = 3;

  /**
   * Transforms a v2 root into the v3 layout.
   *
   * @param data - the parsed v2 file root.
   * @returns the v3 root (unknown input shapes pass through defensively —
   *          the serializer's structural validation refuses them later).
   */
  public migrate(data: unknown): unknown {
    if (typeof data !== "object" || data === null) {
      return data;
    }
    const root = { ...(data as Record<string, unknown>) } as Record<
      string,
      unknown
    >;
    // Purely additive: an existing (future-authored) styles section is
    // kept verbatim; everything else gains the empty section.
    root.styles ??= { version: 1, styles: [] };
    root.schemaVersion = this.toVersion;
    return root;
  }
}
