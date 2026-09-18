/**
 * Rotating-file log sink for the Tauri desktop shell.
 *
 * Batches formatted log lines and flushes them to the Rust side through the
 * `append_log` IPC command (see `src-tauri/src/lib.rs`), where size-based
 * rotation is performed. In the plain web preview this sink is never
 * instantiated. All IPC failures are swallowed after a single console
 * warning so logging can never break the application.
 */
import type { ILogSink, LogLevel } from "@/Logger";

/** Signature of Tauri's `invoke` (kept local to avoid a static dependency). */
type InvokeFn = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/** @returns whether the code runs inside the Tauri WebView. */
export function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Optional constructor settings for {@link TauriFileLogSink}. */
export interface TauriFileLogSinkOptions {
  /** Flush once this many lines are buffered. Default: 50. */
  maxBufferedLines?: number;
  /** Auto-flush interval in milliseconds. Default: 500. */
  flushIntervalMs?: number;
}

/**
 * Buffers log lines and appends them to the rotating app log file via Tauri
 * IPC. Instantiated only when {@link isTauriEnvironment} returns true.
 */
export class TauriFileLogSink implements ILogSink {
  private readonly buffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private failureReported = false;
  private invoke: InvokeFn | null = null;

  /**
   * @param options - buffering behaviour.
   */
  public constructor(private readonly options: TauriFileLogSinkOptions = {}) {}

  /**
   * Buffers one formatted line and schedules (or forces) a flush.
   *
   * @param _level - severity (unused: rotation is level-agnostic).
   * @param line - formatted log line without trailing newline.
   */
  public write(_level: LogLevel, line: string): void {
    this.buffer.push(line);
    const max = this.options.maxBufferedLines ?? 50;
    if (this.buffer.length >= max) {
      void this.flush();
      return;
    }
    this.scheduleFlush();
  }

  /**
   * Flushes any buffered lines immediately. Also safe to call on app exit.
   *
   * @returns a promise that resolves once the write attempt finished.
   */
  public async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) {
      return;
    }
    const lines = `${this.buffer.join("\n")}\n`;
    this.buffer.length = 0;
    try {
      if (this.invoke === null) {
        const core = await import("@tauri-apps/api/core");
        this.invoke = core.invoke;
      }
      await this.invoke("append_log", { line: lines });
    } catch (error) {
      if (!this.failureReported) {
        this.failureReported = true;
        console.warn("[logger] rotating file sink unavailable:", error);
      }
    }
  }

  /**
   * Schedules a flush when none is pending.
   */
  private scheduleFlush(): void {
    if (this.flushTimer !== null) {
      return;
    }
    const delay = this.options.flushIntervalMs ?? 500;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }
}
