/**
 * PdfObject core tests (فاز P1 — RP1.2): the pure data contract —
 * creation defaults, page clamping, the placed-size rule (A.2.10), the
 * asset-hash manifest (A.2.1) and the latin page badge (A.2.8).
 */
import { describe, expect, it } from "vitest";
import {
  PDF_FALLBACK_INTRINSIC,
  clampPdfPage,
  collectPdfAssetHashes,
  createPdfObject,
  isPdfObject,
  pdfPageBadgeLatin,
  placedPdfSize,
} from "@/core/model/PdfObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { SceneObjectData } from "@/core/model/SceneObject";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function makeObject(
  overrides: Partial<Parameters<typeof createPdfObject>[1]> = {},
): ReturnType<typeof createPdfObject> {
  return createPdfObject(
    "obj-1",
    {
      assetHash: HASH_A,
      thumbHash: HASH_B,
      originalName: "doc.pdf",
      pageCount: 10,
      currentPage: 2,
      naturalWidth: 595,
      naturalHeight: 842,
      ...overrides,
    },
    vec2(10, 20),
  );
}

describe("PdfObject (فاز P1)", () => {
  it("builds with the metadata contract (A.2.6)", () => {
    const object = makeObject();
    expect(object.kind).toBe("pdf");
    expect(object.assetHash).toBe(HASH_A);
    expect(object.thumbHash).toBe(HASH_B);
    expect(object.originalName).toBe("doc.pdf");
    expect(object.pageCount).toBe(10);
    expect(object.currentPage).toBe(2);
    expect(object.position).toEqual(vec2(10, 20));
    expect(object.rotation).toBe(0);
    expect(object.visible).toBe(true);
    expect(object.locked).toBe(false);
  });

  it("defaults the placed size to the page's intrinsic footprint", () => {
    const object = makeObject();
    expect(object.width).toBe(595);
    expect(object.height).toBe(842);
  });

  it("falls back to the A-series intrinsic when metadata is missing", () => {
    const object = makeObject({
      naturalWidth: 0,
      naturalHeight: 0,
    });
    expect(object.width).toBe(PDF_FALLBACK_INTRINSIC.width);
    expect(object.height).toBe(PDF_FALLBACK_INTRINSIC.height);
  });

  it("clamps the current page into [1, pageCount]", () => {
    expect(clampPdfPage(0, 10)).toBe(1);
    expect(clampPdfPage(1, 10)).toBe(1);
    expect(clampPdfPage(5, 10)).toBe(5);
    expect(clampPdfPage(11, 10)).toBe(10);
    expect(clampPdfPage(Number.NaN, 10)).toBe(1);
    expect(clampPdfPage(3, 0)).toBe(1);
  });

  it("clamps currentPage at construction (defensive)", () => {
    const object = makeObject({ currentPage: 99, pageCount: 3 });
    expect(object.currentPage).toBe(3);
  });

  it("places through the SHARED image rule (A.2.10)", () => {
    const placed = placedPdfSize({ width: 595, height: 842 }, 300);
    // The longest edge clamps to 300, aspect kept.
    expect(placed.height).toBe(300);
    expect(placed.width).toBeCloseTo((595 / 842) * 300, 5);
  });

  it("collects the distinct hash manifest (A.2.1)", () => {
    const a = makeObject();
    const b = makeObject({ thumbHash: null });
    const notPdf = { kind: "textBox" } as unknown as SceneObjectData;
    const hashes = collectPdfAssetHashes([a, b, notPdf, a]);
    expect(hashes).toEqual([HASH_A, HASH_B]);
  });

  it("formats the latin page badge (A.2.8 — shaping happens later)", () => {
    expect(pdfPageBadgeLatin(2, 10)).toBe("2 / 10");
    expect(pdfPageBadgeLatin(1, 1)).toBe("1 / 1");
    expect(pdfPageBadgeLatin(99, 3)).toBe("3 / 3");
  });

  it("guards the type predicate", () => {
    expect(isPdfObject(makeObject())).toBe(true);
    expect(isPdfObject({ kind: "audio" } as unknown as SceneObjectData)).toBe(
      false,
    );
  });
});
