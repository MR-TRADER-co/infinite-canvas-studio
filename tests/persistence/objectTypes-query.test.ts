/**
 * Registration + persistence round-trip tests for the live query type
 * (R15.2) — the sticker-test pattern applied to the knowledge card.
 */
import { describe, expect, it } from "vitest";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import {
  registerCoreObjectTypes,
  CORE_TYPE_IDS,
} from "@/persistence/objectTypes";
import { makeQueryObject } from "@/core/model/QueryObject";
import type { QueryObjectData } from "@/core/model/QueryObject";
import {
  insertCatalogObject,
  resolveCatalogCards,
} from "@/interaction/CatalogInsert";
import { Scene } from "@/core/model/Scene";
import { HistoryManager } from "@/core/history/HistoryManager";
import { vec2 } from "@/core/geometry/Vec2";

describe("Query object type registration (R15.2)", () => {
  const registry = registerCoreObjectTypes(new ObjectRegistry());

  it("registers core.query with the knowledge catalog group", () => {
    expect(registry.has(CORE_TYPE_IDS.query)).toBe(true);
    const entry = registry.get(CORE_TYPE_IDS.query);
    expect(entry?.kind).toBe("query");
    expect(entry?.titleKey).toBe("object.query");
    expect(entry?.catalog?.group).toBe("knowledge");
    expect(entry?.catalog?.icon).toBe("Search");
    expect(entry?.catalog?.cards?.length).toBe(2);
  });

  it("exposes one live-query card defaulting to the islands query", () => {
    const cards = resolveCatalogCards(registry).filter(
      (card) => card.typeId === CORE_TYPE_IDS.query,
    );
    expect(cards.map((card) => card.key)).toEqual([
      "query.live",
      "query.filter",
    ]);
    const object = cards[0]?.factory() as QueryObjectData;
    expect(object.kind).toBe("query");
    expect(object.queryType).toBe("orphans");
    expect(object.queryTarget).toBe("");
    expect(object.width).toBe(264);
    expect(object.height).toBe(168);
    // R12.2: the structured-filter card defaults to the all-match spec.
    const filter = cards[1]?.factory() as QueryObjectData;
    expect(filter.kind).toBe("query");
    expect(filter.queryType).toBe("filter");
    expect(filter.querySpec).toEqual({ filters: [], limit: 100 });
    expect(filter.columns).toEqual([]);
  });

  it("round-trips a structured filter card with its spec + columns (R12.2)", () => {
    const entry = registry.get(CORE_TYPE_IDS.query)!;
    const query: QueryObjectData = {
      ...makeQueryObject("q-7", vec2(10, 20), {
        type: "filter",
        target: "",
        structured: {
          filters: [{ prop: "اولویت", op: "gt", value: "۴" }],
          tagsAll: ["مهم"],
          limit: 25,
          sortBy: { prop: "اولویت", dir: "desc" },
          groupBy: "وضعیت",
        },
      }),
      columns: ["وضعیت", "اولویت"],
      name: "کارهای مهم",
    };
    const wire = entry.serialize?.(query) as Record<string, unknown>;
    expect(wire.queryType).toBe("filter");
    expect(wire.querySpec).toEqual(query.querySpec);
    expect(wire.columns).toEqual(["وضعیت", "اولویت"]);
    const back = entry.deserialize?.(wire) as QueryObjectData | null;
    expect(back).not.toBeNull();
    expect(back?.queryType).toBe("filter");
    expect(back?.querySpec).toEqual(query.querySpec);
    expect(back?.columns).toEqual(["وضعیت", "اولویت"]);
    // A corrupt spec degrades to the all-match default (§1.7.4) — the
    // card is never dropped.
    const corrupt = entry.deserialize?.({
      ...wire,
      querySpec: "garbage",
    }) as QueryObjectData | null;
    expect(corrupt).not.toBeNull();
    expect(corrupt?.querySpec).toEqual({ filters: [], limit: 100 });
  });

  it("round-trips a query through serialize + deserialize", () => {
    const entry = registry.get(CORE_TYPE_IDS.query)!;
    const query: QueryObjectData = {
      ...makeQueryObject("q-9", vec2(20, 30), {
        type: "backlinks",
        target: "هدف نهایی",
      }),
      name: "ارجاع‌ها به هدف",
    };
    const wire = entry.serialize?.(query) as Record<string, unknown>;
    expect(wire.typeId).toBe("core.query");
    expect(wire.typeVersion).toBe(1);
    expect(wire.queryType).toBe("backlinks");
    expect(wire.queryTarget).toBe("هدف نهایی");
    expect(wire.kind).toBeUndefined(); // (the discriminant never rides the wire)
    const back = entry.deserialize?.(wire) as QueryObjectData | null;
    expect(back).not.toBeNull();
    expect(back?.queryType).toBe("backlinks");
    expect(back?.queryTarget).toBe("هدف نهایی");
    expect(back?.position).toEqual({ x: 20, y: 30 });
    expect(back?.name).toBe("ارجاع‌ها به هدف");
  });

  it("refuses corrupt queries (bad type, bad target, missing fields)", () => {
    const entry = registry.get(CORE_TYPE_IDS.query)!;
    const query = makeQueryObject("q-1", vec2(0, 0), {
      type: "tag",
      target: "مهم",
    });
    const wire = entry.serialize?.(query) as Record<string, unknown>;
    // Unknown query type refuses.
    expect(entry.deserialize?.({ ...wire, queryType: "everything" })).toBeNull();
    // Wrong-typed target refuses.
    expect(entry.deserialize?.({ ...wire, queryTarget: 7 })).toBeNull();
    // Over-long target refuses.
    expect(
      entry.deserialize?.({ ...wire, queryTarget: "x".repeat(201) }),
    ).toBeNull();
    // Missing common fields refuse.
    const noId = { ...wire };
    delete noId.id;
    expect(entry.deserialize?.(noId)).toBeNull();
  });

  it("clamps undersized cards back to a readable minimum", () => {
    const entry = registry.get(CORE_TYPE_IDS.query)!;
    const query = makeQueryObject(
      "q-2",
      vec2(0, 0),
      { type: "broken", target: "" },
      { width: 10, height: 8 },
    );
    const wire = entry.serialize?.(query) as Record<string, unknown>;
    const back = entry.deserialize?.(wire) as QueryObjectData | null;
    expect(back).not.toBeNull();
    expect(back?.width).toBeGreaterThanOrEqual(132);
    expect(back?.height).toBeGreaterThanOrEqual(56);
  });

  it("inserts the catalog card centred on the drop point (one undo step)", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const created = insertCatalogObject(
      scene,
      history,
      registry,
      CORE_TYPE_IDS.query,
      "query.live",
      vec2(500, 400),
    );
    expect(created).not.toBeNull();
    expect(created?.kind).toBe("query");
    // Centred on the drop point: default 264×168 → (368, 316).
    expect(created?.position).toEqual({ x: 368, y: 316 });
    expect(scene.objectCount).toBe(1);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(scene.objectCount).toBe(0);
  });
});
