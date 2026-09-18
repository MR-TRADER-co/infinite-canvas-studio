/**
 * Search-panel structured-spec tests (pack R12.7): the exported pure
 * helpers — row normalisation (invalid rows drop, operator validation,
 * cap) and the text-result ∩ structured-query intersection.
 */
import { describe, expect, it } from "vitest";
import {
  filterGroupsBySpec,
  specRowsToFilters,
} from "@/ui/components/panels/SearchPanel";
import type { SceneQueryResult } from "@/core/knowledge/QueryEngine";
import type { SceneSearchGroup } from "@/core/search/SceneSearch";

/** A minimal result stub (only the fields the helpers read). */
function resultOf(objectIds: readonly string[]): SceneQueryResult {
  return {
    rows: objectIds.map((objectId) => ({
      objectId,
      title: objectId,
    })),
    total: objectIds.length,
  } as unknown as SceneQueryResult;
}

/** A minimal group stub. */
function groupOf(objectId: string): SceneSearchGroup {
  return {
    object: { id: objectId },
    matches: [],
  } as unknown as SceneSearchGroup;
}

describe("specRowsToFilters", () => {
  it("drops rows with empty values", () => {
    expect(
      specRowsToFilters([
        { prop: "اولویت", op: "gt", value: "" },
        { prop: "", op: "eq", value: "۴" },
      ]),
    ).toEqual([]);
  });

  it("keeps valid rows in order", () => {
    expect(
      specRowsToFilters([
        { prop: "اولویت", op: "gt", value: "۴" },
        { prop: "title", op: "contains", value: "هدف" },
      ]),
    ).toEqual([
      { prop: "اولویت", op: "gt", value: "۴" },
      { prop: "title", op: "contains", value: "هدف" },
    ]);
  });

  it("rejects unknown operators", () => {
    expect(
      specRowsToFilters([
        { prop: "اولویت", op: "regex" as never, value: "۴" },
      ]),
    ).toEqual([]);
  });

  it("caps the filter count at the engine maximum", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      prop: `p${i}`,
      op: "eq" as const,
      value: String(i),
    }));
    expect(specRowsToFilters(rows).length).toBe(8);
  });
});

describe("filterGroupsBySpec", () => {
  it("keeps only the groups whose object passed the query", () => {
    const groups = [groupOf("a"), groupOf("b"), groupOf("c")];
    const filtered = filterGroupsBySpec(groups, resultOf(["a", "c"]));
    expect(filtered.map((group) => group.object.id)).toEqual(["a", "c"]);
  });

  it("returns an empty array when nothing matched", () => {
    const filtered = filterGroupsBySpec([groupOf("a")], resultOf([]));
    expect(filtered).toEqual([]);
  });

  it("never mutates the input groups", () => {
    const groups = [groupOf("a"), groupOf("b")];
    const snapshot = JSON.stringify(groups.map((g) => g.object.id));
    filterGroupsBySpec(groups, resultOf(["a"]));
    expect(JSON.stringify(groups.map((g) => g.object.id))).toBe(snapshot);
  });
});
