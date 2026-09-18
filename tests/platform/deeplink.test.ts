/**
 * Deep-link parse/build tests (R13.2).
 */
import { describe, expect, it } from "vitest";
import {
  buildDeepLink,
  buildWebDeepLinkHash,
  parseDeepLink,
} from "@/platform/tauri/deeplink";

describe("parseDeepLink (R13.2)", () => {
  it("parses the desktop scheme with every parameter", () => {
    const link = parseDeepLink(
      "infinitecanvas://open?project=/tmp/p.icb&object=obj-3&view=bm-1",
    );
    expect(link).toEqual({
      project: "/tmp/p.icb",
      object: "obj-3",
      view: "bm-1",
    });
  });

  it("parses the web fallback hash (#open?…)", () => {
    const link = parseDeepLink("#open?object=factory-frame-2");
    expect(link).toEqual({ object: "factory-frame-2" });
  });

  it("URL-decodes parameter values", () => {
    const link = parseDeepLink("#open?object=" + encodeURIComponent("a b"));
    expect(link?.object).toBe("a b");
  });

  it("rejects non-open hosts, junk and empty parameter sets", () => {
    expect(parseDeepLink("infinitecanvas://other?object=x")).toBeNull();
    expect(parseDeepLink("https://example.com")).toBeNull();
    expect(parseDeepLink("")).toBeNull();
    expect(parseDeepLink("#open?")).toBeNull();
    expect(parseDeepLink("#open?unknown=1")).toBeNull();
  });

  it("ignores empty-string parameters", () => {
    expect(parseDeepLink("#open?object=&view=bm-2")).toEqual({
      view: "bm-2",
    });
  });
});

describe("buildDeepLink / buildWebDeepLinkHash (R13.2)", () => {
  it("builds the desktop URL in a stable parameter order", () => {
    expect(
      buildDeepLink({ project: "/a/b.icb", object: "o1", view: "v1" }),
    ).toBe(
      "infinitecanvas://open?project=%2Fa%2Fb.icb&object=o1&view=v1",
    );
  });

  it("round-trips both builders through the parsers", () => {
    const url = buildDeepLink({ object: "x 1" });
    expect(parseDeepLink(url)).toEqual({ object: "x 1" });
    const hash = buildWebDeepLinkHash({ object: "x 1" });
    expect(parseDeepLink(hash)).toEqual({ object: "x 1" });
  });

  it("the web hash omits the project parameter (web cannot open paths)", () => {
    expect(buildWebDeepLinkHash({ project: "/x", object: "o" })).toBe(
      "#open?object=o",
    );
    expect(buildWebDeepLinkHash({})).toBe("");
  });
});
