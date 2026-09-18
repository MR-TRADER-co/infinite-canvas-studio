/**
 * Context-menu registry (R6.2): context-menu items are REGISTERED
 * CONTRIBUTIONS, never hardcoded menus.
 *
 * A contribution is `{id, target, item, order}` where `target` selects the
 * menu it appears in:
 * - `{region: "canvas"}` — right-clicks on the canvas (optionally narrowed
 *   by `objectType` to the kind under the cursor — `undefined` matches
 *   every kind);
 * - `{region: "table"}` — right-clicks inside a table cell;
 * - `{region: "text"}` — right-clicks inside the rich-text editor outside
 *   tables.
 *
 * `item` is a leaf `{kind: "command", commandId}` (label/icon/disabled
 * state come from the CommandRegistry via the command's `titleKey`/`icon`),
 * a `{kind: "separator"}`, or a `{kind: "submenu", build}` whose builder
 * runs at menu-build time (so entries can depend on live state, e.g. the
 * table's direction).
 *
 * `buildMenu(target)` merges every matching contribution into ONE stable
 * list: ascending `order`, ties keep registration order; separators are
 * collapsed (never doubled, never leading/trailing).
 *
 * Layering: plain TypeScript only — no React/DOM/TipTap imports.
 */
import { Registry, type RegistryEntryMeta } from "@/core/registry/Registry";

/** The three context-menu surfaces (R6.2). */
export type ContextMenuRegion = "canvas" | "table" | "text";

/** Where a right-click happened, resolved by the host layer. */
export interface ContextMenuTarget {
  /** Which surface received the right-click. */
  readonly region: ContextMenuRegion;
  /**
   * Scene object kind under the cursor (canvas region only — null when the
   * click hit empty canvas). Contributions with `objectType` set only
   * match that kind; `undefined` contributions match every kind.
   */
  readonly objectType?: string;
}

/** A leaf item running one registered command. */
export interface ContextMenuCommandItem {
  readonly kind: "command";
  /** The `core.*` command id dispatched on activation. */
  readonly commandId: string;
}

/** A horizontal rule between groups of items. */
export interface ContextMenuSeparatorItem {
  readonly kind: "separator";
}

/** Builds a submenu's children at menu-build time (live-state aware). */
export type SubmenuBuilder = () => readonly ContextMenuChildItem[];

/** An item allowed inside a submenu (leaf command or separator). */
export type ContextMenuChildItem =
  ContextMenuCommandItem | ContextMenuSeparatorItem;

/** A nested submenu (rows/columns/alignment groups…). */
export interface ContextMenuSubmenuItem {
  readonly kind: "submenu";
  /** i18n key of the submenu title. */
  readonly titleKey: string;
  /** Optional icon name (host-mapped, same scheme as commands). */
  readonly icon?: string;
  /** Runs at build time producing the submenu's children. */
  readonly build: SubmenuBuilder;
}

/** Anything a contribution can add to a context menu. */
export type ContextMenuItemSpec =
  ContextMenuCommandItem | ContextMenuSeparatorItem | ContextMenuSubmenuItem;

/** One registered contribution (the registry seam entry). */
export interface ContextMenuContribution extends RegistryEntryMeta {
  /** Stable `owner.name` id (duplicate rejection, diagnostics). */
  readonly id: string;
  /** Which target the item appears for. */
  readonly target: ContextMenuTarget;
  /** The contributed item. */
  readonly item: ContextMenuItemSpec;
  /** Rendering order (ascending; ties keep registration order). */
  readonly order: number;
}

/** A resolved leaf: dispatch this command id. */
export interface ResolvedMenuCommand {
  readonly kind: "command";
  readonly commandId: string;
}

/** A resolved horizontal rule. */
export interface ResolvedMenuSeparator {
  readonly kind: "separator";
}

/** A resolved submenu with its children already built. */
export interface ResolvedMenuSubmenu {
  readonly kind: "submenu";
  readonly titleKey: string;
  readonly icon?: string;
  readonly children: readonly ResolvedMenuChild[];
}

/** Allowed submenu children after resolution. */
export type ResolvedMenuChild = ResolvedMenuCommand | ResolvedMenuSeparator;

/** One entry of a built menu (what a host renders). */
export type ResolvedMenuItem =
  ResolvedMenuCommand | ResolvedMenuSeparator | ResolvedMenuSubmenu;

/**
 * The context-menu registry: a {@link Registry} of contributions plus the
 * target-aware menu merger.
 */
export class ContextMenuRegistry extends Registry<ContextMenuContribution> {
  /** Human-readable surface name (inherited errors). */
  public constructor() {
    super("contextMenu");
  }

  /**
   * Builds the merged menu for a target: every matching contribution
   * (region equal; contribution `objectType` unset or equal to the
   * target's), sorted by ascending `order` with registration order as the
   * stable tiebreak; submenu builders run here; separators collapse.
   *
   * @param target - the resolved right-click target.
   * @returns the menu entries to render (empty when nothing matches).
   */
  public buildMenu(target: ContextMenuTarget): readonly ResolvedMenuItem[] {
    const matching = this.list().filter((contribution) =>
      contributionMatches(contribution, target),
    );
    // Array.prototype.sort is stable in every supported runtime, so
    // sorting by `order` alone keeps REGISTRATION order as the tiebreak —
    // the (order, registration) pair gives the spec's stable ordering.
    const ordered = [...matching].sort((a, b) => a.order - b.order);
    const items: ResolvedMenuItem[] = [];
    for (const contribution of ordered) {
      const resolved = resolveItem(contribution.item);
      if (resolved === null) {
        continue;
      }
      if (resolved.kind === "separator") {
        // Never doubled, never leading/trailing (AC-tested).
        const previous = items[items.length - 1];
        if (previous === undefined || previous.kind === "separator") {
          continue;
        }
        items.push(resolved);
        continue;
      }
      if (resolved.kind === "submenu") {
        // Drop empty submenus entirely (nothing to show).
        if (resolved.children.length === 0) {
          continue;
        }
      }
      items.push(resolved);
    }
    // Trailing separator cleanup: pop while the tail is a separator.
    while (items[items.length - 1]?.kind === "separator") {
      items.pop();
    }
    return items;
  }
}

/**
 * Whether a contribution applies to a target.
 *
 * Matching rules: the regions must be equal; the contribution's
 * `objectType` narrows canvas targets — `undefined` matches every kind,
 * `"*"` matches any non-empty object hit, a concrete kind matches itself
 * only.
 *
 * @param contribution - the registered contribution.
 * @param target - the resolved right-click target.
 * @returns whether the contribution's item joins this menu.
 */
function contributionMatches(
  contribution: ContextMenuContribution,
  target: ContextMenuTarget,
): boolean {
  if (contribution.target.region !== target.region) {
    return false;
  }
  const narrowed = contribution.target.objectType;
  if (narrowed === undefined) {
    return true;
  }
  if (target.region !== "canvas") {
    return false;
  }
  if (narrowed === "*") {
    return target.objectType !== undefined;
  }
  return narrowed === target.objectType;
}

/**
 * Resolves one contribution item (runs submenu builders).
 *
 * @param item - the contributed item.
 * @returns the resolved entry, or null for empty submenus.
 */
function resolveItem(item: ContextMenuItemSpec): ResolvedMenuItem | null {
  if (item.kind === "command" || item.kind === "separator") {
    return item;
  }
  const children: ResolvedMenuChild[] = [];
  for (const child of item.build()) {
    if (child.kind === "separator") {
      const previous = children[children.length - 1];
      if (previous === undefined || previous.kind === "separator") {
        continue;
      }
      children.push(child);
      continue;
    }
    children.push(child);
  }
  while (children[children.length - 1]?.kind === "separator") {
    children.pop();
  }
  if (children.length === 0) {
    return null;
  }
  return {
    kind: "submenu",
    titleKey: item.titleKey,
    icon: item.icon,
    children,
  };
}
