// @vitest-environment jsdom
/**
 * Unit tests for the فاز-۳۴ «زمان صفر» commit contract: every image the
 * import pipeline places carries the EXACT insert-time snapshot (placed
 * size + position, post-cascade/post-snap) inside itself, the natural
 * size stays the ORIGINAL intrinsic size, and ONE undo removes it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  insertDecodedImage,
  resetPasteCascade,
  type DecodedImage,
} from "@/ui/clipboard/canvasImport";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { Selection } from "@/core/selection/Selection";
import { Scene } from "@/core/model/Scene";
import { EventBus } from "@/core/events/EventBus";
import { useUiStore } from "@/ui/store/uiStore";
import { isImageObject } from "@/core/model/ImageObject";

/** A decoded 2200×1400 photo — ABOVE the old 1600 import cap. */
const PHOTO: DecodedImage = {
  src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  width: 2200,
  height: 1400,
};

/** Builds a fresh service bundle per test. */
function makeServices() {
  const scene = new Scene();
  return {
    scene,
    history: new HistoryManager(),
    selection: new Selection(),
    ids: new IdGenerator(),
    bus: new EventBus(),
  };
}

beforeEach(() => {
  resetPasteCascade();
  const state = useUiStore.getState();
  state.setSnapEnabled(false);
});

describe("insertDecodedImage «زمان صفر» snapshot (فاز ۳۴)", () => {
  it("keeps the ORIGINAL intrinsic size and snapshots the placed state", () => {
    const services = makeServices();
    // A 1000×700 viewport at zoom 1 → visibleSpan 700 → the placed size
    // clamps to 45% of 700 = 315 on the longest edge.
    const ok = insertDecodedImage(services, PHOTO, {
      width: 1000,
      height: 700,
    });
    expect(ok).toBe(true);
    const object = services.scene.objects[0] ?? null;
    expect(object).not.toBeNull();
    if (object === null || !isImageObject(object)) {
      return;
    }
    // Original quality: the intrinsic size IS the source's size.
    expect(object.naturalWidth).toBe(2200);
    expect(object.naturalHeight).toBe(1400);
    // The placed size clamped to the viewport span (height rounded).
    expect(object.width).toBe(315);
    expect(object.height).toBe(200);
    // The «زمان صفر» snapshot matches the placed state EXACTLY.
    expect(object.initial).toEqual({
      width: object.width,
      height: object.height,
      x: object.position.x,
      y: object.position.y,
      rotation: 0,
    });
    expect(services.selection.ids.has(object.id)).toBe(true);
  });

  it("captures the CASCADE-shifted position when a burst streams in", () => {
    const services = makeServices();
    insertDecodedImage(services, PHOTO, { width: 1000, height: 700 });
    insertDecodedImage(services, PHOTO, { width: 1000, height: 700 });
    const objects = services.scene.objects.filter(isImageObject);
    expect(objects).toHaveLength(2);
    const second = objects[1];
    expect(second).toBeDefined();
    if (second === undefined) {
      return;
    }
    // The snapshot remembers the cascaded (time-zero) position — the
    // reset-to-insert returns THERE, not to the first image's spot.
    expect(second.initial?.x).toBe(second.position.x);
    expect(second.initial?.y).toBe(second.position.y);
    expect(second.initial?.x).toBeGreaterThan(objects[0]!.initial!.x);
  });

  it("removes with ONE undo step", () => {
    const services = makeServices();
    insertDecodedImage(services, PHOTO, { width: 1000, height: 700 });
    expect(services.scene.objectCount).toBe(1);
    services.history.undo();
    expect(services.scene.objectCount).toBe(0);
  });
});
