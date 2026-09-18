/**
 * Server-side filesystem bridge for the "save at an address" system.
 *
 * The web shell normally cannot write to a typed path, but when the app is
 * served from THIS machine (local preview, self-hosted single-user setup) the
 * Next.js server runs on the same filesystem the user addresses. This module
 * is the server half of that bridge: it guards a user-typed path against a
 * small allow-list of roots, enforces the app's own `.icb` format, and
 * reads/writes the file. The desktop (Tauri) shell never uses this module —
 * it writes through the `save_text_file` / `read_text_file` IPC commands.
 *
 * Security posture: the bridge is deliberately narrow —
 * - only ABSOLUTE paths (tilde `~` expands to the server home),
 * - only inside the configured roots (temp dir, home dir, working directory),
 * - only `.icb` files carrying the project magic marker,
 * - only payloads under {@link ICB_BRIDGE_MAX_BYTES}.
 *
 * The guard is pure (injected config + home) so the policy is unit-testable;
 * the save/load functions are thin wrappers over `node:fs/promises`.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { PROJECT_MAGIC } from "@/persistence/ProjectFile";

/** Hard ceiling for one bridge payload (10 MiB — a huge canvas project). */
export const ICB_BRIDGE_MAX_BYTES = 10 * 1024 * 1024;

/** Allow-list of directory roots the bridge may read/write inside. */
export interface FsBridgeConfig {
  /** Absolute directories the bridge is allowed to touch. */
  readonly roots: readonly string[];
  /** Maximum payload size accepted for one file, in bytes. */
  readonly maxBytes: number;
}

/** Machine-readable failure codes shared with the HTTP routes / client. */
export type BridgeErrorCode =
  | "empty"
  | "not-absolute"
  | "invalid-path"
  | "outside-roots"
  | "too-large"
  | "not-icb"
  | "not-found"
  | "not-a-file"
  | "bad-payload"
  | "write-failed"
  | "read-failed";

/** Failure half of every bridge result. */
export interface BridgeFailure {
  readonly ok: false;
  readonly code: BridgeErrorCode;
  readonly message: string;
}

/** Result of a bridge save attempt. */
export type BridgeSaveResult =
  | { readonly ok: true; readonly path: string; readonly bytes: number }
  | BridgeFailure;

/** Result of a bridge load attempt. */
export type BridgeLoadResult =
  | {
      readonly ok: true;
      readonly path: string;
      readonly contents: string;
      readonly bytes: number;
      readonly modifiedAt: number;
    }
  | BridgeFailure;

/** Guard verdict for a user-typed path. */
export type BridgePathResult =
  { readonly ok: true; readonly path: string } | BridgeFailure;

/**
 * @returns the default bridge configuration: the OS temp dir, the user home
 *          and the process working directory (de-duplicated, resolved).
 */
export function defaultBridgeConfig(): FsBridgeConfig {
  const roots = [tmpdir(), homedir(), process.cwd()]
    .map((root) => resolve(root))
    .filter((root, index, all) => all.indexOf(root) === index);
  return { roots, maxBytes: ICB_BRIDGE_MAX_BYTES };
}

/**
 * Normalises and guards a user-typed path for the bridge.
 *
 * Policy (mirrored by unit tests):
 * - surrounding double quotes are stripped (Windows "Copy as path"),
 * - a leading `~` expands to the server home directory,
 * - the path must be absolute on the machine running the server,
 * - control characters and characters Windows forbids are rejected,
 * - a trailing separator (directory-only input) is rejected,
 * - the `.icb` extension is enforced (appended when missing, foreign
 *   extensions replaced — the bridge only moves the app's own format),
 * - the resolved path must sit INSIDE one of the configured roots.
 *
 * @param raw - the path exactly as typed by the user.
 * @param config - the bridge configuration (roots + size cap).
 * @param home - the home directory `~` expands to (injected for tests).
 * @returns the canonical absolute path, or a typed failure.
 */
export function normalizeBridgePath(
  raw: string,
  config: FsBridgeConfig,
  home: string = homedir(),
): BridgePathResult {
  let path = raw.trim();
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1).trim();
  }
  if (path.length === 0) {
    return fail("empty", "the path is empty");
  }
  if (path === "~" || path.startsWith("~/") || path.startsWith("~\\")) {
    path = join(home, path.slice(1));
  }
  if (!isAbsolute(path)) {
    return fail("not-absolute", "the path must be absolute on this machine");
  }
  if (/[\u0000-\u001f<>|?*"]/.test(path)) {
    return fail("invalid-path", "the path contains forbidden characters");
  }
  if (path.endsWith("/") || path.endsWith("\\")) {
    return fail(
      "invalid-path",
      "the path ends with a separator — add a file name",
    );
  }
  const canonical = enforceIcbExtension(resolve(path));
  if (!isInsideRoots(canonical, config.roots)) {
    return fail("outside-roots", "the path is outside the allowed roots");
  }
  return { ok: true, path: canonical };
}

/**
 * Writes an `.icb` payload to a user-typed path through the bridge.
 *
 * Parent directories are created as needed (mirroring the desktop
 * `save_text_file` command). The payload must carry the project magic.
 *
 * @param raw - the path exactly as typed by the user.
 * @param contents - the serialised `.icb` payload.
 * @param config - the bridge configuration (defaults to the machine's).
 * @returns the canonical path + written byte count, or a typed failure.
 */
export async function saveBridgeFile(
  raw: string,
  contents: string,
  config: FsBridgeConfig = defaultBridgeConfig(),
): Promise<BridgeSaveResult> {
  if (typeof contents !== "string") {
    return fail("bad-payload", "the payload must be a string");
  }
  const guard = normalizeBridgePath(raw, config);
  if (!guard.ok) {
    return guard;
  }
  const bytes = Buffer.byteLength(contents, "utf8");
  if (bytes > config.maxBytes) {
    return fail(
      "too-large",
      `payloads above ${config.maxBytes} bytes are refused`,
    );
  }
  if (!isIcbEnvelope(contents)) {
    return fail("not-icb", "the payload is not an .icb project file");
  }
  try {
    await mkdir(dirname(guard.path), { recursive: true });
    await writeFile(guard.path, contents, "utf8");
  } catch (error) {
    return fail("write-failed", describe(error));
  }
  return { ok: true, path: guard.path, bytes };
}

/**
 * Reads an `.icb` project file from a user-typed path through the bridge.
 *
 * @param raw - the path exactly as typed by the user.
 * @param config - the bridge configuration (defaults to the machine's).
 * @returns the file contents plus metadata, or a typed failure.
 */
export async function loadBridgeFile(
  raw: string,
  config: FsBridgeConfig = defaultBridgeConfig(),
): Promise<BridgeLoadResult> {
  const guard = normalizeBridgePath(raw, config);
  if (!guard.ok) {
    return guard;
  }
  let size: number;
  let modifiedAt: number;
  try {
    const info = await stat(guard.path);
    if (!info.isFile()) {
      return fail("not-a-file", "the path does not point at a regular file");
    }
    size = info.size;
    modifiedAt = info.mtimeMs;
  } catch (error) {
    return fail("not-found", describe(error));
  }
  if (size > config.maxBytes) {
    return fail(
      "too-large",
      `files above ${config.maxBytes} bytes are refused`,
    );
  }
  let contents: string;
  try {
    contents = await readFile(guard.path, "utf8");
  } catch (error) {
    return fail("read-failed", describe(error));
  }
  if (!isIcbEnvelope(contents)) {
    return fail("not-icb", "the file does not carry the .icb project magic");
  }
  return {
    ok: true,
    path: guard.path,
    contents,
    bytes: Buffer.byteLength(contents, "utf8"),
    modifiedAt,
  };
}

/**
 * Maps a bridge failure code onto the HTTP status the routes return.
 *
 * @param code - the machine-readable failure code.
 * @returns the HTTP status code for that failure family.
 */
export function bridgeHttpStatus(code: BridgeErrorCode): number {
  switch (code) {
    case "not-found":
      return 404;
    case "too-large":
      return 413;
    case "not-icb":
      return 422;
    case "write-failed":
    case "read-failed":
      return 500;
    default:
      return 400;
  }
}

/**
 * @param path - an already-resolved absolute path.
 * @returns the same path with the `.icb` extension enforced.
 */
function enforceIcbExtension(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const fileName = path.slice(separator + 1);
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) {
    if (dot === 0 && fileName.toLowerCase() === ".icb") {
      return path;
    }
    return `${path}.icb`;
  }
  const extension = fileName.slice(dot).toLowerCase();
  if (extension === ".icb") {
    return path;
  }
  return `${path.slice(0, path.length - extension.length)}.icb`;
}

/**
 * Containment check with a separator boundary: `/home/zombie` must NOT pass
 * for `/home/z` (a naive `startsWith` would accept it).
 *
 * @param candidate - the resolved path being tested.
 * @param roots - the allow-listed absolute directories.
 * @returns whether the candidate sits inside (or equals) a root.
 */
function isInsideRoots(candidate: string, roots: readonly string[]): boolean {
  return roots.some(
    (root) => candidate === root || candidate.startsWith(`${root}${sep}`),
  );
}

/**
 * Quick envelope check: JSON-parseable with the project magic + a numeric
 * version. Structural validation of the scene happens in the serializer.
 *
 * @param contents - the raw file payload.
 * @returns whether the payload looks like an `.icb` project file.
 */
function isIcbEnvelope(contents: string): boolean {
  try {
    // v1: { magic, version, … } at the root; v2 (R4.2): the magic moved
    // into `meta` and the version became `schemaVersion`. Both spellings
    // are accepted so old files stay readable through the bridge.
    const parsed = JSON.parse(contents) as {
      magic?: unknown;
      version?: unknown;
      schemaVersion?: unknown;
      meta?: { magic?: unknown } | null;
    };
    const v1 =
      parsed.magic === PROJECT_MAGIC && typeof parsed.version === "number";
    const v2 =
      parsed.meta?.magic === PROJECT_MAGIC &&
      typeof parsed.schemaVersion === "number";
    return v1 || v2;
  } catch {
    return false;
  }
}

/**
 * @param error - a caught unknown.
 * @returns a short human-readable description for logs/responses.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param code - the machine-readable failure code.
 * @param message - the human-readable description.
 * @returns the failure half of a bridge result.
 */
function fail(code: BridgeErrorCode, message: string): BridgeFailure {
  return { ok: false, code, message };
}
