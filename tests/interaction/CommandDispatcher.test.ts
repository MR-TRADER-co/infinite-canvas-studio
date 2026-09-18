// @vitest-environment jsdom
/**
 * Unit tests for the command dispatcher (R3B5.2 / AC3B5.3): dispatch by
 * id, enabled gating, unknown ids doing nothing, keyboard-event mapping
 * and the per-group listing the registry-rendered surfaces consume.
 */
import { describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "@/core/registry/CommandRegistry";
import type {
  CommandContext,
  CommandEntry,
} from "@/core/registry/CommandRegistry";
import {
  CommandDispatcher,
  commandContextOf,
} from "@/interaction/dispatch/CommandDispatcher";
import { shortcutFromKeyboardEvent } from "@/interaction/dispatch/keyboard";

/** Builds a minimal command entry. */
function entry(overrides: Partial<CommandEntry>): CommandEntry {
  return {
    id: "core.test.noop",
    titleKey: "a11y.undo",
    group: "edit",
    order: 0,
    execute: () => undefined,
    ...overrides,
  };
}

/** A locator resolving nothing (commands run without services). */
const emptyLocator: CommandContext["services"] = {
  tryGet: () => undefined,
};

/** A keyboard event built the jsdom way. */
function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("CommandDispatcher", () => {
  it("executes a registered command by id", () => {
    const registry = new CommandRegistry();
    const execute = vi.fn();
    registry.register(entry({ id: "core.test.ping", execute }));
    const dispatcher = new CommandDispatcher(registry);
    expect(
      dispatcher.dispatch("core.test.ping", commandContextOf(emptyLocator)),
    ).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does nothing for UNKNOWN ids (no throw, no effects)", () => {
    const registry = new CommandRegistry();
    const warn = vi.fn();
    const dispatcher = new CommandDispatcher(registry, { warn });
    expect(
      dispatcher.dispatch("core.test.missing", commandContextOf(emptyLocator)),
    ).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown command"),
    );
  });

  it("skips disabled commands (isEnabled false, execute never runs)", () => {
    const registry = new CommandRegistry();
    const execute = vi.fn();
    registry.register(
      entry({ id: "core.test.gated", execute, isEnabled: () => false }),
    );
    const dispatcher = new CommandDispatcher(registry);
    expect(
      dispatcher.dispatch("core.test.gated", commandContextOf(emptyLocator)),
    ).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("dispatches a registered shortcut in any notation", () => {
    const registry = new CommandRegistry();
    const execute = vi.fn();
    registry.register(
      entry({ id: "core.test.shortcut", shortcut: "Mod-F", execute }),
    );
    const dispatcher = new CommandDispatcher(registry);
    expect(
      dispatcher.dispatchShortcut("ctrl-f", commandContextOf(emptyLocator)),
    ).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("unregistered SHORTCUTS do nothing (AC3B5.3)", () => {
    const registry = new CommandRegistry();
    const dispatcher = new CommandDispatcher(registry);
    expect(
      dispatcher.dispatchShortcut("Mod-F", commandContextOf(emptyLocator)),
    ).toBe(false);
    expect(
      dispatcher.dispatchShortcut("v", commandContextOf(emptyLocator)),
    ).toBe(false);
  });

  it("maps physical keyboard events to shortcuts and executes them", () => {
    const registry = new CommandRegistry();
    const undo = vi.fn();
    const save = vi.fn();
    registry.register(
      entry({ id: "core.edit.undo", shortcut: "Mod-Z", execute: undo }),
    );
    registry.register(
      entry({ id: "core.edit.save", shortcut: "Mod-S", execute: save }),
    );
    const dispatcher = new CommandDispatcher(registry);
    expect(
      dispatcher.dispatchKeyboardEvent(
        keyEvent({ code: "KeyZ", ctrlKey: true }),
        commandContextOf(emptyLocator),
      ),
    ).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(
      dispatcher.dispatchKeyboardEvent(
        keyEvent({ code: "KeyS", ctrlKey: true, shiftKey: true }),
        commandContextOf(emptyLocator),
      ),
    ).toBe(false); // Mod-Shift-S is not registered
    expect(save).not.toHaveBeenCalled();
  });

  it("lists a group's commands in order (the toolbar model)", () => {
    const registry = new CommandRegistry();
    registry.register(
      entry({ id: "core.sel.b", group: "selection", order: 2 }),
    );
    registry.register(
      entry({ id: "core.sel.a", group: "selection", order: 1 }),
    );
    registry.register(entry({ id: "core.other.x", group: "edit", order: 0 }));
    const dispatcher = new CommandDispatcher(registry);
    expect(
      dispatcher.commandsInGroup("selection").map((command) => command.id),
    ).toEqual(["core.sel.a", "core.sel.b"]);
  });

  it("A DUMMY command registered later appears in the group (AC3B5.2 seam)", () => {
    const registry = new CommandRegistry();
    const dispatcher = new CommandDispatcher(registry);
    registry.register(
      entry({ id: "core.sel.base", group: "selection", order: 0 }),
    );
    // The "toolbar" re-reads on registration (the useCommandGroup contract):
    let visible = dispatcher
      .commandsInGroup("selection")
      .map((command) => command.id);
    expect(visible).toEqual(["core.sel.base"]);
    registry.register(
      entry({ id: "core.sel.dummy", group: "selection", order: 5 }),
    );
    visible = dispatcher
      .commandsInGroup("selection")
      .map((command) => command.id);
    expect(visible).toEqual(["core.sel.base", "core.sel.dummy"]);
    // …and the dummy responds to its shortcut without any surface edits:
    const execute = vi.fn();
    registry.register(
      entry({
        id: "core.sel.kbd",
        group: "selection",
        shortcut: "Mod-J",
        execute,
      }),
    );
    expect(
      dispatcher.dispatchShortcut("Mod-J", commandContextOf(emptyLocator)),
    ).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("shortcutFromKeyboardEvent", () => {
  it("maps physical codes to canonical parts", () => {
    expect(
      shortcutFromKeyboardEvent(keyEvent({ code: "KeyZ", ctrlKey: true })),
    ).toBe("Mod-z");
    expect(
      shortcutFromKeyboardEvent(
        keyEvent({ code: "KeyZ", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe("Mod-Shift-z");
    expect(shortcutFromKeyboardEvent(keyEvent({ code: "Escape" }))).toBe(
      "escape",
    );
    expect(shortcutFromKeyboardEvent(keyEvent({ code: "Space" }))).toBe(
      "space",
    );
    expect(
      shortcutFromKeyboardEvent(
        keyEvent({ code: "BracketRight", ctrlKey: true }),
      ),
    ).toBe("Mod-bracketright");
  });
});
