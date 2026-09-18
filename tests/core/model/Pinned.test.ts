/**
 * Unit tests for the pin-to-screen model (فاز ۲۵ — «سنجاش روی صفحه»):
 * pinnable-kind gating, anchor math (screen↔fraction round-trips,
 * clamping), the pin/unpin world↔screen hand-offs, the screen footprint
 * and the 3×3 position presets.
 */
import { describe, expect, it } from "vitest";
import { Camera } from "@/core/camera/Camera";
import { vec2 } from "@/core/geometry/Vec2";
import {
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN,
  type ShapeObjectData,
} from "@/core/model/ShapeObject";
import type { ConnectorObjectData } from "@/core/model/ConnectorObject";
import {
  PIN_POSITION_PRESETS,
  PIN_RESIZE_FIXED_POINT,
  anchorOnPin,
  clampPinAnchor,
  hitPinnedResizeHandle,
  hitPinnedRotateHandle,
  isPinnableObject,
  isPinnedObject,
  pinAnchorToScreen,
  pinnedFootprintCentre,
  pinnedHandleAnchors,
  pinnedResizeFrame,
  pinnedRotateHandleAnchor,
  pinnedRotationDelta,
  pinnedScreenRect,
  screenToPinAnchor,
  worldOnUnpin,
} from "@/core/model/Pinned";

/** Builds a TOP-LEVEL shape fixture (no parent — pinnable). */
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
    name: undefined,
    parentId: undefined,
    position: vec2(x, y),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    shapeKind: "rectangle",
    width,
    height,
    fill: SHAPE_FILL_TOKEN,
    stroke: STROKE_COLOR_TOKEN,
    strokeWidth: 0,
  };
}

/** Builds a sticky-note fixture. */
function makeSticky(overrides: Record<string, unknown> = {}) {
  return {
    id: "sticky-1",
    kind: "stickyNote" as const,
    position: vec2(100, 100),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    width: 160,
    height: 160,
    text: "یادداشت",
    fontSize: 18,
    noteColor: "#f59e0b",
    color: "#333",
    ...overrides,
  };
}

describe("isPinnableObject / isPinnedObject", () => {
  it("accepts the five pinnable top-level kinds", () => {
    expect(isPinnableObject(makeShape("a", 0, 0, 10, 10))).toBe(true);
    expect(isPinnableObject(makeSticky({ id: "b" }))).toBe(true);
    expect(
      isPinnableObject({
        ...makeSticky({ id: "c", kind: "textBox" as const }),
      }),
    ).toBe(true);
  });

  it("refuses world-attached kinds and group children", () => {
    const child = { ...makeShape("child", 0, 0, 10, 10), parentId: "group-1" };
    expect(isPinnableObject(child)).toBe(false);
    const connector: ConnectorObjectData = {
      id: "conn",
      kind: "connector",
      position: vec2(0, 0),
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      start: { objectId: null, anchorIndex: 0, position: vec2(0, 0) },
      end: { objectId: null, anchorIndex: 0, position: vec2(1, 1) },
      routingKind: "straight",
      strokeColor: "#000",
      strokeWidth: 2,
      strokeStyle: "solid",
      startArrow: "none",
      endArrow: "none",
    };
    expect(isPinnableObject(connector)).toBe(false);
  });

  it("reads the pinned flag defensively", () => {
    const plain = makeSticky();
    expect(isPinnedObject(plain)).toBe(false);
    expect(isPinnedObject({ ...plain, pinned: true })).toBe(true);
  });
});

describe("anchor math", () => {
  it("maps anchors to screen and back (round-trip)", () => {
    const viewport = { width: 1200, height: 800 };
    const anchor = vec2(0.25, 0.5);
    const screen = pinAnchorToScreen(anchor, viewport);
    expect(screen).toEqual(vec2(300, 400));
    expect(screenToPinAnchor(screen, viewport)).toEqual(anchor);
  });

  it("clamps out-of-range screen points into the viewport", () => {
    const viewport = { width: 1000, height: 500 };
    expect(screenToPinAnchor(vec2(-40, 900), viewport)).toEqual(
      clampPinAnchor(vec2(0, 1)),
    );
    expect(clampPinAnchor(vec2(1.4, -0.2))).toEqual(vec2(1, 0));
  });

  it("degrades to the origin on a degenerate viewport", () => {
    expect(screenToPinAnchor(vec2(300, 200), { width: 0, height: 0 })).toEqual(
      vec2(0, 0),
    );
  });
});

describe("pin/unpin hand-offs", () => {
  it("pinning captures the object's current on-screen spot", () => {
    const camera = new Camera(200, 100, 2, 0);
    const object = makeShape("a", 300, 260, 350, 310);
    const anchor = anchorOnPin(object, camera, { width: 1000, height: 600 });
    // world (300,260) → screen ((300-200)*2, (260-100)*2) = (200, 320)
    expect(pinAnchorToScreen(anchor, { width: 1000, height: 600 })).toEqual(
      vec2(200, 320),
    );
  });

  it("unpinning drops the world position under the anchor (round-trip)", () => {
    const camera = new Camera(50, 40, 0.5, 0);
    const object = {
      ...makeSticky(),
      pinned: true,
      pinAnchor: vec2(0.4, 0.3),
    };
    const world = worldOnUnpin(object, camera, { width: 800, height: 600 });
    // anchor (320, 180) → world (320/0.5+50, 180/0.5+40) = (690, 400)
    expect(world).toEqual(vec2(690, 400));
    expect(camera.worldToScreen(world)).toEqual(vec2(320, 180));
  });
});

describe("pinnedScreenRect", () => {
  it("places the footprint at the anchor with the intrinsic size", () => {
    const object = {
      ...makeSticky(),
      pinned: true,
      pinAnchor: vec2(0.1, 0.2),
    };
    const rect = pinnedScreenRect(object, { width: 1000, height: 500 });
    expect(rect).toEqual({
      minX: 100,
      minY: 100,
      maxX: 260,
      maxY: 260,
    });
  });
});

describe("PIN_POSITION_PRESETS", () => {
  it("covers the nine screen regions with distinct ids", () => {
    expect(PIN_POSITION_PRESETS).toHaveLength(9);
    const ids = new Set(PIN_POSITION_PRESETS.map((preset) => preset.id));
    expect(ids.size).toBe(9);
    for (const preset of PIN_POSITION_PRESETS) {
      expect(preset.anchor.x).toBeGreaterThanOrEqual(0);
      expect(preset.anchor.x).toBeLessThanOrEqual(1);
      expect(preset.anchor.y).toBeGreaterThanOrEqual(0);
      expect(preset.anchor.y).toBeLessThanOrEqual(1);
    }
  });
});

describe("pinnedResizeFrame (فاز ۲۷ — تغییر اندازهٔ سنجاق‌شده)", () => {
  /** A pinned shape at anchor (0.25, 0.25) → screen (200, 150), 160×90. */
  const VIEWPORT = { width: 800, height: 600 };
  function pinnedShape(): ShapeObjectData & {
    pinned: boolean;
    pinAnchor: ReturnType<typeof vec2>;
  } {
    return {
      ...makeShape("p", 5000, 5000, 160, 90),
      pinned: true,
      pinAnchor: vec2(0.25, 0.25),
    };
  }

  it("the se handle keeps the top-left anchor EXACTLY fixed", () => {
    const frame = pinnedResizeFrame(
      pinnedShape(),
      "se",
      vec2(320, 240),
      VIEWPORT,
      8,
      false,
    );
    // Origin (200,150) untouched; size follows the pointer exactly.
    expect(frame).not.toBeNull();
    expect(frame?.width).toBe(120);
    expect(frame?.height).toBe(90);
    expect(frame?.pinAnchor).toEqual(vec2(0.25, 0.25));
  });

  it("the nw handle keeps the bottom-right corner EXACTLY fixed", () => {
    const before = pinnedShape();
    const frame = pinnedResizeFrame(
      before,
      "nw",
      vec2(260, 200),
      VIEWPORT,
      8,
      false,
    );
    expect(frame).not.toBeNull();
    // Fixed corner: (200+160, 150+90) = (360, 240) stays.
    expect(frame?.width).toBe(100);
    expect(frame?.height).toBe(40);
    expect(frame?.pinAnchor).toEqual(vec2(260 / 800, 200 / 600));
    const originX = (frame?.pinAnchor.x ?? 0) * 800;
    const originY = (frame?.pinAnchor.y ?? 0) * 600;
    expect(originX + (frame?.width ?? 0)).toBe(360);
    expect(originY + (frame?.height ?? 0)).toBe(240);
  });

  it("every handle keeps its PIN_RESIZE_FIXED_POINT put", () => {
    const object = pinnedShape();
    const origin = pinAnchorToScreen(object.pinAnchor, VIEWPORT);
    for (const handle of [
      "nw",
      "n",
      "ne",
      "e",
      "se",
      "s",
      "sw",
      "w",
    ] as const) {
      const fixed = PIN_RESIZE_FIXED_POINT[handle];
      const frame = pinnedResizeFrame(
        object,
        handle,
        vec2(333, 222),
        VIEWPORT,
        8,
        false,
      );
      expect(frame, handle).not.toBeNull();
      const newOriginX = (frame?.pinAnchor.x ?? 0) * VIEWPORT.width;
      const newOriginY = (frame?.pinAnchor.y ?? 0) * VIEWPORT.height;
      const fixedX = origin.x + fixed.x * (frame?.width ?? 0);
      const fixedY = origin.y + fixed.y * (frame?.height ?? 0);
      expect(newOriginX + fixed.x * (frame?.width ?? 0), handle).toBe(
        origin.x + fixed.x * 160,
      );
      expect(newOriginY + fixed.y * (frame?.height ?? 0), handle).toBe(
        origin.y + fixed.y * 90,
      );
      void fixedX;
      void fixedY;
    }
  });

  it("an inward drag shrinks exactly to the minimum, never flips", () => {
    const frame = pinnedResizeFrame(
      pinnedShape(),
      "se",
      vec2(205, 152),
      VIEWPORT,
      12,
      false,
    );
    expect(frame?.width).toBe(12);
    expect(frame?.height).toBe(12);
    expect(frame?.pinAnchor).toEqual(vec2(0.25, 0.25));
  });

  it("keepAspect locks the corner resize to the before ratio", () => {
    // before 160×90 → ratio 0.5625; dragging se to width 80 keeps the
    // height at width·(90/160) = 45.
    const frame = pinnedResizeFrame(
      pinnedShape(),
      "se",
      vec2(280, 195),
      VIEWPORT,
      8,
      true,
    );
    expect(frame).not.toBeNull();
    expect(frame?.width).toBe(80);
    expect(frame?.height).toBeCloseTo(45, 10);
  });

  it("a rotated object resizes in its LOCAL frame (pointer un-rotates)", () => {
    const rotated = { ...pinnedShape(), rotation: Math.PI / 2 };
    // The ROTATED se corner sits at screen (235, 275): the local +x axis
    // (width) points DOWN-screen at 90°. Dragging that corner 40px
    // further down-screen grows the LOCAL width 160 → 200, height kept.
    const frame = pinnedResizeFrame(
      rotated,
      "se",
      vec2(235, 315),
      VIEWPORT,
      8,
      false,
    );
    expect(frame).not.toBeNull();
    expect(frame?.width).toBe(200);
    expect(frame?.height).toBe(90);
    // The unrotated-frame origin (se keeps it) — anchor unchanged.
    expect(frame?.pinAnchor).toEqual(vec2(0.25, 0.25));
    // Rotation never changes.
    expect(rotated.rotation).toBe(Math.PI / 2);
  });

  it("returns null on a degenerate viewport or an unpinned object", () => {
    expect(
      pinnedResizeFrame(
        pinnedShape(),
        "se",
        vec2(300, 200),
        { width: 0, height: 600 },
        8,
        false,
      ),
    ).toBeNull();
    expect(
      pinnedResizeFrame(
        { ...pinnedShape(), pinned: false },
        "se",
        vec2(300, 200),
        VIEWPORT,
        8,
        false,
      ),
    ).toBeNull();
  });

  it("the anchor is deliberately UNCLAMPED (top-left may leave the screen)", () => {
    // Drag nw far past the fixed bottom-right → clamped to min at the
    // fixed corner: origin = (360-8, 240-8) — still in range here; but a
    // partially off-screen object resizing nw keeps fractions > 0/ < 1.
    const offscreen = {
      ...pinnedShape(),
      pinAnchor: vec2(-0.1, -0.05),
    };
    const frame = pinnedResizeFrame(
      offscreen,
      "se",
      vec2(120, 90),
      VIEWPORT,
      8,
      false,
    );
    expect(frame?.pinAnchor).toEqual(vec2(-0.1, -0.05));
  });
});

describe("pinnedHandleAnchors + hitPinnedResizeHandle (فاز ۲۷)", () => {
  const VIEWPORT = { width: 800, height: 600 };
  function pinnedShape(rotation = 0): ShapeObjectData & {
    pinned: boolean;
    pinAnchor: ReturnType<typeof vec2>;
  } {
    return {
      ...makeShape("p", 0, 0, 160, 90),
      pinned: true,
      pinAnchor: vec2(0.25, 0.25),
      ...(rotation !== 0 ? { rotation } : {}),
    };
  }

  it("places the eight anchors on the screen footprint", () => {
    const anchors = pinnedHandleAnchors(pinnedShape(), VIEWPORT);
    expect(anchors).toHaveLength(8);
    const byId = new Map(anchors.map((a) => [a.id, a.screen]));
    expect(byId.get("nw")).toEqual(vec2(200, 150));
    expect(byId.get("se")).toEqual(vec2(360, 240));
    expect(byId.get("n")).toEqual(vec2(280, 150));
    expect(byId.get("e")).toEqual(vec2(360, 195));
  });

  it("rotates the anchors around the footprint centre when tilted", () => {
    const anchors = pinnedHandleAnchors(pinnedShape(Math.PI / 2), VIEWPORT);
    const byId = new Map(anchors.map((a) => [a.id, a.screen]));
    // 90° rotation around (280, 195): nw (200,150) → (280−45, 195−80)…
    // rotate (dx,dy)=(-80,-45) by +90° → (45,-80) → (325, 115).
    expect(byId.get("nw")?.x).toBeCloseTo(325, 10);
    expect(byId.get("nw")?.y).toBeCloseTo(115, 10);
  });

  it("hit-tests the nearest handle within tolerance (corners win ties)", () => {
    const object = pinnedShape();
    expect(
      hitPinnedResizeHandle(object, vec2(202, 152), VIEWPORT, 10),
    ).toBe("nw");
    // The centre of the nw/se diagonal midpoint: closer to nothing within
    // 10px of any anchor → null.
    expect(
      hitPinnedResizeHandle(object, vec2(280, 195), VIEWPORT, 10),
    ).toBeNull();
    // Just outside the tolerance → null.
    expect(
      hitPinnedResizeHandle(object, vec2(213, 163), VIEWPORT, 10),
    ).toBeNull();
  });

  it("refuses unpinned or unsized objects", () => {
    expect(
      hitPinnedResizeHandle(
        { ...pinnedShape(), pinned: false } as never,
        vec2(202, 152),
        VIEWPORT,
      ),
    ).toBeNull();
  });
});

describe("pinned rotation helpers (فاز ۳۰ — چرخش سنجاق‌شده)", () => {
  /** A pinned shape at anchor (0.25, 0.25) → screen (200, 150), 160×90. */
  const VIEWPORT = { width: 800, height: 600 };
  function pinnedShape(rotation = 0): ShapeObjectData & {
    pinned: boolean;
    pinAnchor: ReturnType<typeof vec2>;
  } {
    return {
      ...makeShape("p", 5000, 5000, 160, 90),
      pinned: true,
      pinAnchor: vec2(0.25, 0.25),
      rotation,
    };
  }

  it("the footprint centre is the rect midpoint", () => {
    expect(pinnedFootprintCentre(pinnedShape(), VIEWPORT)).toEqual(
      vec2(280, 195),
    );
  });

  it("the grip rides 24px above the (rotated) top-edge centre", () => {
    // Upright: top centre (280,150), up (0,-1) → grip (280,126).
    expect(pinnedRotateHandleAnchor(pinnedShape(), VIEWPORT)).toEqual(
      vec2(280, 126),
    );
    // Tilted 90° (clockwise, y-down): top centre → (325,195), up (1,0)
    // → grip (349,195).
    expect(
      pinnedRotateHandleAnchor(pinnedShape(Math.PI / 2), VIEWPORT),
    ).toEqual(vec2(349, 195));
  });

  it("the grip refuses unpinned/unsized objects and dead viewports", () => {
    expect(
      pinnedRotateHandleAnchor(
        { ...pinnedShape(), pinned: false } as never,
        VIEWPORT,
      ),
    ).toBeNull();
    expect(
      pinnedRotateHandleAnchor(pinnedShape(), { width: 0, height: 600 }),
    ).toBeNull();
  });

  it("hit-tests the grip within the 11px tolerance", () => {
    expect(
      hitPinnedRotateHandle(pinnedShape(), vec2(280, 126), VIEWPORT),
    ).toBe(true);
    expect(
      hitPinnedRotateHandle(pinnedShape(), vec2(290, 126), VIEWPORT),
    ).toBe(true);
    expect(
      hitPinnedRotateHandle(pinnedShape(), vec2(280, 138), VIEWPORT),
    ).toBe(false);
    // The top-edge resize handle is 24px away — never grabbed by the grip.
    expect(
      hitPinnedRotateHandle(pinnedShape(), vec2(280, 150), VIEWPORT),
    ).toBe(false);
    // A rotated object's grip follows the tilt.
    expect(
      hitPinnedRotateHandle(
        pinnedShape(Math.PI / 2),
        vec2(349, 195),
        VIEWPORT,
      ),
    ).toBe(true);
  });

  it("the rotation delta is the pointer angle around the centre", () => {
    const centre = vec2(0, 0);
    // Quarter turn: start along +x, pointer along +y → +90°.
    expect(
      pinnedRotationDelta(centre, vec2(1, 0), vec2(0, 1), null),
    ).toBeCloseTo(Math.PI / 2, 10);
    // Full circle back to the start → 0.
    expect(
      pinnedRotationDelta(centre, vec2(1, 0), vec2(1, 0), null),
    ).toBe(0);
    // Snap: 20° rounds to 15° with the π/12 step.
    const twenty = (20 * Math.PI) / 180;
    const unsnapped = pinnedRotationDelta(
      centre,
      vec2(1, 0),
      vec2(Math.cos(twenty), Math.sin(twenty)),
      null,
    );
    const snapped = pinnedRotationDelta(
      centre,
      vec2(1, 0),
      vec2(Math.cos(twenty), Math.sin(twenty)),
      Math.PI / 12,
    );
    expect(unsnapped).toBeCloseTo(twenty, 10);
    expect(snapped).toBeCloseTo(Math.PI / 12, 10);
  });
});
