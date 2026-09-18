/**
 * Unit tests for the minimap planning helpers (فاز ۲۹ — «هم‌ترازی سنجاش
 * در نقشه و ارائه»): the pin-aware content bounds (stale pre-pin
 * positions never frame the map), the viewport fallback frame, the fit
 * math, and the pinned footprint's LIVE effective world quad.
 */
import { describe, expect, it } from "vitest";
import { Camera } from "@/core/camera/Camera";
import { vec2 } from "@/core/geometry/Vec2";
import type { BBox } from "@/core/geometry/BBox";
import type { SceneObjectData } from "@/core/model/SceneObject";
import {
  shapeFromRect,
  SHAPE_FILL_TOKEN,
  STROKE_COLOR_TOKEN,
} from "@/core/model/ShapeObject";
import {
  isMinimapWorldObject,
  minimapContentBounds,
  minimapFit,
  minimapSceneFit,
  minimapViewportWorldBounds,
  pinnedFootprintWorldQuad,
  unionMinimapBounds,
  MINIMAP_PADDING_PX,
} from "@/core/minimap/Minimap";

/** Builds a top-level shape fixture (pinnable kind). */
function makeShape(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): SceneObjectData {
  return shapeFromRect(
    { position: vec2(x, y), width, height },
    "rectangle",
    { fill: SHAPE_FILL_TOKEN, stroke: STROKE_COLOR_TOKEN, strokeWidth: 0 },
    id,
    0,
  );
}

/** Pins a shape in place (the stored world position goes stale by design). */
function pinShape(
  shape: SceneObjectData,
  anchor: { x: number; y: number },
): SceneObjectData {
  return {
    ...shape,
    pinned: true,
    pinAnchor: vec2(anchor.x, anchor.y),
  };
}

const VIEWPORT = { width: 1000, height: 600 };

describe("minimap world-object gating (فاز ۲۹)", () => {
  it("visible unpinned objects are world content", () => {
    expect(isMinimapWorldObject(makeShape("a", 0, 0, 10, 10))).toBe(true);
  });

  it("pinned objects are NOT world content — the screen-space render owns them", () => {
    const pinned = pinShape(makeShape("a", 0, 0, 10, 10), { x: 0.5, y: 0.5 });
    expect(isMinimapWorldObject(pinned)).toBe(false);
  });

  it("invisible objects are not world content", () => {
    const hidden = { ...makeShape("a", 0, 0, 10, 10), visible: false };
    expect(isMinimapWorldObject(hidden)).toBe(false);
  });
});

describe("minimapContentBounds (فاز ۲۹)", () => {
  it("unions the rotated bounds of visible unpinned objects", () => {
    const bounds = minimapContentBounds([
      makeShape("a", 0, 0, 100, 50),
      makeShape("b", 200, 300, 40, 40),
    ]);
    expect(bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 240,
      maxY: 340,
    } satisfies BBox);
  });

  it("EXCLUDES pinned objects — a stale pre-pin bbox never distorts the frame", () => {
    // A pinned object parked at its stale world spot far away from the
    // real content: the map must frame the real content only.
    const bounds = minimapContentBounds([
      makeShape("real", 0, 0, 100, 100),
      pinShape(makeShape("pin", 90000, -70000, 60, 60), { x: 0.25, y: 0.75 }),
    ]);
    expect(bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    } satisfies BBox);
  });

  it("returns null when only pinned (or no) objects exist", () => {
    expect(
      minimapContentBounds([
        pinShape(makeShape("a", 10, 10, 40, 40), { x: 0.5, y: 0.5 }),
      ]),
    ).toBeNull();
    expect(minimapContentBounds([])).toBeNull();
  });
});

describe("minimapViewportWorldBounds (فاز ۲۹)", () => {
  it("identity camera frames the viewport itself in world units", () => {
    const bounds = minimapViewportWorldBounds(
      new Camera(0, 0, 1, 0),
      VIEWPORT,
    );
    expect(bounds.minX).toBeCloseTo(0);
    expect(bounds.minY).toBeCloseTo(0);
    expect(bounds.maxX).toBeCloseTo(1000);
    expect(bounds.maxY).toBeCloseTo(600);
  });

  it("a panned camera anchors the frame at the camera position", () => {
    const bounds = minimapViewportWorldBounds(
      new Camera(500, 250, 1, 0),
      VIEWPORT,
    );
    expect(bounds.minX).toBeCloseTo(500);
    expect(bounds.minY).toBeCloseTo(250);
    expect(bounds.maxX).toBeCloseTo(1500);
    expect(bounds.maxY).toBeCloseTo(850);
  });

  it("zoom expands the frame in world units (less world per view)", () => {
    const bounds = minimapViewportWorldBounds(
      new Camera(0, 0, 2, 0),
      VIEWPORT,
    );
    expect(bounds.maxX).toBeCloseTo(500);
    expect(bounds.maxY).toBeCloseTo(300);
  });

  it("a rotated camera produces the axis-aligned bbox of the rotated quad", () => {
    // 90° rotation on a 1000×600 viewport: the world quad is 600×1000.
    const bounds = minimapViewportWorldBounds(
      new Camera(0, 0, 1, Math.PI / 2),
      VIEWPORT,
    );
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    expect(spanX).toBeCloseTo(600, 5);
    expect(spanY).toBeCloseTo(1000, 5);
  });
});

describe("minimapFit (فاز ۲۹)", () => {
  it("fits a wide box by width and centres it vertically", () => {
    const fit = minimapFit({ minX: 0, minY: 0, maxX: 400, maxY: 100 }, 208, 132, 8);
    // Available width 192 → scale 192/400 = 0.48.
    expect(fit.scale).toBeCloseTo(0.48);
    // Map height used: 100 × 0.48 = 48; available height 116, leftover
    // (116 − 48) = 68 → minY shifts by −68 / 2 / 0.48 in world units.
    expect(fit.minY).toBeCloseTo(-68 / 0.96);
    expect(fit.minX).toBeCloseTo(0);
  });

  it("degenerate spans never divide by zero", () => {
    const fit = minimapFit({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 208, 132, MINIMAP_PADDING_PX);
    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(fit.scale).toBeGreaterThan(0);
  });
});

describe("unionMinimapBounds (فاز ۲۹)", () => {
  it("unions overlapping boxes", () => {
    const u = unionMinimapBounds(
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      { minX: 50, minY: 50, maxX: 150, maxY: 150 },
    );
    expect(u).toEqual({ minX: 0, minY: 0, maxX: 150, maxY: 150 });
  });

  it("either side null lets the other win", () => {
    const box = { minX: 1, minY: 2, maxX: 3, maxY: 4 };
    expect(unionMinimapBounds(box, null)).toEqual(box);
    expect(unionMinimapBounds(null, box)).toEqual(box);
    expect(unionMinimapBounds(null, null)).toBeNull();
  });
});

describe("minimapSceneFit (فاز ۲۹ — view-aware framing)", () => {
  /** Minimal controller double. */
  const controllerOf = (camera: Camera): { camera: Camera } => ({ camera });

  it("frames world content ∪ the current viewport — pins riding the view stay on-map", () => {
    // World content: a tiny rectangle far to the right (x 572..708,
    // y 227..309 — the live-QA geometry). The camera sits at the origin
    // viewing 1280×537. Content-only framing would clip the view (and
    // any pin riding it) off-map; the union keeps both visible.
    const world = [makeShape("rect", 572, 227, 136, 82)];
    const camera = new Camera(0, 0, 1, 0);
    const fit = minimapSceneFit(
      { objects: world },
      controllerOf(camera),
      { width: 1280, height: 537 },
      208,
      132,
    );
    expect(fit).not.toBeNull();
    // The union spans x 0..1280, y 0..537 → the wider axis rules.
    expect(fit!.scale).toBeCloseTo((208 - 16) / 1280, 5);
  });

  it("pinned objects never enter the frame (stale positions stay inert)", () => {
    const pinned = pinShape(makeShape("parked", 90000, -70000, 60, 60), {
      x: 0.5,
      y: 0.5,
    });
    const world = makeShape("real", 0, 0, 100, 100);
    const camera = new Camera(0, 0, 1, 0);
    const fit = minimapSceneFit(
      { objects: [pinned, world] },
      controllerOf(camera),
      VIEWPORT,
      208,
      132,
    );
    // Union spans x 0..1000 (the view), y 0..600 — the parked pin's
    // stale spot is nowhere in the frame.
    expect(fit!.minX).toBeGreaterThanOrEqual(-1);
    expect(fit!.scale).toBeCloseTo((208 - 16) / 1000, 5);
  });

  it("an empty world scene falls back to the viewport frame", () => {
    const fit = minimapSceneFit(
      { objects: [] },
      controllerOf(new Camera(0, 0, 1, 0)),
      VIEWPORT,
      208,
      132,
    );
    expect(fit).not.toBeNull();
    expect(fit!.scale).toBeCloseTo((208 - 16) / 1000, 5);
  });
});

describe("pinnedFootprintWorldQuad (فاز ۲۹)", () => {
  it("identity camera maps the screen footprint 1:1 into world space", () => {
    const pinned = pinShape(makeShape("a", 90000, 90000, 120, 80), {
      x: 0.3,
      y: 0.2,
    });
    const quad = pinnedFootprintWorldQuad(pinned, new Camera(0, 0, 1, 0), VIEWPORT);
    // Anchor (300, 120) + size (120, 80) — the STALE world position is
    // nowhere in the result.
    expect(quad).toEqual([
      vec2(300, 120),
      vec2(420, 120),
      vec2(420, 200),
      vec2(300, 200),
    ]);
  });

  it("a panned camera keeps the footprint riding the viewport", () => {
    const pinned = pinShape(makeShape("a", 0, 0, 100, 100), { x: 0, y: 0 });
    const quad = pinnedFootprintWorldQuad(
      pinned,
      new Camera(1000, 500, 1, 0),
      VIEWPORT,
    );
    expect(quad?.[0]).toEqual(vec2(1000, 500));
    expect(quad?.[2]).toEqual(vec2(1100, 600));
  });

  it("a zoomed camera scales the footprint into world units", () => {
    const pinned = pinShape(makeShape("a", 0, 0, 100, 50), { x: 0, y: 0 });
    const quad = pinnedFootprintWorldQuad(pinned, new Camera(0, 0, 2, 0), VIEWPORT);
    expect(quad?.[0]).toEqual(vec2(0, 0));
    expect(quad?.[2]).toEqual(vec2(50, 25));
  });

  it("a rotated camera maps corners around the rotation", () => {
    const pinned = pinShape(makeShape("a", 0, 0, 100, 100), {
      x: 0.5,
      y: 0.5,
    });
    // 90° camera rotation (canvas convention, y-down): the screen point
    // (500, 300) lands at world (300, −500) with anchor (0,0), zoom 1.
    const quad = pinnedFootprintWorldQuad(
      pinned,
      new Camera(0, 0, 1, Math.PI / 2),
      VIEWPORT,
    );
    expect(quad?.[0]?.x).toBeCloseTo(300, 5);
    expect(quad?.[0]?.y).toBeCloseTo(-500, 5);
  });

  it("returns null for unpinned or unsized objects", () => {
    expect(
      pinnedFootprintWorldQuad(makeShape("free", 0, 0, 10, 10), new Camera(), VIEWPORT),
    ).toBeNull();
    const unsizedPinned = {
      ...pinShape(makeShape("u", 0, 0, 10, 10), { x: 0.1, y: 0.1 }),
    } as unknown as SceneObjectData;
    delete (unsizedPinned as { width?: number }).width;
    expect(
      pinnedFootprintWorldQuad(unsizedPinned, new Camera(), VIEWPORT),
    ).toBeNull();
  });
});
