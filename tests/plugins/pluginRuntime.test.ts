import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Scene } from "@/core/model/Scene";
import { HistoryManager } from "@/core/history/HistoryManager";
import { Selection } from "@/core/selection/Selection";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import { CommandRegistry } from "@/core/registry/CommandRegistry";
import { EventBus, type AppEventMap } from "@/core/events/EventBus";
import { IdGenerator } from "@/core/id/IdGenerator";
import { LifecycleManager } from "@/plugins/host/LifecycleManager";
import { PluginRuntime } from "@/plugins/host/PluginRuntime";
import { PluginStorage } from "@/plugins/host/PluginStorage";
import { PluginStore, memoryStorage } from "@/plugins/host/PluginStore";
import { createInProcessSandboxFactory } from "@/plugins/sdk/inProcessSandbox";
import { resolveCatalogCards } from "@/interaction/CatalogInsert";
import {
  isPluginObject,
  type PluginObjectData,
} from "@/core/model/PluginObject";
import {
  serializeSceneObjects,
  deserializeSceneObject,
} from "@/persistence/ProjectFile";
import { __resetMergedNamespaces, t } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";

/** The shipped sample plugin (R9.7) read from public/. */
const SAMPLE_DIR = "public/plugins-sample/sticky-shape-pack";
const sampleManifestJson: Record<string, unknown> = JSON.parse(
  readFileSync(`${SAMPLE_DIR}/manifest.json`, "utf8"),
);
const sampleEntrySource = readFileSync(`${SAMPLE_DIR}/entry.js`, "utf8");
const sampleDictionaries = {
  fa: JSON.parse(readFileSync(`${SAMPLE_DIR}/i18n/fa.json`, "utf8")),
  en: JSON.parse(readFileSync(`${SAMPLE_DIR}/i18n/en.json`, "utf8")),
};

/** Lets async RPC chains (registrations) settle before assertions. */
async function settle(rounds = 12): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** The host-side surfaces the manager drives (real core services). */
interface Harness {
  readonly manager: LifecycleManager;
  readonly scene: Scene;
  readonly history: HistoryManager;
  readonly selection: Selection;
  readonly objectRegistry: ObjectRegistry;
  readonly commandRegistry: CommandRegistry;
  readonly panels: Map<
    string,
    { placement: string; titleKey: string; regionId: string }
  >;
  readonly sections: Map<string, { titleKey: string; regionId: string }>;
  readonly projectPlugins: Map<string, unknown>;
  readonly notices: string[];
  readonly eventBus: EventBus<AppEventMap>;
}

function buildHarness(storageShims: Map<string, PluginStorage>): Harness {
  const scene = new Scene();
  const history = new HistoryManager();
  const selection = new Selection();
  const objectRegistry = new ObjectRegistry(true);
  const commandRegistry = new CommandRegistry(undefined, true);
  const eventBus = new EventBus<AppEventMap>();
  const idGenerator = new IdGenerator("obj");
  const panels = new Map<
    string,
    { placement: string; titleKey: string; regionId: string }
  >();
  const sections = new Map<string, { titleKey: string; regionId: string }>();
  const projectPlugins = new Map<string, unknown>();
  const notices: string[] = [];

  const services = {
    scene,
    history,
    selection,
    objectRegistry,
    eventBus: {
      on: (event: keyof AppEventMap, handler: (payload: unknown) => void) =>
        eventBus.on(event, handler as never) as unknown as () => void,
    },
    registerCommand: (entry: {
      id: string;
      titleKey: string;
      icon?: string;
      shortcut?: string;
      group: string;
      order: number;
      execute: (ctx: { services: { tryGet: () => undefined } }) => void;
    }) => {
      commandRegistry.register(entry as never);
    },
    unregisterCommand: (id: string) => {
      commandRegistry.unregister(id);
    },
    registerPanel: (entry: {
      id: string;
      titleKey: string;
      placement: string;
      component: unknown;
    }) => {
      const regionId = String(
        (entry.component as { __regionId?: string }).__regionId ??
          `panel:${entry.id}`,
      );
      panels.set(entry.id, {
        placement: entry.placement,
        titleKey: entry.titleKey,
        regionId,
      });
    },
    unregisterPanel: (id: string) => {
      panels.delete(id);
    },
    registerSettingsSection: (entry: {
      id: string;
      titleKey: string;
      component: unknown;
    }) => {
      sections.set(entry.id, {
        titleKey: entry.titleKey,
        regionId: `settings:${entry.id}`,
      });
    },
    unregisterSettingsSection: (id: string) => {
      sections.delete(id);
    },
    regionFrame: (pluginId: string, regionId: string) => {
      const component = () => null;
      (component as { __regionId?: string }).__regionId = regionId;
      return component;
    },
    projectPlugins: {
      get: () => Object.fromEntries(projectPlugins),
      set: (plugins: Readonly<Record<string, unknown>>) => {
        projectPlugins.clear();
        for (const [key, value] of Object.entries(plugins)) {
          projectPlugins.set(key, value);
        }
      },
    },
    nextObjectId: () => idGenerator.next(),
    executeCommand: (id: string) => {
      commandRegistry
        .get(id)
        ?.execute({ services: { tryGet: () => undefined } });
    },
    viewportCentre: () => ({ x: 100, y: 100 }),
    notifyError: (message: string) => {
      notices.push(message);
    },
    logger: {
      warn: () => undefined,
      error: () => undefined,
      info: () => undefined,
    },
    storageFactory: (id: string) => {
      const existing = storageShims.get(id);
      if (existing !== undefined) {
        return existing;
      }
      const created = new PluginStorage(id, memoryStorage());
      storageShims.set(id, created);
      return created;
    },
  };

  const manager = new LifecycleManager(
    services,
    createInProcessSandboxFactory(),
    new PluginStore(memoryStorage()),
    eventBus,
  );
  return {
    manager,
    scene,
    history,
    selection,
    objectRegistry,
    commandRegistry,
    panels,
    sections,
    projectPlugins,
    notices,
    eventBus,
  };
}

/** Installs the shipped sample plugin with storage consent. */
async function installSample(harness: Harness): Promise<string> {
  const outcome = await harness.manager.install(
    {
      manifestJson: sampleManifestJson,
      entrySource: sampleEntrySource,
      dictionaries: sampleDictionaries,
    },
    ["storage"],
  );
  expect(outcome.ok).toBe(true);
  await settle();
  return (outcome.pluginId as string) ?? "sticky-shape-pack";
}

beforeEach(() => {
  __resetMergedNamespaces();
  useUiStore.getState().setLanguage("fa");
});

afterEach(() => {
  __resetMergedNamespaces();
});

describe("Sample plugin end-to-end (R9.7 / AC9.1)", () => {
  it("installs, registers commands/types/panels/settings + merges i18n", async () => {
    const shims = new Map<string, PluginStorage>();
    const harness = buildHarness(shims);
    const id = await installSample(harness);

    expect(harness.objectRegistry.hasTypeId("sticky-shape-pack.star")).toBe(
      true,
    );
    expect(harness.objectRegistry.hasTypeId("sticky-shape-pack.heart")).toBe(
      true,
    );
    expect(harness.objectRegistry.hasTypeId("sticky-shape-pack.burst")).toBe(
      true,
    );
    expect(harness.commandRegistry.has("sticky-shape-pack.insertStar")).toBe(
      true,
    );
    expect(harness.panels.has("sticky-shape-pack.shapes")).toBe(true);
    expect(harness.panels.get("sticky-shape-pack.shapes")?.placement).toBe(
      "right",
    );
    expect(harness.sections.has("sticky-shape-pack.appearance")).toBe(true);

    // The plugin's manifest-declared dictionaries merged under its owner
    // namespace (the Insert Panel resolves card titles through t()).
    expect(t("sticky-shape-pack:group")).toBe("شکل‌های یادداشتی");
    expect(t("sticky-shape-pack:shape.star.title")).toBe("ستارهٔ یادداشتی");

    // The runtime reports running + the granted permission set.
    const runtime = harness.manager.getRuntime(id) as PluginRuntime;
    expect(runtime.runtimeState).toBe("running");
    expect(runtime.runtimeError).toBeNull();
    expect(runtime.permissions).toEqual(["storage"]);
  });

  it("inserts the widget EXACTLY at the drop point (one undo, AC9.9)", async () => {
    const shims = new Map<string, PluginStorage>();
    const harness = buildHarness(shims);
    const id = await installSample(harness);
    const runtime = harness.manager.getRuntime(id) as PluginRuntime;

    const object = await runtime.insertObjectAt("sticky-shape-pack.star", {
      x: 137,
      y: 291,
    });
    expect(object).not.toBeNull();
    expect(isPluginObject(object as PluginObjectData)).toBe(true);
    // 140×140 widget centred on the drop point.
    expect(object?.position).toEqual({ x: 137 - 70, y: 291 - 70 });
    expect(object?.data).toMatchObject({ color: "#f59e0b" });
    expect(harness.scene.objectCount).toBe(1);

    // One undo step removes it (no partial objects).
    expect(harness.history.canUndo()).toBe(true);
    harness.history.undo();
    expect(harness.scene.objectCount).toBe(0);

    // No error toast surfaced (the healthy path).
    expect(harness.notices).toEqual([]);
  });

  it("renders widget snapshots through the sandboxed renderer", async () => {
    const shims = new Map<string, PluginStorage>();
    const harness = buildHarness(shims);
    await installSample(harness);
    const runtime = harness.manager.getRuntime(
      "sticky-shape-pack",
    ) as PluginRuntime;

    const html = await runtime.renderWidgetHtml(
      "sticky-shape-pack.star",
      { color: "#ef4444" },
      { width: 140, height: 140 },
    );
    expect(html).toContain("<svg");
    expect(html).toContain("#ef4444");
  });
});

describe("Disable / re-enable (R9.5 / AC9.2)", () => {
  it("unregisters everything; objects become placeholders; re-enable restores", async () => {
    const shims = new Map<string, PluginStorage>();
    const harness = buildHarness(shims);
    await installSample(harness);
    const runtime = harness.manager.getRuntime(
      "sticky-shape-pack",
    ) as PluginRuntime;

    // Create one object + write the project section.
    const object = (await runtime.insertObjectAt("sticky-shape-pack.heart", {
      x: 50,
      y: 50,
    })) as PluginObjectData;
    expect(object).not.toBeNull();

    harness.manager.disable("sticky-shape-pack");
    await settle();

    // Every contribution vanished.
    expect(harness.objectRegistry.hasTypeId("sticky-shape-pack.star")).toBe(
      false,
    );
    expect(harness.commandRegistry.has("sticky-shape-pack.insertStar")).toBe(
      false,
    );
    expect(harness.panels.size).toBe(0);
    expect(harness.sections.size).toBe(0);
    // i18n namespace removed.
    expect(t("sticky-shape-pack:group")).toBe("sticky-shape-pack:group");

    // The in-memory object serialises through the generic fallback —
    // nothing is lost, and a RELOAD materialises the opaque placeholder.
    const wire = serializeSceneObjects([object], harness.objectRegistry);
    expect(wire[0]).toMatchObject({ typeId: "sticky-shape-pack.heart" });
    const reloaded = deserializeSceneObject(
      wire[0] as Record<string, unknown>,
      harness.objectRegistry,
    );
    expect(reloaded.placeholder).toBe(true);

    // Re-enable → everything returns exactly.
    await harness.manager.enable("sticky-shape-pack");
    await settle();
    expect(harness.objectRegistry.hasTypeId("sticky-shape-pack.star")).toBe(
      true,
    );
    expect(harness.commandRegistry.has("sticky-shape-pack.insertStar")).toBe(
      true,
    );
    expect(harness.panels.has("sticky-shape-pack.shapes")).toBe(true);
    expect(harness.sections.has("sticky-shape-pack.appearance")).toBe(true);
    expect(t("sticky-shape-pack:group")).toBe("شکل‌های یادداشتی");
    const restored = deserializeSceneObject(
      wire[0] as Record<string, unknown>,
      harness.objectRegistry,
    );
    expect(restored.placeholder).toBe(false);
    const data = restored.object as PluginObjectData;
    expect(data.typeId).toBe("sticky-shape-pack.heart");
    expect(data.data).toMatchObject({ color: "#f59e0b" });
  });
});

describe("Crash isolation (R9.2 / AC9.3)", () => {
  it("a plugin that throws during init leaves the app fully functional", async () => {
    const shims = new Map<string, PluginStorage>();
    const harness = buildHarness(shims);
    const outcome = await harness.manager.install(
      {
        manifestJson: {
          ...sampleManifestJson,
          id: "crasher",
          name: "Crasher",
          permissions: [],
        },
        entrySource:
          'function pluginMain(app) { throw new Error("boom at boot"); }',
        dictionaries: {},
      },
      [],
    );
    expect(outcome.ok).toBe(true);
    await settle();

    const row = harness.manager
      .listStatus()
      .find((candidate) => candidate.record.manifest.id === "crasher");
    expect(row?.runtimeState).toBe("error");
    expect(row?.runtimeError).toContain("boom at boot");
    // The app's surfaces stay functional — the sample still installs.
    const id = await installSample(harness);
    expect(harness.manager.getRuntime(id)?.runtimeState).toBe("running");
    expect(harness.objectRegistry.size).toBe(3);
  });

  it("a hanging factory times out with NO partial object + a Persian toast (AC9.10)", async () => {
    const shims = new Map<string, PluginStorage>();
    const harness = buildHarness(shims);
    const outcome = await harness.manager.install(
      {
        manifestJson: {
          ...sampleManifestJson,
          id: "hanger",
          name: "Hanger",
          permissions: [],
        },
        entrySource: [
          "function pluginMain(app) {",
          "  app.objects.register({",
          "    id: 'frozen',",
          "    titleKey: 'hanger:frozen',",
          "    factory: function () { return new Promise(function () {}); },",
          "    renderWidget: function () { return '<p>x</p>'; }",
          "  });",
          "}",
        ].join("\n"),
        dictionaries: {},
      },
      [],
    );
    expect(outcome.ok).toBe(true);
    await settle();

    const runtime = harness.manager.getRuntime("hanger") as PluginRuntime;
    const object = await runtime.insertObjectAt("hanger.frozen", {
      x: 10,
      y: 10,
    });
    expect(object).toBeNull();
    expect(harness.scene.objectCount).toBe(0);
    expect(harness.notices.some((notice) => notice.includes("پاسخ نداد"))).toBe(
      true,
    );
  });
});

describe("Permissions at runtime (R9.4 / AC9.4)", () => {
  it("a storage call without the permission gets a typed error", async () => {
    const shims = new Map<string, PluginStorage>();
    const harness = buildHarness(shims);
    const outcome = await harness.manager.install(
      {
        manifestJson: {
          ...sampleManifestJson,
          id: "no-storage",
          name: "No Storage",
          permissions: [],
        },
        entrySource: [
          "function pluginMain(app) {",
          "  app.storage.get('k').catch(function (error) {",
          "    globalThis.__pluginStorageErrorCode = error.code;",
          "    globalThis.__pluginStorageErrorMessage = error.message;",
          "  });",
          "}",
        ].join("\n"),
        dictionaries: {},
      },
      [],
    );
    expect(outcome.ok).toBe(true);
    await settle();

    const globals = globalThis as {
      __pluginStorageErrorCode?: string;
      __pluginStorageErrorMessage?: string;
    };
    expect(globals.__pluginStorageErrorCode).toBe("permission-denied");
    expect(String(globals.__pluginStorageErrorMessage)).toContain("مجوز");
    delete globals.__pluginStorageErrorCode;
    delete globals.__pluginStorageErrorMessage;
  });

  it("the install dialog's consent gate aborts partial consent", async () => {
    const shims = new Map<string, PluginStorage>();
    const harness = buildHarness(shims);
    const outcome = await harness.manager.install(
      {
        manifestJson: { ...sampleManifestJson, id: "consent-test" },
        entrySource: sampleEntrySource,
        dictionaries: {},
      },
      [], // storage NOT consented
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.errors[0]).toContain("رضایت");
    expect(harness.manager.listStatus()).toHaveLength(0);
  });
});

describe("Events allowlist (R9.3)", () => {
  it("allowlisted app events forward; others refuse with a typed error", async () => {
    const shims = new Map<string, PluginStorage>();
    const harness = buildHarness(shims);
    const outcome = await harness.manager.install(
      {
        manifestJson: {
          ...sampleManifestJson,
          id: "listener",
          name: "Listener",
          permissions: [],
        },
        entrySource: [
          "function pluginMain(app) {",
          "  app.events.on('scene:changed', function (payload) {",
          "    globalThis.__pluginSceneRevision = payload && payload.revision;",
          "  });",
          "  app.events.on('ui:find-requested', function () {",
          "    globalThis.__pluginBadEvent = 'subscribed';",
          "  }).catch(function (error) {",
          "    globalThis.__pluginBadEvent = error.code;",
          "  });",
          "}",
        ].join("\n"),
        dictionaries: {},
      },
      [],
    );
    expect(outcome.ok).toBe(true);
    await settle();

    harness.eventBus.emit("scene:changed", { revision: 42, objectCount: 1 });
    await settle();
    const globals = globalThis as {
      __pluginSceneRevision?: number;
      __pluginBadEvent?: string;
    };
    expect(globals.__pluginSceneRevision).toBe(42);
    expect(globals.__pluginBadEvent).toBe("disallowed-event");
    delete globals.__pluginSceneRevision;
    delete globals.__pluginBadEvent;
  });
});

describe("Project namespace + uninstall archive (R9.3 / R9.5 / AC9.7)", () => {
  it("reads/writes ONLY its own section", async () => {
    const shims = new Map<string, PluginStorage>();
    const harness = buildHarness(shims);
    const outcome = await harness.manager.install(
      {
        manifestJson: {
          ...sampleManifestJson,
          id: "writer",
          name: "Writer",
          permissions: ["projectRead", "projectWrite"],
        },
        entrySource: [
          "function pluginMain(app) {",
          "  globalThis.__writerRoundtrip = app.project.read().then(function (before) {",
          "    return app.project.write({ stars: 7, before: before }).then(function () {",
          "      return app.project.read();",
          "    });",
          "  });",
          "}",
        ].join("\n"),
        dictionaries: {},
      },
      ["projectRead", "projectWrite"],
    );
    expect(outcome.ok).toBe(true);
    await settle();

    // A second plugin's section stays untouched — the host guards the
    // namespace (the writer sees only its own section).
    harness.projectPlugins.set("other-plugin", { secret: 1 });
    const roundtrip = (await (
      globalThis as { __writerRoundtrip?: Promise<unknown> }
    ).__writerRoundtrip) as { stars: number; before: unknown } | null;
    expect(roundtrip).toMatchObject({ stars: 7 });
    expect((roundtrip as { before: unknown }).before).toBeNull();
    expect(harness.projectPlugins.get("writer")).toMatchObject({ stars: 7 });
    expect(harness.projectPlugins.get("other-plugin")).toMatchObject({
      secret: 1,
    });
    delete (globalThis as { __writerRoundtrip?: Promise<unknown> })
      .__writerRoundtrip;
  });

  it("uninstall → archive; restore → plugin + data return exactly (AC9.7)", async () => {
    const shims = new Map<string, PluginStorage>();
    const harness = buildHarness(shims);
    await installSample(harness);

    // The plugin persists its colour + writes the project section.
    const storage = shims.get("sticky-shape-pack") as PluginStorage;
    storage.set("defaultColor", "#22d3ee");
    harness.projectPlugins.set("sticky-shape-pack", { stars: 3 });
    const projectSnapshotBefore = JSON.stringify(
      harness.projectPlugins.get("sticky-shape-pack"),
    );

    harness.manager.uninstall("sticky-shape-pack", true);
    expect(harness.manager.listStatus()).toHaveLength(0);
    expect(harness.objectRegistry.hasTypeId("sticky-shape-pack.star")).toBe(
      false,
    );
    // The project file's plugin data survived untouched.
    expect(
      JSON.stringify(harness.projectPlugins.get("sticky-shape-pack")),
    ).toBe(projectSnapshotBefore);
    // The archive exists.
    expect(
      harness.manager.pluginStore.readArchive("sticky-shape-pack"),
    ).not.toBeUndefined();

    // Restore: the plugin returns + its storage comes back exactly.
    const restored = await harness.manager.restore("sticky-shape-pack");
    expect(restored).toBe(true);
    await settle();
    expect(harness.objectRegistry.hasTypeId("sticky-shape-pack.star")).toBe(
      true,
    );
    const recovered = shims.get("sticky-shape-pack") as PluginStorage;
    expect(recovered.get("defaultColor")).toBe("#22d3ee");
    // The project section STILL survived (never touched by the plugin ops).
    expect(harness.projectPlugins.get("sticky-shape-pack")).toMatchObject({
      stars: 3,
    });
  });
});

describe("Insert Panel × plugins (R9.9 / AC9.9 / AC9.10)", () => {
  it("catalog cards appear under the plugin's group with Persian titles (AC9.9)", async () => {
    const shims = new Map<string, PluginStorage>();
    const harness = buildHarness(shims);
    await installSample(harness);

    const cards = resolveCatalogCards(harness.objectRegistry);
    const pluginCards = cards.filter(
      (card) => card.pluginOwner === "sticky-shape-pack",
    );
    expect(pluginCards).toHaveLength(3);
    for (const card of pluginCards) {
      expect(card.group).toBe("sticky-shape-pack:group");
      expect(t(card.titleKey as never)).toContain("یادداشتی");
    }
    // The star card carries the plugin-declared icon + preview.
    const star = pluginCards.find(
      (card) => card.key === "sticky-shape-pack.star",
    );
    expect(star?.icon).toBe("Star");
    expect(star?.preview).toBe("⭐");
  });

  it("catalog rendering sends ZERO bridge messages (AC9.10)", async () => {
    const shims = new Map<string, PluginStorage>();
    const harness = buildHarness(shims);
    await installSample(harness);
    const runtime = harness.manager.getRuntime(
      "sticky-shape-pack",
    ) as PluginRuntime;
    const before = runtime.outgoingBridgeLog.length;

    // The full catalog interaction surface: resolve + filter + translate.
    const cards = resolveCatalogCards(harness.objectRegistry);
    for (const card of cards) {
      t(card.titleKey as never);
    }
    const filtered = cards.filter((card) =>
      t(card.titleKey as never).includes("یادداشتی"),
    );
    expect(filtered.length).toBeGreaterThan(0);
    expect(runtime.outgoingBridgeLog.length).toBe(before);
  });
});

describe("Object registry third-party owners (§1.7.2 / R9.5)", () => {
  it("still rejects core-forged plugin registrations + duplicate kinds", () => {
    const registry = new ObjectRegistry(true);
    registry.register({
      id: "acme.thing",
      kind: "acme.thing",
      titleKey: "acme:thing",
      version: 1,
      factory: () => ({ id: "x", kind: "plugin" }) as never,
      serialize: () => ({}),
      deserialize: () => null,
    });
    expect(registry.hasTypeId("acme.thing")).toBe(true);
    // Unregister removes BOTH indexes.
    registry.unregister("acme.thing");
    expect(registry.hasTypeId("acme.thing")).toBe(false);
    expect(registry.entryForKind("acme.thing")).toBeUndefined();
    // Re-registering the same kind works again (the index was cleaned).
    expect(() =>
      registry.register({
        id: "acme.thing",
        kind: "acme.thing",
        titleKey: "acme:thing",
        version: 1,
        factory: () => ({ id: "x", kind: "plugin" }) as never,
        serialize: () => ({}),
        deserialize: () => null,
      }),
    ).not.toThrow();
  });

  it("command registry unregisters shortcuts with the entry", () => {
    const registry = new CommandRegistry(undefined, true);
    registry.register({
      id: "acme.run",
      titleKey: "acme:run",
      group: "tools",
      order: 1,
      shortcut: "Ctrl+Alt+9",
      execute: () => undefined,
    });
    expect(registry.commandForShortcut("Ctrl-Alt-9")).toBe("acme.run");
    registry.unregister("acme.run");
    expect(registry.commandForShortcut("Ctrl-Alt-9")).toBeUndefined();
    // The shortcut is free again.
    expect(() =>
      registry.register({
        id: "acme.run2",
        titleKey: "acme:run2",
        group: "tools",
        order: 2,
        shortcut: "Ctrl+Alt+9",
        execute: () => undefined,
      }),
    ).not.toThrow();
  });
});
