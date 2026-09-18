/**
 * audioFormats unit tests (فاز A1): the pure import classifier + the
 * extension/MIME algebra (Appendix A-1's binding matrix).
 */
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_AUDIO_EXTENSIONS,
  CONVERT_AUDIO_EXTENSIONS,
  DIRECT_AUDIO_EXTENSIONS,
  classifyAudioFiles,
  mimeTypeForAudioFile,
} from "@/media/audioFormats";

/**
 * Builds a File-like entry the classifier accepts (the runtime `File`
 * global exists in vitest's jsdom-adjacent environment; tests guard it).
 */
function fakeFile(name: string, type?: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, {
    type: type ?? "",
  });
}

describe("extension sets (Appendix A-1)", () => {
  it("accepts exactly the six extensions", () => {
    expect([...ACCEPTED_AUDIO_EXTENSIONS]).toEqual([
      ".mp3",
      ".m4a",
      ".aac",
      ".ogg",
      ".wav",
      ".flac",
    ]);
  });
  it("splits native vs conversion sets", () => {
    expect([...DIRECT_AUDIO_EXTENSIONS]).toEqual([".mp3", ".m4a", ".aac", ".ogg"]);
    expect([...CONVERT_AUDIO_EXTENSIONS]).toEqual([".wav", ".flac"]);
  });
});

describe("classifyAudioFiles", () => {
  it("accepts known extensions regardless of the browser MIME", () => {
    const { accepted, rejected } = classifyAudioFiles([
      fakeFile("song.mp3", "audio/mpeg"),
      fakeFile("tone.wav", ""),
      fakeFile("voice.m4a", "audio/mp4"),
    ]);
    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(0);
  });
  it("rejects audio-typed files with foreign extensions", () => {
    const { accepted, rejected } = classifyAudioFiles([
      fakeFile("clip.opus", "audio/opus"),
      fakeFile("noext", "audio/webm"),
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(2);
  });
  it("never claims image/video/unknown payloads", () => {
    const { accepted, rejected } = classifyAudioFiles([
      fakeFile("pic.png", "image/png"),
      fakeFile("clip.mp4", "video/mp4"),
      fakeFile("notes.txt", "text/plain"),
      fakeFile("mystery.xyz", ""),
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });
  it("classifies case-insensitively", () => {
    const { accepted } = classifyAudioFiles([fakeFile("SONG.MP3", "")]);
    expect(accepted).toHaveLength(1);
  });
});

describe("mimeTypeForAudioFile", () => {
  it("prefers the browser audio type, falls back to the map", () => {
    expect(mimeTypeForAudioFile({ name: "a.mp3", type: "audio/mpeg" })).toBe(
      "audio/mpeg",
    );
    expect(mimeTypeForAudioFile({ name: "a.mp3" })).toBe("audio/mpeg");
    expect(mimeTypeForAudioFile({ name: "b.ogg" })).toBe("audio/ogg");
    expect(mimeTypeForAudioFile({ name: "c.flac" })).toBe("audio/flac");
    expect(mimeTypeForAudioFile({ name: "d.xyz" })).toBe("audio/mpeg");
  });
});
