/**
 * Unit tests for the .icb project payload (build/validate/apply) and the
 * registry-driven scene (de)serialization (R4.1/R4.3): every core type
 * round-trips, corrupt objects degrade to OpaqueObject placeholders,
 * unknown data survives verbatim (§1.7.4), and a LATE-registered dummy
 * type round-trips with ZERO persistence edits (AC4.2).
 */
import { describe, expect, it } from "vitest";
import { Camera } from "@/core/camera/Camera";
import { Scene } from "@/core/model/Scene";
import { vec2 } from "@/core/geometry/Vec2";
import {
  applyProjectData,
  asOpaqueObject,
  asRecord,
  AUTOSAVE_STORAGE_KEY,
  buildProjectData,
  deserializeSceneObject,
  LAST_DISK_SAVE_STORAGE_KEY,
  PROJECT_FILE_VERSION,
  PROJECT_MAGIC,
  serializeSceneObjects,
  validateProjectData,
} from "@/persistence/ProjectFile";
import type { ProjectData } from "@/persistence/ProjectFile";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import {
  registerCoreObjectTypes,
  CORE_TYPE_IDS,
} from "@/persistence/objectTypes";
import type { FreehandObjectData } from "@/core/model/FreehandObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import type { StickyNoteObjectData } from "@/core/model/StickyNoteObject";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import type { ConnectorObjectData } from "@/core/model/ConnectorObject";
import type { GroupObjectData } from "@/core/model/GroupObject";
import type { ImageObjectData } from "@/core/model/ImageObject";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Builds a fully populated shape fixture. */
function makeShape(id: string): ShapeObjectData {
  return {
    id,
    kind: "shape",
    name: "My shape",
    position: vec2(10, 20),
    rotation: 0.25,
    zIndex: 3,
    visible: true,
    locked: false,
    shapeKind: "rectangle",
    width: 120,
    height: 80,
    fill: "#22c55e",
    stroke: "#166534",
    strokeWidth: 2,
  };
}

/** Builds a fully populated text box fixture (rich doc included, R4.1). */
function makeTextBox(id: string): TextBoxObjectData {
  return {
    id,
    kind: "textBox",
    position: vec2(-5, 7),
    rotation: 0,
    zIndex: 1,
    visible: true,
    locked: false,
    width: 260,
    height: 64,
    text: "سلام دنیا",
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "سلام" }] },
      ],
    },
    sizeMode: "auto",
    fontSize: 20,
    color: "token://text",
  };
}

/** Builds a sticky note fixture. */
function makeStickyNote(id: string): StickyNoteObjectData {
  return {
    id,
    kind: "stickyNote",
    position: vec2(40, -12),
    rotation: 0,
    zIndex: 2,
    visible: true,
    locked: false,
    width: 220,
    height: 220,
    text: "یادداشت",
    fontSize: 18,
    noteColor: "#f59e0b",
    color: "oklch(0.30 0.03 55)",
  };
}

/** Builds a freehand stroke fixture. */
function makeFreehand(id: string): FreehandObjectData {
  return {
    id,
    kind: "freehand",
    position: vec2(1, 1),
    rotation: 0,
    zIndex: 4,
    visible: true,
    locked: false,
    points: [vec2(1, 1), vec2(30, 40), vec2(80, 20)],
    strokeColor: "token://stroke",
    strokeWidth: 4,
    strokeStyle: "solid",
  };
}

/** Builds a fully populated connector fixture. */
function makeConnector(id: string): ConnectorObjectData {
  return {
    id,
    kind: "connector",
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    start: { objectId: "obj-1", anchorIndex: 2, position: vec2(130, 60) },
    end: { objectId: null, anchorIndex: 0, position: vec2(300, -40) },
    routingKind: "orthogonal",
    strokeColor: "token://stroke",
    strokeWidth: 2,
    strokeStyle: "dashed",
    startArrow: "none",
    endArrow: "arrow",
  };
}

/** Builds a group fixture. */
function makeGroup(id: string): GroupObjectData {
  return {
    id,
    kind: "group",
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 5,
    visible: true,
    locked: false,
    childIds: ["obj-1", "obj-2"],
  };
}

/** Builds an image fixture (tiny inline data URL). */
function makeImage(id: string): ImageObjectData {
  return {
    id,
    kind: "image",
    position: vec2(50, 50),
    rotation: 0.5,
    zIndex: 6,
    visible: true,
    locked: false,
    src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    naturalWidth: 100,
    naturalHeight: 50,
    width: 100,
    height: 50,
  };
}

/** A valid mixed-kind project payload. */
function validProject(): ProjectData {
  return {
    camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
    objects: [makeShape("obj-1"), makeTextBox("obj-2"), makeFreehand("obj-3")],
  };
}

/** Builds a registry with the core types registered. */
function makeRegistry(): ObjectRegistry {
  return registerCoreObjectTypes(new ObjectRegistry());
}

/** Deep-clones a fixture through JSON (mutation base). */
function mutated(
  mutate: (draft: Record<string, unknown>) => void,
): Record<string, unknown> {
  const draft = JSON.parse(JSON.stringify(validProject())) as Record<
    string,
    unknown
  >;
  mutate(draft);
  return draft;
}

/** Returns the draft's camera record. */
function cameraOf(
  draft: Record<string, unknown>,
): Record<string, number | undefined> {
  return draft.camera as Record<string, number>;
}

describe("ProjectFile constants", () => {
  it("exposes the file magic, format version and storage keys", () => {
    expect(PROJECT_MAGIC).toBe(".icb");
    expect(PROJECT_FILE_VERSION).toBe(6);
    expect(AUTOSAVE_STORAGE_KEY).toBe("infinite-canvas-studio/autosave/v1");
    expect(LAST_DISK_SAVE_STORAGE_KEY).toBe(
      "infinite-canvas-studio/last-disk-save/v1",
    );
  });
});

describe("buildProjectData", () => {
  it("snapshots the camera and the objects in paint order", () => {
    const scene = new Scene(new Camera(12.5, -7, 1.75, 0.3));
    const shape = makeShape("obj-1");
    const textBox = makeTextBox("obj-2");
    scene.add(shape);
    scene.add(textBox);
    const data = buildProjectData(scene);
    expect(data.camera).toEqual({ x: 12.5, y: -7, zoom: 1.75, rotation: 0.3 });
    expect(data.objects).toHaveLength(2);
    expect(data.objects.map((object) => object.id)).toEqual(["obj-1", "obj-2"]);
    expect(data.objects[0]).toEqual(shape);
    expect(data.objects[1]).toEqual(textBox);
  });

  it("snapshots the plugins passthrough when given (R4.2)", () => {
    const scene = new Scene(new Camera(0, 0, 1, 0));
    const plugins = { "acme.tool": { enabled: true } };
    const data = buildProjectData(scene, plugins);
    expect(data.plugins).toEqual(plugins);
  });

  it("snapshots an empty scene as an empty object list", () => {
    const data = buildProjectData(new Scene(new Camera(1, 2, 3, 4)));
    expect(data.objects).toEqual([]);
    expect(data.camera).toEqual({ x: 1, y: 2, zoom: 3, rotation: 4 });
  });

  it("copies the camera and every object entry into fresh objects", () => {
    const scene = new Scene(new Camera(0, 0, 1, 0));
    const shape = makeShape("obj-1");
    scene.add(shape);
    const data = buildProjectData(scene);
    expect(data.camera).not.toBe(scene.camera);
    expect(data.objects[0]).not.toBe(shape);
  });

  it("is unaffected by camera mutations after the snapshot", () => {
    const scene = new Scene(new Camera(1, 2, 3, 0.5));
    const data = buildProjectData(scene);
    scene.camera.x = 999;
    scene.camera.y = -999;
    scene.camera.zoom = 42;
    scene.camera.rotation = 9;
    expect(data.camera).toEqual({ x: 1, y: 2, zoom: 3, rotation: 0.5 });
  });
});

describe("validateProjectData (structural envelope gate)", () => {
  it("accepts a well-formed payload with shape, textBox, stickyNote and freehand objects", () => {
    expect(validateProjectData(validProject())).toBe(true);
  });

  it("accepts an empty object list", () => {
    expect(
      validateProjectData({ camera: validProject().camera, objects: [] }),
    ).toBe(true);
  });

  it("accepts opaque placeholder objects in the list (they are legal data)", () => {
    const payload = {
      camera: validProject().camera,
      objects: [
        {
          id: "w1",
          kind: "opaque",
          position: vec2(0, 0),
          rotation: 0,
          zIndex: 0,
          visible: true,
          locked: true,
          raw: { typeId: "widget.clock" },
        },
      ],
    } as unknown as ProjectData;
    expect(validateProjectData(payload)).toBe(true);
  });

  it("rejects non-object payloads", () => {
    expect(validateProjectData(null)).toBe(false);
    expect(validateProjectData(42)).toBe(false);
    expect(validateProjectData("project")).toBe(false);
    expect(validateProjectData(true)).toBe(false);
  });

  it("rejects an array root (no camera)", () => {
    expect(validateProjectData([])).toBe(false);
  });

  it("rejects a missing, null or non-object camera", () => {
    expect(
      validateProjectData(mutated((draft) => (draft.camera = undefined))),
    ).toBe(false);
    expect(validateProjectData(mutated((draft) => (draft.camera = null)))).toBe(
      false,
    );
    expect(
      validateProjectData(mutated((draft) => (draft.camera = "0,0,1,0"))),
    ).toBe(false);
  });

  it("rejects non-finite or missing camera fields", () => {
    for (const field of ["x", "y", "zoom", "rotation"] as const) {
      expect(
        validateProjectData(
          mutated((draft) => (cameraOf(draft)[field] = Number.NaN)),
        ),
      ).toBe(false);
      expect(
        validateProjectData(
          mutated(
            (draft) => (cameraOf(draft)[field] = Number.POSITIVE_INFINITY),
          ),
        ),
      ).toBe(false);
      expect(
        validateProjectData(
          mutated((draft) => (cameraOf(draft)[field] = undefined)),
        ),
      ).toBe(false);
    }
  });

  it("rejects zoom <= 0", () => {
    expect(
      validateProjectData(mutated((draft) => (cameraOf(draft).zoom = 0))),
    ).toBe(false);
    expect(
      validateProjectData(mutated((draft) => (cameraOf(draft).zoom = -0.5))),
    ).toBe(false);
  });

  it("rejects a non-array objects field", () => {
    expect(
      validateProjectData(mutated((draft) => (draft.objects = "oops"))),
    ).toBe(false);
    expect(
      validateProjectData(mutated((draft) => (draft.objects = { length: 0 }))),
    ).toBe(false);
  });

  it("rejects object entries that are not objects", () => {
    const objects = [null, 5, "shape"];
    expect(
      validateProjectData({ camera: validProject().camera, objects }),
    ).toBe(false);
  });
});

describe("registry-driven object (de)serialization (R4.1)", () => {
  it("round-trips every core kind through serialize → deserialize", () => {
    const registry = makeRegistry();
    const fixtures: SceneObjectData[] = [
      makeShape("obj-1"),
      makeTextBox("obj-2"),
      makeStickyNote("obj-3"),
      makeFreehand("obj-4"),
      makeConnector("obj-5"),
      makeGroup("obj-6"),
      makeImage("obj-7"),
    ];
    for (const fixture of fixtures) {
      const wire = serializeSceneObjects([fixture], registry);
      expect(wire).toHaveLength(1);
      const outcome = deserializeSceneObject(
        wire[0] as Record<string, unknown>,
        registry,
      );
      expect(outcome.placeholder).toBe(false);
      // Camera-invariant comparison: the data round-trips EXACTLY.
      expect(outcome.object).toEqual(fixture);
    }
  });

  it("round-trips the TipTap rich-text doc inside the text object (R4.1)", () => {
    const registry = makeRegistry();
    const wire = serializeSceneObjects([makeTextBox("obj-1")], registry);
    const outcome = deserializeSceneObject(
      wire[0] as Record<string, unknown>,
      registry,
    );
    const textBox = outcome.object as TextBoxObjectData;
    expect(textBox.doc).toEqual(makeTextBox("obj-1").doc);
  });

  it("stamps every wire payload with the namespaced typeId (§1.7.2)", () => {
    const registry = makeRegistry();
    const wire = serializeSceneObjects(
      [makeShape("a"), makeTextBox("b"), makeStickyNote("c"), makeImage("d")],
      registry,
    );
    expect(wire.map((entry) => entry.typeId)).toEqual([
      CORE_TYPE_IDS.shape,
      CORE_TYPE_IDS.textBox,
      CORE_TYPE_IDS.stickyNote,
      CORE_TYPE_IDS.image,
    ]);
    for (const entry of wire) {
      expect(entry.typeVersion).toBe(1);
      expect(entry.kind).toBeUndefined();
    }
  });

  it("materialises an unregistered typeId as an OpaqueObject (R4.3)", () => {
    const registry = makeRegistry();
    const raw = {
      typeId: "widget.clock",
      id: "w1",
      position: { x: 5, y: 5 },
      width: 100,
      height: 40,
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      ticks: 42,
    };
    const outcome = deserializeSceneObject(raw, registry);
    expect(outcome.placeholder).toBe(true);
    const opaque = asOpaqueObject(outcome.object);
    expect(opaque).not.toBeNull();
    expect(opaque?.locked).toBe(true);
    expect(opaque?.raw).toEqual(raw);
    // Serialize writes the raw JSON back VERBATIM (§1.7.4).
    const wire = serializeSceneObjects([outcome.object], registry);
    expect(wire[0]).toEqual(raw);
  });

  it("degrades a CORRUPT known-type object to the opaque placeholder", () => {
    const registry = makeRegistry();
    const raw = {
      typeId: CORE_TYPE_IDS.shape,
      id: "s1",
      position: { x: 0, y: 0 },
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      // shapeKind/width/height missing → deserialize refuses → placeholder
    };
    const outcome = deserializeSceneObject(raw, registry);
    expect(outcome.placeholder).toBe(true);
    expect(asOpaqueObject(outcome.object)?.raw).toEqual(raw);
  });

  it("refuses a malformed rich-text doc by placeholder, not crash", () => {
    const registry = makeRegistry();
    const raw = {
      typeId: CORE_TYPE_IDS.textBox,
      id: "t1",
      position: { x: 0, y: 0 },
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      width: 100,
      height: 40,
      text: "hi",
      doc: { type: "paragraph" },
      sizeMode: "fixed",
      fontSize: 20,
      color: "token://text",
    };
    const outcome = deserializeSceneObject(raw, registry);
    expect(outcome.placeholder).toBe(true);
  });

  it("serializes an UNREGISTERED in-memory kind as an opaque-style raw write", () => {
    const registry = makeRegistry();
    const foreign = {
      id: "f1",
      kind: "alien",
      position: vec2(1, 1),
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      payload: 7,
    } as unknown as SceneObjectData;
    const wire = serializeSceneObjects([foreign], registry);
    expect(wire[0]).toMatchObject({
      typeId: "unregistered.alien",
      id: "f1",
      payload: 7,
    });
  });

  it("serializes an in-memory OPAQUE object through the registry entry verbatim", () => {
    const registry = makeRegistry();
    const raw = { typeId: "widget.clock", id: "w9" };
    const outcome = deserializeSceneObject(raw, registry);
    const wire = serializeSceneObjects([outcome.object], registry);
    expect(wire[0]).toEqual(raw);
  });

  it("falls back to the placeholder when the migrated payload is not a record", () => {
    const registry = makeRegistry();
    // typeId is core.opaque — its migrations keep the payload; the
    // non-record path is exercised with a crafted raw that skips the
    // entry deserialize: typeId of a type whose deserialize returns null.
    const raw = {
      typeId: CORE_TYPE_IDS.shape,
      id: "s1",
      position: { x: 0, y: 0 },
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
    };
    const outcome = deserializeSceneObject(raw, registry);
    expect(outcome.placeholder).toBe(true);
  });

  it("accepts a legacy plain text box (doc null)", () => {
    const registry = makeRegistry();
    const legacy: TextBoxObjectData = { ...makeTextBox("obj-9"), doc: null };
    const wire = serializeSceneObjects([legacy], registry);
    const outcome = deserializeSceneObject(
      wire[0] as Record<string, unknown>,
      registry,
    );
    expect(outcome.placeholder).toBe(false);
    expect((outcome.object as TextBoxObjectData).text).toBe("سلام دنیا");
  });
});

describe("AC4.2 — the plugin-readiness proof", () => {
  it("round-trips a LATE-registered dummy type with ZERO persistence edits", () => {
    const registry = makeRegistry();
    // The future plugin registers ITS type — nothing in persistence changes.
    const registryWithPlugin = registerDummyType(registry);

    const dummy = {
      id: "d1",
      kind: "dummy",
      position: vec2(9, 9),
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      mood: "שמח",
      score: 17,
    };
    // The registry rejects third-party owners until the runtime allows it.
    expect(() => makeRegistry().register(dummyTypeEntry())).toThrow(
      /owner.name/,
    );
    const wire = serializeSceneObjects(
      [dummy as unknown as SceneObjectData],
      registryWithPlugin,
    );
    expect(wire[0]?.typeId).toBe("acme.dummy");
    const outcome = deserializeSceneObject(
      wire[0] as Record<string, unknown>,
      registryWithPlugin,
    );
    expect(outcome.placeholder).toBe(false);
    expect(outcome.object).toEqual(dummy);
  });
});

/** The dummy type entry (the AC4.2 "plugin"). */
function dummyTypeEntry() {
  return {
    id: "acme.dummy",
    kind: "dummy",
    titleKey: "tool.shape",
    version: 1,
    factory: () => ({}) as unknown as SceneObjectData,
    serialize: (object: SceneObjectData) => {
      const { kind: _kind, ...fields } = object as unknown as Record<
        string,
        unknown
      >;
      return { ...fields, typeId: "acme.dummy", typeVersion: 1 };
    },
    deserialize: (raw: Record<string, unknown>) => {
      if (typeof raw.mood !== "string" || typeof raw.score !== "number") {
        return null;
      }
      return {
        id: String(raw.id),
        kind: "dummy",
        position: vec2(
          (raw.position as { x: number }).x,
          (raw.position as { y: number }).y,
        ),
        rotation: Number(raw.rotation),
        zIndex: Number(raw.zIndex),
        visible: raw.visible !== false,
        locked: raw.locked === true,
        mood: raw.mood,
        score: raw.score,
      } as unknown as SceneObjectData;
    },
  };
}

/**
 * Registers the dummy type on a THIRD-PARTY-allowing registry seeded with
 * the core entries (mirrors the composition root + plugin runtime).
 */
function registerDummyType(core: ObjectRegistry): ObjectRegistry {
  // Re-register core entries on an allowing registry.
  const allowing = new ObjectRegistry(true);
  for (const entry of core.list()) {
    allowing.register(entry);
  }
  allowing.register(dummyTypeEntry());
  return allowing;
}

describe("applyProjectData", () => {
  it("replaces the scene contents in order, restores the camera and returns the count", () => {
    const scene = new Scene(new Camera(0, 0, 1, 0));
    const data = validProject();
    const count = applyProjectData(scene, data);
    expect(count).toBe(3);
    expect(scene.objects.map((object) => object.id)).toEqual([
      "obj-1",
      "obj-2",
      "obj-3",
    ]);
    expect(scene.camera.x).toBe(0);
    expect(scene.camera.y).toBe(0);
    expect(scene.camera.zoom).toBe(1);
    expect(scene.camera.rotation).toBe(0);
  });

  it("applies opaque placeholder objects like any other kind (R4.3)", () => {
    const scene = new Scene(new Camera(0, 0, 1, 0));
    const data = {
      camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
      objects: [
        {
          id: "w1",
          kind: "opaque",
          position: vec2(0, 0),
          rotation: 0,
          zIndex: 0,
          visible: true,
          locked: true,
          raw: { typeId: "widget.clock" },
        },
      ],
    } as unknown as ProjectData;
    const count = applyProjectData(scene, data);
    expect(count).toBe(1);
    expect(asOpaqueObject(scene.objects[0] as SceneObjectData)?.raw).toEqual({
      typeId: "widget.clock",
    });
  });

  it("reuses a deserialised payload for the scene swap", () => {
    const scene = new Scene(new Camera(0, 0, 1, 0));
    const data = validProject();
    applyProjectData(scene, data);
    // Second apply replaces (not appends).
    applyProjectData(scene, validProject());
    expect(scene.objectCount).toBe(3);
  });
});

describe("asRecord", () => {
  it("narrows records and rejects everything else", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord(null)).toBeNull();
    expect(asRecord(undefined)).toBeNull();
    expect(asRecord(42)).toBeNull();
    expect(asRecord([1, 2])).not.toBeNull();
  });
});
