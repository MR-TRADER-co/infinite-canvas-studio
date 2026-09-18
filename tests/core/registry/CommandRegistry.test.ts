/**
 * Unit tests for the command registry (R3B5.2/R3B5.3 / AC3B5.3/AC3B5.5):
 * the `owner.name` id scheme, the reserved `core.` owner policy and
 * shortcut-conflict detection at REGISTRATION time.
 */
import { describe, expect, it, vi } from "vitest";
import {
  CommandRegistry,
  normaliseShortcut,
} from "@/core/registry/CommandRegistry";
import type { CommandEntry } from "@/core/registry/CommandRegistry";

/** Builds a minimal valid command entry. */
function entry(overrides: Partial<CommandEntry>): CommandEntry {
  return {
    id: "core.test.something",
    titleKey: "a11y.undo",
    group: "edit",
    order: 0,
    execute: () => undefined,
    ...overrides,
  };
}

describe("CommandRegistry", () => {
  it("accepts valid core.* ids", () => {
    const registry = new CommandRegistry();
    registry.register(entry({ id: "core.text.bold", shortcut: "Mod-B" }));
    expect(registry.has("core.text.bold")).toBe(true);
  });

  it("rejects ids that do not follow the owner.name scheme", () => {
    const registry = new CommandRegistry();
    expect(() => registry.register(entry({ id: "bold" }))).toThrow(
      /owner\.name/,
    );
    expect(() => registry.register(entry({ id: "core" }))).toThrow(
      /owner\.name/,
    );
    // Hierarchical names ARE the scheme (core.text.bold.extra is valid);
    // only dot-less and owner-less ids are rejected.
    expect(() =>
      registry.register(entry({ id: "core.text.bold.extra" })),
    ).not.toThrow();
  });

  it("rejects non-core owners (reserved, §1.7.2 — AC3B5.5)", () => {
    const registry = new CommandRegistry();
    expect(() => registry.register(entry({ id: "plugin.text.bold" }))).toThrow(
      /owner "plugin" is not allowed/,
    );
    expect(() =>
      registry.register(entry({ id: "third_party.action" })),
    ).toThrow(/not allowed/);
  });

  it("detects shortcut conflicts at registration time and logs them", () => {
    const logger = { error: vi.fn(), warn: vi.fn() };
    const registry = new CommandRegistry(logger);
    registry.register(entry({ id: "core.a.first", shortcut: "Mod-Shift-Z" }));
    expect(() =>
      registry.register(
        entry({ id: "core.a.second", shortcut: "Mod-Shift-Z" }),
      ),
    ).toThrow(/shortcut conflict/);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('already bound to "core.a.first"'),
    );
    // The conflicting command was NOT registered.
    expect(registry.has("core.a.second")).toBe(false);
  });

  it("normalises shortcut notations before comparing (Mod ≡ Ctrl ≡ Cmd)", () => {
    const registry = new CommandRegistry();
    registry.register(entry({ id: "core.a.first", shortcut: "Mod-K" }));
    expect(() =>
      registry.register(entry({ id: "core.a.second", shortcut: "Ctrl-K" })),
    ).toThrow(/shortcut conflict/);
  });

  it("resolves the command bound to a shortcut", () => {
    const registry = new CommandRegistry();
    registry.register(entry({ id: "core.find.open", shortcut: "Mod-F" }));
    expect(registry.commandForShortcut("Mod-F")).toBe("core.find.open");
    expect(registry.commandForShortcut("ctrl-f")).toBe("core.find.open");
    expect(registry.commandForShortcut("Escape")).toBeUndefined();
  });

  it("keeps duplicate-id rejection from the base class", () => {
    const registry = new CommandRegistry();
    registry.register(entry({ id: "core.a.one" }));
    expect(() => registry.register(entry({ id: "core.a.one" }))).toThrow(
      /duplicate id/,
    );
  });
});

describe("normaliseShortcut", () => {
  it("unifies Mod/Ctrl/Cmd and case, stripping spaces", () => {
    expect(normaliseShortcut("Ctrl-Shift-Z")).toBe(
      normaliseShortcut("Mod-Shift-Z"),
    );
    expect(normaliseShortcut("Cmd-K")).toBe(normaliseShortcut("ctrl+k"));
  });
});
