"use client";

/**
 * Export dialog (R4.8 + R8.7): format tabs (PNG / SVG / PDF), region
 * (whole board / current selection), scale (۱x/۲x), background (canvas
 * colour / transparent) and a live size preview. PNG composites the
 * canvas layer + rasterized text layer; SVG vectorises shapes/notes/frames
 * with the text layer as an embedded raster (limitation stated in the
 * dialog); PDF runs the print pipeline (one frame per page, or fit-all).
 *
 * Opened by the `core.export.png` / `.svg` / `.pdf` commands through the
 * UI store's `exportPngDialogOpen` + `exportDialogFormat` slices.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ImageDown, Loader2, Pin, Scan } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { isPinnedObject } from "@/core/model/Pinned";
import type { BBox } from "@/core/geometry/BBox";
import { minimapViewportWorldBounds } from "@/core/minimap/Minimap";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import {
  computeExportBounds,
  exportToPng,
  PngExportError,
  type ExportRegion,
} from "@/persistence/exporters/PngExporter";
import { exportToSvg } from "@/persistence/exporters/SvgExporter";
import {
  exportToPdf,
  type PdfLayout,
} from "@/persistence/exporters/PdfExporter";
import { isFrameObject } from "@/core/model/FrameObject";
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  type RenderPalette,
} from "@/rendering/Canvas2DRenderer";
import { renderRichTextHTML } from "@/text/editor/TipTapFactory";
import { getSharedTextEditor } from "@/text/editor/TipTapFactory";
import { isTauriEnvironment } from "@/platform/tauri/log";
import { saveFileDialog } from "@/platform/tauri/dialog";

/** World-unit margin around the exported content (matches the exporter). */
const EXPORT_PADDING = 24;

/** The Export dialog (UI-store driven visibility + format). */
export default function ExportPngDialog(): ReactNode {
  const { t, language } = useTranslation();
  const persianDigits = useUiStore((state) => state.persianDigits);
  const theme = useUiStore((state) => state.theme);
  const open = useUiStore((state) => state.exportPngDialogOpen);
  const setOpen = useUiStore((state) => state.setExportPngDialogOpen);
  const format = useUiStore((state) => state.exportDialogFormat);
  const setFormat = useUiStore((state) => state.setExportDialogFormat);
  const [region, setRegion] = useState<"scene" | "selection">("scene");
  const [scale, setScale] = useState<1 | 2>(2);
  const [transparent, setTransparent] = useState(false);
  const [pdfLayout, setPdfLayout] = useState<PdfLayout>("frames");
  const [busy, setBusy] = useState(false);
  const [selectionIds, setSelectionIds] = useState<readonly string[]>([]);
  const [hasContent, setHasContent] = useState(true);
  const [frameCount, setFrameCount] = useState(0);
  // فاز ۲۸ «شامل اشیای سنجاق‌شده»: opt-in inclusion of the screen-pinned
  // furniture, offered only while pinned objects exist.
  const [includePinned, setIncludePinned] = useState(false);
  const [pinnedCount, setPinnedCount] = useState(0);

  /** Live selection snapshot while the dialog is open. */
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    const install = (): void => {
      const selection = AppContext.getDefault().tryGet(Services.selection);
      if (selection !== undefined && !cancelled) {
        setSelectionIds([...selection.ids]);
      }
    };
    install();
    void Application.boot().then(() => {
      if (!cancelled) {
        install();
        const scene = AppContext.getDefault().tryGet(Services.scene);
        if (scene !== undefined) {
          setFrameCount(
            scene.objects.filter(
              (object) => isFrameObject(object) && object.visible,
            ).length,
          );
          setPinnedCount(
            scene.objects.filter(
              (object) => isPinnedObject(object) && object.visible,
            ).length,
          );
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  /**
   * فاز ۳۱: the live camera's viewport in WORLD units — the fallback frame
   * for a pins-only board (previously «۰ × ۰ پیکسل» + a dead export button).
   * Read lazily: the camera is at rest while the dialog is open.
   */
  const readViewportWorldFrame = (): BBox | null => {
    const canvasElement = window.document.querySelector("canvas");
    if (
      canvasElement === null ||
      canvasElement.clientWidth <= 0 ||
      canvasElement.clientHeight <= 0
    ) {
      return null;
    }
    const controller = AppContext.getDefault().tryGet(
      Services.cameraController,
    );
    if (controller === undefined) {
      return null;
    }
    return minimapViewportWorldBounds(controller.camera, {
      width: canvasElement.clientWidth,
      height: canvasElement.clientHeight,
    });
  };

  /** The framed region + its world bounds (size preview + the export). */
  const framed = useMemo(() => {
    // Re-framed on every open (the scene may have changed since) — `open`
    // is a genuine dependency of the computation.
    if (!open) {
      return null;
    }
    const scene = AppContext.getDefault().tryGet(Services.scene);
    if (scene === undefined) {
      return null;
    }
    const chosen: ExportRegion =
      region === "selection" && selectionIds.length > 0
        ? { mode: "selection", ids: selectionIds }
        : { mode: "scene" };
    // فاز ۳۱: pins-only boards frame the live viewport instead of nothing.
    const frame = readViewportWorldFrame();
    const bounds = computeExportBounds(scene, chosen, frame);
    const viewportFramed =
      bounds !== null &&
      frame !== null &&
      computeExportBounds(scene, chosen) === null;
    return { region: chosen, bounds, viewportFramed };
  }, [open, region, selectionIds]);

  /** Pixel dimensions of the export (size preview — includes the padding
   *  the exporter adds around the framed content, so the number matches
   *  the delivered file exactly). */
  const pixelSize = useMemo(() => {
    if (framed?.bounds == null) {
      return null;
    }
    const width = Math.max(
      1,
      Math.round(
        (framed.bounds.maxX - framed.bounds.minX + 2 * EXPORT_PADDING) * scale,
      ),
    );
    const height = Math.max(
      1,
      Math.round(
        (framed.bounds.maxY - framed.bounds.minY + 2 * EXPORT_PADDING) * scale,
      ),
    );
    return { width, height };
  }, [framed, scale]);

  /** Whether the selection option is available at all. */
  const hasSelection = selectionIds.length > 0;

  /** Runs the export and delivers the file (per selected format). */
  const runExport = (): void => {
    const scene = AppContext.getDefault().tryGet(Services.scene);
    if (scene === undefined || framed === null || framed.bounds === null) {
      return;
    }
    setBusy(true);
    const palette: RenderPalette = {
      ...(theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE),
      opaqueLabel: t("object.opaque"),
      brokenImageLabel: t("image.broken"),
      frameUntitledLabel: t("object.frame"),
    };
    const themeColors = readThemeColors();
    const document = AppContext.getDefault().tryGet(Services.document);
    // فاز ۲۸: the pinned inclusion rides every format — the live canvas
    // viewport (CSS px) sizes the relative footprint mapping. (The DOM
    // global is reached through `window` — a local `document` service
    // shadows the bare name below.)
    const canvasElement = window.document.querySelector("canvas");
    const pinnedOptions =
      includePinned && pinnedCount > 0
        ? {
            includePinned: true,
            pinnedViewport:
              canvasElement !== null &&
              canvasElement.clientWidth > 0 &&
              canvasElement.clientHeight > 0
                ? {
                    width: canvasElement.clientWidth,
                    height: canvasElement.clientHeight,
                  }
                : undefined,
          }
        : {};
    // فاز ۳۱: a pins-only board frames the live viewport (WYSIWYG).
    const viewportWorldFrame = readViewportWorldFrame();
    const shared = {
      ...pinnedOptions,
      ...(viewportWorldFrame !== null ? { viewportWorldFrame } : {}),
      palette,
      themeInk: themeColors.ink,
      themeBorder: themeColors.border,
      themeMuted: themeColors.muted,
      padding: EXPORT_PADDING,
      renderRichHtml: (doc: Parameters<typeof renderRichTextHTML>[1]) =>
        renderRichTextHTML(getSharedTextEditor().getSchema(), doc),
    };
    if (format === "svg") {
      void exportToSvg(scene, {
        region: framed.region,
        scale,
        transparent,
        ...shared,
      })
        .then(async (result) => {
          await deliverText(
            result.svg,
            "image/svg+xml",
            downloadName(document?.getName() ?? null, "svg"),
          );
          notify(t("export.savedToast"), "info");
          setBusy(false);
          setOpen(false);
        })
        .catch((error: unknown) => {
          handleFailure(error);
        });
      return;
    }
    if (format === "pdf") {
      void exportToPdf(
        scene,
        { layout: pdfLayout, scale, ...shared },
        language === "fa" ? "rtl" : "ltr",
      )
        .then(() => {
          notify(t("export.savedToast"), "info");
          setBusy(false);
          setOpen(false);
        })
        .catch((error: unknown) => {
          handleFailure(error);
        });
      return;
    }
    void exportToPng(scene, {
      region: framed.region,
      scale,
      transparent,
      ...shared,
    })
      .then(async (blob) => {
        if (isTauriEnvironment()) {
          const saved = await savePngViaNativeDialog(
            blob,
            document?.getName() ?? null,
          );
          if (saved === "cancelled") {
            setBusy(false);
            return;
          }
        } else {
          downloadBlob(blob, downloadName(document?.getName() ?? null, "png"));
        }
        notify(t("export.savedToast"), "info");
        setBusy(false);
        setOpen(false);
      })
      .catch((error: unknown) => {
        handleFailure(error);
      });
  };

  /** Common failure toast + no-content latching. */
  const handleFailure = (error: unknown): void => {
    setBusy(false);
    const reason =
      error instanceof PngExportError
        ? `${error.kind}: ${error.message}`
        : String(error);
    notify(t("export.failed").replace("{reason}", reason), "error");
    if (error instanceof PngExportError && error.kind === "no-content") {
      setHasContent(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? undefined : setOpen(false))}
    >
      <DialogContent
        dir={language === "fa" ? "rtl" : "ltr"}
        className="max-w-md"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageDown className="size-4" aria-hidden="true" />
            {t("export.title")}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs leading-relaxed">
            <span>
              {t("export.sizePreview")
                .replace(
                  "{width}",
                  formatInteger(pixelSize?.width ?? 0, {
                    language,
                    persianDigits,
                  }),
                )
                .replace(
                  "{height}",
                  formatInteger(pixelSize?.height ?? 0, {
                    language,
                    persianDigits,
                  }),
                )}
            </span>
            {/* فاز ۳۱: an honest amber badge when the frame comes from the
                live viewport (pins-only board) — the number otherwise
                reads as arbitrary without the why. */}
            {framed?.viewportFramed === true ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.6875rem] font-medium text-amber-600 dark:text-amber-400">
                <Scan className="size-3" aria-hidden="true" />
                {t("export.viewportFrameBadge")}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* R8.7: the format selector — one export surface, three formats. */}
          <fieldset className="space-y-1.5">
            <legend className="text-[11px] font-medium text-muted-foreground">
              {t("export.formatLabel")}
            </legend>
            <div className="flex gap-2">
              <ToggleChip
                active={format === "png"}
                onClick={() => setFormat("png")}
                label={t("export.formatPng")}
              />
              <ToggleChip
                active={format === "svg"}
                onClick={() => setFormat("svg")}
                label={t("export.formatSvg")}
              />
              <ToggleChip
                active={format === "pdf"}
                onClick={() => setFormat("pdf")}
                label={t("export.formatPdf")}
              />
            </div>
          </fieldset>
          {format === "svg" ? (
            <p className="rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
              {t("export.svgTextNote")}
            </p>
          ) : null}
          {format === "pdf" ? (
            <>
              <fieldset className="space-y-1.5">
                <legend className="text-[11px] font-medium text-muted-foreground">
                  {t("export.pdfModeLabel")}
                </legend>
                <div className="flex gap-2">
                  <ToggleChip
                    active={pdfLayout === "frames"}
                    disabled={frameCount === 0}
                    onClick={() => setPdfLayout("frames")}
                    label={t("export.pdfFrames")}
                  />
                  <ToggleChip
                    active={pdfLayout === "fit-all"}
                    onClick={() => setPdfLayout("fit-all")}
                    label={t("export.pdfFitAll")}
                  />
                </div>
              </fieldset>
              <p className="rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
                {t("export.pdfNote")}
              </p>
            </>
          ) : (
            <>
              <fieldset className="space-y-1.5">
                <legend className="text-[11px] font-medium text-muted-foreground">
                  {t("export.regionLabel")}
                </legend>
                <div className="flex gap-2">
                  <ToggleChip
                    active={region === "scene"}
                    onClick={() => setRegion("scene")}
                    label={t("export.regionScene")}
                  />
                  <ToggleChip
                    active={region === "selection"}
                    disabled={!hasSelection}
                    onClick={() => setRegion("selection")}
                    label={t("export.regionSelection")}
                  />
                </div>
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="text-[11px] font-medium text-muted-foreground">
                  {t("export.scaleLabel")}
                </legend>
                <div className="flex gap-2" dir="ltr">
                  <ToggleChip
                    active={scale === 1}
                    onClick={() => setScale(1)}
                    label={persianDigits ? "۱x" : "1x"}
                  />
                  <ToggleChip
                    active={scale === 2}
                    onClick={() => setScale(2)}
                    label={persianDigits ? "۲x" : "2x"}
                  />
                </div>
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="text-[11px] font-medium text-muted-foreground">
                  {t("export.backgroundLabel")}
                </legend>
                <div className="flex gap-2">
                  <ToggleChip
                    active={!transparent}
                    onClick={() => setTransparent(false)}
                    label={t("export.backgroundTheme")}
                  />
                  <ToggleChip
                    active={transparent}
                    onClick={() => setTransparent(true)}
                    label={t("export.backgroundTransparent")}
                  />
                </div>
              </fieldset>
            </>
          )}
          {pinnedCount > 0 ? (
            <div
              className={
                "rounded-lg border px-3 py-2.5 transition-colors " +
                (includePinned
                  ? "border-amber-500/40 bg-amber-500/10"
                  : "border-border/60 bg-muted/30")
              }
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Pin
                    className={
                      "size-3.5 shrink-0 transition-colors " +
                      (includePinned
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground")
                    }
                    aria-hidden="true"
                  />
                  <span className="truncate text-xs font-medium text-foreground">
                    {t("export.includePinned")}
                  </span>
                  <span
                    dir="ltr"
                    className={
                      "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums transition-colors " +
                      (includePinned
                        ? "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        : "border-border/60 bg-background text-muted-foreground")
                    }
                  >
                    {formatInteger(pinnedCount, persianDigits ? "fa" : "en")}
                  </span>
                </div>
                <Switch
                  checked={includePinned}
                  onCheckedChange={setIncludePinned}
                  aria-label={t("export.includePinned")}
                  className="data-[state=checked]:bg-amber-600 dark:data-[state=checked]:bg-amber-500"
                />
              </div>
              <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
                {t("export.includePinnedHint")}
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            {t("link.confirmCancel")}
          </Button>
          <Button
            onClick={runExport}
            disabled={busy || pixelSize === null || !hasContent}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {busy ? t("export.busy") : t("export.button")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A small toggle chip (radio-like) of the option rows. */
function ToggleChip({
  active,
  disabled,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 " +
        (active
          ? "border-border bg-muted text-foreground shadow-sm"
          : "border-border/60 bg-transparent text-muted-foreground hover:text-foreground")
      }
    >
      {label}
    </button>
  );
}

/** Emits one notice toast on the app bus. */
function notify(message: string, severity: "info" | "error"): void {
  AppContext.getDefault()
    .tryGet(Services.eventBus)
    ?.emit("ui:notice", { messageKey: message, severity });
}

/**
 * Reads the theme colours the prose CSS needs (CSS variables resolve to
 * the ACTIVE theme — dark/light).
 */
function readThemeColors(): { ink: string; border: string; muted: string } {
  const styles = getComputedStyle(document.documentElement);
  return {
    ink: styles.getPropertyValue("--foreground").trim() || "#1c1917",
    border: styles.getPropertyValue("--border").trim() || "#57534e",
    muted: styles.getPropertyValue("--muted-foreground").trim() || "#a8a29e",
  };
}

/**
 * @param documentName - the open document's name (or null).
 * @returns the suggested PNG file name.
 */
function downloadName(documentName: string | null, extension: string): string {
  const base =
    documentName === null
      ? "infinite-canvas"
      : documentName.replace(/\.icb$/i, "");
  return `${base}.${extension}`;
}

/**
 * Delivers a TEXT file (the SVG export): browser download on the web
 * shell, native Save dialog + `save_text_file` IPC on the desktop.
 *
 * @param contents - the file payload.
 * @param mimeType - the download MIME type.
 * @param name - the suggested file name.
 */
async function deliverText(
  contents: string,
  mimeType: string,
  name: string,
): Promise<void> {
  if (!isTauriEnvironment()) {
    downloadBlob(new Blob([contents], { type: mimeType }), name);
    return;
  }
  const { saveFileDialog } = await import("@/platform/tauri/dialog");
  const picked = await saveFileDialog({
    defaultPath: name,
    filters: [{ name: "SVG Image", extensions: ["svg"] }],
  });
  if (picked === null) {
    return;
  }
  const core = await import("@tauri-apps/api/core");
  await core.invoke("save_text_file", { path: picked, contents });
}

/** Triggers the browser download of one blob. */
function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Saves the PNG on the desktop shell: the native Save dialog → the
 * `save_binary_file` IPC command (base64 → bytes, R4.8).
 *
 * @param blob - the encoded PNG.
 * @param documentName - the suggested file base name.
 * @returns "saved" or "cancelled".
 */
async function savePngViaNativeDialog(
  blob: Blob,
  documentName: string | null,
): Promise<"saved" | "cancelled"> {
  const base =
    documentName === null
      ? "infinite-canvas"
      : documentName.replace(/\.icb$/i, "");
  const picked = await saveFileDialog({
    defaultPath: `${base}.png`,
    filters: [{ name: "PNG Image", extensions: ["png"] }],
  });
  if (picked === null) {
    return "cancelled";
  }
  const core = await import("@tauri-apps/api/core");
  const base64 = await blobToBase64(blob);
  await core.invoke("save_binary_file", { path: picked, contents: base64 });
  return "saved";
}

/**
 * @param blob - the blob to encode.
 * @returns the base64 payload (no data-url prefix).
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
