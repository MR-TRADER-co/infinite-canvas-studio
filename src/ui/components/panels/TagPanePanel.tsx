"use client";

/**
 * The tag pane panel (Pack R11.4/AC11.5 — «برچسب‌ها»): every live tag of
 * the project — `#tag` tokens inside text objects PLUS the structured
 * `tags` property — as rows with live object counts, sorted by usage
 * (count desc, then Persian collation).
 *
 * Clicking a tag hands it to the Search panel as one structured filter
 * chip (the `ui:search-filter-tag` bus event) and opens that panel via
 * the UI store — the visual feedback is the chip appearing in the
 * search filter bar.
 */
import { useEffect, useState, type ReactElement } from "react";
import { Hash } from "lucide-react";
import { Application, Services } from "@/App";
import { AppContext } from "@/AppContext";
import { useTranslation } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import { useUiStore } from "@/ui/store/uiStore";

/** One display row of the tag pane (see {@link buildTagRows}). */
export interface TagRow {
  /** The normalised tag key. */
  readonly key: string;
  /** The display form (first spelling seen). */
  readonly display: string;
  /** Number of objects carrying the tag. */
  readonly count: number;
}

/**
 * PURE tag-row builder (node-testable, side-effect free): maps knowledge
 * tags to display rows, sorted by object count DESC, then display ASC
 * (Persian locale collation). Never mutates the input.
 *
 * @param tags - the live knowledge tags (`objectIds` = carrier ids).
 * @returns fresh sorted display rows.
 */
export function buildTagRows(
  tags: readonly {
    key: string;
    display: string;
    objectIds: readonly string[];
  }[],
): TagRow[] {
  return tags
    .map((tag) => ({
      key: tag.key,
      display: tag.display,
      count: tag.objectIds.length,
    }))
    .sort((a, b) =>
      a.count !== b.count
        ? b.count - a.count
        : a.display.localeCompare(b.display, "fa"),
    );
}

/**
 * @returns the tag-pane panel body.
 */
export default function TagPanePanelBody(): ReactElement {
  const { t, language } = useTranslation();
  const setPanelOpen = useUiStore((state) => state.setPanelOpen);
  const [rows, setRows] = useState<readonly TagRow[] | null>(null);

  // Boot → subscribe to the debounced knowledge rebuild → refresh rows
  // (setState only inside the boot/external-event callbacks — never the
  // effect body; `knowledge:changed` fires after every rebuild).
  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      const knowledge = context.get(Services.knowledge);
      const bus = context.get(Services.eventBus);
      const refresh = (): void => {
        setRows(buildTagRows(knowledge.allTags()));
      };
      refresh();
      unsubscribers.push(bus.on("knowledge:changed", refresh));
    });
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  /**
   * Applies one tag as a Search filter: opens the Search panel (uiStore)
   * and emits `ui:search-filter-tag`. The emit is deferred one task so
   * the freshly mounted Search panel body has subscribed by the time the
   * event fires (an already-open panel catches it either way).
   *
   * @param row - the clicked tag row.
   */
  const filterSearch = (row: TagRow): void => {
    setPanelOpen("core.panels.search", true);
    window.setTimeout(() => {
      AppContext.getDefault()
        .tryGet(Services.eventBus)
        ?.emit("ui:search-filter-tag", {
          tagKey: row.key,
          display: row.display,
        });
    }, 0);
  };

  return (
    <div className="space-y-1.5 p-2">
      <p
        className="flex items-center justify-between gap-2 text-[10px] leading-4 text-muted-foreground"
        role="status"
      >
        <span className="min-w-0 truncate">{t("tagPane.title")}</span>
        <span className="flex-none rounded-full border border-border/60 bg-accent/40 px-1.5 py-0.5 text-[9px] tabular-nums text-foreground/80">
          {formatInteger(rows?.length ?? 0, language)}
        </span>
      </p>
      {rows === null ? null : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 bg-background/50 px-2 py-3 text-center text-[10px] leading-4 text-muted-foreground">
          {t("tagPane.emptyHint")}
        </p>
      ) : (
        <ul
          className="max-h-96 space-y-1 overflow-y-auto panel-scroll"
          aria-label={t("tagPane.title")}
        >
          {rows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                title={t("tagPane.filterAction")}
                aria-label={
                  `${row.display} — ` +
                  t("tagPane.countLabel").replace(
                    "{count}",
                    formatInteger(row.count, language),
                  )
                }
                onClick={() => {
                  filterSearch(row);
                }}
                className="flex w-full items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-2 py-1 text-start transition-colors hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Hash
                  className="size-3 flex-none text-primary/70"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                  {row.display}
                </span>
                <span className="flex-none text-[10px] tabular-nums text-muted-foreground">
                  · {formatInteger(row.count, language)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
