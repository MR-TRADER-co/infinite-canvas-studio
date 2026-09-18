/** Registration + persistence round-trip tests for the sticker type (R11.1). */
import { describe, expect, it } from "vitest";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import {
  registerCoreObjectTypes,
  CORE_TYPE_IDS,
} from "@/persistence/objectTypes";
import { makeStickerObject } from "@/core/model/StickerObject";
import type { StickerObjectData } from "@/core/model/StickerObject";
import {
  insertCatalogObject,
  resolveCatalogCards,
} from "@/interaction/CatalogInsert";
import { Scene } from "@/core/model/Scene";
import { HistoryManager } from "@/core/history/HistoryManager";
import { vec2 } from "@/core/geometry/Vec2";

describe("Sticker object type registration (R11.1)", () => {
  const registry = registerCoreObjectTypes(new ObjectRegistry());

  it("registers core.sticker with the sticker catalog group", () => {
    expect(registry.has(CORE_TYPE_IDS.sticker)).toBe(true);
    const entry = registry.get(CORE_TYPE_IDS.sticker);
    expect(entry?.kind).toBe("sticker");
    expect(entry?.titleKey).toBe("object.sticker");
    expect(entry?.catalog?.group).toBe("stickers");
    expect(entry?.catalog?.icon).toBe("Smile");
    expect(entry?.catalog?.cards?.length).toBe(8);
  });

  it("exposes one card per curated emoji with previews", () => {
    const cards = resolveCatalogCards(registry).filter(
      (card) => card.typeId === CORE_TYPE_IDS.sticker,
    );
    expect(cards.map((card) => card.key)).toEqual([
      "sticker.star",
      "sticker.smile",
      "sticker.love",
      "sticker.fire",
      "sticker.idea",
      "sticker.target",
      "sticker.rocket",
      "sticker.check",
    ]);
    for (const card of cards) {
      expect(card.preview).toBeDefined();
      const object = card.factory() as StickerObjectData;
      expect(object.kind).toBe("sticker");
      expect(object.emoji).toBe(card.preview);
      expect(object.width).toBe(96);
      expect(object.height).toBe(96);
    }
  });

  it("round-trips a sticker through serialize + deserialize", () => {
    const entry = registry.get(CORE_TYPE_IDS.sticker)!;
    const sticker: StickerObjectData = {
      ...makeStickerObject("st-9", "🎉", vec2(20, 30), 140, 7),
      name: "جشن شروع",
    };
    const wire = entry.serialize?.(sticker) as Record<string, unknown>;
    expect(wire.typeId).toBe("core.sticker");
    expect(wire.typeVersion).toBe(1);
    expect(wire.emoji).toBe("🎉");
    const back = entry.deserialize?.(wire) as StickerObjectData | null;
    expect(back).not.toBeNull();
    expect(back?.emoji).toBe("🎉");
    expect(back?.width).toBe(140);
    expect(back?.height).toBe(140);
    expect(back?.zIndex).toBe(7);
    expect(back?.position).toEqual({ x: 20, y: 30 });
    expect(back?.name).toBe("جشن شروع");
  });

  it("refuses corrupt stickers (wrong-typed or missing fields)", () => {
    const entry = registry.get(CORE_TYPE_IDS.sticker)!;
    const sticker = makeStickerObject("st-1", "⭐", vec2(0, 0));
    const wire = entry.serialize?.(sticker) as Record<string, unknown>;
    // Wrong-typed emoji refuses.
    expect(entry.deserialize?.({ ...wire, emoji: 42 })).toBeNull();
    // Empty emoji refuses (a sticker without a glyph is meaningless).
    expect(entry.deserialize?.({ ...wire, emoji: "" })).toBeNull();
    // Negative size refuses.
    expect(entry.deserialize?.({ ...wire, width: -5 })).toBeNull();
    // Missing common fields refuse.
    const noId = { ...wire };
    delete noId.id;
    expect(entry.deserialize?.(noId)).toBeNull();
  });

  it("inserts a catalog card centred on the drop point (one undo step)", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const created = insertCatalogObject(
      scene,
      history,
      registry,
      CORE_TYPE_IDS.sticker,
      "sticker.rocket",
      vec2(500, 400),
    );
    expect(created).not.toBeNull();
    expect(created?.kind).toBe("sticker");
    // Centred on the drop point: default 96×96 → top-left at (452, 352).
    expect(created?.position).toEqual({ x: 452, y: 352 });
    expect(scene.objectCount).toBe(1);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(scene.objectCount).toBe(0);
  });
});
