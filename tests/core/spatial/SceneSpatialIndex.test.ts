/**
 * Scene spatial index tests (R7.10 "enable it"): the wrapper's incremental
 * sync (identity-keyed), the top-most-first candidate ordering, and the
 * marquee/hit-test result equivalence against the linear scan.
 */
import { describe, expect, it } from "vitest";
import { SceneSpatialIndex } from "@/core/spatial/SceneSpatialIndex";
import { RTreeSpatialIndex } from "@/core/spatial/RTreeSpatialIndex";
import { LinearSpatialIndex } from "@/core/spatial/LinearSpatialIndex";
import { hitTestTopMost } from "@/interaction/objectHitTest";
import { MarqueeLogic } from "@/interaction/MarqueeLogic";
import { Scene } from "@/core/model/Scene";
import { Selection } from "@/core/selection/Selection";
import { makeShape } from "../commands/fixtures";
import { vec2 } from "@/core/geometry/Vec2";
import { bbox } from "@/core/geometry/BBox";

/** Builds a scene with N staggered shapes. */
function makeScene(count: number): Scene {
  const scene = new Scene();
  for (let i = 0; i < count; i += 1) {
    scene.add(makeShape(`obj-${i}`, i * 10, i * 12, 40, 30));
  }
  return scene;
}

describe("SceneSpatialIndex (R7.10)", () => {
  it("syncs incrementally and returns top-most-first candidates", () => {
    const scene = makeScene(20);
    const index = new SceneSpatialIndex(scene, new RTreeSpatialIndex());
    const hits = index.objectsAt(vec2(105, 130), 10);
    expect(hits.length).toBeGreaterThan(0);
    // Top-most = highest paint index first.
    const positions = hits.map((object) =>
      scene.objects.findIndex((candidate) => candidate.id === object.id),
    );
    expect(positions).toEqual([...positions].sort((a, b) => b - a));
  });

  it("re-syncs after moves and removals (identity-keyed)", () => {
    const scene = makeScene(5);
    const index = new SceneSpatialIndex(scene, new RTreeSpatialIndex());
    expect(
      index.objectsIntersecting(bbox(0, 0, 10, 10)).map((o) => o.id),
    ).toContain("obj-0");
    scene.remove("obj-0");
    expect(index.objectsIntersecting(bbox(0, 0, 10, 10))).toHaveLength(0);
    scene.add({ ...makeShape("moved", 500, 500, 40, 30) });
    expect(index.objectsIntersecting(bbox(490, 490, 560, 560))).toHaveLength(1);
  });

  it("hit-test results equal the linear scan (with and without index)", () => {
    const scene = makeScene(30);
    const index = new SceneSpatialIndex(scene, new RTreeSpatialIndex());
    for (let probe = 0; probe < 60; probe += 1) {
      const point = vec2(probe * 11, probe * 7);
      const linear = hitTestTopMost(scene, point, 4);
      const indexed = hitTestTopMost(scene, point, 4, index);
      expect(indexed?.id).toBe(linear?.id);
    }
  });

  it("marquee selection equals the linear marquee", () => {
    const scene = makeScene(25);
    const index = new SceneSpatialIndex(scene, new RTreeSpatialIndex());
    const linearMarquee = new MarqueeLogic(scene);
    const indexedMarquee = new MarqueeLogic(scene, index);
    void new Selection();
    for (const rect of [
      bbox(0, 0, 120, 140),
      bbox(100, 100, 130, 130),
      bbox(0, 0, 400, 400),
    ]) {
      linearMarquee.begin(vec2(rect.minX, rect.minY));
      linearMarquee.update(vec2(rect.maxX, rect.maxY));
      indexedMarquee.begin(vec2(rect.minX, rect.minY));
      indexedMarquee.update(vec2(rect.maxX, rect.maxY));
      expect([...indexedMarquee.end()].sort()).toEqual(
        [...linearMarquee.end()].sort(),
      );
    }
  });

  it("the R-tree and linear backends answer identically through the wrapper", () => {
    const scene = makeScene(40);
    const rtree = new SceneSpatialIndex(scene, new RTreeSpatialIndex());
    const linear = new SceneSpatialIndex(scene, new LinearSpatialIndex());
    for (let probe = 0; probe < 40; probe += 1) {
      const rect = bbox(probe * 17, probe * 3, probe * 17 + 90, probe * 3 + 60);
      const a = rtree
        .objectsIntersecting(rect)
        .map((object) => object.id)
        .sort();
      const b = linear
        .objectsIntersecting(rect)
        .map((object) => object.id)
        .sort();
      expect(a).toEqual(b);
    }
  });
});
