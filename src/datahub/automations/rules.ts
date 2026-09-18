/**
 * Automation rules (R10.7): `{trigger, action, enabled}` triples the
 * host-side engine evaluates. Types + the localStorage-backed store
 * live here; the engine (RuleEngine.ts) owns the firing semantics.
 *
 * The trigger is an ALLOWLISTED app event (plus an optional change-type
 * filter for datahub changes — the AC10.4 rule is
 * `datahub:changed:planner.tasks` filtered to `task-completed`).
 * The action either invokes a REGISTERED command (routed through the
 * dispatcher, so it stays undoable where applicable) or writes to a
 * datahub contract.
 *
 * Layering: plain TypeScript — no React imports.
 */

/** Every trigger event id the engine accepts (the allowlist). */
export type TriggerEventId =
  | "datahub:changed:planner.tasks"
  | "datahub:changed:calendar.events"
  | "datahub:changed:project.digest"
  | "datahub:changed:scene.query"
  | "datahub:changed:dailynotes.entries"
  | "object:linking-changed"
  | "plugins:changed"
  | "persistence:saved"
  | "app:started";

/** The allowlist itself (the rule-builder's trigger dropdown). */
export const TRIGGER_EVENTS: readonly TriggerEventId[] = [
  "datahub:changed:planner.tasks",
  "datahub:changed:calendar.events",
  "datahub:changed:project.digest",
  "datahub:changed:scene.query",
  "datahub:changed:dailynotes.entries",
  "object:linking-changed",
  "plugins:changed",
  "persistence:saved",
  "app:started",
];

/** Change-type filter options for datahub triggers (Persian-labelled in i18n). */
export const CHANGE_TYPE_FILTERS: readonly string[] = [
  "",
  "task-completed",
  "task-added",
  "task-updated",
  "event-added",
  "event-updated",
  "entry-created",
  "link-created",
  "link-removed",
];

/** A command action: dispatch through the command layer (undoable). */
export interface CommandAction {
  readonly kind: "command";
  readonly commandId: string;
}

/** A datahub write action: query a contract as the engine. */
export interface DatahubAction {
  readonly kind: "datahub";
  readonly contractId: string;
  readonly method: string;
  readonly params: Record<string, unknown>;
}

/** Either action shape. */
export type AutomationAction = CommandAction | DatahubAction;

/**
 * The sample rule's "today" param marker: the engine replaces it (at
 * FIRE time, not save time) with today's Jalali date `{jy, jm, jd}` —
 * a completed task always books its event on the completion day.
 */
export const TODAY_MARKER = "__today__";

/**
 * The AC10.4 sample action (the panel's one-click rule): write a
 * calendar event through the REAL contract method (`addEvent` — the
 * one public/plugins-firstparty/calendar serves) with the today-marker.
 */
export const SAMPLE_RULE_ACTION: DatahubAction = {
  kind: "datahub",
  contractId: "calendar.events",
  method: "addEvent",
  params: { title: "✅ کار انجام شد", date: TODAY_MARKER },
};

/** One automation rule. */
export interface AutomationRule {
  readonly id: string;
  /** When FALSE the engine skips it (the panel's toggle). */
  enabled: boolean;
  readonly createdAt: number;
  readonly trigger: {
    readonly event: TriggerEventId;
    /** Optional filter on the datahub change payload's `type` field. */
    readonly changeType?: string;
  };
  readonly action: AutomationAction;
}

/** One firing log entry (every firing is logged, R10.7). */
export interface AutomationLogEntry {
  readonly at: number;
  readonly ruleId: string;
  readonly triggerLabel: string;
  readonly actionLabel: string;
  readonly ok: boolean;
  readonly detail: string | null;
}

/** The log cap (kept in memory + persisted tail). */
export const AUTOMATION_LOG_CAP = 120;

/** localStorage slot keys (fail-closed store). */
const RULES_SLOT = "ics.automations.rules";
const LOG_SLOT = "ics.automations.log";

/** A Storage-like shim (localStorage in the app, a map in tests). */
export type RuleStorageShim = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

/** localStorage guarded against unavailability (SSR / disabled). */
export function safeRuleStorage(): RuleStorageShim | null {
  if (typeof window !== "undefined" && window.localStorage !== undefined) {
    return window.localStorage;
  }
  return null;
}

/**
 * Parses + validates one raw rule record (fail-closed: a malformed
 * record is dropped, never crashes the boot).
 *
 * @param raw - the parsed JSON value.
 * @returns the rule, or null when malformed.
 */
export function parseRule(raw: unknown): AutomationRule | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = record.id;
  const trigger = record.trigger;
  const action = record.action;
  if (
    typeof id !== "string" ||
    typeof trigger !== "object" ||
    trigger === null ||
    typeof action !== "object" ||
    action === null
  ) {
    return null;
  }
  const triggerRecord = trigger as Record<string, unknown>;
  if (
    typeof triggerRecord.event !== "string" ||
    !TRIGGER_EVENTS.includes(triggerRecord.event as TriggerEventId)
  ) {
    return null;
  }
  const actionRecord = action as Record<string, unknown>;
  if (
    actionRecord.kind === "command" &&
    typeof actionRecord.commandId === "string"
  ) {
    return {
      id,
      enabled: record.enabled !== false,
      createdAt:
        typeof record.createdAt === "number" ? record.createdAt : Date.now(),
      trigger: {
        event: triggerRecord.event as TriggerEventId,
        ...(typeof triggerRecord.changeType === "string" &&
        triggerRecord.changeType !== ""
          ? { changeType: triggerRecord.changeType }
          : {}),
      },
      action: { kind: "command", commandId: actionRecord.commandId },
    };
  }
  if (
    actionRecord.kind === "datahub" &&
    typeof actionRecord.contractId === "string" &&
    typeof actionRecord.method === "string" &&
    typeof actionRecord.params === "object" &&
    actionRecord.params !== null
  ) {
    return {
      id,
      enabled: record.enabled !== false,
      createdAt:
        typeof record.createdAt === "number" ? record.createdAt : Date.now(),
      trigger: {
        event: triggerRecord.event as TriggerEventId,
        ...(typeof triggerRecord.changeType === "string" &&
        triggerRecord.changeType !== ""
          ? { changeType: triggerRecord.changeType }
          : {}),
      },
      action: {
        kind: "datahub",
        contractId: actionRecord.contractId,
        method: actionRecord.method,
        params: actionRecord.params as Record<string, unknown>,
      },
    };
  }
  return null;
}

/**
 * The persisted automation state: rules + the firing log tail.
 */
export class RuleStore {
  private rules: readonly AutomationRule[] = [];
  private log: readonly AutomationLogEntry[] = [];
  private readonly storage: RuleStorageShim | null;

  /**
   * @param storage - the persistence shim (tests inject a memory map).
   */
  public constructor(storage: RuleStorageShim | null = safeRuleStorage()) {
    this.storage = storage;
    this.load();
  }

  /**
   * @returns every rule (engine + panel).
   */
  public listRules(): readonly AutomationRule[] {
    return this.rules;
  }

  /**
   * @returns the firing log (latest first).
   */
  public listLog(): readonly AutomationLogEntry[] {
    return this.log;
  }

  /**
   * Adds or replaces one rule (persisted).
   *
   * @param rule - the rule.
   */
  public saveRule(rule: AutomationRule): void {
    const index = this.rules.findIndex((candidate) => candidate.id === rule.id);
    this.rules =
      index === -1
        ? [...this.rules, rule]
        : this.rules.map((candidate) =>
            candidate.id === rule.id ? rule : candidate,
          );
    this.persistRules();
  }

  /**
   * Removes one rule.
   *
   * @param id - the rule id.
   */
  public removeRule(id: string): void {
    this.rules = this.rules.filter((rule) => rule.id !== id);
    this.persistRules();
  }

  /**
   * Sets one rule's enabled flag.
   *
   * @param id - the rule id.
   * @param enabled - the new flag.
   */
  public setEnabled(id: string, enabled: boolean): void {
    this.rules = this.rules.map((rule) =>
      rule.id === id ? { ...rule, enabled } : rule,
    );
    this.persistRules();
  }

  /**
   * Appends one firing entry (capped, persisted tail).
   *
   * @param entry - the log entry.
   */
  public appendLog(entry: AutomationLogEntry): void {
    this.log = [entry, ...this.log].slice(0, AUTOMATION_LOG_CAP);
    this.persistLog();
  }

  /**
   * Loads the persisted state (fail-closed: corrupt JSON → empty).
   */
  private load(): void {
    if (this.storage === null) {
      return;
    }
    try {
      const rawRules = this.storage.getItem(RULES_SLOT);
      if (rawRules !== null) {
        const parsed = JSON.parse(rawRules) as unknown;
        if (Array.isArray(parsed)) {
          this.rules = parsed
            .map(parseRule)
            .filter((rule): rule is AutomationRule => rule !== null);
        }
      }
      const rawLog = this.storage.getItem(LOG_SLOT);
      if (rawLog !== null) {
        const parsed = JSON.parse(rawLog) as unknown;
        if (Array.isArray(parsed)) {
          this.log = parsed
            .filter(
              (entry): entry is AutomationLogEntry =>
                typeof entry === "object" &&
                entry !== null &&
                typeof (entry as Record<string, unknown>).ruleId === "string",
            )
            .slice(0, AUTOMATION_LOG_CAP);
        }
      }
    } catch {
      // Corrupt state: start empty (fail-closed, never crash).
      this.rules = [];
      this.log = [];
    }
  }

  /**
   * Persists the rules.
   */
  private persistRules(): void {
    if (this.storage === null) {
      return;
    }
    try {
      this.storage.setItem(RULES_SLOT, JSON.stringify(this.rules));
    } catch {
      // Quota/unavailable: in-memory only.
    }
  }

  /**
   * Persists the log tail.
   */
  private persistLog(): void {
    if (this.storage === null) {
      return;
    }
    try {
      this.storage.setItem(LOG_SLOT, JSON.stringify(this.log));
    } catch {
      // Quota/unavailable: in-memory only.
    }
  }
}

/** A Storage-like memory shim (tests). */
export function memoryRuleStorage(): RuleStorageShim {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}
