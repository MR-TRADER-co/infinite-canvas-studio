/**
 * Unit tests for the shared path-name helpers.
 */
import { describe, expect, it } from "vitest";
import { baseNameOfPath, withoutIcbExtension } from "@/persistence/pathNames";

describe("baseNameOfPath", () => {
  it("splits POSIX paths", () => {
    expect(baseNameOfPath("/home/z/boards/plan.icb")).toBe("plan.icb");
  });

  it("splits windows paths", () => {
    expect(baseNameOfPath("C:\\Users\\me\\board.icb")).toBe("board.icb");
  });

  it("returns the whole string when no separator exists", () => {
    expect(baseNameOfPath("board.icb")).toBe("board.icb");
  });

  it("trims surrounding whitespace", () => {
    expect(baseNameOfPath("  /a/b.icb  ")).toBe("b.icb");
  });
});

describe("withoutIcbExtension", () => {
  it("strips a trailing .icb (case-insensitive)", () => {
    expect(withoutIcbExtension("plan.icb")).toBe("plan");
    expect(withoutIcbExtension("PLAN.ICB")).toBe("PLAN");
  });

  it("keeps names without the extension untouched", () => {
    expect(withoutIcbExtension("plan.png")).toBe("plan.png");
    expect(withoutIcbExtension("plan")).toBe("plan");
  });

  it("does not touch mid-string occurrences", () => {
    expect(withoutIcbExtension("a.icb.txt")).toBe("a.icb.txt");
  });
});
