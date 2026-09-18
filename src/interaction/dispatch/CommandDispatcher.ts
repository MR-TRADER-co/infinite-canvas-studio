/**
 * Command dispatcher (R3B5.2): the SINGLE funnel every user-invokable
 * action flows through — toolbar buttons, menu items and the global
 * keyboard handler all call `dispatch`/`dispatchKeyboardEvent`, and every
 * execution path is therefore identical (AC3B5.2's "executing from the
 * palette behaves identically to toolbar/shortcut execution").
 *
 * Unregistered shortcuts do nothing (false return, no throw — AC3B5.3);
 * disabled commands report false without side effects. Diagnostics log
 * through the injected logger when present.
 *
 * Layering: interaction-level — may import core/ (the registry), never ui/.
 */
import type {
  CommandContext,
  CommandEntry,
  CommandRegistry,
} from "@/core/registry/CommandRegistry";
import { shortcutFromKeyboardEvent } from "@/interaction/dispatch/keyboard";

/** Diagnostic sink (optional). */
export interface DispatcherLogger {
  /** Warns about unknown ids / disabled dispatches. */
  warn: (message: string) => void;
}

/** Executes registered commands. */
export class CommandDispatcher {
  /**
   * @param registry - the command registry this dispatcher executes from.
   * @param logger - optional diagnostics sink.
   */
  public constructor(
    public readonly registry: CommandRegistry,
    private readonly logger?: DispatcherLogger,
  ) {}

  /**
   * Executes one command by id.
   *
   * @param id - the `owner.name` command id.
   * @param ctx - the execution context (service locator).
   * @returns whether the command ran (false = unknown or disabled).
   */
  public dispatch(id: string, ctx: CommandContext): boolean {
    const entry = this.registry.get(id);
    if (entry === undefined) {
      this.logger?.warn(`[dispatcher] unknown command "${id}"`);
      return false;
    }
    if (entry.isEnabled !== undefined && !entry.isEnabled(ctx)) {
      return false;
    }
    entry.execute(ctx);
    return true;
  }

  /**
   * Executes the command bound to a shortcut string (any notation).
   *
   * @param shortcut - the shortcut (normalised internally).
   * @param ctx - the execution context.
   * @returns whether a command ran.
   */
  public dispatchShortcut(shortcut: string, ctx: CommandContext): boolean {
    const id = this.registry.commandForShortcut(shortcut);
    if (id === undefined) {
      return false; // unregistered shortcuts do nothing (AC3B5.3)
    }
    return this.dispatch(id, ctx);
  }

  /**
   * Maps a keyboard event to its canonical shortcut and executes the bound
   * command. The CALLER owns preconditions (editable-target guards,
   * gesture priority) — this method only resolves and executes.
   *
   * @param event - the physical keyboard event.
   * @param ctx - the execution context.
   * @returns whether a command ran.
   */
  public dispatchKeyboardEvent(
    event: KeyboardEvent,
    ctx: CommandContext,
  ): boolean {
    return this.dispatchShortcut(shortcutFromKeyboardEvent(event), ctx);
  }

  /**
   * Lists the commands of one rendering group in `order` (the model the
   * registry-rendered toolbars consume — AC3B5.2's dynamic surface).
   *
   * @param group - the requested group.
   * @returns the group's entries sorted by `order`, then registration.
   */
  public commandsInGroup(
    group: CommandEntry["group"],
  ): readonly CommandEntry[] {
    return this.registry
      .list()
      .filter((entry) => entry.group === group)
      .sort((a, b) => a.order - b.order);
  }
}

/**
 * Builds the canonical command context over a service locator.
 *
 * @param services - the locator (the app's `AppContext` in production).
 * @returns the dispatch context.
 */
export function commandContextOf(
  services: CommandContext["services"],
): CommandContext {
  return { services };
}
