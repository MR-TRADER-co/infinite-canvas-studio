"use client";

/**
 * Manual-link target picker (pack R11.6): the «لینک به این شیء…» dialog —
 * opened through `ui:link-picker-requested` (the registered command
 * `core.knowledge.linkTo`, contributed to the object context menu).
 *
 * Lists every OTHER scene object as a pickable target (kind icon +
 * title/name + kind label, searchable, Persian-first), creates the link
 * through ONE `AddManualLinkCommand` (§1.7.8's LinkRegistry — one undo
 * step) and toasts the Persian confirmation. The source's EXISTING
 * outgoing manual links render below with per-row remove buttons (one
 * undo step each).
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Image as ImageIcon,
  Link2,
  Link2Off,
  Map,
  Pen,
  Plus,
  Search,
  Shapes,
  Spline,
  StickyNote,
  Type,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import { addManualLinkCommand } from "@/core/commands/LinkCommands";
import { removeManualLinkCommand } from "@/core/commands/LinkCommands";
import { useTranslation, type TranslationKey } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import { cn } from "@/lib/utils";

/** Kind icons for picker rows. */
const KIND_ICONS: Record<string, LucideIcon> = {
  shape: Shapes,
  freehand: Pen,
  textBox: Type,
  stickyNote: StickyNote,
  image: ImageIcon,
  connector: Spline,
  frame: Map,
};

/** One pickable target row (pure derivation — testable). */
export interface LinkTargetRow {
  /** The target object id. */
  readonly objectId: string;
  /** The display title (resolved title > name > kind label). */
  readonly display: string;
  /** The title SNAPSHOT stored on the link (dangling resolution key). */
  readonly targetTitle: string;
  /** The object kind (icon + label). */
  readonly kind: string;
}

/**
 * Derives the pickable target rows from the scene (pure): every object
 * except the source, titled rows first, then by document order.
 *
 * @param objects - the scene objects (paint order).
 * @param sourceId - the source object to exclude.
 * @param titleOf - the resolved-title lookup (object id → display).
 * @param kindLabel - the kind → localized label lookup.
 * @returns the rows (may be empty).
 */
export function buildLinkTargetRows(
  objects: readonly { id: string; kind: string; name?: string }[],
  sourceId: string,
  titleOf: (objectId: string) => string | null,
  kindLabel: (kind: string) => string,
): LinkTargetRow[] {
  const rows: LinkTargetRow[] = [];
  for (const object of objects) {
    if (object.id === sourceId) {
      continue;
    }
    const title = titleOf(object.id);
    const fallback =
      typeof object.name === "string" && object.name.trim() !== ""
        ? object.name.trim()
        : kindLabel(object.kind);
    const display = title ?? fallback;
    rows.push({
      objectId: object.id,
      display,
      targetTitle: display,
      kind: object.kind,
    });
  }
  // Titled targets first (they carry the dangling-resolution magic),
  // then everything else; stable within groups by document order.
  rows.sort((a, b) => {
    const aTitled = a.display !== kindLabel(a.kind) ? 0 : 1;
    const bTitled = b.display !== kindLabel(b.kind) ? 0 : 1;
    return aTitled - bTitled;
  });
  return rows;
}

/**
 * @returns the manual-link target picker dialog (bus-driven visibility).
 */
export default function LinkTargetPickerDialog(): ReactElement | null {
  const { t, language } = useTranslation();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);

  // Bus-driven visibility + live re-renders (knowledge rebuilds move
  // rows/resolutions under the open dialog).
  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      const bus = context.get(Services.eventBus);
      unsubscribers.push(
        bus.on("ui:link-picker-requested", ({ sourceId: requested }) => {
          setSourceId(requested);
          setQuery("");
        }),
      );
      unsubscribers.push(
        bus.on("knowledge:changed", () => setTick((value) => value + 1)),
      );
      unsubscribers.push(
        bus.on("scene:changed", () => setTick((value) => value + 1)),
      );
    });
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  const context = AppContext.getDefault();
  const scene = context.tryGet(Services.scene);
  const knowledge = context.tryGet(Services.knowledge);
  const links = context.tryGet(Services.links);
  const history = context.tryGet(Services.history);
  const bus = context.tryGet(Services.eventBus);
  const open = sourceId !== null && scene !== undefined;
  void tick;

  const kindLabel = (kind: string): string =>
    t(`object.${kind === "shape" ? "shape" : kind}` as TranslationKey);

  const rows = useMemo<LinkTargetRow[]>(() => {
    if (!open || scene === undefined || knowledge === undefined) {
      return [];
    }
    return buildLinkTargetRows(
      scene.objects.map((object) => ({
        id: object.id,
        kind: object.kind,
        ...(object.name !== undefined ? { name: object.name } : {}),
      })),
      sourceId ?? "",
      (objectId) => knowledge.titleOf(objectId)?.display ?? null,
      kindLabel,
    );
    // `tick` re-derives rows as titles/knowledge change; `kindLabel`
    // closes over the live translation and is intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scene, knowledge, sourceId, tick]);

  const existing =
    open && links !== undefined && sourceId !== null
      ? links.outgoingOf(sourceId).filter((entry) => entry.kind === "manual")
      : [];

  const filtered = query.trim() === ""
    ? rows
    : rows.filter((row) => row.display.includes(query.trim()));

  const sourceTitle =
    open && sourceId !== null && knowledge !== undefined
      ? (knowledge.titleOf(sourceId)?.display ?? null)
      : null;

  /**
   * Creates one manual link source→target (ONE undo step) and closes.
   *
   * @param row - the picked target row.
   */
  const pick = (row: LinkTargetRow): void => {
    if (
      sourceId === null ||
      links === undefined ||
      history === undefined ||
      bus === undefined
    ) {
      return;
    }
    const ids = context.tryGet(Services.idGenerator);
    if (ids === undefined) {
      return;
    }
    const entry = {
      id: ids.next(),
      sourceId,
      targetId: row.objectId,
      targetTitle: row.targetTitle,
      kind: "manual" as const,
      createdAt: Date.now(),
    };
    const command = addManualLinkCommand(links, entry);
    command.do();
    history.push(command);
    bus.emit("ui:notice", {
      messageKey: "linkPicker.createdToast",
      severity: "info",
      values: { target: row.display },
    });
    setSourceId(null);
  };

  /**
   * Removes one existing manual link (ONE undo step).
   *
   * @param linkId - the registry entry id.
   */
  const remove = (linkId: string): void => {
    if (links === undefined || history === undefined || bus === undefined) {
      return;
    }
    const entry = links.get(linkId);
    if (entry === null) {
      return;
    }
    const command = removeManualLinkCommand(links, entry);
    command.do();
    history.push(command);
    bus.emit("ui:notice", {
      messageKey: "linkPicker.removedToast",
      severity: "info",
      values: { target: entry.targetTitle },
    });
  };

  if (!open) {
    return null;
  }

  const inputClasses = cn(
    "w-full rounded-lg border border-border/60 bg-background/70 px-2.5 py-1.5",
    "text-xs text-foreground outline-none placeholder:text-muted-foreground/60",
    "focus-visible:ring-2 focus-visible:ring-ring",
  );

  return (
    <Dialog open onOpenChange={(next) => {
      if (!next) {
        setSourceId(null);
      }
    }}>
      <DialogContent
        dir="rtl"
        className="max-w-sm rounded-2xl border-border/70 bg-popover/95 shadow-2xl shadow-black/25 backdrop-blur-xl"
      >
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Link2 className="size-5 text-primary" aria-hidden="true" />
            {t("linkPicker.title")}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            {t("linkPicker.description")}
            {sourceTitle !== null ? (
              <span className="ms-1 font-medium text-foreground/80">
                «{sourceTitle}»
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            className="pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("linkPicker.searchPlaceholder")}
            aria-label={t("linkPicker.searchPlaceholder")}
            dir="auto"
            className={cn(inputClasses, "pe-8")}
          />
        </div>

        <div
          className="max-h-72 space-y-1 overflow-y-auto overscroll-contain panel-scroll"
          role="listbox"
          aria-label={t("linkPicker.title")}
        >
          <p className="px-1 text-[10px] tabular-nums text-muted-foreground">
            {t("linkPicker.countLabel").replace(
              "{count}",
              formatInteger(filtered.length, language),
            )}
          </p>
          {filtered.length === 0 ? (
            <p className="px-2 py-4 text-center text-[11px] leading-5 text-muted-foreground/70">
              {t("linkPicker.noMatches")}
            </p>
          ) : (
            filtered.map((row) => {
              const Icon = KIND_ICONS[row.kind] ?? Shapes;
              return (
                <button
                  key={row.objectId}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => pick(row)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border/40 bg-background/40 px-2 py-1.5 text-start transition-all hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <Icon
                    className="size-3.5 flex-none text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                    {row.display}
                  </span>
                  <span className="flex-none text-[9px] text-muted-foreground/70">
                    {kindLabel(row.kind)}
                  </span>
                  <Plus
                    className="size-3 flex-none text-primary/70"
                    aria-hidden="true"
                  />
                </button>
              );
            })
          )}
        </div>

        {existing.length > 0 && links !== undefined ? (
          <div className="space-y-1 border-t border-border/50 pt-2">
            <p className="flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              <Link2Off className="size-2.5" aria-hidden="true" />
              {t("linkPicker.existingTitle")}
            </p>
            <ul className="max-h-24 space-y-1 overflow-y-auto panel-scroll">
              {existing.map((entry) => {
                const resolved =
                  knowledge?.resolvedTargetOfLink(entry.id) ?? null;
                return (
                  <li key={entry.id}>
                    <div className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-accent/30 px-2 py-1">
                      <Link2
                        className="size-3 flex-none text-primary/80"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/90">
                        {entry.targetTitle}
                      </span>
                      <span
                        className={cn(
                          "flex-none rounded-full px-1.5 py-0.5 text-[9px]",
                          resolved !== null
                            ? "bg-primary/15 text-primary"
                            : "bg-destructive/10 text-destructive/80",
                        )}
                      >
                        {resolved !== null
                          ? t("linkPicker.resolved")
                          : t("linkPicker.dangling")}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(entry.id)}
                        title={t("linkPicker.removeLink")}
                        aria-label={t("linkPicker.removeLink")}
                        className="grid size-5 flex-none place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
