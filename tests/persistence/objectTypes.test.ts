/**
 * Unit tests for the core object-type registrations (R4.1): every entry's
 * defensive deserialization (field-level rejections → null → the caller
 * keeps the raw JSON as an opaque placeholder), the wire stamps and the
 * factory defaults.
 */
import { describe, expect, it } from "vitest";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import {
  registerCoreObjectTypes,
  CORE_TYPE_IDS,
} from "@/persistence/objectTypes";
import { vec2 } from "@/core/geometry/Vec2";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";

/** A registry with the core types registered. */
function registry(): ObjectRegistry {
  return registerCoreObjectTypes(new ObjectRegistry());
}

/** Builds a full valid wire payload of the given type. */
function wireOf(typeId: string): Record<string, unknown> {
  const base = {
    id: "obj-1",
    position: { x: 0, y: 0 },
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
  };
  switch (typeId) {
    case CORE_TYPE_IDS.shape:
      return {
        ...base,
        shapeKind: "rectangle",
        width: 10,
        height: 10,
        fill: "#fff",
        stroke: "#000",
        strokeWidth: 1,
      };
    case CORE_TYPE_IDS.textBox:
      return {
        ...base,
        width: 100,
        height: 40,
        text: "hi",
        doc: null,
        sizeMode: "fixed",
        fontSize: 20,
        color: "#000",
      };
    case CORE_TYPE_IDS.stickyNote:
      return {
        ...base,
        width: 100,
        height: 100,
        text: "note",
        fontSize: 18,
        noteColor: "#f59e0b",
        color: "#333",
      };
    case CORE_TYPE_IDS.image:
      return {
        ...base,
        src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        naturalWidth: 10,
        naturalHeight: 10,
        width: 10,
        height: 10,
      };
    case CORE_TYPE_IDS.video:
      return {
        ...base,
        assetHash: "1".repeat(64),
        thumbHash: "2".repeat(64),
        originalName: "clip.mp4",
        mimeType: "video/mp4",
        durationMs: 1000,
        naturalWidth: 10,
        naturalHeight: 10,
        width: 10,
        height: 10,
      };
    case CORE_TYPE_IDS.audio:
      return {
        ...base,
        assetHash: "1".repeat(64),
        thumbHash: "2".repeat(64),
        originalName: "clip.mp3",
        mimeType: "audio/mpeg",
        durationMs: 1000,
        width: 10,
        height: 10,
      };
    // فاز P1: the PDF fixture (hashes + page metadata).
    case CORE_TYPE_IDS.pdf:
      return {
        ...base,
        assetHash: "1".repeat(64),
        thumbHash: "2".repeat(64),
        originalName: "doc.pdf",
        pageCount: 5,
        currentPage: 2,
        naturalWidth: 595,
        naturalHeight: 842,
        width: 10,
        height: 10,
      };
    case CORE_TYPE_IDS.connector:
      return {
        ...base,
        start: { objectId: null, anchorIndex: 0, position: { x: 0, y: 0 } },
        end: { objectId: "obj-2", anchorIndex: 1, position: { x: 10, y: 0 } },
        routingKind: "straight",
        strokeColor: "#000",
        strokeWidth: 2,
        strokeStyle: "solid",
        startArrow: "none",
        endArrow: "arrow",
      };
    case CORE_TYPE_IDS.freehand:
      return {
        ...base,
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
        strokeColor: "#000",
        strokeWidth: 2,
        strokeStyle: "solid",
      };
    case CORE_TYPE_IDS.group:
      return { ...base, childIds: ["obj-2"] };
    case CORE_TYPE_IDS.frame:
      return {
        ...base,
        width: 640,
        height: 400,
        titleHeight: 28,
        title: "قاب",
        fill: "accent",
        stroke: "primary",
        strokeWidth: 2,
      };
    case CORE_TYPE_IDS.sticker:
      return {
        ...base,
        emoji: "⭐",
        width: 96,
        height: 96,
      };
    case CORE_TYPE_IDS.query:
      return {
        ...base,
        width: 264,
        height: 168,
        queryType: "backlinks",
        queryTarget: "هدف نهایی",
      };
    case CORE_TYPE_IDS.opaque:
      return { ...base, anything: true };
    default:
      return { ...base };
  }
}

describe("core object types — deserialize field rejections", () => {
  const cases: Array<[string, string, unknown]> = [
    ["shape: bad shapeKind", CORE_TYPE_IDS.shape, { shapeKind: "blob" }],
    ["shape: negative width", CORE_TYPE_IDS.shape, { width: -1 }],
    ["shape: missing fill", CORE_TYPE_IDS.shape, { fill: undefined }],
    ["shape: negative strokeWidth", CORE_TYPE_IDS.shape, { strokeWidth: -2 }],
    ["textBox: missing width", CORE_TYPE_IDS.textBox, { width: undefined }],
    ["textBox: zero fontSize", CORE_TYPE_IDS.textBox, { fontSize: 0 }],
    ["textBox: bad sizeMode", CORE_TYPE_IDS.textBox, { sizeMode: "huge" }],
    ["textBox: missing text", CORE_TYPE_IDS.textBox, { text: undefined }],
    ["stickyNote: bad fontSize", CORE_TYPE_IDS.stickyNote, { fontSize: "18" }],
    [
      "stickyNote: missing noteColor",
      CORE_TYPE_IDS.stickyNote,
      { noteColor: undefined },
    ],
    ["image: empty src", CORE_TYPE_IDS.image, { src: "" }],
    ["image: zero naturalWidth", CORE_TYPE_IDS.image, { naturalWidth: 0 }],
    ["image: missing height", CORE_TYPE_IDS.image, { height: undefined }],
    [
      "connector: bad routing",
      CORE_TYPE_IDS.connector,
      { routingKind: "wavy" },
    ],
    [
      "connector: missing endpoint",
      CORE_TYPE_IDS.connector,
      { start: undefined },
    ],
    [
      "connector: endpoint bad anchorIndex",
      CORE_TYPE_IDS.connector,
      { start: { objectId: null, anchorIndex: -1, position: { x: 0, y: 0 } } },
    ],
    ["connector: bad arrow", CORE_TYPE_IDS.connector, { endArrow: "double" }],
    ["freehand: empty points", CORE_TYPE_IDS.freehand, { points: [] }],
    [
      "freehand: bad point entry",
      CORE_TYPE_IDS.freehand,
      { points: [{ x: 0, y: Number.NaN }] },
    ],
    ["freehand: zero strokeWidth", CORE_TYPE_IDS.freehand, { strokeWidth: 0 }],
    ["group: non-array childIds", CORE_TYPE_IDS.group, { childIds: "obj-2" }],
    ["group: bad child id", CORE_TYPE_IDS.group, { childIds: [42] }],
  ];

  for (const [name, typeId, mutation] of cases) {
    it(`refuses ${name}`, () => {
      const entry = registry().entryForTypeId(typeId);
      expect(entry).toBeDefined();
      const raw = {
        ...wireOf(typeId),
        ...(mutation as Record<string, unknown>),
      };
      expect(entry?.deserialize(raw)).toBeNull();
    });
  }

  it("refuses a common-fields failure (no id) on every concrete type", () => {
    for (const entry of registry().list()) {
      if (entry.id === CORE_TYPE_IDS.opaque) {
        // The opaque entry MATERIALISES placeholders by design — a raw
        // payload without an id still becomes a (locked) placeholder.
        const placeholder = entry.deserialize({ ...wireOf(entry.id), id: "" });
        expect(placeholder).not.toBeNull();
        continue;
      }
      const raw = { ...wireOf(entry.id), id: "" };
      expect(entry.deserialize(raw), entry.id).toBeNull();
    }
  });

  it("refuses wrong-typed common fields (visible as string)", () => {
    const entry = registry().entryForTypeId(CORE_TYPE_IDS.shape);
    expect(
      entry?.deserialize({ ...wireOf(CORE_TYPE_IDS.shape), visible: "yes" }),
    ).toBeNull();
  });

  it("refuses an absent position", () => {
    const entry = registry().entryForTypeId(CORE_TYPE_IDS.shape);
    const { position: _position, ...raw } = wireOf(CORE_TYPE_IDS.shape);
    expect(entry?.deserialize(raw as Record<string, unknown>)).toBeNull();
  });

  it("accepts every valid fixture", () => {
    for (const entry of registry().list()) {
      expect(entry.deserialize(wireOf(entry.id)), entry.id).not.toBeNull();
    }
  });

  it("defaults optional fields (name/parentId/visible/locked) sensibly", () => {
    const entry = registry().entryForTypeId(CORE_TYPE_IDS.shape);
    const data = entry?.deserialize(
      wireOf(CORE_TYPE_IDS.shape),
    ) as TextBoxObjectData & Record<string, unknown>;
    expect(data.name).toBeUndefined();
    expect(data.parentId).toBeUndefined();
    expect(data.visible).toBe(true);
    expect(data.locked).toBe(false);
  });
});

describe("core object types — serialize stamps", () => {
  it("writes typeId + typeVersion and drops the in-memory kind", () => {
    const registryInstance = registry();
    for (const entry of registryInstance.list()) {
      if (entry.id === CORE_TYPE_IDS.opaque) {
        continue;
      }
      const data = entry.deserialize(wireOf(entry.id));
      const wire = entry.serialize(data as never);
      expect(wire.typeId, entry.id).toBe(entry.id);
      expect(wire.typeVersion).toBe(1);
      expect(wire.kind).toBeUndefined();
      expect(wire.id).toBe("obj-1");
    }
  });

  it("round-trips a full textBox with a rich doc through serialize→deserialize", () => {
    const entry = registry().entryForTypeId(CORE_TYPE_IDS.textBox);
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", marks: [{ type: "bold" }], text: "سلام" }],
        },
      ],
    };
    const raw = { ...wireOf(CORE_TYPE_IDS.textBox), doc };
    const data = entry?.deserialize(raw) as TextBoxObjectData;
    const wire = entry?.serialize(data) as Record<string, unknown>;
    const restored = entry?.deserialize(wire) as TextBoxObjectData;
    expect(restored.doc).toEqual(doc);
    expect(restored.text).toBe("hi");
  });

  it("factories produce well-formed defaults for every core kind", () => {
    for (const entry of registry().list()) {
      const instance = entry.factory();
      expect(instance.id.length).toBeGreaterThan(0);
      expect(instance.kind).toBe(entry.kind);
      expect(instance.visible).toBe(true);
    }
    // Spot-check the defaults carry sane geometry.
    const shape = registry().entryForTypeId(CORE_TYPE_IDS.shape)?.factory();
    expect(shape?.position).toEqual(vec2(0, 0));
  });
});
