/**
 * Barrel of every known project-file migration.
 *
 * Migration semantics: a file of version `v < current` is walked forward one
 * step at a time until it reaches `current`. Each step is looked up in the
 * chain by its `fromVersion`; a missing step means the file cannot be
 * upgraded safely and the load is refused. Version 6 is current, so the
 * chain holds 1 → 2 (the registry envelope, R4.4a), 2 → 3 (the
 * named-styles section, R13.3), 3 → 4 (the video object type, فاز M1),
 * 4 → 5 (the audio object type, فاز A1) and 5 → 6 (the PDF object
 * type, فاز P1).
 */
import type { Migration } from "@/persistence/migrations/Migration";
import { MigrationV1toV2 } from "@/persistence/migrations/MigrationV1toV2";
import { MigrationV2toV3 } from "@/persistence/migrations/MigrationV2toV3";
import { MigrationV3toV4 } from "@/persistence/migrations/MigrationV3toV4";
import { MigrationV4toV5 } from "@/persistence/migrations/MigrationV4toV5";
import { MigrationV5toV6 } from "@/persistence/migrations/MigrationV5toV6";

/**
 * All known migrations, ordered so that each step's `fromVersion` chains to
 * the previous step's `toVersion` (1 → 2 → 3 → 4 → 5 → 6 today).
 */
export const MIGRATIONS: readonly Migration[] = [
  new MigrationV1toV2(),
  new MigrationV2toV3(),
  new MigrationV3toV4(),
  new MigrationV4toV5(),
  new MigrationV5toV6(),
];

/**
 * Walks a payload forward through the migration chain until it reaches the
 * target version.
 *
 * @param data - the payload read from a file of `fromVersion`.
 * @param fromVersion - the version the payload was written with.
 * @param toVersion - the version to upgrade to (the serializer's current).
 * @param chain - the migration chain to walk (defaults to {@link MIGRATIONS}).
 * @returns the migrated payload, or null when a step is missing from the
 *          chain (the file cannot be upgraded safely).
 */
export function runMigrations(
  data: unknown,
  fromVersion: number,
  toVersion: number,
  chain: readonly Migration[] = MIGRATIONS,
): unknown {
  if (fromVersion === toVersion) {
    return data;
  }
  let current = data;
  let version = fromVersion;
  // Bounded by the chain length: every step consumes one migration.
  for (let guard = 0; version < toVersion; guard += 1) {
    if (guard > chain.length) {
      return null;
    }
    const step = chain.find((migration) => migration.fromVersion === version);
    if (step === undefined) {
      return null;
    }
    current = step.migrate(current);
    version = step.toVersion;
  }
  return current;
}
