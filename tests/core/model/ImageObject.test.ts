/**
 * Unit tests for the image object contract: the factory assembles valid
 * scene data, the guard narrows the kind, placement sizing clamps to the
 * allowed span, and objects round-trip through the project serializer
 * (autosave + `.icb`) with their source and name intact.
 */
import { describe, expect, it } from "vitest";
import {
  createImageObject,
  isImageObject,
  placedImageSize,
} from "@/core/model/ImageObject";
import { objectBBox, rotatedObjectBBox } from "@/core/model/SceneObject";
import {
  buildProjectData,
  applyProjectData,
  validateProjectData,
} from "@/persistence/ProjectFile";
import { VersionedSerializer } from "@/persistence/VersionedSerializer";
import { Scene } from "@/core/model/Scene";
import { vec2 } from "@/core/geometry/Vec2";

/** Shared inline PNG-ish data URL fixture. */
const SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("createImageObject", () => {
  it("assembles a visible unlocked image with the placed size", () => {
    const object = createImageObject(
      "img-1",
      SRC,
      { width: 800, height: 600 },
      vec2(10, 20),
      { width: 400, height: 300 },
      7,
    );
    expect(object.kind).toBe("image");
    expect(object.id).toBe("img-1");
    expect(object.src).toBe(SRC);
    expect(object.naturalWidth).toBe(800);
    expect(object.naturalHeight).toBe(600);
    expect(object.width).toBe(400);
    expect(object.height).toBe(300);
    expect(object.position).toEqual(vec2(10, 20));
    expect(object.rotation).toBe(0);
    expect(object.zIndex).toBe(7);
    expect(object.visible).toBe(true);
    expect(object.locked).toBe(false);
    expect(isImageObject(object)).toBe(true);
  });

  it("defaults the placed size to the intrinsic size", () => {
    const object = createImageObject(
      "img-2",
      SRC,
      { width: 64, height: 48 },
      vec2(0, 0),
    );
    expect(object.width).toBe(64);
    expect(object.height).toBe(48);
  });

  it("never produces a degenerate (zero) placed size", () => {
    const object = createImageObject(
      "img-3",
      SRC,
      { width: 0, height: 0 },
      vec2(0, 0),
      {
        width: 0,
        height: 0,
      },
    );
    expect(object.width).toBeGreaterThanOrEqual(1);
    expect(object.height).toBeGreaterThanOrEqual(1);
  });

  it("bounds its bbox from position + placed size", () => {
    const object = createImageObject(
      "img-4",
      SRC,
      { width: 100, height: 50 },
      vec2(5, 8),
      {
        width: 200,
        height: 100,
      },
    );
    expect(objectBBox(object)).toEqual({
      minX: 5,
      minY: 8,
      maxX: 205,
      maxY: 108,
    });
  });

  it("covers the rotated footprint for the badge/cull geometry", () => {
    const object = {
      ...createImageObject(
        "img-5",
        SRC,
        { width: 100, height: 100 },
        vec2(0, 0),
        {
          width: 100,
          height: 100,
        },
      ),
      rotation: Math.PI / 4,
    };
    const box = rotatedObjectBBox(object);
    const halfDiagonal = (100 * Math.SQRT2) / 2;
    expect(box.maxX - box.minX).toBeCloseTo(halfDiagonal * 2, 5);
    expect(box.maxY - box.minY).toBeCloseTo(halfDiagonal * 2, 5);
  });
});

describe("placedImageSize", () => {
  it("keeps small images at 1:1", () => {
    expect(placedImageSize({ width: 300, height: 200 }, 600)).toEqual({
      width: 300,
      height: 200,
    });
  });

  it("clamps the longest edge to the span while preserving the aspect", () => {
    const placed = placedImageSize({ width: 1200, height: 800 }, 600);
    expect(placed.width).toBe(600);
    expect(placed.height).toBeCloseTo(400, 5);
    const portrait = placedImageSize({ width: 600, height: 1800 }, 600);
    expect(portrait.height).toBe(600);
    expect(portrait.width).toBeCloseTo(200, 5);
  });

  it("degenerates gracefully on zero-sized sources", () => {
    expect(placedImageSize({ width: 0, height: 0 }, 600)).toEqual({
      width: 0,
      height: 0,
    });
  });
});

describe("image persistence round-trip", () => {
  it("survives serialize → deserialize with source, size and name", () => {
    const scene = new Scene();
    const named = {
      ...createImageObject(
        "img-9",
        SRC,
        { width: 64, height: 48 },
        vec2(12, 34),
        { width: 128, height: 96 },
        0,
      ),
      name: "عکس تختگاه",
    };
    scene.add(named);

    const serializer = new VersionedSerializer();
    const raw = serializer.serialize(buildProjectData(scene));
    const outcome = serializer.deserialize(raw);

    expect(outcome?.status).toBe("ok");
    const restored = outcome?.status === "ok" ? outcome.data : null;
    expect(restored).not.toBeNull();
    expect(validateProjectData(restored)).toBe(true);

    const target = new Scene();
    applyProjectData(target, restored!);
    const loaded = target.findById("img-9");
    expect(loaded).toBeDefined();
    expect(isImageObject(loaded!)).toBe(true);
    if (isImageObject(loaded!)) {
      expect(loaded.src).toBe(SRC);
      expect(loaded.naturalWidth).toBe(64);
      expect(loaded.naturalHeight).toBe(48);
      expect(loaded.width).toBe(128);
      expect(loaded.height).toBe(96);
    }
    expect(loaded!.name).toBe("عکس تختگاه");
  });
});

describe("createImageObject «زمان صفر» snapshot (فاز ۳۴)", () => {
  it("captures the exact placed size and position at insert", () => {
    const object = createImageObject(
      "img-t0",
      SRC,
      { width: 2200, height: 1400 },
      vec2(312, 96),
      { width: 480, height: 305 },
      3,
    );
    expect(object.initial).toEqual({
      width: 480,
      height: 305,
      x: 312,
      y: 96,
      rotation: 0,
    });
    // The natural size stays the ORIGINAL intrinsic size (quality proof).
    expect(object.naturalWidth).toBe(2200);
    expect(object.naturalHeight).toBe(1400);
  });

  it("defaults the snapshot to the intrinsic placement", () => {
    const object = createImageObject(
      "img-t1",
      SRC,
      { width: 64, height: 48 },
      vec2(10, 20),
    );
    expect(object.initial).toEqual({
      width: 64,
      height: 48,
      x: 10,
      y: 20,
      rotation: 0,
    });
  });
});

describe("image persistence «زمان صفر» round-trip (فاز ۳۴)", () => {
  it("survives serialize → deserialize WITH the insert snapshot", () => {
    const scene = new Scene();
    scene.add(
      createImageObject(
        "img-rt",
        SRC,
        { width: 2200, height: 1400 },
        vec2(312, 96),
        { width: 480, height: 305 },
        0,
      ),
    );
    const serializer = new VersionedSerializer();
    const raw = serializer.serialize(buildProjectData(scene));
    const outcome = serializer.deserialize(raw);
    expect(outcome?.status).toBe("ok");
    const restored = outcome?.status === "ok" ? outcome.data : null;
    expect(restored).not.toBeNull();

    const target = new Scene();
    applyProjectData(target, restored!);
    const loaded = target.findById("img-rt");
    expect(isImageObject(loaded!)).toBe(true);
    if (isImageObject(loaded!)) {
      expect(loaded.initial).toEqual({
        width: 480,
        height: 305,
        x: 312,
        y: 96,
        rotation: 0,
      });
    }
  });

  it("tolerates LEGACY payloads without a snapshot (pre-1.41.0 scenes)", () => {
    const scene = new Scene();
    scene.add(
      createImageObject(
        "img-legacy",
        SRC,
        { width: 800, height: 600 },
        vec2(12, 34),
        { width: 400, height: 300 },
        0,
      ),
    );
    const serializer = new VersionedSerializer();
    const raw = serializer.serialize(buildProjectData(scene));
    // Strip `initial` from every image object — the legacy wire shape.
    const parsed = JSON.parse(raw) as {
      scene?: { objects?: Array<Record<string, unknown>> };
    };
    for (const object of parsed.scene?.objects ?? []) {
      delete object.initial;
    }
    const outcome = serializer.deserialize(JSON.stringify(parsed));
    expect(outcome?.status).toBe("ok");
    const restored = outcome?.status === "ok" ? outcome.data : null;
    expect(restored).not.toBeNull();

    const target = new Scene();
    applyProjectData(target, restored!);
    const loaded = target.findById("img-legacy");
    expect(isImageObject(loaded!)).toBe(true);
    if (isImageObject(loaded!)) {
      // Loads fine WITHOUT the snapshot — the insert-reset degrades to
      // the natural-size reset semantics instead of refusing the object.
      expect(loaded.initial).toBeUndefined();
      expect(loaded.width).toBe(400);
    }
  });

  it("drops a MALFORMED snapshot without refusing the image", () => {
    const scene = new Scene();
    scene.add(
      createImageObject(
        "img-bad",
        SRC,
        { width: 800, height: 600 },
        vec2(0, 0),
        { width: 400, height: 300 },
        0,
      ),
    );
    const serializer = new VersionedSerializer();
    const raw = serializer.serialize(buildProjectData(scene));
    const parsed = JSON.parse(raw) as {
      scene?: { objects?: Array<Record<string, unknown>> };
    };
    for (const object of parsed.scene?.objects ?? []) {
      // The wire shape strips `kind`; the malformed snapshot lands on the
      // single image object regardless.
      object.initial = { width: "wide", height: 0, x: 1, y: 1, rotation: 0 };
    }
    const outcome = serializer.deserialize(JSON.stringify(parsed));
    expect(outcome?.status).toBe("ok");
    const restored = outcome?.status === "ok" ? outcome.data : null;
    expect(restored).not.toBeNull();
    const target = new Scene();
    applyProjectData(target, restored!);
    const loaded = target.findById("img-bad");
    expect(isImageObject(loaded!)).toBe(true);
    if (isImageObject(loaded!)) {
      expect(loaded.initial).toBeUndefined();
      expect(loaded.src).toBe(SRC);
    }
  });
});
