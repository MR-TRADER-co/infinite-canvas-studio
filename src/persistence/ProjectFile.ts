/**
 * Project file format: offline `.icb` JSON files (CLAUDE.md §1.1/§1.2,
 * R4.1/R4.2).
 *
 * v2 envelope (R4.2): `{ schemaVersion, meta, camera, scene, plugins }` —
 * `schemaVersion` is the global format version (the migration chain walks
 * files forward), `meta` carries the magic marker + save timestamp,
 * `camera` is the viewport state, `scene.objects` holds every object in
 * paint order, and `plugins` is the STRICT passthrough section the core
 * never interprets (§1.7.4: unknown content survives load→save unchanged).
 *
 * Scene (de)serialization iterates the {@link ObjectRegistry} — never a
 * switch over type ids (§1.7.1). Unknown object type ids materialise as
 * OpaqueObject placeholders that serialize back verbatim; the TipTap
 * rich-text docs ride inside the text objects' payloads.
 */
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import {
  isOpaqueObject,
  materializeOpaqueObject,
  type OpaqueObjectData,
} from "@/core/model/OpaqueObject";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import { isPluginObject } from "@/core/model/PluginObject";
import type { Bookmark } from "@/core/bookmarks/BookmarkService";
import type { StylesSection } from "@/core/knowledge/StyleRegistry";
import type { PropertySchemaSection } from "@/core/model/Properties";
import type { LinksSection } from "@/core/knowledge/LinkRegistry";

/** Magic marker distinguishing Infinite Canvas Studio project files. */
export const PROJECT_MAGIC = ".icb" as const;

/**
 * Project file format version this build writes (v6 = the PDF object
 * type, فاز P1 — §1.7.4; older versions load through the migration chain).
 */
export const PROJECT_FILE_VERSION = 6;

/** Storage key of the autosave slot (web backend; Tauri uses the file name). */
export const AUTOSAVE_STORAGE_KEY = "infinite-canvas-studio/autosave/v1";

/** Storage key of the last successful disk-save timestamp (recovery). */
export const LAST_DISK_SAVE_STORAGE_KEY =
  "infinite-canvas-studio/last-disk-save/v1";

/** Camera half of the project payload. */
export interface ProjectCameraData {
  /** World x coordinate shown at the viewport origin. */
  readonly x: number;
  /** World y coordinate shown at the viewport origin. */
  readonly y: number;
  /** Scale factor (1 = 100%). */
  readonly zoom: number;
  /** Viewport rotation in radians. */
  readonly rotation: number;
}

/** Versioned project payload: everything needed to rebuild the document. */
export interface ProjectData {
  /** Camera state at save time. */
  readonly camera: ProjectCameraData;
  /** Every scene object in paint order (opaque placeholders included). */
  readonly objects: readonly SceneObjectData[];
  /**
   * Camera bookmarks (R7.9): persisted with the project; an absent field
   * (older files) means "no bookmarks".
   */
  readonly bookmarks?: readonly Bookmark[];
  /**
   * The plugins passthrough section (§1.7.4): written verbatim on save,
   * never interpreted by the core. Absent on fresh in-memory snapshots —
   * the serializer materialises `plugins: {}` so the field is ALWAYS
   * written (R4.2).
   */
  readonly plugins?: Readonly<Record<string, unknown>>;
  /**
   * Named styles (R13.3, schema v3): the user styles section. Absent on
   * older files (v2 and before) means "no user styles" — built-ins are
   * re-materialised at boot and never persisted.
   */
  readonly styles?: StylesSection;
  /**
   * The property schema (pack R11.3, optional): known property names →
   * type + select options, inferred on first use. Absent means "no
   * known fields" — the store starts empty and re-infers.
   */
  readonly propertySchema?: PropertySchemaSection;
  /**
   * The manual/plugin link registry section (pack R11.2/R11.6,
   * optional): §1.7.8's persisted link state. Absent on older files
   * means "no links" — pre-Phase-18 files read as link-less.
   */
  readonly links?: LinksSection;
}

/** Header written at the start of every `.icb` project file. */
export interface ProjectFileHeader {
  /** Magic marker distinguishing Infinite Canvas Studio project files. */
  readonly magic: typeof PROJECT_MAGIC;
  /** Project file format version (see `persistence/migrations/`). */
  readonly version: number;
}

/** Result of one registry-driven object load. */
export interface ObjectLoadOutcome {
  /** The materialised object data (never null — see `placeholder`). */
  readonly object: SceneObjectData;
  /** Whether the object materialised as an opaque placeholder (R4.3). */
  readonly placeholder: boolean;
}

/**
 * Snapshots the live scene into a serialisable project payload.
 *
 * @param scene - the scene to snapshot (objects in paint order + camera).
 * @param plugins - the document's passthrough section (default: none —
 *        the serializer writes an empty `plugins` object).
 * @param bookmarks - the document's camera bookmarks (R7.9, default: none).
 * @param styles - the named styles section (default: none).
 * @param propertySchema - the property-schema section (default: none).
 * @param links - the link-registry section (pack R11.2, default: none).
 * @returns the project data ready for serialisation.
 */
export function buildProjectData(
  scene: Scene,
  plugins?: Readonly<Record<string, unknown>>,
  bookmarks?: readonly Bookmark[],
  styles?: StylesSection,
  propertySchema?: PropertySchemaSection,
  links?: LinksSection,
): ProjectData {
  return {
    camera: {
      x: scene.camera.x,
      y: scene.camera.y,
      zoom: scene.camera.zoom,
      rotation: scene.camera.rotation,
    },
    objects: scene.objects.map((object) => ({ ...object })),
    ...(bookmarks === undefined ? {} : { bookmarks: [...bookmarks] }),
    ...(plugins === undefined ? {} : { plugins }),
    ...(styles === undefined || styles.styles.length === 0
      ? {}
      : { styles: { version: 1, styles: [...styles.styles] } }),
    ...(propertySchema === undefined ||
      Object.keys(propertySchema.fields).length === 0
      ? {}
      : {
          propertySchema: {
            version: 1,
            fields: { ...propertySchema.fields },
          },
        }),
    ...(links === undefined || links.links.length === 0
      ? {}
      : { links: { version: 1, links: [...links.links] } }),
  };
}

/**
 * Serializes every scene object through the registry (R4.1: iteration,
 * never a switch). Objects whose kind has no registered entry fall back
 * to a verbatim raw write so nothing is ever dropped.
 *
 * @param objects - the in-memory objects in paint order.
 * @param registry - the object registry (save-path lookup by kind).
 * @returns the wire payloads in the same order.
 */
export function serializeSceneObjects(
  objects: readonly SceneObjectData[],
  registry: ObjectRegistry,
): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = [];
  for (const object of objects) {
    // R9.9: plugin objects dispatch by their WIRE type id (their kind
    // index is the plugin-scoped typeId, not the shared "plugin").
    // An UNREGISTERED type (disabled/uninstalled plugin) serialises its
    // envelope VERBATIM — the wire typeId survives the round-trip so a
    // reload materialises the opaque placeholder (§1.7.4: nothing is
    // ever lost).
    if (isPluginObject(object)) {
      const entry = registry.entryForTypeId(object.typeId);
      if (entry !== undefined) {
        payloads.push(entry.serialize(object as never));
      } else {
        payloads.push({
          id: object.id,
          typeId: object.typeId,
          typeVersion: 1,
          kind: "plugin",
          ...(object.name !== undefined ? { name: object.name } : {}),
          ...(object.parentId !== undefined
            ? { parentId: object.parentId }
            : {}),
          position: { x: object.position.x, y: object.position.y },
          rotation: object.rotation,
          zIndex: object.zIndex,
          visible: object.visible,
          locked: object.locked,
          width: object.width,
          height: object.height,
          data: object.data,
        });
      }
      continue;
    }
    const entry = registry.entryForKind(object.kind);
    if (entry !== undefined) {
      payloads.push(entry.serialize(object as never));
      continue;
    }
    // Unregistered in-memory kind (a future plugin runtime object):
    // opaque-style verbatim write keeps the data (§1.7.4).
    if (isOpaqueObject(object)) {
      payloads.push({ ...object.raw });
      continue;
    }
    const { kind: _kind, ...fields } = object;
    payloads.push({ ...fields, typeId: `unregistered.${String(_kind)}` });
  }
  return payloads;
}

/**
 * Materialises one wire object through the registry (R4.1/R4.3).
 *
 * Load path: look the `typeId` up in the registry → run the entry's
 * per-type migration chain (R4.4b) → `deserialize`; an unregistered type
 * id, a broken migration chain, or a refused payload ALL fall back to the
 * OpaqueObject placeholder that retains the raw JSON verbatim — a
 * corrupt object never crashes the load and is never lost.
 *
 * @param raw - the wire payload read from the file.
 * @param registry - the object registry (load-path lookup by typeId).
 * @returns the load outcome (data + placeholder flag).
 */
export function deserializeSceneObject(
  raw: Record<string, unknown>,
  registry: ObjectRegistry,
): ObjectLoadOutcome {
  const typeId = typeof raw.typeId === "string" ? raw.typeId : null;
  const entry = typeId !== null ? registry.entryForTypeId(typeId) : undefined;
  if (entry === undefined) {
    return { object: materializeOpaqueObject(raw), placeholder: true };
  }
  const rawVersion = raw.typeVersion;
  const fromVersion =
    typeof rawVersion === "number" &&
    Number.isInteger(rawVersion) &&
    rawVersion >= 1
      ? rawVersion
      : 1;
  const migrated = ObjectRegistry.runTypeMigrations(entry, raw, fromVersion);
  if (migrated === null) {
    return { object: materializeOpaqueObject(raw), placeholder: true };
  }
  const record =
    typeof migrated === "object" &&
    migrated !== null &&
    !Array.isArray(migrated)
      ? (migrated as Record<string, unknown>)
      : null;
  if (record === null) {
    return { object: materializeOpaqueObject(raw), placeholder: true };
  }
  const data = entry.deserialize(record);
  if (data === null || data === undefined) {
    return { object: materializeOpaqueObject(raw), placeholder: true };
  }
  return { object: data, placeholder: false };
}

/**
 * Structural validation of a deserialised v2 payload (defensive: a
 * corrupted or hand-edited file must never crash the app on load — the
 * deep per-object validation happens through the registry's deserialize
 * with opaque fallbacks; this gate only refuses envelopes that are not
 * even shaped like a project).
 *
 * @param data - the candidate payload (already JSON-parsed + migrated).
 * @returns whether the payload is a well-formed project envelope.
 */
export function validateProjectData(data: unknown): data is ProjectData {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const candidate = data as Partial<ProjectData>;
  if (
    !isFiniteNumber(candidate.camera?.x) ||
    !isFiniteNumber(candidate.camera?.y)
  ) {
    return false;
  }
  if (
    !isFiniteNumber(candidate.camera?.zoom) ||
    !isFiniteNumber(candidate.camera?.rotation)
  ) {
    return false;
  }
  if ((candidate.camera?.zoom ?? 0) <= 0) {
    return false;
  }
  if (!Array.isArray(candidate.objects)) {
    return false;
  }
  for (const object of candidate.objects) {
    if (typeof object !== "object" || object === null) {
      return false;
    }
  }
  return true;
}

/**
 * Replaces the scene contents with a validated project payload: clears the
 * scene, re-adds every object in paint order (opaque placeholders
 * included) and restores the camera. The caller owns history (cleared
 * after a load) and id reseeding.
 *
 * @param scene - the scene being replaced.
 * @param data - the validated project payload.
 * @returns the number of applied objects.
 */
export function applyProjectData(scene: Scene, data: ProjectData): number {
  scene.clear();
  for (const object of data.objects) {
    scene.add(object);
  }
  scene.camera.x = data.camera.x;
  scene.camera.y = data.camera.y;
  scene.camera.zoom = data.camera.zoom;
  scene.camera.rotation = data.camera.rotation;
  return data.objects.length;
}

/**
 * @param value - the value to test.
 * @returns whether the value is a finite number (NaN/Infinity rejected).
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Narrow helper used by the serializer to type the parsed root object.
 *
 * @param raw - the parsed JSON root.
 * @returns the root as a mutable record, or null for non-objects.
 */
export function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null
    ? (raw as Record<string, unknown>)
    : null;
}

/**
 * Narrows one {@link ProjectData} object to its opaque variant (typed
 * helper for consumers that special-case placeholders, e.g. counts).
 *
 * @param object - the object to inspect.
 * @returns the opaque object data, or null.
 */
export function asOpaqueObject(
  object: SceneObjectData,
): OpaqueObjectData | null {
  return isOpaqueObject(object) ? object : null;
}
