import { describe, expect, it } from "vitest";
import { buildTagRows } from "@/ui/components/panels/TagPanePanel";

/**
 * Tag pane (pack R11.4/AC11.5): the PURE row builder — count mapping and
 * the sort contract (count DESC, then display ASC under Persian
 * collation).
 */

/** Shorthand tag fixture. */
function tag(
  key: string,
  display: string,
  objectIds: readonly string[],
): { key: string; display: string; objectIds: readonly string[] } {
  return { key, display, objectIds };
}

describe("Tag pane rows (pack R11.4/AC11.5)", () => {
  it("maps keys, displays and object counts", () => {
    const rows = buildTagRows([
      tag("mohem", "مهم", ["obj-1", "obj-2", "obj-3"]),
      tag("idea", "ایده", ["obj-1"]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({
      key: "mohem",
      display: "مهم",
      count: 3,
    });
    expect(rows).toContainEqual({
      key: "idea",
      display: "ایده",
      count: 1,
    });
  });

  it("sorts by object count desc first", () => {
    // «ایده» sorts FIRST in Persian collation, but carries fewer objects —
    // count desc must dominate the display order.
    const rows = buildTagRows([
      tag("idea", "ایده", ["a", "b"]),
      tag("dar-entezar", "در انتظار", ["a", "b", "c", "d", "e"]),
      tag("mohem", "مهم", ["a", "b", "c"]),
    ]);
    expect(rows.map((row) => row.display)).toEqual([
      "در انتظار",
      "مهم",
      "ایده",
    ]);
  });

  it("breaks count ties by display asc (Persian locale collation)", () => {
    const rows = buildTagRows([
      tag("mohem", "مهم", ["x"]),
      tag("dar-entezar", "در انتظار", ["y"]),
      tag("idea", "ایده", ["z"]),
    ]);
    // Persian alphabet: ا (ایده) < د (در انتظار) < م (مهم).
    expect(rows.map((row) => row.display)).toEqual([
      "ایده",
      "در انتظار",
      "مهم",
    ]);
    expect(rows.every((row) => row.count === 1)).toBe(true);
  });

  it("returns [] for an empty tag set", () => {
    expect(buildTagRows([])).toEqual([]);
  });

  it("stays pure — the input array and its tags are never mutated", () => {
    const input = [
      tag("mohem", "مهم", ["a", "b"]),
      tag("idea", "ایده", ["c"]),
    ];
    const snapshot = JSON.stringify(input);
    const rows = buildTagRows(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    // The output is a fresh array (re-sorting it cannot reorder the input).
    expect(rows).not.toBe(input);
    expect(input.map((item) => item.key)).toEqual(["mohem", "idea"]);
  });
});
