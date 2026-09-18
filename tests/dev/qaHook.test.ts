/** The dev-only QA introspection hook (فاز ۳۳) — read-only surface. */
import { describe, expect, it } from "vitest";
import { attachQaHook, type QaHook } from "@/dev/qaHook";
import { Scene } from "@/core/model/Scene";
import { Selection } from "@/core/selection/Selection";
import { makeStickerObject } from "@/core/model/StickerObject";
import { vec2 } from "@/core/geometry/Vec2";

describe("window.__qa hook (فاز ۳۳)", () => {
  it("attaches a read-only surface reflecting the live scene state", () => {
    const holder: { __qa?: QaHook } = {};
    const scene = new Scene();
    const selection = new Selection();
    scene.add(makeStickerObject("st-1", "🔥", vec2(100, 120), 160));
    selection.replaceAll(["st-1"]);

    attachQaHook({
      scene,
      selection,
      phase: () => "فاز ۳۴",
      version: () => "نسخهٔ ۱٫۴۱٫۰",
      holder,
    });

    const qa = holder.__qa;
    expect(qa).toBeDefined();
    expect(qa?.version()).toEqual({
      phase: "فاز ۳۴",
      version: "نسخهٔ ۱٫۴۱٫۰",
    });
    expect(qa?.sceneSummary()).toMatchObject({
      objectCount: 1,
      selectionSize: 1,
    });
    const objects = qa?.objects();
    expect(objects).toHaveLength(1);
    expect(objects?.[0]).toMatchObject({
      id: "st-1",
      kind: "sticker",
      x: 100,
      y: 120,
      width: 160,
      height: 160,
      pinned: false,
    });
    expect(qa?.selection()).toEqual(["st-1"]);
    expect(qa?.camera().zoom).toBe(1);
  });

  it("is idempotent — a second attach never shadows the first", () => {
    const holder: { __qa?: QaHook } = {};
    const scene = new Scene();
    attachQaHook({
      scene,
      selection: new Selection(),
      phase: () => "first",
      version: () => "one",
      holder,
    });
    attachQaHook({
      scene,
      selection: new Selection(),
      phase: () => "second",
      version: () => "two",
      holder,
    });
    expect(holder.__qa?.version().phase).toBe("first");
  });
});
