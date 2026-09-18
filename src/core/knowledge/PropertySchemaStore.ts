/**
 * The project-level property schema store (Knowledge Pack R11.3): the
 * memory of every property NAME the project has seen, mapped to its
 * type (+ `select` options), so the same name edits with the same
 * editor on every object and the Phase-12 query engine can offer
 * typed filters.
 *
 * Types are INFERRED on first use (`inferPropertyType`) when a
 * property value arrives without a schema entry; explicit assignment
 * (the PropertiesSection's add-row) always wins and is remembered.
 * The store is NOT part of undo history — it is document metadata,
 * like the styles section (DECISIONS #52's precedent): a schema edit
 * re-types EDITORS, never values.
 *
 * Persists as the project file's `propertySchema` section (schema v3,
 * optional field — absent on older files means "no known fields").
 *
 * Pure module: no DOM, no React, no Tauri — fully node-testable.
 */
import {
  EMPTY_PROPERTY_SCHEMA_SECTION,
  cleanPropertyName,
  inferPropertyType,
  normalizeSchemaSection,
  type PropertyFieldSchema,
  type PropertySchemaSection,
  type PropertyType,
  type PropertyValue,
} from "@/core/model/Properties";

/** Change-listener callback (fired after every mutation). */
export type SchemaChangeListener = () => void;

/**
 * The property-schema store service.
 */
export class PropertySchemaStore {
  /** The known fields (insertion-ordered: first-seen first). */
  private readonly fields = new Map<string, PropertyFieldSchema>();

  /** The change listeners (the styles-registry subscription pattern). */
  private readonly listeners = new Set<SchemaChangeListener>();

  /**
   * Looks up one field's schema.
   *
   * @param name - the property name.
   * @returns the schema entry, or null when the name is unknown.
   */
  public field(name: string): PropertyFieldSchema | null {
    return this.fields.get(cleanPropertyName(name)) ?? null;
  }

  /**
   * Lists every known field (insertion order = first-seen order).
   *
   * @returns the [name, schema] pairs.
   */
  public list(): readonly (readonly [string, PropertyFieldSchema])[] {
    return [...this.fields.entries()];
  }

  /**
   * Lists just the known names (the add-row's datalist + the search
   * panel's property chips).
   *
   * @returns the names in first-seen order.
   */
  public names(): readonly string[] {
    return [...this.fields.keys()];
  }

  /**
   * Records a field's type explicitly (the add-row / re-type path):
   * `select` requires at least one option; every other type drops the
   * options. Notifying listeners is the caller's concern when batching.
   *
   * @param name - the property name.
   * @param type - the assigned type.
   * @param options - the `select` options (ignored otherwise).
   * @returns whether the store changed.
   */
  public setField(
    name: string,
    type: PropertyType,
    options?: readonly string[],
  ): boolean {
    const key = cleanPropertyName(name);
    if (key.length === 0) {
      return false;
    }
    const next: PropertyFieldSchema =
      type === "select" && options !== undefined && options.length > 0
        ? { type, options }
        : { type };
    if (deepEqualField(this.fields.get(key) ?? null, next)) {
      return false;
    }
    this.fields.set(key, next);
    return true;
  }

  /**
   * Infers + records a field's type from its first value when the name
   * is unknown (R11.3's type-inference-on-first-use law); known names
   * are left untouched (explicit assignment always wins).
   *
   * @param name - the property name.
   * @param value - the first value seen for the name.
   * @returns whether the store changed.
   */
  public inferField(name: string, value: PropertyValue): boolean {
    const key = cleanPropertyName(name);
    if (key.length === 0 || this.fields.has(key)) {
      return false;
    }
    this.fields.set(key, { type: inferPropertyType(key, value) });
    return true;
  }

  /**
   * Forgets one field (the section editor's remove — values on objects
   * survive; they re-infer if the name is used again).
   *
   * @param name - the property name.
   * @returns whether the store changed.
   */
  public deleteField(name: string): boolean {
    return this.fields.delete(cleanPropertyName(name));
  }

  /**
   * Snapshots the store into the persisted section.
   *
   * @returns the section (empty when no fields are known).
   */
  public toSection(): PropertySchemaSection {
    if (this.fields.size === 0) {
      return EMPTY_PROPERTY_SCHEMA_SECTION;
    }
    return { version: 1, fields: Object.fromEntries(this.fields) };
  }

  /**
   * Replaces the whole store from a persisted section (the load path).
   *
   * @param section - the section (validated; invalid entries drop).
   */
  public replaceFromSection(section: PropertySchemaSection): void {
    this.fields.clear();
    const validated = normalizeSchemaSection(section);
    for (const [name, field] of Object.entries(
      validated?.fields ?? {},
    ) as [string, PropertyFieldSchema][]) {
      this.fields.set(name, field);
    }
  }

  /**
   * Subscribes to store changes.
   *
   * @param listener - the callback fired after every mutation.
   * @returns an unsubscribe function.
   */
  public subscribe(listener: SchemaChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Fires every listener (batched mutations notify once, at the end). */
  public notify(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

/**
 * Structural equality of two schema entries.
 *
 * @param a - the first entry (null = absent).
 * @param b - the second entry.
 * @returns whether the two are interchangeable.
 */
function deepEqualField(
  a: PropertyFieldSchema | null,
  b: PropertyFieldSchema,
): boolean {
  if (a === null) {
    return false;
  }
  if (a.type !== b.type) {
    return false;
  }
  const aOptions = a.options ?? [];
  const bOptions = b.options ?? [];
  return (
    aOptions.length === bOptions.length &&
    aOptions.every((option, index) => option === bOptions[index])
  );
}
