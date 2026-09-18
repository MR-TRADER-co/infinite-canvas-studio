/** Unit tests for the transient connector-draft overlay. */
import { describe, expect, it, vi } from "vitest";
import { ConnectorOverlay } from "@/rendering/ConnectorOverlay";
import { vec2 } from "@/core/geometry/Vec2";
import type { ConnectorDraft } from "@/rendering/ConnectorOverlay";
import type { ConnectorEndpoint } from "@/core/model/ConnectorObject";

/** Builds a floating endpoint fixture at a fixed position. */
function endpoint(x: number, y: number): ConnectorEndpoint {
  return { objectId: null, anchorIndex: 0, position: vec2(x, y) };
}

/** Builds a rubber-band draft between two floating endpoints. */
function makeDraft(x: number, y: number): ConnectorDraft {
  return {
    start: endpoint(0, 0),
    end: endpoint(x, y),
    style: {
      color: "primary",
      width: 2,
      dash: "solid",
      routing: "straight",
      startArrow: "none",
      endArrow: "arrow",
    },
  };
}

describe("ConnectorOverlay", () => {
  it("starts idle with no draft", () => {
    const overlay = new ConnectorOverlay();
    expect(overlay.current).toBeNull();
  });

  it("begin installs the draft and notifies exactly once", () => {
    const notify = vi.fn();
    const overlay = new ConnectorOverlay();
    overlay.setNotifier(notify);
    const draft = makeDraft(10, 20);
    overlay.begin(draft);
    expect(overlay.current).toBe(draft);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("update replaces the draft and notifies once per call", () => {
    const notify = vi.fn();
    const overlay = new ConnectorOverlay();
    overlay.setNotifier(notify);
    overlay.begin(makeDraft(0, 0));
    notify.mockClear();
    const second = makeDraft(30, 20);
    overlay.update(second);
    expect(overlay.current).toBe(second);
    expect(notify).toHaveBeenCalledTimes(1);
    const third = makeDraft(45, 45);
    overlay.update(third);
    expect(overlay.current).toBe(third);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("a second begin replaces the previous draft", () => {
    const notify = vi.fn();
    const overlay = new ConnectorOverlay();
    overlay.setNotifier(notify);
    overlay.begin(makeDraft(0, 0));
    const second = makeDraft(10, 10);
    overlay.begin(second);
    expect(overlay.current).toBe(second);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("end returns the draft, clears the overlay and notifies once", () => {
    const notify = vi.fn();
    const overlay = new ConnectorOverlay();
    overlay.setNotifier(notify);
    const draft = makeDraft(30, 20);
    overlay.begin(draft);
    notify.mockClear();
    expect(overlay.end()).toBe(draft);
    expect(overlay.current).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("end without a draft in progress returns null but still notifies", () => {
    const notify = vi.fn();
    const overlay = new ConnectorOverlay();
    overlay.setNotifier(notify);
    expect(overlay.end()).toBeNull();
    expect(overlay.current).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("a second end returns null and still notifies", () => {
    const notify = vi.fn();
    const overlay = new ConnectorOverlay();
    overlay.setNotifier(notify);
    overlay.begin(makeDraft(30, 20));
    overlay.end();
    notify.mockClear();
    expect(overlay.end()).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("notifies exactly once per mutation across a full gesture", () => {
    const notify = vi.fn();
    const overlay = new ConnectorOverlay();
    overlay.setNotifier(notify);
    overlay.begin(makeDraft(0, 0));
    overlay.update(makeDraft(30, 20));
    overlay.update(makeDraft(45, 45));
    overlay.end();
    expect(notify).toHaveBeenCalledTimes(4);
  });

  it("mutates safely before a notifier is installed", () => {
    const overlay = new ConnectorOverlay();
    overlay.begin(makeDraft(0, 0));
    overlay.update(makeDraft(30, 20));
    expect(overlay.end()).not.toBeNull();
    const notify = vi.fn();
    overlay.setNotifier(notify);
    overlay.begin(makeDraft(10, 10));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("swapping the notifier routes later mutations to the new callback only", () => {
    const first = vi.fn();
    const second = vi.fn();
    const overlay = new ConnectorOverlay();
    overlay.setNotifier(first);
    overlay.begin(makeDraft(0, 0));
    overlay.setNotifier(second);
    overlay.update(makeDraft(30, 20));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("streams a realistic rubber-band gesture from anchor to release", () => {
    const overlay = new ConnectorOverlay();
    overlay.begin(makeDraft(10, 0));
    const dragged = makeDraft(120, 60);
    overlay.update(dragged);
    const committed = overlay.end();
    if (committed === null) {
      throw new Error("expected the dragged draft");
    }
    expect(committed).toBe(dragged);
    expect(committed.end.position).toEqual(vec2(120, 60));
    expect(overlay.current).toBeNull();
  });
});
