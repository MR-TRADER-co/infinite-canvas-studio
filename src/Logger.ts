/**
 * Leveled application logger.
 *
 * Writes formatted lines to one or more {@link ILogSink}s. The console sink is
 * always active; in the Tauri desktop shell a rotating file sink is added (see
 * `platform/tauri/log.ts`). Sink failures never propagate to callers.
 */

/** Supported log levels, ordered by severity. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** A destination for formatted log lines. */
export interface ILogSink {
  /**
   * Writes one formatted line. Implementations must not throw.
   *
   * @param level - severity of the line.
   * @param line - fully formatted log line (without trailing newline).
   */
  write(level: LogLevel, line: string): void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

/**
 * Formats one log line as `[iso] [LEVEL] [context] message {details}`.
 */
function formatLine(
  level: LogLevel,
  context: string,
  message: string,
  details: readonly unknown[],
): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${LEVEL_LABEL[level]}] [${context}] ${message}`;
  if (details.length === 0) {
    return base;
  }
  const suffix = details.map((detail) => formatDetail(detail)).join(" ");
  return `${base} ${suffix}`;
}

/**
 * Renders a single detail argument; objects are JSON-encoded.
 */
function formatDetail(detail: unknown): string {
  if (typeof detail === "string") {
    return detail;
  }
  try {
    return JSON.stringify(detail) ?? String(detail);
  } catch {
    // REASON: non-serializable details (e.g. circular refs) must not break logging.
    return "[unserializable]";
  }
}

/** Sink that mirrors log lines to the browser/WebView console. */
export class ConsoleLogSink implements ILogSink {
  /**
   * Writes the line via the console method matching the level.
   *
   * @param level - severity of the line.
   * @param line - formatted log line.
   */
  public write(level: LogLevel, line: string): void {
    const consoleFn = console[level];
    consoleFn.call(console, line);
  }
}

/** Optional constructor settings for {@link Logger}. */
export interface LoggerOptions {
  /** Minimum level that will be emitted. Default: `'debug'`. */
  minLevel?: LogLevel;
  /** Dotted context prefix shown on every line. Default: `'app'`. */
  context?: string;
}

/**
 * Leveled logger.
 *
 * The composition root creates the root logger and derives contextual
 * children via {@link Logger.child} (e.g. `logger.child('render')`).
 */
export class Logger {
  private readonly sinks: readonly ILogSink[];
  private readonly context: string;
  private minLevel: LogLevel;

  /**
   * @param sinks - destinations every emitted line is written to.
   * @param options - level and context configuration.
   */
  public constructor(sinks: readonly ILogSink[], options: LoggerOptions = {}) {
    this.sinks = sinks;
    this.context = options.context ?? "app";
    this.minLevel = options.minLevel ?? "debug";
  }

  /**
   * Changes the minimum emitted level at runtime.
   *
   * @param level - the new minimum level.
   */
  public setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * @param context - child context segment appended to this logger's context.
   * @returns a logger sharing the same sinks with the extended context.
   */
  public child(context: string): Logger {
    return new Logger(this.sinks, { context: `${this.context}.${context}` });
  }

  /** Logs at debug level. */
  public debug(message: string, ...details: unknown[]): void {
    this.log("debug", message, details);
  }

  /** Logs at info level. */
  public info(message: string, ...details: unknown[]): void {
    this.log("info", message, details);
  }

  /** Logs at warn level. */
  public warn(message: string, ...details: unknown[]): void {
    this.log("warn", message, details);
  }

  /** Logs at error level. */
  public error(message: string, ...details: unknown[]): void {
    this.log("error", message, details);
  }

  /**
   * Emits one line to every sink whose level passes the filter.
   */
  private log(
    level: LogLevel,
    message: string,
    details: readonly unknown[],
  ): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) {
      return;
    }
    const line = formatLine(level, this.context, message, details);
    for (const sink of this.sinks) {
      try {
        sink.write(level, line);
      } catch (error) {
        // REASON: a broken sink must never crash the application.
        console.error("[logger] sink failure", error);
      }
    }
  }
}
