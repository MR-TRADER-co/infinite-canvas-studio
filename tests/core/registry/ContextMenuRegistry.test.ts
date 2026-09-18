/**
 * ContextMenuRegistry unit tests (R6.2 / AC6.7 / AC6.8): target matching
 * (region, objectType narrowing, the `"*"` wildcard), merge ordering
 * (order asc, registration order tiebreak), separator collapsing, submenu
 * builders (run at build time, empty dropped) and the SEAM PROOF — a
 * dummy contribution registered for any target appears in the built menu
 * with ZERO edits to the menu-building code.
 */
import { describe, expect, it } from "vitest";
import {
  ContextMenuRegistry,
  type ResolvedMenuItem,
} from "@/core/registry/ContextMenuRegistry";

/** Registers one command contribution. */
function addCommand(
  registry: ContextMenuRegistry,
  id: string,
  target: Parameters<ContextMenuRegistry["register"]>[0]["target"],
  commandId: string,
  order: number,
): void {
  registry.register({
    id,
    target,
    order,
    item: { kind: "command", commandId },
  });
}

describe("ContextMenuRegistry.buildMenu (R6.2 merging)", () => {
  it("merges contributions for the target region in order", () => {
    const registry = new ContextMenuRegistry();
    addCommand(registry, "a", { region: "canvas" }, "core.a", 10);
    addCommand(registry, "b", { region: "canvas" }, "core.b", 20);
    addCommand(registry, "t", { region: "table" }, "core.t", 5);
    const menu = registry.buildMenu({ region: "canvas" });
    expect(menu.map((entry) => entry.kind)).toEqual(["command", "command"]);
    expect(menu[0]).toMatchObject({ kind: "command", commandId: "core.a" });
    expect(menu[1]).toMatchObject({ kind: "command", commandId: "core.b" });
    expect(registry.buildMenu({ region: "table" })).toHaveLength(1);
  });

  it("sorts by order with registration order as the stable tiebreak", () => {
    const registry = new ContextMenuRegistry();
    addCommand(registry, "first", { region: "canvas" }, "core.first", 5);
    addCommand(registry, "second", { region: "canvas" }, "core.second", 5);
    addCommand(registry, "third", { region: "canvas" }, "core.third", 1);
    const menu = registry.buildMenu({ region: "canvas" });
    expect(
      menu
        .filter((entry) => entry.kind === "command")
        .map((entry) => (entry as { commandId: string }).commandId),
    ).toEqual(["core.third", "core.first", "core.second"]);
  });

  it("collapses doubled, leading and trailing separators", () => {
    const registry = new ContextMenuRegistry();
    registry.register({
      id: "lead",
      target: { region: "canvas" },
      order: 0,
      item: { kind: "separator" },
    });
    addCommand(registry, "a", { region: "canvas" }, "core.a", 1);
    registry.register({
      id: "sep1",
      target: { region: "canvas" },
      order: 2,
      item: { kind: "separator" },
    });
    registry.register({
      id: "sep2",
      target: { region: "canvas" },
      order: 3,
      item: { kind: "separator" },
    });
    addCommand(registry, "b", { region: "canvas" }, "core.b", 4);
    registry.register({
      id: "trail",
      target: { region: "canvas" },
      order: 5,
      item: { kind: "separator" },
    });
    const menu = registry.buildMenu({ region: "canvas" });
    expect(menu.map((entry) => entry.kind)).toEqual([
      "command",
      "separator",
      "command",
    ]);
  });

  it("runs submenu builders at build time and drops empty submenus", () => {
    const registry = new ContextMenuRegistry();
    let built = 0;
    registry.register({
      id: "sub",
      target: { region: "table" },
      order: 0,
      item: {
        kind: "submenu",
        titleKey: "table.rows",
        build: () => {
          built += 1;
          return [
            { kind: "command", commandId: "core.table.insertRowAbove" },
            { kind: "separator" },
            { kind: "separator" },
            { kind: "command", commandId: "core.table.deleteRow" },
          ];
        },
      },
    });
    registry.register({
      id: "empty",
      target: { region: "table" },
      order: 1,
      item: {
        kind: "submenu",
        titleKey: "table.preset",
        build: () => [],
      },
    });
    const menu = registry.buildMenu({ region: "table" });
    expect(built).toBe(1);
    expect(menu).toHaveLength(1);
    const submenuEntry = menu[0];
    expect(submenuEntry?.kind).toBe("submenu");
    if (submenuEntry?.kind === "submenu") {
      expect(submenuEntry.titleKey).toBe("table.rows");
      expect(submenuEntry.children.map((child) => child.kind)).toEqual([
        "command",
        "separator",
        "command",
      ]);
    }
  });

  it("rejects duplicate contribution ids at registration", () => {
    const registry = new ContextMenuRegistry();
    addCommand(registry, "dup", { region: "canvas" }, "core.a", 0);
    expect(() =>
      addCommand(registry, "dup", { region: "canvas" }, "core.b", 1),
    ).toThrow(/duplicate id "dup"/);
  });

  it("builds an empty menu when nothing matches", () => {
    const registry = new ContextMenuRegistry();
    addCommand(registry, "a", { region: "table" }, "core.a", 0);
    expect(registry.buildMenu({ region: "text" })).toEqual([]);
    expect(registry.buildMenu({ region: "canvas" })).toEqual([]);
  });
});

describe("objectType narrowing (R6.2 targets)", () => {
  it("objectType-scoped contributions only match their kind", () => {
    const registry = new ContextMenuRegistry();
    addCommand(
      registry,
      "edit",
      { region: "canvas", objectType: "textBox" },
      "core.text.editSelection",
      0,
    );
    addCommand(
      registry,
      "generic",
      { region: "canvas" },
      "core.selection.selectAll",
      1,
    );
    // The textBox target sees both; other kinds/empty canvas see one.
    expect(
      registry.buildMenu({ region: "canvas", objectType: "textBox" }),
    ).toHaveLength(2);
    expect(
      registry.buildMenu({ region: "canvas", objectType: "shape" }),
    ).toHaveLength(1);
    expect(registry.buildMenu({ region: "canvas" })).toHaveLength(1);
  });

  it('the "*" wildcard matches any object hit but not empty canvas', () => {
    const registry = new ContextMenuRegistry();
    addCommand(
      registry,
      "ops",
      { region: "canvas", objectType: "*" },
      "core.selection.duplicate",
      0,
    );
    expect(
      registry.buildMenu({ region: "canvas", objectType: "rect" }),
    ).toHaveLength(1);
    expect(
      registry.buildMenu({ region: "canvas", objectType: "connector" }),
    ).toHaveLength(1);
    expect(registry.buildMenu({ region: "canvas" })).toHaveLength(0);
  });

  it("objectType is ignored for non-canvas regions", () => {
    const registry = new ContextMenuRegistry();
    addCommand(
      registry,
      "odd",
      { region: "table", objectType: "textBox" },
      "core.table.deleteTable",
      0,
    );
    // Table targets never carry an objectType — the narrowing drops it.
    expect(registry.buildMenu({ region: "table" })).toHaveLength(0);
  });
});

describe("AC6.7 — the context-menu seam", () => {
  it("a dummy contribution appears for any target WITHOUT touching menu-building code", () => {
    const registry = new ContextMenuRegistry();
    addCommand(
      registry,
      "core.one",
      { region: "table" },
      "core.table.mergeCells",
      0,
    );

    // ── THE SEAM ── a late-registered dummy item joins the SAME menu.
    addCommand(
      registry,
      "plugin.greeting",
      { region: "table" },
      "plugin.say-hello",
      50,
    );

    const menu = registry.buildMenu({ region: "table" });
    expect(menu).toHaveLength(2);
    const last = menu[1];
    expect(last).toMatchObject({
      kind: "command",
      commandId: "plugin.say-hello",
    });

    // Any other target stays untouched.
    expect(registry.buildMenu({ region: "canvas" })).toHaveLength(0);
  });

  it("late registration re-renders surfaces through onRegistered", () => {
    const registry = new ContextMenuRegistry();
    addCommand(registry, "a", { region: "canvas" }, "core.a", 0);
    const seen: string[] = [];
    const unsubscribe = registry.onRegistered((id) => seen.push(id));
    addCommand(registry, "b", { region: "canvas" }, "core.b", 1);
    expect(seen).toEqual(["b"]);
    expect(registry.buildMenu({ region: "canvas" })).toHaveLength(2);
    unsubscribe();
    addCommand(registry, "c", { region: "canvas" }, "core.c", 2);
    expect(seen).toEqual(["b"]);
    expect(registry.buildMenu({ region: "canvas" })).toHaveLength(3);
  });
});

describe("the app's registered contributions (R6.2 completeness)", () => {
  it("the table menu carries every R6.2 action as a command contribution", async () => {
    const { registerContextMenuContributions } =
      await import("@/ui/contextMenu/contributions");
    const registry = registerContextMenuContributions(
      new ContextMenuRegistry(),
    );
    const menu = registry.buildMenu({ region: "table" });
    const leafIds = new Set<string>();
    const collect = (entries: readonly ResolvedMenuItem[]): void => {
      for (const entry of entries) {
        if (entry.kind === "command") {
          leafIds.add(entry.commandId);
        } else if (entry.kind === "submenu") {
          collect(entry.children);
        }
      }
    };
    collect(menu);
    // Insert row/column (above/below, left/right), delete row/column/table,
    // merge, split (h + v), headers, direction, alignment, distribution.
    for (const commandId of [
      "core.table.insertRowAbove",
      "core.table.insertRowBelow",
      "core.table.deleteRow",
      "core.table.insertColumnLeft",
      "core.table.insertColumnRight",
      "core.table.deleteColumn",
      "core.table.deleteTable",
      "core.table.mergeCells",
      "core.table.splitCellHorizontal",
      "core.table.splitCellVertical",
      "core.table.toggleHeaderRow",
      "core.table.toggleHeaderColumn",
      "core.table.toggleDirection",
      "core.table.distributeColumns",
      "core.table.alignCellTop",
      "core.table.alignCellMiddle",
      "core.table.alignCellBottom",
    ]) {
      expect(leafIds.has(commandId), commandId).toBe(true);
    }
  });

  it("canvas/text/object menus register without id clashes", async () => {
    const { registerContextMenuContributions } =
      await import("@/ui/contextMenu/contributions");
    expect(() =>
      registerContextMenuContributions(new ContextMenuRegistry()),
    ).not.toThrow();
  });
});
