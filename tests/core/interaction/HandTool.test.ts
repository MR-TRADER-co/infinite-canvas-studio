/** Unit tests for the hand (pan) tool, including double-click zoom. */
import { describe, expect, it, vi } from "vitest";
import { Camera } from "@/core/camera/Camera";
import { CameraController } from "@/core/camera/CameraController";
import { HandTool } from "@/interaction/HandTool";
import type { ToolPointerEvent } from "@/interaction/Tool";
import { vec2 } from "@/core/geometry/Vec2";

/**
 * Builds a normalised pointer payload for the tests.
 *
 * @param x - screen x.
 * @param y - screen y.
 * @param button - pointer button (0 = primary).
 * @returns the tool pointer event.
 */
function pointerAt(x: number, y: number, button = 0): ToolPointerEvent {
  return {
    screen: vec2(x, y),
    world: vec2(x, y),
    button,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
  };
}

describe("HandTool", () => {
  it("pans the camera by the drag delta since the press", () => {
    const camera = new Camera(0, 0, 1, 0);
    const controller = new CameraController(camera);
    const tool = new HandTool(controller);
    tool.onPointerDown(pointerAt(100, 100));
    tool.onPointerMove(pointerAt(140, 70));
    expect(camera.x).toBe(-40);
    expect(camera.y).toBe(30);
  });

  it("stops panning after pointer release", () => {
    const camera = new Camera(0, 0, 1, 0);
    const controller = new CameraController(camera);
    const tool = new HandTool(controller);
    tool.onPointerDown(pointerAt(0, 0));
    tool.onPointerUp(pointerAt(0, 0));
    tool.onPointerMove(pointerAt(50, 50));
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
  });

  it("onDoubleClick zooms in one step anchored at the click point", () => {
    const camera = new Camera(0, 0, 1, 0);
    const controller = new CameraController(camera);
    const tool = new HandTool(controller);
    tool.onDoubleClick(pointerAt(120, 60));
    expect(camera.zoom).toBe(2);
    // The world point under (120, 60) stays under (120, 60).
    const worldUnder = camera.screenToWorld(vec2(120, 60));
    const backOnScreen = camera.worldToScreen(worldUnder);
    expect(backOnScreen.x).toBeCloseTo(120, 5);
    expect(backOnScreen.y).toBeCloseTo(60, 5);
  });

  it("onDoubleClick cancels any open drag", () => {
    const camera = new Camera(0, 0, 1, 0);
    const controller = new CameraController(camera);
    const tool = new HandTool(controller);
    tool.onPointerDown(pointerAt(0, 0));
    tool.onDoubleClick(pointerAt(10, 10));
    const anchorAfterClick = { x: camera.x, y: camera.y };
    tool.onPointerMove(pointerAt(50, 50));
    // The move must not pan (the drag was cancelled by the double-click).
    expect(camera.x).toBe(anchorAfterClick.x);
    expect(camera.y).toBe(anchorAfterClick.y);
  });

  it("double-click zoom is clamped to MAX_ZOOM", () => {
    const camera = new Camera(0, 0, 40, 0);
    const controller = new CameraController(camera);
    const tool = new HandTool(controller);
    tool.onDoubleClick(pointerAt(5, 5));
    expect(camera.zoom).toBe(64);
  });

  it("notifies the change notifier through the controller", () => {
    const camera = new Camera(0, 0, 1, 0);
    const onChange = vi.fn();
    const controller = new CameraController(camera, onChange);
    const tool = new HandTool(controller);
    tool.onDoubleClick(pointerAt(10, 10));
    expect(onChange).toHaveBeenCalled();
  });
});
