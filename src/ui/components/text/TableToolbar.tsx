"use client";

/**
 * Floating TABLE toolbar (R6.2/R6.4): appears whenever the caret or a
 * selection sits inside a table (caret-only editing included — structural
 * operations must not require a text range, unlike the character-level
 * format bar). Renders the row/column/merge/split/header/delete command
 * set, the table direction toggle (R6.5), the style presets (R6.4) and the
 * per-cell background palette (R6.4).
 *
 * Placement: above the caret while caret-only; BELOW the selection when a
 * text range is selected (the character format bar takes the spot above
 * the selection — the two bars never overlap); both clamp into the
 * viewport. The bar never steals editor focus (mousedown defaults off)
 * and is tagged `data-text-format-ui` so the session's deferred focusout
 * check treats it as a transient focus owner.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartVertical,
  ArrowLeftRight,
  ArrowUpToLine,
  ArrowUpNarrowWide,
  ChevronDown,
  Columns3,
  Paintbrush,
  Palette,
  PanelRight,
  PanelTop,
  Plus,
  Rows3,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import { useTranslation, type TranslationKey } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";
import { useRichTextSession } from "@/ui/hooks/useRichTextSession";
import { HIGHLIGHT_PALETTE } from "@/text/editor/extensions";
import {
  CELL_VERTICAL_ALIGNMENTS,
  type CellVerticalAlign,
} from "@/text/editor/extensions/table";
import {
  canSplitCellAlongAxis,
  currentCellBackground,
  currentCellVerticalAlign,
  currentTableDirection,
  currentTablePreset,
  distributeTableColumns,
  findTableAncestor,
  isSelectionInTable,
  measureTableColumnFallbackWidth,
  setCellBackground,
  setCellVerticalAlign,
  setTableDirection,
  setTablePreset,
  splitCellAlongAxis,
} from "@/text/editor/tableCommands";
import {
  TABLE_STYLE_PRESETS,
  type TableStylePreset,
} from "@/text/editor/extensions/table";
import { cn } from "@/lib/utils";

/** Clear gap between a bar and the anchor (screen px). */
const ANCHOR_GAP = 12;

/** Safety margin from the viewport edges (screen px). */
const EDGE_MARGIN = 16;

/** Initial size guess before the first measurement lands. */
const INITIAL_BAR_SIZE = { width: 340, height: 44 };

/**
 * Keeps the editor caret/selection: defaulting the mousedown off prevents
 * the browser from moving DOM focus to the clicked button.
 */
function preventFocusSteal(event: React.MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/**
 * Closes a popover on outside pointer presses (capture-phase).
 */
function useCloseOnOutside(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
): void {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const node = ref.current;
      if (
        node !== null &&
        event.target instanceof Node &&
        !node.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, ref, setOpen]);
}

/** One entry of a dropdown menu. */
interface MenuEntry {
  /** Icon shown before the label. */
  readonly icon: LucideIcon;
  /** i18n key of the label. */
  readonly labelKey: TranslationKey;
  /** Runs the entry action. */
  readonly run: () => void;
  /** Whether the entry is disabled. */
  readonly disabled?: boolean;
  /** Checkmark for the active entry (radio behaviour). */
  readonly checked?: boolean;
}

/** Props of the dropdown menu button. */
interface MenuButtonProps {
  /** Icon on the collapsed trigger. */
  readonly icon: LucideIcon;
  /** i18n key of the trigger's accessible label. */
  readonly labelKey: TranslationKey;
  /** Menu entries. */
  readonly entries: readonly MenuEntry[];
  /** Opens the menu initially (presets/direction quick access). */
  readonly active?: boolean;
}

/** A compact dropdown trigger + its custom menu list. */
function MenuButton(props: MenuButtonProps): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useCloseOnOutside(ref, open, setOpen);
  const Icon = props.icon;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t(props.labelKey)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t(props.labelKey)}
        onMouseDown={preventFocusSteal}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-8 items-center gap-0.5 rounded-lg px-1.5 outline-none",
          "transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring",
          open || props.active === true
            ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
            : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
        <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t(props.labelKey)}
          className="absolute top-9 z-50 w-max min-w-44 rounded-xl border border-border/60 bg-background/95 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          {props.entries.map((entry) => {
            const EntryIcon = entry.icon;
            return (
              <button
                key={entry.labelKey}
                type="button"
                role="menuitemcheckbox"
                aria-checked={entry.checked === true}
                disabled={entry.disabled === true}
                onMouseDown={preventFocusSteal}
                onClick={() => {
                  setOpen(false);
                  if (entry.disabled !== true) {
                    entry.run();
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[12px] outline-none",
                  "transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-40",
                  entry.checked === true
                    ? "bg-primary/10 text-foreground"
                    : "text-foreground/90 hover:bg-accent/70",
                )}
              >
                <EntryIcon
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="flex-1">{t(entry.labelKey)}</span>
                {entry.checked === true ? (
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-primary"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A single-action compact button (merge/split/direction/…). */
function ToolButton(props: {
  readonly icon: LucideIcon;
  readonly labelKey: TranslationKey;
  readonly hint?: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const Icon = props.icon;
  const title =
    props.hint === undefined
      ? t(props.labelKey)
      : `${t(props.labelKey)} — ${props.hint}`;
  return (
    <button
      type="button"
      aria-label={t(props.labelKey)}
      aria-pressed={props.active === true}
      title={title}
      disabled={props.disabled === true}
      onMouseDown={preventFocusSteal}
      onClick={props.onClick}
      className={cn(
        "grid h-8 min-w-8 place-items-center rounded-lg px-1.5 outline-none",
        "transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        props.active === true
          ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
          : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

/**
 * Measures the caret/selection anchor as a client-space rect.
 *
 * @param editor - the shared editor.
 * @returns the union rect of the live selection (bidi-correct through
 *          ProseMirror's per-position coordinates).
 */
function measureAnchor(
  editor: Editor,
): { left: number; top: number; right: number; bottom: number } | null {
  const { selection } = editor.state;
  try {
    const from = editor.view.coordsAtPos(selection.from);
    const to = editor.view.coordsAtPos(selection.to);
    return {
      left: Math.min(from.left, to.left),
      top: Math.min(from.top, to.top),
      right: Math.max(from.right, to.right),
      bottom: Math.max(from.bottom, to.bottom),
    };
  } catch {
    return null;
  }
}

/** Alignment icon per vertical-alignment value (R6.4). */
const VERTICAL_ALIGN_ICONS: Record<CellVerticalAlign, LucideIcon> = {
  top: AlignStartVertical,
  middle: AlignCenterVertical,
  bottom: AlignEndVertical,
};

/** Label key per vertical-alignment value (R6.4). */
const VERTICAL_ALIGN_KEYS: Record<CellVerticalAlign, TranslationKey> = {
  top: "table.alignTop",
  middle: "table.alignMiddle",
  bottom: "table.alignBottom",
};

/**
 * @returns the floating table toolbar while the caret/selection is inside
 *          a table, else nothing.
 */
export default function TableToolbar(): ReactNode {
  const { t } = useTranslation();
  const session = useRichTextSession();
  const language = useUiStore((state) => state.language);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barSize, setBarSize] = useState(INITIAL_BAR_SIZE);

  const editor = session.editor;
  const inTable = editor !== null && isSelectionInTable(editor);

  const anchor = useMemo(
    () => (editor !== null && inTable ? measureAnchor(editor) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token drives re-measure
    [editor, inTable, session.token],
  );

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (bar === null) {
      return;
    }
    const width = bar.offsetWidth;
    const height = bar.offsetHeight;
    setBarSize((previous) =>
      Math.abs(previous.width - width) <= 1 &&
      Math.abs(previous.height - height) <= 1
        ? previous
        : { width, height },
    );
  }, [session.token, inTable]);

  if (!session.active || editor === null || !inTable || anchor === null) {
    return null;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  // Below the selection when the character bar occupies the space above;
  // above the caret when nothing else shows there.
  const formatBarVisible = session.selectionRect !== null;
  const left = Math.min(
    Math.max((anchor.left + anchor.right) / 2 - barSize.width / 2, EDGE_MARGIN),
    Math.max(EDGE_MARGIN, viewportWidth - EDGE_MARGIN - barSize.width),
  );
  const top = formatBarVisible
    ? Math.min(
        Math.max(anchor.bottom + ANCHOR_GAP, EDGE_MARGIN),
        Math.max(EDGE_MARGIN, viewportHeight - EDGE_MARGIN - barSize.height),
      )
    : Math.max(anchor.top - ANCHOR_GAP - barSize.height, EDGE_MARGIN);

  const dir = currentTableDirection(editor) ?? "rtl";
  const preset = currentTablePreset(editor) ?? "classic";
  const cellBackground = currentCellBackground(editor);
  const cellAlign = currentCellVerticalAlign(editor);

  const runChain = (
    command: (chain: ReturnType<Editor["chain"]>) => unknown,
  ): void => {
    command(editor.chain().focus());
  };

  return (
    <div
      ref={barRef}
      data-text-format-ui
      dir={language === "fa" ? "rtl" : "ltr"}
      aria-label={t("table.toolbarLabel")}
      style={{ left, top, width: "max-content" }}
      className={cn(
        "fixed z-40 -translate-x-1/2 rounded-2xl border border-border/60",
        "bg-background/90 px-2 py-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl",
        "animate-[panel-pop-in_0.2s_cubic-bezier(0.22,1,0.36,1)_both]",
        "max-w-[min(92vw,52rem)]",
      )}
    >
      <div className="flex items-center gap-1">
        <MenuButton
          icon={Rows3}
          labelKey="table.rows"
          entries={[
            {
              icon: Plus,
              labelKey: "table.insertRowBefore",
              run: () => runChain((chain) => chain.addRowBefore().run()),
              disabled: !editor.can().addRowBefore(),
            },
            {
              icon: Plus,
              labelKey: "table.insertRowAfter",
              run: () => runChain((chain) => chain.addRowAfter().run()),
              disabled: !editor.can().addRowAfter(),
            },
            {
              icon: Trash2,
              labelKey: "table.deleteRow",
              run: () => runChain((chain) => chain.deleteRow().run()),
              disabled: !editor.can().deleteRow(),
            },
          ]}
        />
        <MenuButton
          icon={Columns3}
          labelKey="table.columns"
          entries={[
            {
              icon: Plus,
              labelKey: "table.insertColumnBefore",
              run: () => runChain((chain) => chain.addColumnBefore().run()),
              disabled: !editor.can().addColumnBefore(),
            },
            {
              icon: Plus,
              labelKey: "table.insertColumnAfter",
              run: () => runChain((chain) => chain.addColumnAfter().run()),
              disabled: !editor.can().addColumnAfter(),
            },
            {
              icon: Trash2,
              labelKey: "table.deleteColumn",
              run: () => runChain((chain) => chain.deleteColumn().run()),
              disabled: !editor.can().deleteColumn(),
            },
          ]}
        />
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border/70" />
        <ToolButton
          icon={TableCellsMerge}
          labelKey="table.mergeCells"
          disabled={!editor.can().mergeCells()}
          onClick={() => runChain((chain) => chain.mergeCells().run())}
        />
        <MenuButton
          icon={TableCellsSplit}
          labelKey="table.splitCell"
          entries={[
            {
              icon: TableCellsSplit,
              labelKey: "table.splitCell",
              run: () => runChain((chain) => chain.splitCell().run()),
              disabled: !editor.can().splitCell(),
            },
            {
              icon: TableCellsSplit,
              labelKey: "table.splitCellHorizontal",
              run: () => splitCellAlongAxis(editor, "row"),
              disabled: !canSplitCellAlongAxis(editor, "row"),
            },
            {
              icon: TableCellsSplit,
              labelKey: "table.splitCellVertical",
              run: () => splitCellAlongAxis(editor, "column"),
              disabled: !canSplitCellAlongAxis(editor, "column"),
            },
          ]}
        />
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border/70" />
        <MenuButton
          icon={PanelTop}
          labelKey="table.toggleHeaderRow"
          entries={[
            {
              icon: PanelTop,
              labelKey: "table.toggleHeaderRow",
              run: () => runChain((chain) => chain.toggleHeaderRow().run()),
              disabled: !editor.can().toggleHeaderRow(),
            },
            {
              icon: PanelRight,
              labelKey: "table.toggleHeaderColumn",
              run: () => runChain((chain) => chain.toggleHeaderColumn().run()),
              disabled: !editor.can().toggleHeaderColumn(),
            },
          ]}
        />
        <ToolButton
          icon={ArrowLeftRight}
          labelKey="table.direction"
          hint={
            dir === "rtl" ? t("table.directionRtl") : t("table.directionLtr")
          }
          active={dir === "rtl"}
          onClick={() =>
            setTableDirection(editor, dir === "rtl" ? "ltr" : "rtl")
          }
        />
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border/70" />
        <MenuButton
          icon={
            cellAlign !== null
              ? VERTICAL_ALIGN_ICONS[cellAlign]
              : AlignCenterVertical
          }
          labelKey="table.verticalAlign"
          active={cellAlign !== null}
          entries={CELL_VERTICAL_ALIGNMENTS.map((align) => ({
            icon: VERTICAL_ALIGN_ICONS[align],
            labelKey: VERTICAL_ALIGN_KEYS[align],
            run: () => setCellVerticalAlign(editor, align),
            checked: cellAlign === align,
          }))}
        />
        <ToolButton
          icon={ArrowUpNarrowWide}
          labelKey="table.distributeColumns"
          disabled={!isSelectionInTable(editor)}
          onClick={() =>
            distributeTableColumns(editor, {
              minWidth: 40,
              fallbackWidth: measureTableColumnFallbackWidth(
                editor,
                findTableAncestor(editor),
              ),
            })
          }
        />
        <MenuButton
          icon={Palette}
          labelKey="table.preset"
          entries={TABLE_STYLE_PRESETS.map((presetName: TableStylePreset) => ({
            icon: ArrowUpToLine,
            labelKey: `table.preset.${presetName}` as TranslationKey,
            run: () => setTablePreset(editor, presetName),
            checked: presetName === preset,
          }))}
        />
        <CellBackgroundMenu
          current={cellBackground}
          onPick={(color) => setCellBackground(editor, color)}
        />
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border/70" />
        <MenuButton
          icon={Trash2}
          labelKey="table.deleteTable"
          entries={[
            {
              icon: Rows3,
              labelKey: "table.deleteRow",
              run: () => runChain((chain) => chain.deleteRow().run()),
              disabled: !editor.can().deleteRow(),
            },
            {
              icon: Columns3,
              labelKey: "table.deleteColumn",
              run: () => runChain((chain) => chain.deleteColumn().run()),
              disabled: !editor.can().deleteColumn(),
            },
            {
              icon: Trash2,
              labelKey: "table.deleteTable",
              run: () => runChain((chain) => chain.deleteTable().run()),
              disabled: !editor.can().deleteTable(),
            },
          ]}
        />
      </div>
    </div>
  );
}

/** Per-cell background palette (R6.4) — null clears the colour. */
function CellBackgroundMenu(props: {
  readonly current: string | null;
  readonly onPick: (color: string | null) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useCloseOnOutside(ref, open, setOpen);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t("table.cellBackground")}
        aria-expanded={open}
        title={t("table.cellBackground")}
        onMouseDown={preventFocusSteal}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "relative grid h-8 w-8 place-items-center rounded-lg outline-none",
          "transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring",
          open || (props.current !== null && props.current !== "transparent")
            ? "bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
        )}
      >
        <Paintbrush className="size-4" aria-hidden="true" />
        {props.current !== null && props.current !== "transparent" && (
          <span
            aria-hidden="true"
            className="absolute bottom-1 end-1 size-2 rounded-full border border-background"
            style={{ backgroundColor: props.current }}
          />
        )}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("table.cellBackground")}
          className="absolute top-9 z-50 w-44 rounded-xl border border-border/60 bg-background/95 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          <button
            type="button"
            role="menuitem"
            onMouseDown={preventFocusSteal}
            onClick={() => {
              setOpen(false);
              props.onPick(null);
            }}
            className={cn(
              "mb-1.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[12px]",
              "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              props.current === null
                ? "bg-primary/10 text-foreground"
                : "text-foreground/90 hover:bg-accent/70",
            )}
          >
            <span
              aria-hidden="true"
              className="size-3.5 rounded-[4px] border border-dashed border-border"
            />
            <span className="flex-1">{t("table.clearBackground")}</span>
          </button>
          <div className="grid grid-cols-6 gap-1.5">
            {HIGHLIGHT_PALETTE.slice(1).map((color) => (
              <button
                key={color}
                type="button"
                role="menuitemradio"
                aria-checked={color === props.current}
                aria-label={color}
                onMouseDown={preventFocusSteal}
                onClick={() => {
                  setOpen(false);
                  props.onPick(color);
                }}
                className={cn(
                  "size-5 rounded-md border border-black/20 outline-none",
                  "transition-transform focus-visible:ring-2 focus-visible:ring-ring",
                  color === props.current
                    ? "scale-110 ring-2 ring-ring"
                    : "hover:scale-105",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
