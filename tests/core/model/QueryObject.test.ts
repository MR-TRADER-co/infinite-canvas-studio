/**
 * Query-object model tests (R15.2): guard, factory defaults, bbox and
 * translate through the generic sized-object machinery.
 */
import { describe, expect, it } from "vitest";
import {
  isQueryObject,
  makeQueryObject,
  QUERY_DEFAULT_HEIGHT,
  QUERY_DEFAULT_WIDTH,
} from "@/core/model/QueryObject";
import type { StickerObjectData } from "@/core/model/StickerObject";
import { makeStickerObject } from "@/core/model/StickerObject";
import { objectBBox, translateSceneObject } from "@/core/model/SceneObject";
import { vec2 } from "@/core/geometry/Vec2";

describe("QueryObject model (R15.2)", () => {
  it("narrows through the type guard and rejects other kinds", () => {
    const query = makeQueryObject("q-1", vec2(0, 0), {
      type: "backlinks",
      target: "هدف نهایی",
    });
    expect(isQueryObject(query)).toBe(true);
    const sticker: StickerObjectData = makeStickerObject(
      "st-1",
      "⭐",
      vec2(0, 0),
    );
    expect(isQueryObject(sticker)).toBe(false);
    // Wrong-typed extras fail the guard (the value layer validates).
    expect(
      isQueryObject({ ...query, queryType: 42 } as unknown as typeof query),
    ).toBe(false);
    expect(
      isQueryObject({ ...query, queryTarget: 7 } as unknown as typeof query),
    ).toBe(false);
  });

  it("factory carries the defaults and the verbatim spec", () => {
    const query = makeQueryObject("q-2", vec2(10, 20), {
      type: "orphans",
      target: "",
    });
    expect(query.kind).toBe("query");
    expect(query.width).toBe(QUERY_DEFAULT_WIDTH);
    expect(query.height).toBe(QUERY_DEFAULT_HEIGHT);
    expect(query.rotation).toBe(0);
    expect(query.visible).toBe(true);
    expect(query.locked).toBe(false);
    expect(query.queryType).toBe("orphans");
    expect(query.queryTarget).toBe("");
    const custom = makeQueryObject(
      "q-3",
      vec2(0, 0),
      { type: "tag", target: "مهم" },
      { width: 300, height: 220 },
      4,
    );
    expect(custom.width).toBe(300);
    expect(custom.height).toBe(220);
    expect(custom.zIndex).toBe(4);
  });

  it("participates in the generic bbox + translate machinery", () => {
    const query = makeQueryObject(
      "q-4",
      vec2(100, 50),
      { type: "tag", target: "مهم" },
    );
    const box = objectBBox(query);
    expect(box).toEqual({ minX: 100, minY: 50, maxX: 364, maxY: 218 });
    const moved = translateSceneObject(query, vec2(10, -5));
    expect(moved.position).toEqual({ x: 110, y: 45 });
    expect(objectBBox(moved).maxX).toBe(374);
  });
});
