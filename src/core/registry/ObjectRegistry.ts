/**
 * Object registry (R4.1, CLAUDE.md §1.7.1–§1.7.3): the ONLY dispatch
 * surface for scene-object (de)serialization.
 *
 * Every object type — core or future plugin-owned — registers one entry
 * carrying its wire `typeId` (namespaced `owner.name`, §1.7.2), its
 * in-memory `kind` discriminant, a factory, `serialize`/`deserialize`
 * adapters, a per-type wire `version` plus an optional forward-only
 * migration chain (R4.4b), and introspectable metadata (title key, owner,
 * optional Insert-Panel catalog fields, §1.7.7).
 *
 * Scene (de)serialization iterates this registry — NEVER a switch over
 * type ids (§1.7.1). An object whose typeId is not registered
 * materialises as an {@link OpaqueObject} placeholder that round-trips
 * its raw JSON verbatim (§1.7.4) — nothing is ever lost.
 *
 * Owner attribution (§1.7.5): every entry's id starts with its owner
 * prefix, so a future plugin runtime can enumerate and wholesale-remove
 * one owner's contributions (`list()` filtered by prefix).
 *
 * Layering: plain TypeScript only — no React/DOM/TipTap/Tauri imports.
 */
import { Registry, type RegistryEntryMeta } from "@/core/registry/Registry";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** The reserved owner prefix of the first-party app (§1.7.2). */
export const CORE_OBJECT_OWNER = "core";

/** One step of a per-object-type wire migration (R4.4b). */
export interface ObjectDataMigration {
  /** Object wire version this step migrates from. */
  readonly fromVersion: number;
  /** Object wire version this step migrates to. */
  readonly toVersion: number;
  /**
   * Transforms a wire payload of `fromVersion` into one of `toVersion`.
   *
   * @param data - the raw wire payload to transform.
   * @returns the transformed payload.
   */
  migrate(data: unknown): unknown;
}

/** Optional Insert-Panel catalog metadata (§1.7.7 widget catalog). */
export interface ObjectCatalogMeta {
  /** Icon name (lucide) the Insert Panel renders for this type. */
  readonly icon?: string;
  /** i18n key of the catalog card title. */
  readonly titleKey: string;
  /** Catalog group the card sorts into (e.g. "shapes", "media"). */
  readonly group: string;
  /** Order inside the catalog group (ascending). */
  readonly order: number;
  /** Optional preview hint (a CSS gradient or emoji string). */
  readonly preview?: string;
  /**
   * Card variants (R7.12): when one type covers multiple insertable
   * widgets (the shape kind's rect/ellipse), each card carries its own
   * title/icon/order and factory. Absent = the single default card
   * driven by the fields above.
   */
  readonly cards?: readonly ObjectCatalogCard[];
}

/** One insertable catalog card (§1.7.7 / R7.12). */
export interface ObjectCatalogCard {
  /** Variant key (unique inside the entry). */
  readonly key: string;
  /** Icon name (lucide) of this card. */
  readonly icon?: string;
  /** i18n key of the card title. */
  readonly titleKey: string;
  /** Order inside the entry (ascending). */
  readonly order: number;
  /** Optional preview hint (a CSS gradient or emoji string). */
  readonly preview?: string;
  /** Produces the default instance for this card (§1.7.7 factory). */
  factory(): SceneObjectData;
}

/**
 * One registered object type (R4.1).
 *
 * @typeParam TData - the in-memory object data the type materialises.
 */
export interface ObjectRegistryEntry<
  TData extends SceneObjectData = SceneObjectData,
> extends RegistryEntryMeta {
  /**
   * Wire type id in the `owner.name` scheme (§1.7.2) — this IS the
   * registry id and the value stored in every `.icb` object payload.
   */
  readonly id: string;
  /** In-memory `kind` discriminant the entry (de)serializes for. */
  readonly kind: string;
  /** i18n key of the human-readable type title (introspectable, §1.7.3). */
  readonly titleKey: string;
  /** Per-type wire format version (R4.4b); starts at 1. */
  readonly version: number;
  /** Forward-only per-type migration chain (optional, R4.4b). */
  readonly migrations?: readonly ObjectDataMigration[];
  /** Creates a default instance (factories for the future Insert Panel). */
  factory(): TData;
  /**
   * Maps an in-memory object onto its plain-JSON wire payload. The
   * returned record MUST carry `typeId: entry.id` and `typeVersion`.
   *
   * @param object - the in-memory object data.
   * @returns the wire payload (JSON-serialisable).
   */
  serialize(object: TData): Record<string, unknown>;
  /**
   * Materialises an in-memory object from its (already migrated) wire
   * payload. Returning null refuses the object — the caller keeps the
   * raw JSON as an opaque placeholder instead (nothing is ever lost).
   *
   * @param raw - the migrated wire payload.
   * @returns the in-memory object data, or null when the payload is not
   *          a well-formed object of this type.
   */
  deserialize(raw: Record<string, unknown>): TData | null;
  /** Optional Insert-Panel catalog metadata (§1.7.7). */
  readonly catalog?: ObjectCatalogMeta;
}

/**
 * The object-type registry: the single (de)serialization dispatch surface.
 *
 * Entries are indexed BOTH by wire `typeId` (load path) and by in-memory
 * `kind` (save path); registering a duplicate of either is rejected at
 * registration time. Ids follow the `owner.name` scheme with the reserved
 * `core.` owner enforced (§1.7.2) — third-party owners arrive with the
 * plugin runtime (Phases 9–10).
 */
export class ObjectRegistry extends Registry<ObjectRegistryEntry> {
  /** Entries by in-memory kind (save-path index). */
  private readonly byKind = new Map<string, ObjectRegistryEntry>();

  /**
   * @param allowThirdPartyOwners - whether non-`core.` owners may register
   *        (false until the Phase 9 plugin runtime flips it).
   */
  public constructor(private readonly allowThirdPartyOwners: boolean = false) {
    super("objects");
  }

  /**
   * Registers one object type, enforcing the id scheme, the reserved
   * `core.` owner policy, kind uniqueness and id uniqueness.
   *
   * @param entry - the object type registration.
   * @returns this registry (chaining).
   * @throws Error on invalid/duplicate ids, duplicate kinds, reserved-owner
   *         misuse, or a non-integer/`< 1` wire version.
   */
  public override register(entry: ObjectRegistryEntry): this {
    const id = entry.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`[objects] registry entries require a non-empty id`);
    }
    const owner = id.split(".")[0] ?? "";
    if (owner !== CORE_OBJECT_OWNER && !this.allowThirdPartyOwners) {
      throw new Error(
        `[objects] id "${id}" must follow the owner.name scheme with the reserved ` +
          `"core." owner (third-party owners arrive with the plugin runtime, §1.7.2)`,
      );
    }
    if (id.includes("..") || id.endsWith(".") || id.startsWith(".")) {
      throw new Error(`[objects] id "${id}" must follow the owner.name scheme`);
    }
    if (typeof entry.kind !== "string" || entry.kind.length === 0) {
      throw new Error(`[objects] entry "${id}" requires a non-empty kind`);
    }
    if (!Number.isInteger(entry.version) || entry.version < 1) {
      throw new Error(
        `[objects] entry "${id}" requires an integer version >= 1`,
      );
    }
    if (this.hasTypeId(id)) {
      throw new Error(`[objects] duplicate id "${id}" — already registered`);
    }
    if (this.byKind.has(entry.kind)) {
      throw new Error(
        `[objects] duplicate kind "${entry.kind}" — already registered by ` +
          `"${this.byKind.get(entry.kind)?.id ?? "?"}"`,
      );
    }
    super.register(entry);
    this.byKind.set(entry.kind, entry);
    return this;
  }

  /**
   * @param typeId - the wire type id (load-path lookup).
   * @returns the entry registered for the id, or undefined.
   */
  public entryForTypeId(typeId: string): ObjectRegistryEntry | undefined {
    return this.get(typeId);
  }

  /**
   * @param kind - the in-memory kind discriminant (save-path lookup).
   * @returns the entry registered for the kind, or undefined.
   */
  public entryForKind(kind: string): ObjectRegistryEntry | undefined {
    return this.byKind.get(kind);
  }

  /**
   * @param typeId - the wire type id.
   * @returns whether a type with the id is registered.
   */
  public hasTypeId(typeId: string): boolean {
    return this.has(typeId);
  }

  /**
   * @param owner - an owner prefix (e.g. `core`).
   * @returns every entry whose id starts with `owner.` (§1.7.5 owner
   *          attribution — the wholesale-unregister enumeration).
   */
  public entriesOfOwner(owner: string): readonly ObjectRegistryEntry[] {
    const prefix = `${owner}.`;
    return this.list().filter((entry) => entry.id.startsWith(prefix));
  }

  /**
   * Removes one entry AND its kind index (R9.5: a disabled plugin's types
   * leave the registry — existing objects reload as opaque placeholders).
   * Idempotent: unknown ids are a no-op.
   *
   * @param id - the wire type id.
   * @returns the removed entry, or undefined when it was not registered.
   */
  public override unregister(id: string): ObjectRegistryEntry | undefined {
    const entry = this.get(id);
    if (entry === undefined) {
      return undefined;
    }
    super.unregister(id);
    if (this.byKind.get(entry.kind) === entry) {
      this.byKind.delete(entry.kind);
    }
    return entry;
  }

  /**
   * Runs one entry's per-type migration chain forward (R4.4b).
   *
   * @param entry - the target type entry.
   * @param data - the wire payload read from the file.
   * @param fromVersion - the payload's declared type version.
   * @returns the migrated payload, or null when the chain is broken (a
   *          step is missing) or the version is from an unknown future.
   */
  public static runTypeMigrations(
    entry: ObjectRegistryEntry,
    data: unknown,
    fromVersion: number,
  ): unknown {
    const chain = entry.migrations ?? [];
    if (fromVersion === entry.version) {
      return data;
    }
    // Unknown FUTURE per-type version: never guess — refuse (the caller
    // keeps the raw payload as an opaque placeholder).
    if (fromVersion > entry.version || fromVersion < 1) {
      return null;
    }
    let current = data;
    let version = fromVersion;
    for (let guard = 0; version < entry.version; guard += 1) {
      if (guard > chain.length) {
        return null;
      }
      const step = chain.find((migration) => migration.fromVersion === version);
      if (step === undefined) {
        return null;
      }
      current = step.migrate(current);
      version = step.toVersion;
    }
    return current;
  }
}
