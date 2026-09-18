"use client";

/**
 * Tool keyboard shortcuts (R2-2) — now dispatching through the SINGLE
 * CommandDispatcher (R3B5.2): the plain physical keys resolve to the
 * registered `core.tools.*` commands (their `shortcut` values are the
 * plain keys v/h/p/e/t/n/g/s/c). Guards stay here: modifiers held and
 * editable targets never reach the dispatcher.
 *
 * Matching uses `event.code` (the PHYSICAL key) so Persian keyboard
 * layouts behave identically to Latin ones.
 */
import { useEffect } from "react";
import { dispatchKeyboardCommand } from "@/ui/hooks/useCommands";
import type { ToolId } from "@/ui/store/uiStore";

/** Selector for elements that own text input (shortcut guard). */
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"]';

/**
 * Physical-key code of every tool, in toolbar display order (legacy
 * export kept for the toolbar's shortcut badges).
 *
 * `code` is a `KeyboardEvent.code` value; the latin shortcut letter
 * shown in the UI is derived as `code.slice(-1)` (e.g. `KeyV` → `V`).
 */
export const TOOL_SHORTCUTS: { code: string; tool: ToolId }[] = [
  { code: "KeyV", tool: "select" },
  { code: "KeyH", tool: "hand" },
  { code: "KeyP", tool: "pen" },
  { code: "KeyE", tool: "eraser" },
  { code: "KeyT", tool: "text" },
  { code: "KeyN", tool: "sticky" },
  { code: "KeyG", tool: "table" },
  { code: "KeyS", tool: "shape" },
  { code: "KeyC", tool: "connector" },
];

/**
 * @param code - a `KeyboardEvent.code` value (e.g. `KeyV`).
 * @returns the latin shortcut letter to show in the UI (e.g. `V`).
 */
export function shortcutLetter(code: string): string {
  return code.slice(-1);
}

/**
 * Registers a single global `keydown` listener (for the component's
 * lifetime) that dispatches the tool command bound to the pressed
 * physical key.
 *
 * @returns nothing; call once per shell (side effects only).
 */
export function useToolShortcuts(): void {
  useEffect(() => {
    /**
     * Dispatches the matching tool command on plain, unmodified presses.
     *
     * @param event - the window-level keyboard event.
     */
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(EDITABLE_SELECTOR) !== null
      ) {
        return;
      }
      // The keypress only counts (preventDefault) when a command actually
      // ran — this is what lets F5 open the presentation instead of the
      // browser's page reload in the web shell.
      if (dispatchKeyboardCommand(event)) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}
