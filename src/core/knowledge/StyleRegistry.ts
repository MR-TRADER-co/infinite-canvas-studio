/**
 * Named styles (R13.3): a registry of reusable, user-named style presets
 * that stamp their fields onto objects in ONE composite undo step and keep
 * a `styleId` reference so a later style edit re-renders every usage.
 *
 * Two kinds exist:
 * - `text` — the text-box typography set (family/size/weight/colour/
 *   line-height);
 * - `color` — the shape colour pair (fill/stroke).
 *
 * The Phase-3A theme headings and the default colour pair ship as
 * READ-ONLY built-ins (ids under the `core.` owner namespace, §1.7.2);
 * user styles live under the `user.` namespace and can be created, edited
 * and deleted. Persisted as the project file's `styles` section (schema
 * v3 — MigrationV2toV3).
 *
 * Pure module: no DOM, no React, no Tauri — fully node-testable.
 */
import { TEXT_LINE_HEIGHT } from "@/core/model/TextBoxObject";

/** The two style kinds (per-object-kind application surfaces). */
export type StyleKind = "text" | "color";

/** Definition of a `text` style — every field optional (partial stamp). */
export interface TextStyleDef {
  /** Font family (CSS stack). */
  readonly fontFamily?: string;
  /** Base font size in world units. */
  readonly fontSize?: number;
  /** Font weight (400/700 — the editor's two toolbar weights). */
  readonly fontWeight?: number;
  /** Ink colour (CSS colour or the app palette token). */
  readonly color?: string;
  /** Line-height multiplier (the text-box contract's unit). */
  readonly lineHeight?: number;
}

/** Definition of a `color` style — the shape colour pair. */
export interface ColorStyleDef {
  /** Fill colour (CSS colour or the palette token). */
  readonly fill?: string;
  /** Border colour (CSS colour or the palette token). */
  readonly stroke?: string;
}

/** A named style (built-in or user-owned). */
export interface NamedStyle {
  /** Stable id — `core.*` built-ins are read-only, `user.*` editable. */
  readonly id: string;
  /** Which application surface the style belongs to. */
  readonly kind: StyleKind;
  /** User-visible name (bilingual UIs translate built-ins by id). */
  readonly name: string;
  /** Built-ins are read-only and ship with every project. */
  readonly builtin: boolean;
  /** The stamped fields (kind-dependent). */
  readonly def: TextStyleDef | ColorStyleDef;
}

/** The persisted styles section (schema v3). */
export interface StylesSection {
  /** Section format version (1 today). */
  readonly version: 1;
  /** User styles only — built-ins are re-materialised at boot. */
  readonly styles: readonly NamedStyle[];
}

/** An empty-but-valid section (the migration's v2 → v3 payload). */
export const EMPTY_STYLES_SECTION: StylesSection = {
  version: 1,
  styles: [],
};

/** Default text base size (matches the text tool default). */
const DEFAULT_FONT_SIZE = 20;

/** The Phase-3A heading ladder (world units — the toolbar presets). */
const HEADING_SIZES = { h1: 36, h2: 28, h3: 24 } as const;

/**
 * The read-only built-ins: the theme headings + the default colour pair.
 * Ids live under the `core.` owner namespace so plugins can never shadow
 * them (§1.7.2).
 */
export const BUILTIN_STYLES: readonly NamedStyle[] = [
  {
    id: "core.text.title",
    kind: "text",
    name: "سرتیتر",
    builtin: true,
    def: { fontSize: HEADING_SIZES.h1, fontWeight: 700 },
  },
  {
    id: "core.text.heading2",
    kind: "text",
    name: "سرتیتر ۲",
    builtin: true,
    def: { fontSize: HEADING_SIZES.h2, fontWeight: 700 },
  },
  {
    id: "core.text.heading3",
    kind: "text",
    name: "سرتیتر ۳",
    builtin: true,
    def: { fontSize: HEADING_SIZES.h3, fontWeight: 700 },
  },
  {
    id: "core.text.body",
    kind: "text",
    name: "متن بدنه",
    builtin: true,
    def: {
      fontSize: DEFAULT_FONT_SIZE,
      fontWeight: 400,
      lineHeight: TEXT_LINE_HEIGHT,
    },
  },
  {
    id: "core.color.default",
    kind: "color",
    name: "رنگ‌های پیش‌فرض",
    builtin: true,
    def: { fill: "var(--canvas-surface)", stroke: "var(--border)" },
  },
];

/** Change-subscription handle returned by {@link StyleRegistry.subscribe}. */
export type StylesChangeListener = () => void;

/**
 * The named-style registry: built-ins + user styles, lookups, CRUD (user
 * styles only) and the deterministic application/edit planners that keep
 * local overrides intact (AC13.4).
 */
export class StyleRegistry {
  private readonly userStyles = new Map<string, NamedStyle>();
  private readonly listeners = new Set<StylesChangeListener>();
  private nextUserIndex = 1;

  /**
   * Registers a user style (or replaces an existing one with the same id).
   * Built-in ids are rejected — they are read-only by contract.
   *
   * @param style - the style to upsert.
   * @returns the stored style, or null when the id collides with a built-in.
   */
  public upsertUserStyle(style: NamedStyle): NamedStyle | null {
    if (style.builtin || style.id.startsWith("core.")) {
      return null;
    }
    this.userStyles.set(style.id, { ...style, builtin: false });
    this.nextUserIndex = Math.max(this.nextUserIndex, userIndex(style.id) + 1);
    this.emitChanged();
    return style;
  }

  /**
   * Removes a user style by id (built-ins are untouchable).
   *
   * @param id - the style id.
   * @returns whether a user style was removed.
   */
  public deleteUserStyle(id: string): boolean {
    if (id.startsWith("core.")) {
      return false;
    }
    const removed = this.userStyles.delete(id);
    if (removed) {
      this.emitChanged();
    }
    return removed;
  }

  /** @returns every style (built-ins first, then user styles by id). */
  public list(): readonly NamedStyle[] {
    return [
      ...BUILTIN_STYLES,
      ...[...this.userStyles.values()].sort((a, b) => a.id.localeCompare(b.id)),
    ];
  }

  /**
   * @param kind - restrict the listing to one kind.
   * @returns the styles of that kind.
   */
  public listByKind(kind: StyleKind): readonly NamedStyle[] {
    return this.list().filter((style) => style.kind === kind);
  }

  /**
   * @param id - the style id.
   * @returns the style, or null when unknown.
   */
  public byId(id: string): NamedStyle | null {
    return (
      BUILTIN_STYLES.find((style) => style.id === id) ??
      this.userStyles.get(id) ??
      null
    );
  }

  /** @returns the next free user style id (`user.text.1`, …). */
  public nextUserId(kind: StyleKind): string {
    return `user.${kind}.${this.nextUserIndex}`;
  }

  /** @returns the persisted section (user styles only). */
  public toSection(): StylesSection {
    return {
      version: 1,
      styles: [...this.userStyles.values()].map((style) => ({ ...style })),
    };
  }

  /**
   * Replaces the user styles from a persisted section (a project load) —
   * built-ins stay as they are; listeners fire once.
   *
   * @param section - the section read from a file (validated first with
   *        {@link parseStylesSection}).
   */
  public replaceFromSection(section: StylesSection): void {
    this.userStyles.clear();
    for (const style of section.styles) {
      if (!style.builtin && !style.id.startsWith("core.")) {
        this.userStyles.set(style.id, style);
        this.nextUserIndex = Math.max(
          this.nextUserIndex,
          userIndex(style.id) + 1,
        );
      }
    }
    this.emitChanged();
  }

  /**
   * Subscribes to any registry mutation.
   *
   * @param listener - invoked after every change.
   * @returns an unsubscribe function.
   */
  public subscribe(listener: StylesChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChanged(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

/**
 * Strictly parses a persisted styles section (hand-edited files never
 * crash the app — one malformed entry skips ONLY that entry).
 *
 * @param value - the raw section read from a file.
 * @returns the validated section, or null when the envelope is invalid.
 */
export function parseStylesSection(value: unknown): StylesSection | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const version = (value as { version?: unknown }).version;
  const rawStyles = (value as { styles?: unknown }).styles;
  if (version !== 1 || !Array.isArray(rawStyles)) {
    return null;
  }
  const styles: NamedStyle[] = [];
  for (const raw of rawStyles) {
    const parsed = parseNamedStyle(raw);
    if (parsed !== null) {
      styles.push(parsed);
    }
  }
  return { version: 1, styles };
}

/**
 * Parses one style entry defensively.
 *
 * @param raw - the raw entry.
 * @returns the style, or null when malformed.
 */
function parseNamedStyle(raw: unknown): NamedStyle | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = record.id;
  const kind = record.kind;
  const name = record.name;
  if (
    typeof id !== "string" ||
    id === "" ||
    (kind !== "text" && kind !== "color") ||
    typeof name !== "string"
  ) {
    return null;
  }
  const builtin = record.builtin === true;
  const def =
    kind === "text" ? parseTextDef(record.def) : parseColorDef(record.def);
  if (def === null) {
    return null;
  }
  return { id, kind, name, builtin, def };
}

/**
 * @param value - the raw text definition.
 * @returns the validated definition (at least one field), or null.
 */
function parseTextDef(value: unknown): TextStyleDef | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const def: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    color?: string;
    lineHeight?: number;
  } = {};
  if (typeof record.fontFamily === "string" && record.fontFamily !== "") {
    def.fontFamily = record.fontFamily;
  }
  if (typeof record.fontSize === "number" && record.fontSize > 0) {
    def.fontSize = record.fontSize;
  }
  if (record.fontWeight === 400 || record.fontWeight === 700) {
    def.fontWeight = record.fontWeight;
  }
  if (typeof record.color === "string" && record.color !== "") {
    def.color = record.color;
  }
  if (
    typeof record.lineHeight === "number" &&
    record.lineHeight > 0 &&
    record.lineHeight <= 4
  ) {
    def.lineHeight = record.lineHeight;
  }
  return Object.keys(def).length > 0 ? def : null;
}

/**
 * @param value - the raw colour definition.
 * @returns the validated definition (at least one field), or null.
 */
function parseColorDef(value: unknown): ColorStyleDef | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const def: { fill?: string; stroke?: string } = {};
  if (typeof record.fill === "string" && record.fill !== "") {
    def.fill = record.fill;
  }
  if (typeof record.stroke === "string" && record.stroke !== "") {
    def.stroke = record.stroke;
  }
  return Object.keys(def).length > 0 ? def : null;
}

/** A single field patch planned by the application/edit planners. */
export interface StyleFieldPatch {
  /** The object id the patch applies to. */
  readonly objectId: string;
  /** The field name on the object's data. */
  readonly field: string;
  /** The value the field receives. */
  readonly value: string | number;
}

/**
 * Plans ONE style application: the fields the style defines are stamped
 * onto every target object (plus the `styleId` reference). Pure — the
 * caller wraps the result in ONE composite undo command.
 *
 * @param style - the style being applied.
 * @param objects - the current data of the target objects.
 * @returns the per-object field patches (styleId + the stamped fields).
 */
export function planStyleApplication(
  style: NamedStyle,
  objects: ReadonlyArray<{ id: string }>,
): StyleFieldPatch[] {
  const patches: StyleFieldPatch[] = [];
  for (const object of objects) {
    patches.push({ objectId: object.id, field: "styleId", value: style.id });
    if (style.kind === "text") {
      const def = style.def as TextStyleDef;
      if (def.fontFamily !== undefined) {
        patches.push({
          objectId: object.id,
          field: "fontFamily",
          value: def.fontFamily,
        });
      }
      if (def.fontSize !== undefined) {
        patches.push({
          objectId: object.id,
          field: "fontSize",
          value: def.fontSize,
        });
      }
      if (def.fontWeight !== undefined) {
        patches.push({
          objectId: object.id,
          field: "fontWeight",
          value: def.fontWeight,
        });
      }
      if (def.color !== undefined) {
        patches.push({ objectId: object.id, field: "color", value: def.color });
      }
      if (def.lineHeight !== undefined) {
        patches.push({
          objectId: object.id,
          field: "lineHeight",
          value: def.lineHeight,
        });
      }
    } else {
      const def = style.def as ColorStyleDef;
      if (def.fill !== undefined) {
        patches.push({ objectId: object.id, field: "fill", value: def.fill });
      }
      if (def.stroke !== undefined) {
        patches.push({
          objectId: object.id,
          field: "stroke",
          value: def.stroke,
        });
      }
    }
  }
  return patches;
}

/**
 * Plans a style EDIT's re-render: only the fields whose CURRENT value on
 * each usage still equals the OLD style's value are restamped — anything
 * the user changed locally (an override) is left exactly as it is
 * (AC13.4's deterministic old-value matching).
 *
 * @param oldStyle - the style's previous definition.
 * @param newStyle - the style's next definition.
 * @param usages - the current data of the objects referencing the style.
 * @returns the per-object field patches (only non-overridden fields).
 */
export function planStyleEdit(
  oldStyle: NamedStyle,
  newStyle: NamedStyle,
  usages: ReadonlyArray<unknown>,
): StyleFieldPatch[] {
  if (oldStyle.kind !== newStyle.kind) {
    return [];
  }
  const fields =
    newStyle.kind === "text"
      ? (["fontFamily", "fontSize", "fontWeight", "color", "lineHeight"] as const)
      : (["fill", "stroke"] as const);
  const oldDef = oldStyle.def as Record<string, unknown>;
  const newDef = newStyle.def as Record<string, unknown>;
  const patches: StyleFieldPatch[] = [];
  for (const raw of usages) {
    const usage = raw as Record<string, unknown> & { id?: unknown };
    if (usage.styleId !== newStyle.id || typeof usage.id !== "string") {
      continue;
    }
    for (const field of fields) {
      const before = oldDef[field];
      const after = newDef[field];
      if (after === undefined) {
        continue;
      }
      // Override guard: only restamp when the usage still carries the old
      // style's value (or the field was absent and the old style never
      // defined it either).
      const current = usage[field];
      if (before !== undefined && current !== before) {
        continue;
      }
      if (before === undefined && current !== undefined) {
        continue;
      }
      patches.push({
        objectId: usage.id,
        field,
        value: after as string | number,
      });
    }
  }
  return patches;
}

/**
 * Parses a `user.<kind>.<n>` id's numeric tail (collision-free upserts).
 *
 * @param id - the user style id.
 * @returns the numeric index (0 when malformed).
 */
function userIndex(id: string): number {
  const match = /\.(\d+)$/.exec(id);
  return match !== null ? Number(match[1]) : 0;
}
