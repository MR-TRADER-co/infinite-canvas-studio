"use client";

/**
 * Search panel body (R7.6): scene-wide search results, grouped by object,
 * registered as the `core.panels.search` dock panel.
 *
 * Extends Phase 3B's in-editor Find & Replace (which stays the in-text
 * tool) with a whole-canvas view: a query box + scope filter (text
 * content / object names), result groups carrying the object type icon +
 * RTL snippet, and result clicks flying the camera to the object
 * (300 ms eased flight) with a pulsing highlight ring.
 *
 * Pack R11.9: structured filter chips — tags (live from the knowledge
 * index) narrowing the results.
 *
 * Pack R12.7: the «کوئری ساخت‌یافته» section — the SAME QuerySpec
 * builder the live-query cards use (law §1.7.9): property filters with
 * the closed operator set, sortBy/groupBy/limit — running through the
 * shared `runSceneQuery` engine. With a text query or tag chips active
 * the structured rows INTERSECT the text results; alone, they render as
 * a grouped, sortable result list.
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Filter,
  Hash,
  Image as ImageIcon,
  Pen,
  Plus,
  Search,
  Shapes,
  SlidersHorizontal,
  Spline,
  Square,
  Squircle,
  StickyNote,
  Type,
  X,
  Circle,
  Diamond,
  Triangle,
  Star,
} from "lucide-react";
import { Application, Services } from "@/App";
import { AppContext } from "@/AppContext";
import type { Scene } from "@/core/model/Scene";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import {
  NO_SEARCH_FILTERS,
  searchScene,
  type PropertyFilterChip,
  type SceneSearchFilters,
  type SceneSearchGroup,
} from "@/core/search/SceneSearch";
import {
  MAX_QUERY_FILTERS,
  QUERY_LIMIT_DEFAULT,
  QUERY_OPERATORS,
  QUERY_PSEUDO_KIND,
  QUERY_PSEUDO_PROPS,
  QUERY_PSEUDO_TITLE,
  runSceneQuery,
  type QueryFilter,
  type QueryOperator,
  type SceneQueryResult,
} from "@/core/knowledge/QueryEngine";
import { useTranslation } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import { cn } from "@/lib/utils";

/** Search scope filter states. */
type ScopeFilter = "all" | "text" | "names";

/** Result row: one match inside one object. */
interface ResultRow {
  readonly groupId: string;
  readonly snippet: string;
  readonly matchText: string;
}

/** One editable spec-filter row (the builder's draft state). */
export interface SpecRowDraft {
  readonly prop: string;
  readonly op: QueryOperator;
  readonly value: string;
}

/** Shape-kind icons (the layers panel set). */
const SHAPE_ICONS: Record<string, LucideIcon> = {
  rectangle: Square,
  roundedRectangle: Squircle,
  ellipse: Circle,
  triangle: Triangle,
  diamond: Diamond,
  star: Star,
};

/** Kind icons for result rows. */
const KIND_ICONS: Record<string, LucideIcon> = {
  shape: Shapes,
  freehand: Pen,
  textBox: Type,
  stickyNote: StickyNote,
  image: ImageIcon,
  connector: Spline,
};

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
  "h-7 min-w-0 rounded border border-border/60 bg-background/70 px-1.5 text-[11px] " +
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
 * Normalises the builder's draft rows into engine filters — invalid
 * rows (empty prop/value) drop, the count caps at
 * {@link MAX_QUERY_FILTERS}. PURE (exported for tests).
 *
 * @param rows - the draft rows.
 * @returns the valid engine filters.
 */
export function specRowsToFilters(
  rows: readonly SpecRowDraft[],
): QueryFilter[] {
  const filters: QueryFilter[] = [];
  for (const row of rows) {
    if (
      row.prop === "" ||
      row.value === "" ||
      !QUERY_OPERATORS.includes(row.op)
    ) {
      continue;
    }
    filters.push({ prop: row.prop, op: row.op, value: row.value });
    if (filters.length >= MAX_QUERY_FILTERS) {
      break;
    }
  }
  return filters;
}

/**
 * Keeps only the search groups whose object passes the structured
 * query (the intersection path). PURE (exported for tests).
 *
 * @param groups - the text-search groups.
 * @param result - the structured engine result.
 * @returns the filtered groups (counts recomputed per group).
 */
export function filterGroupsBySpec(
  groups: readonly SceneSearchGroup[],
  result: SceneQueryResult,
): SceneSearchGroup[] {
  const allowed = new Set(result.rows.map((row) => row.objectId));
  return groups
    .filter((group) => allowed.has(group.object.id))
    .map((group) => ({ ...group }));
}

/**
 * @returns the search panel body.
 */
export default function SearchPanelBody(): ReactElement {
  const { t, language } = useTranslation();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [revision, setRevision] = useState(0);
  const [bus, setBus] = useState<EventBus<AppEventMap> | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [filters, setFilters] = useState<SceneSearchFilters>(NO_SEARCH_FILTERS);
  // Pack R12.7: the structured spec builder state.
  const [specOpen, setSpecOpen] = useState(false);
  const [specRows, setSpecRows] = useState<SpecRowDraft[]>([]);
  const [specSortBy, setSpecSortBy] = useState("");
  const [specSortDir, setSpecSortDir] = useState<"asc" | "desc">("asc");
  const [specGroupBy, setSpecGroupBy] = useState("");
  const [specLimit, setSpecLimit] = useState(QUERY_LIMIT_DEFAULT);

  // Subscribe to scene changes: the bump re-derives the results (setState
  // only inside the external-event callback — never the effect body).
  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    void Application.boot().then((context) => {
      if (cancelled) {
        return;
      }
      const liveScene = context.get(Services.scene);
      const liveBus = context.get(Services.eventBus);
      setScene(liveScene);
      setBus(liveBus);
      setRevision((value) => value + 1);
      unsubscribers.push(
        liveBus.on("scene:changed", () => {
          setRevision((value) => value + 1);
        }),
      );
      // Pack R11.9: the tag chips live-track the (debounced) knowledge
      // index; the property names track the schema store.
      unsubscribers.push(
        liveBus.on("knowledge:changed", () => {
          setRevision((value) => value + 1);
        }),
      );
      unsubscribers.push(
        liveBus.on("property-schema:changed", () => {
          setRevision((value) => value + 1);
        }),
      );
      // Pack R11.4/AC11.5: the tag pane hands a clicked tag over as one
      // filter chip (the pane itself opens this panel via the UI store,
      // so the chip's appearance is the visual feedback).
      unsubscribers.push(
        liveBus.on("ui:search-filter-tag", (payload) => {
          setFilters((current) =>
            current.tags.includes(payload.display)
              ? current
              : { ...current, tags: [...current.tags, payload.display] },
          );
        }),
      );
    });
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  // The structured spec (R12.7): valid rows only drive the engine.
  const specFilters = useMemo(
    () => specRowsToFilters(specRows),
    [specRows],
  );
  const specActive = specFilters.length > 0;

  // The structured engine result (null while the spec is inactive).
  const specResult = useMemo<SceneQueryResult | null>(() => {
    if (scene === null || !specActive) {
      return null;
    }
    const knowledge = AppContext.getDefault().tryGet(Services.knowledge);
    if (knowledge === undefined) {
      return null;
    }
    return runSceneQuery(scene, knowledge.current(), {
      filters: specFilters,
      limit: specLimit,
      sortBy:
        specSortBy === ""
          ? undefined
          : { prop: specSortBy, dir: specSortDir },
      groupBy: specGroupBy === "" ? undefined : specGroupBy,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, revision, specFilters, specSortBy, specSortDir, specGroupBy, specLimit]);

  // Results derive from the live scene + query/scope; `revision` bumps on
  // every scene mutation so the memo re-derives (the scene object itself
  // is mutated in place by commands). The structured rows INTERSECT the
  // text results (R12.7).
  const groups = useMemo<readonly SceneSearchGroup[]>(() => {
    if (scene === null) {
      return [];
    }
    const base = searchScene(scene.objects, {
      query,
      scope,
      filters,
    });
    if (!specActive || specResult === null) {
      return base;
    }
    return filterGroupsBySpec(base, specResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, query, scope, filters, revision, specFilters, specResult]);

  const totalMatches = useMemo(
    () => groups.reduce((sum, group) => sum + group.matches.length, 0),
    [groups],
  );

  /**
   * Flies the camera to a result object + pulses the highlight.
   *
   * @param objectId - the result object id.
   */
  const flyTo = (objectId: string): void => {
    bus?.emit("ui:fly-to-object", { objectId });
  };

  const activeCount = filters.tags.length;
  const textActive = query.trim() !== "" || activeCount > 0;
  // Pack R11.9/R12.7: the chip + option sources — every live tag
  // (knowledge index) and every known property name (schema store).
  const knownTags = useMemo<readonly { key: string; display: string }[]>(() => {
    if (scene === null) {
      return [];
    }
    const knowledge = AppContext.getDefault().tryGet(Services.knowledge);
    if (knowledge === undefined) {
      return [];
    }
    return knowledge
      .allTags()
      .map((tag) => ({ key: tag.key, display: tag.display }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, revision]);
  const knownProperties = useMemo<readonly string[]>(() => {
    if (scene === null) {
      return [];
    }
    const schema = AppContext.getDefault().tryGet(Services.propertySchema);
    return schema === undefined ? [] : schema.names();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, revision]);

  /** The property options (pseudo props first, then the schema names). */
  const propOptions: readonly string[] = [
    ...QUERY_PSEUDO_PROPS,
    ...knownProperties.filter((name) => !QUERY_PSEUDO_PROPS.includes(name)),
  ];

  /** The label of one prop option (pseudo props translate). */
  const propLabel = (prop: string): string =>
    prop === QUERY_PSEUDO_TITLE
      ? t("query.filter.pseudo.title")
      : prop === QUERY_PSEUDO_KIND
        ? t("query.filter.pseudo.kind")
        : prop;

  return (
    <div className="flex flex-col gap-2 p-2.5">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("search.panelPlaceholder")}
        aria-label={t("search.panelTitle")}
        dir="auto"
        className="w-full rounded-lg border border-border/60 bg-background/70 px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div
        role="radiogroup"
        aria-label={t("search.scopeLabel")}
        className="flex gap-1"
      >
        {(
          [
            ["all", t("search.scopeAll")],
            ["text", t("search.scopeText")],
            ["names", t("search.scopeNames")],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={scope === value}
            onClick={() => setScope(value)}
            className={cn(
              "flex-1 rounded-md px-1.5 py-1 text-[11px] transition-colors",
              scope === value
                ? "bg-primary/15 text-foreground"
                : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Pack R11.9: the tag chip bar (the TagPane hand-off receiver). */}
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          aria-expanded={specOpen}
          onClick={() => {
            setSpecOpen((open) => !open);
          }}
          title={t("search.specHint")}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-all",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            specActive || activeCount > 0
              ? "border-primary/50 bg-primary/15 text-foreground"
              : "border-border/60 bg-accent/30 text-muted-foreground hover:border-primary/40 hover:text-foreground",
          )}
        >
          <SlidersHorizontal className="size-2.5" aria-hidden="true" />
          {specActive
            ? t("search.specActive").replace(
                "{count}",
                formatInteger(specFilters.length, language),
              )
            : activeCount > 0
              ? t("search.filtersOn").replace(
                  "{count}",
                  formatInteger(activeCount, language),
                )
              : t("search.specTitle")}
        </button>
        {filters.tags.map((tag) => (
          <button
            key={`tag:${tag}`}
            type="button"
            title={t("search.filterClear")}
            onClick={() => {
              setFilters((current) => ({
                ...current,
                tags: current.tags.filter((item) => item !== tag),
              }));
            }}
            className="inline-flex items-center gap-0.5 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-700 transition-all hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-rose-300"
          >
            <Hash className="size-2.5" aria-hidden="true" />
            {tag}
            <X className="size-2.5 opacity-60" aria-hidden="true" />
          </button>
        ))}
      </div>

      {/* Pack R12.7: the structured spec builder (the shared engine). */}
      {specOpen ? (
        <div
          className={cn(
            "space-y-1.5 rounded-lg border border-border/60 bg-background/80 p-2",
            "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150",
          )}
        >
          <p className="flex items-center gap-1 text-[10px] leading-4 text-muted-foreground/80">
            <Search className="size-2.5 flex-none" aria-hidden="true" />
            {t("search.specHint")}
          </p>
          {specRows.length === 0 ? (
            <p className="px-1 text-[10px] leading-4 text-muted-foreground/70">
              {t("search.specEmpty")}
            </p>
          ) : (
            <div className="space-y-1">
              {specRows.map((row, index) => (
                <div key={index} className="flex items-center gap-1">
                  <select
                    value={row.prop}
                    onChange={(event) => {
                      setSpecRows((rows) =>
                        rows.map((item, i) =>
                          i === index
                            ? { ...item, prop: event.target.value }
                            : item,
                        ),
                      );
                    }}
                    aria-label={t("query.filter.prop")}
                    className={cn(FIELD, "w-20 flex-none cursor-pointer")}
                    dir="auto"
                  >
                    {propOptions.map((prop) => (
                      <option key={prop} value={prop}>
                        {propLabel(prop)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={row.op}
                    onChange={(event) => {
                      setSpecRows((rows) =>
                        rows.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                op: event.target.value as QueryOperator,
                              }
                            : item,
                        ),
                      );
                    }}
                    aria-label={t("query.filter.op")}
                    className={cn(FIELD, "w-24 flex-none cursor-pointer")}
                    dir="auto"
                  >
                    {QUERY_OPERATORS.map((op) => (
                      <option key={op} value={op}>
                        {t(
                          (OPERATOR_LABEL_KEYS[op] ?? "query.filter.op") as never,
                        )}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    dir="auto"
                    value={row.value}
                    maxLength={80}
                    placeholder={t("query.filter.value")}
                    aria-label={t("query.filter.value")}
                    onChange={(event) => {
                      setSpecRows((rows) =>
                        rows.map((item, i) =>
                          i === index
                            ? { ...item, value: event.target.value }
                            : item,
                        ),
                      );
                    }}
                    className={cn(FIELD, "min-w-0 flex-1")}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSpecRows((rows) =>
                        rows.filter((_, i) => i !== index),
                      );
                    }}
                    title={t("query.filter.remove")}
                    aria-label={t("query.filter.remove")}
                    className={ICON_BUTTON}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={specRows.length >= MAX_QUERY_FILTERS}
              onClick={() => {
                setSpecRows((rows) => [
                  ...rows,
                  {
                    prop: propOptions[0] ?? QUERY_PSEUDO_TITLE,
                    op: "contains",
                    value: "",
                  },
                ]);
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border border-primary/30",
                "bg-primary/10 px-2 py-1 text-[10px] font-medium text-foreground",
                "transition-all hover:border-primary/60 hover:bg-primary/20",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <Plus className="size-2.5" aria-hidden="true" />
              {t("query.filter.addFilter")}
            </button>
            <select
              value={specSortBy}
              onChange={(event) => {
                setSpecSortBy(event.target.value);
              }}
              aria-label={t("query.filter.sortBy")}
              className={cn(FIELD, "min-w-0 flex-1 cursor-pointer")}
              dir="auto"
            >
              <option value="">{t("query.filter.sortBy")} —</option>
              {propOptions.map((prop) => (
                <option key={prop} value={prop}>
                  {t("query.filter.sortBy")}: {propLabel(prop)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setSpecSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
              }}
              title={
                specSortDir === "asc"
                  ? t("query.filter.dir.asc")
                  : t("query.filter.dir.desc")
              }
              aria-label={
                specSortDir === "asc"
                  ? t("query.filter.dir.asc")
                  : t("query.filter.dir.desc")
              }
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded border border-border/60",
                "bg-background/70 text-muted-foreground transition-colors hover:text-foreground",
                "focus:outline-none focus:ring-1 focus:ring-primary/50",
              )}
            >
              {specSortDir === "asc" ? (
                <ArrowUpAZ className="size-3.5" aria-hidden="true" />
              ) : (
                <ArrowDownAZ className="size-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
          <div className="flex items-center gap-1">
            <select
              value={specGroupBy}
              onChange={(event) => {
                setSpecGroupBy(event.target.value);
              }}
              aria-label={t("query.filter.groupBy")}
              className={cn(FIELD, "min-w-0 flex-1 cursor-pointer")}
              dir="auto"
            >
              <option value="">{t("query.filter.groupBy")} —</option>
              {propOptions.map((prop) => (
                <option key={prop} value={prop}>
                  {t("query.filter.groupBy")}: {propLabel(prop)}
                </option>
              ))}
            </select>
            <label className="flex flex-none items-center gap-1 text-[10px] text-muted-foreground">
              {t("query.filter.limit")}
              <input
                type="number"
                min={1}
                max={200}
                value={specLimit}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  setSpecLimit(
                    Number.isFinite(parsed)
                      ? Math.min(200, Math.max(1, parsed))
                      : QUERY_LIMIT_DEFAULT,
                  );
                }}
                aria-label={t("query.filter.limit")}
                className={cn(FIELD, "w-14")}
              />
            </label>
          </div>
          {/* The tag adder (the chip bar's source inside the builder). */}
          {knownTags.length > 0 && (
            <div className="space-y-1 border-t border-border/50 pt-1.5">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                <Hash className="size-2.5" aria-hidden="true" />
                {t("search.filterTag")}
              </p>
              <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto panel-scroll">
                {knownTags.map((tag) => (
                  <button
                    key={tag.key}
                    type="button"
                    onClick={() => {
                      setFilters((current) =>
                        current.tags.includes(tag.display)
                          ? current
                          : {
                              ...current,
                              tags: [...current.tags, tag.display],
                            },
                      );
                    }}
                    className="inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-accent/40 px-1.5 py-0.5 text-[10px] text-foreground/90 transition-all hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <Hash
                      className="size-2.5 text-primary/70"
                      aria-hidden="true"
                    />
                    {tag.display}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {query.trim() === "" && activeCount === 0 && !specActive ? (
        <p className="px-2 py-4 text-center text-[11px] leading-5 text-muted-foreground/70">
          {t("search.panelHint")}
        </p>
      ) : textActive ? (
        groups.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] leading-5 text-muted-foreground/70">
            {t("find.noMatches")}
          </p>
        ) : (
          <div
            className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain"
            aria-label={t("search.resultsLabel")}
          >
            <p className="px-1 text-[10px] tabular-nums text-muted-foreground">
              {t("search.resultCount")
                .replace("{objects}", formatInteger(groups.length, language))
                .replace("{matches}", formatInteger(totalMatches, language))}
            </p>
            {groups.map((group) => (
              <SearchResultGroup
                key={group.object.id}
                group={group}
                onOpen={flyTo}
              />
            ))}
          </div>
        )
      ) : specResult !== null ? (
        <div
          className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain"
          aria-label={t("search.resultsLabel")}
        >
          <p className="flex items-center gap-1 px-1 text-[10px] tabular-nums text-muted-foreground">
            <Filter className="size-2.5" aria-hidden="true" />
            {t("search.specObjects").replace(
              "{count}",
              formatInteger(specResult.total, language),
            )}
            {specResult.total > specResult.rows.length
              ? ` · ${t("query.filter.capped")
                  .replace("{shown}", formatInteger(specResult.rows.length, language))
                  .replace("{total}", formatInteger(specResult.total, language))}`
              : ""}
          </p>
          {specResult.rows.length === 0 ? (
            <p className="px-2 py-4 text-center text-[11px] leading-5 text-muted-foreground/70">
              {t("find.noMatches")}
            </p>
          ) : (
            <SpecResultList
              result={specResult}
              groupBy={specGroupBy}
              onOpen={flyTo}
            />
          )}
        </div>
      ) : (
        <p className="px-2 py-4 text-center text-[11px] leading-5 text-muted-foreground/70">
          {t("find.noMatches")}
        </p>
      )}
    </div>
  );
}

/**
 * The structured-only result list (R12.7): rows grouped by the chosen
 * groupBy prop (group headers with counts), each row a fly-to button.
 *
 * @param props - the engine result + the groupBy prop + the open callback.
 * @returns the list element.
 */
function SpecResultList(props: {
  readonly result: SceneQueryResult;
  readonly groupBy: string;
  readonly onOpen: (objectId: string) => void;
}): ReactElement {
  const { result, onOpen } = props;
  const { t, language } = useTranslation();
  const buckets = new Map<
    string,
    (typeof result.rows)[number][]
  >();
  for (const row of result.rows) {
    const group = row.group ?? "";
    const list = buckets.get(group) ?? [];
    list.push(row);
    buckets.set(group, list);
  }
  const groups = [...buckets.entries()];
  return (
    <div className="space-y-1.5">
      {groups.map(([group, rows]) => (
        <div
          key={group}
          className="rounded-lg border border-border/40 bg-background/40"
        >
          <div className="flex items-center gap-1.5 px-2 py-1">
            <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-muted-foreground">
              {group === ""
                ? t("query.label.ungrouped")
                : group}
            </span>
            <span className="flex-none text-[10px] tabular-nums text-muted-foreground/70">
              {formatInteger(rows.length, language)}
            </span>
          </div>
          <ul className="px-1 pb-1">
            {rows.map((row) => (
              <li key={row.objectId}>
                <button
                  type="button"
                  onClick={() => onOpen(row.objectId)}
                  dir="auto"
                  className={ROW_BUTTON}
                >
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  {row.sortValue !== undefined && row.sortValue !== "" ? (
                    <span className="flex-none rounded bg-accent/50 px-1 text-[9px] tabular-nums text-muted-foreground">
                      {row.sortValue}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * One object's result group: header (type icon + label + count) and the
 * match rows.
 *
 * @param props - the group + open callback.
 * @returns the group element.
 */
function SearchResultGroup(props: {
  readonly group: SceneSearchGroup;
  readonly onOpen: (objectId: string) => void;
}): ReactElement {
  const { group, onOpen } = props;
  const { t, language } = useTranslation();
  const object = group.object;
  const Icon =
    object.kind === "shape" && "shapeKind" in object
      ? (SHAPE_ICONS[String(object.shapeKind)] ?? Shapes)
      : (KIND_ICONS[object.kind] ?? Shapes);
  const label =
    group.label ??
    t(`object.${object.kind === "shape" ? "shape" : object.kind}` as never);
  return (
    <div className="rounded-lg border border-border/40 bg-background/40">
      <button
        type="button"
        onClick={() => onOpen(object.id)}
        className="flex w-full items-center gap-2 rounded-t-lg px-2 py-1.5 text-start transition-colors hover:bg-accent/50"
      >
        <Icon
          className="size-3.5 flex-none text-muted-foreground"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
          {label}
        </span>
        <span className="flex-none text-[10px] tabular-nums text-muted-foreground">
          {formatInteger(group.matches.length, language)}
        </span>
      </button>
      <ul className="px-1 pb-1">
        {group.matches.slice(0, 20).map((match, index) => (
          <li key={index}>
            <button
              type="button"
              onClick={() => onOpen(object.id)}
              dir="auto"
              className="w-full truncate rounded-md px-2 py-1 text-start text-[11px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              {match.snippet}
            </button>
          </li>
        ))}
        {group.matches.length > 20 ? (
          <li className="px-2 py-0.5 text-[10px] text-muted-foreground/60">
            {t("search.moreMatches").replace(
              "{count}",
              formatInteger(group.matches.length - 20, language),
            )}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** Exported for the pulse overlay's use — the search result row shape. */
export type { ResultRow, PropertyFilterChip };
