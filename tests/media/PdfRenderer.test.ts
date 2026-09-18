// @vitest-environment jsdom

/**
 * PdfRenderer tests (فاز P1 — RP1.4, ACP1.7): the pdf.js wrapper with a
 * MOCKED library — the signature verification (A.2.4), the poster
 * render path (max 1000px, JPEG q0.8), the document LRU + eviction
 * destroy, and the canvas release discipline.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PdfRenderer, type PdfJsLib, type PdfDocument } from "@/media/PdfRenderer";

/** Builds a mock pdf.js surface with spyable calls. */
function makeMockLib(): {
  lib: PdfJsLib;
  destroyed: string[];
  openedData: unknown[];
} {
  const destroyed: string[] = [];
  const openedData: unknown[] = [];
  const lib: PdfJsLib = {
    getDocument: (_options: Record<string, unknown>) => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: (_pageNumber: number) =>
          Promise.resolve({
            getViewport: ({ scale }: { scale: number }) => ({
              width: 595 * scale,
              height: 842 * scale,
              scale,
            }),
            render: () => ({ promise: Promise.resolve() }),
            getTextContent: () => Promise.resolve({ items: [] }),
            cleanup: vi.fn(),
          }),
        destroy: () => {
          destroyed.push("doc");
          return Promise.resolve();
        },
      } satisfies PdfDocument),
    }),
    GlobalWorkerOptions: { workerSrc: "" },
  };
  return { lib, destroyed, openedData };
}

/** Installs jsdom canvas 2D + toBlob stubs for the offscreen render. */
function stubCanvasApi(): void {
  const originalCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
    const element = originalCreate(tagName);
    if (tagName === "canvas") {
      const canvas = element as HTMLCanvasElement;
      vi.spyOn(canvas, "getContext").mockReturnValue({
        fillRect: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(canvas, "toBlob").mockImplementation(
        (callback: BlobCallback) => {
          callback(new Blob(["jpeg"], { type: "image/jpeg" }));
        },
      );
    }
    return element;
  });
}

describe("PdfRenderer (فاز P1)", () => {
  beforeEach(() => {
    stubCanvasApi();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies the %PDF- signature (A.2.4)", async () => {
    const valid = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3])]);
    expect(await PdfRenderer.verifySignature(valid)).toBe(true);
    const leading = new Blob([
      new Uint8Array([0x20, 0x20, 0x25, 0x50, 0x44, 0x46, 0x2d]),
    ]);
    expect(await PdfRenderer.verifySignature(leading)).toBe(true);
    const plainText = new Blob([new TextEncoder().encode("this is not a pdf")]);
    expect(await PdfRenderer.verifySignature(plainText)).toBe(false);
    const empty = new Blob([]);
    expect(await PdfRenderer.verifySignature(empty)).toBe(false);
  });

  it("renders one page poster (max 1000px wide, JPEG) + metadata", async () => {
    const { lib } = makeMockLib();
    const renderer = new PdfRenderer(async () => lib);
    const bytes = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])]);
    const poster = await renderer.renderPoster("hash-1", bytes, 2);
    expect(poster).not.toBeNull();
    expect(poster?.page).toBe(2);
    expect(poster?.pageCount).toBe(3);
    expect(poster?.width).toBe(595);
    expect(poster?.height).toBe(842);
    expect(poster?.blob.type).toBe("image/jpeg");
  });

  it("reuses the OPENED document for repeated renders (the LRU)", async () => {
    const { lib } = makeMockLib();
    const getDocument = vi.spyOn(lib, "getDocument");
    const renderer = new PdfRenderer(async () => lib);
    const bytes = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])]);
    await renderer.renderPoster("hash-1", bytes, 1);
    await renderer.renderPoster("hash-1", bytes, 2);
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  it("clamps the requested page into the document's count", async () => {
    const { lib } = makeMockLib();
    const renderer = new PdfRenderer(async () => lib);
    const bytes = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])]);
    const poster = await renderer.renderPoster("hash-1", bytes, 99);
    expect(poster?.page).toBe(3);
  });

  it("destroys evicted documents (the LRU cap = 2)", async () => {
    const { lib, destroyed } = makeMockLib();
    const renderer = new PdfRenderer(async () => lib);
    const bytes = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])]);
    await renderer.openDocument("a", bytes);
    await renderer.openDocument("b", bytes);
    await renderer.openDocument("c", bytes);
    expect(destroyed.length).toBe(1);
    await renderer.releaseDocument("b");
    await renderer.releaseDocument("c");
    expect(destroyed.length).toBe(3);
  });

  it("returns null when the library fails to load (offline safety)", async () => {
    const renderer = new PdfRenderer(async () => null);
    const bytes = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])]);
    expect(await renderer.renderPoster("hash-1", bytes, 1)).toBeNull();
  });
});
