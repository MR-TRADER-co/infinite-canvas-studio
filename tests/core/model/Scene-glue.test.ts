/** Unit tests for the Scene glue-follow pass over glued connectors. */
import { describe, expect, it, vi } from "vitest";
import { Scene } from "@/core/model/Scene";
import {
  connectorFromEndpoints,
  DEFAULT_CONNECTOR_STYLE,
  isConnectorObject,
} from "@/core/model/ConnectorObject";
import type { ConnectorObjectData } from "@/core/model/ConnectorObject";
import { STROKE_COLOR_TOKEN } from "@/core/model/FreehandObject";
import {
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN as SHAPE_STROKE_TOKEN,
} from "@/core/model/ShapeObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { Vec2 } from "@/core/geometry/Vec2";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";

/** Builds a shape fixture whose bounds equal the given box exactly (no padding). */
function makeShape(
  id: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): ShapeObjectData {
  return {
    id,
    kind: "shape",
    name: "Shape",
    position: vec2(minX, minY),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    shapeKind: "rectangle",
    width: maxX - minX,
    height: maxY - minY,
    fill: SHAPE_FILL_TOKEN,
    stroke: SHAPE_STROKE_TOKEN,
    strokeWidth: 0,
  };
}

/**
 * Builds a connector glued at both endpoints: start to `startTarget`'s E
 * anchor (100, 50) and end to `endTarget`'s W anchor (300, 50), with the
 * caches matching those positions.
 */
function makeGluedConnector(
  id: string,
  startTarget: string,
  endTarget: string,
): ConnectorObjectData {
  return connectorFromEndpoints(
    { objectId: startTarget, anchorIndex: 1, position: vec2(100, 50) },
    { objectId: endTarget, anchorIndex: 3, position: vec2(300, 50) },
    DEFAULT_CONNECTOR_STYLE,
    id,
    1,
  );
}

/**
 * Builds a corrupt connector fixture whose endpoint fields are missing
 * entirely (hand-edited data — the glue pass must not crash on it).
 */
function makeCorruptConnector(id: string, position: Vec2): ConnectorObjectData {
  const base: Omit<ConnectorObjectData, "start" | "end"> = {
    id,
    kind: "connector",
    position,
    rotation: 0,
    zIndex: 1,
    visible: true,
    locked: false,
    routingKind: "straight",
    strokeColor: STROKE_COLOR_TOKEN,
    strokeWidth: 2,
    strokeStyle: "solid",
    startArrow: "none",
    endArrow: "arrow",
  };
  return base as ConnectorObjectData;
}

/** Assembles the standard two-shape scene with a glued connector in between. */
function makeScene(): { scene: Scene; connector: ConnectorObjectData } {
  const scene = new Scene();
  scene.add(makeShape("shape-a", 0, 0, 100, 100));
  scene.add(makeShape("shape-b", 300, 0, 400, 100));
  const connector = makeGluedConnector("conn-1", "shape-a", "shape-b");
  scene.add(connector);
  return { scene, connector };
}

describe("Scene glue-follow (add / replace of the target)", () => {
  it("refreshes the connector when its target is replaced at a new position", () => {
    const { scene, connector } = makeScene();
    // Move shape A right by 50: its E anchor (index 1) moves (100,50)→(150,50).
    scene.add(makeShape("shape-a", 50, 0, 150, 100));
    const refreshed = scene.findById("conn-1");
    expect(refreshed).not.toBe(connector);
    expect(refreshed).toEqual({
      ...connector,
      start: { objectId: "shape-a", anchorIndex: 1, position: vec2(150, 50) },
      end: { objectId: "shape-b", anchorIndex: 3, position: vec2(300, 50) },
      position: vec2(225, 50),
    });
  });

  it("refreshes both glued endpoints when both targets move", () => {
    const { scene, connector } = makeScene();
    scene.add(makeShape("shape-a", 0, 40, 100, 140));
    scene.add(makeShape("shape-b", 300, 20, 400, 120));
    const refreshed = scene.findById("conn-1");
    expect(refreshed).toEqual({
      ...connector,
      start: { objectId: "shape-a", anchorIndex: 1, position: vec2(100, 90) },
      end: { objectId: "shape-b", anchorIndex: 3, position: vec2(300, 70) },
      position: vec2(200, 80),
    });
  });

  it("syncs a stale endpoint cache the moment the connector is added", () => {
    const scene = new Scene();
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    // Cache pretends the E anchor sits at (0, 0); the add itself must fix it.
    const connector = connectorFromEndpoints(
      { objectId: "shape-a", anchorIndex: 1, position: vec2(0, 0) },
      { objectId: null, anchorIndex: 0, position: vec2(300, 50) },
      DEFAULT_CONNECTOR_STYLE,
      "conn-1",
      1,
    );
    scene.add(connector);
    expect(scene.findById("conn-1")).toEqual({
      ...connector,
      start: { objectId: "shape-a", anchorIndex: 1, position: vec2(100, 50) },
      position: vec2(200, 50),
    });
  });

  it("keeps the paint-order slot of the refreshed connector", () => {
    const { scene } = makeScene();
    scene.add(makeShape("shape-a", 50, 0, 150, 100));
    expect(scene.objects.map((object) => object.id)).toEqual([
      "shape-a",
      "shape-b",
      "conn-1",
    ]);
  });

  it("reuses the same connector reference when nothing moved", () => {
    const { scene, connector } = makeScene();
    scene.add(makeShape("shape-b", 300, 0, 400, 100));
    expect(scene.findById("conn-1")).toBe(connector);
  });

  it("skips the refresh when the replacement target is invisible", () => {
    const { scene, connector } = makeScene();
    scene.add({ ...makeShape("shape-a", 50, 0, 150, 100), visible: false });
    expect(scene.findById("conn-1")).toBe(connector);
  });
});

describe("Scene glue-follow (remove of the target)", () => {
  it("keeps the cached endpoint positions as the fallback snapshot", () => {
    const { scene, connector } = makeScene();
    scene.remove("shape-a");
    expect(scene.findById("conn-1")).toBe(connector);
    expect(connector.start).toEqual({
      objectId: "shape-a",
      anchorIndex: 1,
      position: vec2(100, 50),
    });
  });

  it("re-glues when the target is re-added at a new position", () => {
    const { scene, connector } = makeScene();
    scene.remove("shape-a");
    expect(scene.findById("conn-1")).toBe(connector);
    // Restore-on-load scenario: the object comes back elsewhere.
    scene.add(makeShape("shape-a", 200, 0, 300, 100));
    const refreshed = scene.findById("conn-1");
    expect(refreshed).not.toBe(connector);
    if (refreshed === undefined || !isConnectorObject(refreshed)) {
      throw new Error("expected the refreshed connector");
    }
    expect(refreshed.start).toEqual({
      objectId: "shape-a",
      anchorIndex: 1,
      position: vec2(300, 50),
    });
  });
});

describe("Scene glue-follow (re-entrancy and notification)", () => {
  it("bumps the revision exactly once per mutation even when a connector follows", () => {
    const onChange = vi.fn();
    const scene = new Scene(undefined, undefined, onChange);
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    const connector = makeGluedConnector("conn-1", "shape-a", "shape-a");
    scene.add(connector);
    const revision = scene.revision;
    onChange.mockClear();
    // One mutation that moves the target AND refreshes the connector.
    scene.add(makeShape("shape-a", 50, 0, 150, 100));
    expect(scene.revision).toBe(revision + 1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("refreshes before notifying (the repaint sees the followed connector)", () => {
    let seen: SceneObjectData | undefined;
    const scene = new Scene(undefined, undefined, () => {
      seen = scene.findById("conn-1");
    });
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    scene.add(makeGluedConnector("conn-1", "shape-a", "shape-a"));
    scene.add(makeShape("shape-a", 50, 0, 150, 100));
    const notified = seen;
    if (notified === undefined || !isConnectorObject(notified)) {
      throw new Error("expected the refreshed connector");
    }
    expect(notified.start).toEqual({
      objectId: "shape-a",
      anchorIndex: 1,
      position: vec2(150, 50),
    });
  });

  it("does not loop when the notifier reads the scene state", () => {
    const onChange = vi.fn(() => {
      // Reading the refreshed connector inside the notifier must not re-enter.
      void scene.findById("conn-1");
    });
    const scene = new Scene(undefined, undefined, onChange);
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    scene.add(makeGluedConnector("conn-1", "shape-a", "shape-a"));
    onChange.mockClear();
    scene.add(makeShape("shape-a", 60, 0, 160, 100));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(scene.revision).toBeGreaterThan(0);
  });

  it("notifies exactly once across a full add-remove cycle with connectors", () => {
    const onChange = vi.fn();
    const scene = new Scene(undefined, undefined, onChange);
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    scene.add(makeGluedConnector("conn-1", "shape-a", "shape-a"));
    onChange.mockClear();
    scene.remove("shape-a");
    scene.remove("conn-1");
    scene.remove("shape-a");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe("Scene glue-follow (robustness)", () => {
  it("does not crash on a corrupt connector without endpoints", () => {
    const scene = new Scene();
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    const corrupt = makeCorruptConnector("conn-1", vec2(40, 60));
    expect(() => {
      scene.add(corrupt);
      scene.add(makeShape("shape-a", 50, 0, 150, 100));
      scene.remove("shape-a");
      scene.clear();
    }).not.toThrow();
    expect(scene.objectCount).toBe(0);
  });

  it("leaves a corrupt connector's data untouched by later mutations", () => {
    const scene = new Scene();
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    const corrupt = makeCorruptConnector("conn-1", vec2(40, 60));
    scene.add(corrupt);
    scene.add(makeShape("shape-a", 50, 0, 150, 100));
    expect(scene.findById("conn-1")).toBe(corrupt);
  });

  it("clears the scene with glued connectors present (reset/load path)", () => {
    const { scene } = makeScene();
    scene.clear();
    expect(scene.objectCount).toBe(0);
    // The scene stays usable afterwards.
    scene.add(makeShape("shape-c", 0, 0, 10, 10));
    scene.add(makeGluedConnector("conn-2", "shape-c", "shape-c"));
    const followed = scene.findById("conn-2");
    if (followed === undefined || !isConnectorObject(followed)) {
      throw new Error("expected the re-glued connector");
    }
    expect(followed.start.position).toEqual(vec2(10, 5));
  });

  it("skips the pass entirely for scenes without connectors (cheap path)", () => {
    const onChange = vi.fn();
    const scene = new Scene(undefined, undefined, onChange);
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    scene.add(makeShape("shape-a", 5, 0, 105, 100));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(scene.objectCount).toBe(1);
  });
});
