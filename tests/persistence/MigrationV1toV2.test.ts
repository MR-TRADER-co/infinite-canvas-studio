/**
 * Unit tests for the v1 → v2 migration step (R4.4a/AC4.6): the envelope
 * restructure (magic/version/savedAt → schemaVersion/meta), the kind →
 * namespaced typeId rename (unknown kinds preserved verbatim for the
 * opaque path), and runMigrations' chain behaviour on TWO fixture
 * versions (v1 and v2).
 */
import { describe, expect, it } from "vitest";
import { MigrationV1toV2 } from "@/persistence/migrations/MigrationV1toV2";
import { MIGRATIONS, runMigrations } from "@/persistence/migrations";
import { VersionedSerializer } from "@/persistence/VersionedSerializer";
import type { ProjectData } from "@/persistence/ProjectFile";

/** The migration under test. */
const migration = new MigrationV1toV2();

/** A well-formed v1 root (two known + one unknown kind). */
function v1Root(): Record<string, unknown> {
  return {
    magic: ".icb",
    version: 1,
    savedAt: 1700000000000,
    scene: {
      camera: { x: 1, y: 2, zoom: 3, rotation: 0.5 },
      objects: [
        {
          id: "obj-1",
          kind: "shape",
          position: { x: 0, y: 0 },
          rotation: 0,
          zIndex: 0,
          visible: true,
          locked: false,
          shapeKind: "rectangle",
          width: 10,
          height: 10,
          fill: "#fff",
          stroke: "#000",
          strokeWidth: 1,
        },
        {
          id: "obj-2",
          kind: "textBox",
          position: { x: 5, y: 5 },
          rotation: 0,
          zIndex: 1,
          visible: true,
          locked: false,
          width: 100,
          height: 40,
          text: "سلام",
          doc: null,
          sizeMode: "auto",
          fontSize: 20,
          color: "token://text",
        },
        {
          id: "obj-3",
          kind: "plugin.widget",
          position: { x: 9, y: 9 },
          anything: { deep: [1, 2, 3] },
        },
      ],
    },
  };
}

describe("MigrationV1toV2", () => {
  it("declares the 1 → 2 step", () => {
    expect(migration.fromVersion).toBe(1);
    expect(migration.toVersion).toBe(2);
  });

  it("restructures the envelope onto the v2 layout (R4.2)", () => {
    const migrated = migration.migrate(v1Root()) as Record<string, unknown>;
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.meta).toEqual({ magic: ".icb", savedAt: 1700000000000 });
    expect(migrated.camera).toEqual({ x: 1, y: 2, zoom: 3, rotation: 0.5 });
    expect(migrated.plugins).toEqual({});
    expect(migrated.magic).toBeUndefined();
    expect(migrated.version).toBeUndefined();
  });

  it("renames known kinds to their namespaced typeIds", () => {
    const migrated = migration.migrate(v1Root()) as {
      scene: { objects: Record<string, unknown>[] };
    };
    expect(migrated.scene.objects[0]?.typeId).toBe("core.shape");
    expect(migrated.scene.objects[0]?.kind).toBeUndefined();
    expect(migrated.scene.objects[0]?.id).toBe("obj-1");
    expect(migrated.scene.objects[1]?.typeId).toBe("core.textBox");
  });

  it("keeps UNKNOWN kinds verbatim (the opaque path, §1.7.4)", () => {
    const migrated = migration.migrate(v1Root()) as {
      scene: { objects: Record<string, unknown>[] };
    };
    const unknown = migrated.scene.objects[2];
    expect(unknown?.typeId).toBe("plugin.widget");
    expect(unknown?.kind).toBeUndefined();
    expect(unknown?.anything).toEqual({ deep: [1, 2, 3] });
  });

  it("passes non-object input through defensively", () => {
    expect(migration.migrate(null)).toBe(null);
    expect(migration.migrate("x")).toBe("x");
  });

  it("keeps a corrupt (non-array) objects field verbatim for the strict gate", () => {
    const root = {
      magic: ".icb",
      version: 1,
      savedAt: 0,
      scene: { objects: "oops", camera: {} },
    };
    const migrated = migration.migrate(root) as { scene: { objects: unknown } };
    expect(migrated.scene.objects).toBe("oops");
  });
});

describe("runMigrations chain (AC4.6 — two fixture versions)", () => {
  it("registers the step in the global chain", () => {
    expect(MIGRATIONS).toHaveLength(5);
    expect(MIGRATIONS[0]).toBeInstanceOf(MigrationV1toV2);
  });

  it("fixture #1: a v1 file migrates to a loadable v2 document", () => {
    const serializer = new VersionedSerializer();
    const migrated = runMigrations(
      v1Root(),
      1,
      serializer.currentVersion,
    ) as Record<string, unknown>;
    const outcome = serializer.deserialize(JSON.stringify({ ...migrated }));
    expect(outcome?.status).toBe("ok");
    if (outcome?.status !== "ok") {
      return;
    }
    expect(outcome.savedAt).toBe(1700000000000);
    expect(outcome.data.objects).toHaveLength(3);
    // The unknown kind materialised as an opaque placeholder.
    expect(outcome.data.objects[2]?.kind).toBe("opaque");
  });

  it("fixture #2: a v2 file (current) passes through unchanged", () => {
    const serializer = new VersionedSerializer();
    const data: ProjectData = {
      camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
      objects: [],
      plugins: { "x.plugin": { data: 1 } },
    };
    const payload = serializer.serialize(data, 1700000000001);
    const outcome = serializer.deserialize(payload);
    expect(outcome?.status).toBe("ok");
    if (outcome?.status === "ok") {
      expect(outcome.savedAt).toBe(1700000000001);
      expect(outcome.data.plugins).toEqual({ "x.plugin": { data: 1 } });
    }
  });

  it("refuses versions with a missing chain step", () => {
    // v0 cannot reach v2 (chain starts at 1).
    expect(runMigrations({ magic: ".icb", version: 0 }, 0, 2)).toBeNull();
    // A custom chain without the 1→2 step refuses v1 files.
    expect(runMigrations(v1Root(), 1, 2, [])).toBeNull();
  });
});
