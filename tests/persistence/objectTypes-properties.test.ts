/**
 * Structured-properties persistence tests (pack R11.3, AC11.3):
 * the properties record rides every object kind's wire payload, a
 * pre-Phase-11 file (no `properties` field) opens with none, wrong-typed
 * entries drop without refusing the object, the UpdateObjectCommand
 * swaps the record in one undo step, and the record survives the full
 * VersionedSerializer round-trip with the schema section.
 */
import { describe, expect, it } from "vitest";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import {
  registerCoreObjectTypes,
  CORE_TYPE_IDS,
} from "@/persistence/objectTypes";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import type { StickyNoteObjectData } from "@/core/model/StickyNoteObject";
import { TAGS_PROPERTY, type PropertyValue } from "@/core/model/Properties";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import { Scene } from "@/core/model/Scene";
import { HistoryManager } from "@/core/history/HistoryManager";
import { VersionedSerializer } from "@/persistence/VersionedSerializer";
import { buildProjectData } from "@/persistence/ProjectFile";

const FULL_RECORD: Record<string, PropertyValue> = {
  owner: "سارا",
  priority: 2,
  done: false,
  due: "2026-09-15",
  [TAGS_PROPERTY]: ["مهم", "فوری"],
};

/** Builds a default sticky note through the registry factory. */
function defaultSticky(
  registry: ObjectRegistry,
  id: string,
): StickyNoteObjectData {
  const made = registry.get(CORE_TYPE_IDS.stickyNote)!.factory() as unknown as
    Omit<StickyNoteObjectData, "id">;
  return { ...made, id };
}

/** Builds a default rectangle through the registry factory. */
function defaultShape(
  registry: ObjectRegistry,
  id: string,
): ShapeObjectData {
  const made = registry.get(CORE_TYPE_IDS.shape)!.factory() as unknown as
    Omit<ShapeObjectData, "id">;
  return { ...made, id };
}

describe("properties on the object wire (AC11.3)", () => {
  const registry = registerCoreObjectTypes(new ObjectRegistry());

  it("round-trips all five value shapes on a sticky note", () => {
    const entry = registry.get(CORE_TYPE_IDS.stickyNote)!;
    const sticky: StickyNoteObjectData = {
      ...defaultSticky(registry, "s-1"),
      properties: FULL_RECORD,
    };
    const wire = entry.serialize?.(sticky) as Record<string, unknown>;
    expect(wire.properties).toEqual(FULL_RECORD);
    const back = entry.deserialize?.(wire) as StickyNoteObjectData | null;
    expect(back?.properties).toEqual(FULL_RECORD);
  });

  it("carries properties on every common-field kind (shape)", () => {
    const entry = registry.get(CORE_TYPE_IDS.shape)!;
    const shape = {
      ...defaultShape(registry, "sh-1"),
      properties: { priority: 1 },
    };
    const wire = entry.serialize?.(shape) as Record<string, unknown>;
    const back = entry.deserialize?.(wire) as typeof shape | null;
    expect(back?.properties).toEqual({ priority: 1 });
  });

  it("opens a pre-Phase-11 file (no field) with NO properties", () => {
    const entry = registry.get(CORE_TYPE_IDS.stickyNote)!;
    const wire = entry.serialize?.(
      defaultSticky(registry, "s-2"),
    ) as Record<string, unknown>;
    delete wire.properties;
    const back = entry.deserialize?.(wire) as StickyNoteObjectData | null;
    expect(back).not.toBeNull();
    expect(back?.properties).toBeUndefined();
    // …and the re-saved wire stays property-free (no field materialises).
    const reSaved = entry.serialize?.(back!) as Record<string, unknown>;
    expect(reSaved.properties).toBeUndefined();
  });

  it("drops wrong-typed property entries without refusing the object", () => {
    const entry = registry.get(CORE_TYPE_IDS.stickyNote)!;
    const wire = entry.serialize?.(
      defaultSticky(registry, "s-3"),
    ) as Record<string, unknown>;
    wire.properties = { ok: 1, nested: { deep: true }, "": "x" };
    const back = entry.deserialize?.(wire) as StickyNoteObjectData | null;
    expect(back).not.toBeNull();
    expect(back?.properties).toEqual({ ok: 1 });
  });
});

describe("UpdateObjectCommand properties patch (R11.8 one undo step)", () => {
  it("swaps the record, undoes and redoes exactly", () => {
    const registry = registerCoreObjectTypes(new ObjectRegistry());
    const scene = new Scene();
    const history = new HistoryManager();
    const sticky = defaultSticky(registry, "s-9");
    scene.add(sticky);

    const command = new UpdateObjectCommand(
      scene,
      "s-9",
      { properties: { ...FULL_RECORD } },
      sticky,
    );
    command.do();
    history.push(command);
    expect(scene.findById("s-9")?.properties).toEqual(FULL_RECORD);

    history.undo();
    expect(scene.findById("s-9")?.properties).toBeUndefined();

    history.redo();
    expect(scene.findById("s-9")?.properties).toEqual(FULL_RECORD);
  });

  it("clears the record when patched with undefined", () => {
    const registry = registerCoreObjectTypes(new ObjectRegistry());
    const scene = new Scene();
    const history = new HistoryManager();
    const sticky: StickyNoteObjectData = {
      ...defaultSticky(registry, "s-10"),
      properties: { owner: "x" },
    };
    scene.add(sticky);

    const command = new UpdateObjectCommand(
      scene,
      "s-10",
      { properties: undefined },
      sticky,
    );
    command.do();
    history.push(command);
    expect(scene.findById("s-10")?.properties).toBeUndefined();
    history.undo();
    expect(scene.findById("s-10")?.properties).toEqual({ owner: "x" });
  });
});

describe("full serializer round-trip (properties + schema section)", () => {
  it("keeps the record and the propertySchema through save + load", () => {
    const registry = registerCoreObjectTypes(new ObjectRegistry());
    const serializer = new VersionedSerializer(registry);
    const scene = new Scene();
    const sticky: StickyNoteObjectData = {
      ...defaultSticky(registry, "s-20"),
      properties: FULL_RECORD,
    };
    scene.add(sticky);

    const json = serializer.serialize(
      buildProjectData(
        scene,
        {},
        [],
        { version: 1, styles: [] },
        {
          version: 1,
          fields: { status: { type: "select", options: ["TODO", "done"] } },
        },
      ),
    );
    const outcome = serializer.deserialize(json);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") {
      return;
    }
    expect(outcome.data.objects[0]?.properties).toEqual(FULL_RECORD);
    expect(outcome.data.propertySchema).toEqual({
      version: 1,
      fields: { status: { type: "select", options: ["TODO", "done"] } },
    });
  });

  it("an empty schema section stays absent from the file", () => {
    const registry = registerCoreObjectTypes(new ObjectRegistry());
    const serializer = new VersionedSerializer(registry);
    const scene = new Scene();
    scene.add(defaultSticky(registry, "s-21"));
    const json = serializer.serialize(buildProjectData(scene, {}, []));
    expect(json.includes("propertySchema")).toBe(false);
  });
});
