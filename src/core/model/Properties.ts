/**
 * Structured object properties (Knowledge Pack R11.3): every scene object
 * can carry a flat `properties` record of TYPED values — the structured
 * half of the knowledge layer that wiki-links cannot express (status,
 * owner, due date, priority, …) and the data source the Phase-12 query
 * engine will filter on.
 *
 * Value shapes follow the pack's contract:
 * `Record<string, string | number | boolean | ISODate | string[]>` —
 * dates ride as ISO strings, multi-values (tags) as string arrays.
 *
 * Types are INFERRED on first use (`inferPropertyType`) and remembered
 * in the project-level PropertySchema so the same property name edits
 * with the same editor everywhere; a `select` type carries its option
 * list in the schema (never in the value).
 *
 * Pure module: no DOM, no React, no Tauri — fully node-testable.
 */

/**
 * A property value: the pack's five wire shapes (ISODate rides as a
 * plain string; the schema's `date` type is what distinguishes it).
 */
export type PropertyValue = string | number | boolean | readonly string[];

/** The editor types a property can take (R11.8's six editors). */
export type PropertyType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "select"
  | "tags";

/** Every valid property type (validation + UI order). */
export const PROPERTY_TYPES: readonly PropertyType[] = [
  "text",
  "number",
  "date",
  "boolean",
  "select",
  "tags",
];

/** Schema entry of one known property name (the project's memory). */
export interface PropertyFieldSchema {
  /** The editor type inferred/assigned on first use. */
  readonly type: PropertyType;
  /** Options of a `select` property (empty for every other type). */
  readonly options?: readonly string[];
}

/** The persisted property-schema section (schema v3, optional field). */
export interface PropertySchemaSection {
  /** Section format version (1 today). */
  readonly version: 1;
  /** Known property names → their type + select options. */
  readonly fields: Readonly<Record<string, PropertyFieldSchema>>;
}

/** An empty-but-valid section (the absent-field default). */
export const EMPTY_PROPERTY_SCHEMA_SECTION: PropertySchemaSection = {
  version: 1,
  fields: {},
};

/** Maximum property names per object (a sanity cap, like MAX_LEN). */
export const MAX_PROPERTIES_PER_OBJECT = 32;

/** Maximum length of a property name (trim + cap on write). */
export const MAX_PROPERTY_NAME_LENGTH = 40;

/** Maximum items in a `tags` value. */
export const MAX_TAGS_LENGTH = 24;

/** Maximum length of one tag item. */
export const MAX_TAG_LENGTH = 32;

/** The reserved multi-value property name (R11.4). */
export const TAGS_PROPERTY = "tags";

/** ISO date pattern (YYYY-MM-DD) — the `date` type's wire shape. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/;

/** Property names that read as dates even when first seen as text. */
const DATE_LIKE_NAMES = /^(date|due|dueDate|deadline|startDate|endDate)$/i;

/**
 * Trims and caps a property name.
 *
 * @param name - the raw name.
 * @returns the cleaned name, or "" when empty.
 */
export function cleanPropertyName(name: string): string {
  return name.trim().slice(0, MAX_PROPERTY_NAME_LENGTH);
}

/**
 * Type guard for the `tags` value shape (TS's `Array.isArray` cannot
 * narrow `readonly string[]` OUT of a union — this guard can).
 *
 * @param value - the candidate value.
 * @returns whether the value is the tags (string-array) shape.
 */
export function isTagsValue(value: unknown): value is readonly string[] {
  return Array.isArray(value);
}

/**
 * Infers a property's type from its first value (R11.3's
 * type-inference-on-first-use law).
 *
 * Rules: string arrays are `tags`; numbers are `number`; booleans are
 * `boolean`; strings that match the ISO date pattern — or whose NAME
 * reads like a date — are `date`; everything else is `text`. The
 * `select` type never infers: it is only ever assigned explicitly (its
 * options live in the schema, not the value).
 *
 * @param name - the property name (date-like names bias the inference).
 * @param value - the first value seen for the name.
 * @returns the inferred type.
 */
export function inferPropertyType(
  name: string,
  value: PropertyValue,
): PropertyType {
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "string") {
    return ISO_DATE_PATTERN.test(value) || DATE_LIKE_NAMES.test(name.trim())
      ? "date"
      : "text";
  }
  return "tags";
}

/**
 * Coerces a raw editor input into the value shape of a property type
 * (the PropertiesSection's commit path): invalid numbers become null,
 * `date` inputs pass through, `tags` inputs are split on commas/، ,
 * trimmed, de-duplicated (first wins) and capped, and `select` inputs
 * accept any non-empty option string (the schema's options guide the
 * UI, but the value is not re-validated — pasted files may carry more).
 *
 * @param type - the property's schema type.
 * @param raw - the raw user input.
 * @returns the coerced value, or null when the input is unusable.
 */
export function coercePropertyValue(
  type: PropertyType,
  raw: string,
): PropertyValue | null {
  const text = raw.trim();
  switch (type) {
    case "number": {
      if (text.length === 0) {
        return null;
      }
      const parsed = Number(text.replace(/[٠-٩]/g, (digit) =>
        String(digit.charCodeAt(0) - 0x0660),
      ).replace(/[۰-۹]/g, (digit) =>
        String(digit.charCodeAt(0) - 0x06f0),
      ));
      return Number.isFinite(parsed) ? parsed : null;
    }
    case "date":
      return text.length === 0 ? null : text;
    case "tags":
      return splitTagList(text);
    case "boolean":
    case "select":
    case "text":
      return text;
  }
}

/**
 * Splits a raw comma/، -separated list into a clean tag array.
 *
 * @param raw - the raw input.
 * @returns the trimmed, de-duplicated, capped tag array (possibly empty).
 */
export function splitTagList(raw: string): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,،]/)) {
    const tag = part.trim().slice(0, MAX_TAG_LENGTH);
    if (tag.length === 0 || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    if (out.length >= MAX_TAGS_LENGTH) {
      break;
    }
    out.push(tag);
  }
  return out;
}

/**
 * Validates an unknown JSON value as a {@link PropertyValue}.
 *
 * @param value - the candidate value.
 * @returns whether the shape is one of the five wire shapes.
 */
export function isValidPropertyValue(value: unknown): value is PropertyValue {
  if (typeof value === "string" || typeof value === "number") {
    return true;
  }
  if (typeof value === "boolean") {
    return true;
  }
  return isTagsValue(value) && value.every((item) => typeof item === "string");
}

/**
 * Normalises an unknown JSON blob into a properties record (the
 * persistence read path): non-record input returns undefined (the
 * pre-properties default); wrong-typed names/values are dropped —
 * never fatal, the unknown-data law keeps the rest of the object
 * intact (§1.7.4).
 *
 * @param raw - the wire value of an object's `properties` field.
 * @returns the validated record, or undefined when absent/empty/invalid.
 */
export function normalizeProperties(
  raw: unknown,
): Readonly<Record<string, PropertyValue>> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const out: Record<string, PropertyValue> = {};
  for (const [rawName, value] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    const name = cleanPropertyName(rawName);
    if (name.length === 0 || !isValidPropertyValue(value)) {
      continue;
    }
    out[name] = value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Normalises an unknown JSON blob into a schema section (the load path).
 *
 * @param raw - the wire value of the project's `propertySchema` field.
 * @returns the validated section, or undefined when absent/empty.
 */
export function normalizeSchemaSection(
  raw: unknown,
): PropertySchemaSection | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const fields = (raw as { fields?: unknown }).fields;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return undefined;
  }
  const out: Record<string, PropertyFieldSchema> = {};
  for (const [rawName, entry] of Object.entries(
    fields as Record<string, unknown>,
  )) {
    const name = cleanPropertyName(rawName);
    if (
      name.length === 0 ||
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry)
    ) {
      continue;
    }
    const type = (entry as { type?: unknown }).type;
    if (
      typeof type !== "string" ||
      !(PROPERTY_TYPES as readonly string[]).includes(type)
    ) {
      continue;
    }
    const typed = type as PropertyType;
    const optionsRaw = (entry as { options?: unknown }).options;
    const options = Array.isArray(optionsRaw)
      ? optionsRaw.filter(
          (item): item is string => typeof item === "string" && item !== "",
        )
      : undefined;
    out[name] =
      typed === "select" && options !== undefined && options.length > 0
        ? { type: typed, options }
        : { type: typed };
  }
  return Object.keys(out).length === 0
    ? undefined
    : { version: 1, fields: out };
}

/**
 * Renders a property value for display (the inspector rows + search
 * chips): booleans render as ✓/✗, tag arrays join with « · », dates
 * pass through (the UI layers Jalali formatting on top), everything
 * else stringifies.
 *
 * @param value - the property value.
 * @returns the display string.
 */
export function formatPropertyValue(value: PropertyValue): string {
  if (typeof value === "boolean") {
    return value ? "✓" : "✗";
  }
  if (isTagsValue(value)) {
    return value.join(" · ");
  }
  return String(value);
}

/**
 * Compares a property value against a filter value for equality (the
 * R11.9 direct scan): numbers compare numerically (and against their
 * string form), booleans against truthy spellings, tag arrays match
 * when they CONTAIN the filter tag, and strings compare
 * Persian-folded (the knowledge normaliser's ي/ك/ZWNJ tolerance).
 *
 * @param value - the object's property value.
 * @param filterValue - the user's filter input.
 * @returns whether the value satisfies the equality filter.
 */
export function propertyValueEquals(
  value: PropertyValue,
  filterValue: string,
): boolean {
  const needle = filterValue.trim();
  if (needle.length === 0) {
    return false;
  }
  if (typeof value === "number") {
    const parsed = Number(needle);
    return Number.isFinite(parsed) && value === parsed;
  }
  if (typeof value === "boolean") {
    return (
      (value && /^(true|1|بله|آره|✓)$/i.test(needle)) ||
      (!value && /^(false|0|خیر|✗)$/i.test(needle))
    );
  }
  if (isTagsValue(value)) {
    return value.some((item) => foldEqual(item, needle));
  }
  return foldEqual(String(value), needle);
}

/**
 * Persian-folded string equality (reuse of the knowledge normaliser's
 * keyboard-drift tolerance).
 *
 * @param a - the first string.
 * @param b - the second string.
 * @returns whether the two fold to the same key.
 */
function foldEqual(a: string, b: string): boolean {
  return foldKey(a) === foldKey(b);
}

/**
 * Folds one string for comparison (the knowledge normaliser minus the
 * length cap — property values are short).
 *
 * @param raw - the string to fold.
 * @returns the folded key.
 */
function foldKey(raw: string): string {
  return raw
    .replace(/\u064a/g, "\u06cc")
    .replace(/\u0643/g, "\u06a9")
    .replace(/\u200c/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fa-IR");
}
