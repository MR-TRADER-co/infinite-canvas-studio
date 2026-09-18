"use client";

/**
 * The inspector's live-query section (R15.2 + R12.2): the editing
 * surface of a selected query card — pick the query kind, and for the
 * four knowledge kinds type the target (with the project's
 * titles/tags as datalist suggestions); for the STRUCTURED FILTER kind
 * (the pack's Phase-12 QuerySpec) edit the whole spec as a form —
 * property filters (prop/op/value rows), tag sets, text, links,
 * object-kind chips, sort/group/limit and the results table's ≤ 3
 * property columns. Never free text (law §1.7.9).
 *
 * Every spec edit lands as ONE UpdateObjectCommand (one undo step);
 * the rows re-resolve on every `knowledge:changed` — the card on the
 * canvas mirrors the same live result.
 */
import { useEffect, useState, type ReactElement } from "react";
import {
  Search,
  ArrowUpLeft,
  Plus,
  X,
  ArrowDownAZ,
  ArrowUpAZ,
  SlidersHorizontal,
} from "lucide-react";
import { Application, Services } from "@/App";
import { AppContext } from "@/AppContext";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import {
  QUERY_TYPES,
  isQueryObject,
  structuredSpecOf,
  QUERY_COLUMNS_MAX,
  type QueryType,
} from "@/core/model/QueryObject";
import { runKnowledgeQuery } from "@/core/knowledge/KnowledgeQueries";
import {
  MAX_QUERY_FILTERS,
  QUERY_LIMIT_DEFAULT,
  QUERY_LIMIT_MAX,
  QUERY_OPERATORS,
  QUERY_PSEUDO_KIND,
  QUERY_PSEUDO_PROPS,
  QUERY_PSEUDO_TITLE,
  normalizeSceneQuerySpec,
  queryColumnValue,
  runSceneQuery,
  type QueryFilter,
  type SceneQuerySpec,
} from "@/core/knowledge/QueryEngine";
import { splitTagList } from "@/core/model/Properties";
import { useTranslation } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import type { InspectorSectionProps } from "@/ui/registry/InspectorSectionRegistry";

/** The query-kind option metadata (label keys, datalist source). */
const TYPE_OPTIONS: ReadonlyArray<{
  readonly value: QueryType;
  readonly labelKey: string;
  readonly needsTarget: boolean;
}> = [
  { value: "backlinks", labelKey: "query.type.backlinks", needsTarget: true },
  { value: "tag", labelKey: "query.type.tag", needsTarget: true },
  { value: "broken", labelKey: "query.type.broken", needsTarget: false },
  { value: "orphans", labelKey: "query.type.orphans", needsTarget: false },
  { value: "filter", labelKey: "query.type.filter", needsTarget: false },
];

/** The filterable object kinds (chips; internal ids → label keys). */
const KIND_OPTIONS: ReadonlyArray<{
  readonly id: string;
  readonly labelKey: string;
}> = [
  { id: "stickyNote", labelKey: "object.stickyNote" },
  { id: "textBox", labelKey: "object.textBox" },
  { id: "shape", labelKey: "tool.shape" },
  { id: "connector", labelKey: "object.connector" },
  { id: "freehand", labelKey: "object.freehand" },
  { id: "image", labelKey: "object.image" },
  { id: "frame", labelKey: "object.frame" },
  { id: "sticker", labelKey: "object.sticker" },
  { id: "table", labelKey: "tool.table" },
];

/** The operator chips (fa label keys of the closed §1.7.9 set). */
const OPERATOR_LABEL_KEYS: Readonly<Record<string, string>> = {
  eq: "query.filter.op.eq",
  ne: "query.filter.op.ne",
  gt: "query.filter.op.gt",
  lt: "query.filter.op.lt",
  contains: "query.filter.op.contains",
  startsWith: "query.filter.op.startsWith",
};

/** Shared classes of the compact selects/inputs (the dense form rows). */
const FIELD =
  "h-7 rounded border border-border/60 bg-background/70 px-1.5 text-[11px] " +
  "text-foreground transition-colors focus:outline-none focus:ring-1 " +
  "focus:ring-primary/50 disabled:opacity-50";

/** Shared classes of the tiny icon buttons. */
const ICON_BUTTON =
  "grid size-6 shrink-0 place-items-center rounded text-muted-foreground/80 " +
  "transition-colors hover:bg-destructive/10 hover:text-destructive " +
  "focus:outline-none focus:ring-1 focus:ring-destructive/50 disabled:opacity-40";

/** The results-row classes (fly-to buttons). */
const ROW_BUTTON =
  "flex w-full items-center gap-1 rounded px-1 py-0.5 text-start text-[11px] " +
  "text-foreground transition-colors hover:bg-primary/10 focus:outline-none " +
  "focus:ring-1 focus:ring-primary/50";

/**
 * The inspector section body (registered as `core.inspector.query`).
 *
 * @param props - the inspector section props (the live selection).
 * @returns the section, or null when the selection is not a query card.
 */
export default function QuerySection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects } = props;
  const { t, language } = useTranslation();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // Re-render on knowledge rebuilds (the rows are live).
    let stopKnowledge: (() => void) | null = null;
    void Application.boot().then((context: AppContext) => {
      stopKnowledge = context
        .get(Services.eventBus)
        .on("knowledge:changed", () => setTick((value) => value + 1));
    });
    return () => {
      stopKnowledge?.();
    };
  }, []);

  const single = objects.length === 1 ? (objects[0] ?? null) : null;
  if (single === null || !isQueryObject(single)) {
    return null;
  }
  const locked = single.locked;
  const context = AppContext.getDefault();
  const knowledge = context.tryGet(Services.knowledge);
  const scene = context.tryGet(Services.scene);
  const history = context.tryGet(Services.history);
  const selection = context.tryGet(Services.selection);
  const schema = context.tryGet(Services.propertySchema);
  const bus = context.tryGet(Services.eventBus);
  if (
    knowledge === undefined ||
    scene === undefined ||
    history === undefined ||
    selection === undefined ||
    bus === undefined
  ) {
    return null;
  }
  void tick; // (the knowledge:changed subscription drives re-renders)

  /**
   * Commits one query-spec change (one undo step).
   *
   * @param patch - the fields to change.
   */
  const commit = (patch: {
    queryType?: QueryType;
    queryTarget?: string;
    querySpec?: SceneQuerySpec;
    columns?: readonly string[];
  }): void => {
    if (locked) {
      return;
    }
    const command = new UpdateObjectCommand(scene, single.id, patch, single);
    command.do();
    history.push(command);
    setTick((value) => value + 1);
  };

  /**
   * Flies to an object, selects it and pulses the highlight.
   *
   * @param objectId - the destination object id.
   */
  const goTo = (objectId: string): void => {
    selection.replaceAll([objectId]);
    bus.emit("ui:fly-to-object", { objectId });
  };

  const isFilter = single.queryType === "filter";
  const index = knowledge.current();

  // ——— the structured-filter editor (R12.2) ————————————————
  const spec = structuredSpecOf(single);
  /** Commits the next whole spec (one undo step). */
  const commitSpec = (next: SceneQuerySpec): void => {
    commit({ querySpec: next });
  };
  /** The property names known to the project + the pseudo props. */
  const propOptions: readonly string[] = schema
    ? [
        ...QUERY_PSEUDO_PROPS,
        ...schema.names().filter((name) => !QUERY_PSEUDO_PROPS.includes(name)),
      ]
    : [...QUERY_PSEUDO_PROPS];

  /** The label of one prop option (pseudo props translate). */
  const propLabel = (prop: string): string =>
    prop === QUERY_PSEUDO_TITLE
      ? t("query.filter.pseudo.title")
      : prop === QUERY_PSEUDO_KIND
        ? t("query.filter.pseudo.kind")
        : prop;

  /**
   * Updates one filter of the spec (index-addressed, one undo step).
   *
   * @param i - the filter's index.
   * @param patch - the fields to change.
   */
  const patchFilter = (
    i: number,
    patch: Partial<QueryFilter>,
  ): void => {
    const filters = spec.filters.map((filter, filterIndex) =>
      filterIndex === i ? { ...filter, ...patch } : filter,
    );
    commitSpec({ ...spec, filters });
  };

  /**
   * Parses the tag inputs (comma lists → clean arrays).
   *
   * @param raw - the raw input.
   * @returns the tag array ("" entries dropped).
   */
  const parseTags = (raw: string): readonly string[] =>
    splitTagList(raw).filter((tag) => tag.length > 0);

  const filterResult = isFilter
    ? runSceneQuery(scene, index, spec, [single.id])
    : null;
  const columns: readonly string[] = isFilter
    ? (single.columns ?? [])
    : [];
  /** The indices whose row is the FIRST of its group (header rows). */
  const groupHeaderAt = new Set<number>();
  if (filterResult !== null && spec.groupBy !== undefined) {
    let previous: string | null = null;
    filterResult.rows.forEach((row, i) => {
      const key = row.group ?? "";
      if (key !== previous) {
        groupHeaderAt.add(i);
        previous = key;
      }
    });
  }

  const legacySpec = { type: single.queryType, target: single.queryTarget };
  const result = runKnowledgeQuery(knowledge.current(), legacySpec);
  const needsTarget =
    single.queryType === "backlinks" || single.queryType === "tag";
  // Datalist suggestions: the project's titles (backlinks) or tags.
  const suggestions = single.queryType === "tag"
    ? knowledge
        .allTags()
        .map((tag) => ({ key: tag.key, display: tag.display }))
    : [...knowledge.current().titles.values()].map((title) => ({
        key: title.display,
        display: title.display,
      }));

  return (
    <section aria-label={t("query.sectionTitle")} className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        <Search className="size-3" aria-hidden="true" />
        {t("query.sectionTitle")}
      </h4>

      <label className="flex items-center gap-1.5 text-[11px]">
        <span className="w-14 shrink-0 text-muted-foreground">
          {t("query.type")}
        </span>
        <select
          value={single.queryType}
          disabled={locked}
          onChange={(event) => {
            const next = event.target.value as QueryType;
            if (QUERY_TYPES.includes(next)) {
              commit({
                queryType: next,
                queryTarget:
                  next === "broken" || next === "orphans" || next === "filter"
                    ? ""
                    : single.queryTarget,
                ...(next === "filter"
                  ? {
                      querySpec: normalizeSceneQuerySpec({
                        filters: [],
                        limit: QUERY_LIMIT_DEFAULT,
                      }) ?? undefined,
                      columns: [],
                    }
                  : {}),
              });
            }
          }}
          className={`h-7 flex-1 rounded border border-border/60 bg-background/70 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 ${
            isFilter ? "border-primary/40 bg-primary/5" : ""
          }`}
        >
          {TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </label>

      {isFilter ? (
        <div className="space-y-2.5 rounded-lg border border-border/50 bg-muted/20 p-2">
          <p className="flex items-start gap-1 text-[9px] leading-4 text-muted-foreground/80">
            <SlidersHorizontal className="mt-0.5 size-2.5 flex-none text-primary/70" aria-hidden="true" />
            {t("query.filter.specHint")}
          </p>

          {/* ——— property filters ——— */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground">
              {t("query.filter.filters")}
              <span className="ms-1 text-[9px] text-muted-foreground/60">
                ({formatInteger(spec.filters.length, language)}/
                {formatInteger(MAX_QUERY_FILTERS, language)})
              </span>
            </p>
            {spec.filters.map((filter, i) => (
              <div
                key={`filter-${i}`}
                className="flex items-center gap-1"
              >
                <select
                  value={filter.prop}
                  disabled={locked}
                  onChange={(event) => {
                    patchFilter(i, { prop: event.target.value });
                  }}
                  className={`${FIELD} w-[72px] flex-1`}
                  aria-label={t("query.filter.prop")}
                >
                  {!propOptions.includes(filter.prop) && (
                    <option value={filter.prop}>{filter.prop}</option>
                  )}
                  {propOptions.map((prop) => (
                    <option key={prop} value={prop}>
                      {propLabel(prop)}
                    </option>
                  ))}
                </select>
                <select
                  value={filter.op}
                  disabled={locked}
                  onChange={(event) => {
                    patchFilter(i, {
                      op: event.target.value as QueryFilter["op"],
                    });
                  }}
                  className={`${FIELD} w-16 flex-none`}
                  aria-label={t("query.filter.op")}
                >
                  {QUERY_OPERATORS.map((op) => (
                    <option key={op} value={op}>
                      {t(OPERATOR_LABEL_KEYS[op] ?? op)}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  dir="rtl"
                  value={filter.value}
                  disabled={locked}
                  placeholder={t("query.filter.value")}
                  onChange={(event) => {
                    patchFilter(i, { value: event.target.value });
                  }}
                  className={`${FIELD} min-w-0 flex-1`}
                  aria-label={`${t("query.filter.value")} — ${propLabel(filter.prop)}`}
                />
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    commitSpec({
                      ...spec,
                      filters: spec.filters.filter(
                        (_, filterIndex) => filterIndex !== i,
                      ),
                    });
                  }}
                  title={t("query.filter.remove")}
                  aria-label={t("query.filter.remove")}
                  className={ICON_BUTTON}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={locked || spec.filters.length >= MAX_QUERY_FILTERS}
              onClick={() => {
                commitSpec({
                  ...spec,
                  filters: [
                    ...spec.filters,
                    {
                      prop: QUERY_PSEUDO_TITLE,
                      op: "contains",
                      value: "",
                    },
                  ],
                });
              }}
              className="flex h-6 w-full items-center justify-center gap-1 rounded border border-dashed border-border/70 text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-40"
            >
              <Plus className="size-2.5" aria-hidden="true" />
              {t("query.filter.addFilter")}
            </button>
          </div>

          {/* ——— tags / text / links ——— */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px]">
              <span className="w-14 shrink-0 text-muted-foreground">
                {t("query.filter.tagsAll")}
              </span>
              <input
                type="text"
                dir="rtl"
                list="query-tags-suggestions"
                value={spec.tagsAll?.join("، ") ?? ""}
                disabled={locked}
                placeholder={t("query.filter.tagsPlaceholder")}
                onChange={(event) => {
                  commitSpec({
                    ...spec,
                    tagsAll: parseTags(event.target.value),
                  });
                }}
                className={`${FIELD} min-w-0 flex-1`}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px]">
              <span className="w-14 shrink-0 text-muted-foreground">
                {t("query.filter.tagsAny")}
              </span>
              <input
                type="text"
                dir="rtl"
                list="query-tags-suggestions"
                value={spec.tagsAny?.join("، ") ?? ""}
                disabled={locked}
                placeholder={t("query.filter.tagsPlaceholder")}
                onChange={(event) => {
                  commitSpec({
                    ...spec,
                    tagsAny: parseTags(event.target.value),
                  });
                }}
                className={`${FIELD} min-w-0 flex-1`}
              />
            </label>
            <datalist id="query-tags-suggestions">
              {knowledge
                .allTags()
                .slice(0, 40)
                .map((tag) => (
                  <option key={tag.key} value={tag.display} />
                ))}
            </datalist>
            <label className="flex items-center gap-1.5 text-[11px]">
              <span className="w-14 shrink-0 text-muted-foreground">
                {t("query.filter.text")}
              </span>
              <input
                type="text"
                dir="rtl"
                value={spec.text ?? ""}
                disabled={locked}
                onChange={(event) => {
                  commitSpec({
                    ...spec,
                    text: event.target.value,
                  });
                }}
                className={`${FIELD} min-w-0 flex-1`}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px]">
              <span className="w-14 shrink-0 text-muted-foreground">
                {t("query.filter.linksTo")}
              </span>
              <input
                type="text"
                dir="rtl"
                list="query-titles-suggestions"
                value={spec.linksTo ?? ""}
                disabled={locked}
                onChange={(event) => {
                  commitSpec({
                    ...spec,
                    linksTo: event.target.value,
                  });
                }}
                className={`${FIELD} min-w-0 flex-1`}
              />
            </label>
            <datalist id="query-titles-suggestions">
              {[...index.titles.values()].slice(0, 40).map((title) => (
                <option key={title.key} value={title.display} />
              ))}
            </datalist>
          </div>

          {/* ——— object kinds (chips) ——— */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground">
              {t("query.filter.kinds")}
              <span className="ms-1 text-[9px] text-muted-foreground/60">
                ({spec.kinds === undefined || spec.kinds.length === 0
                  ? t("query.filter.none")
                  : formatInteger(spec.kinds.length, language)})
              </span>
            </p>
            <div className="flex flex-wrap gap-1" role="group" aria-label={t("query.filter.kinds")}>
              {KIND_OPTIONS.map((kind) => {
                const active = spec.kinds?.includes(kind.id) ?? false;
                return (
                  <button
                    key={kind.id}
                    type="button"
                    disabled={locked}
                    aria-pressed={active}
                    onClick={() => {
                      const next = active
                        ? (spec.kinds ?? []).filter((id) => id !== kind.id)
                        : [...(spec.kinds ?? []), kind.id];
                      commitSpec({
                        ...spec,
                        kinds: next.length === 0 ? undefined : next,
                      });
                    }}
                    className={`rounded-full border px-1.5 py-0.5 text-[9px] transition-colors focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 ${
                      active
                        ? "border-primary/60 bg-primary/15 font-medium text-foreground"
                        : "border-border/60 bg-background/60 text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
                    }`}
                  >
                    {t(kind.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ——— sort / group / limit ——— */}
          <div className="grid grid-cols-2 items-end gap-1.5">
            <label className="col-span-2 flex items-center gap-1.5 text-[11px]">
              <span className="w-14 shrink-0 text-muted-foreground">
                {t("query.filter.sortBy")}
              </span>
              <select
                value={spec.sortBy?.prop ?? ""}
                disabled={locked}
                onChange={(event) => {
                  const prop = event.target.value;
                  commitSpec({
                    ...spec,
                    sortBy:
                      prop === ""
                        ? undefined
                        : { prop, dir: spec.sortBy?.dir ?? "asc" },
                  });
                }}
                className={`${FIELD} min-w-0 flex-1`}
              >
                <option value="">{t("query.filter.none")}</option>
                {propOptions.map((prop) => (
                  <option key={prop} value={prop}>
                    {propLabel(prop)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={locked || spec.sortBy === undefined}
                onClick={() => {
                  if (spec.sortBy === undefined) {
                    return;
                  }
                  commitSpec({
                    ...spec,
                    sortBy: {
                      ...spec.sortBy,
                      dir: spec.sortBy.dir === "asc" ? "desc" : "asc",
                    },
                  });
                }}
                title={
                  spec.sortBy?.dir === "desc"
                    ? t("query.filter.dir.desc")
                    : t("query.filter.dir.asc")
                }
                aria-label={
                  spec.sortBy?.dir === "desc"
                    ? t("query.filter.dir.desc")
                    : t("query.filter.dir.asc")
                }
                className="grid size-7 shrink-0 place-items-center rounded border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-40"
              >
                {spec.sortBy?.dir === "desc" ? (
                  <ArrowDownAZ className="size-3.5" aria-hidden="true" />
                ) : (
                  <ArrowUpAZ className="size-3.5" aria-hidden="true" />
                )}
              </button>
            </label>
            <label className="flex items-center gap-1.5 text-[11px]">
              <span className="shrink-0 text-muted-foreground">
                {t("query.filter.groupBy")}
              </span>
              <select
                value={spec.groupBy ?? ""}
                disabled={locked}
                onChange={(event) => {
                  const prop = event.target.value;
                  commitSpec({
                    ...spec,
                    groupBy: prop === "" ? undefined : prop,
                  });
                }}
                className={`${FIELD} min-w-0 flex-1`}
              >
                <option value="">{t("query.filter.none")}</option>
                {propOptions.map((prop) => (
                  <option key={prop} value={prop}>
                    {propLabel(prop)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[11px]">
              <span className="shrink-0 text-muted-foreground">
                {t("query.filter.limit")}
              </span>
              <input
                type="number"
                min={1}
                max={QUERY_LIMIT_MAX}
                value={spec.limit}
                disabled={locked}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  commitSpec({
                    ...spec,
                    limit: Number.isFinite(parsed)
                      ? Math.min(Math.max(Math.round(parsed), 1), QUERY_LIMIT_MAX)
                      : spec.limit,
                  });
                }}
                className={`${FIELD} min-w-0 flex-1`}
              />
            </label>
          </div>

          {/* ——— table columns (≤ 3) ——— */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground">
              {t("query.filter.columns")}
              <span className="ms-1 text-[9px] text-muted-foreground/60">
                ({formatInteger(columns.length, language)}/
                {formatInteger(QUERY_COLUMNS_MAX, language)})
              </span>
            </p>
            <div className="flex items-center gap-1">
              {Array.from({ length: QUERY_COLUMNS_MAX }).map((_, i) => {
                const value = columns[i] ?? "";
                return (
                  <select
                    key={`column-${i}`}
                    value={value}
                    disabled={locked}
                    onChange={(event) => {
                      const next = [...columns];
                      const prop = event.target.value;
                      if (prop === "") {
                        next.splice(i, 1);
                      } else {
                        next[i] = prop;
                      }
                      commit({
                        columns: next.filter(
                          (column) => column !== "" && column !== undefined,
                        ),
                      });
                    }}
                    className={`${FIELD} min-w-0 flex-1`}
                    aria-label={`${t("query.filter.columns")} ${formatInteger(i + 1, language)}`}
                  >
                    <option value="">{t("query.filter.none")}</option>
                    {propOptions
                      .filter(
                        (prop) =>
                          prop === value ||
                          !columns.includes(prop),
                      )
                      .map((prop) => (
                        <option key={prop} value={prop}>
                          {propLabel(prop)}
                        </option>
                      ))}
                  </select>
                );
              })}
            </div>
          </div>

          {/* ——— the live results table ——— */}
          <div className="space-y-1 border-t border-border/40 pt-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t("query.results")}
              <span className="ms-1 text-[10px] text-muted-foreground/70">
                ({formatInteger(filterResult?.total ?? 0, language)})
              </span>
              {filterResult !== null && filterResult.groups.length > 0 && (
                <span className="ms-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary/90">
                  {t("query.filter.groupsCount").replace(
                    "{count}",
                    formatInteger(filterResult.groups.length, language),
                  )}
                </span>
              )}
            </p>
            {filterResult !== null && filterResult.rows.length === 0 && (
              <p className="text-[10px] text-muted-foreground/70">
                {t("query.empty")}
              </p>
            )}
            {filterResult !== null &&
              filterResult.total > filterResult.rows.length && (
                <p className="rounded border border-dashed border-border/60 bg-muted/30 px-1.5 py-0.5 text-[9px] text-muted-foreground/80">
                  {t("query.filter.capped")
                    .replace(
                      "{shown}",
                      formatInteger(filterResult.rows.length, language),
                    )
                    .replace(
                      "{total}",
                      formatInteger(filterResult.total, language),
                    )}
                </p>
              )}
            <ul className="max-h-52 space-y-0.5 overflow-y-auto panel-scroll pe-1">
              {filterResult?.rows.map((row, rowIndex) => {
                const object = scene.findById(row.objectId);
                const groupCount = groupHeaderAt.has(rowIndex)
                  ? (filterResult.groups.find(
                      (group) => group.value === (row.group ?? ""),
                    )?.count ?? 0)
                  : 0;
                return (
                  <li key={row.objectId}>
                    {groupHeaderAt.has(rowIndex) && (
                      <p className="mt-1 flex items-center gap-1 border-b border-border/40 pb-0.5 text-[9px] font-semibold text-muted-foreground/80">
                        {row.group === ""
                          ? t("query.filter.groupNone")
                          : row.group}
                        <span className="text-muted-foreground/50">
                          · {formatInteger(groupCount, language)}
                        </span>
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => goTo(row.objectId)}
                      title={t("knowledge.goTo")}
                      className={ROW_BUTTON}
                    >
                      <ArrowUpLeft
                        className="size-3 flex-none text-primary/70"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {row.title === ""
                          ? t("knowledge.unknownSource")
                          : row.title}
                      </span>
                      {columns.map((column) => (
                        <span
                          key={column}
                          className="max-w-14 flex-none truncate text-[9px] text-muted-foreground/75"
                          dir="rtl"
                        >
                          {object === undefined
                            ? ""
                            : queryColumnValue(object, index, column)}
                        </span>
                      ))}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : (
        <>
          {needsTarget && (
            <label className="flex items-center gap-1.5 text-[11px]">
              <span className="w-14 shrink-0 text-muted-foreground">
                {t("query.target")}
              </span>
              <input
                type="text"
                dir="rtl"
                list="query-target-suggestions"
                value={single.queryTarget}
                disabled={locked}
                placeholder={t("query.targetPlaceholder")}
                onChange={(event) => {
                  commit({ queryTarget: event.target.value });
                }}
                className="h-7 flex-1 rounded border border-border/60 bg-background/70 px-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
              />
              <datalist id="query-target-suggestions">
                {suggestions.slice(0, 40).map((item) => (
                  <option key={item.key} value={item.display} />
                ))}
              </datalist>
            </label>
          )}

          <p className="text-[10px] leading-4 text-muted-foreground/80">
            {t("query.liveHint")}
          </p>

          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t("query.results")}
              <span className="ms-1 text-[10px] text-muted-foreground/70">
                ({formatInteger(result.total, language)})
              </span>
            </p>
            {result.missingTarget && (
              <p className="rounded border border-dashed border-destructive/50 bg-destructive/5 px-1.5 py-1 text-[10px] leading-4 text-destructive/90">
                {t("query.missingTarget")}
              </p>
            )}
            {!result.missingTarget && result.rows.length === 0 && (
              <p className="text-[10px] text-muted-foreground/70">
                {t("query.empty")}
              </p>
            )}
            <ul className="max-h-40 space-y-0.5 overflow-y-auto panel-scroll pe-1">
              {result.rows.slice(0, 50).map((row) => (
                <li key={`${row.objectId ?? "ghost"}:${row.title}:${row.detail ?? ""}`}>
                  <button
                    type="button"
                    disabled={row.objectId === null}
                    onClick={() => {
                      if (row.objectId !== null) {
                        goTo(row.objectId);
                      }
                    }}
                    title={t("knowledge.goTo")}
                    className={`${ROW_BUTTON} disabled:opacity-60`}
                  >
                    <ArrowUpLeft className="size-3 flex-none text-primary/70" aria-hidden="true" />
                    <span className="truncate">
                      {row.title === "" ? t("knowledge.unknownSource") : row.title}
                    </span>
                    {row.detail !== undefined && (
                      <span className="ms-auto flex-none truncate text-[9px] text-muted-foreground/70">
                        → {row.detail}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
