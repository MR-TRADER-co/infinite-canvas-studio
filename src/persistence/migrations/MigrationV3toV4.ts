/**
 * Migration step 3 → 4 (فاز M1 — §1.7.4): the video object type joins
 * the scene graph.
 *
 * v3 (R13.3):
 * ```json
 * { "schemaVersion": 3, "meta": {…}, "camera": {…},
 *   "scene": { "objects": […] }, "plugins": {}, "styles": {…} }
 * ```
 *
 * v4 (فاز M1):
 * ```json
 * { "schemaVersion": 4, …same fields… }
 * ```
 *
 * The step is additive + NORMALISING: existing objects pass through
 * untouched; `core.video` payloads (which only this build writes) get
 * their optional fields coalesced — `thumbHash`/`origAssetHash`
 * malformed values drop to null/absent so the registry's deserializer
 * always sees a well-formed v1 payload. Older files (no videos) load
 * unchanged; the unknown-type passthrough stays intact.
 */
import type { Migration } from "@/persistence/migrations/Migration";

/** One registered migration step of the project-file chain. */
export class MigrationV3toV4 implements Migration {
  public readonly fromVersion = 3;
  public readonly toVersion = 4;

  /**
   * Transforms a v3 root into the v4 layout.
   *
   * @param data - the parsed v3 file root.
   * @returns the v4 root (unknown input shapes pass through defensively —
   *          the serializer's structural validation refuses them later).
   */
  public migrate(data: unknown): unknown {
    if (typeof data !== "object" || data === null) {
      return data;
    }
    const root = { ...(data as Record<string, unknown>) } as Record<
      string,
      unknown
    >;
    const scene = root.scene;
    if (
      typeof scene === "object" &&
      scene !== null &&
      Array.isArray((scene as Record<string, unknown>).objects)
    ) {
      const objects = (scene as Record<string, unknown>)
        .objects as unknown[];
      (scene as Record<string, unknown>).objects = objects.map(normaliseOne);
    }
    root.schemaVersion = this.toVersion;
    return root;
  }
}

/**
 * Normalises ONE wire object: `core.video` payloads have their optional
 * hash fields coalesced; every other typeId passes through verbatim.
 *
 * @param object - the wire object payload.
 * @returns the normalised payload.
 */
function normaliseOne(object: unknown): unknown {
  if (typeof object !== "object" || object === null) {
    return object;
  }
  const raw = object as Record<string, unknown>;
  if (raw.typeId !== "core.video") {
    return raw;
  }
  const isHash = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  const normalised: Record<string, unknown> = { ...raw };
  normalised.thumbHash = isHash(raw.thumbHash) ? raw.thumbHash : null;
  if (!isHash(raw.origAssetHash)) {
    delete normalised.origAssetHash;
  }
  return normalised;
}
