/**
 * Unit tests for the MigrationV3toV4 step (فاز M1 — §1.7.4): older
 * files pass through untouched (only the schemaVersion bumps),
 * `core.video` payloads get their optional hash fields normalised, and
 * non-video objects are never reinterpreted.
 */
import { describe, expect, it } from "vitest";
import { MigrationV3toV4 } from "@/persistence/migrations/MigrationV3toV4";

const HASH = "a".repeat(64);

describe("MigrationV3toV4 (فاز M1 — §1.7.4)", () => {
  it("bumps the schema version of a plain v3 file without touching it", () => {
    const v3 = {
      schemaVersion: 3,
      meta: { magic: ".icb", savedAt: 1 },
      camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
      scene: { objects: [{ typeId: "core.shape", typeVersion: 1, id: "s1" }] },
      plugins: {},
      styles: { version: 1, styles: [] },
    };
    const v4 = new MigrationV3toV4().migrate(v3);
    expect(v4).toEqual({ ...v3, schemaVersion: 4 });
  });

  it("normalises core.video payloads (malformed hashes coalesce)", () => {
    const v3 = {
      schemaVersion: 3,
      scene: {
        objects: [
          {
            typeId: "core.video",
            typeVersion: 1,
            id: "v1",
            assetHash: HASH,
            thumbHash: "garbage",
            origAssetHash: 42,
          },
        ],
      },
    };
    const v4 = new MigrationV3toV4().migrate(v3) as {
      scene: { objects: Record<string, unknown>[] };
    };
    const video = v4.scene.objects[0] ?? {};
    expect(video.thumbHash).toBeNull();
    expect("origAssetHash" in video).toBe(false);
    expect(video.assetHash).toBe(HASH);
  });

  it("keeps well-formed video hashes verbatim", () => {
    const v3 = {
      schemaVersion: 3,
      scene: {
        objects: [
          {
            typeId: "core.video",
            assetHash: HASH,
            thumbHash: "b".repeat(64),
            origAssetHash: "c".repeat(64),
          },
        ],
      },
    };
    const v4 = new MigrationV3toV4().migrate(v3) as {
      scene: { objects: Record<string, unknown>[] };
    };
    expect(v4.scene.objects[0]?.thumbHash).toBe("b".repeat(64));
    expect(v4.scene.objects[0]?.origAssetHash).toBe("c".repeat(64));
  });

  it("passes unknown-type objects through verbatim (the §1.7.4 law)", () => {
    const v3 = {
      schemaVersion: 3,
      scene: { objects: [{ typeId: "third.plugin", anything: { deep: true } }] },
    };
    const v4 = new MigrationV3toV4().migrate(v3) as {
      scene: { objects: Record<string, unknown>[] };
    };
    expect(v4.scene.objects[0]).toEqual({
      typeId: "third.plugin",
      anything: { deep: true },
    });
  });

  it("defends against non-object roots", () => {
    expect(new MigrationV3toV4().migrate(null)).toBe(null);
    expect(new MigrationV3toV4().migrate(42)).toBe(42);
  });
});
