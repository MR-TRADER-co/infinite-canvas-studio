"use client";

/**
 * Selection actions: the floating contextual cluster above the toolbar
 * (R2.9) — duplicate, delete, z-order (four operations), group/ungroup and
 * lock/unlock for the current selection.
 *
 * Phase 3B.5 (R3B5.2): the cluster now renders FROM the command registry —
 * the `selection` group's entries drive the buttons (order = the registry
 * order), clicks dispatch through the single `CommandDispatcher`, and a
 * command registered AFTER boot (e.g. a test's dummy entry) appears here
 * with ZERO edits to this component (AC3B5.2's seam proof). The known
 * entries keep their rich affordances (icons, shortcut badges, disabled
 * predicates); unknown entries render as plain icon buttons.
 *
 * Appears only while something is selected (the Figma contextual-bar
 * pattern); every action still lands as one composite undo step through
 * the SAME `core/commands/SelectionOps` layer the commands execute.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Group,
  Layers,
  Lock,
  LockOpen,
  Trash2,
  Unlink,
  Ungroup,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { isGroupObject } from "@/core/model/GroupObject";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { Selection } from "@/core/selection/Selection";
import type { IdGenerator } from "@/core/id/IdGenerator";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import type { CommandEntry } from "@/core/registry/CommandRegistry";
import { dispatchCommand, useCommandGroup } from "@/ui/hooks/useCommands";
import { useTranslation, type TranslationKey } from "@/ui/i18n";
import { cn } from "@/lib/utils";

/** Live snapshot of the selection driving the cluster. */
interface SelectionSnapshot {
  /** Selected top-level objects in paint order. */
  readonly objects: readonly SceneObjectData[];
  /** Whether any selected object is locked. */
  readonly anyLocked: boolean;
  /** Whether every selected object is locked. */
  readonly allLocked: boolean;
  /** Whether the selection contains a group (ungroup available). */
  readonly hasGroup: boolean;
  /** Whether the services have booted. */
  readonly ready: boolean;
}

/** Resolved canvas services backing the actions. */
interface CanvasServices {
  readonly scene: Scene;
  readonly history: HistoryManager;
  readonly selection: Selection;
  readonly ids: IdGenerator;
}

/** The z-order popover's entries (ids of the four registered commands). */
const Z_ORDER_IDS = [
  "core.selection.bringFront",
  "core.selection.bringForward",
  "core.selection.sendBackward",
  "core.selection.sendBack",
] as const;

/** First id of the z-order family (the popover renders at its position). */
const Z_ORDER_ANCHOR = "core.selection.bringFront";

/** Rich affordances for the KNOWN selection commands. */
const SELECTION_UI: Readonly<
  Record<string, { icon: typeof Copy | null; hint: string }>
> = {
  "core.selection.duplicate": { icon: Copy, hint: "Ctrl+D" },
  "core.selection.delete": { icon: Trash2, hint: "Del" },
  "core.selection.group": { icon: Group, hint: "Ctrl+G" },
  "core.selection.ungroup": { icon: Ungroup, hint: "Ctrl+Shift+G" },
  "core.selection.toggleLock": { icon: null, hint: "Ctrl+L" },
  "core.selection.clear": { icon: null, hint: "Esc" },
  "core.selection.selectAll": { icon: null, hint: "Ctrl+A" },
  /* R7.3: alignment & distribution — the cluster renders them from the
   * selection group automatically; these entries give the icons. */
  "core.selection.alignleft": { icon: AlignStartVertical, hint: "" },
  "core.selection.aligncenterHorizontal": {
    icon: AlignCenterVertical,
    hint: "",
  },
  "core.selection.alignright": { icon: AlignEndVertical, hint: "" },
  "core.selection.aligntop": { icon: AlignStartHorizontal, hint: "" },
  "core.selection.alignmiddle": { icon: AlignCenterHorizontal, hint: "" },
  "core.selection.alignbottom": { icon: AlignEndHorizontal, hint: "" },
  "core.selection.distributeHorizontal": {
    icon: AlignHorizontalSpaceAround,
    hint: "",
  },
  "core.selection.distributeVertical": {
    icon: AlignVerticalSpaceAround,
    hint: "",
  },
};

/**
 * Subscribes to the scene and selection and returns the live snapshot plus
 * the resolved services.
 *
 * @returns the selection snapshot and services (services null before boot).
 */
function useSelectionSnapshot(): SelectionSnapshot & {
  services: CanvasServices | null;
} {
  const [objects, setObjects] = useState<readonly SceneObjectData[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsubscribers: Array<() => void> = [];
    let cancelled = false;

    const install = (
      scene: Scene,
      selection: Selection,
      bus: EventBus<AppEventMap>,
    ): void => {
      const read = (): void => {
        setObjects(
          Array.from(selection.ids)
            .map((id) => scene.findById(id))
            .filter(
              (object): object is SceneObjectData => object !== undefined,
            ),
        );
        setReady(true);
      };
      read();
      unsubscribers.push(
        bus.on("scene:changed", read),
        bus.on("selection:changed", read),
      );
    };

    void Application.boot().then((context: AppContext) => {
      if (!cancelled) {
        install(
          context.get(Services.scene),
          context.get(Services.selection),
          context.get(Services.eventBus),
        );
      }
    });

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  const services = useMemo<CanvasServices | null>(() => {
    const context = AppContext.getDefault();
    const scene = context.tryGet(Services.scene);
    const history = context.tryGet(Services.history);
    const selection = context.tryGet(Services.selection);
    const ids = context.tryGet(Services.idGenerator);
    if (
      scene === undefined ||
      history === undefined ||
      selection === undefined ||
      ids === undefined
    ) {
      return null;
    }
    return { scene, history, selection, ids };
    // Re-resolve whenever the boot state flips (before boot the lookups
    // return undefined).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const anyLocked = objects.some((object) => object.locked);
  const allLocked =
    objects.length > 0 && objects.every((object) => object.locked);
  const hasGroup = objects.some((object) => isGroupObject(object));
  return { objects, anyLocked, allLocked, hasGroup, ready, services };
}

/**
 * @returns the floating selection-actions cluster, or null while nothing
 * is selected.
 */
export default function SelectionActions() {
  const { t } = useTranslation();
  const snapshot = useSelectionSnapshot();
  const commands = useCommandGroup("selection");
  const services = snapshot.services;

  if (!snapshot.ready || services === null || snapshot.objects.length === 0) {
    return null;
  }

  const canGroup =
    snapshot.objects.filter(
      (object) => (object as { parentId?: string }).parentId === undefined,
    ).length >= 2;
  const locked = snapshot.anyLocked;

  /** View-level availability for the KNOWN commands (beyond isEnabled). */
  const isDisabled = (id: string): boolean => {
    if (id === "core.selection.group") {
      return !canGroup;
    }
    if (id === "core.selection.ungroup") {
      return !snapshot.hasGroup;
    }
    return false;
  };

  /** The title of one entry (i18n through the registry's titleKey). */
  const labelOf = (entry: CommandEntry): string => safeT(entry.titleKey);

  /** Title translation that tolerates non-dictionary keys (dummy entries). */
  const safeT = (key: string): string => {
    const translated = t(key as TranslationKey);
    return translated === key ? key : translated;
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        role="toolbar"
        aria-label={t("selectionActions.title")}
        className="absolute bottom-[5.5rem] left-1/2 z-10 flex -translate-x-1/2 animate-[toolbar-rise-in_0.35s_cubic-bezier(0.22,1,0.36,1)_both] items-center gap-0.5 rounded-2xl border border-border/60 bg-background/80 px-1.5 py-1.5 shadow-xl shadow-black/25 backdrop-blur-xl"
      >
        {commands.map((entry) => {
          // The z-order family renders ONE popover at the anchor's slot.
          if (Z_ORDER_IDS.includes(entry.id as (typeof Z_ORDER_IDS)[number])) {
            if (entry.id !== Z_ORDER_ANCHOR) {
              return null;
            }
            return <ZOrderPopover key={entry.id} />;
          }
          const config = SELECTION_UI[entry.id];
          const Icon = config?.icon ?? null;
          const dynamicLock = entry.id === "core.selection.toggleLock";
          const title =
            entry.id === "core.selection.toggleLock"
              ? locked
                ? t("selectionActions.unlock")
                : t("selectionActions.lock")
              : labelOf(entry);
          return (
            <ActionTooltipText
              key={entry.id}
              label={title}
              hint={config?.hint ?? entry.shortcut ?? ""}
            >
              <button
                type="button"
                aria-label={title}
                aria-pressed={dynamicLock ? snapshot.allLocked : undefined}
                disabled={isDisabled(entry.id)}
                onClick={() => dispatchCommand(entry.id)}
                className={cn(
                  ACTION_CLASSES,
                  entry.id === "core.selection.delete" &&
                    "hover:text-destructive",
                )}
              >
                {dynamicLock ? (
                  locked ? (
                    <Lock aria-hidden="true" className="size-4 text-primary" />
                  ) : (
                    <LockOpen aria-hidden="true" className="size-4" />
                  )
                ) : Icon !== null ? (
                  <Icon aria-hidden="true" className="size-4" />
                ) : (
                  <Unlink aria-hidden="true" className="size-4 opacity-50" />
                )}
              </button>
            </ActionTooltipText>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

/** The z-order popover (front / forward / backward / back). */
function ZOrderPopover(): React.ReactElement {
  const { t } = useTranslation();
  const items: Array<{
    id: string;
    labelKey: TranslationKey;
    icon: typeof ArrowUpToLine;
  }> = [
    {
      id: "core.selection.bringFront",
      labelKey: "selectionActions.bringFront",
      icon: ArrowUpToLine,
    },
    {
      id: "core.selection.bringForward",
      labelKey: "selectionActions.bringForward",
      icon: ArrowUpToLine,
    },
    {
      id: "core.selection.sendBackward",
      labelKey: "selectionActions.sendBackward",
      icon: ArrowDownToLine,
    },
    {
      id: "core.selection.sendBack",
      labelKey: "selectionActions.sendBack",
      icon: ArrowDownToLine,
    },
  ];
  return (
    <Popover>
      <ActionTooltip labelKey="selectionActions.zOrder" hint="Ctrl+]">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("selectionActions.zOrder")}
            className={ACTION_CLASSES}
          >
            <Layers aria-hidden="true" className="size-4" />
          </button>
        </PopoverTrigger>
      </ActionTooltip>
      <PopoverContent side="top" align="center" className="w-44 p-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => dispatchCommand(item.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
              {t(item.labelKey)}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

/** Shared classes of one action button. */
const ACTION_CLASSES =
  "grid size-9 place-items-center rounded-lg outline-none transition-all duration-150 " +
  "focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground " +
  "hover:bg-accent/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

/**
 * Tooltip wrapper for one action button (label key variant).
 *
 * @param props - the label key, shortcut hint and the child button.
 * @returns the tooltip-affordance wrapper.
 */
function ActionTooltip(props: {
  readonly labelKey: TranslationKey;
  readonly hint: string;
  readonly children: React.ReactElement;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>{props.children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <span className="flex items-center gap-1.5">
          {t(props.labelKey)}
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
            {props.hint}
          </kbd>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Tooltip wrapper for one action button (plain label variant — dynamic
 * registry entries whose titles bypass the dictionary).
 *
 * @param props - the label, shortcut hint and the child button.
 * @returns the tooltip-affordance wrapper.
 */
function ActionTooltipText(props: {
  readonly label: string;
  readonly hint: string;
  readonly children: React.ReactElement;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{props.children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <span className="flex items-center gap-1.5">
          {props.label}
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
            {props.hint}
          </kbd>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
