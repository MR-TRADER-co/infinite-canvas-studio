/**
 * AudioConverter unit tests (فاز A2 — RA2.4): the MP3 profile runs on
 * the SHARED video-converter engine with a mocked FFmpeg — verifying
 * the exec args (libmp3lame, 128k, -vn), the FS cleanup, the progress
 * routing and the cancel semantics, WITHOUT a real wasm engine.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Records every engine call the converter makes. */
interface EngineCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** A recording fake of the FFmpeg engine surface the converter uses. */
function makeFakeEngine(options?: { failExec?: boolean; emptyOutput?: boolean }) {
  const calls: EngineCall[] = [];
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const engine = {
    on: vi.fn((event: string, listener: (event: unknown) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    }),
    off: vi.fn((event: string, listener: (event: unknown) => void) => {
      const list = listeners.get(event) ?? [];
      listeners.set(event, list.filter((l) => l !== listener));
    }),
    writeFile: vi.fn(async (name: string) => {
      calls.push({ method: "writeFile", args: [name] });
    }),
    exec: vi.fn(async (args: readonly string[]) => {
      calls.push({ method: "exec", args });
      if (options?.failExec) {
        throw new Error("engine died");
      }
    }),
    readFile: vi.fn(async () => {
      calls.push({ method: "readFile", args: [] });
      return options?.emptyOutput
        ? new Uint8Array(0)
        : new Uint8Array([1, 2, 3, 4]);
    }),
    deleteFile: vi.fn(async (name: string) => {
      calls.push({ method: "deleteFile", args: [name] });
    }),
    terminate: vi.fn(),
    /** Test hook: fire a progress event. */
    emitProgress: (progress: number) => {
      for (const listener of listeners.get("progress") ?? []) {
        listener({ progress });
      }
    },
    get calls() {
      return calls;
    },
  };
  return engine;
}

vi.mock("@/media/VideoConverter", () => ({
  VideoConverter: class {},
  videoConverter: {
    // The SHARED-engine seam: ensureLoaded returns the fake.
    ensureLoaded: vi.fn(),
    terminate: vi.fn(),
    loaded: false,
  },
}));

import { videoConverter } from "@/media/VideoConverter";
import { AudioConverter } from "@/media/AudioConverter";

const ensureLoaded = videoConverter.ensureLoaded as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  ensureLoaded.mockReset();
});

describe("AudioConverter (فاز A2 — the SHARED engine profile)", () => {
  it("requests the EXISTING video-converter engine (never a second core)", async () => {
    const engine = makeFakeEngine();
    ensureLoaded.mockResolvedValue(engine);
    const converter = new AudioConverter();
    const file = new File([new Uint8Array([9])], "x.wav", { type: "audio/wav" });
    const result = await converter.convert({ file });
    expect(ensureLoaded).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  it("execs the binding MP3 profile: -vn libmp3lame 128k", async () => {
    const engine = makeFakeEngine();
    ensureLoaded.mockResolvedValue(engine);
    const converter = new AudioConverter();
    const file = new File([new Uint8Array([9])], "x.flac", { type: "audio/flac" });
    const result = await converter.convert({ file });
    expect(result).not.toBeNull();
    const exec = engine.calls.find((call) => call.method === "exec");
    expect(exec).toBeDefined();
    // The input's temp name carries the file's REAL extension — ffmpeg's
    // wasm build probes the container extension-first (verified live in
    // the فاز A2 E2E), so a bare .bin would misdetect the demuxer.
    expect(exec!.args).toEqual([
      "-i",
      "audio-input.flac",
      "-vn",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "audio-output.mp3",
    ]);
    // The converted file is a typed MP3 File.
    expect(result!.type).toBe("audio/mpeg");
    expect(result!.name).toBe("converted.mp3");
    expect(result!.size).toBe(4);
  });

  it("cleans the in-memory FS on BOTH temp names (no residue)", async () => {
    const engine = makeFakeEngine();
    ensureLoaded.mockResolvedValue(engine);
    const converter = new AudioConverter();
    await converter.convert({
      file: new File([new Uint8Array([1])], "a.wav", { type: "audio/wav" }),
    });
    const deletes = engine.calls
      .filter((call) => call.method === "deleteFile")
      .map((call) => call.args[0]);
    // "a.wav" → the temp input keeps its real .wav extension (the
    // extension-first probe contract above).
    expect(deletes).toContain("audio-input.wav");
    expect(deletes).toContain("audio-output.mp3");
  });

  it("routes the shared engine's progress events to the request callback", async () => {
    const engine = makeFakeEngine();
    ensureLoaded.mockResolvedValue(engine);
    const converter = new AudioConverter();
    const onProgress = vi.fn();
    const promise = converter.convert({
      file: new File([new Uint8Array([1])], "a.wav", { type: "audio/wav" }),
      onProgress,
    });
    // Let ensureLoaded resolve so the progress listener attaches first.
    await Promise.resolve();
    await Promise.resolve();
    engine.emitProgress(0.5);
    await promise;
    expect(onProgress).toHaveBeenCalledWith(0.5);
    // The listener detaches after the run.
    expect(engine.off).toHaveBeenCalled();
  });

  it("an empty output resolves null (failed conversion)", async () => {
    const engine = makeFakeEngine({ emptyOutput: true });
    ensureLoaded.mockResolvedValue(engine);
    const converter = new AudioConverter();
    const result = await converter.convert({
      file: new File([new Uint8Array([1])], "a.wav", { type: "audio/wav" }),
    });
    expect(result).toBeNull();
  });

  it("an aborted signal before the run resolves null", async () => {
    const engine = makeFakeEngine();
    ensureLoaded.mockResolvedValue(engine);
    const converter = new AudioConverter();
    const controller = new AbortController();
    controller.abort();
    const result = await converter.convert({
      file: new File([new Uint8Array([1])], "a.wav", { type: "audio/wav" }),
      signal: controller.signal,
    });
    expect(result).toBeNull();
    expect(engine.calls.find((call) => call.method === "exec")).toBeUndefined();
  });

  it("a failed exec resolves null (the engine reloads next time)", async () => {
    const engine = makeFakeEngine({ failExec: true });
    ensureLoaded.mockResolvedValue(engine);
    const converter = new AudioConverter();
    const result = await converter.convert({
      file: new File([new Uint8Array([1])], "a.wav", { type: "audio/wav" }),
    });
    expect(result).toBeNull();
  });

  it("terminate() delegates to the SHARED engine's terminate", () => {
    const converter = new AudioConverter();
    converter.terminate();
    expect(videoConverter.terminate).toHaveBeenCalled();
  });
});
