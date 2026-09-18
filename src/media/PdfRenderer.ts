/**
 * PdfRenderer (فاز P1 — RP1.4): the pdf.js wrapper service keeping the
 * library OFF the canvas and OUT of core.
 *
 * Binding contract (A.2.4/A.2.5):
 * - pdfjs-dist is BUNDLED in app resources (`public/pdfjs/` — the
 *   worker, the cmaps and the standard fonts, the EXACT
 *   `public/ffmpeg/` precedent of Phase M2) and the main library is
 *   LAZY-LOADED on the first poster render or viewer open — never
 *   fetched from a CDN, never loaded at boot;
 * - the WORKER runs from the same-origin asset URL (`/pdfjs/pdf.worker.min.mjs`)
 *   which the Tauri asset protocol serves verbatim (A.2.5);
 * - at import the `%PDF-` SIGNATURE is verified (first KiB) — an
 *   invalid file NEVER becomes an object (Appendix P-1's matrix);
 * - poster generation renders ONE page to a HIDDEN offscreen canvas
 *   (max 1000px wide, JPEG q0.8) — the canvas + the pdf.js document are
 *   ALWAYS released after use (RP1.4);
 * - loaded documents stay in a small LRU (`PdfPageCache`-adjacent) so
 *   wheel page-flips on the canvas are cheap; eviction DESTROYS the
 *   worker-side document (ACP2.4's no-leak discipline).
 *
 * The service is injected through AppContext (`Services.pdfRenderer`)
 * — core stays pdf.js-free (A.4).
 */
import { PDF_MIME_TYPE } from "@/media/pdfFormats";

/** The pages pdf.js renders per poster request. */
export interface PdfPosterResult {
  /** The page's poster JPEG (the funnel writes it to the AssetStore). */
  readonly blob: Blob;
  /** The document's total page count (≥ 1). */
  readonly pageCount: number;
  /** The rendered page's width at scale 1 (PDF units). */
  readonly width: number;
  /** The rendered page's height at scale 1 (PDF units). */
  readonly height: number;
  /** Which 1-based page was rendered. */
  readonly page: number;
}

/** The minimal pdf.js surface this service consumes (test-mockable). */
export interface PdfJsLib {
  getDocument: (options: Record<string, unknown>) => { promise: Promise<PdfDocument> };
  GlobalWorkerOptions: { workerSrc: string };
}

/** The minimal pdf.js document surface this service consumes. */
export interface PdfDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
}

/** The minimal pdf.js page surface this service consumes. */
export interface PdfPage {
  getViewport: (options: { scale: number }) => {
    width: number;
    height: number;
    scale: number;
  };
  render: (options: Record<string, unknown>) => { promise: Promise<void> };
  getTextContent: () => Promise<unknown>;
  cleanup?: () => void;
}

/** How many documents stay hot for canvas page-flips (LRU evicts above). */
const DOC_LRU_CAPACITY = 2;

/** The offscreen poster's maximum width in pixels (A.2.2). */
const POSTER_MAX_WIDTH = 1000;

/** The poster JPEG quality (A.2.2). */
const POSTER_JPEG_QUALITY = 0.8;

/** How far into the file the signature probe reads. */
const SIGNATURE_PROBE_BYTES = 1024;

/** The lazy pdf.js loader seam (overridable in tests). */
export type PdfLibLoader = () => Promise<PdfJsLib | null>;

/** The bundled assets' base URL (same-origin, offline — A.2.5). */
const PDFJS_ASSET_BASE = "/pdfjs";

/** The default lazy loader: dynamic import of the bundled library. */
const defaultLoader: PdfLibLoader = async () => {
  try {
    const lib = (await import("pdfjs-dist")) as unknown as PdfJsLib;
    lib.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSET_BASE}/pdf.worker.min.mjs`;
    return lib;
  } catch {
    return null;
  }
};

/** The pdf.js wrapper service (a lazily-loaded singleton per AppContext). */
export class PdfRenderer {
  private libPromise: Promise<PdfJsLib | null> | null = null;
  private readonly loader: PdfLibLoader;
  private readonly docs = new Map<string, PdfDocument>();
  private readonly docOrder: string[] = [];

  /**
   * @param loader - the lazy library loader (the dynamic import by
   *        default; tests inject a mock).
   */
  public constructor(loader: PdfLibLoader = defaultLoader) {
    this.loader = loader;
  }

  /**
   * Ensures the library is loaded (the FIRST call pays the lazy import;
   * later calls share the same promise — one worker, never two).
   *
   * @returns the pdf.js surface, or null when the load failed.
   */
  public ensureLib(): Promise<PdfJsLib | null> {
    if (this.libPromise === null) {
      this.libPromise = this.loader();
    }
    return this.libPromise;
  }

  /**
   * Verifies a payload carries the `%PDF-` signature (A.2.4) — the
   * probe reads only the first KiB, never the whole file.
   *
   * @param bytes - the file payload.
   * @returns whether the payload looks like a PDF.
   */
  public static async verifySignature(bytes: Blob): Promise<boolean> {
    const head = await bytes.slice(0, SIGNATURE_PROBE_BYTES).arrayBuffer();
    const view = new Uint8Array(head);
    // The signature must appear within the first KiB (the spec allows
    // a comment header before it).
    const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
    outer: for (let start = 0; start + magic.length <= view.length; start += 1) {
      for (let i = 0; i < magic.length; i += 1) {
        if (view[start + i] !== magic[i]) {
          continue outer;
        }
      }
      return true;
    }
    return false;
  }

  /**
   * Opens (or reuses) the pdf.js document of one asset — the canvas
   * wheel path's hot handle. The LRU keeps at most
   * {@link DOC_LRU_CAPACITY} documents alive; evicted documents are
   * DESTROYED (their worker-side resources release, ACP2.4).
   *
   * @param assetHash - the AssetStore hash (the cache key).
   * @param bytes - the file payload (read ONCE per miss).
   * @returns the live document handle, or null on failure.
   */
  public async openDocument(
    assetHash: string,
    bytes: Blob,
  ): Promise<PdfDocument | null> {
    const cached = this.docs.get(assetHash);
    if (cached !== undefined) {
      // LRU touch.
      this.docOrder.splice(this.docOrder.indexOf(assetHash), 1);
      this.docOrder.push(assetHash);
      return cached;
    }
    const lib = await this.ensureLib();
    if (lib === null) {
      return null;
    }
    const data = new Uint8Array(await bytes.arrayBuffer());
    const task = lib.getDocument({
      data,
      cMapUrl: `${PDFJS_ASSET_BASE}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_ASSET_BASE}/standard_fonts/`,
    });
    let doc: PdfDocument;
    try {
      doc = await task.promise;
    } catch {
      return null;
    }
    this.docs.set(assetHash, doc);
    this.docOrder.push(assetHash);
    while (this.docOrder.length > DOC_LRU_CAPACITY) {
      const evicted = this.docOrder.shift();
      if (evicted === undefined) {
        break;
      }
      const evictedDoc = this.docs.get(evicted);
      this.docs.delete(evicted);
      try {
        await evictedDoc?.destroy();
      } catch {
        // A destroyed/failed document is already gone — ignore.
      }
    }
    return doc;
  }

  /**
   * Releases one document (the viewer's close path, RP2.4).
   *
   * @param assetHash - the AssetStore hash.
   */
  public async releaseDocument(assetHash: string): Promise<void> {
    const doc = this.docs.get(assetHash);
    this.docs.delete(assetHash);
    const index = this.docOrder.indexOf(assetHash);
    if (index >= 0) {
      this.docOrder.splice(index, 1);
    }
    try {
      await doc?.destroy();
    } catch {
      // Already destroyed — ignore.
    }
  }

  /**
   * Renders ONE page's poster to a hidden offscreen canvas (RP1.4):
   * max {@link POSTER_MAX_WIDTH}px wide, JPEG q
   * {@link POSTER_JPEG_QUALITY}. The canvas is ALWAYS released (its
   * backing store is dropped) before the call returns.
   *
   * @param assetHash - the AssetStore hash (the document cache key).
   * @param bytes - the file payload.
   * @param page - the 1-based page to render (clamped to the count).
   * @returns the poster + metadata, or null when the render failed
   *          (the funnel keeps a VALID object with the fallback plate).
   */
  public async renderPoster(
    assetHash: string,
    bytes: Blob,
    page: number,
  ): Promise<PdfPosterResult | null> {
    const doc = await this.openDocument(assetHash, bytes);
    if (doc === null || doc.numPages < 1) {
      return null;
    }
    const clamped = Math.min(doc.numPages, Math.max(1, Math.floor(page)));
    let pdfPage: PdfPage;
    try {
      pdfPage = await doc.getPage(clamped);
    } catch {
      return null;
    }
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = Math.min(POSTER_MAX_WIDTH / Math.max(1, base.width), 2);
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) {
      return null;
    }
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    let blob: Blob | null = null;
    try {
      await pdfPage.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise;
      blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(
          (result) => resolve(result),
          "image/jpeg",
          POSTER_JPEG_QUALITY,
        );
      });
    } catch {
      blob = null;
    } finally {
      // RP1.4: the hidden canvas ALWAYS releases its backing store.
      canvas.width = 0;
      canvas.height = 0;
      pdfPage.cleanup?.();
    }
    if (blob === null) {
      return null;
    }
    return {
      blob: blob.type === "image/jpeg" ? blob : new Blob([blob], { type: "image/jpeg" }),
      pageCount: doc.numPages,
      width: base.width,
      height: base.height,
      page: clamped,
    };
  }
}

/** The MIME type PDF assets carry in the AssetStore. */
export const PDF_ASSET_MIME = PDF_MIME_TYPE;
