/** Sticker-library insertion engine (R12.1 + فاز ۳۲ pinned insert). */
import { describe, expect, it } from "vitest";
import { Scene } from "@/core/model/Scene";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { vec2 } from "@/core/geometry/Vec2";
import {
  clampStickerSize,
  insertStickerObject,
  pinnedStickerAnchor,
  STICKER_MAX_SIZE,
  STICKER_MIN_SIZE,
  STICKER_SIZE_PRESETS,
} from "@/interaction/StickerInsert";
import { objectBBox } from "@/core/model/SceneObject";
import { pinAnchorToScreen } from "@/core/model/Pinned";

describe("insertStickerObject (R12.1)", () => {
  it("places the sticker centred on the target point (one undo step)", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const created = insertStickerObject(
      scene,
      history,
      new IdGenerator("obj"),
      "🚀",
      vec2(500, 400),
    );
    expect(created).not.toBeNull();
    expect(created?.emoji).toBe("🚀");
    expect(created?.kind).toBe("sticker");
    const box = objectBBox(created as never);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(500);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(400);
    expect(scene.objectCount).toBe(1);
    // One undo step removes it.
    history.undo();
    expect(scene.objectCount).toBe(0);
    // Redo re-adds the same object.
    history.redo();
    expect(scene.objectCount).toBe(1);
    expect(scene.findById(created?.id ?? "")).toBeDefined();
  });

  it("uses the default square footprint", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const created = insertStickerObject(
      scene,
      history,
      new IdGenerator("obj"),
      "⭐",
      vec2(0, 0),
    );
    expect(created?.width).toBe(96);
    expect(created?.height).toBe(96);
  });

  it("allocates unique ids through the generator", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const ids = new IdGenerator("obj");
    const first = insertStickerObject(scene, history, ids, "⭐", vec2(0, 0));
    const second = insertStickerObject(scene, history, ids, "🔥", vec2(0, 0));
    expect(first?.id).not.toBe(second?.id);
    expect(scene.objectCount).toBe(2);
  });

  it("refuses unusable emoji values without touching the scene", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    expect(
      insertStickerObject(scene, history, new IdGenerator("obj"), "", vec2(0, 0)),
    ).toBeNull();
    expect(
      insertStickerObject(
        scene,
        history,
        new IdGenerator("obj"),
        "x".repeat(13),
        vec2(0, 0),
      ),
    ).toBeNull();
    expect(scene.objectCount).toBe(0);
    expect(history.canUndo()).toBe(false);
  });
});

describe("insertStickerObject — pinned insert (فاز ۳۲)", () => {
  it("pinnedStickerAnchor centres the footprint on the screen point", () => {
    // Point (320, 240) on a 1280×537 viewport → the top-left anchor sits
    // half a 96px footprint up-left of the point.
    const anchor = pinnedStickerAnchor(vec2(320, 240), {
      width: 1280,
      height: 537,
    });
    expect(anchor.x).toBeCloseTo((320 - 48) / 1280);
    expect(anchor.y).toBeCloseTo((240 - 48) / 537);
    // Round-trip: the anchor's screen origin + half the footprint
    // recovers the release point exactly.
    const origin = pinAnchorToScreen(anchor, { width: 1280, height: 537 });
    expect(origin.x + 48).toBeCloseTo(320);
    expect(origin.y + 48).toBeCloseTo(240);
  });

  it("clamps anchors released near the top-left corner", () => {
    const anchor = pinnedStickerAnchor(vec2(4, 4), {
      width: 1280,
      height: 537,
    });
    expect(anchor.x).toBe(0);
    expect(anchor.y).toBe(0);
  });

  it("inserts pinned with the anchor, one undo step", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const created = insertStickerObject(
      scene,
      history,
      new IdGenerator("obj"),
      "📌",
      vec2(900, 700),
      {
        pinnedAt: {
          point: vec2(640, 300),
          viewport: { width: 1280, height: 537 },
        },
      },
    );
    expect(created).not.toBeNull();
    expect(created?.pinned).toBe(true);
    expect(created?.pinAnchor?.x).toBeCloseTo((640 - 48) / 1280);
    expect(created?.pinAnchor?.y).toBeCloseTo((300 - 48) / 537);
    // The world snapshot still centres on the passed point (rendering
    // ignores it while pinned; unpin recomputes from the anchor).
    const box = objectBBox(created as never);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(900);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(700);
    expect(scene.objectCount).toBe(1);
    history.undo();
    expect(scene.objectCount).toBe(0);
    history.redo();
    const restored = scene.findById(created?.id ?? "");
    expect(restored?.pinned).toBe(true);
    expect(restored?.pinAnchor?.x).toBeCloseTo((640 - 48) / 1280);
  });

  it("keeps the click path unpinned when no options are passed", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const created = insertStickerObject(
      scene,
      history,
      new IdGenerator("obj"),
      "⭐",
      vec2(0, 0),
    );
    expect(created?.pinned).toBeUndefined();
    expect(created?.pinAnchor).toBeUndefined();
  });

  it("falls back to a clamped anchor on a degenerate viewport", () => {
    const anchor = pinnedStickerAnchor(vec2(500, 500), {
      width: 0,
      height: 0,
    });
    expect(anchor.x).toBe(0);
    expect(anchor.y).toBe(0);
  });
});

describe("insertStickerObject — quick sizes (فاز ۳۳)", () => {
  it("honours a requested preset footprint exactly, centred on the point", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const created = insertStickerObject(
      scene,
      history,
      new IdGenerator("obj"),
      "🔥",
      vec2(300, 400),
      { size: 160 },
    );
    expect(created).not.toBeNull();
    expect(created?.width).toBe(160);
    expect(created?.height).toBe(160);
    const box = objectBBox(created as never);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(300);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(400);
  });

  it("every preset round-trips through the engine with its own footprint", () => {
    for (const preset of STICKER_SIZE_PRESETS) {
      const scene = new Scene();
      const history = new HistoryManager(20);
      const created = insertStickerObject(
        scene,
        history,
        new IdGenerator("obj"),
        "⭐",
        vec2(50, 60),
        { size: preset },
      );
      expect(created?.width).toBe(preset);
      expect(created?.height).toBe(preset);
    }
  });

  it("clampStickerSize clamps into the legal range and rescues bad values", () => {
    expect(clampStickerSize(48)).toBe(48);
    expect(clampStickerSize(96)).toBe(96);
    expect(clampStickerSize(160)).toBe(160);
    expect(clampStickerSize(8)).toBe(STICKER_MIN_SIZE);
    expect(clampStickerSize(9999)).toBe(STICKER_MAX_SIZE);
    expect(clampStickerSize(undefined)).toBe(96);
    expect(clampStickerSize(Number.NaN)).toBe(96);
    expect(clampStickerSize(-4)).toBe(96);
    expect(clampStickerSize(Number.POSITIVE_INFINITY)).toBe(96);
  });

  it("an out-of-range size clamps instead of refusing the insert", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const created = insertStickerObject(
      scene,
      history,
      new IdGenerator("obj"),
      "😀",
      vec2(0, 0),
      { size: 5000 },
    );
    expect(created?.width).toBe(STICKER_MAX_SIZE);
    expect(scene.objectCount).toBe(1);
  });

  it("the pinned path centres the CHOSEN footprint on the release point", () => {
    const anchor = pinnedStickerAnchor(
      vec2(300, 400),
      { width: 1280, height: 537 },
      160,
    );
    const centre = pinAnchorToScreen(anchor, { width: 1280, height: 537 });
    expect(centre.x + 80).toBeCloseTo(300, 5);
    expect(centre.y + 80).toBeCloseTo(400, 5);
  });

  it("a pinned quick-size insert lands centred with one undo step", () => {
    const scene = new Scene();
    const history = new HistoryManager(20);
    const created = insertStickerObject(
      scene,
      history,
      new IdGenerator("obj"),
      "🔥",
      vec2(600, 268),
      {
        size: 48,
        pinnedAt: { point: vec2(300, 200), viewport: { width: 1280, height: 537 } },
      },
    );
    expect(created).not.toBeNull();
    expect(created?.pinned).toBe(true);
    expect(created?.width).toBe(48);
    const centre = pinAnchorToScreen(created?.pinAnchor ?? { x: 0, y: 0 }, {
      width: 1280,
      height: 537,
    });
    expect(centre.x + 24).toBeCloseTo(300, 5);
    expect(centre.y + 24).toBeCloseTo(200, 5);
    history.undo();
    expect(scene.objectCount).toBe(0);
  });
});
