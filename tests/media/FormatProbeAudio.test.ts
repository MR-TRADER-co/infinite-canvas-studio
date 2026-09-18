/**
 * FormatProbe AUDIO unit tests (فاز A2 — RA2.3): the Appendix A-1
 * binding matrix — direct set probes, wav/flac always convert, the
 * renamed-`.mp4` strip case, unknown extensions reject.
 */
import { describe, expect, it } from "vitest";
import { routeAudioFile } from "@/media/FormatProbe";

/** A probe that always answers the given verdict. */
const probe = (verdict: "" | "maybe" | "probably") => () => verdict;

describe("routeAudioFile (Appendix A-1 matrix)", () => {
  it("direct extensions with a playable verdict import directly", () => {
    expect(routeAudioFile({ name: "a.mp3", type: "audio/mpeg" }, probe("probably"))).toEqual({
      kind: "accepted",
      mimeType: "audio/mpeg",
    });
    expect(routeAudioFile({ name: "b.m4a", type: "audio/mp4" }, probe("maybe"))).toEqual({
      kind: "accepted",
      mimeType: "audio/mp4",
    });
    expect(routeAudioFile({ name: "c.aac" }, probe("maybe"))).toEqual({
      kind: "accepted",
      mimeType: "audio/aac",
    });
    expect(routeAudioFile({ name: "d.ogg", type: "audio/ogg" }, probe("probably"))).toEqual({
      kind: "accepted",
      mimeType: "audio/ogg",
    });
  });

  it("wav/flac ALWAYS route to conversion (the probe is not consulted)", () => {
    expect(routeAudioFile({ name: "x.wav", type: "audio/wav" }, probe("probably"))).toEqual({
      kind: "convert",
      mimeType: "audio/wav",
    });
    expect(routeAudioFile({ name: "y.flac" }, probe("maybe"))).toEqual({
      kind: "convert",
      mimeType: "audio/flac",
    });
  });

  it("a probe-refused direct extension routes to conversion", () => {
    expect(routeAudioFile({ name: "a.mp3", type: "audio/mpeg" }, probe(""))).toEqual({
      kind: "convert",
      mimeType: "audio/mpeg",
    });
  });

  it("a video-typed file with an audio extension converts (the -vn strip case, fixture e)", () => {
    expect(routeAudioFile({ name: "fake.mp3", type: "video/mp4" }, probe("probably"))).toEqual({
      kind: "convert",
      mimeType: "video/mp4",
    });
  });

  it("unknown extensions reject (never an object)", () => {
    expect(routeAudioFile({ name: "z.xyz", type: "application/octet-stream" }, probe("probably"))).toEqual({
      kind: "unknown",
    });
    expect(routeAudioFile({ name: "noext", type: "audio/opus" }, probe("probably"))).toEqual({
      kind: "unknown",
    });
    expect(routeAudioFile({ name: "readme.txt" }, probe("maybe"))).toEqual({
      kind: "unknown",
    });
  });
});
