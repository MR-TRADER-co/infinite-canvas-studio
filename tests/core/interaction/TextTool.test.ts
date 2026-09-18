/** Unit tests for the text tool (create/edit intents on the event bus). */
import { describe, expect, it } from "vitest";
import { TextTool } from "@/interaction/TextTool";
import { EventBus } from "@/core/events/EventBus";
import { Scene } from "@/core/model/Scene";
import {
  DEFAULT_TEXT_HEIGHT,
  DEFAULT_TEXT_WIDTH,
  textBoxFromRect,
} from "@/core/model/TextBoxObject";
import { SHAPE_FILL_TOKEN, STROKE_COLOR_TOKEN } from "@/core/model/ShapeObject";
import { bbox } from "@/core/geometry/BBox";
import { vec2 } from "@/core/geometry/Vec2";
import type {
  AppEventMap,
  TextCreateRequestedEvent,
  TextEditRequestedEvent,
} from "@/core/events/EventBus";
import type { ToolPointerEvent } from "@/interaction/Tool";
import type { ShapeObjectData } from "@/core/model/ShapeObject";

/** Builds a normalised pointer payload (screen mirrors world, identity camera). */
function pointer(x: number, y: number, button = 0): ToolPointerEvent {
  return {
    screen: vec2(x, y),
    world: vec2(x, y),
    button,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
  };
}

/** Builds a fully populated shape fixture (a non-text scene object). */
function makeShape(
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

/** Records every text intent the tool emits on the bus during a gesture. */
class TextIntentLog {
  public readonly creates: TextCreateRequestedEvent[] = [];
  public readonly edits: TextEditRequestedEvent[] = [];

  public constructor(bus: EventBus<AppEventMap>) {
    bus.on("text:create-requested", (payload) => {
      this.creates.push(payload);
    });
    bus.on("text:edit-requested", (payload) => {
      this.edits.push(payload);
    });
  }

  /** @returns the total number of captured intents. */
  public get count(): number {
    return this.creates.length + this.edits.length;
  }
}

describe("TextTool metadata", () => {
  it("exposes the text tool id and the text cursor", () => {
    const tool = new TextTool({
      scene: new Scene(),
      bus: new EventBus<AppEventMap>(),
      getFontSize: () => 20,
    });
    expect(tool.id).toBe("text");
    expect(tool.cursor).toBe("text");
  });
});

describe("TextTool tap creation", () => {
  it("emits one create request for a tap on the empty canvas with the default rect", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new TextIntentLog(bus);
    const tool = new TextTool({ scene, bus, getFontSize: () => 20 });
    tool.onPointerDown(pointer(100, 100));
    tool.onPointerUp(pointer(100, 100));
    expect(log.count).toBe(1);
    expect(log.edits).toEqual([]);
    // The default box's top-left sits half a default height above the tap.
    expect(log.creates).toEqual([
      {
        x: 100,
        y: 68,
        width: DEFAULT_TEXT_WIDTH,
        height: DEFAULT_TEXT_HEIGHT,
        fontSize: 20,
        sizeMode: "auto",
      },
    ]);
  });

  it("anchors the default rect at the release point for a tiny sub-threshold movement", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new TextIntentLog(bus);
    const tool = new TextTool({ scene, bus, getFontSize: () => 20 });
    // 3×5 world units of movement stay below the 8-unit tap threshold.
    tool.onPointerDown(pointer(100, 100));
    tool.onPointerUp(pointer(103, 105));
    expect(log.creates).toEqual([
      {
        x: 103,
        y: 73,
        width: DEFAULT_TEXT_WIDTH,
        height: DEFAULT_TEXT_HEIGHT,
        fontSize: 20,
        sizeMode: "auto",
      },
    ]);
  });

  it("treats a wide-but-flat drag as a tap when either axis stays below the threshold", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new TextIntentLog(bus);
    const tool = new TextTool({ scene, bus, getFontSize: () => 20 });
    tool.onPointerDown(pointer(0, 0));
    tool.onPointerUp(pointer(100, 5));
    expect(log.creates).toEqual([
      {
        x: 100,
        y: -27,
        width: DEFAULT_TEXT_WIDTH,
        height: DEFAULT_TEXT_HEIGHT,
        fontSize: 20,
        sizeMode: "auto",
      },
    ]);
  });

  it("queries the font size provider again for every gesture", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new TextIntentLog(bus);
    let fontSize = 20;
    const tool = new TextTool({ scene, bus, getFontSize: () => fontSize });
    tool.onPointerDown(pointer(0, 0));
    tool.onPointerUp(pointer(0, 0));
    expect(log.creates[0]?.fontSize).toBe(20);
    fontSize = 32;
    tool.onPointerDown(pointer(200, 200));
    tool.onPointerUp(pointer(200, 200));
    expect(log.creates).toHaveLength(2);
    expect(log.creates[1]?.fontSize).toBe(32);
  });
});

describe("TextTool gesture guards", () => {
  it("ignores a pointer release without a preceding press", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new TextIntentLog(bus);
    const tool = new TextTool({ scene, bus, getFontSize: () => 20 });
    tool.onPointerUp(pointer(50, 50));
    expect(log.count).toBe(0);
    // The stray release leaves no residue: a full tap still works.
    tool.onPointerDown(pointer(100, 100));
    tool.onPointerUp(pointer(100, 100));
    expect(log.count).toBe(1);
  });

  it("ignores presses of non-primary buttons (middle click)", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new TextIntentLog(bus);
    const tool = new TextTool({ scene, bus, getFontSize: () => 20 });
    tool.onPointerDown(pointer(100, 100, 1));
    tool.onPointerUp(pointer(100, 100));
    expect(log.count).toBe(0);
  });

  it("ignores a non-primary release after a valid press", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new TextIntentLog(bus);
    const tool = new TextTool({ scene, bus, getFontSize: () => 20 });
    tool.onPointerDown(pointer(100, 100));
    tool.onPointerUp(pointer(100, 100, 2));
    expect(log.count).toBe(0);
    tool.onPointerDown(pointer(100, 100));
    tool.onPointerUp(pointer(100, 100));
    expect(log.count).toBe(1);
  });
});

describe("TextTool drag-out creation", () => {
  it("emits a create request for the dragged rectangle", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new TextIntentLog(bus);
    const tool = new TextTool({ scene, bus, getFontSize: () => 20 });
    tool.onPointerDown(pointer(100, 100));
    tool.onPointerUp(pointer(300, 180));
    expect(log.creates).toEqual([
      {
        x: 100,
        y: 100,
        width: 200,
        height: 80,
        fontSize: 20,
        sizeMode: "fixed",
      },
    ]);
  });

  it("clamps a dragged box shorter than one line to the minimum line height", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new TextIntentLog(bus);
    const tool = new TextTool({ scene, bus, getFontSize: () => 20 });
    tool.onPointerDown(pointer(0, 0));
    tool.onPointerUp(pointer(200, 10));
    // 48 = DEFAULT_TEXT_HEIGHT * 0.75 (at least ~¾ of a default line).
    expect(log.creates).toEqual([
      {
        x: 0,
        y: 0,
        width: 200,
        height: DEFAULT_TEXT_HEIGHT * 0.75,
        fontSize: 20,
        sizeMode: "fixed",
      },
    ]);
  });

  it("normalises a left-up drag to the min corner", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new TextIntentLog(bus);
    const tool = new TextTool({ scene, bus, getFontSize: () => 20 });
    tool.onPointerDown(pointer(100, 100));
    tool.onPointerUp(pointer(0, 0));
    expect(log.creates).toEqual([
      { x: 0, y: 0, width: 100, height: 100, fontSize: 20, sizeMode: "fixed" },
    ]);
  });
});

describe("TextTool on existing objects", () => {
  it("emits an edit request instead of creating when tapping an existing text box", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new TextIntentLog(bus);
    const tool = new TextTool({ scene, bus, getFontSize: () => 20 });
    scene.add(textBoxFromRect(bbox(10, 20, 110, 70), "متن", 20, "text-1", 0));
    tool.onPointerDown(pointer(50, 40));
    tool.onPointerUp(pointer(50, 40));
    expect(log.edits).toEqual([{ objectId: "text-1" }]);
    expect(log.creates).toEqual([]);
  });

  it("emits a create request when tapping an existing non-text object", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new TextIntentLog(bus);
    const tool = new TextTool({ scene, bus, getFontSize: () => 20 });
    scene.add(makeShape("shape-1", 10, 20, 100, 50));
    tool.onPointerDown(pointer(30, 30));
    tool.onPointerUp(pointer(30, 30));
    expect(log.edits).toEqual([]);
    // The shape is not edited; the tap falls through to a default creation.
    expect(log.creates).toEqual([
      {
        x: 30,
        y: -2,
        width: DEFAULT_TEXT_WIDTH,
        height: DEFAULT_TEXT_HEIGHT,
        fontSize: 20,
        sizeMode: "auto",
      },
    ]);
  });
});

describe("TextTool lifecycle", () => {
  it("streams nothing on activate, deactivate and pointer moves", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new TextIntentLog(bus);
    const tool = new TextTool({ scene, bus, getFontSize: () => 20 });
    tool.onActivate();
    tool.onPointerMove(pointer(5, 5));
    tool.onPointerMove(pointer(50, 50));
    tool.onDeactivate();
    expect(log.count).toBe(0);
    // The stateless lifecycle leaves the tool fully functional afterwards.
    tool.onPointerDown(pointer(10, 10));
    tool.onPointerUp(pointer(10, 10));
    expect(log.count).toBe(1);
  });

  it("reports nothing to cancel (onCancel returns false)", () => {
    const tool = new TextTool({
      scene: new Scene(),
      bus: new EventBus<AppEventMap>(),
      getFontSize: () => 20,
    });
    expect(tool.onCancel()).toBe(false);
  });
});
