/**
 * PDF file gates (فاز P1 — A.2.4's import half): the accepted extension
 * set and the PURE import classifier shared by every gesture (file
 * dialog, Explorer drag-and-drop, clipboard paste).
 *
 * Policy (Appendix P-1's binding matrix):
 * - `.pdf` (or an `application/pdf`-typed payload) — a candidate; the
 *   `%PDF-` SIGNATURE verification happens in the funnel
 *   (`PdfRenderer`) before any object is created;
 * - everything else — none of this module's business (the image/video/
 *   audio classifiers own their own; a PDF import must never hijack
 *   their drops, RP1.3).
 *
 * No playability probe, no conversion gate — every VALID PDF renders
 * natively through pdf.js (A.2.4), so the direct path is the only path.
 *
 * Pure module — no DOM imports.
 */

/** PDF extensions accepted at import (case-insensitive, with dot). */
export const ACCEPTED_PDF_EXTENSIONS: readonly string[] = [".pdf"];

/**
 * @param name - a file name (possibly with an extension).
 * @returns the lower-cased extension WITH the leading dot, or "".
 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return "";
  }
  return name.slice(dot).toLowerCase();
}

/**
 * The canonical MIME of every accepted PDF payload.
 */
export const PDF_MIME_TYPE = "application/pdf";

/**
 * Whether one payload is a PDF candidate: the `.pdf` extension OR an
 * `application/pdf` browser type (a renamed-but-typed file still gets
 * its chance — the signature check is the final arbiter).
 *
 * @param entry - the file name + optional browser MIME.
 * @returns whether the entry routes to the PDF funnel.
 */
export function isPdfCandidate(entry: {
  readonly name: string;
  readonly type?: string;
}): boolean {
  if (ACCEPTED_PDF_EXTENSIONS.includes(extensionOf(entry.name))) {
    return true;
  }
  return (
    entry.type !== undefined &&
    entry.type.toLowerCase() === PDF_MIME_TYPE
  );
}

/** The gesture classifier result. */
export interface PdfClassification {
  /** `.pdf`/typed candidates routed into the ONE funnel. */
  readonly accepted: readonly File[];
  /** Everything else — left for the other media classifiers. */
  readonly rejected: readonly File[];
}

/**
 * Splits a gesture's file payload into PDF candidates and the rest —
 * never touching image/video/audio files (RP1.3's no-hijack rule).
 *
 * @param files - the raw payload files.
 * @returns the classification.
 */
export function classifyPdfFiles(
  files: readonly {
    readonly name: string;
    readonly type?: string;
    readonly file?: unknown;
  }[],
): PdfClassification {
  const accepted: File[] = [];
  const rejected: File[] = [];
  for (const entry of files) {
    const file = entry as unknown as File | undefined;
    if (!(file instanceof File)) {
      continue;
    }
    if (isPdfCandidate(entry)) {
      accepted.push(file);
    } else {
      rejected.push(file);
    }
  }
  return { accepted, rejected };
}

/**
 * @param file - the accepted PDF file.
 * @returns the canonical MIME type (files can arrive with an empty
 *          `type`; the extension decides).
 */
export function mimeTypeForPdfFile(file: {
  readonly name: string;
  readonly type?: string;
}): string {
  if (file.type !== undefined && file.type.toLowerCase() === PDF_MIME_TYPE) {
    return PDF_MIME_TYPE;
  }
  return PDF_MIME_TYPE;
}

export { extensionOf };
