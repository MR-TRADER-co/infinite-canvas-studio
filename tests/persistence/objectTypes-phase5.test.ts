/**
 * Unit tests for the R5.3/R5.4 optional registry fields: the connector
 * `label` and the freehand `highlighter` flag round-trip through the
 * registry entries' serialize/deserialize, and pre-Phase-5 payloads
 * (without the fields) deserialize label-less/normal — byte-compatible
 * upgrades (AC5.6/AC5.7 discipline: only the type's own entry changed).
 */
import { describe, expect, it } from "vitest";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import {
  registerCoreObjectTypes,
  CORE_TYPE_IDS,
} from "@/persistence/objectTypes";
import { vec2 } from "@/core/geometry/Vec2";
import { isConnectorObject } from "@/core/model/ConnectorObject";
import { isFreehandObject } from "@/core/model/FreehandObject";
import type { ObjectRegistryEntry } from "@/core/registry/ObjectRegistry";

/** A registry with the core types registered. */
function registry(): ObjectRegistry {
  return registerCoreObjectTypes(new ObjectRegistry());
}

/** The connector entry of a fresh registry. */
function connectorEntry(): ObjectRegistryEntry {
  const entry = registry().entryForTypeId(CORE_TYPE_IDS.connector);
  expect(entry).toBeDefined();
  return entry as ObjectRegistryEntry;
}

/** The freehand entry of a fresh registry. */
function freehandEntry(): ObjectRegistryEntry {
  const entry = registry().entryForTypeId(CORE_TYPE_IDS.freehand);
  expect(entry).toBeDefined();
  return entry as ObjectRegistryEntry;
}

/** Builds a connector wire payload with the optional label. */
function connectorWire(label?: string): Record<string, unknown> {
  return {
    id: "c1",
    position: { x: 50, y: 0 },
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    start: { objectId: null, anchorIndex: 0, position: { x: 0, y: 0 } },
    end: { objectId: null, anchorIndex: 0, position: { x: 100, y: 0 } },
    routingKind: "straight",
    strokeColor: "#000",
    strokeWidth: 2,
    strokeStyle: "solid",
    startArrow: "none",
    endArrow: "arrow",
    ...(label === undefined ? {} : { label }),
  };
}

/** Builds a freehand wire payload with the optional marker flag. */
function freehandWire(highlighter?: boolean): Record<string, unknown> {
  return {
    id: "f1",
    position: { x: 0, y: 0 },
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    points: [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ],
    strokeColor: "#000",
    strokeWidth: 2,
    strokeStyle: "solid",
    ...(highlighter === undefined ? {} : { highlighter }),
  };
}

describe("connector label registry round-trip (R5.3)", () => {
  it("deserializes the label and survives serialize → deserialize", () => {
    const entry = connectorEntry();
    const first = entry.deserialize(connectorWire("بله"));
    expect(first).not.toBeNull();
    if (first !== null && isConnectorObject(first)) {
      expect(first.label).toBe("بله");
      const wire = entry.serialize(first) as Record<string, unknown>;
      expect(wire.label).toBe("بله");
      const second = entry.deserialize(wire);
      expect(second).not.toBeNull();
      if (second !== null && isConnectorObject(second)) {
        expect(second.label).toBe("بله");
      }
    }
  });

  it("pre-Phase-5 payloads deserialize label-less (byte-compatible)", () => {
    const entry = connectorEntry();
    const result = entry.deserialize(connectorWire(undefined));
    expect(result).not.toBeNull();
    if (result !== null && isConnectorObject(result)) {
      expect(result.label).toBeUndefined();
    }
  });

  it("empty-string labels are dropped (label-less, renderer contract)", () => {
    const entry = connectorEntry();
    const result = entry.deserialize(connectorWire(""));
    expect(result).not.toBeNull();
    if (result !== null && isConnectorObject(result)) {
      expect(result.label).toBeUndefined();
    }
  });
});

describe("freehand highlighter registry round-trip (R5.4)", () => {
  it("deserializes the marker flag and survives the round-trip", () => {
    const entry = freehandEntry();
    const first = entry.deserialize(freehandWire(true));
    expect(first).not.toBeNull();
    if (first !== null && isFreehandObject(first)) {
      expect(first.highlighter).toBe(true);
      const wire = entry.serialize(first) as Record<string, unknown>;
      expect(wire.highlighter).toBe(true);
      const second = entry.deserialize(wire);
      expect(second).not.toBeNull();
      if (second !== null && isFreehandObject(second)) {
        expect(second.highlighter).toBe(true);
      }
    }
  });

  it("pre-Phase-5 payloads deserialize as normal strokes", () => {
    const entry = freehandEntry();
    const result = entry.deserialize(freehandWire(undefined));
    expect(result).not.toBeNull();
    if (result !== null && isFreehandObject(result)) {
      expect(result.highlighter).toBeUndefined();
    }
  });

  it("non-boolean marker values fall back to a normal stroke", () => {
    const entry = freehandEntry();
    const result = entry.deserialize({ ...freehandWire(), highlighter: "yes" });
    expect(result).not.toBeNull();
    if (result !== null && isFreehandObject(result)) {
      expect(result.highlighter).toBeUndefined();
    }
  });
});

describe("highlighter draft stamping (PenTool, R5.4)", () => {
  /** Builds a pen tool over a fresh scene with the given style resolver. */
  async function makePen(
    highlighter: boolean,
    width: number,
  ): Promise<{ pen: unknown; scene: import("@/core/model/Scene").Scene }> {
    const { PenTool } = await import("@/interaction/PenTool");
    const { StrokeOverlay } = await import("@/rendering/StrokeOverlay");
    const { Scene } = await import("@/core/model/Scene");
    const { HistoryManager } = await import("@/core/history/HistoryManager");
    const { IdGenerator } = await import("@/core/id/IdGenerator");
    const scene = new Scene();
    const pen = new PenTool({
      scene,
      history: new HistoryManager(),
      ids: new IdGenerator("obj"),
      overlay: new StrokeOverlay(),
      getStrokeStyle: () => ({ color: "primary", width, highlighter }),
    });
    return { pen, scene };
  }

  /** A normalised pointer payload (identity camera). */
  function pointerAt(x: number, y: number): ToolPointerEventLike {
    return {
      screen: vec2(x, y),
      world: vec2(x, y),
      button: 0,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
    };
  }

  /** The minimal pointer payload shape the tools accept. */
  interface ToolPointerEventLike {
    readonly screen: { readonly x: number; readonly y: number };
    readonly world: { readonly x: number; readonly y: number };
    readonly button: number;
    readonly shiftKey: boolean;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
  }

  it("the pen tool stamps the resolved marker mode on the stroke", async () => {
    const { pen, scene } = await makePen(true, 12);
    (pen as { onPointerDown: (e: never) => void }).onPointerDown(
      pointerAt(5, 5) as never,
    );
    (pen as { onPointerUp: (e: never) => void }).onPointerUp(
      pointerAt(25, 25) as never,
    );
    const stroke = scene.objects[0];
    expect(stroke).toBeDefined();
    if (stroke !== undefined && isFreehandObject(stroke)) {
      expect(stroke.highlighter).toBe(true);
      expect(stroke.strokeColor).toBe("primary");
      expect(stroke.strokeWidth).toBe(12);
    }
  });

  it("normal pen drafts stay highlighter-less", async () => {
    const { pen, scene } = await makePen(false, 2);
    (pen as { onPointerDown: (e: never) => void }).onPointerDown(
      pointerAt(5, 5) as never,
    );
    (pen as { onPointerUp: (e: never) => void }).onPointerUp(
      pointerAt(25, 25) as never,
    );
    const stroke = scene.objects[0];
    expect(stroke).toBeDefined();
    if (stroke !== undefined && isFreehandObject(stroke)) {
      expect(stroke.highlighter).toBeUndefined();
      expect(stroke.strokeWidth).toBe(2);
    }
  });
});
