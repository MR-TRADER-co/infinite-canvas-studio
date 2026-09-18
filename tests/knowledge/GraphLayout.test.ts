/**
 * Knowledge-graph layout tests (R15.1): the PURE deterministic radial
 * layout — node coverage, degree ranking, ghost nodes for broken links,
 * edge dedupe, bounds and determinism.
 */
import { describe, expect, it } from "vitest";
import { buildKnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import { layoutKnowledgeGraph } from "@/core/knowledge/GraphLayout";
import { vec2 } from "@/core/geometry/Vec2";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";

/** Builds a plain-text text-box fixture. */
function textBox(id: string, text: string, name?: string): TextBoxObjectData {
  return {
    id,
    kind: "textBox",
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    width: 200,
    height: 60,
    text,
    doc: null,
    sizeMode: "fixed",
    fontSize: 20,
    color: "token://text",
    ...(name === undefined ? {} : { name }),
  };
}

describe("GraphLayout (R15.1)", () => {
  it("returns an empty layout for a knowledge-less scene", () => {
    const layout = layoutKnowledgeGraph(buildKnowledgeIndex([]), 224, 168);
    expect(layout.empty).toBe(true);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
  });

  it("places one node per title, all inside the canvas bounds", () => {
    const index = buildKnowledgeIndex([
      textBox("a", "متن", "عنوان الف"),
      textBox("b", "متن", "عنوان ب"),
      textBox("c", "متن", "عنوان ج"),
    ]);
    const layout = layoutKnowledgeGraph(index, 224, 168);
    expect(layout.empty).toBe(false);
    expect(layout.nodes).toHaveLength(3);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(224);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(168);
      expect(node.ghost).toBe(false);
      expect(node.objectIds.length).toBeGreaterThan(0);
    }
    const keys = layout.nodes.map((node) => node.key).sort();
    expect(keys).toEqual(["عنوان الف", "عنوان ب", "عنوان ج"].sort());
  });

  it("emits directed edges for resolved links and ghosts for broken ones", () => {
    const index = buildKnowledgeIndex([
      textBox("a", "به [[عنوان ب]] رجوع کن", "عنوان الف"),
      textBox("b", "متن", "عنوان ب"),
      textBox("c", "به [[نیست]] رجوع کن", "عنوان ج"),
    ]);
    const layout = layoutKnowledgeGraph(index, 300, 200);
    const real = layout.nodes.filter((node) => !node.ghost);
    const ghosts = layout.nodes.filter((node) => node.ghost);
    expect(real.map((node) => node.display).sort()).toEqual(
      ["عنوان الف", "عنوان ب", "عنوان ج"].sort(),
    );
    expect(ghosts.map((node) => node.display)).toEqual(["نیست"]);
    expect(layout.edges).toContainEqual({
      fromKey: "عنوان الف",
      toKey: "عنوان ب",
      broken: false,
    });
    expect(layout.edges).toContainEqual({
      fromKey: "عنوان ج",
      toKey: "نیست",
      broken: true,
    });
  });

  it("ranks the busiest node at the centre (degree sizing)", () => {
    const index = buildKnowledgeIndex([
      textBox("hub", "محتوا", "هاب"),
      textBox("a", "به [[هاب]]", "الف"),
      textBox("b", "به [[هاب]]", "ب"),
      textBox("c", "به [[هاب]]", "ج"),
    ]);
    const layout = layoutKnowledgeGraph(index, 300, 200);
    const hub = layout.nodes.find((node) => node.display === "هاب");
    expect(hub).toBeDefined();
    expect(hub?.x).toBe(150);
    expect(hub?.y).toBe(100);
    expect(hub?.degree).toBe(3);
    // Hub is the largest node of all.
    for (const node of layout.nodes) {
      expect(node.r).toBeLessThanOrEqual(hub?.r ?? 0);
    }
  });

  it("dedupes parallel edges between the same pair", () => {
    const index = buildKnowledgeIndex([
      textBox("a", "[[ب]] و باز [[ب]]", "الف"),
      textBox("b", "متن", "ب"),
    ]);
    const layout = layoutKnowledgeGraph(index, 200, 200);
    expect(layout.edges).toHaveLength(1);
  });

  it("is deterministic — two runs produce the identical layout", () => {
    const index = buildKnowledgeIndex([
      textBox("a", "به [[ب]] و [[گمشده]]", "الف"),
      textBox("b", "به [[الف]]", "ب"),
      textBox("c", "#برچسب", "ج"),
    ]);
    const first = layoutKnowledgeGraph(index, 260, 180);
    const second = layoutKnowledgeGraph(index, 260, 180);
    expect(second).toEqual(first);
  });

  it("lays out a scene whose only link is broken (real + ghost nodes)", () => {
    const index = buildKnowledgeIndex([textBox("a", "تنها [[یک گمشده]]")]);
    const layout = layoutKnowledgeGraph(index, 200, 160);
    expect(layout.empty).toBe(false);
    // The source's fallback title («تنها») is a real node; the target ghosts.
    const reals = layout.nodes.filter((node) => !node.ghost);
    const ghosts = layout.nodes.filter((node) => node.ghost);
    expect(reals.map((node) => node.display)).toEqual(["تنها"]);
    expect(ghosts.map((node) => node.display)).toEqual(["یک گمشده"]);
    expect(layout.edges).toEqual([
      { fromKey: "تنها", toKey: "یک گمشده", broken: true },
    ]);
  });
});
