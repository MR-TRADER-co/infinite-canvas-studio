/**
 * The PDF type-registration tests (فاز P1 — RP1.2, ACP1.1/ACP1.3):
 * registry presence + catalog metadata (§1.7.7), the persistence
 * round-trip (serialize v1 → deserialize), corrupt-payload refusal (the
 * opaque fallback), and the unknown-type law untouched.
 */
import { describe, expect, it } from "vitest";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import {
  CORE_TYPE_IDS,
  registerCoreObjectTypes,
} from "@/persistence/objectTypes";
import type { PdfObjectData } from "@/core/model/PdfObject";

function makeRegistry(): ObjectRegistry {
  const registry = new ObjectRegistry();
  registerCoreObjectTypes(registry);
  return registry;
}

const HASH = "c".repeat(64);
const THUMB = "d".repeat(64);

function makePdf(): PdfObjectData {
  return {
    id: "pdf-1",
    kind: "pdf",
    position: { x: 5, y: 6 },
    rotation: 30,
    zIndex: 3,
    visible: true,
    locked: false,
    assetHash: HASH,
    thumbHash: THUMB,
    originalName: "report.pdf",
    pageCount: 12,
    currentPage: 4,
    naturalWidth: 595,
    naturalHeight: 842,
    width: 300,
    height: 424,
  };
}

describe("core.pdf registration (فاز P1)", () => {
  it("registers under the reserved core owner with catalog metadata", () => {
    const registry = makeRegistry();
    const entry = registry.entryForTypeId(CORE_TYPE_IDS.pdf);
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe("pdf");
    expect(entry?.titleKey).toBe("objectTypes.pdf");
    expect(entry?.catalog?.group).toBe("media");
    // Order AFTER the audio card (A.2.6).
    expect(entry?.catalog?.order).toBeGreaterThan(
      registry.entryForTypeId(CORE_TYPE_IDS.audio)?.catalog?.order ?? 0,
    );
    expect(entry?.catalog?.icon).toBe("FileText");
  });

  it("round-trips the wire payload (ACP1.3)", () => {
    const registry = makeRegistry();
    const entry = registry.entryForTypeId(CORE_TYPE_IDS.pdf)!;
    const wire = entry.serialize(makePdf());
    expect(wire.typeId).toBe("core.pdf");
    expect(wire.typeVersion).toBe(1);
    expect(wire.kind).toBeUndefined(); // the in-memory discriminant never rides
    expect(wire.assetHash).toBe(HASH);
    expect(wire.pageCount).toBe(12);
    expect(wire.currentPage).toBe(4);
    const back = entry.deserialize(wire) as PdfObjectData;
    expect(back).toEqual(makePdf());
  });

  it("refuses corrupt payloads (the opaque fallback keeps them)", () => {
    const registry = makeRegistry();
    const entry = registry.entryForTypeId(CORE_TYPE_IDS.pdf)!;
    const wire = entry.serialize(makePdf());
    expect(entry.deserialize({ ...wire, assetHash: "not-a-hash" })).toBeNull();
    expect(entry.deserialize({ ...wire, pageCount: "many" })).not.toBeNull();
    expect(entry.deserialize({ ...wire, currentPage: 999 })).not.toBeNull();
    const clamped = entry.deserialize({
      ...wire,
      currentPage: 999,
    }) as PdfObjectData;
    expect(clamped.currentPage).toBe(12);
    expect(clamped.pageCount).toBe(12);
  });

  it("degrades a malformed thumbHash to null (the lenient rule)", () => {
    const registry = makeRegistry();
    const entry = registry.entryForTypeId(CORE_TYPE_IDS.pdf)!;
    const wire = entry.serialize(makePdf());
    const back = entry.deserialize({ ...wire, thumbHash: 42 }) as PdfObjectData;
    expect(back.thumbHash).toBeNull();
  });

  it("keeps the unknown-type passthrough law (§1.7.4)", () => {
    const registry = makeRegistry();
    const entry = registry.entryForTypeId("future.plugin.thing");
    expect(entry).toBeUndefined();
  });
});
