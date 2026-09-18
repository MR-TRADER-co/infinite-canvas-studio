"use client";

/**
 * Floating tool toolbar (R2-2, shape picker in R5, sticky picker in R9).
 *
 * A glassy pill docked at the bottom-center of the canvas area, above the
 * status bar: eight tool buttons (select, hand, pen, eraser, text, sticky,
 * shape, connector) bound to the UI store's `activeTool`. The shape button
 * opens a popover picker for the six primitives and the sticky button one
 * for the eight card colours — the picked value is stored in the UI store
 * and the button mirrors it (icon for shapes, a colour dot for sticky), so
 * the toolbar always shows what the next click will create. Tool order and
 * shortcut letters come from `TOOL_SHORTCUTS` — the single source of truth
 * shared with the keyboard hook and the empty-state hint. Every visible
 * string comes from the i18n dictionaries (CLAUDE.md §1.5).
 */
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
  Circle,
  CircleSlash,
  CornerDownRight,
  Diamond,
  Eraser,
  Frame,
  Hand,
  Highlighter as HighlighterIcon,
  Minus,
  MousePointer2,
  Pen,
  Shapes,
  Spline,
  Square,
  Squircle,
  Star,
  StickyNote,
  Table as TableIcon,
  Triangle,
  Type,
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
import TableGridPicker from "@/ui/components/toolbar/TableGridPicker";
import { SHAPE_KINDS, type ShapeKind } from "@/core/model/ShapeObject";
import PluginCommandCluster from "@/ui/components/toolbar/PluginCommandCluster";
import {
  CONNECTOR_ARROW_MODES,
  CONNECTOR_ROUTINGS,
  type ConnectorArrowMode,
  type ConnectorRoutingKind,
} from "@/core/model/ConnectorObject";
import type { StrokeStyleKind } from "@/core/model/FreehandObject";
import {
  stickySwatchOptions,
  strokeSwatchOptions,
} from "@/ui/components/panels/inspector/Controls";
import { TOOL_SHORTCUTS, shortcutLetter } from "@/ui/hooks/useToolShortcuts";
import { useTranslation } from "@/ui/i18n";
import type { TranslationKey } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import { useUiStore, PEN_WIDTH_PRESETS } from "@/ui/store/uiStore";
import type { ToolId } from "@/ui/store/uiStore";
import { dispatchCommand } from "@/ui/hooks/useCommands";
import { cn } from "@/lib/utils";

/** Font sizes (world units) offered by the text picker. */
const TEXT_FONT_SIZES = [14, 18, 20, 28, 36, 48] as const;

/** i18n key of every font-size label (type-safe: exhaustive). */
const FONT_SIZE_LABEL_KEYS: {
  [K in (typeof TEXT_FONT_SIZES)[number]]: TranslationKey;
} = {
  14: "text.size.14",
  18: "text.size.18",
  20: "text.size.20",
  28: "text.size.28",
  36: "text.size.36",
  48: "text.size.48",
};

/**
 * @param size - a font size in world units.
 * @returns the label key of a listed size, or null for custom values.
 */
function fontSizeLabelKey(size: number): TranslationKey | null {
  if (!(TEXT_FONT_SIZES as readonly number[]).includes(size)) {
    return null;
  }
  // REASON: the includes() guard proves the index is one of the listed keys.
  return FONT_SIZE_LABEL_KEYS[size as (typeof TEXT_FONT_SIZES)[number]];
}

/** Icon of every tool button (same mapping as the status bar). */
const TOOL_ICONS: { [K in ToolId]: LucideIcon } = {
  select: MousePointer2,
  hand: Hand,
  pen: Pen,
  eraser: Eraser,
  text: Type,
  sticky: StickyNote,
  table: TableIcon,
  shape: Shapes,
  connector: Spline,
};

/** Icon of the shape button for every picked primitive. */
const SHAPE_KIND_ICONS: { [K in ShapeKind]: LucideIcon } = {
  rectangle: Square,
  roundedRectangle: Squircle,
  ellipse: Circle,
  triangle: Triangle,
  diamond: Diamond,
  star: Star,
};

/** i18n key of every tool label (type-safe: exhaustively mapped). */
const TOOL_LABEL_KEYS: { [K in ToolId]: TranslationKey } = {
  select: "tool.select",
  hand: "tool.hand",
  pen: "tool.pen",
  eraser: "tool.eraser",
  text: "tool.text",
  sticky: "tool.sticky",
  table: "tool.table",
  shape: "tool.shape",
  connector: "tool.connector",
};

/** i18n key of every shape primitive label (type-safe: exhaustive). */
const SHAPE_KIND_LABEL_KEYS: { [K in ShapeKind]: TranslationKey } = {
  rectangle: "shape.kind.rectangle",
  roundedRectangle: "shape.kind.roundedRectangle",
  ellipse: "shape.kind.ellipse",
  triangle: "shape.kind.triangle",
  diamond: "shape.kind.diamond",
  star: "shape.kind.star",
};

/** Icon of every connector routing option. */
const ROUTING_ICONS: { [K in ConnectorRoutingKind]: LucideIcon } = {
  straight: Minus,
  orthogonal: CornerDownRight,
  curved: Spline,
};

/** i18n key of every connector routing label (type-safe: exhaustive). */
const ROUTING_LABEL_KEYS: { [K in ConnectorRoutingKind]: TranslationKey } = {
  straight: "connector.routing.straight",
  orthogonal: "connector.routing.orthogonal",
  curved: "connector.routing.curved",
};

/** Icon of every connector arrow option. */
const ARROW_ICONS: { [K in ConnectorArrowMode]: LucideIcon } = {
  none: CircleSlash,
  end: ArrowRight,
  both: ArrowLeftRight,
};

/** i18n key of every connector arrow label (type-safe: exhaustive). */
const ARROW_LABEL_KEYS: { [K in ConnectorArrowMode]: TranslationKey } = {
  none: "connector.arrow.none",
  end: "connector.arrow.end",
  both: "connector.arrow.both",
};

/** Dash patterns offered by the connector picker (same list as strokes). */
const CONNECTOR_DASHES: readonly StrokeStyleKind[] = [
  "solid",
  "dashed",
  "dotted",
];

/** i18n key of every connector dash label (type-safe: exhaustive). */
const DASH_LABEL_KEYS: { [K in StrokeStyleKind]: TranslationKey } = {
  solid: "connector.dash.solid",
  dashed: "connector.dash.dashed",
  dotted: "connector.dash.dotted",
};

/** Hover-to-tooltip delay shared by every tool button. */
const TOOLTIP_DELAY_MS = 300;

/**
 * @returns the floating toolbar; mounts inside the canvas wrapper of
 * `AppShell` (an `absolute` overlay over the canvas, so it never
 * reflows the canvas layout).
 */
export default function Toolbar() {
  const { t, language } = useTranslation();
  const activeTool = useUiStore((state) => state.activeTool);
  const setActiveTool = useUiStore((state) => state.setActiveTool);
  const shapeKind = useUiStore((state) => state.shapeKind);
  const setShapeKind = useUiStore((state) => state.setShapeKind);
  const fontSize = useUiStore((state) => state.fontSize);
  const setFontSize = useUiStore((state) => state.setFontSize);
  const stickyColor = useUiStore((state) => state.stickyColor);
  const setStickyColor = useUiStore((state) => state.setStickyColor);
  const tableRows = useUiStore((state) => state.tableRows);
  const tableColumns = useUiStore((state) => state.tableColumns);
  const setTableRows = useUiStore((state) => state.setTableRows);
  const setTableColumns = useUiStore((state) => state.setTableColumns);
  const connectorRouting = useUiStore((state) => state.connectorRouting);
  const setConnectorRouting = useUiStore((state) => state.setConnectorRouting);
  const connectorArrow = useUiStore((state) => state.connectorArrow);
  const setConnectorArrow = useUiStore((state) => state.setConnectorArrow);
  const connectorDash = useUiStore((state) => state.connectorDash);
  const setConnectorDash = useUiStore((state) => state.setConnectorDash);
  const connectorColor = useUiStore((state) => state.connectorColor);
  const setConnectorColor = useUiStore((state) => state.setConnectorColor);
  const penColor = useUiStore((state) => state.penColor);
  const setPenColor = useUiStore((state) => state.setPenColor);
  const penWidth = useUiStore((state) => state.penWidth);
  const setPenWidth = useUiStore((state) => state.setPenWidth);
  const penHighlighter = useUiStore((state) => state.penHighlighter);
  const setPenHighlighter = useUiStore((state) => state.setPenHighlighter);
  const theme = useUiStore((state) => state.theme);

  const ShapeKindIcon = SHAPE_KIND_ICONS[shapeKind];
  const stickySwatches = stickySwatchOptions();
  const stickyColorLabelKey =
    stickySwatches.find((option) => option.value === stickyColor)?.labelKey ??
    "inspector.color";
  const connectorSwatches = strokeSwatchOptions(theme);
  const penSwatches = strokeSwatchOptions(theme);

  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      {/* Auto-margin centring (inset-x-0 + mx-auto + w-fit) is
          direction-neutral AND lets the pill keep its natural width on
          narrow viewports (a left-1/2 + translate element would
          shrink-to-fit into the space right of the 50% mark only). */}
      <div
        role="toolbar"
        aria-orientation="horizontal"
        aria-label={t("toolbar.label")}
        className="absolute inset-x-0 bottom-6 z-10 mx-auto flex w-fit max-w-[calc(100vw-2.5rem)] flex-wrap justify-center gap-1 rounded-2xl border border-border/60 bg-background/80 px-2 py-2 shadow-2xl shadow-black/30 backdrop-blur-xl animate-[toolbar-rise-in_0.45s_cubic-bezier(0.22,1,0.36,1)_both]"
      >
        {TOOL_SHORTCUTS.map(({ tool, code }) => {
          const isActive = tool === activeTool;
          const isShapeButton = tool === "shape";
          const isTextButton = tool === "text";
          const isStickyButton = tool === "sticky";
          const isTableButton = tool === "table";
          const isConnectorButton = tool === "connector";
          const isPenButton = tool === "pen";
          const textSizeKey = isTextButton ? fontSizeLabelKey(fontSize) : null;
          const ToolIcon = isShapeButton
            ? ShapeKindIcon
            : isPenButton && penHighlighter
              ? HighlighterIcon
              : TOOL_ICONS[tool];
          const isPickerButton =
            isShapeButton ||
            isTextButton ||
            isStickyButton ||
            isTableButton ||
            isConnectorButton ||
            isPenButton;
          const button = (
            <button
              type="button"
              aria-pressed={isActive}
              aria-label={
                isShapeButton
                  ? `${t(TOOL_LABEL_KEYS[tool])} — ${t(SHAPE_KIND_LABEL_KEYS[shapeKind])}`
                  : isTextButton
                    ? `${t(TOOL_LABEL_KEYS[tool])} — ${formatInteger(fontSize, language)}px`
                    : isStickyButton
                      ? `${t(TOOL_LABEL_KEYS[tool])} — ${t(stickyColorLabelKey)}`
                      : isTableButton
                        ? `${t(TOOL_LABEL_KEYS[tool])} — ${formatInteger(tableColumns, language)}×${formatInteger(tableRows, language)}`
                        : isConnectorButton
                          ? `${t(TOOL_LABEL_KEYS[tool])} — ${t(ROUTING_LABEL_KEYS[connectorRouting])}`
                          : isPenButton
                            ? `${t(TOOL_LABEL_KEYS[tool])} — ${penHighlighter ? t("pen.highlighter") : t("pen.pen")} · ${formatInteger(penWidth, language)}px`
                            : t(TOOL_LABEL_KEYS[tool])
              }
              onClick={() => setActiveTool(tool)}
              className={cn(
                "relative grid size-11 place-items-center rounded-xl outline-none transition-all duration-200",
                "focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-accent text-accent-foreground shadow-inner ring-1 ring-border/80"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <ToolIcon
                aria-hidden="true"
                className={cn(
                  "size-5 transition-transform duration-200",
                  isActive ? "scale-110" : "scale-100",
                )}
              />
              {/* Shortcut letter badge pinned to the top-end corner — the
                  physical-key hint is visible at a glance, not only in the
                  tooltip (V · H · P · E · T · S · C). */}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute end-1 top-0.5 font-mono text-[9px] leading-none transition-opacity duration-200",
                  isActive
                    ? "text-accent-foreground/60"
                    : "text-muted-foreground/60",
                )}
              >
                {shortcutLetter(code)}
              </span>
              {/* Active indicator: accent dot pinned near the bottom edge
                  (hidden on the picker buttons, where a dedicated badge
                  sits). */}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary transition-opacity duration-200",
                  isActive ? "opacity-100" : "opacity-0",
                  isPickerButton && "opacity-0",
                )}
              />
              {/* Sticky button: colour dot previewing the picked card
                  colour (takes the accent dot's place). */}
              {isStickyButton ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-black/25 shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
                  style={{ backgroundColor: stickyColor }}
                />
              ) : null}
              {/* Connector button: dash-style preview strip in the picked
                  line style (takes the accent dot's place). */}
              {isConnectorButton ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-[7px] left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-primary"
                  style={dashPreviewStyle(connectorDash)}
                />
              ) : null}
              {/* Table button: mini-grid preview of the picked table
                  dimensions (takes the accent dot's place). */}
              {isTableButton ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-[7px] left-1/2 grid -translate-x-1/2 grid-cols-2 gap-[2px]"
                >
                  {[0, 1, 2, 3].map((cell) => (
                    <span
                      key={cell}
                      className="size-[3.5px] rounded-[1px] bg-primary transition-opacity duration-200"
                      style={{ opacity: isActive ? 1 : 0.55 }}
                    />
                  ))}
                </span>
              ) : null}
              {/* Picker buttons: chevron badge hinting at the popover. */}
              {isPickerButton ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 right-1 grid size-3.5 place-items-center rounded-[4px] bg-primary/25 text-primary"
                >
                  <ChevronDown className="size-2.5" strokeWidth={3} />
                </span>
              ) : null}
            </button>
          );

          return (
            <Tooltip key={tool} delayDuration={TOOLTIP_DELAY_MS}>
              <TooltipTrigger asChild>
                {isShapeButton ? (
                  <Popover>
                    <PopoverTrigger asChild>{button}</PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="center"
                      sideOffset={12}
                      className="w-auto p-2"
                      aria-label={t("toolbar.shapePicker")}
                    >
                      <p className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground">
                        {t("toolbar.shapePicker")}
                      </p>
                      <div
                        role="group"
                        aria-label={t("toolbar.shapePicker")}
                        className="grid grid-cols-3 gap-1"
                      >
                        {SHAPE_KINDS.map((kind) => {
                          const KindIcon = SHAPE_KIND_ICONS[kind];
                          const kindActive = kind === shapeKind;
                          return (
                            <button
                              key={kind}
                              type="button"
                              role="radio"
                              aria-checked={kindActive}
                              aria-label={t(SHAPE_KIND_LABEL_KEYS[kind])}
                              title={t(SHAPE_KIND_LABEL_KEYS[kind])}
                              onClick={() => {
                                setShapeKind(kind);
                                setActiveTool("shape");
                              }}
                              className={cn(
                                "group flex w-16 flex-col items-center gap-1 rounded-lg border px-1.5 py-2 outline-none transition-all duration-150",
                                "focus-visible:ring-2 focus-visible:ring-ring",
                                kindActive
                                  ? "border-primary/50 bg-primary/10 text-foreground"
                                  : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                              )}
                            >
                              <KindIcon
                                aria-hidden="true"
                                className={cn(
                                  "size-5 transition-transform duration-150",
                                  kindActive
                                    ? "scale-110 text-primary"
                                    : "group-hover:scale-105",
                                )}
                              />
                              <span className="text-[10px] leading-tight">
                                {t(SHAPE_KIND_LABEL_KEYS[kind])}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : isTextButton ? (
                  <Popover>
                    <PopoverTrigger asChild>{button}</PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="center"
                      sideOffset={12}
                      className="w-auto p-2"
                      aria-label={t("toolbar.textPicker")}
                    >
                      <p className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground">
                        {t("toolbar.textPicker")}
                      </p>
                      <div
                        role="group"
                        aria-label={t("toolbar.textPicker")}
                        className="grid grid-cols-3 gap-1"
                      >
                        {TEXT_FONT_SIZES.map((size) => {
                          const sizeActive = size === fontSize;
                          return (
                            <button
                              key={size}
                              type="button"
                              role="radio"
                              aria-checked={sizeActive}
                              aria-label={t(FONT_SIZE_LABEL_KEYS[size])}
                              title={t(FONT_SIZE_LABEL_KEYS[size])}
                              onClick={() => {
                                setFontSize(size);
                                setActiveTool("text");
                              }}
                              className={cn(
                                "group flex w-16 flex-col items-center gap-0.5 rounded-lg border px-1.5 py-2 outline-none transition-all duration-150",
                                "focus-visible:ring-2 focus-visible:ring-ring",
                                sizeActive
                                  ? "border-primary/50 bg-primary/10 text-foreground"
                                  : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                              )}
                            >
                              <span
                                aria-hidden="true"
                                className={cn(
                                  "font-semibold leading-none transition-transform duration-150",
                                  sizeActive
                                    ? "scale-110 text-primary"
                                    : "text-foreground/80 group-hover:scale-105",
                                )}
                                style={{ fontSize: `${Math.min(size, 22)}px` }}
                              >
                                {formatInteger(size, language)}
                              </span>
                              <span className="text-[10px] leading-tight">
                                {t(FONT_SIZE_LABEL_KEYS[size])}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : isStickyButton ? (
                  <Popover>
                    <PopoverTrigger asChild>{button}</PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="center"
                      sideOffset={12}
                      className="w-auto p-2"
                      aria-label={t("toolbar.stickyPicker")}
                    >
                      <p className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground">
                        {t("toolbar.stickyPicker")}
                      </p>
                      <div
                        role="group"
                        aria-label={t("toolbar.stickyPicker")}
                        className="grid grid-cols-4 gap-1"
                      >
                        {stickySwatches.map((option) => {
                          const colorActive = option.value === stickyColor;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="radio"
                              aria-checked={colorActive}
                              aria-label={t(option.labelKey)}
                              title={t(option.labelKey)}
                              onClick={() => {
                                setStickyColor(option.value);
                                setActiveTool("sticky");
                              }}
                              className={cn(
                                "group flex w-14 flex-col items-center gap-1 rounded-lg border px-1.5 py-2 outline-none transition-all duration-150",
                                "focus-visible:ring-2 focus-visible:ring-ring",
                                colorActive
                                  ? "border-primary/50 bg-primary/10 text-foreground"
                                  : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                              )}
                            >
                              <span
                                aria-hidden="true"
                                className={cn(
                                  "size-6 rounded-md border border-black/20 transition-transform duration-150",
                                  "shadow-[0_2px_6px_rgba(0,0,0,0.35)]",
                                  colorActive
                                    ? "scale-110"
                                    : "group-hover:scale-105",
                                )}
                                style={{ backgroundColor: option.preview }}
                              />
                              <span className="text-[10px] leading-tight">
                                {t(option.labelKey)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : isTableButton ? (
                  <Popover>
                    <PopoverTrigger asChild>{button}</PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="center"
                      sideOffset={12}
                      className="w-auto p-3"
                      aria-label={t("toolbar.tablePicker")}
                    >
                      <p className="mb-2 px-1 text-[11px] font-medium text-muted-foreground">
                        {t("toolbar.tablePicker")}
                      </p>
                      <TableGridPicker
                        rows={tableRows}
                        cols={tableColumns}
                        onPick={(rows, cols) => {
                          setTableRows(rows);
                          setTableColumns(cols);
                          setActiveTool("table");
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                ) : isPenButton ? (
                  <Popover>
                    <PopoverTrigger asChild>{button}</PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="center"
                      sideOffset={12}
                      className="w-auto p-2"
                      aria-label={t("toolbar.penPicker")}
                    >
                      <PenPicker
                        color={penColor}
                        onColor={(color) => {
                          setPenColor(color);
                          setActiveTool("pen");
                        }}
                        width={penWidth}
                        onWidth={(width) => {
                          setPenWidth(width);
                          setActiveTool("pen");
                        }}
                        highlighter={penHighlighter}
                        onHighlighter={(highlighter) => {
                          setPenHighlighter(highlighter);
                          setActiveTool("pen");
                        }}
                        swatches={penSwatches}
                      />
                    </PopoverContent>
                  </Popover>
                ) : isConnectorButton ? (
                  <Popover>
                    <PopoverTrigger asChild>{button}</PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="center"
                      sideOffset={12}
                      className="w-auto p-2"
                      aria-label={t("toolbar.connectorPicker")}
                    >
                      <ConnectorPicker
                        routing={connectorRouting}
                        onRouting={(routing) => {
                          setConnectorRouting(routing);
                          setActiveTool("connector");
                        }}
                        arrow={connectorArrow}
                        onArrow={(arrow) => {
                          setConnectorArrow(arrow);
                          setActiveTool("connector");
                        }}
                        dash={connectorDash}
                        onDash={(dash) => {
                          setConnectorDash(dash);
                          setActiveTool("connector");
                        }}
                        color={connectorColor}
                        onColor={(color) => {
                          setConnectorColor(color);
                          setActiveTool("connector");
                        }}
                        swatches={connectorSwatches}
                      />
                    </PopoverContent>
                  </Popover>
                ) : (
                  button
                )}
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={10}
                className="flex items-center whitespace-nowrap"
              >
                <span className="font-medium">{t(TOOL_LABEL_KEYS[tool])}</span>
                {isShapeButton ? (
                  <span className="ms-1.5 text-primary-foreground/70">
                    · {t(SHAPE_KIND_LABEL_KEYS[shapeKind])}
                  </span>
                ) : null}
                {isTextButton ? (
                  <span className="ms-1.5 text-primary-foreground/70">
                    · {formatInteger(fontSize, language)}px
                    {textSizeKey !== null ? ` · ${t(textSizeKey)}` : ""}
                  </span>
                ) : null}
                {isTableButton ? (
                  <span className="ms-1.5 text-primary-foreground/70">
                    · {formatInteger(tableColumns, language)}×
                    {formatInteger(tableRows, language)}
                  </span>
                ) : null}
                {isConnectorButton ? (
                  <span className="ms-1.5 text-primary-foreground/70">
                    · {t(ROUTING_LABEL_KEYS[connectorRouting])} ·{" "}
                    {t(DASH_LABEL_KEYS[connectorDash])}
                  </span>
                ) : null}
                {isPenButton ? (
                  <span className="ms-1.5 text-primary-foreground/70">
                    · {penHighlighter ? t("pen.highlighter") : t("pen.pen")} ·{" "}
                    {formatInteger(penWidth, language)}px
                  </span>
                ) : null}
                {isActive && !isPickerButton ? (
                  <span className="ms-2 rounded-full border border-primary-foreground/25 px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground/85">
                    {t("toolbar.active")}
                  </span>
                ) : null}
                <kbd className="ms-2 rounded border border-primary-foreground/20 bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
                  {shortcutLetter(code)}
                </kbd>
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* R8.3: the Frame insert action — a titled presentation container
            at the viewport centre (ONE undo step; identical to the Insert
            Panel card). */}
        <Tooltip delayDuration={TOOLTIP_DELAY_MS}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("tool.frame")}
              title={t("tool.frame")}
              onClick={() => dispatchCommand("core.insert.frame")}
              className="relative grid size-11 place-items-center rounded-xl outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            >
              <Frame
                className="size-5 scale-100 transition-transform duration-200"
                aria-hidden="true"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            sideOffset={10}
            className="flex items-center whitespace-nowrap"
          >
            <span className="font-medium">{t("tool.frame")}</span>
          </TooltipContent>
        </Tooltip>

        {/* R9.9/AC9.1: plugin-registered commands (host-generic strip). */}
        <PluginCommandCluster />
      </div>
    </TooltipProvider>
  );
}

/**
 * Builds the inline style previewing a dash pattern on the connector
 * button strip (solid line, dashed line, dotted dots).
 *
 * @param dash - the picked dash style.
 * @returns the CSS style object for the preview strip.
 */
function dashPreviewStyle(dash: StrokeStyleKind): React.CSSProperties {
  if (dash === "dashed") {
    return {
      backgroundImage:
        "linear-gradient(to right, currentColor 55%, transparent 55%, transparent 75%, currentColor 75%)",
      backgroundSize: "8px 100%",
      backgroundRepeat: "repeat-x",
    };
  }
  if (dash === "dotted") {
    return {
      backgroundImage:
        "radial-gradient(circle, currentColor 38%, transparent 40%)",
      backgroundSize: "6px 100%",
      backgroundRepeat: "repeat-x",
      backgroundPosition: "center",
    };
  }
  return {};
}

/** Props of the connector options picker (fully controlled). */
interface ConnectorPickerProps {
  readonly routing: ConnectorRoutingKind;
  readonly onRouting: (routing: ConnectorRoutingKind) => void;
  readonly arrow: ConnectorArrowMode;
  readonly onArrow: (arrow: ConnectorArrowMode) => void;
  readonly dash: StrokeStyleKind;
  readonly onDash: (dash: StrokeStyleKind) => void;
  readonly color: string;
  readonly onColor: (color: string) => void;
  readonly swatches: readonly {
    value: string;
    preview: string;
    labelKey: TranslationKey;
  }[];
}

/** Shared classes of one compact picker option button. */
const OPTION_BASE =
  "group flex flex-col items-center gap-1 rounded-lg border px-2 py-1.5 outline-none " +
  "transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The connector options picker: four labelled rows — routing strategy,
 * arrow placement, dash pattern and stroke colour — each a compact radio
 * group mirroring the shared toolbar picker styling.
 *
 * @param props - the controlled picker props.
 * @returns the popover panel content.
 */
function ConnectorPicker({
  routing,
  onRouting,
  arrow,
  onArrow,
  dash,
  onDash,
  color,
  onColor,
  swatches,
}: ConnectorPickerProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className="w-56 space-y-2.5"
      role="group"
      aria-label={t("toolbar.connectorPicker")}
    >
      {/* Routing strategy. */}
      <div>
        <p className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">
          {t("inspector.routing")}
        </p>
        <div className="grid grid-cols-3 gap-1">
          {CONNECTOR_ROUTINGS.map((kind) => {
            const KindIcon = ROUTING_ICONS[kind];
            const kindActive = kind === routing;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={kindActive}
                aria-label={t(ROUTING_LABEL_KEYS[kind])}
                title={t(ROUTING_LABEL_KEYS[kind])}
                onClick={() => onRouting(kind)}
                className={cn(
                  OPTION_BASE,
                  kindActive
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <KindIcon
                  aria-hidden="true"
                  className={cn(
                    "size-4 transition-transform duration-150",
                    kindActive
                      ? "scale-110 text-primary"
                      : "group-hover:scale-105",
                  )}
                />
                <span className="text-[10px] leading-tight">
                  {t(ROUTING_LABEL_KEYS[kind])}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Arrow placement. */}
      <div>
        <p className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">
          {t("inspector.arrow")}
        </p>
        <div className="grid grid-cols-3 gap-1">
          {CONNECTOR_ARROW_MODES.map((mode) => {
            const ModeIcon = ARROW_ICONS[mode];
            const modeActive = mode === arrow;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={modeActive}
                aria-label={t(ARROW_LABEL_KEYS[mode])}
                title={t(ARROW_LABEL_KEYS[mode])}
                onClick={() => onArrow(mode)}
                className={cn(
                  OPTION_BASE,
                  modeActive
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <ModeIcon
                  aria-hidden="true"
                  className={cn(
                    "size-4 transition-transform duration-150",
                    modeActive
                      ? "scale-110 text-primary"
                      : "group-hover:scale-105",
                  )}
                />
                <span className="text-[10px] leading-tight">
                  {t(ARROW_LABEL_KEYS[mode])}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Dash pattern — live line previews drawn with CSS. */}
      <div>
        <p className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">
          {t("inspector.dash")}
        </p>
        <div className="grid grid-cols-3 gap-1">
          {CONNECTOR_DASHES.map((pattern) => {
            const patternActive = pattern === dash;
            return (
              <button
                key={pattern}
                type="button"
                role="radio"
                aria-checked={patternActive}
                aria-label={t(DASH_LABEL_KEYS[pattern])}
                title={t(DASH_LABEL_KEYS[pattern])}
                onClick={() => onDash(pattern)}
                className={cn(
                  OPTION_BASE,
                  patternActive
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-0.5 w-7 rounded-full",
                    patternActive ? "bg-primary" : "bg-muted-foreground/70",
                  )}
                  style={dashPreviewStyle(pattern)}
                />
                <span className="text-[10px] leading-tight">
                  {t(DASH_LABEL_KEYS[pattern])}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Stroke colour swatches. */}
      <div>
        <p className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">
          {t("inspector.color")}
        </p>
        <div className="flex flex-wrap gap-1 px-1 pb-0.5">
          {swatches.map((option) => {
            const colorActive = option.value === color;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={colorActive}
                aria-label={t(option.labelKey)}
                title={t(option.labelKey)}
                onClick={() => onColor(option.value)}
                className={cn(
                  "grid size-6 place-items-center rounded-full outline-none transition-transform duration-150",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  colorActive
                    ? "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : "hover:scale-105",
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-4 rounded-full border border-black/25 shadow-[0_1px_3px_rgba(0,0,0,0.35)]"
                  style={{ backgroundColor: option.preview }}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Props of the pen options picker (fully controlled). */
interface PenPickerProps {
  readonly color: string;
  readonly onColor: (color: string) => void;
  readonly width: number;
  readonly onWidth: (width: number) => void;
  readonly highlighter: boolean;
  readonly onHighlighter: (highlighter: boolean) => void;
  readonly swatches: readonly {
    value: string;
    preview: string;
    labelKey: TranslationKey;
  }[];
}

/** i18n key of every pen width preset label (1-based index). */
const PEN_WIDTH_LABEL_KEYS: readonly TranslationKey[] = [
  "inspector.width.2",
  "inspector.width.4",
  "inspector.width.8",
  "inspector.width.16",
];

/**
 * The pen options picker (R5.4): three labelled rows — the ink mode (pen
 * vs highlighter), the stroke width presets and the stroke colour — each a
 * compact radio group mirroring the shared toolbar picker styling.
 *
 * @param props - the controlled picker props.
 * @returns the popover panel content.
 */
function PenPicker({
  color,
  onColor,
  width,
  onWidth,
  highlighter,
  onHighlighter,
  swatches,
}: PenPickerProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className="w-56 space-y-2.5"
      role="group"
      aria-label={t("toolbar.penPicker")}
    >
      {/* Ink mode: pen vs highlighter (R5.4). */}
      <div>
        <p className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">
          {t("pen.mode")}
        </p>
        <div className="grid grid-cols-2 gap-1">
          {[false, true].map((mode) => {
            const modeActive = mode === highlighter;
            const ModeIcon = mode ? HighlighterIcon : Pen;
            return (
              <button
                key={mode ? "highlighter" : "pen"}
                type="button"
                role="radio"
                aria-checked={modeActive}
                aria-label={t(mode ? "pen.highlighter" : "pen.pen")}
                title={t(mode ? "pen.highlighter" : "pen.pen")}
                onClick={() => onHighlighter(mode)}
                className={cn(
                  OPTION_BASE,
                  modeActive
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <ModeIcon
                  aria-hidden="true"
                  className={cn(
                    "size-4 transition-transform duration-150",
                    modeActive
                      ? "scale-110 text-primary"
                      : "group-hover:scale-105",
                  )}
                />
                <span className="text-[10px] leading-tight">
                  {t(mode ? "pen.highlighter" : "pen.pen")}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Stroke width presets — live thickness previews. */}
      <div>
        <p className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">
          {t("inspector.width")}
        </p>
        <div className="grid grid-cols-4 gap-1">
          {PEN_WIDTH_PRESETS.map((preset, index) => {
            const presetActive = preset === width;
            const labelKey = PEN_WIDTH_LABEL_KEYS[index] ?? "inspector.color";
            return (
              <button
                key={preset}
                type="button"
                role="radio"
                aria-checked={presetActive}
                aria-label={t(labelKey)}
                title={t(labelKey)}
                onClick={() => onWidth(preset)}
                className={cn(
                  OPTION_BASE,
                  presetActive
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "w-7 rounded-full",
                    presetActive ? "bg-primary" : "bg-muted-foreground/70",
                    highlighter ? "opacity-50" : "",
                  )}
                  style={{ height: `${Math.min(preset, 10) / 2 + 1}px` }}
                />
                <span className="text-[10px] leading-tight">{preset}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Stroke colour swatches. */}
      <div>
        <p className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">
          {t("inspector.color")}
        </p>
        <div className="flex flex-wrap gap-1 px-1 pb-0.5">
          {swatches.map((option) => {
            const colorActive = option.value === color;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={colorActive}
                aria-label={t(option.labelKey)}
                title={t(option.labelKey)}
                onClick={() => onColor(option.value)}
                className={cn(
                  "grid size-6 place-items-center rounded-full outline-none transition-transform duration-150",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  colorActive
                    ? "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : "hover:scale-105",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-4 rounded-full border border-black/25 shadow-[0_1px_3px_rgba(0,0,0,0.35)]",
                    highlighter ? "opacity-50" : "",
                  )}
                  style={{ backgroundColor: option.preview }}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
