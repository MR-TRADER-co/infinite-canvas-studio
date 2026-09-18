/**
 * Catalog insertion tests (R7.12/AC7.13/AC7.14/AC7.15): card resolution
 * EXCLUSIVELY from the ObjectRegistry (the dummy-type seam proof), the
 * group ordering, and the exact-at-point placement with one undo step.
 */
import { describe, expect, it } from "vitest";
import {
  insertCatalogObject,
  resolveCatalogCards,
} from "@/interaction/CatalogInsert";
import { registerCoreObjectTypes } from "@/persistence/objectTypes";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import { HistoryManager } from "@/core/history/HistoryManager";
import { Scene } from "@/core/model/Scene";
import { objectBBox } from "@/core/model/SceneObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";

/** The core registry with the first-party types registered. */
function coreRegistry(): ObjectRegistry {
  return registerCoreObjectTypes(new ObjectRegistry());
}

describe("resolveCatalogCards (R7.12)", () => {
  it("resolves the 21 core cards grouped + ordered (AC7.13 + R8.3 frame + R11.1 stickers + R15.2 query + R12.2 filter + فاز M1 video + فاز A1 audio + فاز P1 pdf)", () => {
    const cards = resolveCatalogCards(coreRegistry());
    const ids = cards.map((card) => `${card.typeId}:${card.key}`);
    // Groups sort alphabetically (drawing → knowledge → media → shapes →
    // stickers → text&notes); the PANEL renders them in the spec's own
    // visual order.
    expect(ids).toEqual([
      "core.connector:core.connector",
      "core.freehand:core.freehand",
      "core.query:query.live",
      "core.query:query.filter",
      "core.image:core.image",
      "core.video:core.video",
      "core.audio:core.audio",
      "core.pdf:core.pdf",
      "core.shape:rectangle",
      "core.shape:ellipse",
      "core.frame:core.frame",
      "core.sticker:sticker.star",
      "core.sticker:sticker.smile",
      "core.sticker:sticker.love",
      "core.sticker:sticker.fire",
      "core.sticker:sticker.idea",
      "core.sticker:sticker.target",
      "core.sticker:sticker.rocket",
      "core.sticker:sticker.check",
      "core.textBox:core.textBox",
      "core.stickyNote:core.stickyNote",
    ]);
    expect(cards[0]?.group).toBe("drawing");
    expect(cards[2]?.group).toBe("knowledge");
    expect(cards[4]?.group).toBe("media");
    // فاز M1: the video card sits right after the image card (media).
    expect(cards[5]?.typeId).toBe("core.video");
    expect(cards[5]?.group).toBe("media");
    // فاز A1: the audio card sits right after the video card (media).
    expect(cards[6]?.typeId).toBe("core.audio");
    expect(cards[6]?.group).toBe("media");
    // فاز P1: the PDF card sits right after the audio card (media).
    expect(cards[7]?.typeId).toBe("core.pdf");
    expect(cards[7]?.group).toBe("media");
    expect(cards[8]?.group).toBe("shapes");
    expect(cards[11]?.group).toBe("stickers");
    expect(cards[19]?.group).toBe("text&notes");
    // R11.1: the sticker cards carry their emoji previews for the panel.
    expect(cards[11]?.preview).toBe("⭐");
    expect(cards[18]?.preview).toBe("✅");
    // R15.2: the live-query card carries its search-glyph preview.
    expect(cards[2]?.preview).toBe("🔍");
    // R12.2: the structured-filter card carries its abacus preview.
    expect(cards[3]?.preview).toBe("🧮");
  });

  it("rect and ellipse cards produce distinct factories with the SAME defaults", () => {
    const cards = resolveCatalogCards(coreRegistry());
    const rect = cards.find((card) => card.key === "rectangle");
    const ellipse = cards.find((card) => card.key === "ellipse");
    const rectObject = rect?.factory() as ShapeObjectData;
    const ellipseObject = ellipse?.factory() as ShapeObjectData;
    expect(rectObject.shapeKind).toBe("rectangle");
    expect(ellipseObject.shapeKind).toBe("ellipse");
    // Same factory defaults: size, fill/stroke tokens, stroke width.
    expect(ellipseObject.width).toBe(rectObject.width);
    expect(ellipseObject.fill).toBe(rectObject.fill);
    expect(ellipseObject.strokeWidth).toBe(rectObject.strokeWidth);
  });

  it("AC7.13 seam: a dummy registration's card appears with ZERO panel-code edits", () => {
    const registry = coreRegistry();
    registry.register({
      id: "core.dummy",
      kind: "dummy",
      titleKey: "tool.pen",
      version: 1,
      factory: () =>
        ({
          id: "dummy-1",
          kind: "dummy",
          position: vec2(0, 0),
          rotation: 0,
          zIndex: 0,
          visible: true,
          locked: false,
        }) as unknown as SceneObjectData,
      catalog: {
        titleKey: "tool.pen",
        group: "adummy",
        order: 5,
        icon: "Square",
      },
      serialize: (object) =>
        ({ ...object, typeId: "core.dummy", typeVersion: 1 }) as never,
      deserialize: () => null,
    });
    const cards = resolveCatalogCards(registry);
    const dummy = cards.find((card) => card.typeId === "core.dummy");
    expect(dummy).toBeDefined();
    expect(dummy?.group).toBe("adummy");
    // Sorted before the core rectangle (order 5 < 10) — the panel
    // rendering only consumes this list.
    expect(cards[0]?.typeId).toBe("core.dummy");
  });
});

describe("insertCatalogObject (R7.12/AC7.14/AC7.15)", () => {
  it("places the object's bbox centre EXACTLY at the target point", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const object = insertCatalogObject(
      scene,
      history,
      coreRegistry(),
      "core.shape",
      "rectangle",
      vec2(500, 300),
    );
    expect(object).not.toBeNull();
    const box = objectBBox(object as SceneObjectData);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(500, 6);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(300, 6);
    // Exactly ONE undo step (one AddObjectCommand).
    history.undo();
    expect(scene.objectCount).toBe(0);
  });

  it("the default instance matches the registry factory defaults (AC7.15)", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const registry = coreRegistry();
    const factoryDefault = registry
      .entryForKind("shape")
      ?.factory() as ShapeObjectData;
    const inserted = insertCatalogObject(
      scene,
      history,
      registry,
      "core.shape",
      "rectangle",
      vec2(0, 0),
    ) as ShapeObjectData;
    expect(inserted.width).toBe(factoryDefault.width);
    expect(inserted.height).toBe(factoryDefault.height);
    expect(inserted.fill).toBe(factoryDefault.fill);
    expect(inserted.stroke).toBe(factoryDefault.stroke);
    expect(inserted.strokeWidth).toBe(factoryDefault.strokeWidth);
    expect(inserted.shapeKind).toBe(factoryDefault.shapeKind);
  });

  it("translates freehand points and connector endpoints along (kind-aware)", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const stroke = insertCatalogObject(
      scene,
      history,
      coreRegistry(),
      "core.freehand",
      "core.freehand",
      vec2(1000, 1000),
    );
    expect(stroke).not.toBeNull();
    const box = objectBBox(stroke as SceneObjectData);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(1000, 6);
    const connector = insertCatalogObject(
      scene,
      history,
      coreRegistry(),
      "core.connector",
      "core.connector",
      vec2(2000, 0),
    );
    expect(connector).not.toBeNull();
    const connectorBox = objectBBox(connector as SceneObjectData);
    expect((connectorBox.minX + connectorBox.maxX) / 2).toBeCloseTo(2000, 6);
  });

  it("refuses unknown types and cards", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const registry = coreRegistry();
    expect(
      insertCatalogObject(
        scene,
        history,
        registry,
        "nope.nope",
        "x",
        vec2(0, 0),
      ),
    ).toBeNull();
    expect(
      insertCatalogObject(
        scene,
        history,
        registry,
        "core.shape",
        "star",
        vec2(0, 0),
      ),
    ).toBeNull();
    expect(scene.objectCount).toBe(0);
  });
});
