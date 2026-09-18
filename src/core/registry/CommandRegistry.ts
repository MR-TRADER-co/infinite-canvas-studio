/**
 * Command registry (R3B5.2/R3B5.3): the typed home of EVERY
 * user-invokable action — toolbar buttons, menu items, keyboard shortcuts
 * (application-level AND the floating text toolbar's actions).
 *
 * A command is `{id, titleKey (i18n), icon?, shortcut?, group, order,
 * execute(ctx), isEnabled?(ctx)}`. Ids follow the `owner.name` scheme;
 * `core.` is RESERVED for the first-party app (§1.7.2) — third-party
 * owners are rejected at registration time.
 *
 * Shortcut conflict detection happens at REGISTRATION time (the spec):
 * a second command registering the SAME shortcut is refused with a logged
 * error, so conflicts never reach the user.
 *
 * Layering: the entry carries only data + functions injected by the
 * composition layer — no UI imports here.
 */
import { Registry } from "@/core/registry/Registry";
import type { ServiceKey } from "@/AppContext";
import type { Logger } from "@/Logger";

/** The service locator handed to commands (the AppContext contract). */
export interface CommandServiceLocator {
  /** Resolves a service by its typed key (undefined before boot). */
  readonly tryGet: <T>(key: ServiceKey<T>) => T | undefined;
}

/** The context handed to `execute`/`isEnabled` (injected per host). */
export interface CommandContext {
  /** Service locator — the typed container the composition root builds. */
  readonly services: CommandServiceLocator;
}

/** Functional grouping keys used for ordered rendering. */
export type CommandGroup =
  | "edit"
  | "view"
  | "selection"
  | "insert"
  | "text.format"
  | "text.block"
  | "text.list"
  | "text.link"
  | "text.insert"
  | "find"
  | "file"
  | "export"
  | "project"
  | "table"
  | "tools";

/** Canonical keyboard shortcut string (`Mod-Z`, `Ctrl+K`, `Tab`…). */
export type CommandShortcut = string;

/** One registered user-invokable action. */
export interface CommandEntry {
  /** `owner.name` id — `core.` is reserved for the app itself (§1.7.2). */
  readonly id: string;
  /** i18n key of the human title (toolbars, menus, the palette). */
  readonly titleKey: string;
  /** Optional icon name (host-mapped; keeps core free of UI imports). */
  readonly icon?: string;
  /** Optional keyboard shortcut, in the Mod/Ctrl/Shift/Alt notation. */
  readonly shortcut?: CommandShortcut;
  /** Rendering group. */
  readonly group: CommandGroup;
  /** Rendering order inside the group (ascending). */
  readonly order: number;
  /** Runs the action. */
  readonly execute: (ctx: CommandContext) => void;
  /** Whether the action is currently available (default true). */
  readonly isEnabled?: (ctx: CommandContext) => boolean;
}

/** The reserved owner prefix of the first-party app (§1.7.2). */
export const CORE_OWNER = "core";

/**
 * Validates the `owner.name` id scheme: a lower-case owner plus ONE or
 * more hierarchical name segments — `core.text.bold`,
 * `core.selection.bringFront` (the spec's own examples are hierarchical).
 */
const ID_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-zA-Z][a-zA-Z0-9_-]*)+$/;

/**
 * The command registry: a `Registry<CommandEntry>` with shortcut-conflict
 * detection and reserved-owner enforcement.
 */
export class CommandRegistry extends Registry<CommandEntry> {
  /** Shortcut → command id map (conflict detection at registration). */
  private readonly shortcutOwners = new Map<CommandShortcut, string>();

  /** The logger receiving conflict diagnostics (optional). */
  private readonly logger: Pick<Logger, "error" | "warn"> | null;

  /** Whether non-`core.` owners may register (R9.5: the plugin runtime). */
  private readonly allowThirdPartyOwners: boolean;

  /**
   * @param logger - optional sink for conflict warnings (registration-time
   *        diagnostics are ALWAYS logged; the sink also mirrors them).
   * @param allowThirdPartyOwners - whether plugin owners may register
   *        (false until the Phase 9 plugin runtime constructs it open).
   */
  public constructor(
    logger?: Pick<Logger, "error" | "warn">,
    allowThirdPartyOwners: boolean = false,
  ) {
    super("commands");
    this.logger = logger ?? null;
    this.allowThirdPartyOwners = allowThirdPartyOwners;
  }

  /**
   * Registers a command, enforcing the id scheme, the reserved `core.`
   * owner policy and shortcut uniqueness.
   *
   * @param entry - the command to register.
   * @returns this registry (chaining).
   * @throws Error on invalid/duplicate ids, reserved-owner misuse or
   *         shortcut conflicts.
   */
  public override register(entry: CommandEntry): this {
    const id = entry.id;
    if (!ID_PATTERN.test(id)) {
      throw new Error(
        `[commands] id "${id}" must follow the owner.name scheme (e.g. core.text.bold)`,
      );
    }
    const owner = id.split(".")[0] ?? "";
    if (owner !== CORE_OWNER && !this.allowThirdPartyOwners) {
      // First-party commands carry the reserved `core.` owner; third-party
      // owners arrive with the Phase 9 plugin runtime (the runtime opens
      // the registry through its constructor flag and COMPOSES plugin ids
      // as `<pluginOwner>.<name>` itself — owner forgery is impossible).
      throw new Error(
        `[commands] owner "${owner}" is not allowed here — "${CORE_OWNER}." is reserved for core commands (plugin commands arrive in Phase 9)`,
      );
    }
    if (entry.shortcut !== undefined && entry.shortcut.length > 0) {
      const shortcut = normaliseShortcut(entry.shortcut);
      const holder = this.shortcutOwners.get(shortcut);
      if (holder !== undefined) {
        const message = `[commands] shortcut conflict: "${shortcut}" already bound to "${holder}" — refusing "${id}"`;
        this.logger?.error(message);
        throw new Error(message);
      }
      this.shortcutOwners.set(shortcut, id);
    }
    return super.register(entry);
  }

  /**
   * @param shortcut - a shortcut in any notation.
   * @returns the command id bound to it, or undefined.
   */
  public commandForShortcut(shortcut: CommandShortcut): string | undefined {
    return this.shortcutOwners.get(normaliseShortcut(shortcut));
  }

  /**
   * Removes one entry AND its shortcut binding (R9.5 lifecycle).
   * Idempotent: unknown ids are a no-op.
   *
   * @param id - the command id.
   * @returns the removed entry, or undefined when it was not registered.
   */
  public override unregister(id: string): CommandEntry | undefined {
    const entry = this.get(id);
    if (entry === undefined) {
      return undefined;
    }
    super.unregister(id);
    if (entry.shortcut !== undefined) {
      const shortcut = normaliseShortcut(entry.shortcut);
      if (this.shortcutOwners.get(shortcut) === id) {
        this.shortcutOwners.delete(shortcut);
      }
    }
    return entry;
  }

  /**
   * @returns every bound shortcut (diagnostics + the palette hints).
   */
  public shortcuts(): ReadonlyMap<CommandShortcut, string> {
    return this.shortcutOwners;
  }
}

/**
 * Normalises a shortcut string for comparison (`Mod-`≡`Ctrl-`≡`Cmd-` on
 * Windows, `+`≡`-` separators, spacing/case-insensitive).
 *
 * @param shortcut - the raw shortcut notation.
 * @returns the canonical form.
 */
export function normaliseShortcut(shortcut: string): string {
  return shortcut
    .trim()
    .replace(/\+/g, "-")
    .replace(/\s+/g, "")
    .replace(/cmd-/gi, "Mod-")
    .replace(/mod-/gi, "Mod-")
    .replace(/ctrl-/gi, "Mod-")
    .toLowerCase();
}
