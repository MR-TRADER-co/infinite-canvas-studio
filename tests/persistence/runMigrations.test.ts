/** Unit tests for the project-file migration chain walker. */
import { describe, expect, it } from "vitest";
import { MIGRATIONS, runMigrations } from "@/persistence/migrations";
import type { Migration } from "@/persistence/migrations/Migration";

/**
 * Builds a migration step that records its invocation order and appends a
 * version tag to the payload (cumulative transform).
 */
function makeStep(
  fromVersion: number,
  toVersion: number,
  tag: string,
  calls: string[],
): Migration {
  return {
    fromVersion,
    toVersion,
    migrate: (data: unknown): unknown => {
      calls.push(tag);
      const record = (data ?? {}) as Record<string, unknown>;
      const tags = Array.isArray(record.tags) ? (record.tags as string[]) : [];
      return { ...record, tags: [...tags, tag] };
    },
  };
}

describe("runMigrations", () => {
  it("passes data through unchanged when fromVersion equals toVersion", () => {
    const data = { camera: { x: 0 }, objects: [] };
    expect(runMigrations(data, 1, 1)).toBe(data);
  });

  it("walks a chained migration in order and transforms the payload cumulatively", () => {
    const calls: string[] = [];
    const chain = [
      makeStep(1, 2, "to-v2", calls),
      makeStep(2, 3, "to-v3", calls),
    ];
    const result = runMigrations({ tags: [] }, 1, 3, chain);
    expect(calls).toEqual(["to-v2", "to-v3"]);
    expect(result).toEqual({ tags: ["to-v2", "to-v3"] });
  });

  it("walks the chain by fromVersion even when steps are listed out of order", () => {
    const calls: string[] = [];
    const chain = [
      makeStep(2, 3, "to-v3", calls),
      makeStep(1, 2, "to-v2", calls),
    ];
    const result = runMigrations({ tags: [] }, 1, 3, chain);
    expect(calls).toEqual(["to-v2", "to-v3"]);
    expect(result).toEqual({ tags: ["to-v2", "to-v3"] });
  });

  it("returns null when a step of the chain is missing", () => {
    const calls: string[] = [];
    const chain = [makeStep(1, 2, "to-v2", calls)];
    expect(runMigrations({ tags: [] }, 1, 3, chain)).toBeNull();
    expect(calls).toEqual(["to-v2"]);
  });

  it("returns null when walking an empty chain that must upgrade", () => {
    expect(runMigrations({ tags: [] }, 1, 2, [])).toBeNull();
  });

  it("passes data through an empty chain when no upgrade is needed", () => {
    const data = { tags: [] };
    expect(runMigrations(data, 1, 1, [])).toBe(data);
  });

  it("returns null when a step never advances the version (loop guard)", () => {
    const calls: string[] = [];
    const chain = [makeStep(1, 1, "loop", calls)];
    expect(runMigrations({ tags: [] }, 1, 3, chain)).toBeNull();
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("MIGRATIONS holds the registered 1 → 2 → 3 → 4 → 5 → 6 chain (R4.4a + R13.3 + فاز M1 + فاز A1 + فاز P1)", () => {
    expect(MIGRATIONS).toHaveLength(5);
    expect(MIGRATIONS[0]?.fromVersion).toBe(1);
    expect(MIGRATIONS[0]?.toVersion).toBe(2);
    expect(MIGRATIONS[1]?.fromVersion).toBe(2);
    expect(MIGRATIONS[1]?.toVersion).toBe(3);
    expect(MIGRATIONS[2]?.fromVersion).toBe(3);
    expect(MIGRATIONS[2]?.toVersion).toBe(4);
    expect(MIGRATIONS[3]?.fromVersion).toBe(4);
    expect(MIGRATIONS[3]?.toVersion).toBe(5);
    expect(MIGRATIONS[4]?.toVersion).toBe(6);
  });
});
