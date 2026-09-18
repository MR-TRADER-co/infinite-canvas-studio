/**
 * Auto-layout frame tests (R13.4).
 */
import { describe, expect, it } from "vitest";
import {
  collectGroupMembers,
  computeReflowPlan,
  slotRequiresMove,
} from "@/core/knowledge/LayoutService";
import {
  makeFrameObject,
  type FrameLayout,
} from "@/core/model/FrameObject";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Builds a positioned child box for the fixtures. */
function box(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 50,
): SceneObjectData {
  return {
    kind: "shape",
    id,
    position: { x, y },
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    width,
    height,
  } as unknown as SceneObjectData;
}

/** A column-layout frame at the origin. */
function columnFrame(): ReturnType<typeof makeFrameObject> {
  const layout: FrameLayout = { dir: "column", gap: 12, padding: 12 };
  return { ...makeFrameObject("frame-1", 0), layout };
}

describe("computeReflowPlan (R13.4)", () => {
  it("stacks column slots ordered by current Y (a drag reorders)", () => {
    const frame = {
      ...columnFrame(),
      width: 300,
      height: 400,
      titleHeight: 28,
    };
    const children = [
      box("low", 40, 200, 100, 50),
      box("high", 40, 60, 100, 40),
    ];
    const plan = computeReflowPlan(frame, [frame, ...children]);
    expect(plan.slots.map((slot) => slot.id)).toEqual(["high", "low"]);
    // First slot starts inside the title bar + padding.
    expect(plan.slots[0]?.y).toBe(28 + 12);
    // Second slot sits gap below the first slot's bottom.
    expect(plan.slots[1]?.y).toBe(28 + 12 + 40 + 12);
    expect(plan.slots.every((slot) => slot.x === 12)).toBe(true);
  });

  it("packs a row left-to-right", () => {
    const frame = {
      ...makeFrameObject("frame-1", 0),
      layout: { dir: "row", gap: 8, padding: 8 } as FrameLayout,
      width: 600,
      height: 200,
      titleHeight: 24,
    };
    const children = [box("b", 300, 50, 120, 60), box("a", 30, 50, 100, 60)];
    const plan = computeReflowPlan(frame, [frame, ...children]);
    expect(plan.slots.map((slot) => slot.id)).toEqual(["a", "b"]);
    expect(plan.slots[0]?.x).toBe(8);
    expect(plan.slots[1]?.x).toBe(8 + 100 + 8);
    expect(plan.slots.every((slot) => slot.y === 24 + 8)).toBe(true);
  });

  it("grows the frame to wrap content but never shrinks", () => {
    const frame = {
      ...columnFrame(),
      width: 260,
      height: 90,
      titleHeight: 28,
    };
    const children = [box("a", 20, 40, 100, 200)];
    const plan = computeReflowPlan(frame, [frame, ...children]);
    expect(plan.frameHeight).toBe(28 + 12 + 200 + 12);
    expect(plan.frameWidth).toBeGreaterThanOrEqual(260);

    const roomy = { ...frame, height: 900 };
    const planRoomy = computeReflowPlan(roomy, [roomy, ...children]);
    expect(planRoomy.frameHeight).toBe(900);
  });

  it("excludes connectors, freehand strokes, nested-layout frames and group members", () => {
    const frame = columnFrame();
    const connector = {
      kind: "connector",
      id: "c1",
      position: { x: 10, y: 40 },
      width: 50,
      height: 50,
    } as unknown as SceneObjectData;
    const nested = {
      ...columnFrame(),
      id: "nested-1",
      position: { x: 10, y: 40 },
      width: 50,
      height: 50,
    };
    const member = box("member", 10, 40);
    const group = {
      kind: "group",
      id: "group-1",
      position: { x: 10, y: 40 },
      childIds: ["member"],
    } as unknown as SceneObjectData;
    const memberIds = collectGroupMembers([group]);
    const plan = computeReflowPlan(
      frame,
      [frame, connector, nested, member, box("ok", 12, 40)],
      memberIds,
    );
    expect(plan.slots.map((slot) => slot.id)).toEqual(["ok"]);
  });

  it("fills slot widths under itemWidth: fill for fixed-width text boxes", () => {
    const frame = {
      ...columnFrame(),
      layout: {
        dir: "column",
        gap: 12,
        padding: 12,
        itemWidth: "fill",
      } satisfies FrameLayout,
      width: 300,
      height: 400,
      titleHeight: 28,
    };
    const fixedText = {
      kind: "textBox",
      id: "fixed",
      position: { x: 12, y: 50 },
      width: 100,
      height: 40,
      sizeMode: "fixed",
    } as unknown as SceneObjectData;
    const autoText = {
      kind: "textBox",
      id: "auto",
      position: { x: 12, y: 120 },
      width: 100,
      height: 40,
      sizeMode: "auto",
    } as unknown as SceneObjectData;
    const plan = computeReflowPlan(frame, [frame, fixedText, autoText]);
    const fixedSlot = plan.slots.find((slot) => slot.id === "fixed");
    const autoSlot = plan.slots.find((slot) => slot.id === "auto");
    expect(fixedSlot?.width).toBe(300 - 24);
    expect(autoSlot?.width).toBe(100);
  });
});

describe("slotRequiresMove epsilon guard", () => {
  it("treats sub-epsilon deltas as already-placed (no reflow loop)", () => {
    expect(
      slotRequiresMove(
        { id: "a", x: 100, y: 50, width: 10, height: 10 },
        { x: 100.2, y: 50.1 },
      ),
    ).toBe(false);
    expect(
      slotRequiresMove(
        { id: "a", x: 100, y: 50, width: 10, height: 10 },
        { x: 101, y: 50 },
      ),
    ).toBe(true);
  });
});
