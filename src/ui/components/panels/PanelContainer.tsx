"use client";

/**
 * Panel container (R7.1): renders every docked panel FROM the
 * {@link PanelRegistry} — the layout never names a panel component, so a
 * registration (core now, plugins in Phase 9) appears with ZERO edits
 * here (AC7.11's seam proof).
 *
 * Layout: one dock column per placement — `left` (inline-start edge),
 * `right` (inline-end edge) and `bottom` (the bottom inline-end corner,
 * the minimap's home). Each dock renders a slim icon rail (one toggle per
 * registered panel, aria-pressed, tooltip = the panel title) plus the
 * open panel bodies (header + scrollable body, capped heights). All
 * positioning uses logical CSS so RTL mirrors automatically.
 *
 * Open/closed state persists per panel id (localStorage, see
 * `panelState`), seeded from each entry's `defaultOpen`.
 */
import { useEffect, useState, type ReactElement } from "react";
import {
  Hash,
  LayoutGrid,
  Layers,
  ListTree,
  Map,
  Network,
  Search,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { Application, Services } from "@/App";
import type { PanelEntry } from "@/ui/registry/PanelRegistry";
import type { PanelPlacement } from "@/ui/registry/PanelRegistry";
import { ensurePanelsRegistered } from "@/ui/panels/registerPanels";
import { readPanelState, writePanelState } from "@/ui/panels/panelState";
import { useTranslation, type TranslationKey } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";
import { cn } from "@/lib/utils";

/** Dock icon lookup (registry icon names → lucide components). */
const DOCK_ICONS: Readonly<Record<string, LucideIcon>> = {
  Layers,
  SlidersHorizontal,
  Search,
  ListTree,
  Map,
  LayoutGrid,
  Network,
  Hash,
};

/** Shared rail button classes (≥28px targets). */
const RAIL_BUTTON =
  "grid size-8 place-items-center rounded-lg outline-none " +
  "transition-colors focus-visible:ring-2 focus-visible:ring-ring";

/** Shared open-panel shell classes. */
const PANEL_SHELL =
  "flex min-h-0 flex-col overflow-hidden rounded-2xl border " +
  "border-border/60 bg-background/90 shadow-2xl shadow-black/30 " +
  "backdrop-blur-xl animate-[panel-pop-in_0.28s_cubic-bezier(0.22,1,0.36,1)_both]";

/**
 * @returns the three docks (left/right/bottom) rendered from the registry.
 */
export default function PanelContainer(): ReactElement {
  const { t } = useTranslation();
  const panelOpen = useUiStore((state) => state.panelOpen);
  const setPanelOpen = useUiStore((state) => state.setPanelOpen);
  const hydratePanelState = useUiStore((state) => state.hydratePanelState);
  const [entries, setEntries] = useState<readonly PanelEntry[]>([]);

  // Boot → register the core panels → subscribe to late registrations →
  // hydrate the persisted open state over the defaults.
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void Application.boot().then((context) => {
      if (cancelled) {
        return;
      }
      ensurePanelsRegistered(context);
      const registry = context.get(Services.panels);
      const read = (): void => {
        setEntries(registry.list());
      };
      read();
      unsubscribe = registry.onRegistered(() => {
        read();
      });
      const defaults = Object.fromEntries(
        registry.list().map((entry) => [entry.id, entry.defaultOpen]),
      );
      hydratePanelState(readPanelState(defaults));
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [hydratePanelState]);

  // Persist on every change.
  useEffect(() => {
    writePanelState(panelOpen);
  }, [panelOpen]);

  const byPlacement = (placement: PanelPlacement): readonly PanelEntry[] =>
    entries.filter((entry) => entry.placement === placement);

  return (
    <>
      <PanelDock
        placement="left"
        entries={byPlacement("left")}
        open={panelOpen}
        onToggle={setPanelOpen}
      />
      <PanelDock
        placement="right"
        entries={byPlacement("right")}
        open={panelOpen}
        onToggle={setPanelOpen}
      />
      <PanelDock
        placement="bottom"
        entries={byPlacement("bottom")}
        open={panelOpen}
        onToggle={setPanelOpen}
      />
      <span className="sr-only">{t("panels.dockLabel")}</span>
    </>
  );
}

/**
 * One dock: the icon rail + the open panel bodies.
 *
 * @param props - placement, entries, open state map, toggle callback.
 * @returns the dock element (null while empty).
 */
function PanelDock(props: {
  readonly placement: PanelPlacement;
  readonly entries: readonly PanelEntry[];
  readonly open: Readonly<Record<string, boolean>>;
  readonly onToggle: (panelId: string, open: boolean) => void;
}): ReactElement | null {
  const { placement, entries, open, onToggle } = props;
  const { t } = useTranslation();
  if (entries.length === 0) {
    return null;
  }
  const isBottom = placement === "bottom";
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-10 flex gap-2",
        isBottom
          ? "bottom-4 end-4 flex-col items-end"
          : placement === "left"
            ? "inset-y-14 start-3 flex-col"
            : "inset-y-14 end-3 flex-col",
      )}
    >
      {entries.map((entry) => {
        const isOpen = open[entry.id] ?? entry.defaultOpen;
        if (!isOpen) {
          return null;
        }
        const Body = entry.component;
        return (
          <section
            key={entry.id}
            aria-label={t(entry.titleKey as TranslationKey)}
            className={cn(
              PANEL_SHELL,
              "pointer-events-auto",
              isBottom ? "w-56" : "max-h-[min(22rem,50%)] w-64",
            )}
          >
            <header className="flex flex-none items-center justify-between border-b border-border/60 px-3 py-1.5">
              <h2 className="truncate text-xs font-semibold tracking-wide text-foreground">
                {t(entry.titleKey as TranslationKey)}
              </h2>
              <button
                type="button"
                aria-label={t("panels.close")}
                title={t("panels.close")}
                onClick={() => onToggle(entry.id, false)}
                className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span aria-hidden="true" className="text-sm leading-none">
                  ×
                </span>
              </button>
            </header>
            <div className="panel-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <Body />
            </div>
          </section>
        );
      })}
      {/* The icon rail: always visible toggles for this dock's panels. */}
      <nav
        aria-label={t("panels.dockLabel")}
        className={cn(
          "pointer-events-auto flex gap-1 rounded-xl border border-border/60",
          "bg-background/85 p-1 shadow-lg shadow-black/20 backdrop-blur-xl",
          isBottom ? "flex-row" : "flex-row",
        )}
      >
        {entries.map((entry) => {
          const Icon = DOCK_ICONS[entry.icon] ?? LayoutGrid;
          const isOpen = open[entry.id] ?? entry.defaultOpen;
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={isOpen}
              aria-label={t(entry.titleKey as TranslationKey)}
              title={t(entry.titleKey as TranslationKey)}
              onClick={() => onToggle(entry.id, !isOpen)}
              className={cn(
                RAIL_BUTTON,
                isOpen
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          );
        })}
      </nav>
    </div>
  );
}
