"use client";

/**
 * Bottom status bar of the shell.
 *
 * Under RTL the DOM order reads right→left, so the first group (tool, zoom,
 * position, objects, ready state) sits on the right (inline start) and the
 * last group (undo/redo, language and theme toggles, version) is pushed to
 * the left (inline end) with `ms-auto`. Every visible string comes from the
 * i18n dictionaries; numbers are localised (Persian digits).
 */
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Check,
  CloudUpload,
  Eraser,
  Hand,
  Languages,
  Magnet,
  Maximize2,
  MousePointer2,
  Moon,
  Pen,
  Redo2,
  RotateCw,
  Search,
  Settings2,
  Shapes,
  Spline,
  StickyNote,
  Sun,
  Table as TableIcon,
  Type,
  Undo2,
  WifiOff,
} from "lucide-react";
import type { SaveState } from "@/ui/hooks/useCanvasStatus";
import { useTranslation } from "@/ui/i18n";
import type { TranslationKey } from "@/ui/i18n";
import { formatCoords, formatInteger, formatZoom } from "@/ui/i18n/numbers";
import { useCanvasStatus } from "@/ui/hooks/useCanvasStatus";
import { useActiveTextCounts } from "@/ui/hooks/useActiveTextCounts";
import { dispatchCommand } from "@/ui/hooks/useCommands";
import { requestFindPanel } from "@/ui/text/intents";
import { useUiStore } from "@/ui/store/uiStore";
import type { ToolId } from "@/ui/store/uiStore";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";

/** Icon of every tool, shown next to the active-tool label. */
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

/** Shared classes of the compact status-bar buttons (≈32px touch target). */
const BUTTON_BASE =
  "inline-flex h-8 w-8 items-center justify-center rounded-md " +
  "text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:pointer-events-none disabled:opacity-40";

export default function StatusBar() {
  const { t, language, setLanguage } = useTranslation();
  const activeTool = useUiStore((state) => state.activeTool);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const setSettingsOpen = useUiStore((state) => state.setSettingsDialogOpen);
  const persianDigits = useUiStore((state) => state.persianDigits);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const toggleSnap = useUiStore((state) => state.toggleSnap);
  const status = useCanvasStatus();
  const counts = useActiveTextCounts();

  const ToolIcon = TOOL_ICONS[activeTool];
  const ThemeToggleIcon = theme === "dark" ? Sun : Moon;
  const currentLanguageName = language === "fa" ? t("lang.fa") : t("lang.en");
  // R3B.7: every UI numeral honours the Persian-digits setting.
  const locale = { language, persianDigits };
  const zoomText = formatZoom(status.zoom, locale);
  const countsText =
    counts === null
      ? ""
      : t("status.counts")
          .replace("{words}", formatInteger(counts.words, locale))
          .replace("{characters}", formatInteger(counts.characters, locale));
  const savedAtText =
    status.lastSavedAt === null
      ? ""
      : new Intl.DateTimeFormat(language === "fa" ? "fa-IR" : "en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(status.lastSavedAt));

  return (
    <footer className="flex h-10 flex-none items-center gap-3 border-t border-border bg-background/95 px-3 text-xs text-muted-foreground backdrop-blur-md">
      {/* Start group (right side under RTL): tool, zoom, position, objects. */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground/70">{t("status.tool")}</span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-medium text-foreground">
            <span
              className="size-1.5 rounded-full bg-primary"
              aria-hidden="true"
            />
            <ToolIcon className="size-3.5" aria-hidden="true" />
            {t(TOOL_LABEL_KEYS[activeTool])}
          </span>
        </span>

        <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />

        {/* Live zoom chip — clicking it resets the view to 100%. */}
        <button
          type="button"
          onClick={resetZoom}
          title={t("a11y.resetZoom")}
          aria-label={`${t("status.zoom")}: ${zoomText} — ${t("a11y.resetZoom")}`}
          className="rounded-md px-1.5 py-0.5 font-medium tabular-nums text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {zoomText}
        </button>

        <span
          className="h-4 w-px shrink-0 bg-border md:block"
          aria-hidden="true"
        />

        {/* Pointer world position readout. */}
        <span
          className="hidden font-medium tabular-nums md:inline"
          title={t("a11y.position")}
          aria-label={t("a11y.position")}
        >
          {status.pointer === null
            ? "—"
            : formatCoords(status.pointer.x, status.pointer.y, locale)}
        </span>

        <span
          className="hidden h-4 w-px shrink-0 bg-border md:block"
          aria-hidden="true"
        />

        {/* Live object count. */}
        <span className="hidden items-center gap-1.5 font-medium tabular-nums sm:inline-flex">
          <span className="text-muted-foreground/70">
            {t("status.objects")}
          </span>
          {formatInteger(status.objectCount, locale)}
        </span>

        {/* Live selection count — accent chip while something is selected. */}
        <span
          role="status"
          aria-live="polite"
          aria-label={t("status.selected")}
          title={`${t("status.selected")} — Del: ${t("a11y.deleteSelection")} · Ctrl+D · Esc`}
          className={
            "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-medium tabular-nums transition-opacity duration-200 " +
            (status.selectionSize > 0
              ? "border-primary/40 bg-primary/10 text-foreground opacity-100"
              : "border-transparent opacity-0 pointer-events-none")
          }
        >
          <MousePointer2 className="size-3 text-primary" aria-hidden="true" />
          {formatInteger(status.selectionSize, locale)}
        </span>

        {/* Live W×H readout while a resize gesture runs (accent chip). */}
        <span
          role="status"
          aria-live="polite"
          aria-label={t("a11y.dimensions")}
          title={t("a11y.dimensions")}
          className={
            "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-medium tabular-nums transition-opacity duration-150 " +
            (status.resizeDims !== null
              ? "border-primary/40 bg-primary/10 text-foreground opacity-100"
              : "border-transparent opacity-0 pointer-events-none")
          }
        >
          <Maximize2 className="size-3 text-primary" aria-hidden="true" />
          {status.resizeDims === null
            ? ""
            : `${formatInteger(status.resizeDims.width, locale)} × ${formatInteger(status.resizeDims.height, locale)}`}
        </span>

        {/* Live angle readout while a rotation gesture runs (accent chip). */}
        <span
          role="status"
          aria-live="polite"
          aria-label={t("a11y.rotation")}
          title={t("a11y.rotation")}
          className={
            "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-medium tabular-nums transition-opacity duration-150 " +
            (status.rotationDeg !== null
              ? "border-primary/40 bg-primary/10 text-foreground opacity-100"
              : "border-transparent opacity-0 pointer-events-none")
          }
        >
          <RotateCw className="size-3 text-primary" aria-hidden="true" />
          {status.rotationDeg === null
            ? ""
            : `${formatInteger(status.rotationDeg, locale)}°`}
        </span>

        {/* Text-editing indicator: accent chip with a pulsing caret dot. */}
        <span
          role="status"
          aria-live="polite"
          aria-label={t("a11y.textEditing")}
          title={`${t("status.editing")} — Esc`}
          className={
            "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-medium transition-all duration-200 " +
            (status.editingText
              ? "border-primary/40 bg-primary/10 text-foreground opacity-100"
              : "border-transparent opacity-0 pointer-events-none")
          }
        >
          <span
            aria-hidden="true"
            className="relative flex size-2 items-center justify-center"
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          <Type className="size-3 text-primary" aria-hidden="true" />
          {t("status.editing")}
        </span>

        {/* Live word/character counts of the edited text (R3B.6). */}
        <span
          role="status"
          aria-live="polite"
          aria-label={t("status.counts")}
          title={countsText}
          className={
            "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-medium tabular-nums transition-opacity duration-200 " +
            (counts !== null
              ? "border-border/60 bg-muted/40 text-foreground opacity-100"
              : "border-transparent opacity-0 pointer-events-none")
          }
        >
          {countsText}
        </span>

        <span
          className="hidden h-4 w-px shrink-0 bg-border sm:block"
          aria-hidden="true"
        />

        {/* Autosave state chip: dirty (pulse) / saved (check + time) / failed. */}
        <SaveStateChip
          state={status.saveState}
          savedAtText={savedAtText}
          label={t("a11y.saveState")}
        />

        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-0.5"
          title={t("status.offline")}
        >
          <span
            className="size-1.5 rounded-full bg-emerald-500"
            aria-hidden="true"
          />
          {activeTool === "connector"
            ? t("status.hint.connector")
            : t("status.ready")}
          {activeTool === "connector" ? (
            <Spline
              className="size-3 text-muted-foreground/70"
              aria-hidden="true"
            />
          ) : (
            <WifiOff
              className="size-3 text-muted-foreground/70"
              aria-hidden="true"
            />
          )}
        </span>
      </div>

      {/* End group (left side under RTL): undo/redo, language, theme, version. */}
      <div className="ms-auto flex items-center gap-1.5">
        <button
          type="button"
          className={BUTTON_BASE}
          aria-label={t("a11y.undo")}
          title={`${t("a11y.undo")} (Ctrl+Z)`}
          disabled={!status.canUndo}
          onClick={() => dispatchCommand("core.edit.undo")}
        >
          <Undo2 className="size-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          className={BUTTON_BASE}
          aria-label={t("a11y.redo")}
          title={`${t("a11y.redo")} (Ctrl+Shift+Z)`}
          disabled={!status.canRedo}
          onClick={() => dispatchCommand("core.edit.redo")}
        >
          <Redo2 className="size-4" aria-hidden="true" />
        </button>

        <span
          className="hidden h-4 w-px shrink-0 bg-border sm:block"
          aria-hidden="true"
        />

        <button
          type="button"
          className={BUTTON_BASE}
          aria-label={t("find.title")}
          title={`${t("find.title")} (Ctrl+F)`}
          onClick={() => requestFindPanel()}
        >
          <Search className="size-4" aria-hidden="true" />
        </button>

        {/* R5.5 snap-to-grid toggle: the magnet (active = accent state). */}
        <button
          type="button"
          className={
            BUTTON_BASE + (snapEnabled ? " bg-primary/15 text-primary" : "")
          }
          aria-pressed={snapEnabled}
          aria-label={t("settings.snapToGrid")}
          title={
            snapEnabled
              ? `${t("settings.snapToGrid")} — ${t("settings.snapOnHint")}`
              : `${t("settings.snapToGrid")} — ${t("settings.snapOffHint")}`
          }
          onClick={toggleSnap}
        >
          <Magnet className="size-4" aria-hidden="true" />
        </button>

        {/* R8.2: the Settings button opens the composed dialog (the
            registry-rendered sections; every setting applies live). */}
        <button
          type="button"
          className={BUTTON_BASE}
          aria-label={t("settings.title")}
          title={`${t("settings.title")} (Ctrl+,)`}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="size-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          className={BUTTON_BASE}
          aria-label={t("a11y.toggleLanguage")}
          onClick={() => setLanguage(language === "fa" ? "en" : "fa")}
        >
          <Languages className="size-3.5" aria-hidden="true" />
          <span>{currentLanguageName}</span>
        </button>

        <button
          type="button"
          className={BUTTON_BASE}
          aria-label={t("a11y.toggleTheme")}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <ThemeToggleIcon className="size-4" aria-hidden="true" />
        </button>

        <span className="hidden sm:inline">{t("status.version")}</span>
      </div>
    </footer>
  );
}

/**
 * Resets the camera to the default framing (zoom chip action). Resolves
 * the controller lazily so the component stays boot-agnostic.
 */
function resetZoom(): void {
  AppContext.getDefault().tryGet(Services.cameraController)?.reset();
}

/** Visual config of each save state (chip icon + tone). */
const SAVE_CHIP: Record<
  SaveState,
  {
    icon: LucideIcon;
    classes: string;
    dot: string;
    titleKey:
      | "status.save.dirty"
      | "status.save.saved"
      | "status.save.failed"
      | "status.save.idle";
  }
> = {
  idle: {
    icon: CloudUpload,
    classes: "border-border/60 bg-muted/40 text-muted-foreground",
    dot: "bg-muted-foreground/60",
    titleKey: "status.save.idle",
  },
  dirty: {
    icon: CloudUpload,
    classes: "border-primary/40 bg-primary/10 text-foreground",
    dot: "bg-primary",
    titleKey: "status.save.dirty",
  },
  saved: {
    icon: Check,
    classes: "border-emerald-500/40 bg-emerald-500/10 text-foreground",
    dot: "bg-emerald-500",
    titleKey: "status.save.saved",
  },
  failed: {
    icon: AlertTriangle,
    classes: "border-red-500/40 bg-red-500/10 text-foreground",
    dot: "bg-red-500",
    titleKey: "status.save.failed",
  },
};

/**
 * Compact autosave indicator: a tone-mapped chip that never reflows the
 * bar (fixed max width, the label truncates on the narrowest screens).
 */
function SaveStateChip({
  state,
  savedAtText,
  label,
}: {
  state: SaveState;
  savedAtText: string;
  label: string;
}) {
  const { t } = useTranslation();
  const config = SAVE_CHIP[state];
  const Icon = config.icon;
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      title={
        savedAtText === ""
          ? t(config.titleKey)
          : `${t(config.titleKey)} · ${savedAtText}`
      }
      className={
        "inline-flex max-w-40 items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-medium transition-colors duration-200 " +
        config.classes
      }
    >
      {state === "dirty" ? (
        <span
          aria-hidden="true"
          className="relative flex size-2 items-center justify-center"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
      ) : (
        <span
          className={"size-2 rounded-full " + config.dot}
          aria-hidden="true"
        />
      )}
      <Icon
        className={
          "size-3 " +
          (state === "saved"
            ? "text-emerald-500"
            : state === "failed"
              ? "text-red-500"
              : "text-muted-foreground/70")
        }
        aria-hidden="true"
      />
      <span className="hidden truncate md:inline">{t(config.titleKey)}</span>
      {state === "saved" && savedAtText !== "" ? (
        <span className="truncate text-[0.6875rem] text-muted-foreground">
          {savedAtText}
        </span>
      ) : null}
    </span>
  );
}
