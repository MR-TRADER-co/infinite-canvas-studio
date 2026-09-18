/**
 * The `scene.query` v1 HOST contract tests (Knowledge Pack R12.6,
 * AC12.6): a consumer (plugin) runs structured specs through the hub,
 * version mismatches degrade with the typed Persian notice, garbage
 * specs degrade as provider-errors, and the change publisher emits
 * the scene-changed signal.
 */
import { describe, expect, it, vi } from "vitest";
import { DataHub } from "@/datahub/DataHub";
import {
  SCENE_QUERY_CONTRACT_ID,
  registerSceneQueryContract,
  sceneQueryChangePublisher,
} from "@/datahub/contracts/sceneQuery";
import { buildKnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import { Scene } from "@/core/model/Scene";
import { vec2 } from "@/core/geometry/Vec2";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import type { KnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import type { SceneQueryResult } from "@/core/knowledge/QueryEngine";

/** Builds a plain text-box fixture with properties. */
function textBox(
  id: string,
  text: string,
  properties?: Record<string, unknown>,
): TextBoxObjectData {
  return {
    id,
    kind: "textBox",
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    width: 200,
    height: 60,
    text,
    doc: null,
    sizeMode: "fixed",
    fontSize: 20,
    color: "token://text",
    ...(properties === undefined ? {} : { properties }),
  } as TextBoxObjectData;
}

/** A scene + index with two property-carrying notes. */
function fixture(): { scene: Scene; index: KnowledgeIndex } {
  const objects = [
    textBox("a", "کار اول #مهم", { وضعیت: "در انتظار", اولویت: 3 }),
    textBox("b", "کار دوم #مهم", { وضعیت: "تمام‌شده", اولویت: 9 }),
  ];
  const scene = new Scene();
  objects.forEach((object) => scene.add(object));
  return { scene, index: buildKnowledgeIndex(objects) };
}

/** Registers the contract on a fresh hub over the fixture. */
function hubOverFixture(): DataHub {
  const { scene, index } = fixture();
  const hub = new DataHub();
  registerSceneQueryContract(hub, {
    scene,
    knowledge: { current: () => index },
  });
  return hub;
}

describe("scene.query v1 (R12.6 host contract)", () => {
  it("runs a structured spec through the hub and returns the DTO rows", async () => {
    const hub = hubOverFixture();
    const outcome = await hub.query("consumer", {
      contractId: SCENE_QUERY_CONTRACT_ID,
      versionRange: "^1",
      method: "run",
      params: {
        filters: [{ prop: "اولویت", op: "gt", value: "5" }],
        limit: 10,
      },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as SceneQueryResult;
      expect(result.total).toBe(1);
      expect(result.rows[0]?.objectId).toBe("b");
      expect(result.rows[0]?.title).toBe("کار دوم");
    }
  });

  it("answers the cheap onSceneChanged poll", async () => {
    const hub = hubOverFixture();
    const outcome = await hub.query("consumer", {
      contractId: SCENE_QUERY_CONTRACT_ID,
      versionRange: "^1",
      method: "onSceneChanged",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toEqual({ changed: true });
    }
  });

  it("a version mismatch degrades with the typed Persian notice (AC12.6)", async () => {
    const hub = hubOverFixture();
    const outcome = await hub.query("consumer", {
      contractId: SCENE_QUERY_CONTRACT_ID,
      versionRange: "^2",
      method: "run",
      params: { filters: [] },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("version");
      expect(outcome.message).toContain("scene.query");
      expect(outcome.message).toContain("سازگار نیست");
    }
  });

  it("a garbage spec degrades as a provider-error (never a crash)", async () => {
    const hub = hubOverFixture();
    const outcome = await hub.query("consumer", {
      contractId: SCENE_QUERY_CONTRACT_ID,
      versionRange: "^1",
      method: "run",
      params: "not a spec",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("provider-error");
      expect(outcome.message).toContain("پاسخ معتبری نداد");
    }
  });

  it("an unknown contract reports no-provider; an unknown method reports method", async () => {
    const hub = hubOverFixture();
    const missing = await hub.query("consumer", {
      contractId: "scene.query.other",
      versionRange: "^1",
      method: "run",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toBe("no-provider");
    }
    const badMethod = await hub.query("consumer", {
      contractId: SCENE_QUERY_CONTRACT_ID,
      versionRange: "^1",
      method: "deleteEverything",
    });
    expect(badMethod.ok).toBe(false);
    if (!badMethod.ok) {
      expect(badMethod.reason).toBe("method");
    }
  });

  it("the change publisher fans out to matching subscribers", () => {
    const hub = new DataHub();
    const listener = vi.fn();
    const subscribe = hub.subscribe(
      "consumer",
      SCENE_QUERY_CONTRACT_ID,
      "^1",
      listener,
    );
    expect(subscribe.ok).toBe(false); // (no provider registered YET)
    registerSceneQueryContract(hub, {
      scene: new Scene(),
      knowledge: { current: () => buildKnowledgeIndex([]) },
    });
    const publish = sceneQueryChangePublisher(hub);
    publish();
    expect(listener).toHaveBeenCalledWith({ type: "scene-changed" });
    subscribe.unsubscribe();
  });
});
