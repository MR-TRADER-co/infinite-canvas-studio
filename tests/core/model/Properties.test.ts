/**
 * Structured-properties model tests (pack R11.3): type inference,
 * editor coercion, wire validation, display formatting and the R11.9
 * equality comparison.
 */
import { describe, expect, it } from "vitest";
import {
  cleanPropertyName,
  coercePropertyValue,
  formatPropertyValue,
  inferPropertyType,
  isTagsValue,
  isValidPropertyValue,
  normalizeProperties,
  normalizeSchemaSection,
  propertyValueEquals,
  splitTagList,
  TAGS_PROPERTY,
} from "@/core/model/Properties";

describe("inferPropertyType (R11.3 first-use inference)", () => {
  it("infers tags from string arrays", () => {
    expect(inferPropertyType("t", ["a", "b"])).toBe("tags");
  });

  it("infers number and boolean from their shapes", () => {
    expect(inferPropertyType("n", 42)).toBe("number");
    expect(inferPropertyType("b", true)).toBe("boolean");
  });

  it("infers date from ISO strings", () => {
    expect(inferPropertyType("due", "2026-09-15")).toBe("date");
    expect(inferPropertyType("due", "2026-09-15T10:00:00Z")).toBe("date");
  });

  it("infers date from date-like NAMES even for plain strings", () => {
    expect(inferPropertyType("deadline", "فردا")).toBe("date");
    expect(inferPropertyType("DueDate", "whenever")).toBe("date");
  });

  it("falls back to text", () => {
    expect(inferPropertyType("owner", "سارا")).toBe("text");
  });
});

describe("coercePropertyValue (the editor commit path)", () => {
  it("coerces ASCII numbers", () => {
    expect(coercePropertyValue("number", "12.5")).toBe(12.5);
  });

  it("coerces Persian and Arabic-Indic digits", () => {
    expect(coercePropertyValue("number", "۱۲")).toBe(12);
    expect(coercePropertyValue("number", "٣")).toBe(3);
  });

  it("rejects unusable numbers and empty dates", () => {
    expect(coercePropertyValue("number", "abc")).toBeNull();
    expect(coercePropertyValue("number", "")).toBeNull();
    expect(coercePropertyValue("date", "  ")).toBeNull();
  });

  it("keeps dates verbatim", () => {
    expect(coercePropertyValue("date", "2026-09-15")).toBe("2026-09-15");
  });

  it("splits, trims, dedupes and caps tag lists", () => {
    expect(coercePropertyValue("tags", "مهم، فوری، مهم")).toEqual([
      "مهم",
      "فوری",
    ]);
    expect(coercePropertyValue("tags", "a,b،c")).toEqual(["a", "b", "c"]);
    expect(splitTagList("  ")).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`).join(",");
    expect(splitTagList(many).length).toBeLessThanOrEqual(24);
  });

  it("passes text/select/boolean inputs through as strings", () => {
    expect(coercePropertyValue("text", "سلام")).toBe("سلام");
    expect(coercePropertyValue("select", "TODO")).toBe("TODO");
  });
});

describe("normalizeProperties (the wire read path)", () => {
  it("accepts all five value shapes", () => {
    const out = normalizeProperties({
      owner: "سارا",
      priority: 2,
      done: false,
      due: "2026-09-15",
      [TAGS_PROPERTY]: ["مهم"],
    });
    expect(out).toEqual({
      owner: "سارا",
      priority: 2,
      done: false,
      due: "2026-09-15",
      tags: ["مهم"],
    });
  });

  it("returns undefined for non-record or empty input", () => {
    expect(normalizeProperties(undefined)).toBeUndefined();
    expect(normalizeProperties("nope")).toBeUndefined();
    expect(normalizeProperties([])).toBeUndefined();
    expect(normalizeProperties({})).toBeUndefined();
  });

  it("drops wrong-typed names and values without failing the object", () => {
    expect(normalizeProperties({ "": "x", ok: 1, bad: null })).toEqual({
      ok: 1,
    });
    expect(normalizeProperties({ nested: { deep: true } })).toBeUndefined();
  });

  it("validates value shapes (isValidPropertyValue)", () => {
    expect(isValidPropertyValue("s")).toBe(true);
    expect(isValidPropertyValue(1)).toBe(true);
    expect(isValidPropertyValue(true)).toBe(true);
    expect(isValidPropertyValue(["a"])).toBe(true);
    expect(isValidPropertyValue([1])).toBe(false);
    expect(isValidPropertyValue(null)).toBe(false);
    expect(isTagsValue(["a"])).toBe(true);
    expect(isTagsValue("a")).toBe(false);
  });
});

describe("normalizeSchemaSection (the load path)", () => {
  it("validates field entries and select options", () => {
    const out = normalizeSchemaSection({
      version: 1,
      fields: {
        status: { type: "select", options: ["TODO", "doing", ""] },
        owner: { type: "text" },
        bogus: { type: "nope" },
      },
    });
    expect(out).toEqual({
      version: 1,
      fields: {
        status: { type: "select", options: ["TODO", "doing"] },
        owner: { type: "text" },
      },
    });
  });

  it("select without options degrades to a bare type", () => {
    const out = normalizeSchemaSection({
      fields: { status: { type: "select" } },
    });
    expect(out?.fields.status).toEqual({ type: "select" });
  });

  it("returns undefined for absent/invalid sections", () => {
    expect(normalizeSchemaSection(undefined)).toBeUndefined();
    expect(normalizeSchemaSection({ fields: "x" })).toBeUndefined();
    expect(normalizeSchemaSection({ fields: {} })).toBeUndefined();
  });
});

describe("formatPropertyValue (display)", () => {
  it("renders booleans, tags and scalars", () => {
    expect(formatPropertyValue(true)).toBe("✓");
    expect(formatPropertyValue(false)).toBe("✗");
    expect(formatPropertyValue(["a", "b"])).toBe("a · b");
    expect(formatPropertyValue(7)).toBe("7");
    expect(formatPropertyValue("سلام")).toBe("سلام");
  });
});

describe("propertyValueEquals (the R11.9 direct scan)", () => {
  it("compares numbers numerically", () => {
    expect(propertyValueEquals(5, "5")).toBe(true);
    expect(propertyValueEquals(5, "5.0")).toBe(true);
    expect(propertyValueEquals(5, "6")).toBe(false);
  });

  it("compares booleans through truthy spellings (fa + en)", () => {
    expect(propertyValueEquals(true, "true")).toBe(true);
    expect(propertyValueEquals(true, "بله")).toBe(true);
    expect(propertyValueEquals(false, "خیر")).toBe(true);
    expect(propertyValueEquals(false, "بله")).toBe(false);
  });

  it("matches tags by containment", () => {
    expect(propertyValueEquals(["مهم", "فوری"], "فوری")).toBe(true);
    expect(propertyValueEquals(["مهم"], "فوری")).toBe(false);
  });

  it("folds Persian keyboard drift on strings", () => {
    expect(propertyValueEquals("هدف", "هدف")).toBe(true);
    expect(propertyValueEquals("كلمه", "کلمه")).toBe(true);
  });

  it("rejects empty filters", () => {
    expect(propertyValueEquals("x", "  ")).toBe(false);
  });
});

describe("cleanPropertyName", () => {
  it("trims and caps", () => {
    expect(cleanPropertyName("  owner ")).toBe("owner");
    expect(cleanPropertyName("x".repeat(80)).length).toBe(40);
  });
});
