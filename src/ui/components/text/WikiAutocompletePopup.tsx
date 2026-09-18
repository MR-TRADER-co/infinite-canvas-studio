"use client";

/**
 * The wiki-link autocomplete popup (Knowledge Pack R11.5): while the
 * caret sits inside an open `[[query` span of EITHER text-editing
 * surface (the legacy sticky contenteditable session or the shared
 * TipTap `.ProseMirror` editor), this floating surface lists the
 * project's titles, ranked for the typed query, plus a "create new"
 * row for unknown titles. Selecting a row completes the span into a
 * real `[[title]]` wiki link — the knowledge index then resolves it.
 *
 * Implementation notes:
 * - One DOCUMENT-level listener set drives both editors (both are
 *   contenteditable roots): `selectionchange` re-probes the caret after
 *   every keystroke; the title list is snapshotted from the knowledge
 *   service AT PROBE TIME (no subscription — while one session edits,
 *   titles only change through another editor, which ends it).
 * - Keyboard handling runs in the CAPTURE phase BEFORE the editors see
 *   the keys: the first Esc closes the popup; the next one exits the
 *   session (the Obsidian rule).
 * - Positioning is imperative (useLayoutEffect measures and translates
 *   the container before paint) — no state, no flicker.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FileText, Link2, Plus } from "lucide-react";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import {
  detectOpenWikiQuery,
  rankWikiSuggestions,
  shouldOfferCreateNew,
} from "@/text/editor/wikiAutocomplete";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";

/** The editing surfaces the popup serves. */
const EDITING_SELECTOR = ".text-object-editing, .ProseMirror";

/** One caret probe: coordinates, query and the title snapshot. */
interface PopupState {
  /** Viewport-x of the caret (the popup's left anchor). */
  readonly x: number;
  /** Viewport-y just below the caret (the popup's top anchor). */
  readonly y: number;
  /** Viewport-y of the caret's top edge (for the flip-up fallback). */
  readonly topY: number;
  /** The typed query between `[[` and the caret. */
  readonly query: string;
  /** The project's title display forms, snapshotted at probe time. */
  readonly titles: readonly string[];
}

export default function WikiAutocompletePopup(): ReactNode {
  const { t } = useTranslation();
  const language = useUiStore((state) => state.language);
  const [state, setState] = useState<PopupState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastQueryRef = useRef<string | null>(null);

  /** The ranked suggestion rows for the current query. */
  const suggestions = useMemo(
    () =>
      state === null ? [] : rankWikiSuggestions(state.query, state.titles),
    [state],
  );
  const offerCreateNew = useMemo(
    () => state !== null && shouldOfferCreateNew(state.query, state.titles),
    [state],
  );
  const rows: readonly string[] = useMemo(
    () =>
      offerCreateNew
        ? [...suggestions, ""] // the trailing empty marker = the create row.
        : suggestions,
    [offerCreateNew, suggestions],
  );
  /** Clamped active row (guards a stale index after the rows shrink). */
  const active =
    rows.length === 0 ? 0 : Math.min(activeIndex, rows.length - 1);
  // The popup stays visible while probing an open span EVEN with zero
  // rows (empty query + no titles yet): the hint row teaches the
  // grammar instead of giving no feedback at all.
  const visible = state !== null;

  /**
   * Completes the open `[[query` span into `[[title]]` at the CURRENT
   * caret (re-detected fresh — the recorded probe may be stale): the
   * span is selected as a DOM range and replaced through
   * `execCommand("insertText")`, which BOTH editors accept as text
   * input (the same path user typing takes).
   */
  const insertSuggestion = useCallback((title: string): void => {
    const selection = document.getSelection();
    const node = selection?.anchorNode;
    if (selection === null || !(node instanceof Text)) {
      setState(null);
      return;
    }
    const open = detectOpenWikiQuery(
      node.textContent?.slice(0, selection.anchorOffset) ?? "",
    );
    if (open === null) {
      setState(null);
      return;
    }
    const range = document.createRange();
    range.setStart(node, open.start);
    range.setEnd(node, selection.anchorOffset);
    selection.removeAllRanges();
    selection.addRange(range);
    // Both editing roots are contenteditable: the insert lands as a
    // normal text-input event (TipTap maps it into its transaction).
    document.execCommand("insertText", false, `[[${title}]]`);
    lastQueryRef.current = null;
    setState(null);
  }, []);

  /** Probes the caret: opens, updates or hides the popup. */
  const probe = useCallback((): void => {
    const activeElement = document.activeElement;
    if (
      !(activeElement instanceof HTMLElement) ||
      !activeElement.matches(EDITING_SELECTOR)
    ) {
      lastQueryRef.current = null;
      setState(null);
      return;
    }
    const selection = document.getSelection();
    if (
      selection === null ||
      selection.rangeCount === 0 ||
      !selection.isCollapsed
    ) {
      setState(null);
      return;
    }
    const node = selection.anchorNode;
    if (!(node instanceof Text)) {
      setState(null);
      return;
    }
    const open = detectOpenWikiQuery(
      node.textContent?.slice(0, selection.anchorOffset) ?? "",
    );
    if (open === null) {
      setState(null);
      return;
    }
    const knowledge = AppContext.getDefault().tryGet(Services.knowledge);
    const titles =
      knowledge === undefined
        ? []
        : [...knowledge.current().titles.values()].map(
            (title) => title.display,
          );
    if (open.query !== lastQueryRef.current) {
      lastQueryRef.current = open.query;
      setActiveIndex(0);
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setState({
      x: rect.left,
      y: rect.bottom + 6,
      topY: rect.top,
      query: open.query,
      titles,
    });
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", probe);
    return () => {
      document.removeEventListener("selectionchange", probe);
    };
  }, [probe]);

  /** Capture-phase keyboard driving (before the editors react). */
  useEffect(() => {
    if (state === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        lastQueryRef.current = null;
        setState(null);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((current) => {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          const next = current + delta;
          if (next < 0) {
            return rows.length - 1;
          }
          if (next >= rows.length) {
            return 0;
          }
          return next;
        });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const row = rows[active];
        if (row !== undefined) {
          event.preventDefault();
          event.stopPropagation();
          insertSuggestion(row === "" ? state.query : row);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [state, rows, active, insertSuggestion]);

  /** Outside mousedown dismisses (row clicks guard themselves). */
  useEffect(() => {
    if (state === null) {
      return;
    }
    const onMouseDown = (event: MouseEvent): void => {
      if (
        containerRef.current !== null &&
        !containerRef.current.contains(event.target as Node)
      ) {
        lastQueryRef.current = null;
        setState(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [state]);

  /**
   * Measures and translates the popup into the viewport (below the
   * caret, flipping up when clamped) — imperatively, before paint.
   */
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null || state === null) {
      return;
    }
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    let x = state.x - 8;
    x = Math.min(Math.max(x, 8), window.innerWidth - width - 8);
    let y = state.y;
    if (y + height > window.innerHeight - 8) {
      y = Math.max(state.topY - height - 6, 8);
    }
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el.style.visibility = "visible";
  }, [state, rows.length, language]);

  if (state === null || !visible) {
    return null;
  }

  const rtl = language === "fa";
  const createLabel = t("wikiAutocomplete.create").replace(
    "{query}",
    state.query,
  );
  const empty = rows.length === 0;

  return (
    <div
      ref={containerRef}
      dir={rtl ? "rtl" : "ltr"}
      role="listbox"
      aria-label={t("wikiAutocomplete.heading")}
      className="panel-scroll fixed left-0 top-0 z-[95] w-64 overflow-y-auto rounded-xl border bg-popover/95 p-1.5 shadow-2xl shadow-black/25 backdrop-blur-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-100"
      style={{ visibility: "hidden" }}
    >
      <div className="flex items-center gap-1.5 px-1.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
        <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{t("wikiAutocomplete.heading")}</span>
      </div>
      <ul className="space-y-0.5" role="presentation">
        {empty ? (
          <li
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] leading-6 text-muted-foreground"
            dir={rtl ? "rtl" : "ltr"}
          >
            <Link2
              className="size-3.5 shrink-0 text-muted-foreground/60"
              aria-hidden="true"
            />
            <span className="text-muted-foreground/90">
              {t("wikiAutocomplete.emptyHint")}
            </span>
          </li>
        ) : null}
        {suggestions.map((title, index) => (
          <li key={title}>
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[13px] leading-6 text-foreground/95 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none data-[active=true]:bg-accent"
              data-active={index === active}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                insertSuggestion(title);
              }}
              onMouseEnter={() => {
                setActiveIndex(index);
              }}
            >
              <FileText
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="truncate">{title}</span>
            </button>
          </li>
        ))}
        {offerCreateNew ? (
          <li>
            <button
              type="button"
              role="option"
              aria-selected={active === suggestions.length}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[13px] leading-6 text-primary/90 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none data-[active=true]:bg-accent"
              data-active={active === suggestions.length}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                insertSuggestion(state.query);
              }}
              onMouseEnter={() => {
                setActiveIndex(suggestions.length);
              }}
            >
              <Plus
                className="h-3.5 w-3.5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span className="truncate">{createLabel}</span>
            </button>
          </li>
        ) : null}
      </ul>
      <div className="mt-1 flex items-center justify-between gap-2 border-t px-1.5 pt-1 text-[10px] text-muted-foreground/70">
        <span className="truncate">{t("wikiAutocomplete.hintKeys")}</span>
        <span className="shrink-0 tabular-nums">
          {t("wikiAutocomplete.matchesCount").replace(
            "{count}",
            formatInteger(suggestions.length, {
              language,
              persianDigits: language === "fa",
            }),
          )}
        </span>
      </div>
    </div>
  );
}