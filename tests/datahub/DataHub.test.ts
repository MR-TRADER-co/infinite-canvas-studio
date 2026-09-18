import { describe, expect, it } from "vitest";
import { DataHub, versionSatisfies, type HubProvider } from "@/datahub/DataHub";

describe("versionSatisfies (R10.1 range semantics)", () => {
  it.each([
    ["1.0.0", "^1", true],
    ["1.9.3", "^1", true],
    ["2.0.0", "^1", false],
    ["1.0.0", "^1.2.0", false],
    ["1.2.0", "^1.0.0", true],
    ["1.0.0", "~1.0.0", true],
    ["1.0.5", "~1.0.0", true],
    ["1.1.0", "~1.0.0", false],
    ["1.0.0", ">=1", true],
    ["0.9.0", ">=1", false],
    ["1.0.0", "1.0.0", true],
    ["1.0.1", "1.0.0", false],
    ["1.2.3", "1.2", true],
    ["1.3.0", "1.2", false],
    ["1.4.0", "1", true],
    ["2.0.0", "1", false],
    ["2.1.0", "*", true],
    ["1.0.0", "", false],
  ])("%s satisfies %s → %s", (version, range, expected) => {
    expect(versionSatisfies(version, range)).toBe(expected);
  });
});

describe("DataHub (R10.1 provider/consumer mechanics)", () => {
  const provider = (
    contractId: string,
    version: string,
    providerId: string,
    query?: (method: string, params: unknown) => Promise<unknown>,
  ): HubProvider & {
    query?: (method: string, params: unknown) => Promise<unknown>;
  } => ({
    contractId,
    version,
    providerId,
    methods: ["get", "put"],
    ...(query === undefined ? {} : { query }),
  });

  it("serves host providers (project.digest shape, R10.2)", async () => {
    const hub = new DataHub();
    hub.registerHostProvider({
      contractId: "project.digest",
      version: "1.0.0",
      providerId: "host",
      methods: ["get"],
      query: async (method) => ({ method, value: 42 }),
    });
    const outcome = await hub.query("consumer", {
      contractId: "project.digest",
      versionRange: "^1",
      method: "get",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toEqual({ method: "get", value: 42 });
    }
  });

  it("AC10.1: a consumer requiring v2 of a v1 provider degrades gracefully", async () => {
    const hub = new DataHub();
    hub.registerHostProvider({
      contractId: "calendar.events",
      version: "1.0.0",
      providerId: "calendar",
      methods: ["getEvents"],
      query: async () => ({ events: [] }),
    });
    const outcome = await hub.query("consumer", {
      contractId: "calendar.events",
      versionRange: "^2",
      method: "getEvents",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("version");
      // The Persian notice the consumer shows (nothing crashes).
      expect(outcome.message).toContain("سازگار نیست");
    }
  });

  it("missing provider + unknown method + provider throw → typed outcomes", async () => {
    const hub = new DataHub();
    const missing = await hub.query("consumer", {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "getState",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toBe("no-provider");
      expect(missing.message).toContain("در دسترس نیست");
    }

    hub.registerHostProvider({
      contractId: "planner.tasks",
      version: "1.0.0",
      providerId: "planner",
      methods: ["getState"],
      query: async () => ({}),
    });
    const badMethod = await hub.query("consumer", {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "nope",
    });
    expect(badMethod.ok).toBe(false);
    if (!badMethod.ok) {
      expect(badMethod.reason).toBe("method");
    }
  });

  it("provider errors degrade to provider-error (never throws)", async () => {
    const hub = new DataHub();
    hub.registerHostProvider({
      contractId: "flaky",
      version: "1.0.0",
      providerId: "flaky",
      methods: ["get"],
      query: async () => {
        throw new Error("boom");
      },
    });
    const outcome = await hub.query("consumer", {
      contractId: "flaky",
      versionRange: "^1",
      method: "get",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("provider-error");
    }
  });

  it("R10.1: unregisterOwner removes the contracts (disabled plugins)", async () => {
    const hub = new DataHub();
    hub.registerPluginProvider(
      provider("planner.tasks", "1.0.0", "planner", async () => ({})),
      async () => ({}),
    );
    expect(hub.listContracts().length).toBe(1);
    hub.unregisterOwner("planner");
    expect(hub.listContracts().length).toBe(0);
    const outcome = await hub.query("consumer", {
      contractId: "planner.tasks",
      versionRange: "^1",
      method: "getState",
    });
    expect(outcome.ok).toBe(false);
  });

  it("publish fans out to range-matching subscribers + host listeners", () => {
    const hub = new DataHub();
    hub.registerPluginProvider(
      provider("planner.tasks", "1.0.0", "planner", async () => ({})),
      async () => ({}),
    );
    const matching: unknown[] = [];
    const versioned: unknown[] = [];
    const hostChanges: { contractId: string; change: unknown }[] = [];
    hub.subscribe("reporter", "planner.tasks", "^1", (change) => {
      matching.push(change);
    });
    hub.subscribe("old-consumer", "planner.tasks", "^2", (change) => {
      versioned.push(change);
    });
    const unsubscribe = hub.onAnyChange((change) => {
      hostChanges.push(change);
    });

    const accepted = hub.publish("planner", "planner.tasks", {
      type: "task-completed",
    });
    expect(accepted).toBe(true);
    expect(matching).toEqual([{ type: "task-completed" }]);
    // The v2-wanting consumer is NOT woken by a v1 provider.
    expect(versioned).toEqual([]);
    expect(hostChanges.length).toBe(1);

    // Only the OWNER may publish.
    expect(hub.publish("imposter", "planner.tasks", { type: "x" })).toBe(false);

    unsubscribe();
    hub.publish("planner", "planner.tasks", { type: "again" });
    expect(hostChanges.length).toBe(1);
  });

  it("subscribe reports current availability with the Persian notice", () => {
    const hub = new DataHub();
    const unavailable = hub.subscribe("reporter", "planner.tasks", "^1", () => {
      /* never */
    });
    expect(unavailable.ok).toBe(false);
    expect(unavailable.message).toContain("در دسترس نیست");

    hub.registerPluginProvider(
      provider("planner.tasks", "1.0.0", "planner", async () => ({})),
      async () => ({}),
    );
    const late = hub.subscribe("reporter2", "planner.tasks", "^1", () => {
      /* late provider */
    });
    expect(late.ok).toBe(true);
    expect(late.message).toBeNull();
  });
});
