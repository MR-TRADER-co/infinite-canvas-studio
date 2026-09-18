/**
 * The host-side automation trigger engine (R10.7).
 *
 * One engine instance subscribes to the ALLOWLISTED app events +
 * every hub change (mapped to `datahub:changed:<contractId>` trigger
 * ids) and fires matching rules:
 * - a rule's optional `changeType` filters on the change payload's
 *   `type` field (the AC10.4 rule: planner.tasks + `task-completed`);
 * - a COMMAND action dispatches through the command dispatcher — the
 *   SAME path the keyboard/palette use, so undoable commands stay
 *   undoable;
 * - a DATAHUB action queries the target contract as the consumer
 *   `"automations"` (writes only make sense on provider contracts
 *   exposing mutation methods — e.g. calendar.events `addEvent`); param
 *   values equal to {@link TODAY_MARKER} resolve to today's Jalali
 *   date at fire time (the sample rule books the event on the
 *   completion day);
 * - EVERY firing is logged (rule, labels, outcome) into the store and
 *   announced on the app bus (`automation:fired`) so the panel and the
 *   log view refresh live.
 *
 * Layering: plain TypeScript — no React imports.
 */
import type { AppEventMap } from "@/core/events/EventBus";
import type { EventBus } from "@/core/events/EventBus";
import { dateToJalali } from "@/core/utils/jalali";
import type { DataHub } from "@/datahub/DataHub";
import {
  RuleStore,
  TODAY_MARKER,
  type AutomationAction,
  type AutomationLogEntry,
  type AutomationRule,
  type TriggerEventId,
} from "@/datahub/automations/rules";

/** The command dispatcher surface (App.ts injects it). */
export interface AutomationDispatcher {
  dispatch(commandId: string, context: unknown): void;
}

/** The engine's constructor wiring. */
export interface RuleEngineServices {
  readonly hub: DataHub;
  readonly bus: EventBus<AppEventMap>;
  readonly dispatcher: AutomationDispatcher;
  readonly store: RuleStore;
  /** The command id the dispatch context expects (App.ts supplies it). */
  readonly commandContext: () => unknown;
  /** Diagnostics sink. */
  readonly logger: Pick<Console, "warn" | "error" | "info">;
}

/** The app events the engine watches (mapped to trigger ids). */
const WATCHED_APP_EVENTS: readonly (keyof AppEventMap)[] = [
  "plugins:changed",
  "persistence:saved",
  "app:started",
  // Pack-14 R14.5: knowledge.onLinkCreated — the registry's mutation
  // diff event (payload carries `.type` = link-created/link-removed).
  "object:linking-changed",
];

/**
 * Resolves {@link TODAY_MARKER} param values into today's Jalali date
 * (recursively — objects and arrays included). Static JSON stays
 * untouched, so a saved rule keeps working across days.
 *
 * @param value - one param sub-value.
 * @returns the resolved copy (structural clone only where needed).
 */
function resolveTodayMarkers(value: unknown): unknown {
  if (value === TODAY_MARKER) {
    const { jy, jm, jd } = dateToJalali(new Date());
    return { jy, jm, jd };
  }
  if (Array.isArray(value)) {
    return value.map(resolveTodayMarkers);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = resolveTodayMarkers(inner);
    }
    return out;
  }
  return value;
}

/**
 * The engine.
 */
export class RuleEngine {
  private readonly services: RuleEngineServices;
  private started = false;
  private readonly unsubscribers: (() => void)[] = [];

  /**
   * @param services - the wiring (hub, bus, dispatcher, store, logger).
   */
  public constructor(services: RuleEngineServices) {
    this.services = services;
  }

  /**
   * Subscribes to every watched event (idempotent — the panel may call
   * it after boot).
   */
  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    for (const event of WATCHED_APP_EVENTS) {
      const unsubscribe = this.services.bus.on(event, (payload) => {
        this.handleEvent(event as TriggerEventId, payload);
      });
      this.unsubscribers.push(unsubscribe as unknown as () => void);
    }
    const unsubscribeHub = this.services.hub.onAnyChange((change) => {
      this.handleEvent(
        `datahub:changed:${change.contractId}` as TriggerEventId,
        change.change,
      );
    });
    this.unsubscribers.push(unsubscribeHub);
  }

  /**
   * Shuts the engine down (app teardown).
   */
  public stop(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
    this.started = false;
  }

  /**
   * @returns the store (the panel's surface).
   */
  public get rules(): RuleStore {
    return this.services.store;
  }

  /**
   * Evaluates every enabled rule against one incoming event.
   *
   * @param event - the trigger id (allowlisted app event or hub change).
   * @param payload - the event payload (change filters read `.type`).
   */
  private handleEvent(event: TriggerEventId, payload: unknown): void {
    for (const rule of this.services.store.listRules()) {
      if (!rule.enabled || rule.trigger.event !== event) {
        continue;
      }
      if (
        rule.trigger.changeType !== undefined &&
        rule.trigger.changeType !== ""
      ) {
        const changeType = (payload as { type?: unknown } | null)?.type;
        if (changeType !== rule.trigger.changeType) {
          continue;
        }
      }
      void this.fire(rule);
    }
  }

  /**
   * Fires one rule: run the action, log the outcome, announce it.
   *
   * @param rule - the rule.
   */
  private async fire(rule: AutomationRule): Promise<void> {
    const triggerLabel = this.describeTrigger(rule);
    const actionLabel = this.describeAction(rule.action);
    let ok = true;
    let detail: string | null = null;
    try {
      if (rule.action.kind === "command") {
        this.services.dispatcher.dispatch(
          rule.action.commandId,
          this.services.commandContext(),
        );
        detail = rule.action.commandId;
      } else {
        const outcome = await this.services.hub.query("automations", {
          contractId: rule.action.contractId,
          versionRange: "*",
          method: rule.action.method,
          params: resolveTodayMarkers(rule.action.params) as Record<
            string,
            unknown
          >,
        });
        ok = outcome.ok;
        detail = outcome.ok
          ? `${rule.action.contractId}.${rule.action.method}`
          : outcome.message;
      }
    } catch (error) {
      ok = false;
      detail = error instanceof Error ? error.message : String(error);
    }
    const entry: AutomationLogEntry = {
      at: Date.now(),
      ruleId: rule.id,
      triggerLabel,
      actionLabel,
      ok,
      detail,
    };
    this.services.store.appendLog(entry);
    this.services.bus.emit("automation:fired", {
      ruleId: rule.id,
      ok,
      detail: entry.detail ?? undefined,
    });
    if (!ok) {
      this.services.logger.warn(
        `[automations] rule "${rule.id}" failed: ${detail ?? "?"}`,
      );
    }
  }

  /**
   * @param rule - the rule.
   * @returns a Persian trigger description (the log + panel rows).
   */
  private describeTrigger(rule: AutomationRule): string {
    const contract = rule.trigger.event.startsWith("datahub:changed:")
      ? rule.trigger.event.slice("datahub:changed:".length)
      : null;
    if (contract !== null) {
      return rule.trigger.changeType
        ? `تغییر «${contract}» از نوع «${rule.trigger.changeType}»`
        : `هر تغییر «${contract}»`;
    }
    return rule.trigger.event;
  }

  /**
   * @param action - the action.
   * @returns a Persian action description.
   */
  private describeAction(action: AutomationAction): string {
    if (action.kind === "command") {
      return `اجرای فرمان «${action.commandId}»`;
    }
    return `نوشتن در دادگان «${action.contractId}» (${action.method})`;
  }
}
