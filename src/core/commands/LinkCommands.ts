/**
 * Link commands (pack R11.6): manual link create/remove as FIRST-CLASS
 * reversible commands — one undo step each, riding the SAME history
 * manager as every scene mutation.
 *
 * The commands mutate ONLY the {@link LinkRegistry} (§1.7.8: the single
 * source of truth); projections (knowledge index rows, backlinks, graph
 * edges) re-derive from the registry + scene on the next (scheduled)
 * rebuild, so undo/redo needs no projection bookkeeping at all.
 */
import type { ICommand } from "@/core/commands/Command";
import type { LinkRegistry } from "@/core/knowledge/LinkRegistry";
import type { ObjectLinkEntry } from "@/core/knowledge/LinkRegistry";

/**
 * Creates one manual link (ONE undo step).
 *
 * @param registry - the link registry (§1.7.8 store).
 * @param entry - the entry to add.
 * @returns the command (label: the Persian history row).
 */
export function addManualLinkCommand(
  registry: LinkRegistry,
  entry: ObjectLinkEntry,
): ICommand {
  return {
    label: "افزودن پیوند دستی",
    do(): void {
      registry.add(entry);
    },
    undo(): void {
      registry.remove(entry.id);
    },
    redo(): void {
      registry.add(entry);
    },
  };
}

/**
 * Removes one link entry (ONE undo step).
 *
 * @param registry - the link registry (§1.7.8 store).
 * @param entry - the entry being removed (captured for undo).
 * @returns the command (label: the Persian history row).
 */
export function removeManualLinkCommand(
  registry: LinkRegistry,
  entry: ObjectLinkEntry,
): ICommand {
  return {
    label: "حذف پیوند دستی",
    do(): void {
      registry.remove(entry.id);
    },
    undo(): void {
      registry.add(entry);
    },
    redo(): void {
      registry.remove(entry.id);
    },
  };
}

/**
 * Removes EVERY manual link of one object (the context menu's
 * «حذف پیوندهای این شیء» — still ONE undo step: a composite).
 *
 * @param registry - the link registry (§1.7.8 store).
 * @param objectId - the object whose outgoing manual links vanish.
 * @returns the composite command, or null when the object has none.
 */
export function removeAllManualLinksCommand(
  registry: LinkRegistry,
  objectId: string,
): ICommand | null {
  const entries = registry
    .outgoingOf(objectId)
    .filter((entry) => entry.kind === "manual");
  if (entries.length === 0) {
    return null;
  }
  const removed: ObjectLinkEntry[] = [];
  return {
    label: "حذف پیوندهای دستی",
    do(): void {
      removed.length = 0;
      for (const entry of entries) {
        if (registry.remove(entry.id) !== null) {
          removed.push(entry);
        }
      }
    },
    undo(): void {
      for (const entry of removed) {
        registry.add(entry);
      }
    },
    redo(): void {
      for (const entry of removed) {
        registry.remove(entry.id);
      }
    },
  };
}
