/**
 * Graph-arrange tests (pack R12.3): eligibility, determinism, spring
 * convergence, multi-object title clusters, and the exclusion rules
 * (locked / grouped / auto-layout-framed members never move).
 */
import { describe, expect, it } from "vitest";
import {
  graphArrangeEligible,
  planGraphArrange,
} from "@/core/knowledge/GraphArrange";
import { buildKnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import { vec2 } from "@/core/geometry/Vec2";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import { EMPTY_KNOWLEDGE_INDEX } from "@/core/knowledge/KnowledgeIndex";

/** Builds a text-box fixture at a position with optional extras. */
function note(
  id: string,
  text: string,
  x = 0,
  y = 0,
  extra: Partial<TextBoxObjectData> = {},
): TextBoxObjectData {
  return {
    id,
    kind: "textBox",
    position: vec2(x, y),
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
    ...extra,
  };
}

describe("graphArrangeEligible", () => {
  it("refuses empty indexes", () => {
    expect(graphArrangeEligible(EMPTY_KNOWLEDGE_INDEX)).toBe(false);
  });

  it("refuses unlinked titles", () => {
    const index = buildKnowledgeIndex([note("a", "اول"), note("b", "دوم")]);
    expect(graphArrangeEligible(index)).toBe(false);
  });

  it("accepts two linked titles", () => {
    const index = buildKnowledgeIndex([
      note("a", "رجوع به [[دوم]]"),
      note("b", "دوم"),
    ]);
    expect(graphArrangeEligible(index)).toBe(true);
  });
});

describe("planGraphArrange", () => {
  it("returns null when nothing is arrangeable", () => {
    expect(
      planGraphArrange([note("a", "تنها")], buildKnowledgeIndex([note("a", "تنها")])),
    ).toBeNull();
  });

  it("moves every movable member of a linked pair near the spring length", () => {
    const objects = [
      note("a", "سرچشمه", 0, 0),
      note("b", "مقصد", 10, 0),
    ];
    const index = buildKnowledgeIndex([
      note("a", "پیوند به [[مقصد]]"),
      note("b", "مقصد"),
    ]);
    const plan = planGraphArrange(objects, index);
    expect(plan).not.toBeNull();
    expect(plan?.moves.length).toBe(2);
    const deltaOf = (id: string) =>
      plan?.moves.find((move) => move.id === id)?.delta;
    const a = deltaOf("a");
    const b = deltaOf("b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) {
      return;
    }
    // End positions: seed + delta.
    const ax = 0 + a.x;
    const ay = 0 + a.y;
    const bx = 10 + b.x;
    const by = 0 + b.y;
    const distance = Math.hypot(bx - ax, by - ay);
    // The spring settles near the ideal length (460 default) — allow a
    // generous band (gravity + cooling leave residual error).
    expect(distance).toBeGreaterThan(200);
    expect(distance).toBeLessThan(900);
  });

  it("is deterministic — the same scene plans identical moves", () => {
    const objects = [
      note("a", "پیوند به [[میانه]]", 0, 0),
      note("b", "میانه — پیوند به [[پایان]]", 400, 100),
      note("c", "پایان", -200, 300),
    ];
    const index = buildKnowledgeIndex(objects);
    const first = planGraphArrange(objects, index);
    const second = planGraphArrange(objects, index);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.moves).toEqual(second?.moves);
  });

  it("clusters the members of a shared title around one node", () => {
    const objects = [
      note("a", "رفتن به [[مشترک]]", 0, 0),
      note("b1", "مشترک", 500, 0),
      note("b2", "مشترک", 900, 400),
    ];
    const index = buildKnowledgeIndex(objects);
    const plan = planGraphArrange(objects, index, { clusterGap: 36 });
    expect(plan).not.toBeNull();
    const centres = new Map<string, { x: number; y: number }>();
    for (const move of plan?.moves ?? []) {
      const object = objects.find((item) => item.id === move.id);
      if (object === undefined) {
        continue;
      }
      centres.set(move.id, {
        x: object.position.x + move.delta.x + 100,
        y: object.position.y + move.delta.y + 30,
      });
    }
    const b1 = centres.get("b1");
    const b2 = centres.get("b2");
    expect(b1).toBeDefined();
    expect(b2).toBeDefined();
    if (b1 === undefined || b2 === undefined) {
      return;
    }
    // Same cluster: the two members stay within a few object-widths.
    const spread = Math.hypot(b2.x - b1.x, b2.y - b1.y);
    expect(spread).toBeLessThan(600);
  });

  it("never moves locked members", () => {
    const objects = [
      note("a", "پیوند به [[قفل]]", 0, 0),
      note("b", "قفل", 300, 0, { locked: true }),
    ];
    const index = buildKnowledgeIndex(objects);
    const plan = planGraphArrange(objects, index);
    expect(plan).not.toBeNull();
    expect(plan?.moves.some((move) => move.id === "b")).toBe(false);
    expect(plan?.skipped).toBe(1);
  });

  it("never moves group members", () => {
    const objects = [
      note("a", "پیوند به [[گروهی]]", 0, 0),
      note("b", "گروهی", 300, 0, {
        groupId: "group-1",
      } as Partial<TextBoxObjectData>),
    ];
    const index = buildKnowledgeIndex(objects);
    const plan = planGraphArrange(objects, index);
    expect(plan).not.toBeNull();
    expect(plan?.moves.some((move) => move.id === "b")).toBe(false);
  });

  it("spreads a degenerate pile (all objects at one point)", () => {
    const objects = [
      note("a", "پیوند به [[x]] و [[y]]", 0, 0),
      note("x", "x", 0, 0),
      note("y", "y", 0, 0),
    ];
    const index = buildKnowledgeIndex(objects);
    const plan = planGraphArrange(objects, index);
    expect(plan).not.toBeNull();
    const moved = plan?.moves ?? [];
    expect(moved.length).toBe(3);
    // After the arrange the pairwise distances are all non-degenerate.
    const positions = moved.map((move) => {
      const object = objects.find((item) => item.id === move.id);
      return {
        x: (object?.position.x ?? 0) + move.delta.x,
        y: (object?.position.y ?? 0) + move.delta.y,
      };
    });
    let minSpread = Infinity;
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const p = positions[i];
        const q = positions[j];
        if (p === undefined || q === undefined) {
          continue;
        }
        minSpread = Math.min(minSpread, Math.hypot(q.x - p.x, q.y - p.y));
      }
    }
    expect(minSpread).toBeGreaterThan(150);
  });

  it("counts nodes and edges", () => {
    const objects = [
      note("a", "پیوند به [[b]]", 0, 0),
      note("b", "b", 500, 0),
    ];
    const index = buildKnowledgeIndex(objects);
    const plan = planGraphArrange(objects, index);
    expect(plan?.nodeCount).toBe(2);
    expect(plan?.edgeCount).toBe(1);
  });

  it("ghost nodes pull their sources but produce no moves", () => {
    const objects = [
      note("a", "پیوند به [[موجود]] و [[گمشده]]", 0, 0),
      note("b", "موجود", 500, 0),
    ];
    const index = buildKnowledgeIndex(objects);
    const plan = planGraphArrange(objects, index);
    expect(plan).not.toBeNull();
    expect(plan?.edgeCount).toBe(2);
    // Only real members appear in the moves.
    for (const move of plan?.moves ?? []) {
      expect(["a", "b"]).toContain(move.id);
    }
  });

  it("respects the node cap (maxNodes)", () => {
    const objects: SceneObjectData[] = [];
    const linked: TextBoxObjectData[] = [];
    for (let i = 0; i < 8; i += 1) {
      const target = note(`t${i}`, `عنوان ${i}`, i * 250, 0);
      objects.push(target);
      linked.push(target);
    }
    // A hub linking to the first 4 only.
    const hub = note("hub", "یک [[عنوان ۰]] دو [[عنوان ۱]]", 0, 600);
    objects.push(hub);
    linked.push(hub);
    const index = buildKnowledgeIndex(objects);
    const plan = planGraphArrange(objects, index, { maxNodes: 3 });
    expect(plan).not.toBeNull();
    expect(plan?.nodeCount).toBe(3);
    // The dropped titles (lowest degree) keep their positions.
    const movedIds = new Set((plan?.moves ?? []).map((move) => move.id));
    expect(movedIds.has("t6")).toBe(false);
    expect(movedIds.has("t7")).toBe(false);
  });
});
