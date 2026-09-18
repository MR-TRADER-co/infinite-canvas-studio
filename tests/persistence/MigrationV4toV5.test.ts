/**
 * MigrationV4toV5 unit tests (فاز A1 — §1.7.4): the audio object type
 * joins the scene graph — additive + normalising, older files untouched.
 */
import { describe, expect, it } from "vitest";
import { MigrationV4toV5 } from "@/persistence/migrations/MigrationV4toV5";
import { runMigrations } from "@/persistence/migrations";

const HASH = "a".repeat(64);
const BAD = "not-a-hash";

describe("MigrationV4toV5", () => {
  const step = new MigrationV4toV5();

  it("declares the 4 → 5 step", () => {
    expect(step.fromVersion).toBe(4);
    expect(step.toVersion).toBe(5);
  });

  it("bumps the schema version and passes foreign objects verbatim", () => {
    const data = {
      schemaVersion: 4,
      scene: {
        objects: [
          { typeId: "core.textBox", id: "t1" },
          { typeId: "core.video", id: "v1", assetHash: HASH },
        ],
      },
    };
    const migrated = step.migrate(data) as typeof data;
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.scene.objects[0]).toEqual({ typeId: "core.textBox", id: "t1" });
    expect(migrated.scene.objects[1]).toEqual({
      typeId: "core.video",
      id: "v1",
      assetHash: HASH,
    });
  });

  it("normalises core.audio optional hash fields", () => {
    const data = {
      schemaVersion: 4,
      scene: {
        objects: [
          {
            typeId: "core.audio",
            assetHash: HASH,
            thumbHash: BAD,
            origAssetHash: 42,
          },
          {
            typeId: "core.audio",
            assetHash: HASH,
            thumbHash: "b".repeat(64),
            origAssetHash: "c".repeat(64),
          },
        ],
      },
    };
    const migrated = step.migrate(data) as typeof data;
    const first = migrated.scene.objects[0] as Record<string, unknown>;
    const second = migrated.scene.objects[1] as Record<string, unknown>;
    expect(first.thumbHash).toBeNull();
    expect(first.origAssetHash).toBeUndefined();
    expect(second.thumbHash).toBe("b".repeat(64));
    expect(second.origAssetHash).toBe("c".repeat(64));
  });

  it("passes non-object payloads through defensively", () => {
    expect(step.migrate(null)).toBeNull();
    expect(step.migrate("x")).toBe("x");
    expect(step.migrate(7)).toBe(7);
  });

  it("walks a v4 file to v5 through the registered chain", () => {
    const data = { schemaVersion: 4, scene: { objects: [] } };
    const migrated = runMigrations(data, 4, 5) as typeof data;
    expect(migrated.schemaVersion).toBe(5);
  });
});
