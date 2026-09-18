import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { createInProcessTransportPair } from "@/plugins/protocol";
import { createPluginSdk } from "@/plugins/sdk/createPluginSdk";
import { runEntrySource } from "@/plugins/sdk/inProcessSandbox";
import { DataHub } from "@/datahub/DataHub";
import { RuleEngine } from "@/datahub/automations/RuleEngine";
import {
  SAMPLE_RULE_ACTION,
  TODAY_MARKER,
  RuleStore,
  memoryRuleStorage,
} from "@/datahub/automations/rules";
import { resolveCatalogCards } from "@/interaction/CatalogInsert";
import { dateToJalali } from "@/core/utils/jalali";
import { __resetMergedNamespaces, t } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";

/** Reads one first-party plugin package from public/. */
function readPlugin(pluginId: string) {
  const dir = `public/plugins-firstparty/${pluginId}`;
  return {
    manifestJson: JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")),
    entrySource: readFileSync(`${dir}/entry.js`, "utf8"),
    dictionaries: {
      fa: JSON.parse(readFileSync(`${dir}/i18n/fa.json`, "utf8")),
      en: JSON.parse(readFileSync(`${dir}/i18n/en.json`, "utf8")),
    },
    permissions: (
      JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")) as {
        permissions: string[];
      }
    ).permissions,
  };
}

const calendarPkg = readPlugin("calendar");
const plannerPkg = readPlugin("planner");
const reporterPkg = readPlugin("reporter");
const aiPkg = readPlugin("ai-analyst");

/** Lets async RPC chains settle before assertions. */
async function settle(rounds = 16): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** The host-side harness (mirrors pluginRuntime.test.ts + the hub). */
interface Harness {
  readonly manager: LifecycleManager;
  readonly hub: DataHub;
  readonly scene: Scene;
  readonly history: HistoryManager;
  readonly objectRegistry: ObjectRegistry;
  readonly commandRegistry: CommandRegistry;
  readonly panels: Map<string, { placement: string; titleKey: string }>;
  readonly sections: Map<string, { titleKey: string }>;
  readonly projectPlugins: Map<string, unknown>;
  readonly notices: string[];
  readonly eventBus: EventBus<AppEventMap>;
  readonly storages: Map<string, PluginStorage>;
}

function buildHarness(): Harness {
  const scene = new Scene();
  const history = new HistoryManager();
  const selection = new Selection();
  const objectRegistry = new ObjectRegistry(true);
  const commandRegistry = new CommandRegistry(undefined, true);
  const eventBus = new EventBus<AppEventMap>();
  const idGenerator = new IdGenerator("obj");
  const hub = new DataHub();
  // The composition root's bridge: hub changes → the app bus.
  hub.onAnyChange((change) => {
    eventBus.emit("datahub:changed", {
      contractId: change.contractId,
      providerId: change.providerId,
      change: change.change,
    });
  });
  const panels = new Map<string, { placement: string; titleKey: string }>();
  const sections = new Map<string, { titleKey: string }>();
  const projectPlugins = new Map<string, unknown>();
  const notices: string[] = [];
  const storages = new Map<string, PluginStorage>();

  const services = {
    scene,
    history,
    selection,
    objectRegistry,
    dataHub: hub,
    eventBus: {
      on: (event: keyof AppEventMap, handler: (payload: unknown) => void) =>
        eventBus.on(event, handler as never) as unknown as () => void,
    },
    registerCommand: (entry: {
      id: string;
      titleKey: string;
      icon?: string;
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
      placement: string;
      titleKey: string;
    }) => {
      panels.set(entry.id, {
        placement: entry.placement,
        titleKey: entry.titleKey,
      });
    },
    unregisterPanel: (id: string) => {
      panels.delete(id);
    },
    registerSettingsSection: (entry: { id: string; titleKey: string }) => {
      sections.set(entry.id, { titleKey: entry.titleKey });
    },
    unregisterSettingsSection: (id: string) => {
      sections.delete(id);
    },
    regionFrame: () => {
      const component = () => null;
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
      const existing = storages.get(id);
      if (existing !== undefined) {
        return existing;
      }
      const created = new PluginStorage(id, memoryStorage());
      storages.set(id, created);
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
    hub,
    scene,
    history,
    objectRegistry,
    commandRegistry,
    panels,
    sections,
    projectPlugins,
    notices,
    eventBus,
    storages,
  };
}

/** Installs one package with its manifest permissions granted. */
async function install(
  harness: Harness,
  pkg: ReturnType<typeof readPlugin>,
): Promise<string> {
  const outcome = await harness.manager.install(
    {
      manifestJson: pkg.manifestJson,
      entrySource: pkg.entrySource,
      dictionaries: pkg.dictionaries,
    },
    pkg.permissions as never,
  );
  expect(outcome.ok).toBe(true);
  await settle();
  return (outcome.pluginId as string) ?? "";
}

/** Queries the hub as one consumer. */
async function q(
  harness: Harness,
  request: Parameters<DataHub["query"]>[1],
): Promise<{
  ok: boolean;
  result?: unknown;
  reason?: string;
  message?: string;
}> {
  const outcome = await harness.hub.query("test", request);
  if (outcome.ok) {
    return { ok: true, result: outcome.result };
  }
  return { ok: false, reason: outcome.reason, message: outcome.message };
}

beforeEach(() => {
  __resetMergedNamespaces();
  useUiStore.getState().setLanguage("fa");
});

afterEach(() => {
  __resetMergedNamespaces();
  vi.restoreAllMocks();
});

describe("Calendar plugin (R10.3 / AC10.1 / AC10.8)", () => {
  it("provides calendar.events v1 over the real bridge + CRUD round-trip", async () => {
    const harness = buildHarness();
    await install(harness, calendarPkg);

    const today = dateToJalali();
    const added = await q(harness, {
      contractId: "calendar.events",
      versionRange: "^1",
      method: "addEvent",
      params: {
        title: "جلسهٔ مرور",
        date: { jy: today.jy, jm: today.jm, jd: today.jd },
        time: "10:00",
      },
    });
    expect(added.ok).toBe(true);
    expect((added.result as { event: { title: string } }).event.title).toBe(
      "جلسهٔ مرور",
    );

    const events = await q(harness, {
      contractId: "calendar.events",
      versionRange: "^1",
      method: "getEvents",
      params: {},
    });
    expect(
      (events.result as { events: { title: string }[] }).events.length,
    ).toBe(1);

    const month = await q(harness, {
      contractId: "calendar.events",
      versionRange: "^1",
      method: "monthInfo",
      params: { jy: today.jy, jm: today.jm },
    });
    const info = month.result as { length: number; events: unknown[] };
    expect(info.length).toBeGreaterThanOrEqual(29);
    expect(info.events.length).toBe(1);

    /* The Jalali⇄Gregorian conversions are exact (same jalaali-js). */
    const jalali = await q(harness, {
      contractId: "calendar.events",
      versionRange: "^1",
      method: "toJalali",
      params: { gy: 2024, gm: 8, gd: 12 },
    });
    expect(jalali.result).toEqual({ jy: 1403, jm: 5, jd: 22 });
    const gregorian = await q(harness, {
      contractId: "calendar.events",
      versionRange: "^1",
      method: "toGregorian",
      params: { jy: 1403, jm: 5, jd: 22 },
    });
    expect(gregorian.result).toEqual({ gy: 2024, gm: 8, gd: 12 });

    /* Nowruz is an official holiday in month 1. */
    const holidays = await q(harness, {
      contractId: "calendar.events",
      versionRange: "^1",
      method: "getHolidays",
      params: { jy: 1403, jm: 1 },
    });
    const list = (holidays.result as { holidays: { day: number }[] }).holidays;
    expect(list.some((holiday) => holiday.day === 1)).toBe(true);
  });

  it("AC10.1: a ^2 consumer of the v1 provider degrades with the Persian notice", async () => {
    const harness = buildHarness();
    await install(harness, calendarPkg);
    const outcome = await q(harness, {
      contractId: "calendar.events",
      versionRange: "^2",
      method: "getEvents",
      params: {},
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("version");
    expect(outcome.message).toContain("سازگار نیست");
  });

  it("AC10.8: the month-grid card is catalogued under the plugin group + exact-point insert", async () => {
    const harness = buildHarness();
    await install(harness, calendarPkg);

    const cards = resolveCatalogCards(harness.objectRegistry);
    const card = cards.find(
      (candidate) => candidate.typeId === "calendar.monthGrid",
    );
    expect(card).toBeDefined();
    expect(card?.pluginOwner).toBe("calendar");
    expect(card?.titleKey).toBe("calendar:monthGrid.title");
    // The Persian title resolves through the plugin's merged dictionary.
    expect(t("calendar:monthGrid.title")).toBe("جدول ماه تقویم");
    expect(t("calendar:group")).toBe("تقویم");

    const runtime = harness.manager.getRuntime("calendar") as PluginRuntime;
    const object = await runtime.insertObjectAt("calendar.monthGrid", {
      x: 400,
      y: 300,
    });
    expect(object).not.toBeNull();
    // 320×300 widget centred on the drop point.
    expect(object?.position).toEqual({ x: 400 - 160, y: 300 - 150 });
    expect(harness.scene.objectCount).toBe(1);

    // The widget snapshot renders the month grid HTML (pure markup).
    const html = await runtime.renderWidgetHtml(
      "calendar.monthGrid",
      object?.data ?? {},
      { width: 320, height: 300 },
    );
    expect(html).toContain("grid-template-columns");
    expect(harness.notices).toEqual([]);

    // Disable → the card vanishes (zero catalog-specific code).
    harness.manager.disable("calendar");
    await settle();
    expect(
      resolveCatalogCards(harness.objectRegistry).find(
        (candidate) => candidate.typeId === "calendar.monthGrid",
      ),
    ).toBeUndefined();
  });

  it("AC10.6: uninstall → archive; reinstall + restore → events return exactly", async () => {
    const harness = buildHarness();
    await install(harness, calendarPkg);
    const today = dateToJalali();
    await q(harness, {
      contractId: "calendar.events",
      versionRange: "^1",
      method: "addEvent",
      params: {
        title: "رویداد مهم",
        date: { jy: today.jy, jm: today.jm, jd: today.jd },
      },
    });

    const before = await q(harness, {
      contractId: "calendar.events",
      versionRange: "^1",
      method: "getEvents",
      params: {},
    });
    const beforeEvents = (before.result as { events: unknown[] }).events;

    harness.manager.uninstall("calendar", true);
    await settle();
    // The contract resolves only from ENABLED plugins.
    const gone = await q(harness, {
      contractId: "calendar.events",
      versionRange: "^1",
      method: "getEvents",
      params: {},
    });
    expect(gone.ok).toBe(false);

    const restored = await harness.manager.restore("calendar");
    expect(restored).toBe(true);
    await settle();
    const after = await q(harness, {
      contractId: "calendar.events",
      versionRange: "^1",
      method: "getEvents",
      params: {},
    });
    expect(after.ok).toBe(true);
    expect((after.result as { events: unknown[] }).events).toEqual(
      beforeEvents,
    );
  });
});

describe("Planner plugin (R10.4 / AC10.2 / AC10.6 / AC10.8)", () => {
  it("planner.tasks CRUD in the project section + change events fire", async () => {
    const harness = buildHarness();
    await install(harness, plannerPkg);

    const changes: unknown[] = [];
    harness.eventBus.on("datahub:changed", (payload) => {
      if (payload.contractId === "planner.tasks") {
        changes.push(payload.change);
      }
    });

    const goal = await q(harness, {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "addGoal",
      params: { title: "انتشار نسخهٔ ۲", kind: "long" },
    });
    expect(goal.ok).toBe(true);
    const goalId = (goal.result as { goal: { id: string } }).goal.id;

    const today = dateToJalali();
    const task = await q(harness, {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "addTask",
      params: {
        title: "نوشتن گزارش",
        goalId,
        due: { jy: today.jy, jm: today.jm, jd: today.jd },
      },
    });
    expect(task.ok).toBe(true);
    const taskId = (task.result as { task: { id: string } }).task.id;

    const done = await q(harness, {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "completeTask",
      params: { id: taskId },
    });
    expect((done.result as { task: { status: string } }).task.status).toBe(
      "done",
    );

    // The data lives in the PROJECT section (per-project scope).
    const section = harness.projectPlugins.get("planner") as {
      goals: { id: string; title: string }[];
      tasks: { id: string; status: string }[];
    };
    expect(section.goals[0]?.title).toBe("انتشار نسخهٔ ۲");
    expect(section.tasks[0]?.status).toBe("done");

    // Change events crossed the bridge onto the app bus.
    const types = changes.map((change) => (change as { type: string }).type);
    expect(types).toContain("goal-added");
    expect(types).toContain("task-added");
    expect(types).toContain("task-completed");

    // Task-card + goal-board catalog cards (AC10.8).
    expect(t("planner:taskCard.title")).toBe("کارت کار");
    expect(t("planner:goalBoard.title")).toBe("برد هدف");
    const cards = resolveCatalogCards(harness.objectRegistry);
    expect(
      cards.find((candidate) => candidate.typeId === "planner.taskCard")
        ?.pluginOwner,
    ).toBe("planner");
    expect(
      cards.find((candidate) => candidate.typeId === "planner.goalBoard")
        ?.pluginOwner,
    ).toBe("planner");
  });

  it("AC10.2: consumes calendar monthInfo; disabling calendar degrades but planner works", async () => {
    const harness = buildHarness();
    await install(harness, calendarPkg);
    await install(harness, plannerPkg);
    const today = dateToJalali();

    // The planner's date-picker path: monthInfo through the real bridge.
    const month = await q(harness, {
      contractId: "calendar.events",
      versionRange: "^1",
      method: "monthInfo",
      params: { jy: today.jy, jm: today.jm },
    });
    expect(month.ok).toBe(true);
    expect((month.result as { monthName: string }).monthName).toBeDefined();

    // Seed a planner task (planner keeps its own data).
    await q(harness, {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "addTask",
      params: { title: "کار بدون تقویم" },
    });

    // Disable the calendar → the contract answers the Persian notice.
    harness.manager.disable("calendar");
    await settle();
    const degraded = await q(harness, {
      contractId: "calendar.events",
      versionRange: "^1",
      method: "monthInfo",
      params: { jy: today.jy, jm: today.jm },
    });
    expect(degraded.ok).toBe(false);
    expect(degraded.message).toContain("در دسترس نیست");

    // …while planner.tasks keeps working (nothing crashed).
    const state = await q(harness, {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "getState",
      params: {},
    });
    expect(state.ok).toBe(true);
    expect(
      (state.result as { tasks: { title: string }[] }).tasks[0]?.title,
    ).toBe("کار بدون تقویم");
    expect(harness.notices).toEqual([]);
  });
});

describe("Automations × first-party (R10.7 / AC10.4, REAL plugins)", () => {
  it("the sample rule fires against the REAL contracts: completeTask → calendar addEvent", async () => {
    const harness = buildHarness();
    await install(harness, calendarPkg);
    await install(harness, plannerPkg);

    // The REAL engine over the harness hub + bus + a real store.
    const engine = new RuleEngine({
      hub: harness.hub,
      bus: harness.eventBus,
      dispatcher: { dispatch: () => undefined },
      store: new RuleStore(memoryRuleStorage()),
      commandContext: () => ({ services: { tryGet: () => undefined } }),
      logger: {
        warn: () => undefined,
        error: () => undefined,
        info: () => undefined,
      },
    });
    engine.start();

    // THE one-click sample rule — the exact action the panel's button
    // saves (contract method + params straight from SAMPLE_RULE_ACTION).
    engine.rules.saveRule({
      id: "rule:sample-live",
      enabled: true,
      createdAt: Date.now(),
      trigger: {
        event: "datahub:changed:planner.tasks",
        changeType: "task-completed",
      },
      action: SAMPLE_RULE_ACTION,
    });

    // Seed + complete a task through the REAL planner contract.
    await q(harness, {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "addTask",
      params: { title: "تمیزکاری نهایی" },
    });
    const state = (await q(harness, {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "getState",
      params: {},
    })) as { result: { tasks: { id: string }[] } };
    const taskId = state.result.tasks[0]?.id as string;
    await q(harness, {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "completeTask",
      params: { id: taskId },
    });
    await settle();

    // The rule fired: one log row, ok, routed to the REAL addEvent.
    const log = engine.rules.listLog();
    expect(log.length).toBe(1);
    expect(log[0]?.ok).toBe(true);
    expect(log[0]?.ruleId).toBe("rule:sample-live");
    expect(log[0]?.detail).toContain("calendar.events.addEvent");

    // …and the calendar really holds the event — dated TODAY (the
    // marker resolved at fire time through the host's jalali util).
    const today = dateToJalali();
    const events = (await q(harness, {
      contractId: "calendar.events",
      versionRange: "^1",
      method: "getEvents",
      params: {},
    })) as {
      result: {
        events: { title: string; jy: number; jm: number; jd: number }[];
      };
    };
    const booked = events.result.events.find(
      (event) => event.title === "✅ کار انجام شد",
    );
    expect(booked).toMatchObject({
      jy: today.jy,
      jm: today.jm,
      jd: today.jd,
    });
    // The saved rule still holds the marker (resolution is per firing).
    expect(engine.rules.listRules()[0]?.action).toMatchObject({
      method: "addEvent",
      params: expect.objectContaining({ date: TODAY_MARKER }),
    });
    engine.stop();
  });
});

describe("Reporter plugin (R10.5 / AC10.3)", () => {
  it("AC10.3: seeded planner data produces correct day/week/month numbers", async () => {
    const harness = buildHarness();
    await install(harness, calendarPkg);
    await install(harness, plannerPkg);
    await install(harness, reporterPkg);

    /* Seed: 1 completed today, 1 pending due yesterday (overdue),
     * 1 pending due today (not overdue). */
    const today = dateToJalali(new Date());
    const yesterday = dateToJalali(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const dueYesterday = {
      jy: yesterday.jy,
      jm: yesterday.jm,
      jd: yesterday.jd,
    };
    const dueToday = { jy: today.jy, jm: today.jm, jd: today.jd };

    await q(harness, {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "addTask",
      params: { title: "کار انجام‌شدهٔ امروز" },
    });
    await q(harness, {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "addTask",
      params: { title: "عقب‌افتاده", due: dueYesterday },
    });
    await q(harness, {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "addTask",
      params: { title: "امروز سررسید", due: dueToday },
    });
    const state = await q(harness, {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "getState",
      params: {},
    });
    const tasks = (state.result as { tasks: { id: string }[] }).tasks;
    await q(harness, {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "completeTask",
      params: { id: tasks[0]?.id },
    });

    /* Run the reporter's command (headless) — the report lands in the
     * project section with all three periods. */
    harness.commandRegistry
      .get("reporter.generate")
      ?.execute({ services: { tryGet: () => undefined } });
    await settle(24);

    const report = harness.projectPlugins.get("reporter") as {
      plannerAvailable: boolean;
      calendarAvailable: boolean;
      day: {
        completed: number;
        pending: number;
        overdue: number;
        streak: number;
      };
      week: { completed: number };
      month: { completed: number };
    };
    expect(report).toBeDefined();
    expect(report.plannerAvailable).toBe(true);
    expect(report.calendarAvailable).toBe(true);
    expect(report.day.completed).toBe(1);
    expect(report.day.pending).toBe(2);
    expect(report.day.overdue).toBe(1);
    expect(report.day.streak).toBe(1);
    expect(report.week.completed).toBe(1);
    expect(report.month.completed).toBe(1);

    /* The RTL SVG chart: the reporter's widget... no widget — but the
     * chart SVG is produced in the panel region; the command report
     * carries the buckets the chart renders (RTL rendering asserted in
     * the live E2E). Buckets exist for every day of each period. */
    expect(
      (
        harness.projectPlugins.get("reporter") as {
          day: { buckets: unknown[] };
        }
      ).day.buckets.length,
    ).toBe(1);
  });

  it("R10.5: degrades gracefully with both providers missing", async () => {
    const harness = buildHarness();
    await install(harness, reporterPkg);

    harness.commandRegistry
      .get("reporter.generate")
      ?.execute({ services: { tryGet: () => undefined } });
    await settle(24);

    const report = harness.projectPlugins.get("reporter") as {
      plannerAvailable: boolean;
      calendarAvailable: boolean;
      plannerNotice: string | null;
      calendarNotice: string | null;
      day: { completed: number };
    };
    expect(report.plannerAvailable).toBe(false);
    expect(report.calendarAvailable).toBe(false);
    expect(report.plannerNotice).toContain("در دسترس نیست");
    expect(report.calendarNotice).toContain("در دسترس نیست");
    expect(report.day.completed).toBe(0);
    // Nothing crashed; the app surfaces no error toast.
    expect(harness.notices).toEqual([]);
  });
});

describe("AI Analyst plugin (R10.6 / AC10.5)", () => {
  it("AC10.5: NO fetch before the confirm; the preview precedes EVERY call; structured report", async () => {
    const harness = buildHarness();
    await install(harness, aiPkg);

    /* Configure the backend through the plugin's own storage. */
    const storage = harness.storages.get("ai-analyst") as PluginStorage;
    storage.set("config", {
      backend: "external",
      endpoint: "https://api.example.com/v1",
      apiKey: "sk-test-123",
      model: "gpt-4o-mini",
    });

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "۱) خلاصهٔ وضعیت: بوم فعال است.\n۲) نکات برجسته: …\n۳) ریسک‌ها: …\n۴) پیشنهادها: …",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    /* Headless prepare: builds + persists the pending request — and
     * MUST NOT touch the network yet. */
    harness.commandRegistry
      .get("ai-analyst.prepare")
      ?.execute({ services: { tryGet: () => undefined } });
    await settle(24);
    expect(fetchSpy).not.toHaveBeenCalled();

    const pending = storage.get("pendingRequest") as {
      payload: { url: string; body: { messages: unknown[] } };
    };
    expect(pending).toBeDefined();
    expect(pending.payload.url).toBe(
      "https://api.example.com/v1/chat/completions",
    );

    /* Attach the panel region (the plugin's own in-process iframe twin)
     * and drive the confirm gate the way the host would. */
    const runtime = harness.manager.getRuntime("ai-analyst") as PluginRuntime;
    const regionId = "panel:ai-analyst.main";
    const pair = createInProcessTransportPair();
    runtime.attachRegion(regionId, pair.a);
    const { app: regionApp } = createPluginSdk(pair.b, {
      pluginId: "ai-analyst",
      sdkMajor: 1,
      regionId,
    });
    const crash = runEntrySource(regionApp, aiPkg.entrySource);
    expect(crash).toBeNull();
    await settle();

    /* Still no fetch — only the explicit confirm releases the request. */
    expect(fetchSpy).not.toHaveBeenCalled();
    pair.a.post({
      v: 1,
      kind: "evt",
      event: "plugin.region.message",
      payload: { regionId, message: { type: "confirm-send" } },
    });
    await settle(32);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers?.Authorization).toBe("Bearer sk-test-123");
    expect(init.headers?.["Content-Type"]).toBe("application/json");
    /* The EXACT previewed payload is what left the browser. */
    const sentBody = JSON.parse(init.body) as {
      model: string;
      messages: unknown[];
    };
    expect(sentBody.model).toBe("gpt-4o-mini");
    expect(sentBody.messages).toEqual(pending.payload.body.messages);

    /* The structured Persian report landed in the plugin's storage. */
    const report = storage.get("lastReport") as {
      text: string;
      request: unknown;
    };
    expect(report).toBeDefined();
    expect(report.text).toContain("خلاصهٔ وضعیت");
    expect(report.request).toEqual(pending.payload);

    /* The pending request is consumed — a second confirm sends nothing. */
    pair.a.post({
      v: 1,
      kind: "evt",
      event: "plugin.region.message",
      payload: { regionId, message: { type: "confirm-send" } },
    });
    await settle(16);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("without a key/endpoint the plugin stays quiet (app unaffected)", async () => {
    const harness = buildHarness();
    await install(harness, aiPkg);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    harness.commandRegistry
      .get("ai-analyst.prepare")
      ?.execute({ services: { tryGet: () => undefined } });
    await settle(24);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(harness.notices).toEqual([]);

    // The project section is untouched (no report without a backend).
    expect(harness.projectPlugins.get("ai-analyst")).toBeUndefined();
  });
});
