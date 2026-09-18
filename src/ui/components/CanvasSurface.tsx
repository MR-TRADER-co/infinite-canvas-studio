"use client";

/**
 * The infinite-canvas surface: the `<canvas>` render target plus the DOM
 * overlay decorations.
 *
 * Wires the composition root to the DOM: it initialises the
 * `Canvas2DRenderer`, runs the dirty-flag `RenderLoop`, translates raw
 * pointer/wheel events into normalised `ToolPointerEvent`s (screen + world
 * space) for the active tool, and routes camera intents to the
 * `CameraController`. Grid, origin marker and freehand strokes are painted
 * on the canvas; the vignette, glow and the empty-state remain pure CSS
 * overlays (CLAUDE.md §1.3 hybrid rendering model).
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Application, Services } from "@/App";
import { AppContext } from "@/AppContext";
import { t, useTranslation } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";
import { useImageImport } from "@/ui/hooks/useImageImport";
import ObjectNameBadges from "@/ui/components/ObjectNameBadges";
import {
  Canvas2DRenderer,
  DARK_PALETTE,
  LIGHT_PALETTE,
} from "@/rendering/Canvas2DRenderer";
import { RenderLoop } from "@/rendering/RenderLoop";
import type { PluginObjectLayer } from "@/plugins/host/PluginObjectLayer";
import { formatInteger, formatTimecode } from "@/ui/i18n/numbers";
import { runKnowledgeQuery } from "@/core/knowledge/KnowledgeQueries";
import {
  queryColumnValue,
  runSceneQuery,
} from "@/core/knowledge/QueryEngine";
import { buildKnowledgeEdges } from "@/rendering/KnowledgeEdgeOverlay";
import { structuredSpecOf } from "@/core/model/QueryObject";
import type { HandlesRenderer } from "@/rendering/HandlesRenderer";
import type { ToolCursor, ToolPointerEvent, ITool } from "@/interaction/Tool";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import type { ToolManager } from "@/interaction/ToolManager";
import type { TextLayerView } from "@/text/view/TextLayerView";
import type { Camera } from "@/core/camera/Camera";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import { hitTestTopMost } from "@/interaction/objectHitTest";
import { isPdfObject } from "@/core/model/PdfObject";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import { pdfPageCache } from "@/media/PdfPageCache";
import { resolveTopLevelId } from "@/core/model/GroupObject";
import { TOOL_SHORTCUTS, shortcutLetter } from "@/ui/hooks/useToolShortcuts";

/** CSS cursor keyword for every tool cursor hint. */
const CURSOR_KEYWORDS: Record<ToolCursor, string> = {
  default: "default",
  crosshair: "crosshair",
  grab: "grab",
  grabbing: "grabbing",
  text: "text",
  move: "move",
  pointer: "pointer",
  "not-allowed": "not-allowed",
  nwseResize: "nwse-resize",
  neswResize: "nesw-resize",
  nsResize: "ns-resize",
  ewResize: "ew-resize",
};

export default function CanvasSurface(): ReactElement {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const [hasObjects, setHasObjects] = useState(false);

  // OS-clipboard image pastes and dropped image files become scene
  // objects (the import bridge listens for the app's lifetime).
  useImageImport(surfaceRef);

  /**
   * Boots the canvas stack once: renderer, render loop, input bridge and
   * event subscriptions. Everything is torn down on unmount (StrictMode
   * double-mount safe).
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    let teardown: (() => void) | null = null;
    let cancelled = false;

    void Application.boot().then((context) => {
      if (cancelled) {
        return;
      }
      // The DOM text overlay covers the canvas exactly (CLAUDE.md §1.3);
      // it is attached/detached with the surface lifetime.
      const surface = canvas.parentElement;
      const textLayer = context.get(Services.textLayer);
      const pluginObjectLayer = context.tryGet(Services.pluginObjectLayer);
      if (surface !== null) {
        textLayer.attach(surface);
        pluginObjectLayer?.attach(surface);
      }
      const bridgeTeardown = bridgeCanvasToDom(
        context,
        canvas,
        textLayer,
        (count) => setHasObjects(count > 0),
        pluginObjectLayer,
      );
      teardown = () => {
        textLayer.detach();
        pluginObjectLayer?.detach();
        bridgeTeardown();
      };
    });

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, []);

  return (
    <main
      ref={surfaceRef}
      className="relative flex-1 min-h-0 overflow-hidden bg-background"
      aria-label={t("app.name")}
    >
      {/* The render target: grid + strokes are painted here each frame. */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t("app.name")}
        className="absolute inset-0 block h-full w-full touch-none select-none"
      />

      {/* Soft vignette anchoring the surface edges. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background:radial-gradient(ellipse_at_center,transparent_55%,oklch(0_0_0/12%)_100%)] dark:[background:radial-gradient(ellipse_at_center,transparent_50%,oklch(0_0_0/55%)_100%)]"
      />

      {/* Faint radial glow behind the empty state (depth cue, blur-free). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 size-[38rem] -translate-x-1/2 -translate-y-1/2 [background:radial-gradient(circle,oklch(0.145_0_0/4%)_0%,transparent_65%)] dark:[background:radial-gradient(circle,oklch(1_0_0/5%)_0%,transparent_65%)]"
      />

      {/* Named-object badges: floating name chips above the top-right
          corner of named sticky notes / tables / images (above the text
          layer so neighbouring cards never cover them). */}
      <ObjectNameBadges />

      {/* Centered empty-state overlay — hidden as soon as objects exist. */}
      {!hasObjects && (
        <div className="pointer-events-none absolute inset-0 flex animate-[empty-fade-in_0.7s_ease-out_both] flex-col items-center justify-center gap-5 p-6 text-center">
          <h1 className="bg-linear-to-b from-foreground via-foreground to-muted-foreground bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">
            {t("app.name")}
          </h1>
          <span className="inline-flex items-center rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            {t("app.phase")}
          </span>
          <div className="space-y-1.5">
            <p className="text-base font-medium text-muted-foreground">
              {t("empty.title")}
            </p>
            <p className="mx-auto max-w-md text-sm leading-7 text-muted-foreground/80">
              {t("empty.hint")}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground/70">
              {t("empty.shortcuts")}
            </p>
            {/* Visual duplicate of the sentence above — hidden from a11y. */}
            <div
              className="flex items-center justify-center gap-1.5"
              aria-hidden="true"
            >
              {TOOL_SHORTCUTS.map(({ tool, code }) => (
                <kbd
                  key={tool}
                  className="rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {shortcutLetter(code)}
                </kbd>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * Connects the booted service graph to the canvas DOM element.
 *
 * @param context - the booted application context.
 * @param canvas - the canvas element to render into and listen on.
 * @param textLayer - the DOM text overlay synced by the render loop.
 * @param onSceneCount - invoked with the object count on scene changes.
 * @returns a teardown function removing every listener and stopping the loop.
 */
function bridgeCanvasToDom(
  context: AppContext,
  canvas: HTMLCanvasElement,
  textLayer: TextLayerView,
  onSceneCount: (count: number) => void,
  pluginObjectLayer?: PluginObjectLayer,
): () => void {
  const scene = context.get(Services.scene);
  const controller = context.get(Services.cameraController);
  const toolManager = context.get(Services.toolManager);
  const selection = context.get(Services.selection);
  const overlay = context.get(Services.strokeOverlay);
  const shapeOverlay = context.get(Services.shapeOverlay);
  const connectorOverlay = context.get(Services.connectorOverlay);
  const guidesOverlay = context.get(Services.guidesOverlay);
  const spatialIndex = context.tryGet(Services.spatialIndex);
  const handles = context.get(Services.handlesRenderer);
  const bus = context.get(Services.eventBus);
  const camera: Camera = scene.camera;

  const renderer = new Canvas2DRenderer();
  renderer.initialize(canvas);
  renderer.attachHandles(handles);
  applyPalette(renderer, useUiStore.getState().theme);
  // فاز ۲۶: the multi-select count chip's label follows the UI digit
  // setting (the renderer stays framework-free — the host injects the
  // formatter, re-applied on language/digit-setting switches below).
  applyHandlesChipLocale(handles);
  // R8.2: the persisted grid-spacing default (settings hydration ran at
  // host mount, before this effect).
  renderer.setGridBaseSpacing(useUiStore.getState().gridSpacing);

  const loop = new RenderLoop(
    renderer,
    scene,
    camera,
    overlay,
    shapeOverlay,
    textLayer,
    connectorOverlay,
    guidesOverlay,
  );
  // R9.9: the plugin object DOM layer rides the SAME rAF (one dirty flag
  // drives both DOM overlays and the canvas).
  if (pluginObjectLayer !== undefined) {
    loop.addCompanion(pluginObjectLayer);
  }
  overlay.setNotifier(() => loop.markDirty());
  shapeOverlay.setNotifier(() => loop.markDirty());
  connectorOverlay.setNotifier(() => loop.markDirty());
  guidesOverlay.setNotifier(() => loop.markDirty());
  handles.setNotifier(() => loop.markDirty());
  // Late-decoding image bitmaps request their own repaint frame.
  renderer.setRepaintNotifier(() => loop.markDirty());
  loop.start();

  // R12.4: the on-canvas knowledge-edge overlay — the frame rebuilds on
  // knowledge rebuilds and selection changes (the highlight ids); the
  // PAINTER resolves live geometry per frame, so nothing else tracks.
  const knowledge = context.get(Services.knowledge);
  const syncKnowledgeEdges = (): void => {
    renderer.setKnowledgeEdgeFrame(
      useUiStore.getState().knowledgeEdgesVisible
        ? {
            edges: buildKnowledgeEdges(knowledge.current()),
            selectedIds: selection.ids,
          }
        : null,
    );
    loop.markDirty();
  };
  syncKnowledgeEdges();

  const syncSize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    loop.markDirty();
  };
  syncSize();
  const observer = new ResizeObserver(syncSize);
  observer.observe(canvas);

  const unsubscribers = [
    bus.on("camera:changed", () => loop.markDirty()),
    bus.on("scene:changed", ({ objectCount }) => {
      loop.markDirty();
      onSceneCount(objectCount);
    }),
    bus.on("selection:changed", () => {
      loop.markDirty();
      syncKnowledgeEdges();
    }),
    // R15.2: live query cards re-resolve on knowledge rebuilds (the
    // debounced scene change → knowledge:changed pipeline).
    bus.on("knowledge:changed", () => {
      loop.markDirty();
      syncKnowledgeEdges();
    }),
    bus.on("ui:tool-changed", () => applyCursor(canvas, toolManager)),
    useUiStore.subscribe((state, previous) => {
      if (
        state.theme !== previous.theme ||
        state.language !== previous.language
      ) {
        applyPalette(renderer, state.theme);
        loop.markDirty();
      }
      // فاز ۲۶: the count-chip label reshapes with the digit setting.
      if (state.persianDigits !== previous.persianDigits) {
        applyHandlesChipLocale(handles);
        loop.markDirty();
      }
      if (state.gridVisible !== previous.gridVisible) {
        renderer.setGridVisible(state.gridVisible);
        loop.markDirty();
      }
      // R12.4: the knowledge-edge overlay toggle applies live.
      if (state.knowledgeEdgesVisible !== previous.knowledgeEdgesVisible) {
        syncKnowledgeEdges();
      }
      // R8.2: the grid-spacing default applies live.
      if (state.gridSpacing !== previous.gridSpacing) {
        renderer.setGridBaseSpacing(state.gridSpacing);
        loop.markDirty();
      }
    }),
  ];
  applyCursor(canvas, toolManager);

  let middleDrag: { pointerId: number; lastScreen: Vec2 } | null = null;
  let lastReadoutScreen: Vec2 | null = null;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button === 1) {
      event.preventDefault();
      middleDrag = {
        pointerId: event.pointerId,
        lastScreen: screenOf(event, canvas),
      };
      capturePointer(canvas, event.pointerId);
      canvas.style.cursor = CURSOR_KEYWORDS.grabbing;
      return;
    }
    if (event.button !== 0) {
      return;
    }
    capturePointer(canvas, event.pointerId);
    toolManager.activeTool?.onPointerDown(toToolEvent(event, canvas, camera));
  };

  const onPointerMove = (event: PointerEvent): void => {
    const toolEvent = toToolEvent(event, canvas, camera);
    emitReadout(bus, toolEvent, lastReadoutScreen);
    lastReadoutScreen = toolEvent.screen;
    if (middleDrag !== null && middleDrag.pointerId === event.pointerId) {
      controller.panByScreen(
        toolEvent.screen.x - middleDrag.lastScreen.x,
        toolEvent.screen.y - middleDrag.lastScreen.y,
      );
      middleDrag.lastScreen = toolEvent.screen;
      return;
    }
    const activeTool = toolManager.activeTool;
    if (activeTool !== null) {
      activeTool.onPointerMove(toolEvent);
      applyHoverCursor(canvas, activeTool, toolEvent);
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (middleDrag !== null && middleDrag.pointerId === event.pointerId) {
      middleDrag = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      applyCursor(canvas, toolManager);
      return;
    }
    toolManager.activeTool?.onPointerUp(toToolEvent(event, canvas, camera));
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  // فاز P1 (RP1.5/A.2.7): the wheel-driven page flip — DEBOUNCED 300 ms
  // per object (the poster renders through the SHARED PdfRenderer, the
  // page cache keeps every rendered page so flip-backs never re-render,
  // and one UpdateObjectCommand lands per pause = one undo step).
  const pageFlipTimers = new Map<string, number>();
  const pageFlipTargets = new Map<string, number>();
  const flipPdfPage = (objectId: string, direction: 1 | -1): void => {
    const object = scene.findById(objectId);
    if (object === undefined || !isPdfObject(object)) {
      return;
    }
    const target = Math.min(
      object.pageCount,
      Math.max(1, object.currentPage + direction),
    );
    if (target === object.currentPage) {
      return;
    }
    pageFlipTargets.set(objectId, target);
    const pending = pageFlipTimers.get(objectId);
    if (pending !== undefined) {
      window.clearTimeout(pending);
    }
    pageFlipTimers.set(
      objectId,
      window.setTimeout(() => {
        pageFlipTimers.delete(objectId);
        const settled = pageFlipTargets.get(objectId);
        pageFlipTargets.delete(objectId);
        const live = scene.findById(objectId);
        if (settled === undefined || live === undefined || !isPdfObject(live)) {
          return;
        }
        const page = Math.min(live.pageCount, Math.max(1, settled));
        if (page === live.currentPage) {
          return;
        }
        void (async () => {
          // Flip IMMEDIATELY through the page cache when the poster is
          // already rendered (the cheap path); otherwise render now.
          let thumbHash = pdfPageCache.lookup(live.assetHash, page) ?? null;
          if (thumbHash === null) {
            const pdf = context.tryGet(Services.pdfRenderer);
            const assets = context.tryGet(Services.assetStore);
            if (pdf === undefined || assets === undefined) {
              return;
            }
            const url = assets.assetUrl(live.assetHash);
            if (url === null) {
              return;
            }
            try {
              const response = await fetch(url);
              if (!response.ok) {
                return;
              }
              const bytes = await response.blob();
              const poster = await pdf.renderPoster(live.assetHash, bytes, page);
              if (poster === null) {
                return;
              }
              thumbHash = await assets.writeAsset(poster.blob);
              if (thumbHash !== null) {
                pdfPageCache.remember(live.assetHash, poster.page, thumbHash);
              }
            } catch {
              return;
            }
          }
          const fresh = scene.findById(objectId);
          if (fresh === undefined || !isPdfObject(fresh) || fresh.currentPage === page) {
            return;
          }
          const command = new UpdateObjectCommand(
            scene,
            fresh.id,
            {
              currentPage: page,
              ...(thumbHash !== null ? { thumbHash } : {}),
            },
            fresh,
          );
          command.do();
          context.get(Services.history).push(command);
        })();
      }, 300),
    );
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.0015);
      controller.zoomAt(screenOf(event, canvas), factor);
      return;
    }
    // فاز P1 (RP1.5/A.2.7): a PLAIN wheel over a PDF object flips its
    // page (the poster + the badge update, debounced 300 ms) instead of
    // panning — the viewer never opens. Modifier wheels (ctrl/shift) and
    // wheels over anything else keep their exact existing behaviour.
    if (!event.shiftKey && event.deltaY !== 0) {
      const world = camera.screenToWorld(screenOf(event, canvas));
      const tolerance = 6 / Math.max(camera.zoom, 0.01);
      const hit = hitTestTopMost(scene, world, tolerance, spatialIndex ?? undefined);
      if (hit !== null && isPdfObject(hit)) {
        flipPdfPage(hit.id, event.deltaY > 0 ? 1 : -1);
        return;
      }
    }
    if (event.shiftKey) {
      controller.panByScreen(-event.deltaY, 0);
      return;
    }
    controller.panByScreen(-event.deltaX, -event.deltaY);
  };

  const onContextMenu = (event: MouseEvent): void => {
    // R6.2: right-click opens the REGISTERED context menu instead of the
    // browser's native one. The target resolves by hit-testing: empty
    // canvas vs. the object kind under the cursor; right-clicking an
    // unselected object selects it first (the Figma contract — the
    // selection commands below act on what was clicked).
    event.preventDefault();
    const world = camera.screenToWorld(screenOf(event, canvas));
    const tolerance = 6 / Math.max(camera.zoom, 0.01);
    // R7.10: the R-tree broad phase resolves the hit candidates.
    const hit = hitTestTopMost(
      scene,
      world,
      tolerance,
      spatialIndex ?? undefined,
    );
    let objectType: string | undefined;
    if (hit !== null) {
      const topId = resolveTopLevelId(scene, hit.id);
      if (!selection.has(topId)) {
        selection.replaceAll([topId]);
      }
      objectType = scene.findById(topId)?.kind;
    }
    bus.emit("ui:context-menu-requested", {
      region: "canvas",
      objectType,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const onDoubleClick = (event: MouseEvent): void => {
    toolManager.activeTool?.onDoubleClick?.(toToolEvent(event, canvas, camera));
  };

  // Wheel events over the live rich editor (inside the overlay layer)
  // re-drive the camera handler so pan/zoom stay available while editing
  // (R3A.2) — the overlay's own listener forwards here.
  textLayer.setCameraWheelHandler(onWheel);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("dblclick", onDoubleClick);

  return () => {
    loop.stop();
    observer.disconnect();
    textLayer.setCameraWheelHandler(null);
    // فاز P1: pending page-flip timers never fire into a dead surface.
    for (const timer of pageFlipTimers.values()) {
      window.clearTimeout(timer);
    }
    pageFlipTimers.clear();
    pageFlipTargets.clear();
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("contextmenu", onContextMenu);
    canvas.removeEventListener("dblclick", onDoubleClick);
    renderer.dispose();
  };
}

/**
 * @param event - the pointer/wheel/mouse event to locate.
 * @param canvas - the canvas providing the coordinate frame.
 * @returns the event position in canvas-local CSS pixels.
 */
function screenOf(event: MouseEvent, canvas: HTMLCanvasElement): Vec2 {
  const rect = canvas.getBoundingClientRect();
  return vec2(event.clientX - rect.left, event.clientY - rect.top);
}

/**
 * Captures the pointer for the drag lifetime, defensively: synthetic or
 * already-released pointer ids make `setPointerCapture` throw (NotFoundError),
 * and an exception here would break the whole pointerdown chain — the tool
 * would never receive the press. Capture is a convenience (keeps events
 * flowing when the pointer leaves the canvas), never a hard requirement.
 *
 * @param canvas - the canvas capturing the pointer.
 * @param pointerId - the pointer id from the DOM event.
 */
function capturePointer(canvas: HTMLCanvasElement, pointerId: number): void {
  try {
    canvas.setPointerCapture(pointerId);
  } catch {
    // Inactive/synthetic pointer id — safe to continue without capture.
  }
}

/**
 * Normalises a DOM pointer event into the tool payload contract.
 *
 * @param event - the DOM pointer event (dblclick supplies a MouseEvent,
 *        which satisfies the same read surface).
 * @param canvas - the canvas providing the coordinate frame.
 * @param camera - the camera mapping screen to world space.
 * @returns the normalised tool pointer event.
 */
function toToolEvent(
  event: PointerEvent | MouseEvent,
  canvas: HTMLCanvasElement,
  camera: Camera,
): ToolPointerEvent {
  const screen = screenOf(event, canvas);
  return {
    screen,
    world: camera.screenToWorld(screen),
    button: event.button,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey || event.metaKey,
    altKey: event.altKey,
  };
}

/**
 * Emits the pointer readout event (throttled to ≥3px screen movement so
 * the status bar does not re-render at the full event rate).
 *
 * @param bus - the application event bus.
 * @param event - the latest tool pointer event.
 * @param previous - the previously emitted screen position, or null.
 */
function emitReadout(
  bus: EventBus<AppEventMap>,
  event: ToolPointerEvent,
  previous: Vec2 | null,
): void {
  const moved =
    previous === null ||
    Math.abs(event.screen.x - previous.x) +
      Math.abs(event.screen.y - previous.y) >=
      3;
  if (moved) {
    bus.emit("pointer:moved", {
      x: Math.round(event.world.x),
      y: Math.round(event.world.y),
    });
  }
}

/**
 * Applies the theme palette to the renderer.
 *
 * The opaque placeholder label (R4.3) is i18n-resolved HERE — the rendering
 * layer never imports the UI dictionaries, so the palette carries the
 * translated string down instead (re-applied on language switches).
 *
 * @param renderer - the canvas renderer.
 * @param theme - the current UI theme.
 */
function applyPalette(
  renderer: Canvas2DRenderer,
  theme: "dark" | "light",
): void {
  const base = theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
  const persianDigits = useUiStore.getState().persianDigits;
  renderer.setPalette({
    ...base,
    opaqueLabel: t("object.opaque"),
    brokenImageLabel: t("image.broken"),
    // فاز M1: the video placeholder label + the duration badge's digit
    // shaping ride the palette (the renderer stays framework-free).
    videoMissingLabel: t("video.missing"),
    videoDurationFormat: (durationMs: number) =>
      formatTimecode(durationMs, persianDigits ? "fa" : "en"),
    // فاز A1: the audio placeholder label + duration badge (the SAME
    // palette seam, one formatter family for all media).
    audioMissingLabel: t("audio.missing"),
    audioDurationFormat: (durationMs: number) =>
      formatTimecode(durationMs, persianDigits ? "fa" : "en"),
    // فاز P1: the PDF placeholder label + the page badge (the SAME
    // palette seam — `۲ / ۱۰` follows the Persian-digits setting).
    pdfMissingLabel: t("pdf.missing"),
    pdfPageBadgeFormat: (current: number, count: number) =>
      `${formatInteger(current, persianDigits ? "fa" : "en")} / ` +
      `${formatInteger(count, persianDigits ? "fa" : "en")}`,
    // R7.4: the equal-gap badge value follows the Persian-digits setting.
    guideNumberFormat: (value: number) =>
      formatInteger(Math.round(value), persianDigits ? "fa" : "en"),
    // R15.2: the live query-card labels + the knowledge resolver (the
    // renderer stays framework-free — the palette carries both down).
    queryLabels: {
      backlinks: t("query.label.backlinks"),
      tag: t("query.label.tag"),
      broken: t("query.label.broken"),
      orphans: t("query.label.orphans"),
      filter: t("query.label.filter"),
      missing: t("query.label.missing"),
      untitled: t("knowledge.unknownSource"),
      ungrouped: t("query.label.ungrouped"),
    },
    // R12.4: theme-aware knowledge-edge colours (teal accent + the
    // destructive red of the panel graph's broken convention).
    knowledgeEdgeColor: theme === "dark" ? "#2dd4bf" : "#0f766e",
    knowledgeBrokenColor: theme === "dark" ? "#f87171" : "#dc2626",
    queryResolver: (request) => {
      const context = AppContext.getDefault();
      const knowledge = context.tryGet(Services.knowledge);
      if (knowledge === undefined) {
        return { rows: [], missingTarget: false, total: 0 };
      }
      // R12.2: the structured filter kind runs the FULL QuerySpec
      // through the engine (law §1.7.9) with the card's own id as the
      // recursion guard; rows carry the first column as their detail
      // and the groupBy bucket as their group.
      if (request.type === "filter") {
        const scene = context.tryGet(Services.scene);
        if (scene === undefined) {
          return { rows: [], missingTarget: false, total: 0 };
        }
        const index = knowledge.current();
        const structured =
          request.structured ?? structuredSpecOf({
            kind: "query",
            id: request.selfId ?? "",
            position: vec2(0, 0),
            rotation: 0,
            zIndex: 0,
            visible: true,
            locked: false,
            width: 0,
            height: 0,
            queryType: "filter",
            queryTarget: "",
          });
        const columns =
          request.columns !== undefined && request.columns.length > 0
            ? request.columns
            : [];
        const result = runSceneQuery(
          scene,
          index,
          structured,
          request.selfId !== undefined ? [request.selfId] : [],
        );
        return {
          rows: result.rows.map((row) => {
            const object =
              columns.length === 0
                ? undefined
                : scene.objects.find(
                    (candidate) => candidate.id === row.objectId,
                  );
            const detail =
              object === undefined
                ? ""
                : queryColumnValue(object, index, columns[0] ?? "title");
            return {
              objectId: row.objectId,
              title: row.title,
              detail: detail === "" ? undefined : detail,
              group: row.group,
            };
          }),
          missingTarget: false,
          total: result.total,
        };
      }
      return runKnowledgeQuery(knowledge.current(), {
        type: request.type,
        target: request.target,
      });
    },
  });
}

/**
 * Injects the locale-aware label formatter of the multi-select count chip
 * (فاز ۲۶ «کیفیت انتخاب») into the handles renderer — the same
 * framework-free pattern as {@link applyPalette}: the renderer never
 * imports the UI dictionaries; the HOST resolves the digit shaping
 * (Persian ۰-۹ follow the UI setting, re-applied on switches).
 *
 * @param handles - the selection-handles painter.
 */
function applyHandlesChipLocale(handles: HandlesRenderer): void {
  const persianDigits = useUiStore.getState().persianDigits;
  handles.setCountLabelFormat((count) =>
    formatInteger(count, persianDigits ? "fa" : "en"),
  );
}

/**
 * Applies the active tool's cursor hint to the canvas.
 *
 * @param canvas - the canvas element receiving the cursor.
 * @param toolManager - the tool manager owning the active tool.
 */
function applyCursor(
  canvas: HTMLCanvasElement,
  toolManager: ToolManager,
): void {
  const cursor = toolManager.activeTool?.cursor ?? "default";
  canvas.style.cursor = CURSOR_KEYWORDS[cursor];
}

/**
 * Applies the tool's context-sensitive cursor hint after a pointer move
 * (hovered/dragged resize handles, move drag, marquee). Falls back to the
 * tool's static hint when the hook is absent or returns null.
 *
 * @param canvas - the canvas element receiving the cursor.
 * @param tool - the active tool (null-checked by the caller).
 * @param event - the latest normalised pointer payload.
 */
function applyHoverCursor(
  canvas: HTMLCanvasElement,
  tool: ITool,
  event: ToolPointerEvent,
): void {
  const hint = tool.hoverCursor?.(event) ?? null;
  canvas.style.cursor =
    hint === null ? CURSOR_KEYWORDS[tool.cursor] : CURSOR_KEYWORDS[hint];
}
