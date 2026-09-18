/**
 * Unit tests for the object registry (R4.1, §1.7.1–§1.7.3): registration
 * rules (namespacing, duplicate rejection, reserved owner), the
 * dual typeId/kind indexes, owner attribution and the per-type
 * migration chain runner (R4.4b).
 */
import { describe, expect, it } from "vitest";
import {
  ObjectRegistry,
  type ObjectRegistryEntry,
} from "@/core/registry/ObjectRegistry";
import {
  registerCoreObjectTypes,
  CORE_TYPE_IDS,
} from "@/persistence/objectTypes";
import { vec2 } from "@/core/geometry/Vec2";
import type { ShapeObjectData } from "@/core/model/ShapeObject";

/** A minimal well-formed entry for structural tests. */
function entryOf(
  overrides: Partial<ObjectRegistryEntry> = {},
): ObjectRegistryEntry {
  return {
    id: "core.shape",
    kind: "shape",
    titleKey: "tool.shape",
    version: 1,
    factory: () => ({}) as ShapeObjectData,
    serialize: () => ({}),
    deserialize: () => null,
    ...overrides,
  };
}

describe("ObjectRegistry.register", () => {
  it("registers and looks up entries by BOTH typeId and kind", () => {
    const registry = new ObjectRegistry();
    registry.register(entryOf());
    expect(registry.hasTypeId("core.shape")).toBe(true);
    expect(registry.entryForTypeId("core.shape")?.kind).toBe("shape");
    expect(registry.entryForKind("shape")?.id).toBe("core.shape");
    expect(registry.size).toBe(1);
  });

  it("rejects duplicate type ids", () => {
    const registry = new ObjectRegistry();
    registry.register(entryOf());
    expect(() => registry.register(entryOf())).toThrow(/duplicate id/);
  });

  it("rejects duplicate kinds even under a different id", () => {
    const registry = new ObjectRegistry();
    registry.register(entryOf());
    expect(() =>
      registry.register(entryOf({ id: "core.shape2", kind: "shape" })),
    ).toThrow(/duplicate kind/);
  });

  it("rejects non-namespaced ids (§1.7.2 owner.name scheme)", () => {
    const registry = new ObjectRegistry();
    expect(() => registry.register(entryOf({ id: "shape" }))).toThrow(
      /owner.name/,
    );
    expect(() => registry.register(entryOf({ id: ".shape" }))).toThrow();
    expect(() => registry.register(entryOf({ id: "core..shape" }))).toThrow();
    expect(() => registry.register(entryOf({ id: "core." }))).toThrow();
  });

  it("rejects third-party owners until the plugin runtime allows them", () => {
    const strict = new ObjectRegistry();
    expect(() => registryWithThirdParty(strict)).toThrow(/reserved/);
    const allowing = new ObjectRegistry(true);
    expect(() => registryWithThirdParty(allowing)).not.toThrow();
    expect(allowing.hasTypeId("acme.widget")).toBe(true);
  });

  it("rejects invalid versions and empty kinds", () => {
    const registry = new ObjectRegistry();
    expect(() => registry.register(entryOf({ version: 0 }))).toThrow(/version/);
    expect(() => registry.register(entryOf({ version: 1.5 }))).toThrow(
      /version/,
    );
    expect(() => registry.register(entryOf({ kind: "" }))).toThrow(/kind/);
  });

  it("fires onRegistered AFTER the entry is stored (late subscribers see it)", () => {
    const registry = new ObjectRegistry();
    const seen: string[] = [];
    registry.onRegistered((id) => {
      seen.push(id);
      // The subscriber re-reads the store — the entry is already there.
      expect(registry.hasTypeId(id)).toBe(true);
    });
    registry.register(entryOf());
    expect(seen).toEqual(["core.shape"]);
  });

  it("attributes entries to owners (§1.7.5 enumeration)", () => {
    const registry = registerCoreObjectTypes(new ObjectRegistry());
    const coreEntries = registry.entriesOfOwner("core");
    // R8.3: the frame joins the core catalog; R11.1: the sticker;
    // R15.2: the live query card; فاز M1: the video; فاز A1: the audio;
    // فاز P1: the PDF (14 first-party).
    expect(coreEntries).toHaveLength(14);
    expect(registry.entriesOfOwner("acme")).toHaveLength(0);
  });
});

/** Registers one third-party entry on the registry. */
function registryWithThirdParty(registry: ObjectRegistry): ObjectRegistry {
  registry.register(entryOf({ id: "acme.widget", kind: "widget" }));
  return registry;
}

describe("ObjectRegistry.runTypeMigrations (R4.4b)", () => {
  it("returns the payload unchanged when versions match", () => {
    const entry = entryOf({ version: 1 });
    const payload = { a: 1 };
    expect(ObjectRegistry.runTypeMigrations(entry, payload, 1)).toBe(payload);
  });

  it("walks a v1 → v2 chain forward and transforms the payload", () => {
    const entry = entryOf({
      version: 2,
      migrations: [
        {
          fromVersion: 1,
          toVersion: 2,
          migrate: (data) => ({
            ...(data as Record<string, unknown>),
            extra: true,
          }),
        },
      ],
    });
    const migrated = ObjectRegistry.runTypeMigrations(
      entry,
      { a: 1 },
      1,
    ) as Record<string, unknown>;
    expect(migrated).toEqual({ a: 1, extra: true });
  });

  it("refuses an unknown FUTURE per-type version (never guess)", () => {
    const entry = entryOf({ version: 1 });
    expect(ObjectRegistry.runTypeMigrations(entry, { a: 1 }, 2)).toBeNull();
    expect(ObjectRegistry.runTypeMigrations(entry, { a: 1 }, 0)).toBeNull();
  });

  it("refuses a broken chain (missing step)", () => {
    const entry = entryOf({
      version: 3,
      migrations: [
        { fromVersion: 1, toVersion: 2, migrate: (data) => data },
        // 2 → 3 missing
      ],
    });
    expect(ObjectRegistry.runTypeMigrations(entry, { a: 1 }, 1)).toBeNull();
  });
});

describe("registerCoreObjectTypes (the core catalog)", () => {
  it("registers the first-party kinds plus the opaque entry", () => {
    const registry = registerCoreObjectTypes(new ObjectRegistry());
    expect([...registry.ids()].sort()).toEqual(
      [
        CORE_TYPE_IDS.shape,
        CORE_TYPE_IDS.textBox,
        CORE_TYPE_IDS.stickyNote,
        CORE_TYPE_IDS.image,
        CORE_TYPE_IDS.video,
        CORE_TYPE_IDS.audio,
        CORE_TYPE_IDS.pdf,
        CORE_TYPE_IDS.connector,
        CORE_TYPE_IDS.freehand,
        CORE_TYPE_IDS.group,
        CORE_TYPE_IDS.opaque,
        CORE_TYPE_IDS.frame,
        CORE_TYPE_IDS.sticker,
        CORE_TYPE_IDS.query,
      ].sort(),
    );
  });

  it("gives every entry introspectable metadata (§1.7.3)", () => {
    const registry = registerCoreObjectTypes(new ObjectRegistry());
    for (const entry of registry.list()) {
      expect(entry.titleKey).toBeTruthy();
      expect(entry.version).toBeGreaterThanOrEqual(1);
      expect(entry.id.startsWith("core.")).toBe(true);
      expect(typeof entry.factory).toBe("function");
    }
  });

  it("produces distinct default instances from the factories", () => {
    const registry = registerCoreObjectTypes(new ObjectRegistry());
    for (const entry of registry.list()) {
      const first = entry.factory();
      const second = entry.factory();
      expect(first).not.toBe(second);
      expect(first.id).not.toBe(second.id);
    }
  });

  it("carries the widget-catalog metadata on insertable kinds (§1.7.7)", () => {
    const registry = registerCoreObjectTypes(new ObjectRegistry());
    const withCatalog = registry
      .list()
      .filter((entry) => entry.catalog !== undefined);
    expect(withCatalog.length).toBeGreaterThanOrEqual(6);
    for (const entry of withCatalog) {
      expect(entry.catalog?.titleKey).toBeTruthy();
      expect(typeof entry.catalog?.group).toBe("string");
    }
  });

  it("serializes an opaque object back verbatim through its entry", () => {
    const registry = registerCoreObjectTypes(new ObjectRegistry());
    const raw = { typeId: "widget.x", id: "w1", position: { x: 0, y: 0 } };
    const opaque =
      registry.entryForTypeId(CORE_TYPE_IDS.opaque)?.deserialize(raw) ?? null;
    expect(opaque).not.toBeNull();
    const wire = registry.entryForKind("opaque")?.serialize(opaque as never);
    expect(wire).toEqual(raw);
  });

  it("round-trips a shape through the registry end-to-end", () => {
    const registry = registerCoreObjectTypes(new ObjectRegistry());
    const shape: ShapeObjectData = {
      id: "obj-1",
      kind: "shape",
      position: vec2(1, 2),
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      shapeKind: "ellipse",
      width: 50,
      height: 30,
      fill: "#fff",
      stroke: "#000",
      strokeWidth: 1,
    };
    const wire = registry.entryForKind("shape")?.serialize(shape) as Record<
      string,
      unknown
    >;
    const restored = registry
      .entryForTypeId(CORE_TYPE_IDS.shape)
      ?.deserialize(wire as Record<string, unknown>);
    expect(restored).toEqual(shape);
  });
});
