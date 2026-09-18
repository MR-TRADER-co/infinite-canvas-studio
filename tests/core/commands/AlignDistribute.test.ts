/**
 * Alignment & distribution tests (R7.3/AC7.3): Figma-style selection-
 * relative planning, equal-gap distribution and the one-undo composite
 * commit through the live scene/history/selection.
 */
import { describe, expect, it } from "vitest";
import {
  planAlignment,
  planDistribution,
  alignSelection,
  distributeSelection,
  selectionBounds,
} from "@/core/commands/AlignDistribute";
import { HistoryManager } from "@/core/history/HistoryManager";
import { Scene } from "@/core/model/Scene";
import { Selection } from "@/core/selection/Selection";
import { objectBBox } from "@/core/model/SceneObject";
import { makeShape } from "./fixtures";

/** Four messy boxes (the AC7.3 4-object arrangement). */
function messyFour(): ReturnType<typeof makeShape>[] {
  return [
    makeShape("a", 0, 0, 100, 60),
    makeShape("b", 150, 30, 80, 40),
    makeShape("c", 300, 10, 120, 80),
    makeShape("d", 60, 200, 90, 50),
  ];
}

describe("planAlignment (R7.3)", () => {
  it("aligns every object's left edge onto the selection bbox minimum", () => {
    const objects = messyFour();
    const steps = planAlignment(objects, "left");
    const minX = selectionBounds(objects)?.minX ?? 0;
    steps.forEach((step, index) => {
      const object = objects[index];
      if (object === undefined) {
        return;
      }
      const box = objectBBox(object);
      expect(box.minX + step.delta.x).toBeCloseTo(minX, 6);
      expect(step.delta.y).toBe(0);
    });
  });

  it("aligns centers and right/bottom edges to the selection frame", () => {
    const objects = messyFour();
    const bounds = selectionBounds(objects);
    expect(bounds).not.toBeNull();
    const centreSteps = planAlignment(objects, "centerHorizontal");
    centreSteps.forEach((step, index) => {
      const object = objects[index];
      if (object === undefined) {
        return;
      }
      const box = objectBBox(object);
      expect((box.minX + box.maxX) / 2 + step.delta.x).toBeCloseTo(
        (bounds!.minX + bounds!.maxX) / 2,
        6,
      );
    });
    const bottomSteps = planAlignment(objects, "bottom");
    bottomSteps.forEach((step, index) => {
      const object = objects[index];
      if (object === undefined) {
        return;
      }
      const box = objectBBox(object);
      expect(box.maxY + step.delta.y).toBeCloseTo(bounds!.maxY, 6);
    });
  });

  it("is idempotent for an already-aligned set", () => {
    const objects = [
      makeShape("x", 0, 0, 50, 50),
      makeShape("y", 0, 100, 50, 50),
    ];
    const steps = planAlignment(objects, "left");
    expect(steps.every((step) => step.delta.x === 0)).toBe(true);
  });
});

describe("planDistribution (R7.3)", () => {
  it("equalises the gaps (span preserved, sorted order kept)", () => {
    const objects = [
      makeShape("a", 0, 0, 100, 50),
      makeShape("b", 150, 0, 100, 50),
      makeShape("c", 400, 0, 100, 50),
    ];
    const steps = planDistribution(objects, "horizontal");
    const gaps: number[] = [];
    let previousMax = objectBBox(
      objects[0] as ReturnType<typeof makeShape>,
    ).maxX;
    objects.forEach((object, index) => {
      const step = steps.find((candidate) => candidate.id === object.id);
      expect(step).toBeDefined();
      const box = objectBBox(object);
      const movedMin = box.minX + (step?.delta.x ?? 0);
      const movedMax = box.maxX + (step?.delta.x ?? 0);
      if (index > 0) {
        gaps.push(movedMin - previousMax);
      }
      previousMax = movedMax;
    });
    expect(gaps[0]).toBeCloseTo(gaps[1] as number, 6);
    // Span preserved (padded bounds: last maxX 501).
    expect(previousMax).toBeCloseTo(
      objectBBox(objects[2] as ReturnType<typeof makeShape>).maxX,
      6,
    );
  });

  it("requires at least two objects", () => {
    expect(
      planDistribution([makeShape("solo", 0, 0, 10, 10)], "vertical"),
    ).toHaveLength(0);
  });
});

describe("alignSelection / distributeSelection (one undo step)", () => {
  it("aligns the live selection and records exactly ONE history entry", () => {
    const scene = new Scene();
    const history = new HistoryManager(50);
    const selection = new Selection();
    for (const object of messyFour()) {
      scene.add(object);
    }
    selection.replaceAll(["a", "b", "c", "d"]);
    const moved = alignSelection(scene, history, selection, "left");
    expect(moved).toBe(true);
    expect(history.canUndo()).toBe(true);
    // Exactly one entry: undoing once restores every original x.
    history.undo();
    for (const object of messyFour()) {
      const live = scene.findById(object.id);
      expect(live).toBeDefined();
      expect(objectBBox(live!).minX).toBeCloseTo(objectBBox(object).minX, 6);
    }
  });

  it("skips locked objects (the locked contract)", () => {
    const scene = new Scene();
    const history = new HistoryManager(50);
    const selection = new Selection();
    const a = makeShape("a", 200, 0, 50, 50);
    const b = { ...makeShape("b", 0, 0, 50, 50), locked: true };
    scene.add(a);
    scene.add(b);
    selection.replaceAll(["a", "b"]);
    const moved = alignSelection(scene, history, selection, "left");
    expect(moved).toBe(true);
    // The locked object never moved; the unlocked one aligned onto the
    // selection frame's left edge (the locked object's edge).
    const liveA = scene.findById("a");
    const liveB = scene.findById("b");
    expect(objectBBox(liveB as ReturnType<typeof makeShape>).minX).toBeCloseTo(
      -1,
      6,
    );
    expect(objectBBox(liveA as ReturnType<typeof makeShape>).minX).toBeCloseTo(
      -1,
      6,
    );
  });

  it("distributes three objects in one undo step", () => {
    const scene = new Scene();
    const history = new HistoryManager(50);
    const selection = new Selection();
    const objects = [
      makeShape("a", 0, 0, 100, 50),
      makeShape("b", 150, 0, 100, 50),
      makeShape("c", 400, 0, 100, 50),
    ];
    for (const object of objects) {
      scene.add(object);
    }
    selection.replaceAll(["a", "b", "c"]);
    expect(distributeSelection(scene, history, selection, "horizontal")).toBe(
      true,
    );
    history.undo();
    const restoredB = scene.findById("b");
    expect(restoredB?.position.x).toBeCloseTo(150, 6);
  });
});
