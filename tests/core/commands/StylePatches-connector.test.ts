/** Unit tests for the connector branch of the inspector style-patch planner. */
import { describe, expect, it } from "vitest";
import { planStylePatch } from "@/core/commands/StylePatches";
import { connectorFromEndpoints } from "@/core/model/ConnectorObject";
import type { ConnectorObjectData } from "@/core/model/ConnectorObject";
import { STROKE_COLOR_TOKEN } from "@/core/model/FreehandObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { ConnectorEndpoint } from "@/core/model/ConnectorObject";
import type { FreehandObjectData } from "@/core/model/FreehandObject";

/** Builds a floating endpoint fixture at a fixed position. */
function endpoint(x: number, y: number): ConnectorEndpoint {
  return { objectId: null, anchorIndex: 0, position: vec2(x, y) };
}

/** Builds a fully populated connector fixture (all base + kind fields). */
function makeConnector(
  overrides: Partial<
    Pick<
      ConnectorObjectData,
      | "routingKind"
      | "strokeColor"
      | "strokeWidth"
      | "strokeStyle"
      | "startArrow"
      | "endArrow"
    >
  > = {},
): ConnectorObjectData {
  return {
    ...connectorFromEndpoints(
      endpoint(0, 0),
      endpoint(100, 0),
      {
        color: STROKE_COLOR_TOKEN,
        width: 2,
        dash: "solid",
        routing: "straight",
        startArrow: "none",
        endArrow: "arrow",
      },
      "conn-1",
      3,
    ),
    ...overrides,
  };
}

/** Builds a fully populated freehand stroke fixture (for strokeStyle tests). */
function makeStroke(
  overrides: Partial<
    Pick<FreehandObjectData, "strokeColor" | "strokeWidth" | "strokeStyle">
  > = {},
): FreehandObjectData {
  return {
    id: "stroke-1",
    kind: "freehand",
    name: "Stroke",
    position: vec2(10, 20),
    rotation: 0,
    zIndex: 3,
    visible: true,
    locked: false,
    points: [vec2(10, 20), vec2(15, 25), vec2(20, 30)],
    strokeColor: "#0ea5e9",
    strokeWidth: 2,
    strokeStyle: "solid",
    ...overrides,
  };
}

describe("planStylePatch (connector)", () => {
  it("plans a strokeColor-only patch for a stroke colour change", () => {
    expect(planStylePatch(makeConnector(), { strokeColor: "#eab308" })).toEqual(
      {
        strokeColor: "#eab308",
      },
    );
  });

  it("clamps and lands a stroke-width change (7.6 → 8)", () => {
    expect(planStylePatch(makeConnector(), { strokeWidth: 7.6 })).toEqual({
      strokeWidth: 8,
    });
  });

  it("clamps an out-of-range stroke width inside the planner (60 → 48)", () => {
    expect(planStylePatch(makeConnector(), { strokeWidth: 60 })).toEqual({
      strokeWidth: 48,
    });
  });

  it("clamps a sub-minimum stroke width up to 1", () => {
    expect(planStylePatch(makeConnector(), { strokeWidth: 0.2 })).toEqual({
      strokeWidth: 1,
    });
  });

  it("plans a strokeStyle-only patch for a dash pattern change", () => {
    expect(planStylePatch(makeConnector(), { strokeStyle: "dashed" })).toEqual({
      strokeStyle: "dashed",
    });
  });

  it("plans a routingKind-only patch for a routing change", () => {
    expect(
      planStylePatch(makeConnector(), { routingKind: "orthogonal" }),
    ).toEqual({
      routingKind: "orthogonal",
    });
  });

  it("plans a startArrow-only patch for a start arrowhead change", () => {
    expect(planStylePatch(makeConnector(), { startArrow: "arrow" })).toEqual({
      startArrow: "arrow",
    });
  });

  it("plans an endArrow-only patch for an end arrowhead change", () => {
    expect(planStylePatch(makeConnector(), { endArrow: "none" })).toEqual({
      endArrow: "none",
    });
  });

  it("combines every connector field into one patch", () => {
    expect(
      planStylePatch(makeConnector(), {
        strokeColor: "#eab308",
        strokeWidth: 60,
        strokeStyle: "dotted",
        routingKind: "curved",
        startArrow: "arrow",
        endArrow: "none",
      }),
    ).toEqual({
      strokeColor: "#eab308",
      strokeWidth: 48,
      strokeStyle: "dotted",
      routingKind: "curved",
      startArrow: "arrow",
      endArrow: "none",
    });
  });

  it("returns null when every requested field already matches (no-op)", () => {
    const connector = makeConnector();
    expect(
      planStylePatch(connector, { strokeColor: STROKE_COLOR_TOKEN }),
    ).toBeNull();
    expect(planStylePatch(connector, { strokeStyle: "solid" })).toBeNull();
    expect(planStylePatch(connector, { routingKind: "straight" })).toBeNull();
    expect(planStylePatch(connector, { startArrow: "none" })).toBeNull();
    expect(planStylePatch(connector, { endArrow: "arrow" })).toBeNull();
  });

  it("returns null when the clamped stroke width equals the current value", () => {
    expect(planStylePatch(makeConnector(), { strokeWidth: 2 })).toBeNull();
    // Clamping can make a differing request a no-op: 200 clamps to 48.
    expect(
      planStylePatch(makeConnector({ strokeWidth: 48 }), { strokeWidth: 200 }),
    ).toBeNull();
  });

  it("keeps only the fields that actually differ in a mixed change", () => {
    const patch = planStylePatch(makeConnector(), {
      strokeColor: STROKE_COLOR_TOKEN,
      strokeWidth: 4,
      routingKind: "straight",
    });
    expect(patch).toEqual({ strokeWidth: 4 });
  });

  it("drops the incompatible style fields of other kinds", () => {
    const connector = makeConnector();
    expect(planStylePatch(connector, { fill: "#22c55e" })).toBeNull();
    expect(planStylePatch(connector, { stroke: "#f97316" })).toBeNull();
    expect(planStylePatch(connector, { fontSize: 32 })).toBeNull();
    expect(planStylePatch(connector, { color: "#38bdf8" })).toBeNull();
    expect(
      planStylePatch(connector, { noteColor: "oklch(0.90 0.14 98)" }),
    ).toBeNull();
  });

  it("returns null for empty changes", () => {
    expect(planStylePatch(makeConnector(), {})).toBeNull();
  });
});

describe("planStylePatch (freehand strokeStyle)", () => {
  it("plans a strokeStyle patch for a dash pattern change", () => {
    expect(planStylePatch(makeStroke(), { strokeStyle: "dashed" })).toEqual({
      strokeStyle: "dashed",
    });
    expect(planStylePatch(makeStroke(), { strokeStyle: "dotted" })).toEqual({
      strokeStyle: "dotted",
    });
  });

  it("returns null when the requested pattern equals the current one", () => {
    expect(planStylePatch(makeStroke(), { strokeStyle: "solid" })).toBeNull();
    expect(
      planStylePatch(makeStroke({ strokeStyle: "dashed" }), {
        strokeStyle: "dashed",
      }),
    ).toBeNull();
  });

  it("combines the dash pattern with the other freehand fields", () => {
    expect(
      planStylePatch(makeStroke(), {
        strokeColor: "#eab308",
        strokeWidth: 60,
        strokeStyle: "dotted",
      }),
    ).toEqual({
      strokeColor: "#eab308",
      strokeWidth: 48,
      strokeStyle: "dotted",
    });
  });

  it("keeps only the differing dash field in a mixed change", () => {
    const patch = planStylePatch(makeStroke(), {
      strokeColor: "#0ea5e9",
      strokeWidth: 2,
      strokeStyle: "dashed",
    });
    expect(patch).toEqual({ strokeStyle: "dashed" });
  });
});
