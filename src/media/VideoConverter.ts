/**
 * VideoConverter (فاز M2 — RM2.4, A.2.5): the 100%-OFFLINE format
 * conversion on ffmpeg.wasm.
 *
 * Hard constraints honoured:
 * - SINGLE-THREADED core only (`@ffmpeg/core`, NOT core-mt): the
 *   multi-threaded build requires SharedArrayBuffer + COOP/COEP
 *   headers, which conflict with the Tauri asset protocol (A.2.5);
 * - the core + glue are BUNDLED in the app resources
 *   (`public/ffmpeg/`) and lazy-loaded ONLY on the first conversion
 *   request — never fetched from a CDN;
 * - output: H.264/AAC MP4, scale ≤ 720p, CRF 23, +faststart; sources
 *   without an audio stream simply produce a silent video (the audio
 *   encoder maps nothing);
 * - progress events feed the Persian progress bar; a CANCEL terminates
 *   the worker and cleans the in-memory FS (no temp residue, RM2.5);
 * - the ORIGINAL file is kept by the caller (A.2.5: the sidecar keeps
 *   the original next to the converted asset).
 *
 * Licences ship in THIRD_PARTY_NOTICES.md (core = GPL-2.0-or-later).
 */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

/** Where the bundled core + glue live (app resources, same-origin). */
const FFMPEG_ASSET_BASE = "/ffmpeg";

/** The output profile (A.2.5): H.264/AAC MP4, ≤ 720p, CRF 23. */
const OUTPUT_MAX_HEIGHT = 720;
const OUTPUT_CRF = "23";

/** One conversion request. */
export interface ConversionRequest {
  /** The original file (any container the core's build demuxes). */
  readonly file: File;
  /** Progress callback (0..1, clamped). */
  readonly onProgress?: (ratio: number) => void;
  /** Cancellation signal (terminate + clean). */
  readonly signal?: AbortSignal;
}

/** The offline converter (a lazily-loaded singleton service). */
export class VideoConverter {
  private ffmpeg: FFmpeg | null = null;
  private loading: Promise<FFmpeg | null> | null = null;
  private progressTarget: ((ratio: number) => void) | null = null;

  /**
   * Loads the engine on first use (lazy — A.2.5). The core is fetched
   * from the app's own resources and mounted as blob URLs.
   *
   * @returns the loaded engine, or null when the load fails (the
   *          caller surfaces the Persian error and aborts the import).
   */
  public ensureLoaded(): Promise<FFmpeg | null> {
    if (this.ffmpeg !== null) {
      return Promise.resolve(this.ffmpeg);
    }
    if (this.loading !== null) {
      return this.loading;
    }
    this.loading = (async () => {
      try {
        const ffmpeg = new FFmpeg();
        ffmpeg.on("progress", ({ progress }) => {
          const ratio = Number(progress);
          if (Number.isFinite(ratio)) {
            this.progressTarget?.(Math.min(1, Math.max(0, ratio)));
          }
        });
        const coreURL = await toBlobURL(
          `${FFMPEG_ASSET_BASE}/ffmpeg-core.js`,
          "text/javascript",
        );
        const wasmURL = await toBlobURL(
          `${FFMPEG_ASSET_BASE}/ffmpeg-core.wasm`,
          "application/wasm",
        );
        await ffmpeg.load({ coreURL, wasmURL });
        this.ffmpeg = ffmpeg;
        return ffmpeg;
      } catch (error) {
        console.error("[VideoConverter] engine load failed", error);
        this.ffmpeg = null;
        this.loading = null;
        return null;
      }
    })();
    return this.loading;
  }

  /**
   * Whether the engine is loaded (test/UI hint).
   *
   * @returns the loaded state.
   */
  public get loaded(): boolean {
    return this.ffmpeg !== null;
  }

  /**
   * Converts one file to the output profile, fully offline.
   *
   * @param request - the conversion request.
   * @returns the converted MP4 file, or null when the load failed, the
   *          run errored, or the caller cancelled (all paths clean the
   *          in-memory FS; a cancelled/failed engine reloads on the
   *          next call).
   */
  public async convert(request: ConversionRequest): Promise<File | null> {
    const ffmpeg = await this.ensureLoaded();
    if (ffmpeg === null) {
      return null;
    }
    if (request.signal?.aborted) {
      return null;
    }
    const inputName = "input.bin";
    const outputName = "output.mp4";
    this.progressTarget = request.onProgress ?? null;
    try {
      await ffmpeg.writeFile(inputName, new Uint8Array(await request.file.arrayBuffer()));
      if (request.signal?.aborted) {
        await this.clean(ffmpeg, inputName, outputName);
        return null;
      }
      // Scale to a ≤720p BOX with the aspect preserved
      // (force_original_aspect_ratio=decrease) and even dimensions
      // (force_divisible_by=2); CRF 23; faststart moves the moov atom
      // up for streaming seeks. A source without audio maps no audio
      // stream (the encoder is unused). NOTE: no shell quoting — the
      // args go to the engine VERBATIM (quotes would corrupt the filter
      // graph when there is no shell to strip them).
      await ffmpeg.exec([
        "-i",
        inputName,
        "-vf",
        `scale=1280:${OUTPUT_MAX_HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
        "-c:v",
        "libx264",
        "-crf",
        OUTPUT_CRF,
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outputName,
      ]);
      if (request.signal?.aborted) {
        await this.clean(ffmpeg, inputName, outputName);
        return null;
      }
      const data = await ffmpeg.readFile(outputName);
      await this.clean(ffmpeg, inputName, outputName);
      if (!(data instanceof Uint8Array) || data.byteLength === 0) {
        return null;
      }
      // Copy into a fresh ArrayBuffer so the Blob part is a plain
      // ArrayBuffer view regardless of the wasm buffer flavour.
      const bytes = new Uint8Array(data.byteLength);
      bytes.set(data);
      return new File([bytes], "converted.mp4", { type: "video/mp4" });
    } catch {
      // A terminated worker (cancel) lands here — the engine is dead
      // and must reload before the next conversion.
      this.ffmpeg = null;
      this.loading = null;
      return null;
    } finally {
      this.progressTarget = null;
    }
  }

  /**
   * Terminates the engine (cancel mid-run) — the next conversion
   * lazy-loads it again.
   */
  public terminate(): void {
    try {
      this.ffmpeg?.terminate();
    } catch {
      // Already dead — nothing to do.
    }
    this.ffmpeg = null;
    this.loading = null;
  }

  /**
   * Removes the temp entries from the in-memory FS (no residue).
   */
  private async clean(ffmpeg: FFmpeg, ...names: string[]): Promise<void> {
    for (const name of names) {
      try {
        await ffmpeg.deleteFile(name);
      } catch {
        // Absent entries are fine.
      }
    }
  }
}

/** The app-wide converter instance (injected through AppContext). */
export const videoConverter = new VideoConverter();
