/**
 * Unit tests for the FormatProbe (فاز M2 — RM2.3): the pure import-gate
 * routing with INJECTED playability probes.
 */
import { describe, expect, it } from "vitest";
import { routeVideoFile } from "@/media/FormatProbe";

/** A probe answering one verdict for everything. */
const probe = (verdict: "" | "maybe" | "probably") => () => verdict;

describe("routeVideoFile (فاز M2 — RM2.3 / A.2.4)", () => {
  it("routes playable accepted extensions straight in", () => {
    expect(routeVideoFile({ name: "clip.mp4", type: "video/mp4" }, probe("maybe"))).toEqual({
      kind: "accepted",
      mimeType: "video/mp4",
    });
    expect(routeVideoFile({ name: "tape.webm" }, probe("probably"))).toEqual({
      kind: "accepted",
      mimeType: "video/webm",
    });
    // "maybe" is NOT a failure — plain video/mp4 answers "maybe" in
    // every engine and plays fine.
    expect(routeVideoFile({ name: "a.m4v" }, probe("maybe")).kind).toBe("accepted");
  });

  it("routes probe failures on accepted extensions to conversion", () => {
    expect(routeVideoFile({ name: "clip.mov", type: "video/quicktime" }, probe(""))).toEqual({
      kind: "convert",
      mimeType: "video/quicktime",
    });
    expect(routeVideoFile({ name: "odd.mp4" }, probe(""))).toEqual({
      kind: "convert",
      mimeType: "video/mp4",
    });
  });

  it("routes foreign video containers to conversion (AVI/MKV/WMV/FLV)", () => {
    expect(
      routeVideoFile({ name: "old.avi", type: "video/x-msvideo" }, probe("")),
    ).toEqual({ kind: "convert", mimeType: "video/x-msvideo" });
    expect(
      routeVideoFile({ name: "film.mkv", type: "video/x-matroska" }, probe("probably")),
    ).toEqual({ kind: "convert", mimeType: "video/x-matroska" });
    // The probe is not even consulted for foreign containers — the
    // browser never plays .avi regardless of the verdict.
    expect(
      routeVideoFile({ name: "x.flv", type: "video/x-flv" }, probe("probably")).kind,
    ).toBe("convert");
  });

  it("rejects truly unknown files (the Persian toast — never an object)", () => {
    expect(routeVideoFile({ name: "blob.xyz" }, probe("probably")).kind).toBe("unknown");
    expect(routeVideoFile({ name: "note.txt", type: "text/plain" }, probe("")).kind).toBe(
      "unknown",
    );
    expect(routeVideoFile({ name: "photo.png", type: "image/png" }, probe("")).kind).toBe(
      "unknown",
    );
  });
});
