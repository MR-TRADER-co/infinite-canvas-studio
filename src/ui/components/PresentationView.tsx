"use client";

/**
 * Presentation mode (R8.3, F5): a fullscreen overlay presenting the
 * scene's FRAME objects one per slide — the canvas raster (shapes,
 * notes, strokes — the export pipeline's renderer) beneath a LIVE DOM
 * text layer (real HTML text, so links stay clickable, AC8.5).
 *
 * Navigation: ← → / Space (RTL-aware — in Persian the LEFT arrow moves
 * forward), on-screen buttons, Esc exits. Entering requests browser
 * fullscreen; leaving restores it.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pin,
  Presentation,
  X,
} from "lucide-react";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import {
  presentationSlides,
  slideBounds,
  slideTextObjects,
  fitSlideToViewport,
  type PresentationSlide,
} from "@/core/presentation/Presentation";
import {
  buildPinnedExportPlan,
  buildTextLayerHtml,
  exportProseCss,
  PngExportError,
  exportToPng,
  type TextLayerOverride,
} from "@/persistence/exporters/PngExporter";
import { isPinnedObject } from "@/core/model/Pinned";
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  type RenderPalette,
} from "@/rendering/Canvas2DRenderer";
import {
  renderRichTextHTML,
  getSharedTextEditor,
} from "@/text/editor/TipTapFactory";

/** Rasterised slide image state. */
interface SlideImage {
  readonly url: string;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** The presentation overlay (renders only while active). */
export default function PresentationView(): ReactNode {
  const { t, language } = useTranslation();
  const persianDigits = useUiStore((state) => state.persianDigits);
  const theme = useUiStore((state) => state.theme);
  const active = useUiStore((state) => state.presentationActive);
  const setActive = useUiStore((state) => state.setPresentationActive);
  const index = useUiStore((state) => state.presentationIndex);
  const setIndex = useUiStore((state) => state.setPresentationIndex);
  const [slides, setSlides] = useState<readonly PresentationSlide[]>([]);
  const [image, setImage] = useState<SlideImage | null>(null);
  const [textLayer, setTextLayer] = useState<string>("");
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [pinnedHint, setPinnedHint] = useState(false);
  // فاز ۳۱ «شامل اشیای سنجاق‌شده»: opt-in overlay of the screen-pinned
  // furniture onto every slide — the SAME mapped-clone semantics the export
  // pipeline took (فاز ۲۸): anchor fraction of the slide, relative footprint
  // of the presenting viewport. Session-scoped: every entry resets to off.
  const [includePinned, setIncludePinned] = useState(false);
  const [sceneHasPins, setSceneHasPins] = useState(false);

  const locale = { language, persianDigits };

  /** Enter: snapshot the slides + request browser fullscreen. */
  useEffect(() => {
    if (!active) {
      return;
    }
    const scene = AppContext.getDefault().tryGet(Services.scene);
    if (scene === undefined) {
      setActive(false);
      return;
    }
    const current = presentationSlides(scene);
    if (current.length === 0) {
      setActive(false);
      return;
    }
    setSlides(current);
    setIndex(0);
    // فاز ۳۱: pins are excluded by default; the HUD toggle (visible only
    // while pins exist) overlays them on demand. The enter hint now points
    // AT that toggle instead of just stating the exclusion.
    const hasPins = scene.objects.some(
      (object) => object.visible && object.pinned === true,
    );
    setSceneHasPins(hasPins);
    setIncludePinned(false);
    setPinnedHint(hasPins);
    if (typeof document !== "undefined") {
      void document.documentElement
        .requestFullscreen?.()
        .catch(() => undefined);
    }
  }, [active, setActive, setIndex]);

  /** The pinned hint self-dismisses after a beat. */
  useEffect(() => {
    if (!pinnedHint) {
      return;
    }
    const timer = window.setTimeout((): void => {
      setPinnedHint(false);
    }, 4200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [pinnedHint]);

  /** Exit: leave browser fullscreen. */
  const exit = useCallback((): void => {
    if (
      typeof document !== "undefined" &&
      document.fullscreenElement !== null
    ) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
    setActive(false);
    setImage(null);
    setTextLayer("");
    setPinnedHint(false);
  }, [setActive]);

  /** Measure the viewport while active. */
  useEffect(() => {
    if (!active) {
      return;
    }
    const measure = (): void => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [active]);

  const safeIndex = Math.min(index, Math.max(0, slides.length - 1));
  const slide = slides[safeIndex] ?? null;

  /** Rasterise the current slide whenever it changes. */
  useEffect(() => {
    if (!active || slide === null) {
      return;
    }
    let cancelled = false;
    const scene = AppContext.getDefault().tryGet(Services.scene);
    if (scene === undefined) {
      return;
    }
    const palette: RenderPalette = {
      ...(theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE),
      opaqueLabel: t("object.opaque"),
      brokenImageLabel: t("image.broken"),
      frameUntitledLabel: t("object.frame"),
    };
    const styles =
      typeof document !== "undefined"
        ? getComputedStyle(document.documentElement)
        : null;
    const themeInk =
      styles?.getPropertyValue("--foreground").trim() || "#1c1917";
    const themeBorder =
      styles?.getPropertyValue("--border").trim() || "#57534e";
    const themeMuted =
      styles?.getPropertyValue("--muted-foreground").trim() || "#a8a29e";
    // فاز ۳۱: the presenting viewport (fullscreen overlay) sizes the pinned
    // footprint mapping — the live window is the truth at presentation time.
    const presentingViewport =
      viewport.width > 0 && viewport.height > 0
        ? viewport
        : typeof window !== "undefined"
          ? { width: window.innerWidth, height: window.innerHeight }
          : { width: 0, height: 0 };
    const pinnedOptions =
      includePinned && sceneHasPins && presentingViewport.width > 0
        ? { includePinned: true, pinnedViewport: presentingViewport }
        : {};
    void (async (): Promise<void> => {
      try {
        const blob = await exportToPng(scene, {
          region: { mode: "bbox", box: slideBounds(slide.frame) },
          scale: 1,
          transparent: false,
          palette,
          themeInk,
          themeBorder,
          themeMuted,
          padding: 0,
          ...pinnedOptions,
          renderRichHtml: (doc) =>
            renderRichTextHTML(getSharedTextEditor().getSchema(), doc),
        });
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setImage({ url, scale: 1, offsetX: 0, offsetY: 0 });
      } catch (error) {
        if (!(error instanceof PngExportError && error.kind === "no-content")) {
          console.warn("[presentation] slide raster failed", error);
        }
        setImage(null);
      }
      // Text layer: live DOM (clickable links) built from the export
      // machinery but mounted directly (real fonts, no rasterization).
      // فاز ۳۱: with the overlay ON, the plan's pinned text objects join
      // AFTER the slide's world text (pinned furniture floats on top —
      // the same z-order the raster pass paints).
      const bounds = slideBounds(slide.frame);
      const worldText = slideTextObjects(slide);
      let layerObjects = worldText;
      let overrides: ReadonlyMap<string, TextLayerOverride> | undefined;
      if (includePinned && sceneHasPins) {
        const plan = buildPinnedExportPlan(scene, bounds, 1, {
          includePinned: true,
          pinnedViewport:
            presentingViewport.width > 0
              ? presentingViewport
              : undefined,
        });
        const pinnedText = plan.textObjects.filter((object) =>
          isPinnedObject(object),
        );
        layerObjects = [...worldText, ...pinnedText];
        overrides = plan.textOverrides;
      }
      const html = buildTextLayerHtml(layerObjects, bounds, 1, {
        themeInk,
        themeBorder,
        themeMuted,
        renderRichHtml: (doc) =>
          renderRichTextHTML(getSharedTextEditor().getSchema(), doc),
      }, overrides);
      if (!cancelled) {
        setTextLayer(html);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, slide, theme, t, includePinned, sceneHasPins, viewport]);

  /** Keyboard navigation (RTL-aware) + Esc. */
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        exit();
        return;
      }
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        next();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        // RTL: left arrow moves FORWARD in Persian, backward in English.
        if (language === "fa") {
          next();
        } else {
          previous();
        }
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (language === "fa") {
          previous();
        } else {
          next();
        }
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setIndex(Math.max(0, slides.length - 1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, exit, language, slides.length, safeIndex, setIndex]);

  const next = useCallback((): void => {
    setIndex(Math.min(safeIndex + 1, slides.length - 1));
  }, [safeIndex, slides.length, setIndex]);

  const previous = useCallback((): void => {
    setIndex(Math.max(safeIndex - 1, 0));
  }, [safeIndex, setIndex]);

  /** Link clicks inside the text layer → the app's link-open flow. */
  const onLayerClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      const anchor = (event.target as HTMLElement).closest("a");
      if (anchor === null) {
        return;
      }
      const href = anchor.getAttribute("href");
      if (href === null || href === "" || href.startsWith("#")) {
        return;
      }
      event.preventDefault();
      AppContext.getDefault()
        .tryGet(Services.eventBus)
        ?.emit("ui:open-link-confirmation", { url: href });
    },
    [],
  );

  /** The slide's screen fit (letterboxed, centred). */
  const fit = useMemo(() => {
    if (slide === null || viewport.width === 0) {
      return null;
    }
    return fitSlideToViewport(slideBounds(slide.frame), viewport);
  }, [slide, viewport]);

  /** Cleanup the object URL on unmount/slide change. */
  useEffect(() => {
    return () => {
      if (image !== null) {
        URL.revokeObjectURL(image.url);
      }
    };
  }, [image]);

  if (!active || slide === null) {
    return null;
  }

  const slideTitle =
    slide.frame.title !== "" ? slide.frame.title : t("object.frame");

  return (
    <div
      dir={language === "fa" ? "rtl" : "ltr"}
      role="dialog"
      aria-modal="true"
      aria-label={t("presentation.enter")}
      className="fixed inset-0 z-[100] flex flex-col bg-background"
    >
      {/* Slide stage: the raster + the live text layer, letterboxed. */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {image !== null && fit !== null ? (
          // A live raster of the slide (blob URL) — next/image cannot
          // optimise in-memory canvas output, so the raw img is correct.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt={slideTitle}
            draggable={false}
            className="absolute rounded-sm shadow-2xl"
            style={{
              width:
                (slideBounds(slide.frame).maxX -
                  slideBounds(slide.frame).minX) *
                fit.scale,
              height:
                (slideBounds(slide.frame).maxY -
                  slideBounds(slide.frame).minY) *
                fit.scale,
              left: fit.offsetX,
              top: fit.offsetY,
              transform: language === "fa" ? undefined : undefined,
            }}
          />
        ) : null}
        {fit !== null && textLayer !== "" ? (
          <div
            onClick={onLayerClick}
            className="absolute select-none"
            style={{
              width:
                (slideBounds(slide.frame).maxX -
                  slideBounds(slide.frame).minX) *
                fit.scale,
              height:
                (slideBounds(slide.frame).maxY -
                  slideBounds(slide.frame).minY) *
                fit.scale,
              left: fit.offsetX,
              top: fit.offsetY,
            }}
          >
            <style>
              {exportProseCss({
                themeInk:
                  getComputedStyle(document.documentElement)
                    .getPropertyValue("--foreground")
                    .trim() || "#1c1917",
                themeBorder:
                  getComputedStyle(document.documentElement)
                    .getPropertyValue("--border")
                    .trim() || "#57534e",
                themeMuted:
                  getComputedStyle(document.documentElement)
                    .getPropertyValue("--muted-foreground")
                    .trim() || "#a8a29e",
              })}
            </style>
            {/* The text layer HTML positions children in WORLD units
                relative to the slide bounds; scale the container. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                transform: `scale(${fit.scale})`,
                transformOrigin: "0 0",
              }}
              dangerouslySetInnerHTML={{ __html: textLayer }}
            />
          </div>
        ) : null}
        {slides.length === 0 ? null : null}
        {/* فاز ۲۹: the pinned-hint pill — appears once on enter when the
            scene carries pinned objects, then fades itself out. */}
        {pinnedHint ? (
          <div
            role="status"
            className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-amber-500/30 bg-background/90 px-3 py-1 text-[0.6875rem] text-muted-foreground shadow-md backdrop-blur-sm"
          >
            {t("presentation.pinnedHidden")}
          </div>
        ) : null}
      </div>

      {/* HUD: frame title, slide counter, progress, navigation. */}
      <footer className="flex h-12 flex-none items-center gap-3 border-t border-border bg-background/95 px-4 text-xs text-muted-foreground backdrop-blur-md">
        <Presentation className="size-4 text-primary" aria-hidden="true" />
        <span className="max-w-60 truncate font-medium text-foreground">
          {slideTitle}
        </span>
        <span className="rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-medium tabular-nums">
          {t("presentation.slideOf")
            .replace("{current}", formatInteger(safeIndex + 1, locale))
            .replace("{total}", formatInteger(slides.length, locale))}
        </span>
        {/* فاز ۲۹: segmented slide progress — one clickable segment per
            slide (jump navigation), the active one accented. RTL-safe by
            flex order; capped width with scroll for long decks. */}
        {slides.length > 1 ? (
          <nav
            role="group"
            aria-label={t("presentation.progressLabel")}
            className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:flex"
          >
            {slides.map((_, index): ReactNode => {
              const activeSlide = index === safeIndex;
              return (
                <button
                  key={index}
                  type="button"
                  aria-current={activeSlide ? "true" : undefined}
                  aria-label={t("presentation.goToSlide").replace(
                    "{number}",
                    formatInteger(index + 1, locale),
                  )}
                  title={t("presentation.goToSlide").replace(
                    "{number}",
                    formatInteger(index + 1, locale),
                  )}
                  onClick={(): void => setIndex(index)}
                  className={
                    "h-1.5 flex-none rounded-full transition-all duration-200 " +
                    (activeSlide
                      ? "w-6 bg-primary"
                      : "w-3 bg-border hover:bg-muted-foreground/40")
                  }
                />
              );
            })}
          </nav>
        ) : null}
        {/* فاز ۳۱ «شامل اشیای سنجاق‌شده»: the amber pin overlay toggle —
            only while the presenting scene carries pins. Same amber
            identity as the export dialog's switch (the pin language). */}
        {sceneHasPins ? (
          <button
            type="button"
            role="switch"
            aria-checked={includePinned}
            aria-label={t("presentation.includePinned")}
            title={t("presentation.includePinned")}
            onClick={(): void => {
              setIncludePinned((value) => !value);
              setPinnedHint(false);
            }}
            className={
              "flex h-8 flex-none items-center gap-1.5 rounded-md border px-2 text-[0.6875rem] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (includePinned
                ? "border-amber-500/50 bg-amber-500/15 text-amber-600 shadow-[0_0_0_1px_rgba(245,158,11,0.15)] dark:text-amber-400"
                : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-accent hover:text-foreground")
            }
          >
            <Pin
              className={
                "size-3.5 transition-transform duration-200 " +
                (includePinned ? "-rotate-45 scale-110" : "")
              }
              aria-hidden="true"
            />
            <span className="hidden sm:inline">
              {t("presentation.includePinned")}
            </span>
          </button>
        ) : null}
        <span className="hidden text-[0.6875rem] md:inline">
          {t("presentation.navHint")}
        </span>
        <div className="ms-auto flex items-center gap-1.5">
          <button
            type="button"
            className="grid size-8 place-items-center rounded-md transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("presentation.prev")}
            title={t("presentation.prev")}
            disabled={safeIndex === 0}
            onClick={previous}
          >
            {language === "fa" ? (
              <ChevronRight className="size-4" aria-hidden="true" />
            ) : (
              <ChevronLeft className="size-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-md transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("presentation.next")}
            title={t("presentation.next")}
            disabled={safeIndex >= slides.length - 1}
            onClick={next}
          >
            {language === "fa" ? (
              <ChevronLeft className="size-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-md transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("presentation.exit")}
            title={t("presentation.exit")}
            onClick={exit}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </footer>
    </div>
  );
}
