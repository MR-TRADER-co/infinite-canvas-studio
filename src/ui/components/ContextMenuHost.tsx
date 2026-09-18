"use client";
/**
 * The context-menu host (R6.2): renders the menu the ContextMenuRegistry
 * merges for the current right-click target. Leaf items resolve their
 * label/disabled state from the CommandRegistry and dispatch through the
 * shared CommandDispatcher — the menu never holds action logic of its
 * own. Fully RTL, keyboard-closable, outside-click-closable, clamped
 * into the viewport.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartVertical,
  ArrowLeftRight,
  ArrowUpNarrowWide,
  Bold,
  Columns3,
  Copy,
  Crosshair,
  Grid3X3,
  Italic,
  Layers,
  Link2,
  Lock,
  Maximize,
  Package,
  PackageOpen,
  Paintbrush,
  Pin,
  Rows3,
  Search,
  SquareSplitHorizontal,
  Table2,
  TableCellsMerge,
  Trash2,
  Underline,
  X,
  type LucideIcon,
} from "lucide-react";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import { useTranslation, type TranslationKey } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";
import { dispatchCommand } from "@/ui/hooks/useCommands";
import { commandContextOf } from "@/interaction/dispatch/CommandDispatcher";
import type { CommandEntry } from "@/core/registry/CommandRegistry";
import type {
  ResolvedMenuItem,
  ResolvedMenuChild,
} from "@/core/registry/ContextMenuRegistry";
import { cn } from "@/lib/utils";

/** Safety margin from the viewport edges (screen px). */
const EDGE_MARGIN = 8;

/** Icon per command id (host-mapped — the registry stays icon-free). */
const COMMAND_ICONS: ReadonlyMap<string, LucideIcon> = new Map<
  string,
  LucideIcon
>([
  ["core.table.insert", Table2],
  ["core.table.insertRowAbove", Rows3],
  ["core.table.insertRowBelow", Rows3],
  ["core.table.deleteRow", Trash2],
  ["core.table.insertColumnLeft", Columns3],
  ["core.table.insertColumnRight", Columns3],
  ["core.table.deleteColumn", Trash2],
  ["core.table.deleteTable", Trash2],
  ["core.table.mergeCells", TableCellsMerge],
  ["core.table.splitCellHorizontal", SquareSplitHorizontal],
  ["core.table.splitCellVertical", SquareSplitHorizontal],
  ["core.table.toggleHeaderRow", Rows3],
  ["core.table.toggleHeaderColumn", Columns3],
  ["core.table.toggleDirection", ArrowLeftRight],
  ["core.table.distributeColumns", ArrowUpNarrowWide],
  ["core.table.alignCellTop", AlignStartVertical],
  ["core.table.alignCellMiddle", AlignCenterVertical],
  ["core.table.alignCellBottom", AlignEndVertical],
  ["core.table.preset.classic", Paintbrush],
  ["core.table.preset.minimal", Paintbrush],
  ["core.table.preset.zebra", Paintbrush],
  ["core.table.preset.soft", Paintbrush],
  ["core.table.preset.grid", Paintbrush],
  ["core.table.preset.dark", Paintbrush],
  ["core.selection.selectAll", Search],
  ["core.selection.duplicate", Copy],
  ["core.selection.delete", Trash2],
  ["core.selection.group", Package],
  ["core.selection.ungroup", PackageOpen],
  ["core.selection.toggleLock", Lock],
  ["core.selection.togglePin", Pin],
  ["core.selection.bringFront", Layers],
  ["core.selection.bringForward", Layers],
  ["core.selection.sendBackward", Layers],
  ["core.selection.sendBack", Layers],
  ["core.text.editSelection", Bold],
  ["core.text.bold", Bold],
  ["core.text.italic", Italic],
  ["core.text.underline", Underline],
  ["core.text.strike", X],
  ["core.text.linkDialog", Link2],
  ["core.find.open", Search],
  ["core.view.fitAll", Maximize],
  ["core.view.resetZoom", Crosshair],
  ["core.view.toggleGrid", Grid3X3],
]);

/** Submenu icon per its title key (host-mapped). */
const SUBMENU_ICONS: ReadonlyMap<string, LucideIcon> = new Map<
  string,
  LucideIcon
>([
  ["table.rows", Rows3],
  ["table.columns", Columns3],
  ["table.splitCell", SquareSplitHorizontal],
  ["table.verticalAlign", AlignCenterVertical],
  ["table.preset", Paintbrush],
  ["contextMenu.zOrder", Layers],
]);

/** Renders one icon slot (map lookups must not become render components). */
function IconSlot(props: {
  readonly icon: LucideIcon | undefined;
  readonly className?: string;
}): ReactNode {
  const Icon = props.icon;
  return Icon !== undefined ? (
    <Icon
      className={props.className ?? "size-4 text-muted-foreground"}
      aria-hidden="true"
    />
  ) : (
    <span className={props.className ?? "size-4"} aria-hidden="true" />
  );
}

/** Renders at most one context menu (the app's single instance). */
export default function ContextMenuHost(): ReactNode | null {
  const { t } = useTranslation();
  const language = useUiStore((state) => state.language);
  const menu = useUiStore((state) => state.contextMenu);
  const close = useUiStore((state) => state.closeContextMenu);
  const [entries, setEntries] = useState<readonly ResolvedMenuItem[]>([]);
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(new Set());
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuOpen = menu !== null;

  // Build the merged menu (and its disabled states) whenever the menu
  // opens or a late contribution registers (the AC6.7 seam).
  useEffect(() => {
    if (menu === null) {
      setEntries([]);
      setPosition(null);
      setOpenSubmenu(null);
      return;
    }
    const registry = AppContext.getDefault().tryGet(Services.contextMenu);
    const dispatcher = AppContext.getDefault().tryGet(
      Services.commandDispatcher,
    );
    if (registry === undefined || dispatcher === undefined) {
      return;
    }
    const rebuild = (): void => {
      const built = registry.buildMenu(menu.target);
      setEntries(built);
      const unavailable = new Set<string>();
      const context = commandContextOf(AppContext.getDefault());
      const probe = (commandId: string): void => {
        const entry: CommandEntry | undefined =
          dispatcher.registry.get(commandId);
        if (
          entry !== undefined &&
          entry.isEnabled !== undefined &&
          !entry.isEnabled(context)
        ) {
          unavailable.add(commandId);
        }
      };
      for (const entry of built) {
        if (entry.kind === "command") {
          probe(entry.commandId);
        } else if (entry.kind === "submenu") {
          for (const child of entry.children) {
            if (child.kind === "command") {
              probe(child.commandId);
            }
          }
        }
      }
      setDisabled(unavailable);
    };
    rebuild();
    setPosition({ x: menu.x, y: menu.y });
    setOpenSubmenu(null);
    return registry.onRegistered(rebuild);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token bumps per open; x/y change with it
  }, [menu?.token, menu?.target.region, menu?.target.objectType]);

  // Outside presses and Escape close the menu.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const node = menuRef.current;
      if (
        node === null ||
        !(event.target instanceof Node) ||
        !node.contains(event.target)
      ) {
        close();
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menuOpen, close]);

  // Clamp into the viewport once measured.
  useLayoutEffect(() => {
    const node = menuRef.current;
    const anchor = position;
    if (node === null || anchor === null) {
      return;
    }
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const x = Math.min(
      Math.max(anchor.x, EDGE_MARGIN),
      Math.max(EDGE_MARGIN, window.innerWidth - EDGE_MARGIN - width),
    );
    const y = Math.min(
      Math.max(anchor.y, EDGE_MARGIN),
      Math.max(EDGE_MARGIN, window.innerHeight - EDGE_MARGIN - height),
    );
    if (x !== anchor.x || y !== anchor.y) {
      setPosition({ x, y });
    }
  }, [entries, position]);

  if (menu === null || position === null || entries.length === 0) {
    return null;
  }

  const runCommand = (commandId: string): void => {
    close();
    dispatchCommand(commandId);
  };

  return createPortal(
    <div
      ref={menuRef}
      dir={language === "fa" ? "rtl" : "ltr"}
      role="menu"
      aria-label={t("contextMenu.label")}
      style={{ left: position.x, top: position.y }}
      className={cn(
        "fixed z-[60] min-w-52 max-w-64 rounded-xl border border-border/60",
        "bg-background/95 p-1 shadow-2xl shadow-black/50 backdrop-blur-xl",
        "animate-[panel-pop-in_0.12s_cubic-bezier(0.22,1,0.36,1)_both]",
      )}
      onContextMenu={(event) => event.preventDefault()}
    >
      {entries.map((entry, index) => (
        <MenuRow
          key={
            entry.kind === "command"
              ? entry.commandId
              : entry.kind === "separator"
                ? `sep-${index}`
                : entry.titleKey
          }
          entry={entry}
          disabled={disabled}
          openSubmenu={openSubmenu}
          onToggleSubmenu={(titleKey) =>
            setOpenSubmenu((current) =>
              current === titleKey ? null : titleKey,
            )
          }
          onRun={runCommand}
        />
      ))}
    </div>,
    document.body,
  );
}

/** One rendered row (command, separator or submenu). */
function MenuRow(props: {
  readonly entry: ResolvedMenuItem;
  readonly disabled: ReadonlySet<string>;
  readonly openSubmenu: string | null;
  readonly onToggleSubmenu: (titleKey: string) => void;
  readonly onRun: (commandId: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const entry = props.entry;
  if (entry.kind === "separator") {
    return (
      <div
        role="separator"
        aria-hidden="true"
        className="my-1 h-px bg-border/60"
      />
    );
  }
  if (entry.kind === "submenu") {
    const expanded = props.openSubmenu === entry.titleKey;
    return (
      <div>
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={expanded}
          onClick={() => props.onToggleSubmenu(entry.titleKey)}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[13px]",
            "outline-none transition-colors duration-75",
            "focus-visible:ring-2 focus-visible:ring-ring",
            expanded
              ? "bg-accent/70 text-foreground"
              : "text-foreground/90 hover:bg-accent/70",
          )}
        >
          <IconSlot icon={SUBMENU_ICONS.get(entry.titleKey) ?? Table2} />
          <span className="flex-1">{t(entry.titleKey as TranslationKey)}</span>
        </button>
        {expanded && (
          <div className="mt-0.5 mb-1 ms-3 border-s border-border/50 ps-1">
            {entry.children.map((child, index) => (
              <MenuChildRow
                key={
                  child.kind === "command"
                    ? child.commandId
                    : `sep-${entry.titleKey}-${index}`
                }
                child={child}
                disabled={props.disabled}
                onRun={props.onRun}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
  const isDisabled = props.disabled.has(entry.commandId);
  const danger =
    entry.commandId === "core.table.deleteTable" ||
    entry.commandId === "core.selection.delete";
  return (
    <button
      type="button"
      role="menuitem"
      disabled={isDisabled}
      onClick={() => props.onRun(entry.commandId)}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[13px]",
        "outline-none transition-colors duration-75",
        "focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        danger
          ? "text-red-500 hover:bg-red-500/10"
          : "text-foreground/90 hover:bg-accent/70",
      )}
    >
      <IconSlot icon={COMMAND_ICONS.get(entry.commandId)} />
      <span className="flex-1">{commandTitle(entry.commandId, t)}</span>
    </button>
  );
}

/** One rendered child row inside a submenu. */
function MenuChildRow(props: {
  readonly child: ResolvedMenuChild;
  readonly disabled: ReadonlySet<string>;
  readonly onRun: (commandId: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const child = props.child;
  if (child.kind === "separator") {
    return (
      <div
        role="separator"
        aria-hidden="true"
        className="my-1 h-px bg-border/50"
      />
    );
  }
  const isDisabled = props.disabled.has(child.commandId);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={isDisabled}
      onClick={() => props.onRun(child.commandId)}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[13px]",
        "outline-none transition-colors duration-75",
        "focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        "text-foreground/90 hover:bg-accent/70",
      )}
    >
      {commandTitle(child.commandId, t)}
    </button>
  );
}

/**
 * Resolves a command's title through its registry entry (titleKey).
 *
 * @param commandId - the command id.
 * @param t - the translation function.
 * @returns the localised title, or the raw id for unknown commands.
 */
function commandTitle(
  commandId: string,
  t: (key: TranslationKey) => string,
): string {
  const entry = AppContext.getDefault()
    .tryGet(Services.commandDispatcher)
    ?.registry.get(commandId);
  return entry !== undefined ? t(entry.titleKey as TranslationKey) : commandId;
}
