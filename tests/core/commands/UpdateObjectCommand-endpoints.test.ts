/** Unit tests for connector endpoint replacement through UpdateObjectCommand. */
import { describe, expect, it } from "vitest";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import type { ObjectPatch } from "@/core/commands/UpdateObjectCommand";
import { HistoryManager } from "@/core/history/HistoryManager";
import { Scene } from "@/core/model/Scene";
import {
  connectorFromEndpoints,
  isConnectorObject,
} from "@/core/model/ConnectorObject";
import type { ConnectorObjectData } from "@/core/model/ConnectorObject";
import { DEFAULT_CONNECTOR_STYLE } from "@/core/model/ConnectorObject";
import { SHAPE_FILL_TOKEN, STROKE_COLOR_TOKEN } from "@/core/model/ShapeObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { ConnectorEndpoint } from "@/core/model/ConnectorObject";
import type { ShapeObjectData } from "@/core/model/ShapeObject";

/** Builds a floating endpoint fixture at a fixed position. */
function floating(x: number, y: number): ConnectorEndpoint {
  return { objectId: null, anchorIndex: 0, position: vec2(x, y) };
}

/** Builds a glue target whose bounds equal the given box exactly (no padding). */
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
    stroke: STROKE_COLOR_TOKEN,
    strokeWidth: 0,
  };
}

/** Builds a connector fixture with two floating endpoints. */
function makeConnector(): ConnectorObjectData {
  return connectorFromEndpoints(
    floating(0, 0),
    floating(200, 0),
    DEFAULT_CONNECTOR_STYLE,
    "conn-1",
    1,
  );
}

/** Returns the scene's connector, failing loudly when it is missing. */
function getConnector(scene: Scene): ConnectorObjectData {
  const object = scene.findById("conn-1");
  if (object === undefined || !isConnectorObject(object)) {
    throw new Error("expected the connector");
  }
  return object;
}

describe("UpdateObjectCommand (connector endpoints)", () => {
  it("do merges a start endpoint replacement into the current connector", () => {
    const scene = new Scene();
    const before = makeConnector();
    scene.add(before);
    const replacement = floating(40, 30);
    new UpdateObjectCommand(
      scene,
      "conn-1",
      { start: replacement },
      before,
    ).do();
    const patched = getConnector(scene);
    expect(patched.start).toBe(replacement);
    // Everything the patch does not mention is untouched.
    expect(patched.end).toEqual(before.end);
    expect(patched.endArrow).toBe(before.endArrow);
    expect(patched.routingKind).toBe(before.routingKind);
    expect(scene.objectCount).toBe(1);
  });

  it("do merges an end endpoint replacement into the current connector", () => {
    const scene = new Scene();
    const before = makeConnector();
    scene.add(before);
    const replacement = floating(300, 120);
    new UpdateObjectCommand(scene, "conn-1", { end: replacement }, before).do();
    expect(getConnector(scene).end).toBe(replacement);
    expect(getConnector(scene).start).toEqual(before.start);
  });

  it("do applies the patch on top of live data, not the captured snapshot", () => {
    const scene = new Scene();
    const before = makeConnector();
    scene.add(before);
    // A live mutation replaced the object after the snapshot was captured.
    const live: ConnectorObjectData = { ...before, strokeColor: "#38bdf8" };
    scene.add(live);
    new UpdateObjectCommand(
      scene,
      "conn-1",
      { start: floating(10, 10) },
      before,
    ).do();
    const patched = getConnector(scene);
    expect(patched.start).toEqual(floating(10, 10));
    expect(patched.strokeColor).toBe("#38bdf8");
  });

  it("undo restores the exact before snapshot (endpoint pair included)", () => {
    const scene = new Scene();
    const before = makeConnector();
    scene.add(before);
    const command = new UpdateObjectCommand(
      scene,
      "conn-1",
      { end: floating(500, 500) },
      before,
    );
    command.do();
    command.undo();
    expect(scene.findById("conn-1")).toBe(before);
  });

  it("redo re-applies the endpoint patch after an undo", () => {
    const scene = new Scene();
    const before = makeConnector();
    scene.add(before);
    const command = new UpdateObjectCommand(
      scene,
      "conn-1",
      { end: floating(500, 500) },
      before,
    );
    command.do();
    command.undo();
    command.redo();
    expect(getConnector(scene).end).toEqual(floating(500, 500));
  });

  it("round-trips through history without drifting from the snapshot", () => {
    const scene = new Scene();
    const history = new HistoryManager();
    const before = makeConnector();
    scene.add(before);
    const patch: ObjectPatch = { end: floating(120, 90) };
    const command = new UpdateObjectCommand(scene, "conn-1", patch, before);
    command.do();
    history.push(command);
    history.undo();
    expect(scene.findById("conn-1")).toEqual(before);
    history.redo();
    expect(getConnector(scene).end).toEqual(floating(120, 90));
    history.undo();
    expect(scene.findById("conn-1")).toEqual(before);
  });

  it("skips connectors that are no longer in the scene (do and undo are no-ops)", () => {
    const scene = new Scene();
    scene.add(makeConnector());
    scene.remove("conn-1");
    const command = new UpdateObjectCommand(
      scene,
      "conn-1",
      { end: floating(500, 500) },
      makeConnector(),
    );
    expect(() => {
      command.do();
      command.undo();
      command.redo();
    }).not.toThrow();
    expect(scene.findById("conn-1")).toBeUndefined();
    expect(scene.objectCount).toBe(0);
  });

  it("the scene's glue pass re-syncs a glued replacement after do()", () => {
    const scene = new Scene();
    scene.add(makeShape("shape-a", 0, 0, 100, 100));
    const before = makeConnector();
    scene.add(before);
    // Re-glue the start to shape A's E anchor with a stale cached position.
    const gluedStart: ConnectorEndpoint = {
      objectId: "shape-a",
      anchorIndex: 1,
      position: vec2(0, 0),
    };
    new UpdateObjectCommand(
      scene,
      "conn-1",
      { start: gluedStart },
      before,
    ).do();
    const patched = getConnector(scene);
    expect(patched.start.objectId).toBe("shape-a");
    // Scene.add already ran the glue-follow pass: the cache re-synced.
    expect(patched.start.position).toEqual(vec2(100, 50));
  });
});
