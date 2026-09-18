/**
 * PDF exporter (R8.7): a PRINT pipeline — each page is the rasterised
 * rendering of one FRAME (or the whole board, fit-all mode) embedded
 * into a print document opened through a hidden iframe; the browser /
 * WebView2 print dialog's «Save as PDF» produces the final file. The
 * raster path is what GUARANTEES correct Persian text (shaping + bidi +
 * embedded fonts) inside the PDF (AC8.8) — no fragile font embedding of
 * a hand-built PDF.
 *
 * Pure planning (page list, sizes, HTML assembly) is separated from the
 * single DOM side effect (opening the print window) so everything is
 * node-testable.
 */
import type { Scene } from "@/core/model/Scene";
import { objectBBox } from "@/core/model/SceneObject";
import { isFrameObject, type FrameObjectData } from "@/core/model/FrameObject";
import type { BBox } from "@/core/geometry/BBox";
import {
  computeExportBounds,
  PngExportError,
  type ExportRegion,
  type PngExportOptions,
} from "@/persistence/exporters/PngExporter";

/** Re-exported typed error (same failure family). */
export { PngExportError as PdfExportError };

/** The page layout modes (R8.7). */
export type PdfLayout = "frames" | "fit-all";

/** Options of one PDF export. */
export interface PdfExportOptions extends Pick<
  PngExportOptions,
  | "palette"
  | "themeInk"
  | "themeBorder"
  | "themeMuted"
  | "renderRichHtml"
  | "padding"
  | "includePinned"
  | "pinnedViewport"
  | "viewportWorldFrame"
> {
  /** One page per frame, or the whole board on a single page. */
  readonly layout: PdfLayout;
  /** Pixel scale of each page raster (1–2). */
  readonly scale: number;
}

/** One planned page. */
export interface PdfPage {
  /** Rasterised page image (PNG data URL — filled by the renderer). */
  image: string;
  /** Aspect ratio width/height of the page raster. */
  readonly aspect: number;
  /** Page caption (frame title or empty). */
  readonly title: string;
}

/** Result of one PDF export. */
export interface PdfExportResult {
  /** The print document HTML (fully self-contained). */
  readonly html: string;
  /** Number of planned pages. */
  readonly pageCount: number;
}

/** A4 landscape page at 96 dpi (CSS px) — the print CSS page size. */
const PAGE_WIDTH_PX = 1123;

/** A4 landscape height at 96 dpi. */
const PAGE_HEIGHT_PX = 794;

/**
 * Plans the page REGIONS of an export: one per visible frame (frames
 * mode, document order — empty list when the board has no frames), or
 * the single whole-board region (fit-all).
 *
 * @param scene - the live scene.
 * @param layout - the page layout mode.
 * @param viewportWorldFrame - optional live viewport frame (world units) —
 * the فاز ۳۱ fallback so a pins-only board still prints one framed page.
 * @returns the world-space region + caption per page.
 */
export function planPdfPages(
  scene: Scene,
  layout: PdfLayout,
  viewportWorldFrame?: BBox | null,
): Array<{ region: ExportRegion; title: string }> {
  if (layout === "fit-all") {
    const bounds = computeExportBounds(
      scene,
      { mode: "scene" },
      viewportWorldFrame,
    );
    if (bounds === null) {
      return [];
    }
    return [{ region: { mode: "bbox", box: bounds }, title: "" }];
  }
  const frames = scene.objects.filter(
    (object) => isFrameObject(object) && object.visible,
  ) as FrameObjectData[];
  return frames.map((frame) => ({
    region: { mode: "bbox", box: objectBBox(frame) } as ExportRegion,
    title: frame.title,
  }));
}

/**
 * Assembles the print document HTML for the rasterised pages.
 *
 * @param pages - the pages (images ready).
 * @param dir - the document direction ("rtl"/"ltr").
 * @returns the self-contained HTML string.
 */
export function buildPrintDocumentHtml(
  pages: readonly PdfPage[],
  dir: "rtl" | "ltr",
): string {
  const body = pages
    .map((page) => {
      const title =
        page.title === ""
          ? ""
          : `<h1 class="frame-title">${escapeHtml(page.title)}</h1>`;
      return (
        `<section class="slide">` +
        title +
        `<img src="${page.image}" alt=""/>` +
        `</section>`
      );
    })
    .join("");
  return (
    `<!DOCTYPE html><html lang="fa" dir="${dir}"><head><meta charset="utf-8">` +
    `<title>Infinite Canvas Studio — PDF</title>` +
    `<style>` +
    `@page { size: ${PAGE_WIDTH_PX}px ${PAGE_HEIGHT_PX}px; margin: 0; }` +
    `html, body { margin: 0; padding: 0; background: #fff; }` +
    `body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }` +
    `.slide { width: ${PAGE_WIDTH_PX}px; height: ${PAGE_HEIGHT_PX}px; ` +
    `page-break-after: always; break-after: page; ` +
    `display: flex; flex-direction: column; align-items: center; ` +
    `justify-content: center; box-sizing: border-box; padding: 24px; }` +
    `.slide:last-child { page-break-after: auto; break-after: auto; }` +
    `.frame-title { font-family: Vazirmatn, sans-serif; font-size: 18px; ` +
    `font-weight: 700; margin: 0 0 12px; color: #1a1a1a; ` +
    `align-self: flex-start; }` +
    `.slide img { max-width: 100%; max-height: calc(100% - 40px); ` +
    `object-fit: contain; }` +
    `</style></head><body>${body}</body></html>`
  );
}

/**
 * Escapes HTML text content.
 *
 * @param value - the raw text.
 * @returns the escaped text.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Rasterises every planned page (the PNG pipeline with a bbox region).
 *
 * @param scene - the live scene.
 * @param options - the export options.
 * @returns the rasterised pages (may be empty when nothing is visible).
 */
export async function rasterisePages(
  scene: Scene,
  options: PdfExportOptions,
): Promise<PdfPage[]> {
  const { exportToPng } = await import("@/persistence/exporters/PngExporter");
  const planned = planPdfPages(
    scene,
    options.layout,
    options.viewportWorldFrame,
  );
  const pages: PdfPage[] = [];
  for (const page of planned) {
    const blob = await exportToPng(scene, {
      region: page.region,
      scale: options.scale,
      transparent: false,
      palette: options.palette,
      themeInk: options.themeInk,
      themeBorder: options.themeBorder,
      themeMuted: options.themeMuted,
      renderRichHtml: options.renderRichHtml,
      padding: options.padding,
      // فاز ۲۸: pinned objects overlay EVERY page at the same anchor —
      // true to "pinned to the screen" semantics (documented).
      includePinned: options.includePinned,
      pinnedViewport: options.pinnedViewport,
      viewportWorldFrame: options.viewportWorldFrame,
    });
    const dataUrl = await blobToDataUrl(blob);
    pages.push({
      image: dataUrl,
      aspect: 1,
      title: page.title,
    });
  }
  return pages;
}

/**
 * Converts a blob to a data URL.
 *
 * @param blob - the PNG blob.
 * @returns the data URL.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("blob read failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Exports the board as a print document and OPENS it in a hidden iframe,
 * triggering the print dialog (the user picks «Save as PDF» — the dialog
 * explains this, AC8.8's documented flow).
 *
 * @param scene - the live scene.
 * @param options - the export options.
 * @param dir - the document direction.
 * @returns the page count (0 when nothing is visible — the caller
 *          surfaces the same no-content error as the other exporters).
 */
export async function exportToPdf(
  scene: Scene,
  options: PdfExportOptions,
  dir: "rtl" | "ltr" = "rtl",
): Promise<PdfExportResult> {
  const pages = await rasterisePages(scene, options);
  if (pages.length === 0) {
    throw new PngExportError("no-content", "nothing visible to print");
  }
  const html = buildPrintDocumentHtml(pages, dir);
  openPrintWindow(html);
  return { html, pageCount: pages.length };
}

/**
 * Opens the print pipeline in a hidden iframe (removed after the dialog
 * closes — best-effort cleanup via the iframe's load/afterprint events).
 *
 * @param html - the print document.
 */
function openPrintWindow(html: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.inset = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  document.body.appendChild(iframe);
  const remove = (): void => {
    window.setTimeout(() => iframe.remove(), 60_000);
  };
  iframe.addEventListener("load", () => {
    const contentWindow = iframe.contentWindow;
    if (contentWindow === null) {
      remove();
      return;
    }
    contentWindow.addEventListener("afterprint", remove);
    contentWindow.focus();
    contentWindow.print();
  });
  iframe.srcdoc = html;
}
