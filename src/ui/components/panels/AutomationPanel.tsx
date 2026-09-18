"use client";

/**
 * Automations panel body (R10.7): the RTL rule-builder «وقتی ... آنگاه ...»
 * registered as the «اتوماسیون» dock panel.
 *
 * Surfaces:
 * - the rule list (enabled toggle, Persian trigger/action summary, delete);
 * - the add-rule builder: trigger select (allowlist, Persian labels) +
 *   optional change-type filter + action (command from the registry OR
 *   a datahub contract write with method + JSON params);
 * - the one-click sample rule (AC10.4: task completed → calendar event);
 * - the firing log (every firing timestamped + success/error).
 *
 * The panel reads the engine + hub + command registry through the app
 * context and refreshes on `automation:fired` / `datahub:changed`.
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { CircleCheck, CircleX, Sparkles, Trash2, Zap } from "lucide-react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type { RuleEngine } from "@/datahub/automations/RuleEngine";
import {
  TRIGGER_EVENTS,
  CHANGE_TYPE_FILTERS,
  SAMPLE_RULE_ACTION,
  type AutomationAction,
  type AutomationLogEntry,
  type AutomationRule,
  type TriggerEventId,
} from "@/datahub/automations/rules";
import type { DataHub } from "@/datahub/DataHub";
import { useTranslation } from "@/ui/i18n";
import { cn } from "@/lib/utils";

/** Shared control classes (the panel conventions). */
const CONTROL =
  "w-full rounded-lg border border-border/60 bg-background/70 px-2.5 py-1.5 " +
  "text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
const BUTTON_PRIMARY =
  "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground " +
  "transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
const BUTTON_QUIET =
  "rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors " +
  "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring";

/** Form state of the builder. */
interface BuilderState {
  trigger: TriggerEventId;
  changeType: string;
  actionKind: "command" | "datahub";
  commandId: string;
  contractId: string;
  method: string;
  paramsJson: string;
}

/** The AC10.4 sample rule factory (shared action — see rules.ts). */
function sampleRule(): AutomationRule {
  return {
    id: `rule:${Date.now()}`,
    enabled: true,
    createdAt: Date.now(),
    trigger: {
      event: "datahub:changed:planner.tasks",
      changeType: "task-completed",
    },
    action: SAMPLE_RULE_ACTION,
  };
}

/**
 * @returns the panel element.
 */
export default function AutomationPanelBody(): ReactElement {
  const { t } = useTranslation();
  const [rules, setRules] = useState<readonly AutomationRule[]>([]);
  const [log, setLog] = useState<readonly AutomationLogEntry[]>([]);
  const [commands, setCommands] = useState<
    readonly { id: string; titleKey: string }[]
  >([]);
  const [contracts, setContracts] = useState<
    readonly {
      contractId: string;
      version: string;
      methods: readonly string[];
    }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [builder, setBuilder] = useState<BuilderState>({
    trigger: "datahub:changed:planner.tasks",
    changeType: "task-completed",
    actionKind: "datahub",
    commandId: "",
    contractId: SAMPLE_RULE_ACTION.contractId,
    method: SAMPLE_RULE_ACTION.method,
    paramsJson: JSON.stringify(SAMPLE_RULE_ACTION.params),
  });

  /** Resolves the engine (null before boot). */
  const engineOf = (): RuleEngine | undefined =>
    AppContext.getDefault().tryGet(Services.automations);

  const refresh = (): void => {
    const engine = engineOf();
    if (engine === undefined) {
      return;
    }
    setRules(engine.rules.listRules());
    setLog(engine.rules.listLog());
    const registry = AppContext.getDefault().tryGet(Services.commands);
    if (registry !== undefined) {
      setCommands(
        registry.list().map((entry) => ({
          id: entry.id,
          titleKey: entry.titleKey,
        })),
      );
    }
    const hub = AppContext.getDefault().tryGet(Services.dataHub) as
      DataHub | undefined;
    if (hub !== undefined) {
      setContracts(
        hub.listContracts().map((provider) => ({
          contractId: provider.contractId,
          version: provider.version,
          methods: provider.methods,
        })),
      );
    }
  };

  // Boot + live refresh.
  useEffect(() => {
    let cancelled = false;
    void Application.boot().then(() => {
      if (cancelled) {
        return;
      }
      refresh();
      const bus = AppContext.getDefault().tryGet(Services.eventBus);
      const unsubscribe = bus?.on("automation:fired", () => {
        queueMicrotask(refresh);
      });
      const unsubscribeHub = bus?.on("datahub:changed", () => {
        queueMicrotask(refresh);
      });
      return () => {
        unsubscribe?.();
        unsubscribeHub?.();
      };
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Persists a rule through the engine's store. */
  const saveRule = (rule: AutomationRule): void => {
    engineOf()?.rules.saveRule(rule);
    refresh();
  };

  /** Builds a rule from the builder form. */
  const addRule = (): void => {
    setError(null);
    const action: AutomationAction =
      builder.actionKind === "command"
        ? { kind: "command", commandId: builder.commandId }
        : {
            kind: "datahub",
            contractId: builder.contractId,
            method: builder.method,
            params: parseParams(builder.paramsJson, setError),
          };
    if (builder.actionKind === "command" && builder.commandId === "") {
      setError(t("automations.error.noCommand"));
      return;
    }
    if (builder.actionKind === "datahub" && builder.method === "") {
      setError(t("automations.error.noMethod"));
      return;
    }
    if (builder.actionKind === "datahub" && action.kind === "datahub") {
      const contract = contracts.find(
        (candidate) => candidate.contractId === builder.contractId,
      );
      if (
        contract !== undefined &&
        !contract.methods.includes(builder.method)
      ) {
        setError(t("automations.error.badMethod"));
        return;
      }
    }
    saveRule({
      id: `rule:${Date.now()}`,
      enabled: true,
      createdAt: Date.now(),
      trigger: {
        event: builder.trigger,
        ...(builder.changeType !== ""
          ? { changeType: builder.changeType }
          : {}),
      },
      action,
    });
  };

  const isDatahubTrigger = builder.trigger.startsWith("datahub:changed:");
  const actionContract = useMemo(
    () => contracts.find((c) => c.contractId === builder.contractId),
    [contracts, builder.contractId],
  );

  return (
    <div className="flex flex-col gap-3 p-3 text-xs" dir="rtl">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <Zap className="size-3.5 text-amber-400" aria-hidden="true" />
        {t("automations.header")}
      </p>

      {/* Rules list */}
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold">{t("automations.rules")}</h3>
        {rules.length === 0 ? (
          <p className="rounded-lg border border-border/50 bg-background/50 p-2.5 text-[11px] leading-5 text-muted-foreground">
            {t("automations.empty")}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="rounded-lg border border-border/50 bg-background/50 p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="leading-5">
                    <span className="text-muted-foreground">
                      {t("automations.when")}{" "}
                    </span>
                    {describeTriggerLabel(rule, t)}
                    <span className="text-muted-foreground">
                      {" "}
                      {t("automations.then")}{" "}
                    </span>
                    {describeActionLabel(rule)}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.enabled}
                      aria-label={t("automations.enabled")}
                      className={cn(
                        "relative h-4 w-8 rounded-full transition-colors",
                        rule.enabled ? "bg-primary" : "bg-muted",
                      )}
                      onClick={() => {
                        engineOf()?.rules.setEnabled(rule.id, !rule.enabled);
                        refresh();
                      }}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 size-3 rounded-full bg-background transition-all",
                          rule.enabled ? "start-4" : "start-0.5",
                        )}
                      />
                    </button>
                    <button
                      type="button"
                      className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title={t("automations.delete")}
                      aria-label={t("automations.delete")}
                      onClick={() => {
                        engineOf()?.rules.removeRule(rule.id);
                        refresh();
                      }}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Builder */}
      <section className="space-y-2 rounded-lg border border-border/50 bg-background/40 p-2.5">
        <h3 className="text-[11px] font-semibold">{t("automations.add")}</h3>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] font-medium text-primary">
            {t("automations.when")}
          </span>
          <select
            className={CONTROL}
            value={builder.trigger}
            onChange={(event) => {
              const trigger = event.target.value as TriggerEventId;
              setBuilder((state) => ({
                ...state,
                trigger,
                changeType: trigger.startsWith("datahub:changed:")
                  ? state.changeType
                  : "",
              }));
            }}
          >
            {TRIGGER_EVENTS.map((event) => (
              <option key={event} value={event}>
                {triggerLabel(event, t)}
              </option>
            ))}
          </select>
        </div>
        {isDatahubTrigger ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t("automations.filter")}
            </span>
            <select
              className={CONTROL}
              value={builder.changeType}
              onChange={(event) => {
                setBuilder((state) => ({
                  ...state,
                  changeType: event.target.value,
                }));
              }}
            >
              {CHANGE_TYPE_FILTERS.map((type) => (
                <option key={type} value={type}>
                  {type === "" ? t("automations.anyChange") : type}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] font-medium text-primary">
            {t("automations.then")}
          </span>
          <select
            className={CONTROL}
            value={builder.actionKind}
            onChange={(event) => {
              setBuilder((state) => ({
                ...state,
                actionKind: event.target.value as "command" | "datahub",
              }));
            }}
          >
            <option value="command">{t("automations.action.command")}</option>
            <option value="datahub">{t("automations.action.datahub")}</option>
          </select>
        </div>
        {builder.actionKind === "command" ? (
          <select
            className={CONTROL}
            value={builder.commandId}
            onChange={(event) => {
              setBuilder((state) => ({
                ...state,
                commandId: event.target.value,
              }));
            }}
          >
            <option value="">{t("automations.pickCommand")}</option>
            {commands.map((command) => (
              <option key={command.id} value={command.id}>
                {command.id}
              </option>
            ))}
          </select>
        ) : (
          <div className="space-y-2">
            <select
              className={CONTROL}
              value={builder.contractId}
              onChange={(event) => {
                setBuilder((state) => ({
                  ...state,
                  contractId: event.target.value,
                  method: "",
                }));
              }}
            >
              <option value="">{t("automations.pickContract")}</option>
              {contracts.map((contract) => (
                <option key={contract.contractId} value={contract.contractId}>
                  {contract.contractId} (v{contract.version})
                </option>
              ))}
            </select>
            <select
              className={CONTROL}
              value={builder.method}
              onChange={(event) => {
                setBuilder((state) => ({
                  ...state,
                  method: event.target.value,
                }));
              }}
            >
              <option value="">{t("automations.pickMethod")}</option>
              {(actionContract?.methods ?? []).map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
            <textarea
              className={cn(CONTROL, "h-16 resize-none font-mono text-[10px]")}
              dir="ltr"
              value={builder.paramsJson}
              onChange={(event) => {
                setBuilder((state) => ({
                  ...state,
                  paramsJson: event.target.value,
                }));
              }}
              aria-label={t("automations.params")}
            />
          </div>
        )}
        {error !== null ? (
          <p className="text-[11px] leading-5 text-destructive">{error}</p>
        ) : null}
        <div className="flex items-center gap-2">
          <button type="button" className={BUTTON_PRIMARY} onClick={addRule}>
            {t("automations.addRule")}
          </button>
          <button
            type="button"
            className={cn(BUTTON_QUIET, "flex items-center gap-1")}
            onClick={() => saveRule(sampleRule())}
          >
            <Sparkles className="size-3.5 text-amber-400" aria-hidden="true" />
            {t("automations.sampleRule")}
          </button>
        </div>
      </section>

      {/* Firing log */}
      <section className="space-y-1.5">
        <h3 className="text-[11px] font-semibold">{t("automations.log")}</h3>
        {log.length === 0 ? (
          <p className="rounded-lg border border-border/50 bg-background/50 p-2.5 text-[11px] text-muted-foreground">
            {t("automations.logEmpty")}
          </p>
        ) : (
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {log.map((entry, index) => (
              <li
                key={`${entry.at}-${index}`}
                className="flex items-start gap-1.5 rounded-lg border border-border/40 bg-background/40 p-2 leading-5"
              >
                {entry.ok ? (
                  <CircleCheck
                    className="mt-0.5 size-3.5 shrink-0 text-emerald-400"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleX
                    className="mt-0.5 size-3.5 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                )}
                <span className="text-[10px] text-muted-foreground" dir="ltr">
                  {new Date(entry.at).toLocaleTimeString("fa-IR")}
                </span>
                <span className="text-[10px]">
                  {entry.triggerLabel} → {entry.actionLabel}
                  {entry.detail !== null ? ` · ${entry.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Parses + validates the params JSON (fail-closed with a Persian error).
 *
 * @param json - the raw textarea content.
 * @param fail - the error sink.
 * @returns the parsed object ({} on failure).
 */
function parseParams(
  json: string,
  fail: (message: string) => void,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      fail("پارامترها باید یک شیء JSON باشد.");
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    fail("JSON پارامترها معتبر نیست.");
    return {};
  }
}

/**
 * @param event - the trigger event id.
 * @param t - the translator.
 * @returns the Persian trigger label.
 */
function triggerLabel(
  event: TriggerEventId,
  t: (key: string) => string,
): string {
  const key = `automations.trigger.${event.replace(/[:.]/g, "_")}`;
  const label = t(key);
  return label === key ? event : label;
}

/**
 * @param rule - the rule.
 * @param t - the translator.
 * @returns the Persian trigger description (list rows).
 */
function describeTriggerLabel(
  rule: AutomationRule,
  t: (key: string) => string,
): string {
  const base = triggerLabel(rule.trigger.event, t);
  return rule.trigger.changeType
    ? `${base} (${rule.trigger.changeType})`
    : base;
}

/**
 * @param rule - the rule.
 * @returns the action description (list rows).
 */
function describeActionLabel(rule: AutomationRule): string {
  return rule.action.kind === "command"
    ? rule.action.commandId
    : `${rule.action.contractId}.${rule.action.method}`;
}
