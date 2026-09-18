/** Unit tests for the freehand stroke object contract. */
import { describe, expect, it } from "vitest";
import { isFreehandObject } from "@/core/model/FreehandObject";
import { vec2 } from "@/core/geometry/Vec2";
import type {
  FreehandObjectData,
  StrokeStyleKind,
} from "@/core/model/FreehandObject";
import type {
  SceneObjectData,
  SceneObjectKind,
} from "@/core/model/SceneObject";

/** Builds a fully populated freehand stroke fixture. */
function makeStroke(
  id: string,
  style: StrokeStyleKind = "solid",
): FreehandObjectData {
  return {
    id,
    kind: "freehand",
    position: vec2(10, 20),
    rotation: 0,
    zIndex: 3,
    visible: true,
    locked: false,
    points: [vec2(10, 20), vec2(15, 25), vec2(20, 30)],
    strokeColor: "#0ea5e9",
    strokeWidth: 2,
    strokeStyle: style,
  };
}

/** Builds a minimal fixture of a non-freehand kind. */
function makeObjectOfKind(kind: SceneObjectKind): SceneObjectData {
  return {
    id: `obj-${kind}`,
    kind,
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
  };
}

describe("FreehandObject", () => {
  it("recognises freehand stroke objects", () => {
    expect(isFreehandObject(makeStroke("stroke-1"))).toBe(true);
  });

  it("rejects every other object kind", () => {
    const otherKinds: SceneObjectKind[] = [
      "shape",
      "textBox",
      "stickyNote",
      "image",
      "connector",
      "group",
    ];
    for (const kind of otherKinds) {
      expect(isFreehandObject(makeObjectOfKind(kind))).toBe(false);
    }
  });

  it("stores the stroke points in world coordinates in drawing order", () => {
    const stroke = makeStroke("stroke-1");
    expect(stroke.points).toHaveLength(3);
    expect(stroke.points[0]).toEqual(vec2(10, 20));
    expect(stroke.points[1]).toEqual(vec2(15, 25));
    expect(stroke.points[2]).toEqual(vec2(20, 30));
  });

  it("mirrors the first captured point in position", () => {
    const stroke = makeStroke("stroke-1");
    expect(stroke.position).toEqual(stroke.points[0]);
  });

  it("carries the stroke styling fields", () => {
    const stroke = makeStroke("stroke-1");
    expect(stroke.strokeColor).toBe("#0ea5e9");
    expect(stroke.strokeWidth).toBe(2);
    expect(stroke.strokeStyle).toBe("solid");
    expect(makeStroke("stroke-2", "dashed").strokeStyle).toBe("dashed");
  });

  it("the guard narrows a mixed object list to its freehand entries", () => {
    const objects: SceneObjectData[] = [
      makeObjectOfKind("shape"),
      makeStroke("stroke-1"),
      makeObjectOfKind("group"),
    ];
    const strokes = objects.filter(isFreehandObject);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.id).toBe("stroke-1");
    expect(strokes[0]?.points).toHaveLength(3);
  });
});
