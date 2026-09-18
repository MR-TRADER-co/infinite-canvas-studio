"use client";

/**
 * Command palette (R7.11, Ctrl+K outside the editor): a searchable,
 * fuzzy-filtered list of EVERY registered command — rendered FROM the
 * CommandRegistry only (no separate list), titles via i18n, shortcut
 * hints, full keyboard navigation (arrows/Home/End/Enter/Esc) and fully
 * RTL.
 *
 * Executing from the palette dispatches through the single
 * CommandDispatcher — identical to toolbar/shortcut execution (AC7.12).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Command as CommandIcon } from "lucide-react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type { CommandEntry } from "@/core/registry/CommandRegistry";
import type { CommandRegistry } from "@/core/registry/CommandRegistry";
import { commandContextOf } from "@/interaction/dispatch/CommandDispatcher";
import { getDispatcher } from "@/ui/hooks/useCommands";
import { fuzzyFilter } from "@/ui/palette/fuzzy";
import { useTranslation, type TranslationKey } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";
import { cn } from "@/lib/utils";

/**
 * @returns the palette overlay (null while closed).
 */
export default function CommandPalette(): ReactElement | null {
  const open = useUiStore((state) => state.commandPaletteOpen);
  // The inner surface mounts FRESH on every open (unmount-on-close resets
  // the query/active state — no transition effects, no render-time refs).
  if (!open) {
    return null;
  }
  return <PaletteSurface />;
}

/** The palette's live surface (mounted only while open). */
function PaletteSurface(): ReactElement {
  const { t } = useTranslation();
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const [commands, setCommands] = useState<readonly CommandEntry[]>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Boot → read the registry (late registrations appear live).
  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      const registry: CommandRegistry = context.get(Services.commands);
      const read = (): void => {
        setCommands(registry.list());
      };
      read();
      unsubscribers.push(registry.onRegistered(read));
    });
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  // Autofocus the query input on mount.
  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  /** The fuzzy-filtered, score-ranked matches. */
  const matches = useMemo(() => {
    return fuzzyFilter(commands, query, (entry) =>
      t(entry.titleKey as TranslationKey),
    ).map((match) => match.item);
  }, [commands, query, t]);

  // The active row derives clamp-adjusted from the live list length
  // (no cascading setState), and stays scrolled into view.
  const active = Math.min(activeIndex, Math.max(matches.length - 1, 0));
  useEffect(() => {
    const row = listRef.current?.children.item(active);
    row?.scrollIntoView({ block: "nearest" });
  }, [active]);

  /**
   * Executes one command through the single dispatcher and closes.
   *
   * @param entry - the command to run.
   */
  const run = (entry: CommandEntry): void => {
    const dispatcher = getDispatcher();
    const context = commandContextOf(AppContext.getDefault());
    // Enabled state mirrors the toolbar/shortcut behaviour (AC7.12).
    if (entry.isEnabled !== undefined && !entry.isEnabled(context)) {
      return;
    }
    dispatcher?.dispatch(entry.id, context);
    setOpen(false);
  };

  /**
   * Keyboard navigation (RTL-safe: arrow semantics stay visual).
   *
   * @param event - the keydown event.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const entry = matches[active];
      if (entry !== undefined) {
        run(entry);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(matches.length - 1, 0));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t("palette.title")}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          setOpen(false);
        }
      }}
    >
      {/* Scrim */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      <div
        className={cn(
          "relative mx-4 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl",
          "border border-border/60 bg-background/95 shadow-2xl shadow-black/50 backdrop-blur-xl",
          "animate-[panel-pop-in_0.24s_cubic-bezier(0.22,1,0.36,1)_both]",
        )}
      >
        <div className="flex flex-none items-center gap-2 border-b border-border/60 px-3.5 py-2.5">
          <CommandIcon
            className="size-4 flex-none text-muted-foreground"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            dir="auto"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          <kbd className="flex-none rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            Esc
          </kbd>
        </div>
        {matches.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground/70">
            {t("palette.noMatches")}
          </p>
        ) : (
          <ul
            ref={listRef}
            role="listbox"
            aria-label={t("palette.resultsLabel")}
            className="panel-scroll max-h-[52vh] min-h-0 overflow-y-auto overscroll-contain py-1.5"
          >
            {matches.slice(0, 200).map((entry, index) => {
              const rowActive = index === active;
              return (
                <li key={entry.id} role="option" aria-selected={rowActive}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onPointerEnter={() => setActiveIndex(index)}
                    onClick={() => run(entry)}
                    dir="auto"
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3.5 py-2 text-start",
                      "rounded-lg text-sm transition-colors",
                      rowActive
                        ? "bg-primary/15 text-foreground"
                        : "text-foreground/85 hover:bg-accent/50",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {t(entry.titleKey as TranslationKey)}
                    </span>
                    {entry.shortcut !== undefined && (
                      <kbd className="flex-none rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {entry.shortcut}
                      </kbd>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="flex-none border-t border-border/60 px-3.5 py-1.5 text-[10px] text-muted-foreground/70">
          {t("palette.footerHint")}
        </p>
      </div>
    </div>
  );
}
