/**
 * The HOST-provided `scene.query` v1 contract (Knowledge Pack R12.6):
 * plugins (the AI Analyst, the Reporter) query the WHOLE scene through
 * the structured {@link SceneQuerySpec} — filters, tags, text,
 * links, kinds, sort/group, limit — executed by the pure
 * `core/knowledge/QueryEngine` (law §1.7.9: no DSL, no eval, no direct
 * model access from plugin land).
 *
 * Contract surface (docs/CONTRACTS.md pattern, mirroring
 * `project.digest` v1):
 * - `run(spec)` — the spec as its `params`; returns
 *   `{rows, total, groups}` (rows are `{objectId, title, sortValue,
 *   group?}` — DTO ids, never live model objects);
 * - `onSceneChanged()` — the cheap poll the SDK consumer uses
 *   alongside the hub's change events;
 * - the host PUBLISHES `{type: "scene-changed"}` after every scene
 *   mutation + knowledge rebuild (debounced by the callers' own
 *   subscriptions) so consumers know to re-run.
 *
 * Versioning + graceful degradation ride the generic DataHub paths: a
 * version mismatch answers the typed
 * `{ok: false, reason: "version"}` outcome with the Persian notice (a
 * non-object spec degrades as `provider-error`) — AC12.6.
 *
 * Layering: plain TypeScript over the core engine — no React/DOM.
 */
import type { DataHub } from "@/datahub/DataHub";
import type { Scene } from "@/core/model/Scene";
import type { KnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import {
  normalizeSceneQuerySpec,
  runSceneQuery,
} from "@/core/knowledge/QueryEngine";

/** The knowledge snapshot source (KnowledgeService's `current()` seam). */
export interface SceneQueryKnowledgeSource {
  /** @returns the current immutable knowledge index. */
  current(): KnowledgeIndex;
}

/** The wiring deps (App.ts injects; tests fake them). */
export interface SceneQueryContractDeps {
  /** The scene to query. */
  readonly scene: Scene;
  /** The knowledge snapshot source. */
  readonly knowledge: SceneQueryKnowledgeSource;
}

/** The contract id (the pack's spelling). */
export const SCENE_QUERY_CONTRACT_ID = "scene.query";

/** The provider version (semver; consumers declare ranges). */
export const SCENE_QUERY_VERSION = "1.0.0";

/**
 * Registers the `scene.query` v1 HOST provider on the hub.
 *
 * @param hub - the app's data hub.
 * @param deps - the scene + knowledge + publish seams.
 */
export function registerSceneQueryContract(
  hub: DataHub,
  deps: SceneQueryContractDeps,
): void {
  hub.registerHostProvider({
    contractId: SCENE_QUERY_CONTRACT_ID,
    version: SCENE_QUERY_VERSION,
    providerId: "host",
    methods: ["run", "onSceneChanged"],
    query: async (method, params) => {
      if (method === "onSceneChanged") {
        return { changed: true };
      }
      // `run` — the params ARE the spec (§1.7.9's JSON shape).
      const spec = normalizeSceneQuerySpec(params);
      if (spec === null) {
        // The typed degrade path: a garbage shape is a provider error,
        // never a crash (AC12.6).
        throw new Error("scene.query: the spec is not a QuerySpec object");
      }
      return runSceneQuery(deps.scene, deps.knowledge.current(), spec);
    },
  });
}

/**
 * Builds the publish callback App.ts reuses on scene + knowledge churn.
 *
 * @param hub - the app's data hub.
 * @returns the no-arg publish function.
 */
export function sceneQueryChangePublisher(hub: DataHub): () => void {
  return () => {
    hub.publish("host", SCENE_QUERY_CONTRACT_ID, {
      type: "scene-changed",
    });
  };
}
