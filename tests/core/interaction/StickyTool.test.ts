/** Unit tests for the sticky tool (create/edit intents on the event bus). */
import { describe, expect, it } from "vitest";
import { StickyTool } from "@/interaction/StickyTool";
import { EventBus } from "@/core/events/EventBus";
import { Scene } from "@/core/model/Scene";
import {
  DEFAULT_STICKY_FONT_SIZE,
  DEFAULT_STICKY_HEIGHT,
  DEFAULT_STICKY_NOTE_COLOR,
  DEFAULT_STICKY_WIDTH,
  STICKY_MIN_HEIGHT,
  STICKY_MIN_WIDTH,
  stickyNoteFromRect,
} from "@/core/model/StickyNoteObject";
import { SHAPE_FILL_TOKEN, STROKE_COLOR_TOKEN } from "@/core/model/ShapeObject";
import { bbox } from "@/core/geometry/BBox";
import { vec2 } from "@/core/geometry/Vec2";
import type {
  AppEventMap,
  StickyCreateRequestedEvent,
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

/** Records every sticky/text intent the tool emits on the bus during a gesture. */
class StickyIntentLog {
  public readonly creates: StickyCreateRequestedEvent[] = [];
  public readonly edits: TextEditRequestedEvent[] = [];

  public constructor(bus: EventBus<AppEventMap>) {
    bus.on("sticky:create-requested", (payload) => {
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

describe("StickyTool metadata", () => {
  it("exposes the sticky tool id and the crosshair cursor", () => {
    const tool = new StickyTool({
      scene: new Scene(),
      bus: new EventBus<AppEventMap>(),
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => 18,
    });
    expect(tool.id).toBe("sticky");
    expect(tool.cursor).toBe("crosshair");
  });
});

describe("StickyTool tap creation", () => {
  it("emits one create request for a tap on the empty canvas with the default centred rect", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new StickyIntentLog(bus);
    const tool = new StickyTool({
      scene,
      bus,
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => DEFAULT_STICKY_FONT_SIZE,
    });
    tool.onPointerDown(pointer(100, 100));
    tool.onPointerUp(pointer(100, 100));
    expect(log.count).toBe(1);
    expect(log.edits).toEqual([]);
    // The default card is centred on the tap: 220×220 around (100, 100).
    expect(log.creates).toEqual([
      {
        x: 100 - DEFAULT_STICKY_WIDTH / 2,
        y: 100 - DEFAULT_STICKY_HEIGHT / 2,
        width: DEFAULT_STICKY_WIDTH,
        height: DEFAULT_STICKY_HEIGHT,
        noteColor: DEFAULT_STICKY_NOTE_COLOR,
        fontSize: DEFAULT_STICKY_FONT_SIZE,
      },
    ]);
  });

  it("anchors the default rect at the release point for a tiny sub-threshold movement", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new StickyIntentLog(bus);
    const tool = new StickyTool({
      scene,
      bus,
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => DEFAULT_STICKY_FONT_SIZE,
    });
    tool.onPointerDown(pointer(100, 100));
    tool.onPointerUp(pointer(104, 103));
    expect(log.creates).toHaveLength(1);
    expect(log.creates[0]?.x).toBe(104 - DEFAULT_STICKY_WIDTH / 2);
    expect(log.creates[0]?.y).toBe(103 - DEFAULT_STICKY_HEIGHT / 2);
  });

  it("treats a wide-but-flat drag as a tap when either axis stays below the threshold", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new StickyIntentLog(bus);
    const tool = new StickyTool({
      scene,
      bus,
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => DEFAULT_STICKY_FONT_SIZE,
    });
    tool.onPointerDown(pointer(0, 0));
    tool.onPointerUp(pointer(100, 5));
    expect(log.creates).toHaveLength(1);
    // Tap fallback: centred default card at the release point.
    expect(log.creates[0]?.width).toBe(DEFAULT_STICKY_WIDTH);
    expect(log.creates[0]?.height).toBe(DEFAULT_STICKY_HEIGHT);
  });

  it("queries the colour and font size providers again for every gesture", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new StickyIntentLog(bus);
    const noteColor = "oklch(0.89 0.11 55)";
    const tool = new StickyTool({
      scene,
      bus,
      getNoteColor: () => noteColor,
      getFontSize: () => 22,
    });
    tool.onPointerDown(pointer(0, 0));
    tool.onPointerUp(pointer(0, 0));
    expect(log.creates[0]?.noteColor).toBe(noteColor);
    expect(log.creates[0]?.fontSize).toBe(22);
  });
});

describe("StickyTool gesture guards", () => {
  it("ignores a pointer release without a preceding press", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new StickyIntentLog(bus);
    const tool = new StickyTool({
      scene,
      bus,
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => 18,
    });
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
    const log = new StickyIntentLog(bus);
    const tool = new StickyTool({
      scene,
      bus,
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => 18,
    });
    tool.onPointerDown(pointer(100, 100, 1));
    tool.onPointerUp(pointer(100, 100));
    expect(log.count).toBe(0);
  });

  it("ignores a non-primary release after a valid press", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new StickyIntentLog(bus);
    const tool = new StickyTool({
      scene,
      bus,
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => 18,
    });
    tool.onPointerDown(pointer(100, 100));
    tool.onPointerUp(pointer(100, 100, 2));
    expect(log.count).toBe(0);
    tool.onPointerDown(pointer(100, 100));
    tool.onPointerUp(pointer(100, 100));
    expect(log.count).toBe(1);
  });
});

describe("StickyTool drag-out creation", () => {
  it("emits a create request for the dragged rectangle", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new StickyIntentLog(bus);
    const tool = new StickyTool({
      scene,
      bus,
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => 18,
    });
    tool.onPointerDown(pointer(100, 100));
    tool.onPointerUp(pointer(300, 220));
    expect(log.creates).toEqual([
      {
        x: 100,
        y: 100,
        width: 200,
        height: 120,
        noteColor: DEFAULT_STICKY_NOTE_COLOR,
        fontSize: 18,
      },
    ]);
  });

  it("clamps a dragged card below the minimum size", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new StickyIntentLog(bus);
    const tool = new StickyTool({
      scene,
      bus,
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => 18,
    });
    tool.onPointerDown(pointer(0, 0));
    tool.onPointerUp(pointer(200, 20));
    expect(log.creates).toEqual([
      {
        x: 0,
        y: 0,
        width: 200,
        height: STICKY_MIN_HEIGHT,
        noteColor: DEFAULT_STICKY_NOTE_COLOR,
        fontSize: 18,
      },
    ]);
    tool.onPointerDown(pointer(0, 300));
    tool.onPointerUp(pointer(40, 420));
    expect(log.creates[1]?.width).toBe(STICKY_MIN_WIDTH);
  });

  it("normalises a left-up drag to the min corner", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new StickyIntentLog(bus);
    const tool = new StickyTool({
      scene,
      bus,
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => 18,
    });
    tool.onPointerDown(pointer(100, 100));
    tool.onPointerUp(pointer(0, 0));
    expect(log.creates).toEqual([
      {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        noteColor: DEFAULT_STICKY_NOTE_COLOR,
        fontSize: 18,
      },
    ]);
  });
});

describe("StickyTool on existing objects", () => {
  it("emits an edit request instead of creating when tapping an existing sticky note", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new StickyIntentLog(bus);
    const tool = new StickyTool({
      scene,
      bus,
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => 18,
    });
    scene.add(
      stickyNoteFromRect(
        bbox(10, 20, 110, 120),
        DEFAULT_STICKY_NOTE_COLOR,
        "یادداشت",
        18,
        "note-1",
        0,
      ),
    );
    tool.onPointerDown(pointer(50, 40));
    tool.onPointerUp(pointer(50, 40));
    expect(log.edits).toEqual([{ objectId: "note-1" }]);
    expect(log.creates).toEqual([]);
  });

  it("emits a create request when tapping an existing non-sticky object", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new StickyIntentLog(bus);
    const tool = new StickyTool({
      scene,
      bus,
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => 18,
    });
    scene.add(makeShape("shape-1", 10, 20, 100, 50));
    tool.onPointerDown(pointer(30, 30));
    tool.onPointerUp(pointer(30, 30));
    expect(log.edits).toEqual([]);
    // The shape is not edited; the tap falls through to a default creation.
    expect(log.creates).toHaveLength(1);
    expect(log.creates[0]?.width).toBe(DEFAULT_STICKY_WIDTH);
  });
});

describe("StickyTool lifecycle", () => {
  it("streams nothing on activate, deactivate and pointer moves", () => {
    const scene = new Scene();
    const bus = new EventBus<AppEventMap>();
    const log = new StickyIntentLog(bus);
    const tool = new StickyTool({
      scene,
      bus,
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => 18,
    });
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
    const tool = new StickyTool({
      scene: new Scene(),
      bus: new EventBus<AppEventMap>(),
      getNoteColor: () => DEFAULT_STICKY_NOTE_COLOR,
      getFontSize: () => 18,
    });
    expect(tool.onCancel()).toBe(false);
  });
});
