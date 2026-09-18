/** Unit tests for the marquee multi-select state machine. */
import { describe, expect, it } from "vitest";
import { MarqueeLogic } from "@/interaction/MarqueeLogic";
import { bbox } from "@/core/geometry/BBox";
import { vec2 } from "@/core/geometry/Vec2";
import type { Vec2 } from "@/core/geometry/Vec2";
import { Scene } from "@/core/model/Scene";
import type { FreehandObjectData } from "@/core/model/FreehandObject";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import type { GroupObjectData } from "@/core/model/GroupObject";

/** Builds a freehand stroke fixture with the given stroke width. */
function makeStroke(
  id: string,
  points: readonly Vec2[],
  strokeWidth: number,
  locked = false,
): FreehandObjectData {
  const first = points[0];
  if (first === undefined) {
    throw new Error("stroke fixtures need at least one point");
  }
  return {
    id,
    kind: "freehand",
    position: first,
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked,
    points,
    strokeColor: "#0ea5e9",
    strokeWidth,
    strokeStyle: "solid",
  };
}

/** Builds a visible text-box fixture covering the given rectangle. */
function makeNote(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): TextBoxObjectData {
  return {
    id,
    kind: "textBox",
    position: vec2(x, y),
    rotation: 0,
    zIndex: 1,
    visible: true,
    locked: false,
    text: `text-${id}`,
    doc: null,
    sizeMode: "auto",
    fontSize: 20,
    color: "token://text",
    width,
    height,
  };
}

/**
 * Builds the marquee fixture scene: a near stroke (bbox 4,4–16,16), a hidden
 * note (20,20–60,60), a locked stroke (19,19–26,26), a far stroke
 * (99,99–121,111) and a near note (2,2–6,6), in that insertion order.
 */
function makeScene(): Scene {
  const scene = new Scene();
  scene.add(makeStroke("strokeA", [vec2(5, 5), vec2(15, 15)], 2));
  scene.add({ ...makeNote("noteHidden", 20, 20, 40, 40), visible: false });
  scene.add(makeStroke("strokeLocked", [vec2(20, 20), vec2(25, 25)], 2, true));
  scene.add(makeStroke("strokeFar", [vec2(100, 100), vec2(120, 110)], 2));
  scene.add(makeNote("noteNear", 2, 2, 4, 4));
  return scene;
}

describe("MarqueeLogic", () => {
  it("exposes no rectangle before a gesture begins", () => {
    const marquee = new MarqueeLogic(makeScene());
    expect(marquee.rect).toBeNull();
    expect(marquee.end()).toEqual([]);
  });

  it("ignores updates while inactive", () => {
    const marquee = new MarqueeLogic(makeScene());
    marquee.update(vec2(10, 10));
    expect(marquee.rect).toBeNull();
    expect(marquee.end()).toEqual([]);
  });

  it("anchors a degenerate rectangle at the start point", () => {
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(5, 7));
    expect(marquee.rect).toEqual(bbox(5, 7, 5, 7));
  });

  it("tracks the pointer while the start stays anchored", () => {
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(0, 0));
    marquee.update(vec2(20, 10));
    expect(marquee.rect).toEqual(bbox(0, 0, 20, 10));
    marquee.update(vec2(25, -5));
    expect(marquee.rect).toEqual(bbox(0, -5, 25, 0));
  });

  it("normalises the rectangle for up-left drags", () => {
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(30, 40));
    marquee.update(vec2(10, 20));
    expect(marquee.rect).toEqual(bbox(10, 20, 30, 40));
    marquee.begin(vec2(10, 50));
    marquee.update(vec2(30, -5));
    expect(marquee.rect).toEqual(bbox(10, -5, 30, 50));
  });

  it("left and right drags over the same area produce the same rect and ids", () => {
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(0, 0));
    marquee.update(vec2(30, 30));
    const rightRect = marquee.rect;
    const rightIds = marquee.end();
    marquee.begin(vec2(30, 30));
    marquee.update(vec2(0, 0));
    const leftRect = marquee.rect;
    const leftIds = marquee.end();
    expect(leftRect).toEqual(rightRect);
    expect(leftIds).toEqual(rightIds);
    expect(leftIds).toEqual(["strokeA", "noteNear"]);
  });

  it("end selects the visible unlocked objects intersecting the rectangle", () => {
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(0, 0));
    marquee.update(vec2(30, 30));
    expect(marquee.end()).toEqual(["strokeA", "noteNear"]);
  });

  it("end skips hidden objects even inside the rectangle", () => {
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(0, 0));
    marquee.update(vec2(60, 60));
    const ids = marquee.end();
    expect(ids).not.toContain("noteHidden");
    expect(ids).toContain("strokeA");
  });

  it("end skips locked objects even inside the rectangle", () => {
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(0, 0));
    marquee.update(vec2(30, 30));
    const ids = marquee.end();
    expect(ids).not.toContain("strokeLocked");
    expect(ids).toContain("strokeA");
  });

  it("end returns ids in scene insertion order", () => {
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(0, 0));
    marquee.update(vec2(30, 30));
    expect(marquee.end()).toEqual(["strokeA", "noteNear"]);
  });

  it("selects far objects only when dragged over them", () => {
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(90, 90));
    marquee.update(vec2(130, 130));
    expect(marquee.end()).toEqual(["strokeFar"]);
  });

  it("a rectangle touching an object's bbox edge does not select it (substantial rule)", () => {
    // The rect's bottom edge (y = 4) only grazes strokeA's top edge — a
    // zero-area intersection is NOT substantial (AC2.2).
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(8, 0));
    marquee.update(vec2(10, 4));
    expect(marquee.rect).toEqual(bbox(8, 0, 10, 4));
    expect(marquee.end()).toEqual([]);
  });

  it("a corner clip covering less than half the object is not substantial", () => {
    // Rect 5,5→8,8 covers a 3×3 corner of strokeA's 12×12 box (6%), the
    // centre (10,10) lies outside, and noteNear's centre (4,4) lies outside
    // too with a 25% clip — nothing selected (AC2.2).
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(5, 5));
    marquee.update(vec2(8, 8));
    expect(marquee.end()).toEqual([]);
  });

  it("an intersection covering at least half the object selects it", () => {
    // Rect 5,4→14,14 covers 9×10 of strokeA's 12×12 box (62%); noteNear's
    // 12% clip and out-of-rect centre keep it out.
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(5, 4));
    marquee.update(vec2(14, 14));
    expect(marquee.end()).toEqual(["strokeA"]);
  });

  it("a rectangle containing only the object centre selects it (thin-object escape)", () => {
    // A 1-wide rect through the centre: area is tiny but the centre rule
    // holds (connectors and thin strokes stay selectable).
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(10, 10));
    marquee.update(vec2(10, 11));
    expect(marquee.end()).toEqual(["strokeA"]);
  });

  it("resolves grouped members to the enclosing group id", () => {
    const scene = makeScene();
    const group: GroupObjectData = {
      id: "group1",
      kind: "group",
      position: vec2(2, 2),
      rotation: 0,
      zIndex: 5,
      visible: true,
      locked: false,
      childIds: ["strokeA", "noteNear"],
    };
    // Stamp the membership on the live entries (the GroupCommand contract).
    scene.add({
      ...makeStroke("strokeA", [vec2(5, 5), vec2(15, 15)], 2),
      parentId: "group1",
    });
    scene.add({ ...makeNote("noteNear", 2, 2, 4, 4), parentId: "group1" });
    scene.add({ ...makeNote("noteChild", 21, 21, 4, 4), parentId: "group1" });
    scene.add(group);
    const marquee = new MarqueeLogic(scene);
    // Covers noteNear (centre inside) — it resolves to group1.
    marquee.begin(vec2(0, 0));
    marquee.update(vec2(8, 8));
    expect(marquee.end()).toEqual(["group1"]);
    // The grouped child's own hit resolves to the group as well.
    marquee.begin(vec2(22, 22));
    marquee.update(vec2(24, 24));
    expect(marquee.end()).toEqual(["group1"]);
  });

  it("end without update selects objects under the start point", () => {
    // begin+end without a drag hit-tests the degenerate point rect.
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(10, 10));
    expect(marquee.end()).toEqual(["strokeA"]);
  });

  it("end returns [] when the rectangle hits nothing", () => {
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(500, 500));
    marquee.update(vec2(520, 520));
    expect(marquee.end()).toEqual([]);
  });

  it("end clears the gesture state", () => {
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(0, 0));
    marquee.update(vec2(30, 30));
    marquee.end();
    expect(marquee.rect).toBeNull();
    expect(marquee.end()).toEqual([]);
  });

  it("reset aborts an in-flight gesture without selecting", () => {
    const marquee = new MarqueeLogic(makeScene());
    marquee.begin(vec2(0, 0));
    marquee.update(vec2(30, 30));
    marquee.reset();
    expect(marquee.rect).toBeNull();
    expect(marquee.end()).toEqual([]);
  });
});
