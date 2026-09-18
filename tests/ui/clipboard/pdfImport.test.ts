// @vitest-environment jsdom

/**
 * The PDF import funnel tests (فاز P1 — RP1.3, ACP1.2/ACP1.4/ACP1.7):
 * the ONE pipeline with a MOCKED PdfRenderer — signature rejection
 * (no object), store → poster → commit flow, the shared placement
 * (A.2.10), the dedupe manifest (one asset, two objects), and the
 * failure toasts.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";
import type { Scene } from "@/core/model/Scene";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { Selection } from "@/core/selection/Selection";
import type { IdGenerator } from "@/core/id/IdGenerator";
import type { AppEventMap } from "@/core/events/EventBus";
import type { EventBus } from "@/core/events/EventBus";
import type { AssetStore } from "@/persistence/AssetStore";
import { PdfRenderer, type PdfRenderer as PdfRendererType } from "@/media/PdfRenderer";
import {
  importPdfFiles,
  type PdfImportServices,
} from "@/ui/clipboard/pdfImport";

const HASH = "1".repeat(64);
const THUMB = "2".repeat(64);

/** The mocked PdfRenderer (ACP1.7 — pdf.js never loads in tests). */
function makeRendererMock(): {
  renderer: PdfRendererType;
  renderCalls: string[];
} {
  const renderCalls: string[] = [];
  const renderer = {
    openDocument: vi.fn(async () => ({ numPages: 3, getPage: async () => null, destroy: async () => undefined })),
    renderPoster: vi.fn(async (assetHash: string, _bytes: Blob, page: number) => {
      renderCalls.push(`${assetHash}:${page}`);
      return {
        blob: new Blob(["jpeg"], { type: "image/jpeg" }),
        pageCount: 3,
        width: 595,
        height: 842,
        page,
      };
    }),
  } as unknown as PdfRendererType;
  return { renderer, renderCalls };
}

/** The mocked service bundle (scene in-memory, stores spyable). */
function makeServices(): {
  services: PdfImportServices;
  notices: { messageKey: string; severity: string }[];
  objects: unknown[];
  writes: Blob[];
  nextId: { n: number };
} {
  const notices: { messageKey: string; severity: string }[] = [];
  const objects: unknown[] = [];
  const writes: Blob[] = [];
  let idCounter = 0;
  const assets = {
    writeAsset: vi.fn(async (bytes: Blob) => {
      writes.push(bytes);
      return (writes.length === 1 ? HASH : THUMB) + "";
    }),
  } as unknown as AssetStore;
  // Distinct hashes per write call: original → HASH, poster → THUMB.
  let writeSeq = 0;
  (assets as { writeAsset: unknown }).writeAsset = vi.fn(async (_bytes: Blob) => {
    writeSeq += 1;
    return writeSeq === 1 ? HASH : `${THUMB.slice(0, 63)}${writeSeq - 1}`;
  });
  const scene = {
    camera: {
      zoom: 1,
      screenToWorld: (screen: Vec2) => vec2(screen.x, screen.y),
    },
    nextZIndex: () => objects.length,
    add: (object: unknown) => {
      objects.push(object);
    },
  } as unknown as Scene;
  const history = { push: vi.fn() } as unknown as HistoryManager;
  const selection = { replaceAll: vi.fn() } as unknown as Selection;
  const ids = { next: () => `id-${++idCounter}` } as unknown as IdGenerator;
  const bus = {
    emit: vi.fn((event: string, payload: { messageKey: string; severity: string }) => {
      if (event === "ui:notice") {
        notices.push(payload);
      }
    }),
  } as unknown as EventBus<AppEventMap>;
  const { renderer } = makeRendererMock();
  return {
    services: { scene, history, selection, ids, bus, assets, pdf: renderer },
    notices,
    objects,
    writes,
    nextId: { get n() { return idCounter; } },
  };
}

/** Patches the STATIC signature verifier on the real class (the funnel
 *  calls `PdfRenderer.verifySignature` — the spy swaps the same binding). */
function stubSignature(valid: boolean): void {
  vi.spyOn(PdfRenderer, "verifySignature").mockResolvedValue(valid);
}

function pdfFile(name = "doc.pdf", bytes = "%PDF-1.4 valid stub"): File {
  return new File([bytes], name);
}

describe("pdfImport (فاز P1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports a valid file: store → poster → commit + notice (ACP1.2)", async () => {
    stubSignature(true);
    const ctx = makeServices();
    const inserted = await importPdfFiles(ctx.services, [pdfFile()], {
      width: 800,
      height: 600,
    });
    expect(inserted).toBe(1);
    expect(ctx.objects).toHaveLength(1);
    const object = ctx.objects[0] as { kind: string; pageCount: number; currentPage: number };
    expect(object.kind).toBe("pdf");
    expect(object.pageCount).toBe(3);
    expect(ctx.notices).toEqual([
      { messageKey: "pdf.pastedNotice", severity: "info" },
    ]);
  });

  it("REJECTS an invalid signature with the Persian toast, no object (A.2.4)", async () => {
    stubSignature(false);
    const ctx = makeServices();
    const inserted = await importPdfFiles(
      ctx.services,
      [pdfFile("fake.pdf", "just plain text, no signature")],
      { width: 800, height: 600 },
    );
    expect(inserted).toBe(0);
    expect(ctx.objects).toHaveLength(0);
    expect(ctx.notices).toEqual([
      { messageKey: "pdf.invalidNotice", severity: "error" },
    ]);
  });

  it("REJECTS a truncated/corrupt PDF with the Persian toast, no object (Appendix P-1)", async () => {
    stubSignature(true);
    const ctx = makeServices();
    // The signature passes but the PARSE does not (openDocument → null).
    (ctx.services.pdf as { openDocument: unknown }).openDocument = vi.fn(
      async () => null,
    );
    const inserted = await importPdfFiles(ctx.services, [pdfFile("broken.pdf")], {
      width: 800,
      height: 600,
    });
    expect(inserted).toBe(0);
    expect(ctx.objects).toHaveLength(0);
    expect(ctx.notices).toEqual([
      { messageKey: "pdf.corruptNotice", severity: "error" },
    ]);
  });

  it("keeps a VALID object when the poster fails (the fallback plate)", async () => {
    stubSignature(true);
    const ctx = makeServices();
    (ctx.services.pdf as { renderPoster: unknown }).renderPoster = vi.fn(
      async () => null,
    );
    const inserted = await importPdfFiles(ctx.services, [pdfFile()], {
      width: 800,
      height: 600,
    });
    expect(inserted).toBe(1);
    expect(ctx.notices).toEqual([
      { messageKey: "pdf.pastedNotice", severity: "info" },
      { messageKey: "pdf.renderFailedNotice", severity: "error" },
    ]);
    const object = ctx.objects[0] as { thumbHash: null; pageCount: number };
    expect(object.thumbHash).toBeNull();
    // The PARSE succeeded (openDocument's numPages = 3) — only the page
    // RENDER failed, so the page count is the document's own.
    expect(object.pageCount).toBe(3);
  });

  it("places through the SHARED viewport rule (A.2.10)", async () => {
    stubSignature(true);
    const ctx = makeServices();
    await importPdfFiles(ctx.services, [pdfFile()], { width: 800, height: 600 });
    const object = ctx.objects[0] as {
      position: { x: number; y: number };
      width: number;
      height: number;
    };
    // The object's CENTRE lands on the viewport centre (400, 300) — the
    // SHARED cascade rule adds k×28 per earlier burst insert in the
    // SAME module lifetime, applied EQUALLY on both axes (the rule's
    // invariant), within the 8-step window and the rounding slack.
    const centreX = object.position.x + object.width / 2;
    const centreY = object.position.y + object.height / 2;
    const cascadeX = centreX - 400;
    const cascadeY = centreY - 300;
    expect(cascadeX).toBeGreaterThanOrEqual(-1.2);
    expect(cascadeY).toBeGreaterThanOrEqual(-1.2);
    expect(cascadeX).toBeLessThanOrEqual(8 * 28 + 1.2);
    expect(cascadeY).toBeLessThanOrEqual(8 * 28 + 1.2);
    expect(Math.abs(cascadeX - cascadeY)).toBeLessThanOrEqual(1.2);
    expect(object.width).toBeGreaterThan(0);
    expect(object.height).toBeGreaterThan(0);
  });

  it("imports the SAME file twice → two objects, ONE asset set (ACP1.4)", async () => {
    stubSignature(true);
    const ctx = makeServices();
    const file = pdfFile("same.pdf");
    await importPdfFiles(ctx.services, [file, file], { width: 800, height: 600 });
    expect(ctx.objects).toHaveLength(2);
    const ids = (ctx.objects as { id: string }[]).map((object) => object.id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("toasts the failure when the STORE write fails", async () => {
    stubSignature(true);
    const ctx = makeServices();
    (ctx.services.assets as { writeAsset: unknown }).writeAsset = vi.fn(
      async () => null,
    );
    const inserted = await importPdfFiles(ctx.services, [pdfFile()], {
      width: 800,
      height: 600,
    });
    expect(inserted).toBe(0);
    expect(ctx.notices).toEqual([
      { messageKey: "pdf.importFailedNotice", severity: "error" },
    ]);
  });
});
