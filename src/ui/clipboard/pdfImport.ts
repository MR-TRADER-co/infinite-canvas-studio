"use client";

/**
 * The PDF import pipeline (فاز P1 — RP1.3): the single funnel every
 * gesture — the «درج PDF…» file dialog, Explorer drag-and-drop and
 * clipboard paste — flows through, mirroring `audioImport.ts`'s
 * machinery gesture-for-gesture:
 *
 * 1. the `%PDF-` SIGNATURE is verified (A.2.4 — an invalid file toasts
 *    in Persian and never becomes an object, Appendix P-1's matrix);
 * 2. the ORIGINAL file is written into the sidecar AssetStore under its
 *    SHA-256 hash (identical imports dedupe — ACP1.4);
 * 3. the PdfRenderer renders page 1's poster JPEG (max 1000px, q0.8)
 *    offscreen and captures the pageCount + page dimensions (a failed
 *    render keeps a VALID object with the document-glyph fallback
 *    plate, A.2.2 — the store still holds the bytes);
 * 4. the poster is written into the store and remembered in the
 *    {@link pdfPageCache} (flip-back never re-renders, A.2.2);
 * 5. the object commits through the SHARED placement core
 *    ({@link pastePlacementPosition} — the exact image/video/audio
 *    rules of A.2.10: viewport centre or drop point, burst cascade,
 *    grid snap), one `AddObjectCommand`, auto-select, Persian notice.
 */
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import type { ImportServices } from "@/ui/clipboard/canvasImport";
import {
  PASTE_VIEWPORT_SPAN,
  pastePlacementPosition,
} from "@/ui/clipboard/canvasImport";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import {
  createPdfObject,
  placedPdfSize,
} from "@/core/model/PdfObject";
import type { AssetStore } from "@/persistence/AssetStore";
import { PdfRenderer } from "@/media/PdfRenderer";
import { pdfPageCache } from "@/media/PdfPageCache";
import {
  classifyPdfFiles,
} from "@/media/pdfFormats";

/** The scene + asset services a PDF import commit needs (DI style). */
export interface PdfImportServices extends ImportServices {
  /** The sidecar AssetStore owning the PDF bytes. */
  readonly assets: AssetStore;
  /** The pdf.js wrapper service (posters + page counts). */
  readonly pdf: PdfRenderer;
}

/** One prepared (verified + stored + posterised) PDF import. */
export interface PreparedPdfImport {
  readonly assetHash: string;
  readonly thumbHash: string | null;
  readonly originalName: string;
  readonly pageCount: number;
  readonly currentPage: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

/** The prepared-import verdict (the funnel's three-way outcome). */
export type PreparePdfResult =
  | { readonly kind: "ok"; readonly prepared: PreparedPdfImport }
  /** The file PARSED but its page render failed (the fallback plate). */
  | { readonly kind: "posterless"; readonly prepared: PreparedPdfImport }
  /** The file did NOT parse (truncated/corrupt) — NEVER an object. */
  | { readonly kind: "corrupt" }
  /** The store write failed. */
  | { readonly kind: "failed" };

export { classifyPdfFiles };

/**
 * The ONE import funnel (RP1.3): verifies the signature, stores the
 * original, renders the page-1 poster and commits through the shared
 * placement core.
 *
 * @param services - the scene + asset services.
 * @param files - the PDF CANDIDATES (the classifier's accepted set).
 * @param surfaceRect - the viewport rect for placement.
 * @param at - optional world centre (the drop point).
 * @returns how many objects were committed.
 */
export async function importPdfFiles(
  services: PdfImportServices,
  files: readonly File[],
  surfaceRect: { readonly width: number; readonly height: number } | null,
  at?: Vec2,
): Promise<number> {
  let inserted = 0;
  for (const file of files) {
    // A.2.4: the signature gate — an invalid file NEVER becomes an
    // object (a Persian toast explains why, Appendix P-1's matrix).
    if (!(await PdfRenderer.verifySignature(file))) {
      services.bus.emit("ui:notice", {
        messageKey: "pdf.invalidNotice",
        severity: "error",
      });
      continue;
    }
    const prepared = await preparePdfAsset(services, file);
    if (prepared.kind === "failed") {
      services.bus.emit("ui:notice", {
        messageKey: "pdf.importFailedNotice",
        severity: "error",
      });
      continue;
    }
    if (prepared.kind === "corrupt") {
      // A truncated/corrupt file NEVER becomes an object (Appendix P-1's
      // matrix — the signature passed but the parse did not).
      services.bus.emit("ui:notice", {
        messageKey: "pdf.corruptNotice",
        severity: "error",
      });
      continue;
    }
    if (commitPdfObject(services, prepared.prepared, surfaceRect, at)) {
      inserted += 1;
      if (prepared.kind === "posterless") {
        // A parsed-but-unrenderable PDF still lands (A.2.2's Attempt-2
        // twin) — but the artist sees WHY the plate is a glyph.
        services.bus.emit("ui:notice", {
          messageKey: "pdf.renderFailedNotice",
          severity: "error",
        });
      }
    }
  }
  return inserted;
}

/**
 * Verifies + stores one PDF file and renders its page-1 poster
 * (steps 1–4 of the pipeline). The three failure modes are DISTINCT:
 * a failed STORE aborts the file; a failed PARSE (truncated/corrupt
 * bytes) refuses the object entirely (Appendix P-1); a failed RENDER
 * keeps a valid import with the fallback plate (A.2.2).
 *
 * @param services - the scene + asset services.
 * @param file - the signature-verified PDF file.
 * @returns the verdict (see {@link PreparePdfResult}).
 */
export async function preparePdfAsset(
  services: PdfImportServices,
  file: File,
): Promise<PreparePdfResult> {
  const assetHash = await services.assets.writeAsset(file);
  if (assetHash === null) {
    return { kind: "failed" };
  }
  // The parse gate (Appendix P-1's corrupt row): a file whose bytes
  // pdf.js cannot even OPEN is truncated/corrupt — no object, toast.
  const doc = await services.pdf.openDocument(assetHash, file);
  if (doc === null) {
    return { kind: "corrupt" };
  }
  const poster = await services.pdf.renderPoster(assetHash, file, 1);
  const thumbHash =
    poster !== null ? await services.assets.writeAsset(poster.blob) : null;
  if (poster !== null && thumbHash !== null) {
    pdfPageCache.remember(assetHash, poster.page, thumbHash);
  }
  return {
    kind: poster === null ? "posterless" : "ok",
    prepared: {
      assetHash,
      thumbHash,
      originalName: file.name,
      pageCount: poster?.pageCount ?? doc.numPages,
      currentPage: poster?.page ?? 1,
      naturalWidth: poster?.width ?? 595,
      naturalHeight: poster?.height ?? 842,
    },
  };
}

/**
 * Commits one prepared PDF at the visible viewport centre — or an
 * exact world point (the drop point): the SHARED image/video/audio
 * placement rules (A.2.10), one `AddObjectCommand` (one undo step),
 * auto-select and the Persian notice.
 *
 * @param services - the scene + asset services committing the object.
 * @param prepared - the verified + stored + posterised import.
 * @param surfaceRect - the viewport rect (client size); falls back to
 *        800×600 when unavailable.
 * @param at - optional world centre overriding the viewport centre.
 * @returns whether the object was committed.
 */
export function commitPdfObject(
  services: PdfImportServices,
  prepared: PreparedPdfImport,
  surfaceRect: { readonly width: number; readonly height: number } | null,
  at?: Vec2,
): boolean {
  const { scene, history, selection, ids, bus } = services;
  const camera = scene.camera;
  const rect =
    surfaceRect !== null ? surfaceRect : { width: 800, height: 600 };
  const centerScreen = vec2(rect.width / 2, rect.height / 2);
  const centerWorld =
    at !== undefined ? at : camera.screenToWorld(centerScreen);
  const visibleSpan = Math.max(
    1,
    Math.min(rect.width / camera.zoom, rect.height / camera.zoom),
  );
  // The page's intrinsic footprint (the fallback plate shares the
  // A-series portrait ratio — the placed size never jitters when a
  // poster is absent).
  const intrinsic = {
    width: prepared.naturalWidth > 0 ? prepared.naturalWidth : 595,
    height: prepared.naturalHeight > 0 ? prepared.naturalHeight : 842,
  };
  const placed = placedPdfSize(intrinsic, visibleSpan * PASTE_VIEWPORT_SPAN);
  const position = pastePlacementPosition(centerWorld, placed);
  const object = createPdfObject(ids.next(), prepared, position, placed, scene.nextZIndex());
  const command = new AddObjectCommand(scene, object);
  command.do();
  history.push(command);
  selection.replaceAll([object.id]);
  bus.emit("ui:notice", {
    messageKey: "pdf.pastedNotice",
    severity: "info",
  });
  return true;
}
