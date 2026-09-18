/**
 * Unit tests for the فاز-۲۴ selection rasterisation wiring (the pure
 * parts): the subset scene contains EXACTLY the selection (groups ride
 * with their members, paint order preserved) and the rasterisation
 * decision table (multi-object → image; single image/text → their own
 * legacy paths; lone non-text objects → image). The async raster itself
 * needs the browser canvas stack — it degrades to null in pure node.
 */
import { describe, expect, it } from "vitest";
import {
  buildSelectionSubsetScene,
  rasterizeSceneToPngBlob,
  shouldRasterizeSelection,
} from "@/ui/clipboard/selectionRaster";
import { Scene } from "@/core/model/Scene";
import { makeGroup } from "@/core/model/GroupObject";
import { textBoxFromRect } from "@/core/model/TextBoxObject";
import { makeStickerObject } from "@/core/model/StickerObject";
import { createImageObject } from "@/core/model/ImageObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** A 2×2 white PNG data URL (decode stub — never decoded in these tests). */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR4nGP8z8Dwn4GBgYGJgQoAAs0JTwD5+K8AAAAASUVORK5CYII=";

/** Builds a one-pixel image object fixture. */
function makeImage(id: string, x: number, y: number): SceneObjectData {
  return createImageObject(
    id,
    TINY_PNG,
    { width: 4, height: 4 },
    vec2(x, y),
    { width: 40, height: 40 },
    5,
  );
}

/** Builds a populated scene: two text boxes, a sticker, an image, a group. */
function makeScene(): {
  readonly scene: Scene;
  readonly firstText: SceneObjectData;
  readonly secondText: SceneObjectData;
  readonly sticker: SceneObjectData;
  readonly image: SceneObjectData;
  readonly groupId: string;
} {
  const scene = new Scene();
  const firstText = textBoxFromRect(
    { minX: 0, minY: 0, maxX: 260, maxY: 64 },
    "اول",
    16,
    "text-1",
    0,
  );
  const secondText = textBoxFromRect(
    { minX: 300, minY: 0, maxX: 560, maxY: 64 },
    "دوم",
    16,
    "text-2",
    1,
  );
  const sticker = makeStickerObject("sticker-1", "🚀", vec2(600, 10), 64, 2);
  const image = makeImage("image-1", 700, 10);
  const group = makeGroup("group-1", [firstText, sticker], 3);
  scene.add(firstText);
  scene.add(secondText);
  scene.add(sticker);
  scene.add(image);
  scene.add(group);
  return { scene, firstText, secondText, sticker, image, groupId: group.id };
}

describe("buildSelectionSubsetScene", () => {
  it("is empty for an empty or unknown id list", () => {
    const { scene } = makeScene();
    expect(buildSelectionSubsetScene(scene, []).objectCount).toBe(0);
    expect(buildSelectionSubsetScene(scene, ["nope"]).objectCount).toBe(0);
  });

  it("contains exactly the selected top-level objects in paint order", () => {
    const { scene, secondText, image } = makeScene();
    const subset = buildSelectionSubsetScene(scene, [image.id, secondText.id]);
    expect(subset.objectCount).toBe(2);
    expect(subset.objects.map((object) => object.id)).toEqual([
      secondText.id,
      image.id,
    ]);
  });

  it("expands a selected group into the group + its members", () => {
    const { scene, groupId, firstText, sticker } = makeScene();
    const subset = buildSelectionSubsetScene(scene, [groupId]);
    // The internal clipboard's contract: the group rides WITH its members.
    expect(subset.objectCount).toBe(3);
    expect(subset.objects.map((object) => object.id)).toEqual([
      firstText.id,
      sticker.id,
      groupId,
    ]);
  });

  it("never includes bystanders that merely overlap the frame", () => {
    const { scene, secondText } = makeScene();
    const subset = buildSelectionSubsetScene(scene, [secondText.id]);
    expect(subset.findById(secondText.id)).toBeDefined();
    expect(subset.objectCount).toBe(1);
  });

  it("joins PINNED objects as UNPINNED clones (فاز ۲۸ — a snapshot is world-space)", () => {
    const { scene, sticker } = makeScene();
    const pinned = {
      ...sticker,
      pinned: true,
      pinAnchor: vec2(0.4, 0.3),
    } as typeof sticker;
    scene.remove(sticker.id);
    scene.add(pinned);
    const subset = buildSelectionSubsetScene(scene, [pinned.id]);
    const joined = subset.findById(pinned.id);
    expect(joined).toBeDefined();
    expect(joined?.pinned).not.toBe(true);
    expect((joined as { pinAnchor?: unknown }).pinAnchor).toBeUndefined();
    // The stored world position is kept — exactly where the object drops
    // on unpin (no stale-screen ghost, no pin chrome in the snapshot).
    expect(joined?.position.x).toBe(pinned.position.x);
    // The parent scene's object is untouched (clone, not mutation).
    expect(scene.findById(pinned.id)?.pinned).toBe(true);
  });
});

describe("shouldRasterizeSelection", () => {
  it("returns false for an empty selection", () => {
    expect(shouldRasterizeSelection([])).toBe(false);
  });

  it("keeps the Phase-23 paths: single image and single text object", () => {
    const { scene, image, firstText } = makeScene();
    expect(shouldRasterizeSelection([image])).toBe(false);
    expect(shouldRasterizeSelection([firstText])).toBe(false);
    void scene;
  });

  it("rasterises multi-object selections (even all-text clusters)", () => {
    const { firstText, secondText } = makeScene();
    expect(shouldRasterizeSelection([firstText, secondText])).toBe(true);
  });

  it("rasterises a lone non-text, non-image object", () => {
    const { sticker } = makeScene();
    expect(shouldRasterizeSelection([sticker])).toBe(true);
  });
});

describe("rasterizeSceneToPngBlob", () => {
  it("degrades to null in a DOM-less runtime", async () => {
    const { scene } = makeScene();
    const blob = await rasterizeSceneToPngBlob(buildSelectionSubsetScene(scene, []));
    expect(blob).toBeNull();
  });
});
