/**
 * Unit tests for the versioned .icb project file serializer (R4.2/R4.4):
 * the v2 registry envelope, the v1→v2 migration on load, the
 * future-version read-only outcome, the strict plugins passthrough and
 * the defensive corrupt-file refusals.
 */
import { describe, expect, it } from "vitest";
import { VersionedSerializer } from "@/persistence/VersionedSerializer";
import { PROJECT_FILE_VERSION, PROJECT_MAGIC } from "@/persistence/ProjectFile";
import type { ProjectData } from "@/persistence/ProjectFile";
import { vec2 } from "@/core/geometry/Vec2";
import type { FreehandObjectData } from "@/core/model/FreehandObject";

/** Builds a minimal valid project payload (two freehand strokes) for round-trips. */
function makeProjectData(): ProjectData {
  const first: FreehandObjectData = {
    id: "obj-1",
    kind: "freehand",
    position: vec2(3, 4),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    points: [vec2(3, 4), vec2(50, 60)],
    strokeColor: "primary",
    strokeWidth: 3,
    strokeStyle: "dashed",
  };
  const second: FreehandObjectData = {
    id: "obj-2",
    kind: "freehand",
    position: vec2(-3, -4),
    rotation: 0.5,
    zIndex: 1,
    visible: false,
    locked: true,
    points: [vec2(-3, -4), vec2(-50, -60)],
    strokeColor: "#22c55e",
    strokeWidth: 5,
    strokeStyle: "dotted",
  };
  return {
    camera: { x: 10, y: -4, zoom: 2, rotation: 0.75 },
    objects: [first, second],
  };
}

/** Serialises an arbitrary file root as raw JSON. */
function rawFile(root: Record<string, unknown>): string {
  return JSON.stringify(root);
}

/** A full v1 file of the given scene (the legacy envelope). */
function v1File(
  scene: ProjectData,
  extra: Record<string, unknown> = {},
): string {
  return rawFile({
    magic: ".icb",
    version: 1,
    savedAt: 1700000000000,
    scene: {
      camera: scene.camera,
      // v1 objects carry the un-namespaced `kind`.
      objects: scene.objects.map(({ kind, ...fields }) => ({
        kind,
        ...fields,
      })),
    },
    ...extra,
  });
}

describe("VersionedSerializer", () => {
  it("writes the current file version and exposes the header", () => {
    const serializer = new VersionedSerializer();
    expect(serializer.currentVersion).toBe(PROJECT_FILE_VERSION);
    expect(serializer.currentVersion).toBe(6);
    expect(serializer.header()).toEqual({ magic: PROJECT_MAGIC, version: 6 });
    expect(serializer.header()).toEqual({ magic: ".icb", version: 6 });
  });

  describe("serialize (R4.2 — the v2 envelope)", () => {
    it("emits { schemaVersion, meta, camera, scene, plugins } with the stamp", () => {
      const serializer = new VersionedSerializer();
      const data = makeProjectData();
      const parsed = JSON.parse(
        serializer.serialize(data, 1700000000000),
      ) as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe(6);
      expect(parsed.meta).toEqual({ magic: ".icb", savedAt: 1700000000000 });
      expect(parsed.camera).toEqual(data.camera);
      const scene = parsed.scene as { objects: Record<string, unknown>[] };
      expect(scene.objects).toHaveLength(2);
      // Objects carry the namespaced wire typeId (§1.7.2) + typeVersion.
      expect(scene.objects[0]?.typeId).toBe("core.freehand");
      expect(scene.objects[0]?.typeVersion).toBe(1);
      expect(scene.objects[0]?.kind).toBeUndefined();
      expect(scene.objects[1]?.points).toEqual([
        { x: -3, y: -4 },
        { x: -50, y: -60 },
      ]);
    });

    it("ALWAYS writes the plugins section — empty object when absent (R4.2)", () => {
      const serializer = new VersionedSerializer();
      const parsed = JSON.parse(
        serializer.serialize(makeProjectData()),
      ) as Record<string, unknown>;
      expect(parsed.plugins).toEqual({});
    });

    it("writes the plugins passthrough verbatim (§1.7.4)", () => {
      const serializer = new VersionedSerializer();
      const data: ProjectData = {
        ...makeProjectData(),
        plugins: { "acme.widget": { score: 5, nested: { deep: [1, 2] } } },
      };
      const parsed = JSON.parse(serializer.serialize(data)) as Record<
        string,
        unknown
      >;
      expect(parsed.plugins).toEqual(data.plugins);
    });

    it("stamps savedAt with the current time by default", () => {
      const serializer = new VersionedSerializer();
      const before = Date.now();
      const parsed = JSON.parse(
        serializer.serialize(makeProjectData()),
      ) as Record<string, unknown>;
      const meta = parsed.meta as { savedAt: number };
      const after = Date.now();
      expect(meta.savedAt).toBeTypeOf("number");
      expect(meta.savedAt).toBeGreaterThanOrEqual(before);
      expect(meta.savedAt).toBeLessThanOrEqual(after);
    });

    it("produces a plain JSON string (parses back without throwing)", () => {
      const serializer = new VersionedSerializer();
      const payload = serializer.serialize(makeProjectData());
      expect(payload).toBeTypeOf("string");
      expect(() => JSON.parse(payload)).not.toThrow();
    });
  });

  describe("deserialize", () => {
    it("round-trips a serialised payload back to equal project data", () => {
      const serializer = new VersionedSerializer();
      const data = makeProjectData();
      const outcome = serializer.deserialize(
        serializer.serialize(data, 1700000000000),
      );
      expect(outcome).not.toBeNull();
      expect(outcome?.status).toBe("ok");
      if (outcome?.status === "ok") {
        expect(outcome.data).toEqual({ ...data, plugins: {} });
        expect(outcome.savedAt).toBe(1700000000000);
      }
    });

    it("preserves the paint order of the object list", () => {
      const serializer = new VersionedSerializer();
      const data = makeProjectData();
      const outcome = serializer.deserialize(serializer.serialize(data));
      expect(
        outcome?.status === "ok"
          ? outcome.data.objects.map((object) => object.id)
          : [],
      ).toEqual(["obj-1", "obj-2"]);
    });

    it("round-trips the plugins passthrough verbatim (AC4.3 half)", () => {
      const serializer = new VersionedSerializer();
      const data: ProjectData = {
        ...makeProjectData(),
        plugins: { x: { hello: "دنیا", list: [1, 2, 3] } },
      };
      const outcome = serializer.deserialize(serializer.serialize(data));
      expect(outcome?.status).toBe("ok");
      if (outcome?.status === "ok") {
        expect(outcome.data.plugins).toEqual(data.plugins);
      }
    });

    it("migrates a v1 file forward (AC4.6 fixture #1)", () => {
      const serializer = new VersionedSerializer();
      const data = makeProjectData();
      const outcome = serializer.deserialize(v1File(data));
      expect(outcome?.status).toBe("ok");
      if (outcome?.status === "ok") {
        expect(outcome.data.camera).toEqual(data.camera);
        expect(outcome.data.objects).toEqual(data.objects);
        expect(outcome.data.plugins).toEqual({});
        expect(outcome.savedAt).toBe(1700000000000);
      }
    });

    it("migrates a v1 file whose objects carry unknown kinds (opaque)", () => {
      const file = rawFile({
        magic: ".icb",
        version: 1,
        savedAt: 0,
        scene: {
          camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
          objects: [
            {
              kind: "widget.clock",
              id: "w1",
              position: { x: 5, y: 5 },
              rotation: 0,
              zIndex: 0,
              visible: true,
              locked: false,
            },
          ],
        },
      });
      const outcome = new VersionedSerializer().deserialize(file);
      expect(outcome?.status).toBe("ok");
      if (outcome?.status === "ok") {
        const object = outcome.data.objects[0];
        expect(object?.kind).toBe("opaque");
        // The raw JSON (with its future typeId) survives verbatim.
        expect(
          (object as unknown as { raw: Record<string, unknown> }).raw.typeId,
        ).toBe("widget.clock");
      }
    });

    it("accepts a v2 file carrying unknown extra top-level keys (forward-compat)", () => {
      const serializer = new VersionedSerializer();
      const data = makeProjectData();
      const payload = JSON.parse(serializer.serialize(data)) as Record<
        string,
        unknown
      >;
      payload.futureField = { nested: [1, 2, 3] };
      const outcome = serializer.deserialize(JSON.stringify(payload));
      expect(outcome?.status).toBe("ok");
    });

    it("opens a FUTURE version leniently as read-only data (R4.4a)", () => {
      const serializer = new VersionedSerializer();
      const data = makeProjectData();
      const payload = JSON.parse(serializer.serialize(data)) as Record<
        string,
        unknown
      >;
      payload.schemaVersion = 99;
      const outcome = serializer.deserialize(JSON.stringify(payload));
      expect(outcome?.status).toBe("future");
      if (outcome?.status === "future") {
        expect(outcome.fileVersion).toBe(99);
        expect(outcome.data.objects).toHaveLength(2);
      }
    });

    it("returns corrupt for a future version whose envelope is unrecognisable", () => {
      const file = rawFile({
        schemaVersion: 99,
        meta: { magic: ".icb", savedAt: 0 },
        somethingElse: true,
      });
      expect(new VersionedSerializer().deserialize(file)?.status).toBe(
        "corrupt",
      );
    });

    it("returns corrupt when the camera payload is missing", () => {
      const file = rawFile({ magic: ".icb", version: 1, savedAt: 0 });
      expect(new VersionedSerializer().deserialize(file)?.status).toBe(
        "corrupt",
      );
    });

    it("returns corrupt when the camera payload is null", () => {
      const file = rawFile({
        magic: ".icb",
        version: 1,
        savedAt: 0,
        scene: null,
      });
      expect(new VersionedSerializer().deserialize(file)?.status).toBe(
        "corrupt",
      );
    });

    it("returns corrupt for invalid JSON", () => {
      expect(new VersionedSerializer().deserialize("{not json")?.status).toBe(
        "corrupt",
      );
      expect(new VersionedSerializer().deserialize("")?.status).toBe("corrupt");
    });

    it("returns corrupt for a non-object root", () => {
      expect(new VersionedSerializer().deserialize("42")?.status).toBe(
        "corrupt",
      );
      expect(new VersionedSerializer().deserialize('"a string"')?.status).toBe(
        "corrupt",
      );
      expect(new VersionedSerializer().deserialize("true")?.status).toBe(
        "corrupt",
      );
      expect(new VersionedSerializer().deserialize("null")?.status).toBe(
        "corrupt",
      );
      expect(new VersionedSerializer().deserialize("[1, 2, 3]")?.status).toBe(
        "corrupt",
      );
    });

    it("returns corrupt for a wrong magic marker", () => {
      const data = makeProjectData();
      const file = rawFile({
        magic: "not-icb",
        version: 1,
        savedAt: 0,
        scene: data,
      });
      expect(new VersionedSerializer().deserialize(file)?.status).toBe(
        "corrupt",
      );
    });

    it("returns corrupt for a missing or non-number version", () => {
      const data = makeProjectData();
      const missing = rawFile({ magic: ".icb", savedAt: 0, scene: data });
      expect(new VersionedSerializer().deserialize(missing)?.status).toBe(
        "corrupt",
      );
      const stringVersion = rawFile({
        magic: ".icb",
        version: "1",
        savedAt: 0,
        scene: data,
      });
      expect(new VersionedSerializer().deserialize(stringVersion)?.status).toBe(
        "corrupt",
      );
      const booleanVersion = rawFile({
        magic: ".icb",
        version: true,
        savedAt: 0,
        scene: data,
      });
      expect(
        new VersionedSerializer().deserialize(booleanVersion)?.status,
      ).toBe("corrupt");
    });

    it("returns corrupt for a non-integer version", () => {
      const data = makeProjectData();
      const file = rawFile({
        magic: ".icb",
        version: 1.5,
        savedAt: 0,
        scene: data,
      });
      expect(new VersionedSerializer().deserialize(file)?.status).toBe(
        "corrupt",
      );
    });

    it("returns corrupt for version 0 (the version range starts at 1)", () => {
      const file = rawFile({
        magic: ".icb",
        version: 0,
        savedAt: 0,
        scene: makeProjectData(),
      });
      expect(new VersionedSerializer().deserialize(file)?.status).toBe(
        "corrupt",
      );
    });

    it("AC4.3 — a hand-crafted fixture with an unknown object AND an unknown plugins block round-trips BOTH semantically unchanged", () => {
      // The fixture: v2 envelope + one unknown object type + one unknown
      // plugins entry (exactly the acceptance criterion's file).
      const fixture = rawFile({
        schemaVersion: 2,
        meta: { magic: ".icb", savedAt: 1700000000000 },
        camera: { x: 8, y: -3, zoom: 1.5, rotation: 0 },
        scene: {
          objects: [
            {
              typeId: "vendor.spacer",
              typeVersion: 1,
              id: "sp-1",
              position: { x: 40, y: 40 },
              rotation: 0,
              zIndex: 0,
              visible: true,
              locked: false,
              width: 120,
              height: 60,
              gap: 12,
              label: "فاصله",
            },
          ],
        },
        plugins: { x: { hello: "دنیا", deep: { list: [1, 2, 3] } } },
      });
      const serializer = new VersionedSerializer();
      // 1. The file opens (the unknown object = placeholder).
      const opened = serializer.deserialize(fixture);
      expect(opened?.status).toBe("ok");
      if (opened?.status !== "ok") {
        return;
      }
      expect(opened.data.objects).toHaveLength(1);
      expect(opened.data.objects[0]?.kind).toBe("opaque");
      expect(opened.data.plugins).toEqual({
        x: { hello: "دنیا", deep: { list: [1, 2, 3] } },
      });
      // 2. The app saves.
      const saved = serializer.serialize(
        opened.data,
        opened.savedAt ?? Date.now(),
      );
      // 3. BOTH the unknown object and the plugins block survive
      //    semantically unchanged.
      const reparsed = JSON.parse(saved) as {
        scene: { objects: Record<string, unknown>[] };
        plugins: Record<string, unknown>;
      };
      expect(reparsed.plugins).toEqual({
        x: { hello: "دنیا", deep: { list: [1, 2, 3] } },
      });
      expect(reparsed.scene.objects[0]).toEqual({
        typeId: "vendor.spacer",
        typeVersion: 1,
        id: "sp-1",
        position: { x: 40, y: 40 },
        rotation: 0,
        zIndex: 0,
        visible: true,
        locked: false,
        width: 120,
        height: 60,
        gap: 12,
        label: "فاصله",
      });
    });

    it("returns corrupt when the payload fails structural validation", () => {
      const badObjects = rawFile({
        magic: ".icb",
        version: 1,
        savedAt: 0,
        scene: {
          camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
          objects: "oops",
        },
      });
      expect(new VersionedSerializer().deserialize(badObjects)?.status).toBe(
        "corrupt",
      );
      const missingCamera = rawFile({
        magic: ".icb",
        version: 1,
        savedAt: 0,
        scene: { objects: [] },
      });
      expect(new VersionedSerializer().deserialize(missingCamera)?.status).toBe(
        "corrupt",
      );
    });
  });
});
