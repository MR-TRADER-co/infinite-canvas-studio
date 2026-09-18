/**
 * AudioConverter (فاز A2 — RA2.4, A.2.5): the 100%-OFFLINE audio → MP3
 * conversion on THE EXISTING ffmpeg.wasm engine.
 *
 * Hard constraints honoured (A.2.5's binding text):
 * - MUST request the SAME single-threaded `@ffmpeg/core` the video
 *   converter lazy-loads (`VideoConverter.ensureLoaded()` is PUBLIC and
 *   returns the loaded engine) — NO second instance of ffmpeg ever
 *   exists in memory, no second core download;
 * - output: MP3 (libmp3lame), 128 kbps, `-vn` (a stray video stream in
 *   a renamed container is STRIPPED — fixture e);
 * - progress events feed the Persian progress bar through a SECOND
 *   `on("progress")` listener on the shared engine (the emitter supports
 *   multiple listeners; the video converter's own target is idle while
 *   an audio conversion runs);
 * - a CANCEL terminates the SHARED engine (the video converter's own
 *   cancel semantic — the next conversion lazy-loads it again) and
 *   cleans the in-memory FS (no residue, RA2.5);
 * - the ORIGINAL file is kept by the caller (A.2.5: the sidecar keeps
 *   the original next to the converted asset).
 *
 * Licences ship in THIRD_PARTY_NOTICES.md (libmp3lame note added فاز A2).
 */
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { videoConverter } from "@/media/VideoConverter";

/** One audio conversion request. */
export interface AudioConversionRequest {
  /** The original file (any container the core's build demuxes). */
  readonly file: File;
  /** Progress callback (0..1, clamped). */
  readonly onProgress?: (ratio: number) => void;
  /** Cancellation signal (terminate + clean). */
  readonly signal?: AbortSignal;
}

/** The offline audio converter (a thin profile over the SHARED engine). */
export class AudioConverter {
  private progressTarget: ((ratio: number) => void) | null = null;
  private progressListener: ((event: { progress: number }) => void) | null =
    null;

  /**
   * Requests the EXISTING engine (loading it on first use through the
   * video converter's lazy path — the same 32MB bundled core, fetched
   * from app resources, never a CDN).
   *
   * @returns the SHARED engine, or null when the load failed.
   */
  private ensureEngine(): Promise<FFmpeg | null> {
    return videoConverter.ensureLoaded();
  }

  /**
   * Whether the shared engine is loaded (test/UI hint).
   *
   * @returns the loaded state.
   */
  public get loaded(): boolean {
    return videoConverter.loaded;
  }

  /**
   * Converts one file to the MP3 profile, fully offline.
   *
   * @param request - the conversion request.
   * @returns the converted MP3 file, or null when the load failed, the
   *          run errored, or the caller cancelled (all paths clean the
   *          in-memory FS; a cancelled/failed engine reloads on the
   *          next call through the shared lazy path).
   */
  public async convert(request: AudioConversionRequest): Promise<File | null> {
    const ffmpeg = await this.ensureEngine();
    if (ffmpeg === null) {
      return null;
    }
    if (request.signal?.aborted) {
      return null;
    }
    // The input's temp name carries a REAL extension when the file has
    // one — ffmpeg's container probing then goes extension-first
    // (content-probe alone fails on some containers in this wasm
    // build); a video-typed mislabel (renamed `.mp4`) gets the honest
    // `.mp4` extension so the mov demuxer engages (fixture e).
    const sourceExtension = request.file.type.startsWith("video/")
      ? ".mp4"
      : (request.file.name.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "").toLowerCase();
    const inputName = `audio-input${sourceExtension || ".bin"}`;
    const outputName = "audio-output.mp3";
    // Surfaced engine stderr: a failed run is otherwise fully silent
    // (the dialog only says «تبدیل ناموفق بود») — the warn lines land in
    // the dev console while the user-facing flow stays unchanged.
    const logListener = ({ message }: { message: string }): void => {
      if (
        message.includes("Error") ||
        message.includes("error") ||
        message.includes("Invalid")
      ) {
        console.warn("[ffmpeg]", message);
      }
    };
    ffmpeg.on("log", logListener);
    // The shared emitter supports multiple progress listeners; ours
    // routes to THIS conversion while the video converter's target is
    // idle (one conversion dialog runs at a time).
    this.attachProgress(ffmpeg, request.onProgress ?? null);
    try {
      await ffmpeg.writeFile(
        inputName,
        new Uint8Array(await request.file.arrayBuffer()),
      );
      if (request.signal?.aborted) {
        await this.clean(ffmpeg, inputName, outputName);
        return null;
      }
      // -vn STRIPS any stray video stream (fixture e's renamed .mp4);
      // libmp3lame at 128kbps is the binding output profile (A.2.5).
      // NOTE: no shell quoting — the args go to the engine VERBATIM.
      const exitCode = await ffmpeg.exec([
        "-i",
        inputName,
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        outputName,
      ]);
      if (exitCode !== 0) {
        console.error("[AudioConverter] ffmpeg exited", exitCode);
      }
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
      return new File([bytes], "converted.mp3", { type: "audio/mpeg" });
    } catch (error) {
      // A terminated worker (cancel) lands here — the shared engine is
      // dead and reloads before the next conversion (either profile).
      // Diagnostics: a failed run (vs. a user cancel) is otherwise
      // silent; the dialog only says «تبدیل ناموفق بود».
      if (!(request.signal?.aborted === true)) {
        console.error("[AudioConverter] conversion failed", error);
      }
      return null;
    } finally {
      try {
        ffmpeg.off("log", logListener);
      } catch {
        // Engine may be dead — nothing to detach.
      }
      this.detachProgress(ffmpeg);
    }
  }

  /**
   * Terminates the SHARED engine (cancel mid-run) — the next conversion
   * (video OR audio) lazy-loads it again through the same path.
   */
  public terminate(): void {
    videoConverter.terminate();
  }

  /**
   * Attaches THIS converter's progress listener to the shared engine.
   *
   * @param ffmpeg - the shared engine.
   * @param target - the progress callback (null to ignore events).
   */
  private attachProgress(
    ffmpeg: FFmpeg,
    target: ((ratio: number) => void) | null,
  ): void {
    this.progressTarget = target;
    if (this.progressListener !== null) {
      return;
    }
    this.progressListener = ({ progress }) => {
      const ratio = Number(progress);
      if (Number.isFinite(ratio)) {
        this.progressTarget?.(Math.min(1, Math.max(0, ratio)));
      }
    };
    ffmpeg.on("progress", this.progressListener);
  }

  /**
   * Detaches the progress listener (idempotent — a dead engine after
   * termination simply ignores the removal).
   *
   * @param ffmpeg - the shared engine.
   */
  private detachProgress(ffmpeg: FFmpeg): void {
    this.progressTarget = null;
    if (this.progressListener !== null) {
      try {
        ffmpeg.off("progress", this.progressListener);
      } catch {
        // The engine may already be terminated — nothing to detach.
      }
      this.progressListener = null;
    }
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

/** The app-wide audio converter profile (over the SHARED engine). */
export const audioConverter = new AudioConverter();
