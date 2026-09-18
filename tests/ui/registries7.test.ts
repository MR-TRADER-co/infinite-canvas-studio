/**
 * Panel + inspector-section registry tests (R7.1/R7.2/AC7.11): the
 * registration seams — a dummy panel appears in the dock listing and a
 * dummy inspector section resolves for its target, both with ZERO edits
 * to the layout/inspector code (they render FROM these registries).
 */
import { describe, expect, it } from "vitest";
import { PanelRegistry } from "@/ui/registry/PanelRegistry";
import {
  InspectorSectionRegistry,
  type InspectorSectionEntry,
} from "@/ui/registry/InspectorSectionRegistry";
import { readPanelState, writePanelState } from "@/ui/panels/panelState";
import { fuzzyFilter, fuzzyScore } from "@/ui/palette/fuzzy";

/** A no-op component for registrations. */
function Noop(): null {
  return null;
}

describe("PanelRegistry (R7.1/AC7.11)", () => {
  it("registers panels with owner.name ids and lists them per placement", () => {
    const registry = new PanelRegistry();
    registry.register({
      id: "core.panels.layers",
      titleKey: "panels.layers",
      icon: "Layers",
      component: Noop,
      placement: "right",
      order: 10,
      defaultOpen: false,
    });
    registry.register({
      id: "core.panels.insert",
      titleKey: "panels.insert",
      icon: "LayoutGrid",
      component: Noop,
      placement: "left",
      order: 20,
      defaultOpen: true,
    });
    expect(registry.listByPlacement("right").map((entry) => entry.id)).toEqual([
      "core.panels.layers",
    ]);
    expect(registry.listByPlacement("left").map((entry) => entry.id)).toEqual([
      "core.panels.insert",
    ]);
    expect(registry.listByPlacement("bottom")).toHaveLength(0);
  });

  it("orders by the order field within a placement", () => {
    const registry = new PanelRegistry();
    registry.register({
      id: "core.panels.b",
      titleKey: "panels.insert",
      icon: "LayoutGrid",
      component: Noop,
      placement: "left",
      order: 20,
      defaultOpen: false,
    });
    registry.register({
      id: "core.panels.a",
      titleKey: "panels.outline",
      icon: "ListTree",
      component: Noop,
      placement: "left",
      order: 10,
      defaultOpen: false,
    });
    expect(registry.listByPlacement("left").map((entry) => entry.id)).toEqual([
      "core.panels.a",
      "core.panels.b",
    ]);
  });

  it("rejects invalid ids, duplicate ids and non-core owners", () => {
    const registry = new PanelRegistry();
    expect(() =>
      registry.register({
        id: "nope",
        titleKey: "panels.layers",
        icon: "Layers",
        component: Noop,
        placement: "right",
        order: 10,
        defaultOpen: false,
      }),
    ).toThrow(/owner.name/);
    expect(() =>
      registry.register({
        id: "plugin.panels.x",
        titleKey: "panels.layers",
        icon: "Layers",
        component: Noop,
        placement: "right",
        order: 10,
        defaultOpen: false,
      }),
    ).toThrow(/reserved/);
    registry.register({
      id: "core.panels.once",
      titleKey: "panels.layers",
      icon: "Layers",
      component: Noop,
      placement: "right",
      order: 10,
      defaultOpen: false,
    });
    expect(() =>
      registry.register({
        id: "core.panels.once",
        titleKey: "panels.layers",
        icon: "Layers",
        component: Noop,
        placement: "right",
        order: 10,
        defaultOpen: false,
      }),
    ).toThrow(/duplicate/);
  });

  it("AC7.11 seam: a LATE dummy registration appears in the listing + fires onRegistered", () => {
    const registry = new PanelRegistry();
    const seen: string[] = [];
    registry.onRegistered((id) => {
      seen.push(id);
    });
    registry.register({
      id: "core.panels.dummy",
      titleKey: "panels.search",
      icon: "Search",
      component: Noop,
      placement: "bottom",
      order: 5,
      defaultOpen: true,
    });
    expect(seen).toEqual(["core.panels.dummy"]);
    expect(registry.listByPlacement("bottom")).toHaveLength(1);
  });
});

describe("InspectorSectionRegistry (R7.2/AC7.11)", () => {
  /** Section registration helper. */
  function section(
    id: string,
    target: string,
    order: number,
  ): InspectorSectionEntry {
    return { id, target, component: Noop, order };
  }

  it("resolves exact kinds, then text, then wildcard — each group ordered", () => {
    const registry = new InspectorSectionRegistry();
    registry.register(section("core.inspector.geometry", "*", 80));
    registry.register(section("core.inspector.fill", "shape", 40));
    registry.register(section("core.inspector.textBox", "textBox", 50));
    registry.register(section("core.inspector.multiText", "text", 15));
    const forShape = registry.sectionsForSelection(["shape"]);
    expect(forShape.map((entry) => entry.id)).toEqual([
      "core.inspector.fill",
      "core.inspector.geometry",
    ]);
    const forTexts = registry.sectionsForSelection(["textBox", "stickyNote"]);
    expect(forTexts.map((entry) => entry.id)).toEqual([
      "core.inspector.textBox",
      "core.inspector.multiText",
      "core.inspector.geometry",
    ]);
    const forGroup = registry.sectionsForSelection(["group"]);
    expect(forGroup.map((entry) => entry.id)).toEqual([
      "core.inspector.geometry",
    ]);
  });

  it("AC7.11 seam: registering a dummy section requires ONLY a registration", () => {
    const registry = new InspectorSectionRegistry();
    registry.register(section("core.inspector.fill", "shape", 40));
    const before = registry.sectionsForSelection(["shape"]).length;
    registry.register(section("core.inspector.dummy", "shape", 45));
    const after = registry.sectionsForSelection(["shape"]);
    expect(after).toHaveLength(before + 1);
    expect(after.map((entry) => entry.id)).toContain("core.inspector.dummy");
  });

  it("rejects invalid ids and non-core owners", () => {
    const registry = new InspectorSectionRegistry();
    expect(() => registry.register(section("bad", "*", 1))).toThrow(
      /owner.name/,
    );
    expect(() => registry.register(section("plugin.sec", "*", 1))).toThrow(
      /reserved/,
    );
  });
});

describe("panel state persistence (R7.1)", () => {
  it("merges persisted state over the defaults and writes back", () => {
    const storage = new Map<string, string>();
    const windowStub = {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    };
    const original = globalThis.window;
    (globalThis as { window?: unknown }).window = windowStub;
    try {
      const defaults = {
        "core.panels.layers": true,
        "core.panels.insert": false,
      };
      const first = readPanelState(defaults);
      expect(first).toEqual(defaults);
      writePanelState({ "core.panels.layers": false });
      const second = readPanelState(defaults);
      expect(second["core.panels.layers"]).toBe(false);
      expect(second["core.panels.insert"]).toBe(false);
    } finally {
      (globalThis as { window?: unknown }).window = original;
    }
  });

  it("corrupt storage falls back to the defaults", () => {
    const storage = new Map<string, string>([
      ["infinite-canvas-studio/panels/v1", "{not json"],
    ]);
    const windowStub = {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    };
    const original = globalThis.window;
    (globalThis as { window?: unknown }).window = windowStub;
    try {
      const defaults = { "core.panels.layers": true };
      expect(readPanelState(defaults)).toEqual(defaults);
    } finally {
      (globalThis as { window?: unknown }).window = original;
    }
  });
});

describe("fuzzy matcher (R7.11)", () => {
  it("ranks exact > prefix > subsequence and filters non-matches", () => {
    expect(fuzzyScore("ذخیره", "ذخیره")).toBeGreaterThan(
      fuzzyScore("ذخیرهٔ پروژه", "ذخیره") as number,
    );
    const items = ["ذخیره", "ذخیرهٔ پروژه", "باز کردن", "تنظیمات"];
    const matches = fuzzyFilter(items, "ذخیره", (item) => item);
    expect(matches.map((match) => match.item)).toContain("ذخیره");
    expect(matches.map((match) => match.item)).not.toContain("تنظیمات");
  });

  it("an empty query matches everything with a stable order", () => {
    const items = ["a", "b", "c"];
    const matches = fuzzyFilter(items, "  ", (item) => item);
    expect(matches).toHaveLength(3);
  });

  it("Latin queries are case-insensitive", () => {
    expect(fuzzyScore("Undo", "undo")).toBeGreaterThan(0);
    expect(fuzzyScore("Zoom In", "zi")).toBeGreaterThan(0);
    expect(fuzzyScore("Zoom In", "zz")).toBe(0);
  });
});
