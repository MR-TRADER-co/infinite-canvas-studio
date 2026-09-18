/**
 * Versioned serializer: reads and writes versioned `.icb` project files,
 * running the global migration chain on load and the per-object-type
 * chains through the registry (R4.4).
 *
 * v2 file layout (R4.2, JSON):
 * ```json
 * {
 *   "schemaVersion": 2,
 *   "meta": { "magic": ".icb", "savedAt": 1699999999999 },
 *   "camera": { "x": 0, "y": 0, "zoom": 1, "rotation": 0 },
 *   "scene": { "objects": [ { "typeId": "core.shape", … } ] },
 *   "plugins": {}
 * }
 * ```
 *
 * The `plugins` section is ALWAYS written (an empty object is fine) and
 * is a strict passthrough: the core never parses it, and unknown content
 * survives load→save unchanged (§1.7.4).
 *
 * `deserialize` is defensive end-to-end: JSON parse errors, wrong magic,
 * broken migration chains and structurally invalid envelopes yield `null`
 * (a corrupt file is "no save", never a crash). An unknown FUTURE global
 * version yields the `future` outcome — a clear Persian error plus an
 * "open read-only" offer (R4.4a): the file parses best-effort (no
 * migrations, registry/opaque objects) and the document opens read-only
 * so a re-save can never destroy future-format data.
 */
import {
  asRecord,
  PROJECT_MAGIC,
  PROJECT_FILE_VERSION,
  validateProjectData,
  deserializeSceneObject,
  serializeSceneObjects,
  type ProjectData,
  type ProjectFileHeader,
} from "@/persistence/ProjectFile";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import { registerCoreObjectTypes } from "@/persistence/objectTypes";
import { runMigrations } from "@/persistence/migrations";
import { readBookmarks } from "@/core/bookmarks/BookmarkService";
import { readLinksSection } from "@/core/knowledge/LinkRegistry";
import type { LinksSection } from "@/core/knowledge/LinkRegistry";
import { parseStylesSection } from "@/core/knowledge/StyleRegistry";
import { normalizeSchemaSection } from "@/core/model/Properties";

/**
 * Builds the default registry (core types registered) for standalone
 * serializer use.
 *
 * @returns a fresh registry with the first-party object types.
 */
function createDefaultRegistry(): ObjectRegistry {
  return registerCoreObjectTypes(new ObjectRegistry());
}

/** Outcome of one deserialise attempt. */
export type DeserializeOutcome =
  | {
      /** A well-formed, migrated project. */
      readonly status: "ok";
      /** The restored document. */
      readonly data: ProjectData;
      /** Save timestamp from the file's meta (null when absent). */
      readonly savedAt: number | null;
    }
  | {
      /** A future-format file opened leniently (read-only, R4.4a). */
      readonly status: "future";
      /** The file's declared schema version. */
      readonly fileVersion: number;
      /** The best-effort parsed document (registry/opaque objects). */
      readonly data: ProjectData;
    }
  | { readonly status: "corrupt" };

/** Reads and writes versioned project files. */
export class VersionedSerializer {
  /** File format version this serializer writes. */
  public readonly currentVersion = PROJECT_FILE_VERSION;

  /** The registry every object (de)serialization iterates (R4.1). */
  private readonly registry: ObjectRegistry;

  /**
   * @param registry - the object registry (core types pre-registered).
   *        Defaults to a fresh registry with the core types registered —
   *        the composition root injects the app-wide instance so future
   *        plugin registrations flow through every save/load.
   */
  public constructor(registry?: ObjectRegistry) {
    this.registry = registry ?? createDefaultRegistry();
  }

  /**
   * @returns the file header describing the version this serializer writes.
   */
  public header(): ProjectFileHeader {
    return { magic: PROJECT_MAGIC, version: this.currentVersion };
  }

  /**
   * Serialises project data into the v2 JSON file payload.
   *
   * @param data - the project data to serialise (camera + objects + the
   *        passthrough plugins section).
   * @param savedAt - epoch milliseconds stamped into the file (default: now).
   * @returns the JSON payload.
   */
  public serialize(data: ProjectData, savedAt: number = Date.now()): string {
    const file = {
      schemaVersion: this.currentVersion,
      meta: { magic: PROJECT_MAGIC, savedAt },
      camera: { ...data.camera },
      scene: { objects: serializeSceneObjects(data.objects, this.registry) },
      // R7.9: bookmarks persist with the project (absent when none —
      // older files simply have no field, which reads back as none).
      ...(data.bookmarks === undefined || data.bookmarks.length === 0
        ? {}
        : { bookmarks: data.bookmarks.map((bookmark) => ({ ...bookmark })) }),
      // R4.2: ALWAYS written — an empty object is fine; the core never
      // interprets the contents (§1.7.4 passthrough law).
      plugins: data.plugins === undefined ? {} : { ...data.plugins },
      // R13.3 (schema v3): the user styles section — ALWAYS written (an
      // empty list is fine; the migration 2→3 guarantees the field).
      styles:
        data.styles === undefined
          ? { version: 1, styles: [] }
          : { version: 1, styles: data.styles.styles.map((x) => ({ ...x })) },
      // Pack R11.3: the property-schema section — written only when the
      // project knows fields (absent on pre-property files reads as none).
      ...(data.propertySchema === undefined ||
      Object.keys(data.propertySchema.fields).length === 0
        ? {}
        : {
            propertySchema: {
              version: 1,
              fields: Object.fromEntries(
                Object.entries(data.propertySchema.fields).map(([name, field]) => [
                  name,
                  field.options === undefined
                    ? { type: field.type }
                    : { type: field.type, options: [...field.options] },
                ]),
              ),
            },
          }),
      // Pack R11.2/R11.6: the link-registry section — §1.7.8's persisted
      // link state (absent on pre-link files reads as none).
      ...(data.links === undefined || data.links.links.length === 0
        ? {}
        : {
            links: {
              version: 1,
              links: data.links.links.map((entry) => ({ ...entry })),
            },
          }),
    };
    return JSON.stringify(file);
  }

  /**
   * Parses a payload read from disk, migrating it to the current version.
   *
   * @param raw - the raw JSON payload.
   * @returns the deserialise outcome: `ok` (migrated project + timestamp),
   *          `future` (leniently parsed future-format project) or `corrupt`.
   */
  public deserialize(raw: string): DeserializeOutcome {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: "corrupt" };
    }
    const root = asRecord(parsed);
    if (root === null) {
      return { status: "corrupt" };
    }
    // v1 kept the magic at the root; v2 keeps it in meta.
    if (root.magic !== PROJECT_MAGIC && !isV2Envelope(root)) {
      return { status: "corrupt" };
    }
    const version = root.schemaVersion ?? root.version;
    if (typeof version !== "number" || !Number.isInteger(version)) {
      return { status: "corrupt" };
    }
    if (version === this.currentVersion) {
      return this.parseV2(root, null);
    }
    if (version > this.currentVersion) {
      // Unknown future format (R4.4a): refuse to GUESS — parse leniently
      // (no migrations run) and hand the caller the read-only decision.
      return this.parseV2(root, version);
    }
    if (version < 1) {
      return { status: "corrupt" };
    }
    // Older file: walk the global chain forward, then parse the result.
    const migrated = runMigrations(root, version, this.currentVersion);
    if (migrated === null) {
      return { status: "corrupt" };
    }
    const migratedRoot = asRecord(migrated);
    if (migratedRoot === null) {
      return { status: "corrupt" };
    }
    return this.parseV2(migratedRoot, null);
  }

  /**
   * Parses a (migrated or future) v2-shaped root into project data.
   *
   * @param root - the v2 root record.
   * @param futureVersion - the declared version when it exceeds the
   *        serializer's (null for current-version files).
   * @returns the deserialise outcome.
   */
  private parseV2(
    root: Record<string, unknown>,
    futureVersion: number | null,
  ): DeserializeOutcome {
    const meta = asRecord(root.meta);
    const savedAtRaw = meta?.savedAt;
    const savedAt =
      typeof savedAtRaw === "number" && Number.isFinite(savedAtRaw)
        ? savedAtRaw
        : null;
    const camera = readCamera(root.camera);
    if (camera === null) {
      return { status: "corrupt" };
    }
    const scene = asRecord(root.scene);
    if (scene === null || !Array.isArray(scene.objects)) {
      return { status: "corrupt" };
    }
    const rawObjects = scene.objects;
    const objects = [];
    for (const entry of rawObjects) {
      const record = asRecord(entry);
      if (record === null) {
        continue;
      }
      objects.push(deserializeSceneObject(record, this.registry).object);
    }
    // Plugins passthrough (§1.7.4): retained verbatim, never interpreted.
    const plugins =
      root.plugins !== undefined && asRecord(root.plugins) !== null
        ? { ...(root.plugins as Record<string, unknown>) }
        : {};
    // Bookmarks (R7.9): defensively validated; a corrupt field reads as
    // "no bookmarks" (never a crash).
    const bookmarks = readBookmarks(root.bookmarks);
    // Named styles (R13.3): defensively validated; a corrupt section
    // reads as "no user styles" (never a crash).
    const styles = parseStylesSection(root.styles);
    // Property schema (pack R11.3): defensively validated; a corrupt
    // section reads as "no known fields" (never a crash).
    const propertySchema = normalizeSchemaSection(root.propertySchema);
    // Link registry (pack R11.2/R11.6): defensively validated; a corrupt
    // section reads as "no links" (never a crash).
    const links: LinksSection | undefined = readLinksSection(root.links);
    const data: ProjectData = {
      camera,
      objects,
      ...(bookmarks.length === 0 ? {} : { bookmarks }),
      plugins,
      ...(styles === null || styles.styles.length === 0 ? {} : { styles }),
      ...(propertySchema === undefined ? {} : { propertySchema }),
      ...(links === undefined ? {} : { links }),
    };
    if (!validateProjectData(data)) {
      return { status: "corrupt" };
    }
    if (futureVersion !== null) {
      return { status: "future", fileVersion: futureVersion, data };
    }
    return { status: "ok", data, savedAt };
  }
}

/**
 * @param root - the parsed root record.
 * @returns whether the root carries the v2 envelope markers.
 */
function isV2Envelope(root: Record<string, unknown>): boolean {
  const meta = asRecord(root.meta);
  return meta !== null && meta.magic === PROJECT_MAGIC;
}

/**
 * Reads + validates the camera half of the payload.
 *
 * @param value - the raw camera field.
 * @returns the camera data, or null when malformed.
 */
function readCamera(value: unknown): ProjectData["camera"] | null {
  const raw = asRecord(value);
  if (raw === null) {
    return null;
  }
  const x = raw.x;
  const y = raw.y;
  const zoom = raw.zoom;
  const rotation = raw.rotation;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    typeof zoom !== "number" ||
    !Number.isFinite(zoom) ||
    zoom <= 0 ||
    typeof rotation !== "number" ||
    !Number.isFinite(rotation)
  ) {
    return null;
  }
  return { x, y, zoom, rotation };
}
