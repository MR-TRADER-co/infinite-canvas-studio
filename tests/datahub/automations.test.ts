import { describe, expect, it, beforeEach } from "vitest";
import { EventBus, type AppEventMap } from "@/core/events/EventBus";
import { DataHub } from "@/datahub/DataHub";
import {
  RuleEngine,
  type AutomationDispatcher,
} from "@/datahub/automations/RuleEngine";
import {
  RuleStore,
  SAMPLE_RULE_ACTION,
  TODAY_MARKER,
  memoryRuleStorage,
  parseRule,
  type AutomationLogEntry,
  type AutomationRule,
} from "@/datahub/automations/rules";
import { dateToJalali } from "@/core/utils/jalali";

/** A Persian-sink logger. */
const silentLogger = {
  warn: () => undefined,
  error: () => undefined,
  info: () => undefined,
};

/** Builds an engine over a fresh hub + bus. */
function buildEngine(storage = memoryRuleStorage()) {
  const hub = new DataHub();
  const bus = new EventBus<AppEventMap>();
  const dispatched: string[] = [];
  const dispatcher: AutomationDispatcher = {
    dispatch: (commandId) => {
      dispatched.push(commandId);
    },
  };
  const engine = new RuleEngine({
    hub,
    bus,
    dispatcher,
    store: new RuleStore(storage),
    commandContext: () => ({ services: { tryGet: () => undefined } }),
    logger: silentLogger,
  });
  engine.start();
  return { engine, hub, bus, dispatched };
}

/** The AC10.4 sample rule (task completed → calendar event today). */
function sampleRule(): AutomationRule {
  return {
    id: "rule:sample",
    enabled: true,
    createdAt: Date.now(),
    trigger: {
      event: "datahub:changed:planner.tasks",
      changeType: "task-completed",
    },
    action: SAMPLE_RULE_ACTION,
  };
}

describe("RuleStore (R10.7 persistence + parsing)", () => {
  it("persists rules + log and reloads them (fail-closed)", () => {
    const storage = memoryRuleStorage();
    const store = new RuleStore(storage);
    store.saveRule(sampleRule());
    const entry: AutomationLogEntry = {
      at: Date.now(),
      ruleId: "rule:sample",
      triggerLabel: "تغییر planner.tasks از نوع task-completed",
      actionLabel: "نوشتن در calendar.events (addEvent)",
      ok: true,
      detail: "calendar.events.addEvent",
    };
    store.appendLog(entry);

    const reloaded = new RuleStore(storage);
    expect(reloaded.listRules().length).toBe(1);
    expect(reloaded.listRules()[0]?.action.kind).toBe("datahub");
    expect(reloaded.listLog().length).toBe(1);
    expect(reloaded.listLog()[0]?.ok).toBe(true);
  });

  it("drops malformed records (fail-closed, never crashes)", () => {
    expect(parseRule({ id: 5 })).toBeNull();
    expect(
      parseRule({ id: "x", trigger: { event: "nope" }, action: {} }),
    ).toBeNull();
    expect(
      parseRule({
        id: "x",
        trigger: { event: "persistence:saved" },
        action: { kind: "command" },
      }),
    ).toBeNull();
    const good = parseRule({
      id: "x",
      enabled: false,
      createdAt: 1,
      trigger: { event: "persistence:saved" },
      action: { kind: "command", commandId: "core.file.save" },
    });
    expect(good?.enabled).toBe(false);
    expect(good?.action).toEqual({
      kind: "command",
      commandId: "core.file.save",
    });
  });
});

describe("RuleEngine (R10.7 / AC10.4 end-to-end)", () => {
  beforeEach(() => {
    /* fresh per test via buildEngine */
  });

  it("AC10.4: task-completed → addEvent fires end-to-end and is logged", async () => {
    const { engine, hub } = buildEngine();
    engine.rules.saveRule(sampleRule());

    // The calendar contract (a host-side provider standing in for the
    // plugin): the engine's datahub action routes here — mirroring the
    // REAL plugin's `addEvent` method name.
    const created: unknown[] = [];
    hub.registerHostProvider({
      contractId: "calendar.events",
      version: "1.0.0",
      providerId: "calendar",
      methods: [SAMPLE_RULE_ACTION.method],
      query: async (method, params) => {
        created.push({ method, params });
        return { event: { id: "evt:1" } };
      },
    });

    // The planner plugin publishes the change the rule listens for.
    hub.registerHostProvider({
      contractId: "planner.tasks",
      version: "1.0.0",
      providerId: "planner",
      methods: ["completeTask"],
      query: async () => ({}),
    });
    hub.publish("planner", "planner.tasks", {
      type: "task-completed",
      taskId: "task:9",
    });

    // The datahub write is async — let the engine's fire() settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The today-marker resolved to a concrete Jalali date at fire time.
    const today = dateToJalali(new Date());
    expect(created).toEqual([
      {
        method: "addEvent",
        params: {
          title: "✅ کار انجام شد",
          date: { jy: today.jy, jm: today.jm, jd: today.jd },
        },
      },
    ]);
    const log = engine.rules.listLog();
    expect(log.length).toBe(1);
    expect(log[0]?.ok).toBe(true);
    expect(log[0]?.ruleId).toBe("rule:sample");
    expect(log[0]?.detail).toContain("addEvent");
  });

  it("the today-marker resolves recursively; static params pass through", async () => {
    const { engine, hub } = buildEngine();
    engine.rules.saveRule({
      id: "rule:marker",
      enabled: true,
      createdAt: Date.now(),
      trigger: { event: "datahub:changed:calendar.events" },
      action: {
        kind: "datahub",
        contractId: "calendar.events",
        method: "addEvent",
        params: {
          title: "marker",
          date: TODAY_MARKER,
          nested: { when: TODAY_MARKER, keep: "static" },
          list: [TODAY_MARKER, 7],
        },
      },
    });
    const seen: unknown[] = [];
    hub.registerHostProvider({
      contractId: "calendar.events",
      version: "1.0.0",
      providerId: "calendar",
      methods: ["addEvent"],
      query: async (_method, params) => {
        seen.push(params);
        return {};
      },
    });
    hub.publish("calendar", "calendar.events", { type: "event-added" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const today = dateToJalali(new Date());
    const expectedDate = { jy: today.jy, jm: today.jm, jd: today.jd };
    expect(seen[0]).toEqual({
      title: "marker",
      date: expectedDate,
      nested: { when: expectedDate, keep: "static" },
      list: [expectedDate, 7],
    });
    // The SAVED rule still holds the marker (resolve happens per firing).
    expect(engine.rules.listRules()[0]?.action).toMatchObject({
      params: expect.objectContaining({ date: TODAY_MARKER }),
    });
  });

  it("the changeType filter skips non-matching changes", async () => {
    const { engine, hub } = buildEngine();
    engine.rules.saveRule(sampleRule());
    hub.registerHostProvider({
      contractId: "calendar.events",
      version: "1.0.0",
      providerId: "calendar",
      methods: ["addEvent"],
      query: async () => ({}),
    });
    hub.registerHostProvider({
      contractId: "planner.tasks",
      version: "1.0.0",
      providerId: "planner",
      methods: ["getState"],
      query: async () => ({}),
    });

    hub.publish("planner", "planner.tasks", { type: "task-added" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(engine.rules.listLog().length).toBe(0);
  });

  it("command actions dispatch through the dispatcher (undoable path)", async () => {
    const { engine, bus, dispatched } = buildEngine();
    engine.rules.saveRule({
      id: "rule:cmd",
      enabled: true,
      createdAt: Date.now(),
      trigger: { event: "persistence:saved" },
      action: { kind: "command", commandId: "core.file.save" },
    });
    bus.emit("persistence:saved", { timestamp: Date.now(), reason: "manual" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dispatched).toEqual(["core.file.save"]);
    expect(engine.rules.listLog()[0]?.ok).toBe(true);
  });

  it("disabled rules never fire; failures land in the log with ok=false", async () => {
    const { engine, hub } = buildEngine();
    const rule = sampleRule();
    engine.rules.saveRule({ ...rule, enabled: false });
    hub.registerHostProvider({
      contractId: "planner.tasks",
      version: "1.0.0",
      providerId: "planner",
      methods: [],
      query: async () => ({}),
    });
    hub.publish("planner", "planner.tasks", { type: "task-completed" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(engine.rules.listLog().length).toBe(0);

    // Now enable + point at a contract that does NOT exist → logged failure.
    engine.rules.setEnabled(rule.id, true);
    hub.publish("planner", "planner.tasks", { type: "task-completed" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const log = engine.rules.listLog();
    expect(log.length).toBe(1);
    expect(log[0]?.ok).toBe(false);
    expect(log[0]?.detail).toContain("در دسترس نیست");
  });

  it("allowlisted app events (plugins:changed) fire matching rules", async () => {
    const { engine, bus } = buildEngine();
    engine.rules.saveRule({
      id: "rule:plug",
      enabled: true,
      createdAt: Date.now(),
      trigger: { event: "plugins:changed" },
      action: { kind: "command", commandId: "plugin.refreshed" },
    });
    bus.emit("plugins:changed", { pluginId: "calendar", reason: "enable" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(engine.rules.listLog().length).toBe(1);
  });
});
