"use client";

/**
 * Insert panel body (R7.12 — «پنل درج»): the widget catalog, registered as
 * the `core.panels.insert` dock panel.
 *
 * Renders a searchable, grouped card grid EXCLUSIVELY from the
 * ObjectRegistry's catalog metadata (§1.7.7 — never a hardcoded list):
 * registering a type makes its card appear with ZERO panel-code edits
 * (AC7.13). Interactions:
 * - CLICK a card → insert at the viewport centre via the registered
 *   `core.insert.*` command (identical to the toolbar path, AC7.15);
 * - POINTER-DRAG a card → a semi-transparent ghost follows the cursor in
 *   SCREEN space (pointer capture); release over the canvas creates the
 *   object EXACTLY at the release world point (one undo step, default
 *   size); release outside the canvas or Esc cancels. Ghost cleanup is
 *   guaranteed (finally semantics) and no tool state is entered
 *   (AC7.14). The image card launches the asset flow (D-7.3).
 * Fully RTL: the panel and cards use logical properties end-to-end.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Circle,
  Film,
  Frame,
  Image as ImageIcon,
  LayoutGrid,
  Music,
  PenLine,
  Search,
  Smile,
  Spline,
  Square,
  StickyNote,
  Type,
  X,
} from "lucide-react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import type { Scene } from "@/core/model/Scene";
import {
  insertCatalogObject,
  resolveCatalogCards,
  type CatalogCardView,
} from "@/interaction/CatalogInsert";
import { dispatchCommand } from "@/ui/hooks/useCommands";
import { useTranslation, type TranslationKey } from "@/ui/i18n";
import { useRecentStickers } from "@/ui/stickers/recentStickersStore";
import { cn } from "@/lib/utils";
import { Star, Heart, Sparkles } from "lucide-react";

/** Card icon lookup (registry icon names → lucide components). */
const CARD_ICONS: Readonly<Record<string, LucideIcon>> = {
  Square,
  Circle,
  Type,
  StickyNote,
  ImageIcon,
  Film,
  Music,
  Spline,
  PenLine,
  Frame,
  Star,
  Heart,
  Sparkles,
  Smile,
  Search,
};

/** Group ordering (the catalog groups of this phase, R7.12 + R11.1 + R15.2). */
const GROUP_ORDER: readonly string[] = [
  "shapes",
  "text&notes",
  "stickers",
  "media",
  "drawing",
  "knowledge",
];

/** Screen-pixel movement before a card press becomes a drag. */
const CARD_DRAG_THRESHOLD_PX = 5;

/** The drag ghost state (screen space). */
interface Ghost {
  readonly card: CatalogCardView;
  readonly x: number;
  readonly y: number;
}

/**
 * @returns the insert panel body.
 */
export default function InsertPanelBody(): ReactElement {
  const { t } = useTranslation();
  const noteRecent = useRecentStickers((state) => state.note);
  const [cards, setCards] = useState<readonly CatalogCardView[]>([]);
  const [query, setQuery] = useState("");
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const pressRef = useRef<{
    card: CatalogCardView;
    x: number;
    y: number;
    pointerId: number;
  } | null>(null);
  const stateRef = useRef<{
    cards: readonly CatalogCardView[];
    ghost: Ghost | null;
    press: typeof pressRef.current;
    scene: Scene | null;
    registry: ObjectRegistry | null;
  }>({ cards: [], ghost: null, press: null, scene: null, registry: null });

  // Boot → read the catalog from the registry (late registrations
  // re-read; AC7.13's seam: the panel only consumes the list).
  // R9.5/AC9.2: plugin lifecycle changes re-read too — disabled plugins
  // unregister their types, the cards must vanish without a remount.
  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      const registry = context.get(Services.objectRegistry);
      const scene = context.get(Services.scene);
      const bus = context.get(Services.eventBus);
      const read = (): void => {
        setCards(resolveCatalogCards(registry));
      };
      read();
      unsubscribers.push(registry.onRegistered(read));
      unsubscribers.push(
        bus.on("plugins:changed", () => {
          queueMicrotask(read);
        }),
      );
      stateRef.current = {
        cards: resolveCatalogCards(registry),
        ghost: null,
        press: null,
        scene,
        registry,
      };
    });
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  // Mirror live state into the ref (the pointer handlers read it).
  useEffect(() => {
    stateRef.current.cards = cards;
    stateRef.current.ghost = ghost;
    stateRef.current.press = pressRef.current;
  }, [cards, ghost]);

  // Esc cancels an in-flight drag (window-level, R7.12/AC7.14).
  useEffect(() => {
    if (ghost === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setGhost(null);
        pressRef.current = null;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [ghost]);

  /** The filtered cards, grouped and ordered. */
  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("fa-IR");
    const filtered = cards.filter((card) =>
      needle === ""
        ? true
        : t(card.titleKey as TranslationKey)
            .toLocaleLowerCase("fa-IR")
            .includes(needle),
    );
    const byGroup = new Map<string, CatalogCardView[]>();
    for (const card of filtered) {
      const list = byGroup.get(card.group) ?? [];
      list.push(card);
      byGroup.set(card.group, list);
    }
    const ordered = [...byGroup.entries()].sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a[0]);
      const bi = GROUP_ORDER.indexOf(b[0]);
      return (
        (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) ||
        a[0].localeCompare(b[0])
      );
    });
    return ordered;
  }, [cards, query, t]);

  /**
   * Drops the ghost over the canvas: the release point converts to world
   * coordinates and the card's factory places the object exactly there.
   *
   * @param screenX - release X (viewport coordinates).
   * @param screenY - release Y (viewport coordinates).
   */
  const dropAt = (screenX: number, screenY: number): void => {
    const live = stateRef.current;
    const card = live.ghost?.card;
    if (card === undefined || live.scene === null) {
      return;
    }
    const canvas =
      typeof document !== "undefined" ? document.querySelector("canvas") : null;
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
    if (card.typeId === "core.image") {
      // D-7.3: image cards launch the asset flow on drop too.
      dispatchCommand("core.insert.image");
      return;
    }
    const world = live.scene.camera.screenToWorld({
      x: screenX - rect.left,
      y: screenY - rect.top,
    });
    // R9.9: plugin cards insert through the async RPC factory path
    // (2 s timeout + Persian toast guard inside the runtime — the
    // release point is EXACT, AC9.9).
    if (card.pluginOwner !== undefined) {
      void insertPluginCard(card, world);
      return;
    }
    const history = AppContext.getDefault().tryGet(Services.history);
    const registry = live.registry;
    if (history === undefined || registry === undefined) {
      return;
    }
    void world;
    // Dispatch through the shared insert engine by emitting the drop
    // through the composition root's insertCard path with the exact
    // point: the panel never duplicates factory logic.
    dropCatalogCard(card, live.scene, world);
  };

  return (
    <div className="flex flex-col gap-2 p-2.5">
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("insertPanel.searchPlaceholder")}
          aria-label={t("insertPanel.searchLabel")}
          dir="auto"
          className="w-full rounded-lg border border-border/60 bg-background/70 py-1.5 ps-8 pe-7 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        {query !== "" ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("search.clear")}
            className="absolute end-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain">
        {groups.map(([group, groupCards]) => (
          <section key={group}>
            <h3 className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {groupLabel(t, group)}
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {groupCards.map((card) => {
                const Icon = CARD_ICONS[card.icon ?? ""] ?? LayoutGrid;
                return (
                  <button
                    key={`${card.typeId}:${card.key}`}
                    type="button"
                    onClick={() => {
                      // R12.1: sticker card clicks land in the recents list
                      // (the card's preview IS the inserted emoji).
                      if (card.typeId === "core.sticker" && card.preview !== undefined) {
                        noteRecent(card.preview);
                      }
                      // AC7.15: click-insert goes through the SAME
                      // registered command as the palette/shortcuts;
                      // R9.9: plugin cards take the async insert path
                      // (viewport centre — identical UX).
                      if (card.pluginOwner !== undefined) {
                        void insertPluginCardAtCentre(card);
                        return;
                      }
                      dispatchCommand(insertCommandId(card));
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) {
                        return;
                      }
                      pressRef.current = {
                        card,
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
                      if (
                        press === null ||
                        press.pointerId !== event.pointerId
                      ) {
                        return;
                      }
                      const dx = event.clientX - press.x;
                      const dy = event.clientY - press.y;
                      if (
                        stateRef.current.ghost === null &&
                        Math.hypot(dx, dy) < CARD_DRAG_THRESHOLD_PX
                      ) {
                        return;
                      }
                      setGhost({
                        card: press.card,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                    onPointerUp={(event) => {
                      const press = pressRef.current;
                      pressRef.current = null;
                      if (
                        event.currentTarget.hasPointerCapture(event.pointerId)
                      ) {
                        event.currentTarget.releasePointerCapture(
                          event.pointerId,
                        );
                      }
                      const active = stateRef.current.ghost;
                      // finally-semantics cleanup: the ghost ALWAYS clears.
                      setGhost(null);
                      if (active !== null && press !== null) {
                        dropAt(event.clientX, event.clientY);
                      }
                    }}
                    onPointerCancel={() => {
                      pressRef.current = null;
                      setGhost(null);
                    }}
                    title={t(card.titleKey as TranslationKey)}
                    aria-label={t(card.titleKey as TranslationKey)}
                    className={cn(
                      "group flex flex-col items-center gap-1.5 rounded-xl border border-border/50",
                      "bg-background/60 px-2 py-2.5 text-center outline-none transition-all",
                      "hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
                      "touch-none select-none",
                      "motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-lg motion-safe:hover:shadow-black/20",
                      ghost?.card === card && "opacity-40",
                    )}
                  >
                    {card.preview !== undefined ? (
                      <span
                        className="text-2xl leading-none motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:scale-110"
                        aria-hidden="true"
                      >
                        {card.preview}
                      </span>
                    ) : (
                      <Icon
                        className="size-5 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <span className="w-full truncate text-[11px] text-foreground/90">
                      {t(card.titleKey as TranslationKey)}
                    </span>
                  </button>
                );
              })}
              {/* R12.1: the stickers group ends with the full-library
                  affordance — opens the Sticker Picker dialog (the same
                  command the palette + Ctrl+Shift+K dispatch). */}
              {group === "stickers" ? (
                <button
                  type="button"
                  onClick={() => dispatchCommand("core.insert.stickerLibrary")}
                  title={t("stickerLibrary.openFullHint")}
                  className={cn(
                    "col-span-2 flex items-center gap-2 rounded-xl border border-dashed border-border/70",
                    "bg-background/40 px-2.5 py-2 text-start outline-none transition-all",
                    "hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
                    "motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-lg motion-safe:hover:shadow-black/20",
                  )}
                >
                  <span
                    className="grid size-7 flex-none place-items-center rounded-lg bg-primary/10 text-primary"
                    aria-hidden="true"
                  >
                    <Smile className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[11px] font-medium text-foreground/90">
                      {t("stickerLibrary.openFull")}
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground/80">
                      {t("stickerLibrary.openFullHint")}
                    </span>
                  </span>
                  <kbd className="flex-none rounded border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[9px] leading-none text-muted-foreground/90">
                    Ctrl+Shift+K
                  </kbd>
                </button>
              ) : null}
            </div>
          </section>
        ))}
        {cards.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-muted-foreground/70">
            {t("insertPanel.empty")}
          </p>
        ) : null}
      </div>
      {/* The drag ghost (screen space, fixed, pointer-events-none). */}
      {ghost !== null && (
        <CardGhost
          ghost={ghost}
          label={t(ghost.card.titleKey as TranslationKey)}
        />
      )}
    </div>
  );
}

/**
 * The semi-transparent ghost following the cursor during a card drag.
 *
 * @param props - the ghost state + resolved label.
 * @returns the ghost element.
 */
function CardGhost(props: {
  readonly ghost: Ghost;
  readonly label: string;
}): ReactElement {
  const Icon = CARD_ICONS[props.ghost.card.icon ?? ""] ?? LayoutGrid;
  const preview = props.ghost.card.preview;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-50 flex w-24 flex-col items-center gap-1 rounded-xl border border-primary/50 bg-background/85 px-2 py-2 text-center shadow-2xl shadow-black/40 backdrop-blur-md"
      style={{
        left: props.ghost.x - 48,
        top: props.ghost.y - 44,
      }}
    >
      {preview !== undefined ? (
        <span className="text-2xl leading-none" aria-hidden="true">
          {preview}
        </span>
      ) : (
        <Icon className="size-5 text-primary" />
      )}
      <span className="w-full truncate text-[10px] text-foreground/90">
        {props.label}
      </span>
    </div>
  );
}

/**
 * Resolves the registered insert command of a card (AC7.15 — click and
 * palette share the exact command).
 *
 * @param card - the card.
 * @returns the command id.
 */
function insertCommandId(card: CatalogCardView): string {
  if (card.typeId === "core.shape") {
    return `core.insert.${card.key}`;
  }
  // R11.1: every sticker variant card carries its own command
  // (one per emoji), mirroring the shape-variant precedent.
  if (card.typeId === "core.sticker") {
    return `core.insert.${card.key}`;
  }
  // R15.2: the live query card carries its own command too.
  if (card.typeId === "core.query") {
    return `core.insert.${card.key}`;
  }
  switch (card.typeId) {
    case "core.textBox":
      return "core.insert.text";
    case "core.stickyNote":
      return "core.insert.sticky";
    case "core.image":
      return "core.insert.image";
    // فاز M1 (A.2.6): the video card's insert action is its registered
    // command — which opens the file picker.
    case "core.video":
      return "core.insert.video";
    // فاز A1 (A.2.6): the audio card's insert action opens the file
    // picker (the catalog metadata drives the card itself).
    case "core.audio":
      return "core.insert.audio";
    // فاز P1 (A.2.6): the PDF card's insert action is its registered
    // command — which opens the file picker.
    case "core.pdf":
      return "core.insert.pdf";
    case "core.connector":
      return "core.insert.connector";
    case "core.freehand":
      return "core.insert.pen";
    // R13.4: the frame card inserts a frame (the previous default
    // silently fell through to core.insert.image and opened the IMAGE
    // dialog — a latent bug from the card's introduction).
    case "core.frame":
      return "core.insert.frame";
    default:
      return "core.insert.image";
  }
}

/**
 * Resolves a catalog group's header label (unknown groups — future
 * plugins — fall back to their raw id).
 *
 * @param t - the translator.
 * @param group - the group id.
 * @returns the header label.
 */
function groupLabel(t: (key: TranslationKey) => string, group: string): string {
  const key = `insertPanel.group.${group}` as TranslationKey;
  const label = t(key);
  if (label !== key) {
    return label;
  }
  // R9.9: plugin groups carry merged owner-namespace keys (e.g.
  // `sticky-shape-pack:group`) — resolve them through the translator
  // directly (t() reads the merged overlay).
  const merged = t(group as TranslationKey);
  return merged === group ? group : merged;
}

/**
 * Inserts one plugin card at a world point (async, R9.9).
 *
 * @param card - the plugin-owned card.
 * @param world - the world point to centre on.
 */
async function insertPluginCard(
  card: CatalogCardView,
  world: { x: number; y: number },
): Promise<void> {
  const manager = AppContext.getDefault().tryGet(Services.pluginManager);
  if (manager === undefined) {
    return;
  }
  await manager
    .runtimeForTypeId(card.typeId)
    ?.insertObjectAt(card.typeId, world);
}

/**
 * Inserts one plugin card at the viewport centre (click path, R9.9).
 *
 * @param card - the plugin-owned card.
 */
async function insertPluginCardAtCentre(card: CatalogCardView): Promise<void> {
  const context = AppContext.getDefault();
  const manager = context.tryGet(Services.pluginManager);
  const scene = context.tryGet(Services.scene);
  if (manager === undefined || scene === undefined) {
    return;
  }
  const canvas =
    typeof document !== "undefined" ? document.querySelector("canvas") : null;
  const centre =
    canvas !== null
      ? scene.camera.screenToWorld({
          x: canvas.clientWidth / 2,
          y: canvas.clientHeight / 2,
        })
      : { x: 0, y: 0 };
  await manager
    .runtimeForTypeId(card.typeId)
    ?.insertObjectAt(card.typeId, centre);
}

/**
 * Performs the drop insertion: the exact world point, the card's factory,
 * ONE AddObjectCommand (AC7.14). Text kinds open an edit session.
 *
 * @param card - the dropped card.
 * @param scene - the live scene.
 * @param world - the drop point in world coordinates.
 */
function dropCatalogCard(
  card: CatalogCardView,
  scene: Scene,
  world: { readonly x: number; readonly y: number },
): void {
  const context = AppContext.getDefault();
  const history = context.tryGet(Services.history);
  const registry = context.tryGet(Services.objectRegistry);
  const textLayer = context.tryGet(Services.textLayer);
  if (history === undefined || registry === undefined) {
    return;
  }
  const object = insertCatalogObject(
    scene,
    history,
    registry,
    card.typeId,
    card.key,
    world,
  );
  if (
    object !== null &&
    textLayer !== undefined &&
    (object.kind === "textBox" || object.kind === "stickyNote")
  ) {
    textLayer.beginEditing(object.id);
  }
}
