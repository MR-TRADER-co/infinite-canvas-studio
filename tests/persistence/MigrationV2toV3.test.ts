/**
 * Migration 2 → 3 tests (R13.3): the styles section is purely additive.
 */
import { describe, expect, it } from "vitest";
import { MigrationV2toV3 } from "@/persistence/migrations/MigrationV2toV3";
import { runMigrations } from "@/persistence/migrations";
import { MIGRATIONS } from "@/persistence/migrations";

describe("MigrationV2toV3 (R13.3)", () => {
  it("declares the 2 → 3 step", () => {
    const migration = new MigrationV2toV3();
    expect(migration.fromVersion).toBe(2);
    expect(migration.toVersion).toBe(3);
  });

  it("adds the empty styles section and bumps schemaVersion", () => {
    const migration = new MigrationV2toV3();
    const migrated = migration.migrate({
      schemaVersion: 2,
      meta: { magic: ".icb", savedAt: 1 },
      camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
      scene: { objects: [{ typeId: "core.shape", data: {} }] },
      plugins: {},
    }) as Record<string, unknown>;
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.styles).toEqual({ version: 1, styles: [] });
    // Everything else passes through untouched.
    expect(migrated.camera).toEqual({ x: 0, y: 0, zoom: 1, rotation: 0 });
    expect(migrated.plugins).toEqual({});
  });

  it("keeps a pre-existing (future-authored) styles section verbatim", () => {
    const migration = new MigrationV2toV3();
    const existing = { version: 1, styles: [{ id: "user.text.9" }] };
    const migrated = migration.migrate({
      schemaVersion: 2,
      styles: existing,
    }) as Record<string, unknown>;
    expect(migrated.styles).toBe(existing);
  });

  it("passes non-object payloads through defensively", () => {
    expect(new MigrationV2toV3().migrate(42)).toBe(42);
    expect(new MigrationV2toV3().migrate(null)).toBeNull();
  });

  it("walks the full chain 1 → 2 → 3 from a v1 file", () => {
    const v1 = {
      magic: ".icb",
      version: 1,
      savedAt: 5,
      scene: {
        camera: { x: 1, y: 2, zoom: 1, rotation: 0 },
        objects: [{ kind: "shape", id: "a" }],
      },
    };
    const migrated = runMigrations(v1, 1, 3, MIGRATIONS) as Record<
      string,
      unknown
    >;
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.styles).toEqual({ version: 1, styles: [] });
  });
});
