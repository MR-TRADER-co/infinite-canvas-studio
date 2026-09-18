/**
 * Core object-type registrations (R4.1): the seven first-party scene
 * object kinds plus the opaque placeholder entry, registered onto the
 * {@link ObjectRegistry} under reserved `core.*` type ids (§1.7.2).
 *
 * Adding an object type = THIS file (or a plugin's own file in Phase 9)
 * plus one `registry.register(...)` call — persistence code never edits
 * (§1.7.1). Each entry carries:
 * - `serialize` — in-memory data → wire payload (adds `typeId` +
 *   `typeVersion`, drops the in-memory `kind`);
 * - `deserialize` — (already type-migrated) wire payload → in-memory
 *   data, or null to refuse a corrupt object (the caller then keeps the
 *   raw JSON as an opaque placeholder — nothing is ever lost);
 * - `factory` — a default instance for the future Insert Panel (§1.7.7);
 * - TipTap rich-text documents ride INSIDE the text objects' payloads
 *   (R4.1) — they are plain JSON, validated structurally here and parsed
 *   by the editor schema at render time.
 *
 * Wire field spellings intentionally match the in-memory contracts
 * (`position`, `width`, `points`, `doc`, …) so a structural snapshot
 * stays byte-compatible with the pre-registry v1 files except for the
 * `kind` → `typeId` rename (see `MigrationV1toV2`).
 */
import type {
  ObjectRegistry,
  ObjectRegistryEntry,
} from "@/core/registry/ObjectRegistry";
import {
  materializeOpaqueObject,
  type OpaqueObjectData,
} from "@/core/model/OpaqueObject";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import type { ShapeObjectData, ShapeKind } from "@/core/model/ShapeObject";
import type {
  TextBoxObjectData,
  TextBoxSizeMode,
} from "@/core/model/TextBoxObject";
import type { StickyNoteObjectData } from "@/core/model/StickyNoteObject";
import type { ImageObjectData } from "@/core/model/ImageObject";
import type { ImageInsertState } from "@/core/model/ImageObject";
import type { VideoObjectData } from "@/core/model/VideoObject";
import type { AudioObjectData } from "@/core/model/AudioObject";
import type { PdfObjectData } from "@/core/model/PdfObject";
import { clampPdfPage } from "@/core/model/PdfObject";
import type {
  ArrowStyle,
  ConnectorObjectData,
  ConnectorEndpoint,
  ConnectorRoutingKind,
} from "@/core/model/ConnectorObject";
import type {
  FreehandObjectData,
  StrokeStyleKind,
} from "@/core/model/FreehandObject";
import type { GroupObjectData } from "@/core/model/GroupObject";
import type { FrameObjectData } from "@/core/model/FrameObject";
import type {
  QueryObjectData,
  QuerySpec,
  QueryType,
} from "@/core/model/QueryObject";
import {
  makeQueryObject,
  normalizeQueryColumns,
  querySpecOnLoad,
  QUERY_DEFAULT_HEIGHT,
  QUERY_DEFAULT_WIDTH,
  QUERY_TARGET_MAX,
  QUERY_TYPES,
} from "@/core/model/QueryObject";
import {
  STICKER_DEFAULT_SIZE,
  type StickerObjectData,
} from "@/core/model/StickerObject";
import {
  DEFAULT_FRAME_HEIGHT,
  DEFAULT_FRAME_TITLE_HEIGHT,
  DEFAULT_FRAME_WIDTH,
  parseFrameLayout,
} from "@/core/model/FrameObject";
import {
  normalizeProperties,
  type PropertyValue,
} from "@/core/model/Properties";
import type { RichTextDocument } from "@/text/editor/richtext";

/** Every core wire type id (owner `core`, §1.7.2). */
export const CORE_TYPE_IDS = {
  shape: "core.shape",
  textBox: "core.textBox",
  stickyNote: "core.stickyNote",
  image: "core.image",
  video: "core.video",
  audio: "core.audio",
  pdf: "core.pdf",
  connector: "core.connector",
  freehand: "core.freehand",
  group: "core.group",
  opaque: "core.opaque",
  frame: "core.frame",
  sticker: "core.sticker",
  query: "core.query",
} as const;

/** Allowed `shapeKind` values (mirrors the model union). */
const SHAPE_KINDS: readonly ShapeKind[] = [
  "rectangle",
  "roundedRectangle",
  "ellipse",
  "triangle",
  "diamond",
  "star",
];

/** Allowed stroke dash values (mirrors the model union). */
const STROKE_STYLES: readonly StrokeStyleKind[] = ["solid", "dashed", "dotted"];

/** Allowed connector routing values (mirrors the model union). */
const ROUTINGS: readonly ConnectorRoutingKind[] = [
  "straight",
  "orthogonal",
  "curved",
];

/** Allowed arrowhead values (mirrors the model union). */
const ARROWS: readonly ArrowStyle[] = ["none", "arrow"];

/** Allowed text box width behaviours (mirrors the model union). */
const SIZE_MODES: readonly TextBoxSizeMode[] = ["fixed", "auto"];

/** Id counter feeding the per-type default factories (unique prefix). */
const FACTORY_IDS = new Map<string, number>();

/**
 * @param type - the wire type id of the factory's owner entry.
 * @returns a fresh unique id for a factory-made default instance.
 */
function nextFactoryId(type: string): string {
  const next = (FACTORY_IDS.get(type) ?? 0) + 1;
  FACTORY_IDS.set(type, next);
  return `factory-${type.slice("core.".length)}-${next}`;
}

// ── shared field readers (defensive: hand-edited files never crash) ────

/**
 * @param value - the raw value to test.
 * @returns the value when it is a finite number, else null.
 */
function number_(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * @param raw - the wire payload.
 * @param key - the field name.
 * @param fallback - value used when the field is absent.
 * @returns the field as a boolean, or null when it is present but not a
 *          boolean (a wrong-typed field refuses the object).
 */
function boolean_(
  raw: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean | null {
  const value = raw[key];
  if (value === undefined) {
    return fallback;
  }
  return typeof value === "boolean" ? value : null;
}

/**
 * @param raw - the wire payload.
 * @param key - the field name.
 * @returns the field as a plain string, or null (absent or wrong type).
 */
function string_(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  if (value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : null;
}

/**
 * @param raw - the wire payload.
 * @param key - the field name.
 * @returns the field as a plain string, or undefined when absent (null
 *          when present but not a string — optional fields refuse on
 *          wrong type only).
 */
function optionalString(
  raw: Record<string, unknown>,
  key: string,
): string | undefined | null {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === "string" ? value : null;
}

/**
 * @param raw - the wire payload.
 * @param key - the field name.
 * @returns the field as a `Vec2` object, or null.
 */
function vec2_(raw: Record<string, unknown>, key: string): Vec2 | null {
  const value = raw[key];
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as { x?: unknown; y?: unknown };
  const x = number_(candidate.x);
  const y = number_(candidate.y);
  return x !== null && y !== null ? vec2(x, y) : null;
}

/**
 * Reads a validated TipTap document (R4.1: the rich-text doc is part of
 * the text object's payload).
 *
 * @param value - the raw `doc` field.
 * @returns the document (null for the legacy plain-text path) plus a
 *          validity flag — a present-but-malformed document REFUSES the
 *          object (the caller falls back to the opaque placeholder).
 */
function readDocument(value: unknown): {
  readonly doc: RichTextDocument | null;
  readonly valid: boolean;
} {
  if (value === undefined || value === null) {
    return { doc: null, valid: true };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { doc: null, valid: false };
  }
  const candidate = value as { type?: unknown; content?: unknown };
  if (candidate.type !== "doc") {
    return { doc: null, valid: false };
  }
  if (candidate.content !== undefined && !Array.isArray(candidate.content)) {
    return { doc: null, valid: false };
  }
  return { doc: value as RichTextDocument, valid: true };
}

/**
 * @param value - the raw value to test.
 * @returns the value as a plain record, or null.
 */
function record_(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Reads the common {@link SceneObjectData} fields off a wire payload.
 *
 * @param raw - the wire payload.
 * @returns the shared fields, or null when any is wrong-typed.
 */
function readCommonFields(raw: Record<string, unknown>): {
  id: string;
  name: string | undefined;
  parentId: string | undefined;
  position: Vec2;
  rotation: number;
  zIndex: number;
  visible: boolean;
  locked: boolean;
  properties?: Readonly<Record<string, PropertyValue>>;
  pinned?: boolean;
  pinAnchor?: Vec2;
} | null {
  const id = string_(raw, "id");
  if (id === null || id.length === 0) {
    return null;
  }
  const name = optionalString(raw, "name");
  const parentId = optionalString(raw, "parentId");
  if (name === null || parentId === null) {
    return null;
  }
  const position = vec2_(raw, "position");
  if (position === null) {
    return null;
  }
  const rotation = number_(raw.rotation);
  const zIndex = number_(raw.zIndex);
  if (rotation === null || zIndex === null) {
    return null;
  }
  const visible = boolean_(raw, "visible", true);
  const locked = boolean_(raw, "locked", false);
  if (visible === null || locked === null) {
    return null;
  }
  // R11.3: structured properties — absent/invalid drops to undefined
  // (a pre-Phase-11 file opens with no properties; wrong-typed entries
  // drop, the object itself is never refused).
  const properties = normalizeProperties(raw.properties);
  // فاز ۲۵: pin-to-screen — absent = unpinned (pre-Phase-25 files load
  // unchanged); a wrong-typed flag OR anchor drops the pin entirely (the
  // object itself survives, unpinned — the lenient optional-field rule).
  const rawPinned = boolean_(raw, "pinned", false);
  const rawAnchor = raw.pinAnchor;
  const pinAnchor =
    rawAnchor === undefined || rawAnchor === null
      ? undefined
      : vec2_(raw, "pinAnchor") ?? undefined;
  const pinned = rawPinned === true && pinAnchor !== undefined;
  return {
    id,
    name,
    parentId,
    position,
    rotation,
    zIndex,
    visible,
    locked,
    ...(properties === undefined ? {} : { properties }),
    ...(pinned ? { pinned: true, pinAnchor } : {}),
  };
}

/**
 * Serializes the common fields + kind-specific extras of one object.
 *
 * The in-memory data IS the contract (plain JSON), so the wire payload is
 * the object minus the `kind` discriminant plus the registry stamps.
 *
 * @param object - the in-memory object data.
 * @param typeId - the entry's wire type id.
 * @param typeVersion - the entry's wire type version.
 * @returns the wire payload.
 */
function writeObject(
  object: SceneObjectData,
  typeId: string,
  typeVersion: number,
): Record<string, unknown> {
  const { kind: _kind, ...fields } = object;
  return { ...fields, typeId, typeVersion };
}

/**
 * @param raw - the wire payload.
 * @param key - the size field name.
 * @returns the field clamped to a finite number ≥ 0, or null.
 */
function size_(raw: Record<string, unknown>, key: string): number | null {
  const value = number_(raw[key]);
  if (value === null || value < 0) {
    return null;
  }
  return value;
}

/**
 * @param value - the raw value to test.
 * @param allowed - the allowed literal values.
 * @returns the value narrowed to its literal union, else null.
 */
function enumOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/**
 * Registers every first-party object type onto the registry.
 *
 * @param registry - the target registry (typically empty).
 * @returns the registry (chaining).
 */
export function registerCoreObjectTypes(
  registry: ObjectRegistry,
): ObjectRegistry {
  const entries: ObjectRegistryEntry[] = [
    shapeEntry(),
    textBoxEntry(),
    stickyNoteEntry(),
    imageEntry(),
    videoEntry(),
    audioEntry(),
    pdfEntry(),
    connectorEntry(),
    freehandEntry(),
    groupEntry(),
    opaqueEntry(),
    frameEntry(),
    stickerEntry(),
    queryEntry(),
  ];
  for (const entry of entries) {
    registry.register(entry);
  }
  return registry;
}

/** Builds the frame type entry (R8.3) — the presentation container. */
function frameEntry(): ObjectRegistryEntry<FrameObjectData> {
  const typeId = CORE_TYPE_IDS.frame;
  return {
    id: typeId,
    kind: "frame",
    titleKey: "tool.frame",
    version: 1,
    factory: () =>
      ({
        kind: "frame",
        id: nextFactoryId(typeId),
        position: vec2(0, 0),
        rotation: 0,
        zIndex: 0,
        visible: true,
        locked: false,
        width: DEFAULT_FRAME_WIDTH,
        height: DEFAULT_FRAME_HEIGHT,
        titleHeight: DEFAULT_FRAME_TITLE_HEIGHT,
        title: "",
        fill: "accent",
        stroke: "primary",
        strokeWidth: 2,
      }) as FrameObjectData,
    catalog: {
      titleKey: "tool.frame",
      group: "shapes",
      order: 30,
      icon: "Frame",
    },
    serialize: (object) => ({
        ...writeObject(object, typeId, 1),
        ...(object.layout === undefined ? {} : { layout: object.layout }),
      }),
    deserialize: (raw) => {
      const common = readCommonFields(raw);
      if (common === null) {
        return null;
      }
      const width = size_(raw, "width");
      const height = size_(raw, "height");
      const titleHeight = number_(raw.titleHeight);
      const title = typeof raw.title === "string" ? raw.title : "";
      const fill = string_(raw, "fill");
      const stroke = string_(raw, "stroke");
      const strokeWidth = number_(raw.strokeWidth);
      if (
        width === null ||
        height === null ||
        titleHeight === null ||
        titleHeight <= 0 ||
        fill === null ||
        stroke === null ||
        strokeWidth === null ||
        strokeWidth < 0
      ) {
        return null;
      }
      const layout = parseFrameLayout(raw.layout);
      return {
        ...common,
        kind: "frame",
        width,
        height,
        titleHeight,
        title,
        fill,
        stroke,
        strokeWidth,
        ...(layout === null ? {} : { layout }),
      };
    },
  };
}

/** Builds the shape type entry. */
function shapeEntry(): ObjectRegistryEntry<ShapeObjectData> {
  const typeId = CORE_TYPE_IDS.shape;
  /** Default shape instance (the card factories reuse it, R7.12). */
  const makeShape = (shapeKind: ShapeKind): ShapeObjectData =>
    ({
      kind: "shape",
      id: nextFactoryId(typeId),
      position: vec2(0, 0),
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      shapeKind,
      width: 120,
      height: 80,
      fill: "token://shape-fill",
      stroke: "token://stroke",
      strokeWidth: 2,
    }) as ShapeObjectData;
  return {
    id: typeId,
    kind: "shape",
    titleKey: "tool.shape",
    version: 1,
    factory: () => makeShape("rectangle"),
    catalog: {
      titleKey: "tool.shape",
      group: "shapes",
      order: 10,
      icon: "Shapes",
      // R7.12: the shape kind offers rect + ellipse cards (the spec's
      // catalog enumeration); each card factory reuses the entry factory
      // and swaps the primitive — same defaults, same tokens.
      cards: [
        {
          key: "rectangle",
          icon: "Square",
          titleKey: "shape.kind.rectangle",
          order: 10,
          factory: () => makeShape("rectangle"),
        },
        {
          key: "ellipse",
          icon: "Circle",
          titleKey: "shape.kind.ellipse",
          order: 20,
          factory: () => makeShape("ellipse"),
        },
      ],
    },
    serialize: (object) => writeObject(object, typeId, 1),
    deserialize: (raw) => {
      const common = readCommonFields(raw);
      if (common === null) {
        return null;
      }
      const shapeKind = enumOf<ShapeKind>(raw.shapeKind, SHAPE_KINDS);
      const width = size_(raw, "width");
      const height = size_(raw, "height");
      const fill = string_(raw, "fill");
      const stroke = string_(raw, "stroke");
      const strokeWidth = number_(raw.strokeWidth);
      if (
        shapeKind === null ||
        width === null ||
        height === null ||
        fill === null ||
        stroke === null ||
        strokeWidth === null ||
        strokeWidth < 0
      ) {
        return null;
      }
      return {
        ...common,
        kind: "shape",
        shapeKind,
        width,
        height,
        fill,
        stroke,
        strokeWidth,
      };
    },
  };
}

/** Builds the sticker type entry (R11.1) — the emoji reaction markers. */
function stickerEntry(): ObjectRegistryEntry<StickerObjectData> {
  const typeId = CORE_TYPE_IDS.sticker;
  const makeSticker = (emoji: string): StickerObjectData =>
    ({
      kind: "sticker",
      id: nextFactoryId(typeId),
      position: vec2(0, 0),
      rotation: 0,
      zIndex: 0,
      visible: true,
      locked: false,
      emoji,
      width: STICKER_DEFAULT_SIZE,
      height: STICKER_DEFAULT_SIZE,
    }) as StickerObjectData;
  return {
    id: typeId,
    kind: "sticker",
    titleKey: "object.sticker",
    version: 1,
    factory: () => makeSticker("⭐"),
    catalog: {
      titleKey: "object.sticker",
      group: "stickers",
      order: 50,
      icon: "Smile",
      // R11.1: one card per curated emoji — every card reuses the entry
      // factory defaults and swaps only the glyph; the `preview` field
      // lets the Insert Panel paint the actual emoji on the card.
      cards: [
        {
          key: "sticker.star",
          titleKey: "sticker.star",
          order: 10,
          preview: "⭐",
          factory: () => makeSticker("⭐"),
        },
        {
          key: "sticker.smile",
          titleKey: "sticker.smile",
          order: 20,
          preview: "😀",
          factory: () => makeSticker("😀"),
        },
        {
          key: "sticker.love",
          titleKey: "sticker.love",
          order: 30,
          preview: "❤️",
          factory: () => makeSticker("❤️"),
        },
        {
          key: "sticker.fire",
          titleKey: "sticker.fire",
          order: 40,
          preview: "🔥",
          factory: () => makeSticker("🔥"),
        },
        {
          key: "sticker.idea",
          titleKey: "sticker.idea",
          order: 50,
          preview: "💡",
          factory: () => makeSticker("💡"),
        },
        {
          key: "sticker.target",
          titleKey: "sticker.target",
          order: 60,
          preview: "🎯",
          factory: () => makeSticker("🎯"),
        },
        {
          key: "sticker.rocket",
          titleKey: "sticker.rocket",
          order: 70,
          preview: "🚀",
          factory: () => makeSticker("🚀"),
        },
        {
          key: "sticker.check",
          titleKey: "sticker.check",
          order: 80,
          preview: "✅",
          factory: () => makeSticker("✅"),
        },
      ],
    },
    serialize: (object) => writeObject(object, typeId, 1),
    deserialize: (raw) => {
      const common = readCommonFields(raw);
      if (common === null) {
        return null;
      }
      const emoji = string_(raw, "emoji");
      const width = size_(raw, "width");
      const height = size_(raw, "height");
      if (
        emoji === null ||
        emoji.length === 0 ||
        width === null ||
        height === null
      ) {
        return null;
      }
      return {
        ...common,
        kind: "sticker",
        emoji,
        width,
        height,
      };
    },
  };
}

/** Builds the live knowledge-query type entry (R15.2 + R12.2). */
function queryEntry(): ObjectRegistryEntry<QueryObjectData> {
  const typeId = CORE_TYPE_IDS.query;
  const makeQuery = (spec: QuerySpec): QueryObjectData =>
    makeQueryObject(nextFactoryId(typeId), vec2(0, 0), spec);
  return {
    id: typeId,
    kind: "query",
    titleKey: "object.query",
    version: 1,
    // The default card lists the knowledge islands — a targetless
    // query that is immediately useful on any project (R15.2 UX).
    factory: () => makeQuery({ type: "orphans", target: "" }),
    catalog: {
      titleKey: "object.query",
      group: "knowledge",
      order: 60,
      icon: "Search",
      cards: [
        {
          key: "query.live",
          titleKey: "query.card",
          order: 10,
          preview: "🔍",
          factory: () => makeQuery({ type: "orphans", target: "" }),
        },
        {
          // R12.2: the structured-filter card (the full QuerySpec editor
          // opens in the inspector — form, not free text; law §1.7.9).
          key: "query.filter",
          titleKey: "query.cardFilter",
          order: 20,
          preview: "🧮",
          factory: () =>
            makeQuery({ type: "filter", target: "", structured: undefined }),
        },
      ],
    },
    serialize: (object) => writeObject(object, typeId, 1),
    deserialize: (raw) => {
      const common = readCommonFields(raw);
      if (common === null) {
        return null;
      }
      const width = size_(raw, "width");
      const height = size_(raw, "height");
      const queryType = enumOf<QueryType>(raw.queryType, QUERY_TYPES);
      const queryTarget = string_(raw, "queryTarget");
      if (
        width === null ||
        height === null ||
        queryType === null ||
        queryTarget === null ||
        queryTarget.length > QUERY_TARGET_MAX
      ) {
        return null;
      }
      // R12.2: the structured spec + presentation columns ride only on
      // `filter` cards; a corrupt spec degrades to the all-match default
      // (§1.7.4 — never a drop of the whole card).
      const isFilter = queryType === "filter";
      const querySpec = isFilter
        ? querySpecOnLoad(raw.querySpec)
        : undefined;
      const columns = isFilter
        ? (normalizeQueryColumns(raw.columns) ?? [])
        : undefined;
      return {
        ...common,
        kind: "query",
        width: Math.max(width, QUERY_DEFAULT_WIDTH / 2),
        height: Math.max(height, QUERY_DEFAULT_HEIGHT / 3),
        queryType,
        queryTarget,
        ...(isFilter ? { querySpec, columns } : {}),
      };
    },
  };
}

/** Builds the text box type entry (rich-text doc rides inside, R4.1). */
function textBoxEntry(): ObjectRegistryEntry<TextBoxObjectData> {
  const typeId = CORE_TYPE_IDS.textBox;
  return {
    id: typeId,
    kind: "textBox",
    titleKey: "tool.text",
    version: 1,
    factory: () =>
      ({
        kind: "textBox",
        id: nextFactoryId(typeId),
        position: vec2(0, 0),
        rotation: 0,
        zIndex: 0,
        visible: true,
        locked: false,
        width: 260,
        height: 64,
        text: "",
        doc: null,
        sizeMode: "auto",
        fontSize: 20,
        color: "token://text",
      }) as TextBoxObjectData,
    catalog: {
      titleKey: "tool.text",
      group: "text&notes",
      order: 10,
      icon: "Type",
    },
    serialize: (object) => writeObject(object, typeId, 1),
    deserialize: (raw) => {
      const common = readCommonFields(raw);
      if (common === null) {
        return null;
      }
      const width = size_(raw, "width");
      const height = size_(raw, "height");
      const text = string_(raw, "text");
      const { doc, valid } = readDocument(raw.doc);
      if (!valid) {
        return null;
      }
      const sizeMode = enumOf<TextBoxSizeMode>(raw.sizeMode, SIZE_MODES);
      const fontSize = number_(raw.fontSize);
      const color = string_(raw, "color");
      if (
        width === null ||
        height === null ||
        text === null ||
        sizeMode === null ||
        fontSize === null ||
        fontSize <= 0 ||
        color === null
      ) {
        return null;
      }
      return {
        ...common,
        kind: "textBox",
        width,
        height,
        text,
        doc,
        sizeMode,
        fontSize,
        ...(typeof raw.fontFamily === "string" && raw.fontFamily !== ""
          ? { fontFamily: raw.fontFamily }
          : {}),
        color,
      };
    },
  };
}

/** Builds the sticky note type entry. */
function stickyNoteEntry(): ObjectRegistryEntry<StickyNoteObjectData> {
  const typeId = CORE_TYPE_IDS.stickyNote;
  return {
    id: typeId,
    kind: "stickyNote",
    titleKey: "tool.sticky",
    version: 1,
    factory: () =>
      ({
        kind: "stickyNote",
        id: nextFactoryId(typeId),
        position: vec2(0, 0),
        rotation: 0,
        zIndex: 0,
        visible: true,
        locked: false,
        width: 220,
        height: 220,
        text: "",
        fontSize: 18,
        noteColor: "oklch(0.87 0.14 85)",
        color: "oklch(0.30 0.03 55)",
      }) as StickyNoteObjectData,
    catalog: {
      titleKey: "tool.sticky",
      group: "text&notes",
      order: 20,
      icon: "StickyNote",
    },
    serialize: (object) => writeObject(object, typeId, 1),
    deserialize: (raw) => {
      const common = readCommonFields(raw);
      if (common === null) {
        return null;
      }
      const width = size_(raw, "width");
      const height = size_(raw, "height");
      const text = string_(raw, "text");
      const fontSize = number_(raw.fontSize);
      const noteColor = string_(raw, "noteColor");
      const color = string_(raw, "color");
      if (
        width === null ||
        height === null ||
        text === null ||
        fontSize === null ||
        fontSize <= 0 ||
        noteColor === null ||
        color === null
      ) {
        return null;
      }
      return {
        ...common,
        kind: "stickyNote",
        width,
        height,
        text,
        fontSize,
        ...(typeof raw.fontFamily === "string" && raw.fontFamily !== ""
          ? { fontFamily: raw.fontFamily }
          : {}),
        noteColor,
        color,
      };
    },
  };
}

/** Builds the image type entry (inline data-URL source). */
function imageEntry(): ObjectRegistryEntry<ImageObjectData> {
  const typeId = CORE_TYPE_IDS.image;
  return {
    id: typeId,
    kind: "image",
    titleKey: "objectTypes.image",
    version: 1,
    factory: () =>
      ({
        kind: "image",
        id: nextFactoryId(typeId),
        position: vec2(0, 0),
        rotation: 0,
        zIndex: 0,
        visible: true,
        locked: false,
        src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        naturalWidth: 1,
        naturalHeight: 1,
        width: 120,
        height: 120,
        // فاز ۳۴ «زمان صفر»: the catalog factory's own insert snapshot.
        initial: { width: 120, height: 120, x: 0, y: 0, rotation: 0 },
      }) as ImageObjectData,
    catalog: {
      titleKey: "objectTypes.image",
      group: "media",
      order: 10,
      icon: "Image",
    },
    serialize: (object) => writeObject(object, typeId, 1),
    deserialize: (raw) => {
      const common = readCommonFields(raw);
      if (common === null) {
        return null;
      }
      const src = string_(raw, "src");
      const naturalWidth = number_(raw.naturalWidth);
      const naturalHeight = number_(raw.naturalHeight);
      const width = size_(raw, "width");
      const height = size_(raw, "height");
      if (
        src === null ||
        src.length === 0 ||
        naturalWidth === null ||
        naturalHeight === null ||
        naturalWidth <= 0 ||
        naturalHeight <= 0 ||
        width === null ||
        height === null
      ) {
        return null;
      }
      // فاز ۳۴ «زمان صفر»: the optional insert snapshot — absent on legacy
      // scenes (pre-1.41.0) and omitted (never fatal) when malformed: a
      // mangled snapshot degrades to the natural-size reset semantics
      // instead of refusing the whole image.
      const initial = readImageInsertState(raw.initial);
      return {
        ...common,
        kind: "image",
        src,
        naturalWidth,
        naturalHeight,
        width,
        height,
        ...(initial !== null ? { initial } : {}),
      };
    },
  };
}

/**
 * Parses the optional «زمان صفر» insert snapshot (فاز ۳۴).
 *
 * @param value - the raw wire value of `initial`.
 * @returns the validated snapshot, or null when absent/malformed (the
 *          image still loads — the insert-reset degrades gracefully).
 */
function readImageInsertState(value: unknown): ImageInsertState | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const width = number_(raw.width);
  const height = number_(raw.height);
  const x = number_(raw.x);
  const y = number_(raw.y);
  const rotation = number_(raw.rotation);
  if (
    width === null ||
    height === null ||
    x === null ||
    y === null ||
    rotation === null ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { width, height, x, y, rotation };
}

/** Builds the video type entry (فاز M1 — sidecar AssetStore hashes). */
function videoEntry(): ObjectRegistryEntry<VideoObjectData> {
  const typeId = CORE_TYPE_IDS.video;
  return {
    id: typeId,
    kind: "video",
    titleKey: "objectTypes.video",
    version: 1,
    factory: () =>
      ({
        kind: "video",
        id: nextFactoryId(typeId),
        position: vec2(0, 0),
        rotation: 0,
        zIndex: 0,
        visible: true,
        locked: false,
        // The placeholder factory never surfaces to users (the card's
        // insert action opens the file picker instead — A.2.6); the
        // zero-hash + null poster keeps it structurally valid.
        assetHash: "0".repeat(64),
        thumbHash: null,
        originalName: "video.mp4",
        mimeType: "video/mp4",
        durationMs: 0,
        naturalWidth: 640,
        naturalHeight: 360,
        width: 320,
        height: 180,
      }) as VideoObjectData,
    catalog: {
      titleKey: "objectTypes.video",
      group: "media",
      // Order AFTER the image card (A.2.6).
      order: 11,
      icon: "Film",
    },
    serialize: (object) => writeObject(object, typeId, 1),
    deserialize: (raw) => {
      const common = readCommonFields(raw);
      if (common === null) {
        return null;
      }
      const assetHash = string_(raw, "assetHash");
      if (assetHash === null || !isSha256Hex(assetHash)) {
        return null;
      }
      // The optional poster hash — absent/wrong-typed/malformed values
      // degrade to null (the film-icon fallback poster), never refuse
      // the object (the lenient optional-field rule).
      const thumbHashCandidate = string_(raw, "thumbHash");
      const thumbHash =
        thumbHashCandidate !== null && isSha256Hex(thumbHashCandidate)
          ? thumbHashCandidate
          : null;
      const originalName = string_(raw, "originalName");
      const mimeType = string_(raw, "mimeType");
      const durationMs = number_(raw.durationMs);
      const naturalWidth = number_(raw.naturalWidth);
      const naturalHeight = number_(raw.naturalHeight);
      const width = size_(raw, "width");
      const height = size_(raw, "height");
      if (
        originalName === null ||
        originalName.length === 0 ||
        mimeType === null ||
        mimeType.length === 0 ||
        durationMs === null ||
        durationMs < 0 ||
        naturalWidth === null ||
        naturalHeight === null ||
        naturalWidth <= 0 ||
        naturalHeight <= 0 ||
        width === null ||
        height === null
      ) {
        return null;
      }
      // The optional KEPT-original hash (M2 conversions); malformed
      // values drop the field, never the object.
      const origAssetHashRaw = string_(raw, "origAssetHash");
      const origAssetHash =
        origAssetHashRaw !== null && isSha256Hex(origAssetHashRaw)
          ? origAssetHashRaw
          : undefined;
      return {
        ...common,
        kind: "video",
        assetHash,
        thumbHash,
        originalName,
        mimeType,
        durationMs,
        naturalWidth,
        naturalHeight,
        width,
        height,
        ...(origAssetHash !== undefined ? { origAssetHash } : {}),
      };
    },
  };
}

/** Builds the audio type entry (فاز A1 — sidecar AssetStore hashes). */
function audioEntry(): ObjectRegistryEntry<AudioObjectData> {
  const typeId = CORE_TYPE_IDS.audio;
  return {
    id: typeId,
    kind: "audio",
    titleKey: "objectTypes.audio",
    version: 1,
    factory: () =>
      ({
        kind: "audio",
        id: nextFactoryId(typeId),
        position: vec2(0, 0),
        rotation: 0,
        zIndex: 0,
        visible: true,
        locked: false,
        // The placeholder factory never surfaces to users (the card's
        // insert action opens the file picker instead — A.2.6); the
        // zero-hash + null waveform keeps it structurally valid.
        assetHash: "0".repeat(64),
        thumbHash: null,
        originalName: "audio.mp3",
        mimeType: "audio/mpeg",
        durationMs: 0,
        width: 240,
        height: 80,
      }) as AudioObjectData,
    catalog: {
      titleKey: "objectTypes.audio",
      group: "media",
      // Order AFTER the video card (A.2.6).
      order: 12,
      icon: "Music",
    },
    serialize: (object) => writeObject(object, typeId, 1),
    deserialize: (raw) => {
      const common = readCommonFields(raw);
      if (common === null) {
        return null;
      }
      const assetHash = string_(raw, "assetHash");
      if (assetHash === null || !isSha256Hex(assetHash)) {
        return null;
      }
      // The optional waveform hash — absent/wrong-typed/malformed values
      // degrade to null (the audio-note fallback plate), never refuse
      // the object (the lenient optional-field rule).
      const thumbHashCandidate = string_(raw, "thumbHash");
      const thumbHash =
        thumbHashCandidate !== null && isSha256Hex(thumbHashCandidate)
          ? thumbHashCandidate
          : null;
      const originalName = string_(raw, "originalName");
      const mimeType = string_(raw, "mimeType");
      const durationMs = number_(raw.durationMs);
      const width = size_(raw, "width");
      const height = size_(raw, "height");
      if (
        originalName === null ||
        originalName.length === 0 ||
        mimeType === null ||
        mimeType.length === 0 ||
        durationMs === null ||
        durationMs < 0 ||
        width === null ||
        height === null
      ) {
        return null;
      }
      // The optional KEPT-original hash (A2 conversions); malformed
      // values drop the field, never the object.
      const origAssetHashRaw = string_(raw, "origAssetHash");
      const origAssetHash =
        origAssetHashRaw !== null && isSha256Hex(origAssetHashRaw)
          ? origAssetHashRaw
          : undefined;
      return {
        ...common,
        kind: "audio",
        assetHash,
        thumbHash,
        originalName,
        mimeType,
        durationMs,
        width,
        height,
        ...(origAssetHash !== undefined ? { origAssetHash } : {}),
      };
    },
  };
}

/**
 * @param value - the candidate hash.
 * @returns whether it is a 64-character lower-case hex SHA-256.
 */
function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/** Builds the PDF type entry (فاز P1 — sidecar AssetStore hashes + pages). */
function pdfEntry(): ObjectRegistryEntry<PdfObjectData> {
  const typeId = CORE_TYPE_IDS.pdf;
  return {
    id: typeId,
    kind: "pdf",
    titleKey: "objectTypes.pdf",
    version: 1,
    factory: () =>
      ({
        kind: "pdf",
        id: nextFactoryId(typeId),
        position: vec2(0, 0),
        rotation: 0,
        zIndex: 0,
        visible: true,
        locked: false,
        // The placeholder factory never surfaces to users (the card's
        // insert action opens the file picker instead — A.2.6); the
        // zero-hash + null poster keeps it structurally valid.
        assetHash: "0".repeat(64),
        thumbHash: null,
        originalName: "document.pdf",
        pageCount: 1,
        currentPage: 1,
        naturalWidth: 595,
        naturalHeight: 842,
        width: 300,
        height: 424,
      }) as PdfObjectData,
    catalog: {
      titleKey: "objectTypes.pdf",
      group: "media",
      // Order AFTER the audio card (A.2.6).
      order: 13,
      icon: "FileText",
    },
    serialize: (object) => writeObject(object, typeId, 1),
    deserialize: (raw) => {
      const common = readCommonFields(raw);
      if (common === null) {
        return null;
      }
      const assetHash = string_(raw, "assetHash");
      if (assetHash === null || !isSha256Hex(assetHash)) {
        return null;
      }
      // The optional page-poster hash — absent/wrong-typed/malformed
      // values degrade to null (the document-glyph fallback plate),
      // never refuse the object (the lenient optional-field rule).
      const thumbHashCandidate = string_(raw, "thumbHash");
      const thumbHash =
        thumbHashCandidate !== null && isSha256Hex(thumbHashCandidate)
          ? thumbHashCandidate
          : null;
      const originalName = string_(raw, "originalName");
      if (originalName === null || originalName.length === 0) {
        return null;
      }
      const pageCountRaw = number_(raw.pageCount);
      const pageCount =
        pageCountRaw !== null && pageCountRaw >= 1
          ? Math.floor(pageCountRaw)
          : 1;
      const currentPageRaw = number_(raw.currentPage);
      const currentPage = clampPdfPage(currentPageRaw ?? 1, pageCount);
      const naturalWidth = number_(raw.naturalWidth);
      const naturalHeight = number_(raw.naturalHeight);
      const width = size_(raw, "width");
      const height = size_(raw, "height");
      if (
        naturalWidth === null ||
        naturalWidth <= 0 ||
        naturalHeight === null ||
        naturalHeight <= 0 ||
        width === null ||
        height === null
      ) {
        return null;
      }
      return {
        ...common,
        kind: "pdf",
        assetHash,
        thumbHash,
        originalName,
        pageCount,
        currentPage,
        naturalWidth,
        naturalHeight,
        width,
        height,
      };
    },
  };
}

/** Builds the connector type entry. */
function connectorEntry(): ObjectRegistryEntry<ConnectorObjectData> {
  const typeId = CORE_TYPE_IDS.connector;
  return {
    id: typeId,
    kind: "connector",
    titleKey: "tool.connector",
    version: 1,
    factory: () =>
      ({
        kind: "connector",
        id: nextFactoryId(typeId),
        position: vec2(0, 0),
        rotation: 0,
        zIndex: 0,
        visible: true,
        locked: false,
        start: { objectId: null, anchorIndex: 0, position: vec2(0, 0) },
        end: { objectId: null, anchorIndex: 0, position: vec2(120, 0) },
        routingKind: "straight",
        strokeColor: "token://stroke",
        strokeWidth: 2,
        strokeStyle: "solid",
        startArrow: "none",
        endArrow: "arrow",
      }) as ConnectorObjectData,
    catalog: {
      titleKey: "tool.connector",
      group: "drawing",
      order: 10,
      icon: "Spline",
    },
    serialize: (object) => writeObject(object, typeId, 1),
    deserialize: (raw) => {
      const common = readCommonFields(raw);
      if (common === null) {
        return null;
      }
      const start = readEndpoint(raw.start);
      const end = readEndpoint(raw.end);
      const routingKind = enumOf<ConnectorRoutingKind>(
        raw.routingKind,
        ROUTINGS,
      );
      const strokeColor = string_(raw, "strokeColor");
      const strokeWidth = number_(raw.strokeWidth);
      const strokeStyle = enumOf<StrokeStyleKind>(
        raw.strokeStyle,
        STROKE_STYLES,
      );
      const startArrow = enumOf<ArrowStyle>(raw.startArrow, ARROWS);
      const endArrow = enumOf<ArrowStyle>(raw.endArrow, ARROWS);
      // R5.3: optional single-line midpoint label (absent in pre-Phase-5
      // payloads — undefined keeps them label-less, byte-compatible).
      const label =
        typeof raw.label === "string" && raw.label.length > 0
          ? raw.label
          : undefined;
      if (
        start === null ||
        end === null ||
        routingKind === null ||
        strokeColor === null ||
        strokeWidth === null ||
        strokeWidth < 0 ||
        strokeStyle === null ||
        startArrow === null ||
        endArrow === null
      ) {
        return null;
      }
      return {
        ...common,
        kind: "connector",
        start,
        end,
        routingKind,
        strokeColor,
        strokeWidth,
        strokeStyle,
        startArrow,
        endArrow,
        label,
      };
    },
  };
}

/** Builds the freehand stroke type entry. */
function freehandEntry(): ObjectRegistryEntry<FreehandObjectData> {
  const typeId = CORE_TYPE_IDS.freehand;
  return {
    id: typeId,
    kind: "freehand",
    titleKey: "tool.pen",
    version: 1,
    factory: () =>
      ({
        kind: "freehand",
        id: nextFactoryId(typeId),
        position: vec2(0, 0),
        rotation: 0,
        zIndex: 0,
        visible: true,
        locked: false,
        points: [vec2(0, 0), vec2(60, 40)],
        strokeColor: "token://stroke",
        strokeWidth: 2,
        strokeStyle: "solid",
      }) as FreehandObjectData,
    catalog: {
      titleKey: "tool.pen",
      group: "drawing",
      order: 20,
      icon: "PenLine",
    },
    serialize: (object) => writeObject(object, typeId, 1),
    deserialize: (raw) => {
      const common = readCommonFields(raw);
      if (common === null) {
        return null;
      }
      const points = readPoints(raw.points);
      const strokeColor = string_(raw, "strokeColor");
      const strokeWidth = number_(raw.strokeWidth);
      const strokeStyle = enumOf<StrokeStyleKind>(
        raw.strokeStyle,
        STROKE_STYLES,
      );
      // R5.4: optional marker mode (absent in pre-Phase-5 payloads —
      // undefined keeps them normal strokes, byte-compatible).
      const highlighter = raw.highlighter === true ? true : undefined;
      if (
        points === null ||
        points.length === 0 ||
        strokeColor === null ||
        strokeWidth === null ||
        strokeWidth <= 0 ||
        strokeStyle === null
      ) {
        return null;
      }
      return {
        ...common,
        kind: "freehand",
        points,
        strokeColor,
        strokeWidth,
        strokeStyle,
        highlighter,
      };
    },
  };
}

/** Builds the group type entry. */
function groupEntry(): ObjectRegistryEntry<GroupObjectData> {
  const typeId = CORE_TYPE_IDS.group;
  return {
    id: typeId,
    kind: "group",
    titleKey: "objectTypes.group",
    version: 1,
    factory: () =>
      ({
        kind: "group",
        id: nextFactoryId(typeId),
        position: vec2(0, 0),
        rotation: 0,
        zIndex: 0,
        visible: true,
        locked: false,
        childIds: [],
      }) as GroupObjectData,
    serialize: (object) => writeObject(object, typeId, 1),
    deserialize: (raw) => {
      const common = readCommonFields(raw);
      if (common === null) {
        return null;
      }
      const childIds = raw.childIds;
      if (!Array.isArray(childIds)) {
        return null;
      }
      for (const child of childIds) {
        if (typeof child !== "string" || child.length === 0) {
          return null;
        }
      }
      return { ...common, kind: "group", childIds };
    },
  };
}

/**
 * Builds the opaque placeholder entry (§1.7.4): the ONLY writer of
 * unknown payloads. Serialize writes the retained raw JSON back out
 * VERBATIM; deserialize materialises the placeholder (selectable, locked,
 * dashed «شیء ناشناخته» rendering via the canvas layer).
 */
function opaqueEntry(): ObjectRegistryEntry<OpaqueObjectData> {
  const typeId = CORE_TYPE_IDS.opaque;
  return {
    id: typeId,
    kind: "opaque",
    titleKey: "object.opaque",
    version: 1,
    factory: () =>
      materializeOpaqueObject({
        unknownType: typeId,
        id: nextFactoryId(typeId),
      }),
    serialize: (object) => ({ ...(object.raw as Record<string, unknown>) }),
    deserialize: (raw) => materializeOpaqueObject(raw),
  };
}

/**
 * Reads one connector endpoint.
 *
 * @param value - the raw endpoint field.
 * @returns the endpoint, or null.
 */
function readEndpoint(value: unknown): ConnectorEndpoint | null {
  const raw = record_(value);
  if (raw === null) {
    return null;
  }
  const objectId = optionalString(raw, "objectId");
  const anchorIndex = number_(raw.anchorIndex);
  const position = vec2_(raw, "position");
  if (
    objectId === null ||
    anchorIndex === null ||
    anchorIndex < 0 ||
    position === null
  ) {
    return null;
  }
  return { objectId: objectId ?? null, anchorIndex, position };
}

/**
 * Reads a freehand point list.
 *
 * @param value - the raw `points` field.
 * @returns the points, or null when any entry is malformed.
 */
function readPoints(value: unknown): Vec2[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const points: Vec2[] = [];
  for (const entry of value) {
    const x = number_((entry as { x?: unknown } | null)?.x);
    const y = number_((entry as { y?: unknown } | null)?.y);
    if (x === null || y === null) {
      return null;
    }
    points.push(vec2(x, y));
  }
  return points;
}
