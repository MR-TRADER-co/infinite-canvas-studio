"use client";

/**
 * FloatingPdfViewer (فاز P2 — RP2.1–RP2.4, A.2.3): the SCREEN-space
 * PDF viewer overlay.
 *
 * Binding contract:
 * - a React PORTAL above every panel, NO scrim — the canvas stays
 *   interactive (pan/zoom/select while reading: the window never moves
 *   with the camera);
 * - draggable by its title bar + resizable via the corner handle
 *   (min 400×500, default 800×600) — hand-rolled pointer events, the
 *   EXACT FloatingPlayerWindow/FloatingMiniPlayer mechanism (A.2.9: NO
 *   new dependency);
 * - ONE instance at a time (opening a video/audio player or another
 *   PDF closes the previous — the store owns the hand-off);
 * - pdf.js's full DOM rendering: a `<canvas>` layer for the visuals +
 *   a TextLayer DOM overlay for the text — mouse text HIGHLIGHT
 *   SELECTION and Ctrl+C copying work natively, `cursor: text` over
 *   the content (RP2.3);
 * - only the CURRENT page renders (adjacent-page prefetch: none — the
 *   wheel renders the next page on demand, RP2.4); closing DESTROYS the
 *   DOM nodes (the canvas + the text layer clear, the blob URL revokes);
 * - last position/size/internal-zoom persist in APP data and survive
 *   restarts (A.2.3);
 * - NO autoplay: opens at the object's `currentPage`, paused on
 *   nothing (there is nothing to play — the contract's word for "no
 *   side effects on open");
 * - custom Persian/RTL chrome (Vazirmatn, theme-aware tokens): prev/
 *   next page, the page input (`۳ / ۱۰`), zoom out/in/fit-width,
 *   fullscreen, close. Keyboard while focused: ←/→ = prev/next page
 *   (RTL-correct direction), +/- zoom, 0 = fit-width, F fullscreen,
 *   Esc close (RP2.2).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Maximize,
  Minimize,
  MoveHorizontal,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import { Application, Services } from "@/App";
import { AppContext } from "@/AppContext";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import { isPdfObject } from "@/core/model/PdfObject";
import { assetUrlOf } from "@/media/AssetUrlResolver";
import { isInteractiveTitleBarTarget } from "@/ui/player/titleBarDrag";
import { bindTextLayerSelection } from "@/ui/player/textLayerSelection";
import type { PdfDocument, PdfPage } from "@/media/PdfRenderer";
import {
  PDF_VIEWER_MIN_WIDTH,
  PDF_VIEWER_MIN_HEIGHT,
  PDF_VIEWER_MIN_ZOOM,
  PDF_VIEWER_MAX_ZOOM,
  PDF_VIEWER_ZOOM_STEP,
  readPdfViewerSettings,
  writePdfViewerSettings,
  type PdfViewerSettings,
} from "@/ui/player/pdfViewerSettings";
import { cn } from "@/lib/utils";

/** Device-pixel cap of the canvas render (crispness without 4K drains). */
const DEVICE_PIXEL_RATIO_CAP = 2;

/** The live per-page render state. */
interface PageState {
  /** The 1-based page currently rendered. */
  readonly page: number;
  /** Total pages (from the loaded document). */
  readonly pageCount: number;
}

/** The floating PDF viewer window (portal; nothing renders while closed). */
export default function FloatingPdfViewer(): ReactNode {
  const { t, language } = useTranslation();
  const objectId = useUiStore((state) => state.playerPdfId);
  const closeViewer = useUiStore((state) => state.closePdfViewer);
  const persianDigits = useUiStore((state) => state.persianDigits);

  const [settings, setSettings] = useState<PdfViewerSettings>(() =>
    readPdfViewerSettings(),
  );
  const [meta, setMeta] = useState<{
    name: string;
    pageCount: number;
    currentPage: number;
  } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [fullscreen, setFullscreen] = useState(false);
  /** The user's chosen page (syncs to the object on navigation). */
  const [pageState, setPageState] = useState<PageState>({
    page: 1,
    pageCount: 1,
  });
  const [rendering, setRendering] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  /** The live pdf.js document (shared with the canvas wheel path). */
  const docRef = useRef<PdfDocument | null>(null);
  const assetHashRef = useRef<string | null>(null);
  const renderSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  /** The text layer's selection-UX binding (fix2; one per page render). */
  const textSelectionRef = useRef<{
    dispose: () => void;
  } | null>(null);

  const digitInput = persianDigits && language === "fa" ? "fa" : "en";
  const rtl = language === "fa";

  /** Emits one Persian toast through the shared bus (the app's seam). */
  const notify = useCallback(
    (messageKey: string, severity: "info" | "error"): void => {
      const bus = AppContext.getDefault().tryGet(Services.eventBus);
      bus?.emit("ui:notice", { messageKey, severity });
    },
    [],
  );

  const updateSettings = useCallback(
    (patch: Partial<PdfViewerSettings>) => {
      setSettings((previous) => {
        const next = { ...previous, ...patch };
        writePdfViewerSettings(next);
        return next;
      });
    },
    [],
  );

  /**
   * Renders ONE page into the canvas + text layer (RP2.3/RP2.4): the
   * visuals land on a `<canvas>` sized to the container (× the capped
   * device ratio), the text runs land on pdf.js's `TextLayer` DOM
   * overlay — transparent glyphs at the exact viewport positions, so
   * native mouse selection + Ctrl+C copy work. A previous page's DOM is
   * ALWAYS cleared before the next renders (memory discipline).
   */
  const renderPage = useCallback(
    async (page: number): Promise<void> => {
      const doc = docRef.current;
      const canvas = canvasRef.current;
      const content = contentRef.current;
      const textLayerHost = textLayerRef.current;
      if (
        doc === null ||
        canvas === null ||
        content === null ||
        textLayerHost === null
      ) {
        return;
      }
      const clamped = Math.min(doc.numPages, Math.max(1, page));
      const seq = renderSeqRef.current + 1;
      renderSeqRef.current = seq;
      setRendering(true);
      let pdfPage: PdfPage;
      try {
        pdfPage = await doc.getPage(clamped);
      } catch {
        if (renderSeqRef.current === seq) {
          setStatus("error");
          setRendering(false);
          notify("pdfViewer.pageError", "error");
        }
        return;
      }
      if (renderSeqRef.current !== seq) {
        pdfPage.cleanup?.();
        return;
      }
      // Fit-width base scale × the internal zoom.
      const base = pdfPage.getViewport({ scale: 1 });
      const baseScale =
        Math.max(1, base.width) > 0
          ? content.clientWidth / Math.max(1, base.width)
          : 1;
      const viewport = pdfPage.getViewport({
        scale: baseScale * settings.zoom,
      });
      const ratio = Math.min(
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
        DEVICE_PIXEL_RATIO_CAP,
      );
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const context = canvas.getContext("2d");
      if (context === null) {
        pdfPage.cleanup?.();
        setRendering(false);
        return;
      }
      // Clear the previous page's text layer BEFORE rendering (RP2.4).
      textLayerHost.replaceChildren();
      try {
        await pdfPage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        }).promise;
      } catch {
        if (renderSeqRef.current === seq) {
          setStatus("error");
        }
        pdfPage.cleanup?.();
        setRendering(false);
        return;
      }
      if (renderSeqRef.current !== seq) {
        pdfPage.cleanup?.();
        setRendering(false);
        return;
      }
      // The text layer: pdf.js positions transparent text spans over
      // the canvas — selection + copy come free (RP2.3).
      try {
        const textContent = await pdfPage.getTextContent();
        if (renderSeqRef.current !== seq) {
          pdfPage.cleanup?.();
          setRendering(false);
          return;
        }
        const { TextLayer } = (await import("pdfjs-dist")) as unknown as {
          TextLayer: new (options: {
            textContentSource: unknown;
            container: HTMLElement;
            viewport: unknown;
          }) => { render: () => Promise<void> };
        };
        textLayerHost.replaceChildren();
        // FIX (fix2): `--scale-factor` is the ONE var the app owes pdf.js's
        // TextLayer — the .pdf-text-layer CSS bridges it into
        // `--total-scale-factor` (pdf_viewer.css's own .page contract),
        // which drives setLayerDimensions' box + every span's font-size /
        // scaleX transform. The old code set it, but the pre-v6 CSS never
        // consumed it (see globals.css, exe bug report 3).
        textLayerHost.style.setProperty(
          "--scale-factor",
          String(viewport.scale),
        );
        await new TextLayer({
          textContentSource: textContent,
          container: textLayerHost,
          viewport,
        }).render();
        // FIX (fix2): the reference viewer's selection UX — endOfContent
        // bridge, the `selecting` state machine, and the copy handler
        // that NFKC-folds Persian presentation forms (textLayerSelection.ts,
        // a faithful TextLayerBuilder port). Rebound per page render.
        textSelectionRef.current?.dispose();
        textSelectionRef.current = bindTextLayerSelection(textLayerHost);
      } catch {
        // A page without a text layer (a scan) renders VISUALS-only —
        // selection silently does nothing (Appendix P-1, fixture b).
      }
      if (renderSeqRef.current === seq) {
        setPageState({ page: clamped, pageCount: doc.numPages });
        setStatus("ready");
        setRendering(false);
      }
      pdfPage.cleanup?.();
    },
    // notify is a stable ref-less seam (AppContext.getDefault() inside);
    // the render depends only on the internal zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.zoom],
  );

  /**
   * Syncs the object's `currentPage` back after a viewer navigation
   * (undo-able, one UpdateObjectCommand — the same seam the canvas
   * wheel uses).
   */
  const syncPageToScene = useCallback((page: number): void => {
    if (objectId === null) {
      return;
    }
    void Application.boot().then((context) => {
      const scene = context.tryGet(Services.scene);
      const history = context.tryGet(Services.history);
      const object = scene !== undefined ? scene.findById(objectId) : undefined;
      if (
        scene === undefined ||
        history === undefined ||
        object === undefined ||
        !isPdfObject(object) ||
        object.currentPage === page
      ) {
        return;
      }
      const command = new UpdateObjectCommand(
        scene,
        object.id,
        { currentPage: page },
        object,
      );
      command.do();
      history.push(command);
    });
  }, [objectId]);

  /** Loads the document ONCE per opened object (fetch → open → render). */
  useEffect(() => {
    if (objectId === null) {
      return;
    }
    let cancelled = false;
    const abort = new AbortController();
    abortRef.current = abort;
    setStatus("loading");
    setPageState({ page: 1, pageCount: 1 });
    docRef.current = null;
    assetHashRef.current = null;
    renderSeqRef.current += 1;
    // fix2: a new document wipes the old page's DOM — its selection
    // binding must go with it (listeners + endOfContent node).
    textSelectionRef.current?.dispose();
    textSelectionRef.current = null;
    void Application.boot().then((context) => {
      if (cancelled) {
        return;
      }
      const scene = context.tryGet(Services.scene);
      const pdfRenderer = context.tryGet(Services.pdfRenderer);
      const object =
        scene !== undefined ? scene.findById(objectId) : undefined;
      if (object === undefined || !isPdfObject(object)) {
        closeViewer();
        return;
      }
      if (pdfRenderer === undefined) {
        setStatus("error");
        return;
      }
      setMeta({
        name: object.originalName,
        pageCount: object.pageCount,
        currentPage: object.currentPage,
      });
      const url = assetUrlOf(object.assetHash, "application/pdf");
      if (url === null) {
        // Missing asset → the Persian toast + stay closed (A.2.1).
        notify("pdf.missing", "error");
        closeViewer();
        return;
      }
      void fetch(url, { signal: abort.signal })
        .then((response) => {
          if (!response.ok) {
            throw new Error("asset fetch failed");
          }
          return response.blob();
        })
        .then((blob) => {
          if (cancelled) {
            return;
          }
          assetHashRef.current = object.assetHash;
          return pdfRenderer.openDocument(object.assetHash, blob);
        })
        .then((doc) => {
          if (cancelled || doc === null || doc === undefined) {
            if (!cancelled && doc === null) {
              setStatus("error");
            }
            return;
          }
          docRef.current = doc;
          setMeta((previous) => ({
            name: previous?.name ?? "",
            pageCount: doc.numPages,
            currentPage: previous?.currentPage ?? 1,
          }));
          void renderPage(object.currentPage);
        })
        .catch(() => {
          if (!cancelled) {
            closeViewer();
          }
        });
    });
    return () => {
      cancelled = true;
      abort.abort();
      renderSeqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId]);

  /** Re-renders on internal-zoom changes (the settings persist). */
  const zoomRef = useRef(settings.zoom);
  zoomRef.current = settings.zoom;
  useEffect(() => {
    if (objectId !== null && status === "ready") {
      void renderPage(pageState.page);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.zoom]);

  /**
   * Close cleanup (RP2.4): destroy the DOM nodes, release the document
   * when nothing else needs it (the canvas wheel may — the shared LRU
   * owns it), and drop every ref.
   */
  const close = useCallback((): void => {
    renderSeqRef.current += 1;
    textSelectionRef.current?.dispose();
    textSelectionRef.current = null;
    if (textLayerRef.current !== null) {
      textLayerRef.current.replaceChildren();
    }
    if (canvasRef.current !== null) {
      canvasRef.current.width = 0;
      canvasRef.current.height = 0;
    }
    docRef.current = null;
    assetHashRef.current = null;
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen().catch(() => undefined);
    }
    closeViewer();
  }, [closeViewer]);

  /** Esc closes from ANYWHERE (document-level, the mini-player seam). */
  useEffect(() => {
    if (objectId === null) {
      return;
    }
    const onDocumentKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        if (document.fullscreenElement !== null) {
          return; // the browser exits fullscreen first.
        }
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onDocumentKey, true);
    return () => {
      document.removeEventListener("keydown", onDocumentKey, true);
    };
  }, [objectId, close]);

  /** Fullscreen state tracking (F/exit). */
  useEffect(() => {
    if (objectId === null) {
      return;
    }
    const onFullscreenChange = (): void => {
      setFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [objectId]);

  /** Keyboard while focused (RP2.2 — RTL-correct direction). */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          // RTL-correct direction (A.2.8): in the RTL chrome LEFT moves
          // FORWARD (the mini-player precedent).
          goToPage(pageState.page + (rtl ? 1 : -1));
          break;
        case "ArrowRight":
          event.preventDefault();
          goToPage(pageState.page + (rtl ? -1 : 1));
          break;
        case "+":
        case "=":
          event.preventDefault();
          updateSettings({
            zoom: Math.min(PDF_VIEWER_MAX_ZOOM, settings.zoom + PDF_VIEWER_ZOOM_STEP),
          });
          break;
        case "-":
        case "_":
          event.preventDefault();
          updateSettings({
            zoom: Math.max(PDF_VIEWER_MIN_ZOOM, settings.zoom - PDF_VIEWER_ZOOM_STEP),
          });
          break;
        case "0":
          event.preventDefault();
          updateSettings({ zoom: 1 });
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        default:
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rtl, pageState.page, settings.zoom, updateSettings],
  );

  /** Wheel inside the content = page turn (RP2.4 — instant pages). */
  const onContentWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>): void => {
      if (event.ctrlKey || event.metaKey) {
        // Pinch-zoom gestures zoom the DOCUMENT, not the pages.
        event.preventDefault();
        updateSettings({
          zoom: Math.min(
            PDF_VIEWER_MAX_ZOOM,
            Math.max(PDF_VIEWER_MIN_ZOOM, settings.zoom - event.deltaY * 0.002),
          ),
        });
        return;
      }
      event.preventDefault();
      goToPage(pageState.page + (event.deltaY > 0 ? 1 : -1));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageState.page, settings.zoom, updateSettings],
  );

  /** Navigates to a page (clamped; syncs the scene object). */
  function goToPage(page: number): void {
    const doc = docRef.current;
    if (doc === null) {
      return;
    }
    const clamped = Math.min(doc.numPages, Math.max(1, Math.floor(page)));
    if (clamped === pageState.page) {
      return;
    }
    setMeta((previous) =>
      previous === null
        ? previous
        : { ...previous, currentPage: clamped },
    );
    void renderPage(clamped);
    syncPageToScene(clamped);
  }

  /** Fullscreen toggle. */
  function toggleFullscreen(): void {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    if (document.fullscreenElement === null) {
      void container.requestFullscreen().catch(() => undefined);
    } else {
      void document.exitFullscreen().catch(() => undefined);
    }
  }

  /** Title-bar drag (the players' pointer-capture mechanism, A.2.9). */
  const onTitlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) {
        return;
      }
      // FIX (exe bug report 1): a pointerdown starting on the bar's ×
      // close button must not capture the pointer on the bar — the
      // retargeted pointerup would move the click to the bar and the
      // button's onClick would never fire (titleBarDrag.ts).
      if (isInteractiveTitleBarTarget(event.target, event.currentTarget)) {
        return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      // FIX (fix round 1): while x/y are the 0/0 centre-sentinel the window
      // is DISPLAYED centred — the drag origin must be that displayed
      // position (the render's exact formula), not the sentinel (the first
      // drag used to teleport the window to the raw delta).
      const centred = settings.x === 0 && settings.y === 0;
      const originX = centred
        ? Math.max(16, (window.innerWidth - settings.width) / 2)
        : settings.x;
      const originY = centred
        ? Math.max(16, (window.innerHeight - settings.height) / 2)
        : settings.y;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const onMove = (moveEvent: PointerEvent): void => {
        updateSettings({
          x: originX + (moveEvent.clientX - startX),
          y: originY + (moveEvent.clientY - startY),
        });
      };
      const onUp = (): void => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [settings.x, settings.y, settings.width, settings.height, updateSettings],
  );

  /** Corner-handle resize (min 400×500, A.2.3). */
  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      const originW = settings.width;
      const originH = settings.height;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const onMove = (moveEvent: PointerEvent): void => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        updateSettings({
          width: Math.max(PDF_VIEWER_MIN_WIDTH, originW + dx),
          height: Math.max(PDF_VIEWER_MIN_HEIGHT, originH + dy),
        });
      };
      const onUp = (): void => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [settings.width, settings.height, updateSettings],
  );

  /** Re-render on window RESIZE (the fit-width scale tracks width). */
  useEffect(() => {
    if (objectId === null || status !== "ready") {
      return;
    }
    const content = contentRef.current;
    if (content === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      void renderPage(pageState.page);
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId, status]);

  const pageBadge = useMemo(() => {
    const count = Math.max(1, pageState.pageCount);
    const current = Math.min(count, Math.max(1, pageState.page));
    return `${formatInteger(current, digitInput)} / ${formatInteger(count, digitInput)}`;
  }, [pageState, digitInput]);

  if (objectId === null || typeof document === "undefined") {
    return null;
  }

  // The default position centres the window on the first open.
  const left =
    settings.x === 0 && settings.y === 0
      ? Math.max(16, (window.innerWidth - settings.width) / 2)
      : settings.x;
  const top =
    settings.x === 0 && settings.y === 0
      ? Math.max(16, (window.innerHeight - settings.height) / 2)
      : settings.y;

  return createPortal(
    <div
      ref={containerRef}
      dir={rtl ? "rtl" : "ltr"}
      role="dialog"
      aria-label={t("pdfViewer.title")}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        "fixed z-[70] flex flex-col overflow-hidden bg-background/95",
        "text-foreground shadow-2xl shadow-black/50 backdrop-blur-md",
        "focus:outline-none",
        fullscreen
          ? "inset-0 h-full w-full rounded-none"
          : "rounded-xl border",
      )}
      style={
        fullscreen
          ? undefined
          : {
              // FIX (exe bug report 2): the previous object ended with
              // `position: "fixed", inset: "auto"` — the CSSOM shorthand
              // `inset` re-assigns top/right/bottom/left AFTER the explicit
              // left/top keys, wiping them to `auto`. A fixed box with all
              // offsets auto renders at its STATIC flow position (below the
              // app content — fully off-screen), so double-clicking a PDF
              // "did nothing" while the viewer was actually mounted there.
              // The window now matches the video/audio players' proven
              // pattern exactly: the `fixed` utility + left/top only, and
              // the fullscreen branch owns inset-0 (as the video player's
              // fullscreen class does).
              left: `${left}px`,
              top: `${top}px`,
              width: `${settings.width}px`,
              height: `${settings.height}px`,
            }
      }
    >
      {/* Title bar — the drag handle (A.2.9's reused mechanism). */}
      <div
        onPointerDown={onTitlePointerDown}
        className="flex cursor-move items-center gap-2 border-b bg-muted/60 px-3 py-2 select-none"
      >
        <FileText className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {meta?.name ?? t("pdfViewer.title")}
        </span>
        <button
          type="button"
          onClick={() => updateSettings({ zoom: settings.zoom })}
          disabled
          aria-hidden="true"
          className="hidden"
        />
        <span className="shrink-0 text-[11px] text-muted-foreground" dir="ltr">
          {pageBadge}
        </span>
        <button
          type="button"
          onClick={close}
          aria-label={t("pdfViewer.close")}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/* The page surface: ONE canvas + ONE text layer (RP2.3/RP2.4). */}
      <div
        ref={contentRef}
        onWheel={onContentWheel}
        className="relative min-h-0 flex-1 overflow-auto bg-muted/20 p-3"
      >
        {status === "loading" ? (
          <div className="grid size-full place-items-center px-3 text-xs text-muted-foreground">
            {t("pdfViewer.loading")}
          </div>
        ) : null}
        {status === "error" ? (
          <div className="grid size-full place-items-center px-3 text-xs text-destructive">
            {t("pdfViewer.pageError")}
          </div>
        ) : null}
        <div
          className={cn(
            "relative mx-auto",
            status === "ready" ? "" : "hidden",
            rendering ? "opacity-60" : "",
          )}
        >
          <canvas ref={canvasRef} className="block shadow-md" />
          {/* pdf.js's text layer: transparent spans at the viewport
              positions — native selection + Ctrl+C (RP2.3). */}
          <div
            ref={textLayerRef}
            className="pdf-text-layer"
            aria-hidden="false"
          />
        </div>
      </div>

      {/* The chrome (custom, RTL, theme-aware — RP2.2). */}
      <div className="flex flex-wrap items-center gap-1.5 border-t bg-background/90 px-3 py-2">
        <button
          type="button"
          onClick={() => goToPage(pageState.page - 1)}
          disabled={pageState.page <= 1 || rendering}
          aria-label={t("pdfViewer.prevPage")}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          {rtl ? (
            <ChevronRight className="size-4" aria-hidden="true" />
          ) : (
            <ChevronLeft className="size-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={() => goToPage(pageState.page + 1)}
          disabled={
            pageState.page >= pageState.pageCount || rendering
          }
          aria-label={t("pdfViewer.nextPage")}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          {rtl ? (
            <ChevronLeft className="size-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4" aria-hidden="true" />
          )}
        </button>

        {/* Page input (e.g. «۳ / ۱۰», Persian digits, A.2.8). */}
        <span
          dir="ltr"
          className="ms-1 select-none font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {pageBadge}
        </span>
        <input
          type="number"
          min={1}
          max={pageState.pageCount}
          value={pageState.page}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value >= 1) {
              goToPage(value);
            }
          }}
          aria-label={t("pdfViewer.pageInput")}
          className="h-8 w-14 rounded-lg border bg-background px-2 text-center text-[11px] tabular-nums text-foreground"
        />

        <div className="flex-1" />

        {/* Internal zoom (persisted, A.2.3). */}
        <button
          type="button"
          onClick={() =>
            updateSettings({
              zoom: Math.max(
                PDF_VIEWER_MIN_ZOOM,
                settings.zoom - PDF_VIEWER_ZOOM_STEP,
              ),
            })
          }
          disabled={settings.zoom <= PDF_VIEWER_MIN_ZOOM}
          aria-label={t("pdfViewer.zoomOut")}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <ZoomOut className="size-4" aria-hidden="true" />
        </button>
        <span className="select-none text-[11px] tabular-nums text-muted-foreground" dir="ltr">
          {settings.zoom
            .toLocaleString(digitInput === "fa" ? "fa-IR" : "en-US")
            .replace("٫", ".")}×
        </span>
        <button
          type="button"
          onClick={() =>
            updateSettings({
              zoom: Math.min(
                PDF_VIEWER_MAX_ZOOM,
                settings.zoom + PDF_VIEWER_ZOOM_STEP,
              ),
            })
          }
          disabled={settings.zoom >= PDF_VIEWER_MAX_ZOOM}
          aria-label={t("pdfViewer.zoomIn")}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <ZoomIn className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => updateSettings({ zoom: 1 })}
          aria-label={t("pdfViewer.fitWidth")}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MoveHorizontal className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={
            fullscreen ? t("pdfViewer.exitFullscreen") : t("pdfViewer.fullscreen")
          }
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {fullscreen ? (
            <Minimize className="size-4" aria-hidden="true" />
          ) : (
            <Maximize className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* The resize handle (corner). */}
      {!fullscreen ? (
        <div
          onPointerDown={onResizePointerDown}
          role="separator"
          aria-label={t("pdfViewer.resize")}
          className="absolute bottom-0 end-0 size-4 cursor-nwse-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 50%, hsl(var(--border)) 50%)",
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
