/**
 * pdfFormats tests (فاز P1 — RP1.3/A.2.4): the pure gesture
 * classifier — `.pdf` extensions, `application/pdf` types, and the
 * no-hijack rule (image/video/audio payloads are NEVER ours).
 */
import { describe, expect, it } from "vitest";
import {
  classifyPdfFiles,
  isPdfCandidate,
  mimeTypeForPdfFile,
} from "@/media/pdfFormats";

function fileOf(name: string, type?: string): File {
  return new File(["%PDF-1.4 stub"], name, type !== undefined ? { type } : {});
}

describe("pdfFormats (فاز P1)", () => {
  it("accepts the .pdf extension (case-insensitive)", () => {
    expect(isPdfCandidate({ name: "doc.pdf" })).toBe(true);
    expect(isPdfCandidate({ name: "DOC.PDF" })).toBe(true);
    expect(isPdfCandidate({ name: "Doc.Pdf" })).toBe(true);
  });

  it("accepts an application/pdf MIME without the extension", () => {
    expect(isPdfCandidate({ name: "download.bin", type: "application/pdf" })).toBe(true);
  });

  it("never hijacks other media (RP1.3's rule)", () => {
    expect(isPdfCandidate({ name: "clip.mp4", type: "video/mp4" })).toBe(false);
    expect(isPdfCandidate({ name: "song.mp3", type: "audio/mpeg" })).toBe(false);
    expect(isPdfCandidate({ name: "photo.png", type: "image/png" })).toBe(false);
    expect(isPdfCandidate({ name: "notes.docx" })).toBe(false);
    expect(isPdfCandidate({ name: "file.xyz" })).toBe(false);
    expect(isPdfCandidate({ name: "archive.zip", type: "application/zip" })).toBe(false);
  });

  it("classifies a gesture's payload (accepted vs rejected)", () => {
    const pdf = fileOf("a.pdf");
    const png = fileOf("b.png", "image/png");
    const typed = fileOf("c.bin", "application/pdf");
    const result = classifyPdfFiles([pdf, png, typed]);
    expect(result.accepted).toEqual([pdf, typed]);
    expect(result.rejected).toEqual([png]);
  });

  it("yields the canonical MIME for every candidate", () => {
    expect(mimeTypeForPdfFile({ name: "a.pdf" })).toBe("application/pdf");
    expect(mimeTypeForPdfFile({ name: "b.pdf", type: "" })).toBe(
      "application/pdf",
    );
    expect(
      mimeTypeForPdfFile({ name: "c.bin", type: "application/pdf" }),
    ).toBe("application/pdf");
  });
});
