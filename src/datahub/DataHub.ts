/**
 * The inter-plugin Data Hub (R10.1): providers register typed, versioned
 * contracts; consumers query + subscribe through the hub.
 *
 * Design properties the spec pins:
 * - VERSIONED contracts: a consumer declares an acceptable range; a
 *   provider whose version does not satisfy it makes the contract
 *   "unavailable" FOR THAT CONSUMER — the hub answers a typed
 *   `{ok: false, reason: "version"}` outcome with a Persian message and
 *   the consumer DEGRADES GRACEFULLY (a notice, the feature off — never
 *   a crash, AC10.1);
 * - contracts resolve only from ENABLED plugins: a plugin's providers
 *   are unregistered wholesale with its runtime (the disable path), and
 *   queries routed to a dead provider degrade the same way;
 * - providers may be HOST-side (project.digest, R10.2) or PLUGIN-side
 *   (calendar.events / planner.tasks); plugin providers are served
 *   through a per-runtime call closure with the standard timeout guard;
 * - change events: providers `publish` a change payload; the hub fans
 *   it out to subscribers whose range matches, to host-side listeners
 *   (the automations engine), and onto the app event bus
 *   (`datahub:changed`) so every surface can react.
 *
 * Layering: plain TypeScript — no React/DOM imports.
 */

/** One registered provider (host- or plugin-owned). */
export interface HubProvider {
  /** The contract id (e.g. `calendar.events`). */
  readonly contractId: string;
  /** The provider's semver version (e.g. `1.0.0`). */
  readonly version: string;
  /** Who provides it: a plugin id or `"host"`. */
  readonly providerId: string;
  /** The query methods the provider serves (documentation + validation). */
  readonly methods: readonly string[];
}

/** A query's outcome — the graceful-degradation contract (R10.1). */
export type HubQueryOutcome =
  | { readonly ok: true; readonly result: unknown }
  | {
      readonly ok: false;
      readonly reason: "no-provider" | "version" | "method" | "provider-error";
      readonly message: string;
    };

/** The host-side provider call (implementations add timeouts). */
export type ProviderQuery = (
  method: string,
  params: unknown,
) => Promise<unknown>;

/** One subscription record. */
interface Subscription {
  readonly consumerId: string;
  readonly contractId: string;
  readonly versionRange: string;
  readonly listener: (change: unknown) => void;
}

/** A hub change fan-out record (eventBus bridging + the engine). */
export interface HubChange {
  readonly contractId: string;
  readonly providerId: string;
  readonly change: unknown;
}

/** Persian notice copy for the degradation reasons. */
const REASON_MESSAGES: Readonly<
  Record<string, (contractId: string) => string>
> = {
  "no-provider": (contractId) =>
    `دادگان «${contractId}» در دسترس نیست (ارائه‌دهندهٔ فعال وجود ندارد).`,
  version: (contractId) =>
    `نسخهٔ دادگان «${contractId}» با نسخهٔ درخواستی سازگار نیست.`,
  method: (contractId) =>
    `روش درخواستی روی دادگان «${contractId}» تعریف نشده است.`,
  "provider-error": (contractId) =>
    `ارائه‌دهندهٔ دادگان «${contractId}» پاسخ معتبری نداد.`,
};

/**
 * Splits a semver string into numeric components.
 *
 * @param version - the version string (e.g. `1.2.3`).
 * @returns the components (non-numeric parts become 0).
 */
function parseVersion(version: string): [number, number, number] {
  const parts = version.replace(/^[v=\s]+/, "").split(".");
  const major = Number(parts[0] ?? "0");
  const minor = Number(parts[1] ?? "0");
  const patch = Number(parts[2] ?? "0");
  return [
    Number.isFinite(major) ? major : 0,
    Number.isFinite(minor) ? minor : 0,
    Number.isFinite(patch) ? patch : 0,
  ];
}

/**
 * Whether a provider version satisfies a consumer range.
 *
 * Supported range forms: `*`, `^X[.Y[.Z]]` (major-compatible), `~X.Y[.Z]`
 * (patch-compatible), `>=X[.Y[.Z]]`, `X.Y.Z` exact, `X.Y` (= `X.Y.x`),
 * `X` (= `X.x.x`). Anything unparsable fails CLOSED (false).
 *
 * @param version - the provider's version.
 * @param range - the consumer's acceptable range.
 * @returns whether the version satisfies the range.
 */
export function versionSatisfies(version: string, range: string): boolean {
  if (typeof range !== "string" || range.trim() === "") {
    return false;
  }
  const cleaned = range.trim();
  if (cleaned === "*") {
    return true;
  }
  const [major, minor, patch] = parseVersion(version);
  if (cleaned.startsWith("^")) {
    const [rMajor, rMinor, rPatch] = parseVersion(cleaned.slice(1));
    if (major !== rMajor) {
      return false;
    }
    if (minor > rMinor) {
      return true;
    }
    if (minor < rMinor) {
      return false;
    }
    return patch >= rPatch;
  }
  if (cleaned.startsWith("~")) {
    const [rMajor, rMinor, rPatch] = parseVersion(cleaned.slice(1));
    return major === rMajor && minor === rMinor && patch >= rPatch;
  }
  if (cleaned.startsWith(">=")) {
    const [rMajor, rMinor, rPatch] = parseVersion(cleaned.slice(2));
    if (major !== rMajor) {
      return major > rMajor;
    }
    if (minor !== rMinor) {
      return minor > rMinor;
    }
    return patch >= rPatch;
  }
  const rawParts = cleaned.split(".");
  const [rMajor, rMinor, rPatch] = parseVersion(cleaned);
  if (rawParts.length >= 3) {
    return major === rMajor && minor === rMinor && patch === rPatch;
  }
  if (rawParts.length === 2) {
    return major === rMajor && minor === rMinor;
  }
  return major === rMajor;
}

/**
 * The hub. One instance per app; the composition root (App.ts) owns it.
 */
export class DataHub {
  private readonly providers = new Map<
    string,
    HubProvider & { query?: ProviderQuery }
  >();
  private readonly subscriptions = new Set<Subscription>();
  private readonly changeListeners = new Set<(change: HubChange) => void>();

  /**
   * Registers a HOST-side provider (project.digest, R10.2).
   *
   * @param provider - the provider record with its query implementation.
   */
  public registerHostProvider(
    provider: HubProvider & { readonly query: ProviderQuery },
  ): void {
    this.providers.set(provider.contractId, { ...provider });
    this.emitAvailability(provider.contractId);
  }

  /**
   * Registers a PLUGIN-side provider: the runtime hands over the
   * contract metadata + its bridged call closure.
   *
   * @param provider - the provider record.
   * @param query - the bridge call into the plugin sandbox.
   */
  public registerPluginProvider(
    provider: HubProvider,
    query: ProviderQuery,
  ): void {
    this.providers.set(provider.contractId, { ...provider, query });
    this.emitAvailability(provider.contractId);
  }

  /**
   * Removes every provider one owner registered (the plugin disable /
   * uninstall path — contracts resolve only from ENABLED plugins).
   *
   * @param providerId - the plugin id or `"host"`.
   */
  public unregisterOwner(providerId: string): void {
    const affected: string[] = [];
    for (const [contractId, provider] of this.providers) {
      if (provider.providerId === providerId) {
        affected.push(contractId);
      }
    }
    for (const contractId of affected) {
      this.providers.delete(contractId);
    }
  }

  /**
   * Queries a contract as one consumer (version-checked; graceful).
   *
   * @param consumerId - who asks (a plugin id, `"host"` or `"automations"`).
   * @param request - the contract + the consumer's acceptable range + the
   *        method + its parameters.
   * @returns the outcome (never throws for availability problems — a
   *          provider-side throw becomes `provider-error`).
   */
  public async query(
    consumerId: string,
    request: {
      readonly contractId: string;
      readonly versionRange: string;
      readonly method: string;
      readonly params?: unknown;
    },
  ): Promise<HubQueryOutcome> {
    void consumerId;
    const provider = this.providers.get(request.contractId);
    if (provider === undefined) {
      return {
        ok: false,
        reason: "no-provider",
        message: REASON_MESSAGES["no-provider"]!(request.contractId),
      };
    }
    if (!versionSatisfies(provider.version, request.versionRange)) {
      return {
        ok: false,
        reason: "version",
        message: REASON_MESSAGES["version"]!(request.contractId),
      };
    }
    if (request.method !== "*" && !provider.methods.includes(request.method)) {
      return {
        ok: false,
        reason: "method",
        message: REASON_MESSAGES["method"]!(request.contractId),
      };
    }
    if (provider.query === undefined) {
      return {
        ok: false,
        reason: "provider-error",
        message: REASON_MESSAGES["provider-error"]!(request.contractId),
      };
    }
    try {
      const result = await provider.query(request.method, request.params);
      return { ok: true, result };
    } catch {
      return {
        ok: false,
        reason: "provider-error",
        message: REASON_MESSAGES["provider-error"]!(request.contractId),
      };
    }
  }

  /**
   * Subscribes a consumer to a contract's change events. The record is
   * kept even when no compatible provider exists yet (late providers
   * start delivering); the returned status tells the consumer whether
   * the contract is available RIGHT NOW so it can show the Persian
   * notice (AC10.1/AC10.2).
   *
   * @param consumerId - the consumer id.
   * @param contractId - the contract to watch.
   * @param versionRange - the consumer's acceptable range.
   * @param listener - the change sink.
   * @returns availability status + the unsubscribe function.
   */
  public subscribe(
    consumerId: string,
    contractId: string,
    versionRange: string,
    listener: (change: unknown) => void,
  ): {
    readonly ok: boolean;
    readonly message: string | null;
    unsubscribe(): void;
  } {
    const subscription: Subscription = {
      consumerId,
      contractId,
      versionRange,
      listener,
    };
    this.subscriptions.add(subscription);
    const provider = this.providers.get(contractId);
    const ok =
      provider !== undefined &&
      versionSatisfies(provider.version, versionRange);
    return {
      ok,
      message:
        ok === false
          ? REASON_MESSAGES[
              provider === undefined ? "no-provider" : "version"
            ]!(contractId)
          : null,
      unsubscribe: () => {
        this.subscriptions.delete(subscription);
      },
    };
  }

  /**
   * Publishes a change as a contract's provider (validated: only the
   * owner may publish). Fans out to range-matching subscribers, the
   * host-side change listeners (the automations engine) and — via the
   * composition root's bridge — the app event bus.
   *
   * @param providerId - the publisher's id.
   * @param contractId - the contract.
   * @param change - the change payload (e.g. `{type: "task-completed", …}`).
   * @returns whether the publish was accepted.
   */
  public publish(
    providerId: string,
    contractId: string,
    change: unknown,
  ): boolean {
    const provider = this.providers.get(contractId);
    if (provider === undefined || provider.providerId !== providerId) {
      return false;
    }
    const record: HubChange = { contractId, providerId, change };
    for (const subscription of [...this.subscriptions]) {
      if (subscription.contractId !== contractId) {
        continue;
      }
      if (versionSatisfies(provider.version, subscription.versionRange)) {
        subscription.listener(change);
      }
    }
    for (const listener of [...this.changeListeners]) {
      listener(record);
    }
    return true;
  }

  /**
   * Host-side subscription to EVERY hub change (the automations engine
   * and the event-bus bridge use this).
   *
   * @param listener - the sink.
   * @returns an unsubscribe function.
   */
  public onAnyChange(listener: (change: HubChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  /**
   * @returns every registered contract (the rule-builder's dropdown).
   */
  public listContracts(): readonly HubProvider[] {
    return [...this.providers.values()].map((provider) => ({
      contractId: provider.contractId,
      version: provider.version,
      providerId: provider.providerId,
      methods: provider.methods,
    }));
  }

  /**
   * Whether one contract currently resolves for a range.
   *
   * @param contractId - the contract.
   * @param versionRange - the consumer's range.
   * @returns availability.
   */
  public isAvailable(contractId: string, versionRange: string): boolean {
    const provider = this.providers.get(contractId);
    return (
      provider !== undefined && versionSatisfies(provider.version, versionRange)
    );
  }

  /**
   * Notifies watchers that a contract's availability changed (providers
   * coming and going) — routed through the same fan-out so
   * availability-driven degradation can react (the engine's log and the
   * event-bus bridge observe it as `availability` changes).
   *
   * @param contractId - the contract whose availability changed.
   */
  private emitAvailability(contractId: string): void {
    const provider = this.providers.get(contractId);
    const record: HubChange = {
      contractId,
      providerId: provider?.providerId ?? "host",
      change: { type: "availability", available: provider !== undefined },
    };
    for (const listener of [...this.changeListeners]) {
      listener(record);
    }
  }
}
