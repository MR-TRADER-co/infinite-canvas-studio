/**
 * Interaction-budget smoke test (AC2.6): with 200 objects on the canvas,
 * the per-event hot paths — hit-testing, marquee resolution and a move
 * frame — must stay under ~16 ms each (one 60 fps frame's budget).
 */
import { describe, expect, it } from "vitest";
import { Scene } from "@/core/model/Scene";
import { SHAPE_FILL_TOKEN, STROKE_COLOR_TOKEN } from "@/core/model/ShapeObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";
import { hitTestTopMost } from "@/interaction/objectHitTest";
import { MarqueeLogic } from "@/interaction/MarqueeLogic";
import { MoveCommand } from "@/core/commands/MoveCommand";
import { vec2 } from "@/core/geometry/Vec2";

/** Budget per interaction event, in milliseconds (AC2.6). */
const EVENT_BUDGET_MS = 16;

/** Builds a 200-object scene on a 20×10 grid of 80×60 rectangles. */
function makeScene200(): Scene {
  const scene = new Scene();
  for (let i = 0; i < 200; i += 1) {
    const x = (i % 20) * 100;
    const y = Math.floor(i / 20) * 100;
    const shape: ShapeObjectData = {
      id: `shape-${i}`,
      kind: "shape",
      name: undefined,
      parentId: undefined,
      position: vec2(x, y),
      rotation: 0,
      zIndex: i,
      visible: true,
      locked: false,
      shapeKind: "rectangle",
      width: 80,
      height: 60,
      fill: SHAPE_FILL_TOKEN,
      stroke: STROKE_COLOR_TOKEN,
      strokeWidth: 2,
    };
    scene.add(shape);
  }
  return scene;
}

describe("200-object interaction budget (AC2.6)", () => {
  it("hit-tests stay under ~16 ms per event", () => {
    const scene = makeScene200();
    const start = performance.now();
    for (let i = 0; i < 100; i += 1) {
      hitTestTopMost(scene, vec2((i * 21) % 2000, (i * 17) % 1000), 6);
    }
    const perEvent = (performance.now() - start) / 100;
    expect(perEvent).toBeLessThan(EVENT_BUDGET_MS);
  });

  it("marquee resolution stays under ~16 ms per event", () => {
    const scene = makeScene200();
    const marquee = new MarqueeLogic(scene);
    const start = performance.now();
    for (let i = 0; i < 50; i += 1) {
      marquee.begin(vec2(0, 0));
      marquee.update(vec2(200 + i * 10, 400 + i * 10));
      marquee.end();
    }
    const perEvent = (performance.now() - start) / 50;
    expect(perEvent).toBeLessThan(EVENT_BUDGET_MS);
  });

  it("move frames over the full selection stay under ~16 ms per event", () => {
    const scene = makeScene200();
    const ids = scene.objects.map((object) => object.id);
    const start = performance.now();
    for (let i = 0; i < 60; i += 1) {
      const command = new MoveCommand(scene, ids, vec2(1, 0));
      command.do();
    }
    const perEvent = (performance.now() - start) / 60;
    expect(perEvent).toBeLessThan(EVENT_BUDGET_MS);
    // The 60 px drag landed exactly (immutable replacements each frame).
    const probe = scene.findById("shape-0");
    expect(probe?.position).toEqual(vec2(60, 0));
  });
});
