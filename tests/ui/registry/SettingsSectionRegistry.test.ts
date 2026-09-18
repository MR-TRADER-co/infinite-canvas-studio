import { describe, expect, it } from "vitest";
import { SettingsSectionRegistry } from "@/ui/registry/SettingsSectionRegistry";
import type { ComponentType } from "react";

/** A dummy section body (the AC8.3 seam proof). */
const DummySection: ComponentType = () => null;

describe("SettingsSectionRegistry (R8.2 / AC8.3)", () => {
  it("registers a section and lists it ordered", () => {
    const registry = new SettingsSectionRegistry();
    registry.register({
      id: "core.settings.general",
      titleKey: "settings.section.general",
      component: DummySection,
      order: 10,
    });
    registry.register({
      id: "core.settings.appearance",
      titleKey: "settings.section.appearance",
      component: DummySection,
      order: 20,
    });
    expect(registry.listOrdered().map((section) => section.id)).toEqual([
      "core.settings.general",
      "core.settings.appearance",
    ]);
  });

  it("orders by `order`, registration breaks ties", () => {
    const registry = new SettingsSectionRegistry();
    registry.register({
      id: "core.settings.b",
      titleKey: "settings.section.general",
      component: DummySection,
      order: 10,
    });
    registry.register({
      id: "core.settings.a",
      titleKey: "settings.section.general",
      component: DummySection,
      order: 5,
    });
    registry.register({
      id: "core.settings.c",
      titleKey: "settings.section.general",
      component: DummySection,
      order: 10,
    });
    expect(registry.listOrdered().map((section) => section.id)).toEqual([
      "core.settings.a",
      "core.settings.b",
      "core.settings.c",
    ]);
  });

  it("AC8.3 seam: a dummy section appears in the compose list with ZERO dialog code", () => {
    const registry = new SettingsSectionRegistry();
    // The "dialog" here is just the ordered list — a late registration
    // re-composes the dialog without any edit.
    const compose = (): readonly string[] =>
      registry.listOrdered().map((section) => section.id);
    registry.register({
      id: "core.settings.general",
      titleKey: "settings.section.general",
      component: DummySection,
      order: 10,
    });
    const before = compose();
    registry.register({
      id: "core.settings.dummy",
      titleKey: "settings.section.general",
      component: DummySection,
      order: 15,
    });
    const after = compose();
    expect(after).toContain("core.settings.dummy");
    expect(after.length).toBe(before.length + 1);
  });

  it("refuses invalid ids, duplicates and non-core owners", () => {
    const registry = new SettingsSectionRegistry();
    const entry = {
      titleKey: "settings.section.general",
      component: DummySection,
      order: 10,
    };
    expect(() => registry.register({ id: "invalid", ...entry })).toThrowError(
      /owner.name/,
    );
    expect(() =>
      registry.register({ id: "plugin.settings", ...entry }),
    ).toThrowError(/reserved/);
    registry.register({ id: "core.settings.x", ...entry });
    expect(() =>
      registry.register({ id: "core.settings.x", ...entry }),
    ).toThrowError();
  });

  it("notifies onRegistered subscribers (late registrations re-compose)", () => {
    const registry = new SettingsSectionRegistry();
    const seen: string[] = [];
    registry.onRegistered((id) => {
      seen.push(id);
    });
    registry.register({
      id: "core.settings.late",
      titleKey: "settings.section.general",
      component: DummySection,
      order: 99,
    });
    expect(seen).toEqual(["core.settings.late"]);
    expect(registry.has("core.settings.late")).toBe(true);
    expect(registry.size).toBe(1);
  });
});
