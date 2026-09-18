/**
 * Unit tests for the generic registry base (R3B5.1 / AC3B5.1):
 * registration, lookup, ordering, duplicate rejection and the
 * on-registered event.
 */
import { describe, expect, it, vi } from "vitest";
import { Registry, type RegistryEntryMeta } from "@/core/registry/Registry";

/** Minimal entry shape for the tests. */
interface PanelEntry extends RegistryEntryMeta {
  readonly label: string;
}

/** Builds a registry with the panel entry shape. */
function makeRegistry(): Registry<PanelEntry> {
  return new Registry<PanelEntry>("panels");
}

describe("Registry", () => {
  it("registers and resolves entries by id", () => {
    const registry = makeRegistry();
    registry.register({ id: "core.panel.layers", label: "Layers" });
    expect(registry.has("core.panel.layers")).toBe(true);
    expect(registry.get("core.panel.layers")?.label).toBe("Layers");
    expect(registry.get("core.panel.missing")).toBeUndefined();
  });

  it("rejects duplicate ids at registration time", () => {
    const registry = makeRegistry();
    registry.register({ id: "core.panel.layers", label: "Layers" });
    expect(() =>
      registry.register({ id: "core.panel.layers", label: "Again" }),
    ).toThrow(/duplicate id "core\.panel\.layers"/);
  });

  it("rejects empty ids", () => {
    const registry = makeRegistry();
    expect(() => registry.register({ id: "", label: "x" })).toThrow(
      /non-empty id/,
    );
  });

  it("lists entries and ids in REGISTRATION order (stable snapshots)", () => {
    const registry = makeRegistry();
    registry.register({ id: "a", label: "A" });
    registry.register({ id: "b", label: "B" });
    registry.register({ id: "c", label: "C" });
    expect(registry.ids()).toEqual(["a", "b", "c"]);
    expect(registry.list().map((entry) => entry.label)).toEqual([
      "A",
      "B",
      "C",
    ]);
    // Mutating the returned snapshot must not affect the registry.
    const snapshot = registry.list();
    expect(snapshot).toHaveLength(3);
  });

  it("fires onRegistered AFTER the entry is stored (late readers see it)", () => {
    const registry = makeRegistry();
    const handler = vi.fn(() => {
      // Inside the handler the entry must already be resolvable.
      expect(registry.get("late")).toBeDefined();
    });
    const unsubscribe = registry.onRegistered(handler);
    registry.register({ id: "late", label: "Late" });
    expect(handler).toHaveBeenCalledWith("late");
    unsubscribe();
    registry.register({ id: "late2", label: "Late2" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("supports multiple onRegistered listeners, isolated by unsubscribe", () => {
    const registry = makeRegistry();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = registry.onRegistered(first);
    registry.onRegistered(second);
    registry.register({ id: "one", label: "1" });
    offFirst();
    registry.register({ id: "two", label: "2" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("chains register calls and counts entries", () => {
    const registry = makeRegistry();
    registry
      .register({ id: "a", label: "A" })
      .register({ id: "b", label: "B" })
      .register({ id: "c", label: "C" });
    expect(registry.size).toBe(3);
    expect(registry.surface).toBe("panels");
  });
});
