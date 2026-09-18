/**
 * Migration 5 → 6 tests (فاز P1 — §1.7.4): the additive step joining
 * the PDF object type — untouched payloads pass through, `core.pdf`
 * payloads normalise (thumbHash coalesce + currentPage clamp), older
 * versions walk forward, and the chain refuses gaps.
 */
import { describe, expect, it } from "vitest";
import { MigrationV5toV6 } from "@/persistence/migrations/MigrationV5toV6";
import {
  MIGRATIONS,
  runMigrations,
} from "@/persistence/migrations/index";

const HASH = "e".repeat(64);
const THUMB = "f".repeat(64);

interface Root {
  schemaVersion: number;
  scene: { objects: unknown[] };
}

function v5Root(): Root {
  return {
    schemaVersion: 5,
    scene: {
      objects: [
        { typeId: "core.shape", id: "s1", shapeKind: "rectangle" },
        {
          typeId: "core.pdf",
          id: "p1",
          assetHash: HASH,
          thumbHash: THUMB,
          originalName: "doc.pdf",
          pageCount: 10,
          currentPage: 3,
          naturalWidth: 595,
          naturalHeight: 842,
          width: 300,
          height: 424,
        },
        {
          typeId: "core.video",
          id: "v1",
          assetHash: HASH,
          thumbHash: null,
          originalName: "clip.mp4",
          mimeType: "video/mp4",
          durationMs: 1000,
          naturalWidth: 640,
          naturalHeight: 360,
          width: 640,
          height: 360,
        },
      ],
    },
  };
}

describe("MigrationV5toV6 (فاز P1)", () => {
  it("bumps the version and passes foreign types through verbatim", () => {
    const root = v5Root();
    const migrated = new MigrationV5toV6().migrate(root) as Root;
    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.scene.objects[0]).toEqual(v5Root().scene.objects[0]);
    expect(migrated.scene.objects[2]).toEqual(v5Root().scene.objects[2]);
  });

  it("normalises core.pdf payloads (thumbHash + page clamps)", () => {
    const root = v5Root();
    (root.scene.objects[1] as Record<string, unknown>).thumbHash = 7;
    (root.scene.objects[1] as Record<string, unknown>).currentPage = 42;
    const migrated = new MigrationV5toV6().migrate(root) as Root;
    const pdf = migrated.scene.objects[1] as Record<string, unknown>;
    expect(pdf.thumbHash).toBeNull();
    expect(pdf.currentPage).toBe(10);
    expect(pdf.pageCount).toBe(10);
  });

  it("keeps a valid pdf payload byte-identical (additive only)", () => {
    const root = v5Root();
    const before = JSON.stringify(root.scene.objects[1]);
    const migrated = new MigrationV5toV6().migrate(root) as Root;
    expect(JSON.stringify(migrated.scene.objects[1])).toBe(before);
  });

  it("chains 5 → 6 through runMigrations", () => {
    const walked = runMigrations(v5Root(), 5, 6, MIGRATIONS) as Root;
    expect(walked.schemaVersion).toBe(6);
    // The FULL chain from v1 still reaches 6 (no gap).
    const fromV1 = runMigrations(
      { schemaVersion: 1, scene: { objects: [] } },
      1,
      6,
      MIGRATIONS,
    ) as Record<string, unknown>;
    expect(fromV1.schemaVersion).toBe(6);
  });

  it("tolerates non-object input defensively", () => {
    expect(new MigrationV5toV6().migrate(null)).toBeNull();
    expect(new MigrationV5toV6().migrate("string")).toBe("string");
  });
});
