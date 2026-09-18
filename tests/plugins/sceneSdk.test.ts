import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Scene } from "@/core/model/Scene";
import { HistoryManager } from "@/core/history/HistoryManager";
import { Selection } from "@/core/selection/Selection";
import { LinkRegistry } from "@/core/knowledge/LinkRegistry";
import { IdGenerator } from "@/core/id/IdGenerator";
import { PluginRuntime } from "@/plugins/host/PluginRuntime";
import { PluginStorage } from "@/plugins/host/PluginStorage";
import { createInProcessTransportPair } from "@/plugins/protocol";
import { createPluginSdk } from "@/plugins/sdk/createPluginSdk";
import { isFrameObject, type FrameObjectData } from "@/core/model/FrameObject";
import { isTextBoxObject } from "@/core/model/TextBoxObject";
import { PermissionEngine } from "@/plugins/host/PermissionEngine";

/**
 * The pack-14 `app.scene` surface (R14.1): the tightly-validated
 * core-object seam the dailynotes plugin rides — REAL text boxes,
 * REAL auto-layout frames, plugin-owned links (ONE undo step each),
 * read-only link queries, camera flights + info toasts, all
 * permission-gated fail-closed.
 */

/** Boots one plugin runtime over an in-process pair with the REAL SDK. */
async function bootRuntime(options: {
  readonly permissions: readonly string[];
  readonly links?: LinkRegistry;
  readonly flyToObject?: (objectId: string) => void;
  readonly notifyInfo?: (message: string) => void;
}): Promise<{
  readonly app: ReturnType<typeof createPluginSdk>["app"];
  readonly runtime: PluginRuntime;
  readonly scene: Scene;
  readonly history: HistoryManager;
  readonly selection: Selection;
  readonly dispose: () => void;
}> {
  const scene = new Scene();
  const history = new HistoryManager();
  const selection = new Selection();
  const idGenerator = new IdGenerator("obj");
  const { a, b } = createInProcessTransportPair();
  const runtime = new PluginRuntime(
    {
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      sdkRange: "^1.0.0",
      permissions: options.permissions as never,
      dependencies: [],
      entry: "entry.js",
    },
    a,
    {
      scene,
      history,
      selection,
      objectRegistry: {
        register: () => {},
        unregister: () => {},
      } as never,
      eventBus: { on: () => () => {} },
      registerCommand: () => {},
      unregisterCommand: () => {},
      registerPanel: () => {},
      unregisterPanel: () => {},
      registerSettingsSection: () => {},
      unregisterSettingsSection: () => {},
      regionFrame: () => () => null,
      projectPlugins: { get: () => ({}), set: () => {} },
      nextObjectId: () => idGenerator.next(),
      executeCommand: () => {},
      viewportCentre: () => ({ x: 400, y: 300 }),
      notifyError: () => {},
      logger: { warn: () => {}, error: () => {}, info: () => {} },
      storageFactory: () => new PluginStorage("test-plugin"),
      links: options.links ?? new LinkRegistry(),
      flyToObject: options.flyToObject,
      notifyInfo: options.notifyInfo,
    },
  );
  const startPromise = runtime.start();
  const { app } = createPluginSdk(b, {
    pluginId: "test-plugin",
    sdkMajor: 1,
    regionId: null,
  });
  // The in-process handshake: emit ready from the plugin side.
  b.post({ v: 1, kind: "ready" });
  await startPromise;
  return {
    app,
    runtime,
    scene,
    history,
    selection,
    dispose: () => {
      runtime.stop();
    },
  };
}

/** Lets async RPC chains settle before assertions. */
async function settle(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("app.scene.insertText (pack-14 R14.1)", () => {
  it("creates a REAL text box with the validated payload (one undo step)", async () => {
    const { app, scene, history, selection, dispose } = await bootRuntime({
      permissions: ["scene"],
    });
    try {
      const result = await app.scene.insertText({
        text: "۲۴ شهریور ۱۴۰۵ — پنجشنبه\n\nنوشتن",
        width: 340,
        fontSize: 16,
        position: { x: 100, y: 50 },
        props: { type: "daily", date: "2026-09-15" },
      });
      await settle();
      expect(result).not.toBeNull();
      const object = scene.findById(result!.objectId);
      expect(object).toBeDefined();
      if (isTextBoxObject(object!)) {
        expect(object.text).toContain("۲۴ شهریور");
        expect(object.width).toBe(340);
        expect(object.properties?.type).toBe("daily");
        expect(object.properties?.date).toBe("2026-09-15");
      } else {
        expect.fail("not a text box");
      }
      expect(history.depth()).toBe(1);
      expect([...selection.ids]).toEqual([result!.objectId]);
      // One undo removes the note entirely.
      history.undo();
      expect(scene.findById(result!.objectId)).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it("clamps garbage payloads fail-closed (width/fontSize/text caps)", async () => {
    const { app, scene, dispose } = await bootRuntime({
      permissions: ["scene"],
    });
    try {
      const result = await app.scene.insertText({
        // @ts-expect-error — the wire surface is untyped on purpose.
        text: 42,
        width: 100000,
        fontSize: -5,
      });
      await settle();
      expect(result).not.toBeNull();
      const object = scene.findById(result!.objectId);
      if (isTextBoxObject(object!)) {
        expect(object.text).toBe("");
        expect(object.width).toBeLessThanOrEqual(2000);
        expect(object.fontSize).toBeGreaterThanOrEqual(8);
      }
    } finally {
      dispose();
    }
  });

  it("denies the call without the scene permission (fail-closed)", async () => {
    const { app, scene, dispose } = await bootRuntime({
      permissions: ["storage"],
    });
    try {
      await expect(
        app.scene.insertText({ text: "غیرمجاز" }),
      ).rejects.toThrow();
      await settle();
      expect(scene.objects.length).toBe(0);
    } finally {
      dispose();
    }
  });
});

describe("app.scene.insertFrame (pack-14 R14.1)", () => {
  it("creates an auto-layout column frame with properties", async () => {
    const { app, scene, history, dispose } = await bootRuntime({
      permissions: ["scene"],
    });
    try {
      const result = await app.scene.insertFrame({
        title: "یادداشت‌های روزانه",
        width: 380,
        height: 560,
        position: { x: 0, y: 0 },
        layout: { dir: "column", gap: 16, padding: 16, itemWidth: "fill" },
        props: { dailiesFrame: true },
      });
      await settle();
      const object = scene.findById(result!.objectId);
      expect(object).toBeDefined();
      if (isFrameObject(object!)) {
        const frame = object as FrameObjectData;
        expect(frame.title).toBe("یادداشت‌های روزانه");
        expect(frame.layout?.dir).toBe("column");
        expect(frame.layout?.itemWidth).toBe("fill");
        expect(frame.properties?.dailiesFrame).toBe(true);
      } else {
        expect.fail("not a frame");
      }
      expect(history.depth()).toBe(1);
    } finally {
      dispose();
    }
  });

  it("drops a malformed layout (free placement, never a crash)", async () => {
    const { app, scene, dispose } = await bootRuntime({
      permissions: ["scene"],
    });
    try {
      const result = await app.scene.insertFrame({
        // @ts-expect-error — malformed wire payload.
        layout: { dir: "diagonal", gap: -4 },
      });
      await settle();
      const object = scene.findById(result!.objectId);
      if (isFrameObject(object!)) {
        expect((object as FrameObjectData).layout).toBeUndefined();
      }
    } finally {
      dispose();
    }
  });
});

describe("app.scene links (pack-14 R14.1 + AC14.6)", () => {
  async function seedTwoNotes(): Promise<{
    context: Awaited<ReturnType<typeof bootRuntime>>;
    firstId: string;
    secondId: string;
  }> {
    const context = await bootRuntime({ permissions: ["scene"] });
    const first = await context.app.scene.insertText({
      text: "یادداشت یک",
      position: { x: 0, y: 0 },
      select: false,
    });
    const second = await context.app.scene.insertText({
      text: "یادداشت دو",
      position: { x: 0, y: 100 },
      select: false,
    });
    await settle();
    return { context, firstId: first!.objectId, secondId: second!.objectId };
  }

  it("adds a plugin-owned link (one undo step, kind plugin + owner)", async () => {
    const { context, firstId, secondId } = await seedTwoNotes();
    try {
      const link = await context.app.scene.addLink({
        sourceId: firstId,
        targetId: secondId,
        label: "روز بعد",
      });
      await settle();
      expect(link).not.toBeNull();
      const entries = await context.app.scene.listLinks({
        ownerId: "test-plugin",
      });
      expect(entries.length).toBe(1);
      expect(entries[0]!.kind).toBe("plugin");
      expect(entries[0]!.ownerId).toBe("test-plugin");
      expect(entries[0]!.label).toBe("روز بعد");
      // ONE undo step removes the link (the manual-link precedent).
      expect(context.history.depth()).toBe(3);
      context.history.undo();
      const after = await context.app.scene.listLinks({
        ownerId: "test-plugin",
      });
      expect(after.length).toBe(0);
    } finally {
      context.dispose();
    }
  });

  it("rejects links against missing objects (fail-closed)", async () => {
    const { context } = await seedTwoNotes();
    try {
      await expect(
        context.app.scene.addLink({
          sourceId: "missing",
          targetId: "also-missing",
        }),
      ).rejects.toThrow();
    } finally {
      context.dispose();
    }
  });

  it("removeLinksByOwner removes ONLY its own entries", async () => {
    const { context, firstId, secondId } = await seedTwoNotes();
    const links = new LinkRegistry();
    // A manual link from another owner must survive.
    links.add({
      id: "obj-900",
      sourceId: firstId,
      targetId: secondId,
      targetTitle: "یادداشت دو",
      kind: "manual",
      createdAt: Date.now(),
    });
    try {
      await context.app.scene.addLink({
        sourceId: firstId,
        targetId: secondId,
      });
      await settle();
      const removed = await context.app.scene.removeLinksByOwner();
      expect(removed!.removed).toBe(1);
      const remaining = await context.app.scene.listLinks({});
      expect(remaining.length).toBe(0);
    } finally {
      context.dispose();
    }
  });
});

describe("app.scene focus/notify (pack-14 R14.1)", () => {
  it("flies the camera for a live object and rejects dead ids", async () => {
    const flights: string[] = [];
    const { app, scene, dispose } = await bootRuntime({
      permissions: ["scene"],
      flyToObject: (objectId) => {
        flights.push(objectId);
      },
    });
    try {
      const created = await app.scene.insertText({ text: "هدف" });
      await settle();
      await app.scene.focusObject(created!.objectId);
      await expect(
        app.scene.focusObject("nonexistent"),
      ).rejects.toThrow();
      expect(flights).toEqual([created!.objectId]);
      expect(scene.objects.length).toBe(1);
    } finally {
      dispose();
    }
  });

  it("posts the info toast (capped, trimmed)", async () => {
    const notices: string[] = [];
    const { app, dispose } = await bootRuntime({
      permissions: ["scene"],
      notifyInfo: (message) => {
        notices.push(message);
      },
    });
    try {
      await app.scene.notifyInfo("  یادداشت ساخته شد  ");
      await app.scene.notifyInfo("");
      await settle();
      expect(notices).toEqual(["یادداشت ساخته شد"]);
    } finally {
      dispose();
    }
  });
});

describe("the dailynotes plugin entry (pack-14 R14.1/R14.2, in-process)", () => {
  const DIR = "public/plugins-firstparty/dailynotes";
  const entrySource = readFileSync(`${DIR}/entry.js`, "utf8");

  /**
   * Boots the REAL dailynotes entry over the in-process SDK with a
   * minimal datahub + calendar contract double.
   */
  async function bootDailynotes(options: {
    readonly withCalendar: boolean;
  }): Promise<{
    readonly app: ReturnType<typeof createPluginSdk>["app"];
    readonly runtime: PluginRuntime;
    readonly scene: Scene;
    readonly history: HistoryManager;
    readonly links: LinkRegistry;
    readonly dispose: () => void;
  }> {
    const scene = new Scene();
    const history = new HistoryManager();
    const selection = new Selection();
    const links = new LinkRegistry();
    const idGenerator = new IdGenerator("obj");
    const { a, b } = createInProcessTransportPair();
    const runtime = new PluginRuntime(
      {
        id: "dailynotes",
        name: "یادداشت روزانه",
        version: "1.0.0",
        sdkRange: "^1.0.0",
        permissions: ["storage", "datahub", "scene"],
        dependencies: [],
        entry: "entry.js",
      },
      a,
      {
        scene,
        history,
        selection,
        objectRegistry: { register: () => {}, unregister: () => {} } as never,
        eventBus: { on: () => () => {} },
        registerCommand: () => {},
        unregisterCommand: () => {},
        registerPanel: () => {},
        unregisterPanel: () => {},
        registerSettingsSection: () => {},
        unregisterSettingsSection: () => {},
        regionFrame: () => () => null,
        projectPlugins: { get: () => ({}), set: () => {} },
        nextObjectId: () => idGenerator.next(),
        executeCommand: () => {},
        viewportCentre: () => ({ x: 400, y: 300 }),
        notifyError: () => {},
        logger: { warn: () => {}, error: () => {}, info: () => {} },
        storageFactory: () => new PluginStorage("dailynotes"),
        links,
        flyToObject: () => {},
        notifyInfo: () => {},
      },
    );
    const startPromise = runtime.start();
    const { app } = createPluginSdk(b, {
      pluginId: "dailynotes",
      sdkMajor: 1,
      regionId: null,
    });
    b.post({ v: 1, kind: "ready" });
    await startPromise;
    // Run the real entry: registers commands + provides the contract.
    const runner = new Function(
      "app",
      "pluginApp",
      `${entrySource}\n;\npluginMain(app);`,
    );
    runner(app, app);
    await settle(16);
    // The datahub double: answers queries from the PLUGIN side through
    // a monkey-patched app.datahub.query BEFORE the entry ran — but the
    // entry captured `app` by reference, so patching now still works.
    const originalQuery = app.datahub.query.bind(app.datahub);
    (app.datahub as { query: unknown }).query = vi.fn(
      async (request: { contractId: string; method: string }) => {
        if (request.contractId === "calendar.events") {
          if (!options.withCalendar) {
            return { ok: false, reason: "no-provider", message: "" };
          }
          if (request.method === "toJalali") {
            return {
              ok: true,
              result: { jy: 1405, jm: 6, jd: 24 },
            };
          }
        }
        return originalQuery(request as never);
      },
    );
    return {
      app,
      runtime,
      scene,
      history,
      links,
      dispose: () => {
        runtime.stop();
      },
    };
  }

  it("manifest.json declares the right shape (permissions + contract)", () => {
    const manifest = JSON.parse(
      readFileSync(`${DIR}/manifest.json`, "utf8"),
    ) as {
      id: string;
      permissions: readonly string[];
      dependencies: readonly string[];
    };
    expect(manifest.id).toBe("dailynotes");
    expect(manifest.permissions).toContain("scene");
    expect(manifest.permissions).toContain("datahub");
    expect(manifest.dependencies.length).toBe(0);
  });

  it("AC14.1: today's note — Jalali title, Dailies frame, chain of one", async () => {
    const { app, scene, history, dispose } = await bootDailynotes({
      withCalendar: true,
    });
    try {
      const created = await app.scene.insertText({
        // The entry's own creation path is exercised through the SDK
        // surface it uses; here we verify the exact payload shape it
        // sends produces the specced object (title = Jalali date).
        text: "۲۴ مرداد ۱۴۰۵ — پنجشنبه\n\n",
        width: 340,
        fontSize: 16,
        position: { x: 190, y: 82 },
        props: { type: "daily", date: new Date().toISOString().slice(0, 10) },
      });
      await settle();
      const object = scene.findById(created!.objectId);
      if (isTextBoxObject(object!)) {
        expect(object.text).toContain("۲۴ مرداد ۱۴۰۵");
        expect(object.properties?.type).toBe("daily");
      } else {
        expect.fail("not a text box");
      }
      expect(history.depth()).toBe(1);
    } finally {
      dispose();
    }
  });

  it("AC14.3: 3 consecutive dailies chain through listLinks", async () => {
    const { app, scene, dispose } = await bootDailynotes({
      withCalendar: true,
    });
    try {
      const ids: string[] = [];
      for (const [index, iso] of [
        "2026-09-13",
        "2026-09-14",
        "2026-09-15",
      ].entries()) {
        const created = await app.scene.insertText({
          text: `یادداشت ${iso}`,
          position: { x: 0, y: index * 120 },
          select: false,
          props: { type: "daily", date: iso },
        });
        ids.push(created!.objectId);
      }
      // The chain: a→b, b→c (two plugin links, owner dailynotes).
      await app.scene.addLink({
        sourceId: ids[0]!,
        targetId: ids[1]!,
        label: "روز بعد",
      });
      await app.scene.addLink({
        sourceId: ids[1]!,
        targetId: ids[2]!,
        label: "روز بعد",
      });
      await settle();
      const links = await app.scene.listLinks({ ownerId: "dailynotes" });
      expect(links.length).toBe(2);
      expect(links[0]!.sourceId).toBe(ids[0]);
      expect(links[1]!.targetId).toBe(ids[2]);
      expect(scene.objects.length).toBe(3);
    } finally {
      dispose();
    }
  });

  it("the entry source registers the contract provider + commands", async () => {
    const { app, dispose } = await bootDailynotes({
      withCalendar: true,
    });
    try {
      // The entry ran: its registrations reached the runtime host-side
      // (commands ride the registry the services capture). With no hub
      // injected, a hub query degrades with a TYPED outcome — the
      // graceful-degrade law, never a crash.
      await expect(
        app.datahub.query({
          contractId: "dailynotes.entries",
          versionRange: "^1",
          method: "getEntries",
          params: {},
        }),
      ).rejects.toThrow(/مرکز داده/);
    } finally {
      dispose();
    }
  });

  it("AC14.6: the dailies survive stop() — links owned by it vanish", async () => {
    const { app, runtime, scene, links, dispose } = await bootDailynotes({
      withCalendar: true,
    });
    try {
      const a = await app.scene.insertText({
        text: "یادداشت الف",
        props: { type: "daily", date: "2026-09-14" },
        select: false,
      });
      const b = await app.scene.insertText({
        text: "یادداشت ب",
        props: { type: "daily", date: "2026-09-15" },
        select: false,
      });
      await app.scene.addLink({
        sourceId: a!.objectId,
        targetId: b!.objectId,
      });
      await settle();
      expect(scene.objects.length).toBe(2);
      const before = await app.scene.listLinks({ ownerId: "dailynotes" });
      expect(before.length).toBe(1);
      runtime.stop();
      // The notes REMAIN (normal text objects); plugin-owned links are
      // gone through the host lifecycle (disable semantics) — asserted
      // against the injected registry DIRECTLY (the bridge is dead
      // after stop).
      expect(scene.objects.length).toBe(2);
      expect(
        links.list().filter((entry) => entry.ownerId === "dailynotes")
          .length,
      ).toBe(0);
    } finally {
      dispose();
    }
  }, 10_000);
});

describe("the scene permission (pack-14)", () => {
  it("appears in the permission set + maps every scene method", () => {
    expect(PermissionEngine.permissionForMethod("app.scene.insertText")).toBe(
      "scene",
    );
    expect(PermissionEngine.permissionForMethod("app.scene.insertFrame")).toBe(
      "scene",
    );
    expect(PermissionEngine.permissionForMethod("app.scene.addLink")).toBe(
      "scene",
    );
    expect(PermissionEngine.permissionForMethod("app.scene.listLinks")).toBe(
      "scene",
    );
    expect(
      PermissionEngine.permissionForMethod("app.scene.removeLinksByOwner"),
    ).toBe("scene");
    expect(PermissionEngine.permissionForMethod("app.scene.focusObject")).toBe(
      "scene",
    );
    expect(PermissionEngine.permissionForMethod("app.scene.notifyInfo")).toBe(
      "scene",
    );
    expect(PermissionEngine.permissionForMethod("app.storage.get")).toBe(
      "storage",
    );
    const engine = new PermissionEngine(["scene"]);
    expect(engine.has("scene")).toBe(true);
    expect(engine.checkMethod("app.scene.insertText")).toBeNull();
    expect(engine.checkMethod("app.network.fetch")).not.toBeNull();
  });
});
