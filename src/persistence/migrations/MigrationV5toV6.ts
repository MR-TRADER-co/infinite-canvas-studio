/**
 * Migration step 5 → 6 (فاز P1 — §1.7.4): the PDF object type joins
 * the scene graph.
 *
 * v5 (فاز A1): `{ "schemaVersion": 5, … }` (the audio object type).
 * v6 (فاز P1): `{ "schemaVersion": 6, …same fields… }`.
 *
 * The step is additive + NORMALISING (the exact V3→V4/V4→V5 shape):
 * existing objects pass through untouched; `core.pdf` payloads (which
 * only this build writes) have their optional fields coalesced —
 * `thumbHash` malformed values drop to null and `currentPage` clamps
 * into `[1, pageCount]` — so the registry's deserializer always sees a
 * well-formed v1 payload. Older files (no PDFs) load unchanged; the
 * unknown-type passthrough stays intact.
 */
import type { Migration } from "@/persistence/migrations/Migration";

/** One registered migration step of the project-file chain. */
export class MigrationV5toV6 implements Migration {
  public readonly fromVersion = 5;
  public readonly toVersion = 6;

  /**
   * Transforms a v5 root into the v6 layout.
   *
   * @param data - the parsed v5 file root.
   * @returns the v6 root (unknown input shapes pass through defensively —
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
 * Normalises ONE wire object: `core.pdf` payloads have their optional
 * fields coalesced; every other typeId passes through verbatim.
 *
 * @param object - the wire object payload.
 * @returns the normalised payload.
 */
function normaliseOne(object: unknown): unknown {
  if (typeof object !== "object" || object === null) {
    return object;
  }
  const raw = object as Record<string, unknown>;
  if (raw.typeId !== "core.pdf") {
    return raw;
  }
  const isHash = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  const pageCount =
    typeof raw.pageCount === "number" && raw.pageCount >= 1
      ? Math.floor(raw.pageCount)
      : 1;
  const requested =
    typeof raw.currentPage === "number" && Number.isFinite(raw.currentPage)
      ? Math.floor(raw.currentPage)
      : 1;
  const normalised: Record<string, unknown> = { ...raw };
  normalised.thumbHash = isHash(raw.thumbHash) ? raw.thumbHash : null;
  normalised.pageCount = pageCount;
  normalised.currentPage = Math.min(pageCount, Math.max(1, requested));
  return normalised;
}
