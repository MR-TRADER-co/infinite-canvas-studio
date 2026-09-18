/** Unit tests for the intent-driven camera controller. */
import { describe, expect, it, vi } from "vitest";
import { Camera } from "@/core/camera/Camera";
import {
  CameraController,
  MAX_ZOOM,
  MIN_ZOOM,
} from "@/core/camera/CameraController";
import { vec2 } from "@/core/geometry/Vec2";
import { bbox } from "@/core/geometry/BBox";

describe("CameraController", () => {
  it("exposes the zoom clamp constants", () => {
    expect(MIN_ZOOM).toBe(0.02);
    expect(MAX_ZOOM).toBe(64);
  });

  it("owns the camera passed to the constructor", () => {
    const camera = new Camera(3, 4, 2, 0.5);
    const controller = new CameraController(camera);
    expect(controller.camera).toBe(camera);
  });

  it("panBy subtracts the world-space delta from the camera anchor", () => {
    const camera = new Camera(100, 200, 1, 0);
    const controller = new CameraController(camera);
    controller.panBy(vec2(30, -60));
    expect(camera.x).toBe(70);
    expect(camera.y).toBe(260);
  });

  it("panBy is unaffected by the current zoom", () => {
    const camera = new Camera(0, 0, 3, 0);
    const controller = new CameraController(camera);
    controller.panBy(vec2(2, -4));
    expect(camera.x).toBe(-2);
    expect(camera.y).toBe(4);
  });

  it("panByScreen divides the screen delta by the zoom (content follows the drag)", () => {
    const camera = new Camera(0, 0, 2, 0);
    const controller = new CameraController(camera);
    controller.panByScreen(100, 50);
    expect(camera.x).toBe(-50);
    expect(camera.y).toBe(-25);
  });

  it("panByScreen with 90° rotation pans the world y axis", () => {
    const camera = new Camera(0, 0, 1, Math.PI / 2);
    const controller = new CameraController(camera);
    controller.panByScreen(100, 0);
    expect(camera.x).toBeCloseTo(0);
    expect(camera.y).toBeCloseTo(100);
  });

  it("a horizontal drag under 90° rotation moves content right on screen", () => {
    const camera = new Camera(0, 0, 1, Math.PI / 2);
    const controller = new CameraController(camera);
    controller.panByScreen(100, 0);
    expect(camera.worldOriginToScreen().x).toBeCloseTo(100);
  });

  it("panByScreen compensates for zoom and rotation together", () => {
    const camera = new Camera(0, 0, 2, Math.PI / 2);
    const controller = new CameraController(camera);
    controller.panByScreen(100, 0);
    expect(camera.x).toBeCloseTo(0);
    expect(camera.y).toBeCloseTo(50);
  });

  it("zoomAt multiplies the zoom by the factor", () => {
    const camera = new Camera(0, 0, 1, 0);
    const controller = new CameraController(camera);
    controller.zoomAt(vec2(0, 0), 2);
    expect(camera.zoom).toBe(2);
  });

  it("zoomAt keeps the world point under the screen anchor stationary", () => {
    const camera = new Camera(12, -8, 1.5, 0);
    const controller = new CameraController(camera);
    const anchor = vec2(320, 180);
    const worldUnder = camera.screenToWorld(anchor);
    controller.zoomAt(anchor, 1.75);
    const worldAfter = camera.screenToWorld(anchor);
    expect(worldAfter.x).toBeCloseTo(worldUnder.x, 10);
    expect(worldAfter.y).toBeCloseTo(worldUnder.y, 10);
  });

  it("zoomAt preserves the anchor when zooming out", () => {
    const camera = new Camera(-9, 4, 2.5, 0);
    const controller = new CameraController(camera);
    const anchor = vec2(-120, 240);
    const worldUnder = camera.screenToWorld(anchor);
    controller.zoomAt(anchor, 0.5);
    const worldAfter = camera.screenToWorld(anchor);
    expect(worldAfter.x).toBeCloseTo(worldUnder.x, 10);
    expect(worldAfter.y).toBeCloseTo(worldUnder.y, 10);
  });

  it("zoomAt preserves the anchor under rotation (zooming in at 45°)", () => {
    const camera = new Camera(5, 7, 0.8, Math.PI / 4);
    const controller = new CameraController(camera);
    const anchor = vec2(320, 180);
    const worldUnder = camera.screenToWorld(anchor);
    controller.zoomAt(anchor, 2.5);
    const worldAfter = camera.screenToWorld(anchor);
    expect(worldAfter.x).toBeCloseTo(worldUnder.x, 10);
    expect(worldAfter.y).toBeCloseTo(worldUnder.y, 10);
    expect(camera.zoom).toBeCloseTo(2);
  });

  it("zoomAt preserves the anchor under rotation (zooming out at -60°)", () => {
    const camera = new Camera(-15, 3, 4, -Math.PI / 3);
    const controller = new CameraController(camera);
    const anchor = vec2(-75, 33);
    const worldUnder = camera.screenToWorld(anchor);
    controller.zoomAt(anchor, 0.25);
    const worldAfter = camera.screenToWorld(anchor);
    expect(worldAfter.x).toBeCloseTo(worldUnder.x, 10);
    expect(worldAfter.y).toBeCloseTo(worldUnder.y, 10);
    expect(camera.zoom).toBeCloseTo(1);
  });

  it("zoomAt clamps the zoom to MAX_ZOOM while keeping the anchor", () => {
    const camera = new Camera(0, 0, 4, 0);
    const controller = new CameraController(camera);
    const anchor = vec2(10, 10);
    const worldUnder = camera.screenToWorld(anchor);
    controller.zoomAt(anchor, 100);
    expect(camera.zoom).toBe(MAX_ZOOM);
    const worldAfter = camera.screenToWorld(anchor);
    expect(worldAfter.x).toBeCloseTo(worldUnder.x, 10);
    expect(worldAfter.y).toBeCloseTo(worldUnder.y, 10);
  });

  it("zoomAt clamps the zoom to MIN_ZOOM while keeping the anchor", () => {
    const camera = new Camera(0, 0, 0.2, 0);
    const controller = new CameraController(camera);
    const anchor = vec2(10, 10);
    const worldUnder = camera.screenToWorld(anchor);
    controller.zoomAt(anchor, 0.001);
    expect(camera.zoom).toBe(MIN_ZOOM);
    const worldAfter = camera.screenToWorld(anchor);
    expect(worldAfter.x).toBeCloseTo(worldUnder.x, 10);
    expect(worldAfter.y).toBeCloseTo(worldUnder.y, 10);
  });

  it("zoomAt is a no-op when the zoom is already clamped at MAX_ZOOM", () => {
    const camera = new Camera(3, 4, MAX_ZOOM, 0);
    const onChange = vi.fn();
    const controller = new CameraController(camera, onChange);
    controller.zoomAt(vec2(50, 50), 2);
    expect(camera.zoom).toBe(MAX_ZOOM);
    expect(camera.x).toBe(3);
    expect(camera.y).toBe(4);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("zoomAt is a no-op when the zoom is already clamped at MIN_ZOOM", () => {
    const camera = new Camera(-6, 9, MIN_ZOOM, 0);
    const onChange = vi.fn();
    const controller = new CameraController(camera, onChange);
    controller.zoomAt(vec2(50, 50), 0.5);
    expect(camera.zoom).toBe(MIN_ZOOM);
    expect(camera.x).toBe(-6);
    expect(camera.y).toBe(9);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("zoomAt ignores a factor of exactly 1", () => {
    const camera = new Camera(1, 2, 1.5, 0);
    const onChange = vi.fn();
    const controller = new CameraController(camera, onChange);
    controller.zoomAt(vec2(30, 30), 1);
    expect(camera.zoom).toBe(1.5);
    expect(camera.x).toBe(1);
    expect(camera.y).toBe(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("zoomAt ignores non-positive factors", () => {
    const camera = new Camera(1, 2, 1.5, 0);
    const onChange = vi.fn();
    const controller = new CameraController(camera, onChange);
    controller.zoomAt(vec2(30, 30), 0);
    controller.zoomAt(vec2(30, 30), -2);
    expect(camera.zoom).toBe(1.5);
    expect(camera.x).toBe(1);
    expect(camera.y).toBe(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rotateBy adds the delta to the rotation", () => {
    const camera = new Camera(0, 0, 1, 0.5);
    const controller = new CameraController(camera);
    controller.rotateBy(Math.PI / 6);
    expect(camera.rotation).toBeCloseTo(0.5 + Math.PI / 6, 10);
  });

  it("rotateBy works with negative deltas", () => {
    const camera = new Camera(0, 0, 1, 1);
    const controller = new CameraController(camera);
    controller.rotateBy(-2);
    expect(camera.rotation).toBeCloseTo(-1, 10);
  });

  it("reset restores the default framing", () => {
    const camera = new Camera(42, -7, 3, 1.2);
    const controller = new CameraController(camera);
    controller.reset();
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
    expect(camera.zoom).toBe(1);
    expect(camera.rotation).toBe(0);
  });

  it("notifies exactly once per applied mutation", () => {
    const camera = new Camera(0, 0, 1, 0);
    const onChange = vi.fn();
    const controller = new CameraController(camera, onChange);
    controller.panBy(vec2(1, 1));
    controller.panByScreen(2, 3);
    controller.zoomAt(vec2(4, 4), 1.5);
    controller.rotateBy(0.1);
    controller.reset();
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it("does not notify for zoom no-ops", () => {
    const camera = new Camera(0, 0, 1, 0);
    const onChange = vi.fn();
    const controller = new CameraController(camera, onChange);
    controller.zoomAt(vec2(4, 4), 0);
    controller.zoomAt(vec2(4, 4), 1);
    controller.zoomAt(vec2(4, 4), -1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("mutates safely without an onChange notifier", () => {
    const camera = new Camera(1, 1, 1, 0);
    const controller = new CameraController(camera);
    expect(() => {
      controller.panBy(vec2(1, 1));
      controller.panByScreen(2, 3);
      controller.zoomAt(vec2(4, 4), 1.5);
      controller.rotateBy(0.1);
      controller.reset();
    }).not.toThrow();
    expect(camera.zoom).toBe(1);
  });

  it("fitToBBox centers the box and scales it into the viewport", () => {
    const camera = new Camera(0, 0, 1, 0);
    const controller = new CameraController(camera);
    controller.fitToBBox(
      bbox(-100, -50, 100, 50),
      { width: 200, height: 100 },
      0.1,
    );
    // Rotated extents = box extents; available = 200*0.8=160 / 100*0.8=80.
    expect(camera.zoom).toBeCloseTo(0.8, 5);
    // Box center (0, 0) must land at the viewport center (100, 50):
    // screen = zoom * (world - anchor) ⇒ anchor = -(100/zoom, 50/zoom).
    const centerOnScreen = camera.worldToScreen(vec2(0, 0));
    expect(centerOnScreen.x).toBeCloseTo(100, 5);
    expect(centerOnScreen.y).toBeCloseTo(50, 5);
    expect(camera.x).toBeCloseTo(-125, 5);
    expect(camera.y).toBeCloseTo(-62.5, 5);
  });

  it("fitToBBox respects the width as the limiting axis", () => {
    const camera = new Camera(0, 0, 1, 0);
    const controller = new CameraController(camera);
    controller.fitToBBox(
      bbox(0, 0, 400, 100),
      { width: 400, height: 400 },
      0.1,
    );
    // Width axis: 400·0.8/400 = 0.8 vs height axis 400·0.8/100 = 3.2.
    expect(camera.zoom).toBeCloseTo(0.8, 5);
  });

  it("fitToBBox clamps the fitted zoom to MAX_ZOOM for tiny content", () => {
    const camera = new Camera(0, 0, 1, 0);
    const controller = new CameraController(camera);
    controller.fitToBBox(
      bbox(0, 0, 0.1, 0.1),
      { width: 800, height: 600 },
      0.1,
    );
    expect(camera.zoom).toBe(MAX_ZOOM);
    const centerOnScreen = camera.worldToScreen(vec2(0.05, 0.05));
    expect(centerOnScreen.x).toBeCloseTo(400, 3);
    expect(centerOnScreen.y).toBeCloseTo(300, 3);
  });

  it("fitToBBox clamps the fitted zoom to MIN_ZOOM for huge content", () => {
    const camera = new Camera(0, 0, 1, 0);
    const controller = new CameraController(camera);
    controller.fitToBBox(
      bbox(-1e6, -1e6, 1e6, 1e6),
      { width: 800, height: 600 },
      0.1,
    );
    expect(camera.zoom).toBe(MIN_ZOOM);
  });

  it("fitToBBox resets the framing for a degenerate box", () => {
    const camera = new Camera(9, 9, 5, 0.4);
    const controller = new CameraController(camera);
    controller.fitToBBox(bbox(3, 3, 3, 3), { width: 800, height: 600 });
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
    expect(camera.zoom).toBe(1);
    expect(camera.rotation).toBe(0);
  });

  it("fitToBBox accounts for viewport rotation (box grows on screen)", () => {
    // A 45°-rotated viewport shows an axis-aligned box enlarged by √2/2.
    const camera = new Camera(0, 0, 1, Math.PI / 4);
    const controller = new CameraController(camera);
    controller.fitToBBox(bbox(0, 0, 100, 100), { width: 200, height: 200 }, 0);
    const rotatedExtent = 100 * Math.SQRT2;
    expect(camera.zoom).toBeCloseTo(200 / rotatedExtent, 5);
    // The center still lands at the viewport center under rotation.
    const centerOnScreen = camera.worldToScreen(vec2(50, 50));
    expect(centerOnScreen.x).toBeCloseTo(100, 3);
    expect(centerOnScreen.y).toBeCloseTo(100, 3);
  });

  it("fitToBBox notifies exactly once per fit", () => {
    const camera = new Camera(0, 0, 1, 0);
    const onChange = vi.fn();
    const controller = new CameraController(camera, onChange);
    controller.fitToBBox(bbox(0, 0, 10, 10), { width: 100, height: 100 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
