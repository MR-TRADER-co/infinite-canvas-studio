/** Unit tests for the Camera viewport transform. */
import { describe, expect, it } from "vitest";
import { Camera } from "@/core/camera/Camera";
import { vec2 } from "@/core/geometry/Vec2";

/** Compares two points with a tolerance (floating-point safe). */
function expectVecClose(
  actual: { x: number; y: number },
  x: number,
  y: number,
): void {
  expect(Math.abs(actual.x - x)).toBeLessThan(1e-9);
  expect(Math.abs(actual.y - y)).toBeLessThan(1e-9);
}

describe("Camera", () => {
  it("identity camera maps world coordinates 1:1 to screen", () => {
    const camera = new Camera();
    expectVecClose(camera.worldToScreen(vec2(12, -7)), 12, -7);
    expectVecClose(camera.screenToWorld(vec2(12, -7)), 12, -7);
  });

  it("the camera anchor maps to the screen origin", () => {
    const camera = new Camera(40, -25, 1, 0);
    expectVecClose(camera.worldToScreen(vec2(40, -25)), 0, 0);
  });

  it("the camera anchor maps to the screen origin even when rotated", () => {
    const camera = new Camera(7, 3, 1, Math.PI / 3);
    expectVecClose(camera.worldToScreen(vec2(7, 3)), 0, 0);
  });

  it("with rotation = 0 the mapping reduces to (world - anchor) * zoom", () => {
    const camera = new Camera(10, 20, 2, 0);
    expectVecClose(camera.worldToScreen(vec2(15, 30)), 10, 20);
    expectVecClose(camera.screenToWorld(vec2(10, 20)), 15, 30);
  });

  it("zoom scales screen distances", () => {
    const camera = new Camera(0, 0, 3, 0);
    expectVecClose(camera.worldToScreen(vec2(5, 3)), 15, 9);
  });

  it("rotation rotates world points around the camera anchor", () => {
    const camera = new Camera(0, 0, 1, Math.PI / 2);
    // (1, 0) rotated by +90° → (0, 1).
    expectVecClose(camera.worldToScreen(vec2(1, 0)), 0, 1);
  });

  it("rotation happens around the anchor, not the world origin", () => {
    const camera = new Camera(5, 0, 1, Math.PI / 2);
    // Relative vector (1, 0) → (0, 1); anchor stays at screen (0, 0).
    expectVecClose(camera.worldToScreen(vec2(6, 0)), 0, 1);
  });

  it("screenToWorld inverts worldToScreen exactly (round-trip)", () => {
    const camera = new Camera(37, -11, 2.5, Math.PI / 5);
    const world = vec2(-13, 29);
    const roundTrip = camera.screenToWorld(camera.worldToScreen(world));
    expectVecClose(roundTrip, world.x, world.y);
  });

  it("worldToScreen inverts screenToWorld exactly (reverse round-trip)", () => {
    const camera = new Camera(-4, 8, 0.4, -Math.PI / 7);
    const screen = vec2(123, -456);
    const roundTrip = camera.worldToScreen(camera.screenToWorld(screen));
    expectVecClose(roundTrip, screen.x, screen.y);
  });

  it("round-trip holds for fractional zoom and full rotation", () => {
    const camera = new Camera(0.125, 999.5, 0.75, Math.PI);
    const world = vec2(-1.5, 2.25);
    const roundTrip = camera.screenToWorld(camera.worldToScreen(world));
    expectVecClose(roundTrip, world.x, world.y);
  });

  it("worldOriginToScreen maps the world origin correctly", () => {
    const camera = new Camera(-100, -50, 2, 0);
    expectVecClose(camera.worldOriginToScreen(), 200, 100);
  });

  it("default constructor parameters are the identity transform", () => {
    const camera = new Camera();
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
    expect(camera.zoom).toBe(1);
    expect(camera.rotation).toBe(0);
  });

  it("visibleWorldBBox covers the unzoomed identity viewport", () => {
    const camera = new Camera();
    const view = camera.visibleWorldBBox({ width: 200, height: 100 });
    expect(view.minX).toBe(0);
    expect(view.minY).toBe(0);
    expect(view.maxX).toBe(200);
    expect(view.maxY).toBe(100);
  });

  it("visibleWorldBBox scales inversely with zoom and shifts with the anchor", () => {
    const camera = new Camera(100, 50, 2, 0);
    const view = camera.visibleWorldBBox({ width: 200, height: 100 });
    // Screen (0,0) → world (100,50); screen (200,100) → world (200,100).
    expect(view.minX).toBe(100);
    expect(view.minY).toBe(50);
    expect(view.maxX).toBe(200);
    expect(view.maxY).toBe(100);
  });

  it("visibleWorldBBox is the tight cover of the rotated visible quad", () => {
    // Rotating the viewport 90°: screen (x, y) maps to world (y, −x), so
    // the visible quad is (0,0)·(0,−200)·(100,0)·(100,−200) and its tight
    // axis-aligned cover is (0, −200)–(100, 0).
    const camera = new Camera(0, 0, 1, Math.PI / 2);
    const view = camera.visibleWorldBBox({ width: 200, height: 100 });
    expect(view.minX).toBeCloseTo(0, 5);
    expect(view.minY).toBeCloseTo(-200, 5);
    expect(view.maxX).toBeCloseTo(100, 5);
    expect(view.maxY).toBeCloseTo(0, 5);
  });

  it("visibleWorldBBox contains every screen corner's world point", () => {
    const camera = new Camera(7, -3, 0.4, Math.PI / 5);
    const view = camera.visibleWorldBBox({ width: 640, height: 480 });
    const screenCorners = [
      vec2(0, 0),
      vec2(640, 0),
      vec2(0, 480),
      vec2(640, 480),
    ];
    for (const corner of screenCorners) {
      const world = camera.screenToWorld(corner);
      expect(world.x).toBeGreaterThanOrEqual(view.minX - 1e-9);
      expect(world.x).toBeLessThanOrEqual(view.maxX + 1e-9);
      expect(world.y).toBeGreaterThanOrEqual(view.minY - 1e-9);
      expect(world.y).toBeLessThanOrEqual(view.maxY + 1e-9);
    }
  });
});
