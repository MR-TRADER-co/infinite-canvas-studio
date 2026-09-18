"use client";

/**
 * React bindings over the command layer (R3B5.2): resolve the app's
 * CommandDispatcher, dispatch by id with a ready context, and subscribe
 * to registry changes so surfaces render FROM the registry (a command
 * registered after boot appears with ZERO edits to the surface code —
 * AC3B5.2's seam proof).
 */
import { useEffect, useState } from "react";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import type { CommandEntry } from "@/core/registry/CommandRegistry";
import type { CommandDispatcher } from "@/interaction/dispatch/CommandDispatcher";
import { commandContextOf } from "@/interaction/dispatch/CommandDispatcher";

/**
 * @returns the app's dispatcher, or null before boot.
 */
export function getDispatcher(): CommandDispatcher | null {
  return AppContext.getDefault().tryGet(Services.commandDispatcher) ?? null;
}

/**
 * @param id - the `core.*` command id.
 * @returns whether the command ran (unknown/disabled → false).
 */
export function dispatchCommand(id: string): boolean {
  const dispatcher = getDispatcher();
  if (dispatcher === null) {
    return false;
  }
  return dispatcher.dispatch(id, commandContextOf(AppContext.getDefault()));
}

/**
 * @param event - a keyboard event (guards are the CALLER's concern).
 * @returns whether a command ran.
 */
export function dispatchKeyboardCommand(event: KeyboardEvent): boolean {
  const dispatcher = getDispatcher();
  if (dispatcher === null) {
    return false;
  }
  return dispatcher.dispatchKeyboardEvent(
    event,
    commandContextOf(AppContext.getDefault()),
  );
}

/**
 * @param shortcut - a shortcut string in any notation.
 * @returns whether a command ran.
 */
export function dispatchShortcutCommand(shortcut: string): boolean {
  const dispatcher = getDispatcher();
  if (dispatcher === null) {
    return false;
  }
  return dispatcher.dispatchShortcut(
    shortcut,
    commandContextOf(AppContext.getDefault()),
  );
}

/**
 * Subscribes to the command registry and returns one group's entries
 * (order-sorted). Re-renders when ANY command registers — the dynamic
 * surface AC3B5.2 tests.
 *
 * @param group - the rendering group to list.
 * @returns the group's entries (empty before boot).
 */
export function useCommandGroup(
  group: CommandEntry["group"],
): readonly CommandEntry[] {
  const [entries, setEntries] = useState<readonly CommandEntry[]>([]);

  useEffect(() => {
    const dispatcher = getDispatcher();
    if (dispatcher === null) {
      return;
    }
    const read = (): void => {
      setEntries(dispatcher.commandsInGroup(group));
    };
    read();
    return dispatcher.registry.onRegistered(read);
  }, [group]);

  return entries;
}
