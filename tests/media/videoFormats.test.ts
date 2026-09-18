/**
 * Unit tests for the video file gates (فاز M1 — RM1.3): the accepted
 * extension set, the extension→MIME resolution and the import
 * classifier (accepted / rejected / passthrough for other pipelines).
 */
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_VIDEO_EXTENSIONS,
  classifyVideoFiles,
  extensionOf,
  mimeTypeForVideoFile,
} from "@/media/videoFormats";

/** Builds a File-like payload entry. */
function fileOf(name: string, type?: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, type ? { type } : {});
}

describe("videoFormats (فاز M1 — RM1.3)", () => {
  it("accepts exactly the five native extensions", () => {
    expect([...ACCEPTED_VIDEO_EXTENSIONS]).toEqual([
      ".mp4",
      ".m4v",
      ".mov",
      ".webm",
      ".ogv",
    ]);
  });

  it("extracts lower-cased extensions (dots and paths)", () => {
    expect(extensionOf("clip.MP4")).toBe(".mp4");
    expect(extensionOf("/x/y/clip.webm")).toBe(".webm");
    expect(extensionOf("noext")).toBe("");
    expect(extensionOf(".hidden")).toBe("");
  });

  it("resolves the MIME from the browser type, else the extension map", () => {
    expect(mimeTypeForVideoFile({ name: "a.mp4", type: "video/mp4" })).toBe(
      "video/mp4",
    );
    expect(mimeTypeForVideoFile({ name: "a.mov" })).toBe("video/quicktime");
    expect(mimeTypeForVideoFile({ name: "b.webm" })).toBe("video/webm");
    expect(mimeTypeForVideoFile({ name: "c.ogv" })).toBe("video/ogg");
    expect(mimeTypeForVideoFile({ name: "d.m4v" })).toBe("video/mp4");
    // Extension-less payloads fall back to mp4.
    expect(mimeTypeForVideoFile({ name: "blob" })).toBe("video/mp4");
  });

  it("classifies accepted videos by extension (empty browser type included)", () => {
    const { accepted, rejected } = classifyVideoFiles([
      fileOf("clip.mp4", ""),
      fileOf("movie.MOV", "video/quicktime"),
      fileOf("tape.webm", "video/webm"),
    ]);
    expect(accepted.map((file) => file.name)).toEqual([
      "clip.mp4",
      "movie.MOV",
      "tape.webm",
    ]);
    expect(rejected).toHaveLength(0);
  });

  it("rejects video-typed files with foreign extensions (M2's convert gate)", () => {
    const { accepted, rejected } = classifyVideoFiles([
      fileOf("old.avi", "video/x-msvideo"),
      fileOf("film.flv", "video/x-flv"),
      fileOf("pack.mkv", "video/x-matroska"),
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected.map((file) => file.name)).toEqual([
      "old.avi",
      "film.flv",
      "pack.mkv",
    ]);
  });

  it("never hijacks image or text files (their own pipelines)", () => {
    const { accepted, rejected } = classifyVideoFiles([
      fileOf("photo.png", "image/png"),
      fileOf("note.txt", "text/plain"),
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });

  it("splits mixed payloads correctly", () => {
    const { accepted, rejected } = classifyVideoFiles([
      fileOf("photo.png", "image/png"),
      fileOf("clip.mp4", "video/mp4"),
      fileOf("old.avi", "video/x-msvideo"),
    ]);
    expect(accepted.map((file) => file.name)).toEqual(["clip.mp4"]);
    expect(rejected.map((file) => file.name)).toEqual(["old.avi"]);
  });
});
