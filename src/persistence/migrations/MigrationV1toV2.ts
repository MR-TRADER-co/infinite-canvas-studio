/**
 * Migration step 1 → 2 (R4.4a): lifts the legacy file envelope onto the
 * registry-based v2 layout.
 *
 * v1 (pre-registry):
 * ```json
 * { "magic": ".icb", "version": 1, "savedAt": 1,
 *   "scene": { "camera": {…}, "objects": [ { "kind": "shape", … } ] } }
 * ```
 *
 * v2 (R4.2):
 * ```json
 * { "schemaVersion": 2, "meta": { "magic": ".icb", "savedAt": 1 },
 *   "camera": {…}, "scene": { "objects": [ { "typeId": "core.shape", … } ] },
 *   "plugins": {} }
 * ```
 *
 * Object payloads: the in-memory `kind` discriminant becomes the
 * namespaced wire `typeId` (§1.7.2) — the seven first-party kinds map to
 * their `core.*` ids; anything else (a hand-edited file, a plugin object
 * written by a future build) keeps its value verbatim so it loads as an
 * OpaqueObject placeholder and survives round-trips (§1.7.4).
 */
import type { Migration } from "@/persistence/migrations/Migration";

/** The historical v1 kind → v2 type id table (frozen file-format history). */
const KIND_TO_TYPE_ID: Readonly<Record<string, string>> = {
  shape: "core.shape",
  textBox: "core.textBox",
  stickyNote: "core.stickyNote",
  image: "core.image",
  connector: "core.connector",
  freehand: "core.freehand",
  group: "core.group",
};

/** One registered migration step of the project-file chain. */
export class MigrationV1toV2 implements Migration {
  public readonly fromVersion = 1;
  public readonly toVersion = 2;

  /**
   * Transforms a v1 root into the v2 layout.
   *
   * @param data - the parsed v1 file root.
   * @returns the v2 root (unknown input shapes pass through defensively —
   *          the serializer's structural validation refuses them later).
   */
  public migrate(data: unknown): unknown {
    if (typeof data !== "object" || data === null) {
      return data;
    }
    const root = data as Record<string, unknown>;
    const scene = root.scene;
    const legacyScene =
      typeof scene === "object" && scene !== null
        ? (scene as Record<string, unknown>)
        : {};
    // A non-array objects field is kept VERBATIM — the v2 structural
    // validation refuses the file instead of silently dropping content.
    const objects = Array.isArray(legacyScene.objects)
      ? legacyScene.objects.map((entry) => {
          if (
            typeof entry !== "object" ||
            entry === null ||
            Array.isArray(entry)
          ) {
            return entry;
          }
          const object = entry as Record<string, unknown>;
          const { kind: _kind, ...fields } = object;
          const typeId =
            typeof _kind === "string"
              ? (KIND_TO_TYPE_ID[_kind] ?? _kind)
              : "core.opaque";
          return { ...fields, typeId };
        })
      : legacyScene.objects;
    return {
      schemaVersion: 2,
      meta: {
        magic: root.magic,
        savedAt: root.savedAt,
      },
      camera: legacyScene.camera,
      scene: { objects },
      plugins: {},
    };
  }
}
