/** Unit tests for the transient shape-draft overlay. */
import { describe, expect, it, vi } from "vitest";
import { ShapeOverlay } from "@/rendering/ShapeOverlay";
import {
  defaultShapeRect,
  normalizedRectFromDrag,
  shapeFromRect,
} from "@/core/model/ShapeObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { ShapeObjectData, ShapeStyle } from "@/core/model/ShapeObject";

/** Style fixture mirroring the tool's creation-time defaults. */
const STYLE: ShapeStyle = { fill: "accent", stroke: "primary", strokeWidth: 2 };

/** Builds a shape draft with the given size at a fixed position. */
function makeDraft(id: string, width: number, height: number): ShapeObjectData {
  return shapeFromRect(
    { position: vec2(10, 20), width, height },
    "rectangle",
    STYLE,
    id,
    7,
  );
}

describe("ShapeOverlay", () => {
  it("starts idle with no draft", () => {
    const overlay = new ShapeOverlay();
    expect(overlay.current).toBeNull();
    expect(overlay.isDrawing).toBe(false);
  });

  it("begin installs the draft and notifies exactly once", () => {
    const notify = vi.fn();
    const overlay = new ShapeOverlay();
    overlay.setNotifier(notify);
    const draft = makeDraft("shape-1", 0, 0);
    overlay.begin(draft);
    expect(overlay.current).toBe(draft);
    expect(overlay.isDrawing).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("update replaces the draft and notifies once per call", () => {
    const notify = vi.fn();
    const overlay = new ShapeOverlay();
    overlay.setNotifier(notify);
    overlay.begin(makeDraft("shape-1", 0, 0));
    notify.mockClear();
    const second = makeDraft("shape-1", 30, 20);
    overlay.update(second);
    expect(overlay.current).toBe(second);
    expect(notify).toHaveBeenCalledTimes(1);
    const third = makeDraft("shape-1", 45, 45);
    overlay.update(third);
    expect(overlay.current).toBe(third);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("update without a draft in progress is a no-op that never notifies", () => {
    const notify = vi.fn();
    const overlay = new ShapeOverlay();
    overlay.setNotifier(notify);
    overlay.update(makeDraft("shape-1", 30, 20));
    expect(overlay.current).toBeNull();
    expect(overlay.isDrawing).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("end returns the draft, clears the overlay and notifies once", () => {
    const notify = vi.fn();
    const overlay = new ShapeOverlay();
    overlay.setNotifier(notify);
    const draft = makeDraft("shape-1", 30, 20);
    overlay.begin(draft);
    notify.mockClear();
    expect(overlay.end()).toBe(draft);
    expect(overlay.current).toBeNull();
    expect(overlay.isDrawing).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("end without a draft in progress returns null but still notifies", () => {
    const notify = vi.fn();
    const overlay = new ShapeOverlay();
    overlay.setNotifier(notify);
    expect(overlay.end()).toBeNull();
    expect(overlay.current).toBeNull();
    expect(overlay.isDrawing).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("notifies exactly once per mutation across a full gesture", () => {
    const notify = vi.fn();
    const overlay = new ShapeOverlay();
    overlay.setNotifier(notify);
    overlay.begin(makeDraft("shape-1", 0, 0));
    expect(notify).toHaveBeenCalledTimes(1);
    overlay.update(makeDraft("shape-1", 30, 20));
    expect(notify).toHaveBeenCalledTimes(2);
    overlay.end();
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it("a second begin replaces the previous draft", () => {
    const notify = vi.fn();
    const overlay = new ShapeOverlay();
    overlay.setNotifier(notify);
    overlay.begin(makeDraft("shape-1", 0, 0));
    const second = makeDraft("shape-2", 10, 10);
    overlay.begin(second);
    expect(overlay.current).toBe(second);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("a second end returns null and still notifies", () => {
    const notify = vi.fn();
    const overlay = new ShapeOverlay();
    overlay.setNotifier(notify);
    overlay.begin(makeDraft("shape-1", 0, 0));
    overlay.end();
    notify.mockClear();
    expect(overlay.end()).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("mutates safely before a notifier is installed", () => {
    const overlay = new ShapeOverlay();
    overlay.begin(makeDraft("shape-1", 0, 0));
    overlay.update(makeDraft("shape-1", 30, 20));
    expect(overlay.end()).not.toBeNull();
    const notify = vi.fn();
    overlay.setNotifier(notify);
    overlay.begin(makeDraft("shape-2", 0, 0));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("swapping the notifier routes later mutations to the new callback only", () => {
    const first = vi.fn();
    const second = vi.fn();
    const overlay = new ShapeOverlay();
    overlay.setNotifier(first);
    overlay.begin(makeDraft("shape-1", 0, 0));
    overlay.setNotifier(second);
    overlay.update(makeDraft("shape-1", 30, 20));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("streams a realistic drag gesture from tap anchor to final rectangle", () => {
    const overlay = new ShapeOverlay();
    overlay.begin(
      shapeFromRect(
        defaultShapeRect(vec2(100, 120), 0),
        "ellipse",
        STYLE,
        "shape-1",
        7,
      ),
    );
    const dragged = shapeFromRect(
      normalizedRectFromDrag(vec2(100, 120), vec2(130, 90), true),
      "ellipse",
      STYLE,
      "shape-1",
      7,
    );
    overlay.update(dragged);
    const committed = overlay.end();
    if (committed === null) {
      throw new Error("expected the dragged draft");
    }
    expect(committed).toBe(dragged);
    expect(committed.shapeKind).toBe("ellipse");
    expect(committed.position).toEqual(vec2(100, 90));
    expect(committed.width).toBe(30);
    expect(committed.height).toBe(30);
    expect(overlay.current).toBeNull();
  });
});
