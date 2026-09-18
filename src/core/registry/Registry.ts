/**
 * Generic typed registry base (R3B5.1) — the foundation of the extension
 * seams (CLAUDE.md §1.7): every extension surface (commands, panels,
 * inspector sections, later plugin contributions) stores its entries here.
 *
 * Contract:
 * - `register(id, entry)` rejects duplicate ids (registration time, never
 *   silently overwritten);
 * - `onRegistered` fires AFTER the entry is stored (late subscribers that
 *   re-read `list()` see the new entry);
 * - lookups (`get`/`has`) are O(1); `list()` returns a stable snapshot in
 *   registration order; `ids()` the id list in the same order.
 *
 * Layering: plain TypeScript only — no React/DOM/TipTap/Tauri imports.
 */

/** Function returned by {@link Registry.onRegistered}. */
export type RegistryUnsubscribe = () => void;

/** Minimal shape every registry entry must expose. */
export interface RegistryEntryMeta {
  /** Stable id in the `owner.name` namespaced scheme (§1.7.2). */
  readonly id: string;
}

/** Handler invoked after each successful registration. */
export type OnRegisteredHandler = (id: string) => void;

/**
 * The typed registry base class.
 *
 * @typeParam TEntry - the stored entry type (must expose its `id`).
 */
export class Registry<TEntry extends RegistryEntryMeta> {
  /** Entries by id (insertion-ordered). */
  private readonly entries = new Map<string, TEntry>();

  /** Late-registration listeners. */
  private readonly registeredHandlers = new Set<OnRegisteredHandler>();

  /** Human-readable surface name used in error messages. */
  public readonly surface: string;

  /**
   * @param surface - the registry's surface name (e.g. "commands").
   */
  public constructor(surface: string) {
    this.surface = surface;
  }

  /**
   * Registers one entry.
   *
   * @param entry - the entry to store (its id must be non-empty and not
   *        already taken).
   * @returns this registry (chaining).
   * @throws Error when the id is empty or already registered.
   */
  public register(entry: TEntry): this {
    const id = entry.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(
        `[${this.surface}] registry entries require a non-empty id`,
      );
    }
    if (this.entries.has(id)) {
      throw new Error(
        `[${this.surface}] duplicate id "${id}" — already registered`,
      );
    }
    this.entries.set(id, entry);
    for (const handler of [...this.registeredHandlers]) {
      handler(id);
    }
    return this;
  }

  /**
   * @param id - the entry id.
   * @returns the entry, or undefined when the id is not registered.
   */
  public get(id: string): TEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * @param id - the entry id.
   * @returns whether the id is registered.
   */
  public has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * @returns every registered entry in registration order.
   */
  public list(): readonly TEntry[] {
    return [...this.entries.values()];
  }

  /**
   * @returns every registered id in registration order.
   */
  public ids(): readonly string[] {
    return [...this.entries.keys()];
  }

  /**
   * Subscribes to future registrations (late seam wiring, R3B5.2: a
   * toolbar re-renders when a NEW command registers).
   *
   * @param handler - invoked with the new entry's id.
   * @returns an unsubscribe function.
   */
  public onRegistered(handler: OnRegisteredHandler): RegistryUnsubscribe {
    this.registeredHandlers.add(handler);
    return () => {
      this.registeredHandlers.delete(handler);
    };
  }

  /**
   * Removes one entry (R9.5 lifecycle: a disabled plugin unregisters its
   * contributions). Idempotent: unknown ids are a no-op.
   *
   * @param id - the entry id.
   * @returns the removed entry, or undefined when it was not registered.
   */
  public unregister(id: string): TEntry | undefined {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return undefined;
    }
    this.entries.delete(id);
    return entry;
  }

  /**
   * @returns the number of registered entries.
   */
  public get size(): number {
    return this.entries.size;
  }
}
