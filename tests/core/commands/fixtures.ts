/** Shared object fixtures for the core-command tests. */
import { vec2 } from "@/core/geometry/Vec2";
import {
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN,
  type ShapeObjectData,
} from "@/core/model/ShapeObject";
import type { FreehandObjectData } from "@/core/model/FreehandObject";

/** Builds a fully populated shape fixture (all base + kind fields). */
export function makeShape(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): ShapeObjectData {
  return {
    id,
    kind: "shape",
    name: "Shape",
    parentId: "group-1",
    position: vec2(x, y),
    rotation: 0,
    zIndex: 3,
    visible: true,
    locked: false,
    shapeKind: "rectangle",
    width,
    height,
    fill: SHAPE_FILL_TOKEN,
    stroke: STROKE_COLOR_TOKEN,
    strokeWidth: 2,
  };
}

/** Builds a fully populated freehand stroke fixture. */
export function makeStroke(id: string): FreehandObjectData {
  return {
    id,
    kind: "freehand",
    name: "Stroke",
    parentId: "group-1",
    position: vec2(10, 20),
    rotation: 0,
    zIndex: 3,
    visible: true,
    locked: false,
    points: [vec2(10, 20), vec2(15, 25), vec2(20, 30)],
    strokeColor: "#0ea5e9",
    strokeWidth: 2,
    strokeStyle: "solid",
  };
}
