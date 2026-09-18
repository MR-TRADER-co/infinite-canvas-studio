/**
 * Live knowledge-query object (R15.2 + R12.2 — «کوئری زنده»): a canvas
 * card that renders the LIVE result of one query — the backlinks of a
 * title, the objects of a tag, every broken link, the link-less
 * islands, or a FULL structured filter (the Phase-12 QuerySpec:
 * property filters + tags + text + links + kinds + sort/group + limit)
 * executed by `core/knowledge/QueryEngine` (law §1.7.9).
 *
 * The object stores ONLY the query spec (`queryType` + `queryTarget`
 * + the optional structured `querySpec`). The result rows are computed
 * at render time from the current knowledge snapshot (see
 * `core/knowledge/KnowledgeQueries.ts` + `QueryEngine.ts`) — never
 * persisted, never part of undo, so the card can never go stale inside
 * a project: it re-resolves on every `knowledge:changed`.
 *
 * Geometry follows the sticker precedent: `width`/`height` measured from
 * `position` (the top-left corner), so the generic bbox/translate/move/
 * resize/marquee machinery works with zero extra code.
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import {
  DEFAULT_SCENE_QUERY_SPEC,
  normalizeSceneQuerySpec,
  type SceneQuerySpec,
} from "@/core/knowledge/QueryEngine";

/** Default card footprint in world units (readable list at zoom 1). */
export const QUERY_DEFAULT_WIDTH = 264;

/** Default card height in world units (header + ~6 rows at zoom 1). */
export const QUERY_DEFAULT_HEIGHT = 168;

/** The live query kinds the card can run over the knowledge index. */
export type QueryType =
  | "backlinks"
  | "tag"
  | "broken"
  | "orphans"
  | "filter";

/** Every legal query type (deserialization allowlist + UI options). */
export const QUERY_TYPES: readonly QueryType[] = [
  "backlinks",
  "tag",
  "broken",
  "orphans",
  "filter",
] as const;

/** One query specification (what the card asks the knowledge index). */
export interface QuerySpec {
  /** The query kind. */
  readonly type: QueryType;
  /**
   * The target key: a title for `backlinks`, a tag for `tag`, ignored
   * (empty) for `broken`/`orphans`/`filter`.
   */
  readonly target: string;
  /**
   * The structured engine spec (the `filter` kind only — R12.1's
   * QuerySpec; validated through `normalizeSceneQuerySpec`).
   */
  readonly structured?: SceneQuerySpec;
}

/** Longest accepted target (title/tag keys are short by nature). */
export const QUERY_TARGET_MAX = 200;

/** The presentation columns of a filter card's results table (≤ 3). */
export const QUERY_COLUMNS_MAX = 3;

/**
 * Data of a live knowledge-query object.
 */
export interface QueryObjectData extends SceneObjectData {
  /** Discriminant: always `query`. */
  readonly kind: "query";
  /** Card width in world units (≥ 0; `position` is the top-left corner). */
  readonly width: number;
  /** Card height in world units (≥ 0). */
  readonly height: number;
  /** The query kind. */
  readonly queryType: QueryType;
  /** The query target key (title/tag; empty for targetless queries). */
  readonly queryTarget: string;
  /**
   * The structured QuerySpec (the `filter` kind only, R12.2). Absent on
   * the four knowledge kinds; always normalized on read.
   */
  readonly querySpec?: SceneQuerySpec;
  /**
   * The results table's property columns (presentation-only, ≤ 3) —
   * the `filter` kind only; absent = the plain title rows.
   */
  readonly columns?: readonly string[];
}

/**
 * Type guard narrowing a generic scene object to its query variant.
 *
 * @param object - the object to test.
 * @returns whether the object is a live query card.
 */
export function isQueryObject(
  object: SceneObjectData,
): object is QueryObjectData {
  return (
    object.kind === "query" &&
    typeof (object as QueryObjectData).width === "number" &&
    typeof (object as QueryObjectData).height === "number" &&
    typeof (object as QueryObjectData).queryType === "string" &&
    typeof (object as QueryObjectData).queryTarget === "string"
  );
}

/**
 * The query spec of a query object.
 *
 * @param object - the query object.
 * @returns its `{ type, target }` specification.
 */
export function querySpecOf(object: QueryObjectData): QuerySpec {
  return { type: object.queryType, target: object.queryTarget };
}

/**
 * The validated structured spec of a filter card (never null — an
 * absent/corrupt spec degrades to the all-match default).
 *
 * @param object - the query object.
 * @returns the normalized structured QuerySpec.
 */
export function structuredSpecOf(object: QueryObjectData): SceneQuerySpec {
  return object.querySpec ?? DEFAULT_SCENE_QUERY_SPEC;
}

/**
 * Assembles a complete query object.
 *
 * @param id - the object id.
 * @param position - the top-left corner in world space.
 * @param spec - the query specification.
 * @param size - the `{ width, height }` footprint (defaults 264×168).
 * @param zIndex - the paint order.
 * @returns the query object data.
 */
export function makeQueryObject(
  id: string,
  position: Vec2,
  spec: QuerySpec,
  size: { width: number; height: number } = {
    width: QUERY_DEFAULT_WIDTH,
    height: QUERY_DEFAULT_HEIGHT,
  },
  zIndex: number = 0,
): QueryObjectData {
  const isFilter = spec.type === "filter";
  return {
    kind: "query",
    id,
    position,
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    width: size.width,
    height: size.height,
    queryType: spec.type,
    queryTarget: spec.target,
    ...(isFilter
      ? {
          querySpec: spec.structured ?? DEFAULT_SCENE_QUERY_SPEC,
          columns: [],
        }
      : {}),
  };
}

/**
 * Normalizes the presentation columns on read (≤ 3, clean, deduped).
 *
 * @param raw - the wire value of `columns`.
 * @returns the clean column list, or undefined when absent/empty.
 */
export function normalizeQueryColumns(
  raw: unknown,
): readonly string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const clean = item.trim().slice(0, 40);
    if (clean.length === 0 || seen.has(clean) || out.length >= QUERY_COLUMNS_MAX) {
      continue;
    }
    seen.add(clean);
    out.push(clean);
  }
  return out.length === 0 ? undefined : out;
}

/**
 * Re-validates a wire `querySpec` on load (the §1.7.4 unknown-data
 * law: a corrupt SHAPE degrades to the default spec, never a drop of
 * the whole card).
 *
 * @param raw - the wire value.
 * @returns the normalized spec (the default when corrupt/absent).
 */
export function querySpecOnLoad(raw: unknown): SceneQuerySpec {
  return normalizeSceneQuerySpec(raw) ?? DEFAULT_SCENE_QUERY_SPEC;
}

/**
 * The default world position handed to factory-made query cards (the
 * insert path re-centres the object on the drop point, so the raw value
 * only matters for tests).
 */
export const QUERY_FACTORY_ORIGIN = vec2(0, 0);
