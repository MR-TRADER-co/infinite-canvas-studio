/**
 * Knowledge-edge overlay model tests (pack R12.4): the pure projection
 * (dedupe, self-edge drop, broken stubs) and the deterministic stub
 * geometry.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_KNOWLEDGE_EDGES,
  brokenEdgeAngle,
  brokenStubEnd,
  buildKnowledgeEdges,
} from "@/rendering/KnowledgeEdgeOverlay";
import { buildKnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import { vec2 } from "@/core/geometry/Vec2";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";

/** Builds a text-box fixture. */
function note(id: string, text: string): TextBoxObjectData {
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
  };
}

describe("buildKnowledgeEdges", () => {
  it("projects resolved links to (source, target) pairs", () => {
    const index = buildKnowledgeIndex([
      note("a", "رفتن به [[مقصد]]"),
      note("b", "مقصد"),
    ]);
    const edges = buildKnowledgeEdges(index);
    expect(edges).toEqual([{ sourceId: "a", targetId: "b" }]);
  });

  it("drops self-edges", () => {
    // A note NAMED x linking to [[x]] resolves to itself — dropped.
    const index = buildKnowledgeIndex([
      { ...note("a", "خود ارجاع [[x]]"), name: "x" },
    ]);
    const edges = buildKnowledgeEdges(index);
    expect(edges).toEqual([]);
  });

  it("projects broken links as stubs carrying the display title", () => {
    const index = buildKnowledgeIndex([note("a", "پیوند به [[سرگردان]]")]);
    const edges = buildKnowledgeEdges(index);
    expect(edges.length).toBe(1);
    expect(edges[0]?.sourceId).toBe("a");
    expect(edges[0]?.targetId).toBeUndefined();
    expect(edges[0]?.brokenKey).toBe("سرگردان");
    expect(edges[0]?.brokenDisplay).toBe("سرگردان");
  });

  it("dedupes repeated pairs", () => {
    const index = buildKnowledgeIndex([
      note("a", "یک [[مقصد]] و دو [[مقصد]]"),
      note("b", "مقصد"),
    ]);
    const edges = buildKnowledgeEdges(index);
    expect(edges.length).toBe(1);
  });

  it("keeps both directions of a reciprocal pair", () => {
    const index = buildKnowledgeIndex([
      note("a", "به [[b]]"),
      note("b", "به [[a]]"),
    ]);
    const edges = buildKnowledgeEdges(index);
    expect(edges.length).toBe(2);
  });

  it("caps dense graphs deterministically", () => {
    const notes: TextBoxObjectData[] = [];
    for (let i = 0; i < 90; i += 1) {
      // Each note links to 6 successors → 540 raw edges.
      const targets = [1, 2, 3, 4, 5, 6]
        .map((offset) => `[[گروه ${i + offset}]]`)
        .join(" و ");
      notes.push(note(`n${i}`, `گروه ${i} — ${targets}`));
    }
    const index = buildKnowledgeIndex(notes);
    const edges = buildKnowledgeEdges(index);
    expect(edges.length).toBe(MAX_KNOWLEDGE_EDGES);
    const again = buildKnowledgeEdges(index);
    expect(again).toEqual(edges);
  });
});

describe("brokenStubEnd", () => {
  it("is deterministic per key", () => {
    const first = brokenStubEnd(vec2(0, 0), 150, "کلید");
    const second = brokenStubEnd(vec2(0, 0), 150, "کلید");
    expect(first).toEqual(second);
  });

  it("differs per key", () => {
    const a = brokenStubEnd(vec2(0, 0), 150, "کلید الف");
    const b = brokenStubEnd(vec2(0, 0), 150, "کلید ب");
    expect(a).not.toEqual(b);
  });

  it("reaches beyond the source box from the centre", () => {
    const centre = vec2(100, 100);
    const end = brokenStubEnd(centre, 150, "کلید");
    const distance = Math.hypot(end.x - centre.x, end.y - centre.y);
    expect(distance).toBeGreaterThanOrEqual(150);
    expect(distance).toBeLessThan(150 + 60 + 1);
  });

  it("angles stay in [0, 2π)", () => {
    for (const key of ["الف", "ب", "c", "کلید بسیار طولانی تر"]) {
      const angle = brokenEdgeAngle(key);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(Math.PI * 2);
    }
  });
});
