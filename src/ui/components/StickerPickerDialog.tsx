"use client";

/**
 * Sticker-library picker dialog (R12.1 — «کتابخانه استیکر»): the full
 * ~230-glyph emoji catalog with bilingual search, nine category tabs and
 * a recents row, opened by the Insert Panel's «کتابخانه کامل…» button,
 * the command palette (`core.insert.stickerLibrary`) or Ctrl+Shift+K.
 *
 * Insertions go through the shared `insertStickerObject` engine (ONE
 * AddObjectCommand = exactly one undo step). The dialog STAYS OPEN for
 * multi-insert sessions (planning-board rhythm); Esc / click-outside /
 * the close button end it. Every use lands in the persisted recents
 * list.
 *
 * فاز ۳۲ «کشیدن و سنجاش»: every emoji cell is DRAGGABLE — a ghost chip
 * follows the cursor (portal-rendered above the modal) and releasing
 * over the canvas inserts the sticker EXACTLY at the release world
 * point (release outside cancels; Esc mid-drag cancels the drag but
 * keeps the picker open). The footer's amber «درج سنجاق‌شده» switch
 * (session-scoped, reset-to-off per open — the فاز ۳۱ presentation
 * precedent) inserts stickers ALREADY PINNED to the screen: the click
 * path centres the viewport, the drag path centres the release point,
 * and the ghost previews the mode with its amber dashed ring.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Clock, Grab, Pin, Search, Smile, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import type { Scene } from "@/core/model/Scene";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { IdGenerator } from "@/core/id/IdGenerator";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation, type TranslationKey } from "@/ui/i18n";
import { useRecentStickers } from "@/ui/stickers/recentStickersStore";
import {
  searchStickers,
  STICKER_CATEGORIES,
  stickersOfCategory,
  STICKER_LIBRARY,
  type StickerCategoryId,
} from "@/core/stickers/StickerLibrary";
import {
  insertStickerObject,
  STICKER_SIZE_PRESETS,
} from "@/interaction/StickerInsert";
import { STICKER_DEFAULT_SIZE } from "@/core/model/StickerObject";
import { formatInteger } from "@/ui/i18n/numbers";
import { cn } from "@/lib/utils";

/** Grid button size class (kept uniform for touch-friendly targets). */
const GRID_COLUMNS =
  "grid grid-cols-8 gap-1 sm:grid-cols-10";

/** Per-insert cascade offset (world units / screen px) so multi-picks fan out. */
const CASCADE_STEP = 32;

/** How many inserts before the cascade wraps back to the centre. */
const CASCADE_WRAP = 8;

/** Screen-pixel movement before a cell press becomes a drag (فاز ۳۲). */
const DRAG_THRESHOLD_PX = 5;

/** The drag ghost state (screen space, فاز ۳۲). */
interface DragGhost {
  readonly emoji: string;
  readonly x: number;
  readonly y: number;
}

/** The sticker-library picker dialog (UI-store driven visibility). */
export default function StickerPickerDialog(): ReactNode {
  const { t, language } = useTranslation();
  const open = useUiStore((state) => state.stickerPickerOpen);
  const setOpen = useUiStore((state) => state.setStickerPickerOpen);
  const recents = useRecentStickers((state) => state.recents);
  const noteRecent = useRecentStickers((state) => state.note);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<StickerCategoryId | null>(null);
  const [drag, setDrag] = useState<DragGhost | null>(null);
  const [pinnedMode, setPinnedMode] = useState(false);
  // فاز ۳۳ quick sizes: the session's insert footprint (one of the three
  // presets; the middle one IS the classic default, so the pre-فاز-۳۳
  // behaviour is just the initial state).
  const [quickSize, setQuickSize] = useState<number>(
    STICKER_SIZE_PRESETS[1] ?? STICKER_DEFAULT_SIZE,
  );
  const searchRef = useRef<HTMLInputElement | null>(null);
  const cascadeRef = useRef(0);
  // Live mirrors for the pointer/keyboard handlers (no stale closures).
  const dragRef = useRef<DragGhost | null>(null);
  const pinnedModeRef = useRef(false);

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);
  useEffect(() => {
    pinnedModeRef.current = pinnedMode;
  }, [pinnedMode]);

  // Each open starts a fresh session (clean query, focused search, drag
  // cleared, pinned insert back to OFF — the فاز ۳۱ reset precedent).
  // The reset rides the same async timer as the focus call — never a
  // synchronous setState inside the effect body (cascading-render rule).
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setQuery("");
      setCategory(null);
      setDrag(null);
      setPinnedMode(false);
      setQuickSize(STICKER_SIZE_PRESETS[1] ?? STICKER_DEFAULT_SIZE);
      cascadeRef.current = 0;
      searchRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Esc cancels an in-flight drag WITHOUT closing the picker (فاز ۳۲ —
  // the InsertPanel precedent, window-level while a ghost is live).
  useEffect(() => {
    if (drag === null) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setDrag(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drag]);

  /** The visible entries: search results, else the category (null = all). */
  const entries = useMemo(() => {
    const results = searchStickers(query);
    if (results.length > 0 || query.trim() !== "") {
      return results;
    }
    return category === null
      ? STICKER_LIBRARY
      : stickersOfCategory(category);
  }, [query, category]);

  /** Resolves the insert services (null when the app hasn't booted yet). */
  const insertServices = (): {
    scene: Scene;
    history: HistoryManager;
    idGenerator: IdGenerator;
  } | null => {
    const context = AppContext.getDefault();
    const scene = context.tryGet(Services.scene);
    const history = context.tryGet(Services.history);
    const idGenerator = context.tryGet(Services.idGenerator);
    if (scene === undefined || history === undefined || idGenerator === undefined) {
      return null;
    }
    return { scene, history, idGenerator };
  };

  /** Reads the live canvas element (null outside the DOM). */
  const liveCanvas = (): HTMLCanvasElement | null => {
    return typeof document !== "undefined"
      ? document.querySelector("canvas")
      : null;
  };

  /**
   * Inserts one emoji centred on a CANVAS-RELATIVE screen point, honouring
   * the pinned-insert mode (فاز ۳۲): the sticker lands exactly under the
   * point — in world space normally, pinned to the screen when the amber
   * switch is on.
   *
   * @param emoji - the emoji glyph.
   * @param local - the canvas-relative point (CSS pixels).
   * @param cascadeStep - the session cascade step (0 = centred).
   */
  const insertAtScreenPoint = (
    emoji: string,
    local: { x: number; y: number },
    cascadeStep: number,
  ): void => {
    const services = insertServices();
    if (services === null) {
      return;
    }
    const canvas = liveCanvas();
    const offset =
      cascadeStep === 0
        ? { x: 0, y: 0 }
        : { x: cascadeStep * CASCADE_STEP, y: cascadeStep * CASCADE_STEP * 0.75 };
    const world = services.scene.camera.screenToWorld(local);
    insertStickerObject(
      services.scene,
      services.history,
      services.idGenerator,
      emoji,
      { x: world.x + offset.x, y: world.y + offset.y },
      {
        // فاز ۳۳: the chosen quick size rides BOTH paths (click + drag).
        size: quickSize,
        ...(pinnedModeRef.current && canvas !== null
          ? {
              pinnedAt: {
                point: { x: local.x + offset.x, y: local.y + offset.y },
                viewport: {
                  width: canvas.clientWidth,
                  height: canvas.clientHeight,
                },
              },
            }
          : {}),
      },
    );
    noteRecent(emoji);
  };

  /** Click path: insert at the viewport centre (cascaded), note recents. */
  const insertEmoji = (emoji: string): void => {
    const canvas = liveCanvas();
    const centre =
      canvas !== null
        ? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }
        : { x: 0, y: 0 };
    const step = cascadeRef.current % CASCADE_WRAP;
    cascadeRef.current += 1;
    insertAtScreenPoint(emoji, centre, step);
  };

  /**
   * Drag-release path (فاز ۳۲): the release point converts to canvas-local
   * coordinates and the sticker centres EXACTLY there; releases outside
   * the canvas cancel silently. A SUCCESSFUL drop CLOSES the picker — the
   * modal's scrim would otherwise hide the fresh sticker (the drag-out
   * says "place it and be done"; the click path keeps the multi-insert
   * rhythm). The cascade does not apply — the user aimed.
   *
   * @param emoji - the dragged emoji.
   * @param screenX - release X (viewport coordinates).
   * @param screenY - release Y (viewport coordinates).
   */
  const dropEmoji = (emoji: string, screenX: number, screenY: number): void => {
    setDrag(null);
    const canvas = liveCanvas();
    if (canvas === null) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const inside =
      screenX >= rect.left &&
      screenX <= rect.right &&
      screenY >= rect.top &&
      screenY <= rect.bottom;
    if (!inside) {
      return;
    }
    insertAtScreenPoint(
      emoji,
      { x: screenX - rect.left, y: screenY - rect.top },
      0,
    );
    setOpen(false);
  };

  const searching = query.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        dir={language === "fa" ? "rtl" : "ltr"}
        onEscapeKeyDown={(event) => {
          // A live drag swallows the Esc (cancel the ghost, keep the
          // picker open — the multi-insert rhythm continues).
          if (dragRef.current !== null) {
            event.preventDefault();
            setDrag(null);
          }
        }}
        className="grid max-h-[85vh] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogHeader className="space-y-1 border-b border-border/50 px-5 pb-3 pt-4">
          <DialogTitle className="flex items-center gap-2">
            <Smile className="size-4.5 text-primary" aria-hidden="true" />
            {t("stickerLibrary.title")}
          </DialogTitle>
          <DialogDescription>{t("stickerLibrary.hint")}</DialogDescription>
        </DialogHeader>

        {/* Search + category tabs (RTL-aware strip). */}
        <div className="space-y-2.5 border-b border-border/50 bg-muted/20 px-5 py-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("stickerLibrary.searchPlaceholder")}
              aria-label={t("stickerLibrary.searchLabel")}
              dir="auto"
              className="h-9 w-full rounded-lg border border-border/60 bg-background/80 ps-8 pe-8 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            {searching ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                aria-label={t("search.clear")}
                className="absolute end-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div
            className="panel-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
            role="tablist"
            aria-label={t("stickerLibrary.title")}
          >
            <CategoryTab
              active={category === null}
              disabled={searching}
              onClick={() => setCategory(null)}
              label={t("stickerLibrary.all")}
              emoji="🗂️"
            />
            {STICKER_CATEGORIES.map((tab) => (
              <CategoryTab
                key={tab.id}
                active={category === tab.id}
                disabled={searching}
                onClick={() => setCategory(tab.id)}
                label={t(tab.titleKey as TranslationKey)}
                emoji={tab.emoji}
              />
            ))}
          </div>
        </div>

        {/* Recents (search-empty only — most-recent first) + the grid
            (search results / category / all) share ONE scroll host. */}
        <div className="panel-scroll min-h-0 overflow-y-auto">
          {!searching && recents.length > 0 ? (
            <div className="space-y-1.5 px-5 pt-3">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                <Clock className="size-3" aria-hidden="true" />
                {t("stickerLibrary.recents")}
              </p>
              <div className="flex flex-wrap gap-1">
                {recents.map((emoji) => (
                  <EmojiButton
                    key={`recent:${emoji}`}
                    emoji={emoji}
                    onPick={insertEmoji}
                    sizeClass="size-8 text-lg"
                    onDragStart={(glyph, x, y) =>
                      setDrag({ emoji: glyph, x, y })
                    }
                    onDragMove={(x, y) => {
                      setDrag((current) =>
                        current === null ? current : { ...current, x, y },
                      );
                    }}
                    onDragEnd={dropEmoji}
                    onDragCancel={() => setDrag(null)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {entries.length > 0 ? (
            <div className={cn(GRID_COLUMNS, "px-5 pb-4 pt-3")}>
              {entries.map((entry) => (
                <EmojiButton
                  key={entry.emoji}
                  emoji={entry.emoji}
                  onPick={insertEmoji}
                  sizeClass="size-10 text-2xl"
                  title={
                    entry.keywords.length > 0 ? entry.keywords[0] : entry.emoji
                  }
                  onDragStart={(glyph, x, y) =>
                    setDrag({ emoji: glyph, x, y })
                  }
                  onDragMove={(x, y) => {
                    setDrag((current) =>
                      current === null ? current : { ...current, x, y },
                    );
                  }}
                  onDragEnd={dropEmoji}
                  onDragCancel={() => setDrag(null)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <span className="text-3xl opacity-60" aria-hidden="true">
                🫥
              </span>
              <p className="text-xs text-muted-foreground">
                {t("stickerLibrary.noResults")}
              </p>
            </div>
          )}
        </div>

        {/* فاز ۳۲/۳۳ footer: the drag hint, the quick-size segmented
            control and the amber pinned-insert switch. */}
        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border/50 bg-muted/20 px-5 py-2.5">
          <p className="hidden min-w-0 flex-1 items-center gap-1.5 text-[10px] leading-relaxed text-muted-foreground/80 lg:flex">
            <Grab
              className="size-3 flex-none text-muted-foreground/60"
              aria-hidden="true"
            />
            <span className="truncate">{t("stickerLibrary.dragHint")}</span>
          </p>
          {/* فاز ۳۳: the quick-size segmented control (radiogroup of the
              three presets; the chip label shows the CURRENT-locale
              digits, the aria-label names the size class). */}
          <div
            role="radiogroup"
            aria-label={t("stickerLibrary.sizeLabel")}
            title={t("stickerLibrary.sizeHint")}
            className="flex flex-none items-center gap-0.5 rounded-full border border-border/60 bg-background/60 p-0.5"
          >
            {STICKER_SIZE_PRESETS.map((preset, index) => {
              const active = quickSize === preset;
              const nameKey =
                index === 0
                  ? "stickerLibrary.sizeSmall"
                  : index === 1
                    ? "stickerLibrary.sizeMedium"
                    : "stickerLibrary.sizeLarge";
              return (
                <button
                  key={preset}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={t(nameKey as TranslationKey)}
                  onClick={() => setQuickSize(preset)}
                  className={cn(
                    "grid h-6 min-w-8 place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                    "transition-all duration-150",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                    active
                      ? "bg-primary/15 text-foreground shadow-[inset_0_0_0_1px_rgba(127,127,127,0.25)]"
                      : "text-muted-foreground/80 hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {formatInteger(preset, language === "fa" ? "fa" : "en")}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={pinnedMode}
            aria-label={t("stickerLibrary.insertPinned")}
            title={t("stickerLibrary.insertPinnedHint")}
            onClick={() => setPinnedMode((value) => !value)}
            className={cn(
              "flex h-7 flex-none items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium",
              "transition-all duration-200",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              pinnedMode
                ? "border-amber-500/50 bg-amber-500/15 text-amber-600 shadow-[0_0_0_1px_rgba(245,158,11,0.15)] dark:text-amber-400"
                : "border-border/60 bg-background/60 text-muted-foreground hover:border-amber-500/30 hover:text-foreground",
            )}
          >
            <Pin
              className={cn(
                "size-3.5 transition-transform duration-200",
                pinnedMode && "-rotate-45 scale-110",
              )}
              aria-hidden="true"
            />
            {t("stickerLibrary.insertPinned")}
          </button>
        </DialogFooter>
      </DialogContent>
      {/* The drag ghost (portal-rendered ABOVE the modal, فاز ۳۲). */}
      {drag !== null && typeof document !== "undefined"
        ? createPortal(
            <StickerDragGhost
              ghost={drag}
              pinned={pinnedMode}
              size={quickSize}
            />,
            document.body,
          )
        : null}
    </Dialog>
  );
}

/**
 * The ghost chip following the cursor during a cell drag (فاز ۳۲):
 * centred under the pointer, dashed-ringed — AMBER while the pinned
 * insert mode previews itself, primary otherwise.
 *
 * @param props - the ghost state + the pinned-mode flag.
 * @returns the portal element.
 */
function StickerDragGhost(props: {
  readonly ghost: DragGhost;
  readonly pinned: boolean;
  readonly size: number;
}): ReactNode {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-[60]"
      style={{ left: props.ghost.x, top: props.ghost.y }}
    >
      <div
        className={cn(
          "relative grid -translate-x-1/2 -translate-y-1/2 place-items-center",
          "rounded-2xl border-2 border-dashed bg-background/90 shadow-2xl shadow-black/40",
          "backdrop-blur-md",
          "animate-[panel-pop-in_0.18s_cubic-bezier(0.22,1,0.36,1)_both]",
          props.pinned
            ? "border-amber-500/70"
            : "border-primary/50",
        )}
        style={{
          width: Math.max(props.size, 40),
          height: Math.max(props.size, 40),
        }}
      >
        <span
          className="leading-none"
          style={{
            fontSize: `${Math.round(Math.max(props.size, 40) * 0.52)}px`,
          }}
          aria-hidden="true"
        >
          {props.ghost.emoji}
        </span>
        {props.pinned ? (
          <span className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-amber-500/50 bg-amber-500/20 text-amber-600 dark:text-amber-400">
            <Pin className="size-3 -rotate-45" aria-hidden="true" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One category tab chip.
 *
 * @param props - active/disabled state, click handler, label + glyph.
 * @returns the tab button.
 */
function CategoryTab(props: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly label: string;
  readonly emoji: string;
}): ReactNode {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "flex flex-none items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium",
        "transition-all duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        props.active
          ? "border-primary/50 bg-primary/15 text-foreground"
          : "border-border/60 bg-background/60 text-muted-foreground hover:border-primary/30 hover:text-foreground",
        props.disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span className="text-sm leading-none" aria-hidden="true">
        {props.emoji}
      </span>
      {props.label}
    </button>
  );
}

/**
 * One emoji cell of the grid / recents row — CLICK inserts at the
 * viewport centre; POINTER-DRAG (5px threshold, pointer capture) spawns
 * the parent's ghost and releases over the canvas insert EXACTLY at
 * the release point (فاز ۳۲, the InsertPanel card pattern).
 *
 * @param props - the emoji, the pick handler, the drag callbacks, the
 *                size class.
 * @returns the button.
 */
function EmojiButton(props: {
  readonly emoji: string;
  readonly onPick: (emoji: string) => void;
  readonly sizeClass: string;
  readonly title?: string;
  readonly onDragStart: (emoji: string, x: number, y: number) => void;
  readonly onDragMove: (x: number, y: number) => void;
  readonly onDragEnd: (emoji: string, x: number, y: number) => void;
  readonly onDragCancel: () => void;
}): ReactNode {
  const pressRef = useRef<{ x: number; y: number; pointerId: number } | null>(
    null,
  );
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);

  return (
    <button
      type="button"
      title={props.title ?? props.emoji}
      aria-label={props.title ?? props.emoji}
      onClick={() => {
        // A finished drag suppresses the trailing click (browsers may
        // still fire one after the captured release).
        if (suppressClickRef.current) {
          return;
        }
        props.onPick(props.emoji);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        suppressClickRef.current = false;
        pressRef.current = {
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
        };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointer id — safe to continue.
        }
      }}
      onPointerMove={(event) => {
        const press = pressRef.current;
        if (press === null || press.pointerId !== event.pointerId) {
          return;
        }
        if (
          !draggingRef.current &&
          Math.hypot(event.clientX - press.x, event.clientY - press.y) <
            DRAG_THRESHOLD_PX
        ) {
          return;
        }
        if (!draggingRef.current) {
          draggingRef.current = true;
          props.onDragStart(props.emoji, event.clientX, event.clientY);
          return;
        }
        props.onDragMove(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        pressRef.current = null;
        if (
          event.currentTarget.hasPointerCapture(event.pointerId)
        ) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        const wasDragging = draggingRef.current;
        draggingRef.current = false;
        if (wasDragging) {
          // The compat click that follows a captured release is eaten.
          suppressClickRef.current = true;
          props.onDragEnd(props.emoji, event.clientX, event.clientY);
        }
      }}
      onPointerCancel={() => {
        pressRef.current = null;
        if (draggingRef.current) {
          draggingRef.current = false;
          props.onDragCancel();
        }
      }}
      className={cn(
        "flex cursor-grab items-center justify-center rounded-lg bg-background/40 leading-none",
        "transition-all duration-150",
        "hover:scale-110 hover:bg-accent/70 active:cursor-grabbing active:scale-95",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        "motion-safe:hover:shadow-sm motion-safe:hover:shadow-black/20",
        "touch-none select-none",
        props.sizeClass,
      )}
    >
      {props.emoji}
    </button>
  );
}
