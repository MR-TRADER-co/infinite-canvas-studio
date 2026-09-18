// @vitest-environment jsdom

/**
 * pdfViewerSettings tests (فاز P2 — RP2.1): the APP-data slot for the
 * floating viewer's position/size/internal-zoom — defaults, the
 * defensive reader (clamps), and the round-trip.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  PDF_VIEWER_DEFAULTS,
  PDF_VIEWER_MIN_HEIGHT,
  PDF_VIEWER_MIN_WIDTH,
  PDF_VIEWER_MIN_ZOOM,
  PDF_VIEWER_MAX_ZOOM,
  readPdfViewerSettings,
  writePdfViewerSettings,
} from "@/ui/player/pdfViewerSettings";

const SLOT = "infinite-canvas-studio/pdf-viewer/v1";

describe("pdfViewerSettings (فاز P2)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns the defaults for an absent slot", () => {
    expect(readPdfViewerSettings()).toEqual(PDF_VIEWER_DEFAULTS);
  });

  it("round-trips the state (ACP2.7)", () => {
    const settings = {
      x: 120,
      y: 80,
      width: 900,
      height: 700,
      zoom: 1.5,
    };
    writePdfViewerSettings(settings);
    expect(readPdfViewerSettings()).toEqual(settings);
  });

  it("clamps corrupt/absent fields defensively", () => {
    window.localStorage.setItem(
      SLOT,
      JSON.stringify({
        x: 99999,
        width: 10,
        height: "tall",
        zoom: 42,
      }),
    );
    const settings = readPdfViewerSettings();
    expect(settings.x).toBe(8192);
    expect(settings.width).toBe(PDF_VIEWER_MIN_WIDTH);
    expect(settings.height).toBe(PDF_VIEWER_DEFAULTS.height);
    expect(settings.zoom).toBe(PDF_VIEWER_MAX_ZOOM);
  });

  it("never goes below the minimums (A.2.3)", () => {
    window.localStorage.setItem(
      SLOT,
      JSON.stringify({ width: 1, height: 1, zoom: 0 }),
    );
    const settings = readPdfViewerSettings();
    expect(settings.width).toBe(PDF_VIEWER_MIN_WIDTH);
    expect(settings.height).toBe(PDF_VIEWER_MIN_HEIGHT);
    expect(settings.zoom).toBe(PDF_VIEWER_MIN_ZOOM);
  });

  it("survives a corrupt JSON slot silently", () => {
    window.localStorage.setItem(SLOT, "{not json");
    expect(readPdfViewerSettings()).toEqual(PDF_VIEWER_DEFAULTS);
  });
});
