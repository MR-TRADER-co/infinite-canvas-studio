import { describe, expect, it } from "vitest";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import {
  registerCoreObjectTypes,
  CORE_TYPE_IDS,
} from "@/persistence/objectTypes";
import { makeFrameObject } from "@/core/model/FrameObject";
import type { FrameObjectData } from "@/core/model/FrameObject";

describe("Frame object type registration (R8.3)", () => {
  const registry = registerCoreObjectTypes(new ObjectRegistry());

  it("registers core.frame with catalog metadata for the Insert Panel", () => {
    expect(registry.has(CORE_TYPE_IDS.frame)).toBe(true);
    const entry = registry.get(CORE_TYPE_IDS.frame);
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe("frame");
    expect(entry?.titleKey).toBe("tool.frame");
    expect(entry?.catalog?.group).toBe("shapes");
    // AC8.3-adjacent seam: the catalog card renders FROM this metadata —
    // registering the type is what makes the frame card appear.
    expect(entry?.catalog?.icon).toBe("Frame");
  });

  it("round-trips a frame through serialize + deserialize", () => {
    const entry = registry.get(CORE_TYPE_IDS.frame)!;
    const frame: FrameObjectData = {
      ...makeFrameObject("frame-9", 4, { x: 20, y: 30 }),
      title: "اسلاید معرفی",
      name: "قاب معرفی",
    };
    const wire = entry.serialize?.(frame) as Record<string, unknown>;
    expect(wire.typeId).toBe("core.frame");
    expect(wire.typeVersion).toBe(1);
    expect(wire.title).toBe("اسلاید معرفی");
    const back = entry.deserialize?.(wire) as FrameObjectData | null;
    expect(back).not.toBeNull();
    expect(back?.title).toBe("اسلاید معرفی");
    expect(back?.position).toEqual({ x: 20, y: 30 });
    expect(back?.width).toBe(frame.width);
    expect(back?.kind).toBe("frame");
  });

  it("accepts payloads without a title (defaults to empty)", () => {
    const entry = registry.get(CORE_TYPE_IDS.frame)!;
    const frame = makeFrameObject("f", 0);
    const wire = entry.serialize?.(frame) as Record<string, unknown>;
    delete wire.title;
    const back = entry.deserialize?.(wire) as FrameObjectData | null;
    expect(back?.title).toBe("");
  });

  it("refuses corrupt frames (wrong-typed fields)", () => {
    const entry = registry.get(CORE_TYPE_IDS.frame)!;
    const frame = makeFrameObject("f", 0);
    const wire = entry.serialize?.(frame) as Record<string, unknown>;
    // Broken titleHeight → refuse (the caller keeps an opaque placeholder).
    const broken = { ...wire, titleHeight: "big" };
    expect(entry.deserialize?.(broken)).toBeNull();
    // Negative size refuses too.
    const brokenSize = { ...wire, width: -5 };
    expect(entry.deserialize?.(brokenSize)).toBeNull();
    // Missing common fields refuse.
    const noId = { ...wire };
    delete noId.id;
    expect(entry.deserialize?.(noId)).toBeNull();
  });
});
