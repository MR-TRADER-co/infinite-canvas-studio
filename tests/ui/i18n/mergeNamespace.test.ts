import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetMergedNamespaces,
  mergeNamespace,
  ownerOfKey,
  removeOwnerNamespace,
  t,
} from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";

describe("i18n mergeNamespace (R8.6 / AC8.4)", () => {
  beforeEach(() => {
    __resetMergedNamespaces();
    useUiStore.getState().setLanguage("fa");
  });

  afterEach(() => {
    __resetMergedNamespaces();
    vi.restoreAllMocks();
  });

  it("merges an owner namespace and resolves it through t()", () => {
    const conflicts = mergeNamespace("acme", {
      fa: { greeting: "سلام قاب" },
      en: { greeting: "Hello plugin" },
    });
    expect(conflicts).toEqual([]);
    expect(t("acme:greeting")).toBe("سلام قاب");
    useUiStore.getState().setLanguage("en");
    expect(t("acme:greeting")).toBe("Hello plugin");
    useUiStore.getState().setLanguage("fa");
  });

  it("resolves core keys unchanged (no shadowing)", () => {
    expect(t("app.name")).toBe("استودیو بوم بی‌نهایت");
    mergeNamespace("acme", { fa: { "app.name": "سایه" } });
    // The colliding merge is SKIPPED — the core dictionary always wins.
    expect(t("app.name")).toBe("استودیو بوم بی‌نهایت");
  });

  it("detects + logs cross-owner conflicts (first definition wins)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Two owners whose full keys collide: "acme" key "a.b" and owner
    // "acme.a" key "b" both claim "acme.a:b"… use explicit same full key.
    mergeNamespace("ownerOne", { fa: { shared: "اول" } });
    const conflicts = mergeNamespace("ownerTwo", { fa: { shared: "دوم" } });
    // Full keys differ (ownerTwo:shared) — no conflict by construction;
    // the real conflict class is a second owner forging the same full key
    // through a key containing the separator.
    expect(conflicts).toEqual([]);
    const forged = mergeNamespace("ownerThree", {
      fa: { "ownerOne:shared": "جعلی" },
    });
    expect(forged).toContain("ownerThree:ownerOne:shared");
    expect(warn).toHaveBeenCalled();
    // The original owner's value still resolves.
    expect(t("ownerOne:shared")).toBe("اول");
  });

  it("replaces the namespace on re-merge of the SAME owner", () => {
    mergeNamespace("acme", { fa: { a: "یک", b: "دو" } });
    expect(t("acme:a")).toBe("یک");
    expect(t("acme:b")).toBe("دو");
    mergeNamespace("acme", { fa: { c: "سه" } });
    // Replaced: the old keys of this owner are GONE.
    expect(t("acme:a")).toBe("acme:a");
    expect(t("acme:b")).toBe("acme:b");
    expect(t("acme:c")).toBe("سه");
  });

  it("refuses the reserved core. owner and empty owners", () => {
    const reserved = mergeNamespace("core.plugin", { fa: { x: "۱" } });
    expect(reserved.length).toBeGreaterThan(0);
    const empty = mergeNamespace("", { fa: { x: "۱" } });
    expect(empty.length).toBeGreaterThan(0);
    expect(t("core.plugin:x")).toBe("core.plugin:x");
  });

  it("probes key ownership (core vs merged owners)", () => {
    expect(ownerOfKey("app.name")).toBe("core");
    mergeNamespace("acme", { fa: { greeting: "سلام" } });
    expect(ownerOfKey("acme:greeting")).toBe("acme");
    expect(ownerOfKey("unknown:key")).toBeNull();
  });

  it("removes an owner's namespace on demand (the uninstall path)", () => {
    mergeNamespace("acme", { fa: { greeting: "سلام" } });
    expect(t("acme:greeting")).toBe("سلام");
    removeOwnerNamespace("acme");
    expect(t("acme:greeting")).toBe("acme:greeting");
  });

  it("falls back to the other language for one-sided merges", () => {
    mergeNamespace("acme", { fa: { only: "فارسی" } });
    useUiStore.getState().setLanguage("en");
    expect(t("acme:only")).toBe("فارسی");
    useUiStore.getState().setLanguage("fa");
  });

  it("skips non-string values and separator-bearing keys", () => {
    const conflicts = mergeNamespace("acme", {
      fa: {
        ok: "خوب",
        bad: 42 as unknown as string,
        "x:y": "با جداکننده",
      },
    });
    expect(conflicts).toContain("acme:x:y");
    expect(t("acme:ok")).toBe("خوب");
    expect(t("acme:bad")).toBe("acme:bad");
  });
});
