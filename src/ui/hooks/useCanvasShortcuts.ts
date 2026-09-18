"use client";

/**
 * Canvas keyboard shortcuts beyond tool switching — EVERY action now
 * dispatches through the single CommandDispatcher (R3B5.2/AC3B5.3): the
 * keydown handler only owns the guards (editable-target suppression,
 * gesture priority) and translates keys to commands; execution lives in
 * the registered `core.*` catalog.
 *
 * Kept as raw gesture handlers (documented exceptions, see
 * docs/SEAMS.md): `Space` (hold-to-pan — a transient mode with tool
 * restore on release) and the arrow-key nudge (parametric dx/dy with
 * history coalescing; a command signature cannot carry per-press deltas).
 *
 * Matching uses physical `event.code`, so Persian keyboard layouts behave
 * identically. Shortcuts are suppressed inside editable targets and (for
 * Space) focused buttons, where the key has native behaviour.
 */
import { useEffect, useRef } from "react";
import { AppContext, ServiceKey } from "@/AppContext";
import { Services } from "@/App";
import { nudgeSelection } from "@/core/commands/SelectionOps";
import { appSelectionClipboard } from "@/core/clipboard/SelectionClipboard";
import { commandContextOf } from "@/interaction/dispatch/CommandDispatcher";
import { getDispatcher } from "@/ui/hooks/useCommands";
import { useUiStore } from "@/ui/store/uiStore";
import type { ToolId } from "@/ui/store/uiStore";

/** Nudge step in world units (multiplied by 10 with Shift). */
const NUDGE_STEP = 1;

/**
 * Installs the canvas shortcut listener for the lifetime of the component.
 */
export function useCanvasShortcuts(): void {
  /** Tool active before Space was pressed (restored on release). */
  const toolBeforeSpace = useRef<ToolId | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Ctrl+F opens Find & Replace EVERYWHERE — including inside the rich
      // text editor (the browser's native find is suppressed). It is checked
      // BEFORE the editable-target guard by design (R3B5.2: the command
      // core.find.open carries the shortcut).
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyF") {
        event.preventDefault();
        dispatch("core.find.open");
        return;
      }

      const target = event.target;
      if (isEditableTarget(target)) {
        return;
      }

      // Phase 23 «پل کلیپ‌بورد»: Mod-V routes by clipboard STATE. A filled
      // INTERNAL selection clipboard claims the key (the paste command
      // preventDefaults, suppressing the browser paste event); an empty
      // buffer falls through untouched so the browser's native paste
      // event reaches the import bridge (OS images AND text).
      if (
        (event.ctrlKey || event.metaKey) &&
        event.code === "KeyV" &&
        !event.shiftKey &&
        !event.altKey
      ) {
        if (appSelectionClipboard.hasContent()) {
          if (dispatch("core.edit.paste")) {
            event.preventDefault();
          }
        }
        return;
      }

      const dispatcher = getDispatcher();
      if (dispatcher === null) {
        return;
      }
      const context = commandContextOf(AppContext.getDefault());
      const toolManager = resolveService(Services.toolManager);

      if (event.code === "Space") {
        const onButton =
          target instanceof Element && target.closest("button") !== null;
        if (!event.repeat && toolBeforeSpace.current === null && !onButton) {
          event.preventDefault();
          toolBeforeSpace.current = useUiStore.getState().activeTool;
          useUiStore.getState().setActiveTool("hand");
        }
        return;
      }

      // Escape keeps its gesture priority: an in-progress tool draft (open
      // shape/pen gesture) consumes the cancel BEFORE the registered
      // core.selection.clear command runs.
      if (event.code === "Escape") {
        const consumed = toolManager?.activeTool?.onCancel?.() ?? false;
        if (consumed) {
          return;
        }
        if (dispatchKeyboard(event)) {
          event.preventDefault();
        }
        return;
      }

      // Arrow nudges: parametric gesture (dx/dy per press) — raw handler.
      if (
        event.code === "ArrowUp" ||
        event.code === "ArrowDown" ||
        event.code === "ArrowLeft" ||
        event.code === "ArrowRight"
      ) {
        const history = resolveService(Services.history);
        const scene = resolveService(Services.scene);
        const selection = resolveService(Services.selection);
        if (history === null || scene === null || selection === null) {
          return;
        }
        if (selection.isEmpty()) {
          return;
        }
        event.preventDefault();
        nudgeSelection(
          scene,
          history,
          selection,
          event.code === "ArrowLeft"
            ? -nudgeStep(event)
            : event.code === "ArrowRight"
              ? nudgeStep(event)
              : 0,
          event.code === "ArrowUp"
            ? -nudgeStep(event)
            : event.code === "ArrowDown"
              ? nudgeStep(event)
              : 0,
        );
        return;
      }

      // Everything else — undo/redo, save, zoom keys, select-all,
      // duplicate, group/ungroup, lock, z-order, delete, Enter-edit and
      // the plain tool keys — resolves through the SINGLE dispatcher; a
      // keypress only counts (preventDefault) when a command actually ran,
      // so unregistered shortcuts do nothing (AC3B5.3).
      if (dispatcher.dispatchKeyboardEvent(event, context)) {
        event.preventDefault();
      }
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "Space" && toolBeforeSpace.current !== null) {
        const previous = toolBeforeSpace.current;
        toolBeforeSpace.current = null;
        // Only restore when the space-pan tool is still active (the user
        // may have picked another tool mid-press via the toolbar).
        if (useUiStore.getState().activeTool === "hand") {
          useUiStore.getState().setActiveTool(previous);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (toolBeforeSpace.current !== null) {
        if (useUiStore.getState().activeTool === "hand") {
          useUiStore.getState().setActiveTool(toolBeforeSpace.current);
        }
        toolBeforeSpace.current = null;
      }
    };
  }, []);
}

/**
 * @param event - the keyboard event carrying the Shift modifier.
 * @returns the nudge step in world units (10 with Shift).
 */
function nudgeStep(event: KeyboardEvent): number {
  return event.shiftKey ? NUDGE_STEP * 10 : NUDGE_STEP;
}

/**
 * @param target - the event target to inspect.
 * @returns whether the target is a text-editing element.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, [contenteditable="true"]') !== null
  );
}

/**
 * Resolves a service once the composition root has booted.
 *
 * @typeParam T - the service type.
 * @param key - the service key to resolve.
 * @returns the service, or null when the app has not booted yet.
 */
function resolveService<T>(key: ServiceKey<T>): T | null {
  const service = AppContext.getDefault().tryGet(key);
  return service === undefined ? null : service;
}

/**
 * Dispatches one command by id through the app dispatcher.
 *
 * @param id - the command id.
 * @returns whether it ran.
 */
function dispatch(id: string): boolean {
  const dispatcher = getDispatcher();
  if (dispatcher === null) {
    return false;
  }
  return dispatcher.dispatch(id, commandContextOf(AppContext.getDefault()));
}

/**
 * Dispatches the current event through the app dispatcher.
 *
 * @param event - the keyboard event.
 * @returns whether a command ran.
 */
function dispatchKeyboard(event: KeyboardEvent): boolean {
  const dispatcher = getDispatcher();
  if (dispatcher === null) {
    return false;
  }
  return dispatcher.dispatchKeyboardEvent(
    event,
    commandContextOf(AppContext.getDefault()),
  );
}
