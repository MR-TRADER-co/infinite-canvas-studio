import { describe, expect, it } from "vitest";
import {
  parseSemVer,
  parseSdkRange,
  sdkRangeSupportedMajors,
  validateManifest,
  type PluginManifest,
} from "@/plugins/manifest";

/** A clean base manifest mutated per test. */
function baseManifest(): Record<string, unknown> {
  return {
    id: "acme-tools",
    name: "Acme Tools",
    version: "1.2.0",
    sdkRange: "^1.0.0",
    permissions: ["storage"],
    dependencies: [],
    entry: "entry.js",
  };
}

const EMPTY_CONTEXT = { installedIds: [], installedVersions: {} };

describe("Plugin manifest validation (R9.1)", () => {
  it("accepts a well-formed manifest", () => {
    const errors = validateManifest(baseManifest(), EMPTY_CONTEXT);
    expect(errors).toEqual([]);
  });

  it("accepts absent optional fields (permissions/dependencies/icon)", () => {
    const candidate = baseManifest();
    delete candidate.permissions;
    delete candidate.dependencies;
    delete candidate.icon;
    expect(validateManifest(candidate, EMPTY_CONTEXT)).toEqual([]);
  });

  it("parses strict semver", () => {
    expect(parseSemVer("1.2.3")).not.toBeNull();
    expect(parseSemVer("0.0.0")).not.toBeNull();
    expect(parseSemVer("01.2.3")).toBeNull();
    expect(parseSemVer("1.2")).toBeNull();
    expect(parseSemVer("v1.2.3")).toBeNull();
  });

  it("parses caret and interval sdkRanges", () => {
    expect(parseSdkRange("^1.2.3")).toEqual({
      min: { major: 1, minor: 2, patch: 3 },
      maxExclusive: { major: 2, minor: 0, patch: 0 },
    });
    expect(parseSdkRange(">=1.0.0 <2.0.0")).not.toBeNull();
    expect(parseSdkRange("latest")).toBeNull();
    expect(sdkRangeSupportedMajors("^1.0.0")).toEqual([1]);
    expect(sdkRangeSupportedMajors("^2.0.0")).toEqual([]);
    expect(sdkRangeSupportedMajors("^0.4.0")).toEqual([]);
  });

  it("rejects a reserved core. owner (AC9.5)", () => {
    const errors = validateManifest(
      { ...baseManifest(), id: "core" },
      EMPTY_CONTEXT,
    );
    expect(errors.some((error) => error.field === "id")).toBe(true);
    expect(errors[0]?.message).toContain("رزرو");
  });

  it("rejects duplicate ids against the installed set (AC9.5)", () => {
    const errors = validateManifest(baseManifest(), {
      installedIds: ["acme-tools"],
      installedVersions: { "acme-tools": "1.0.0" },
    });
    expect(
      errors.some((error) => error.message.includes("از قبل نصب شده")),
    ).toBe(true);
  });

  it("rejects malformed ids", () => {
    for (const id of ["", "UPPER", "1abc", "has:colon", "a", "x".repeat(50)]) {
      const errors = validateManifest({ ...baseManifest(), id }, EMPTY_CONTEXT);
      expect(errors.some((error) => error.field === "id")).toBe(true);
    }
  });

  it("rejects a non-semver version", () => {
    const errors = validateManifest(
      { ...baseManifest(), version: "one.two" },
      EMPTY_CONTEXT,
    );
    expect(errors.some((error) => error.field === "version")).toBe(true);
  });

  it("rejects an unsupported sdkRange with a clear Persian message (AC9.6)", () => {
    const errors = validateManifest(
      { ...baseManifest(), sdkRange: "^3.0.0" },
      EMPTY_CONTEXT,
    );
    expect(errors.some((error) => error.field === "sdkRange")).toBe(true);
    expect(errors[0]?.message).toContain("سازگار نیست");
  });

  it("rejects unknown permissions", () => {
    const errors = validateManifest(
      { ...baseManifest(), permissions: ["storage", "root-access"] },
      EMPTY_CONTEXT,
    );
    expect(errors.some((error) => error.message.includes("root-access"))).toBe(
      true,
    );
  });

  it("rejects unresolvable dependencies (missing + version mismatch)", () => {
    const missing = validateManifest(
      { ...baseManifest(), dependencies: ["other-plugin"] },
      EMPTY_CONTEXT,
    );
    expect(missing.some((error) => error.message.includes("نصب نیست"))).toBe(
      true,
    );

    const mismatch = validateManifest(
      { ...baseManifest(), dependencies: ["other-plugin@^2.0.0"] },
      { installedIds: [], installedVersions: { "other-plugin": "1.5.0" } },
    );
    expect(
      mismatch.some((error) => error.message.includes("سازگار نیست")),
    ).toBe(true);
  });

  it("accepts satisfied dependency ranges", () => {
    const errors = validateManifest(
      { ...baseManifest(), dependencies: ["other-plugin@^1.2.0"] },
      { installedIds: [], installedVersions: { "other-plugin": "1.9.0" } },
    );
    expect(errors).toEqual([]);
  });

  it("rejects entry paths escaping the package", () => {
    for (const entry of ["/abs/entry.js", "../outside.js", "C:\\x\\e.js"]) {
      const errors = validateManifest(
        { ...baseManifest(), entry },
        EMPTY_CONTEXT,
      );
      expect(errors.some((error) => error.field === "entry")).toBe(true);
    }
  });

  it("rejects non-object manifests outright", () => {
    const errors = validateManifest("nope", EMPTY_CONTEXT);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("manifest.json");
  });

  it("validates the shipped sample manifest cleanly", async () => {
    const { readFileSync } = await import("node:fs");
    const sample = JSON.parse(
      readFileSync(
        "public/plugins-sample/sticky-shape-pack/manifest.json",
        "utf8",
      ),
    ) as PluginManifest;
    const errors = validateManifest(sample, EMPTY_CONTEXT);
    expect(errors).toEqual([]);
  });
});
