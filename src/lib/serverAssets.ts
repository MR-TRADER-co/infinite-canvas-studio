/**
 * Server-side AssetStore backend (فاز M1 — the `/api/assets/*` server
 * half, mirroring `lib/serverFs.ts`'s security posture).
 *
 * Owns the on-disk truth of the sidecar asset store:
 * - WRITE: verifies the client-declared SHA-256 against the received
 *   bytes (node:crypto), stores the file as `<hash>` inside the request
 *   scope (the project's sidecar, or the media inbox for unsaved
 *   projects), and DEDUPES (an existing hash is a no-op — ACM1.4);
 * - READ: resolves a hash against [sidecar(project), inbox] and sniffs
 *   the content type (JPEG/PNG/WebP magic) so posters load in `<img>`
 *   tags regardless of the stored extension-less name;
 * - RELOCATE: moves inbox files into a sidecar on the first Save As
 *   (A.2.1) and copies from a previous sidecar on a later Save As.
 *
 * Guards (narrow by design, unit-tested): every project path must be
 * absolute, inside the bridge roots and end in `.icb` (re-using
 * `normalizeBridgePath`); every hash must be 64 lower-case hex; every
 * payload ≤ {@link ASSET_ROUTE_MAX_BYTES}.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import {
  defaultBridgeConfig,
  normalizeBridgePath,
  type BridgePathResult,
  type FsBridgeConfig,
} from "@/lib/serverFs";
import {
  inboxDirFor,
  isValidAssetHash,
  sidecarDirFor,
} from "@/persistence/assetPaths";

/** Hard ceiling for one asset upload (512 MiB — a long 4K video). */
export const ASSET_ROUTE_MAX_BYTES = 512 * 1024 * 1024;

/** Machine-readable failure codes shared with the HTTP routes / client. */
export type AssetErrorCode =
  | "bad-hash"
  | "hash-mismatch"
  | "too-large"
  | "outside-roots"
  | "not-icb"
  | "write-failed"
  | "read-failed"
  | "not-found";

/** Failure half of every asset result. */
export interface AssetFailure {
  readonly ok: false;
  readonly code: AssetErrorCode;
  readonly message: string;
}

/** Result of an asset write. */
export type AssetWriteResult =
  | {
      readonly ok: true;
      readonly hash: string;
      readonly path: string;
      readonly dedupe: boolean;
    }
  | AssetFailure;

/** Result of an asset read. */
export type AssetReadResult =
  | {
      readonly ok: true;
      readonly bytes: Buffer;
      readonly contentType: string;
    }
  | AssetFailure;

/** Result of an asset relocation. */
export type AssetRelocateResult =
  | {
      readonly ok: true;
      readonly moved: number;
      readonly copied: number;
      readonly missing: readonly string[];
    }
  | AssetFailure;

/** Guards a project path for sidecar derivation (absolute, rooted, .icb). */
function guardProjectPath(
  rawProject: string,
  config: FsBridgeConfig,
): BridgePathResult {
  return normalizeBridgePath(rawProject, config);
}

/**
 * Hashes a payload with node:crypto (the server-side twin of the
 * client's Web Crypto digest).
 *
 * @param bytes - the received payload.
 * @returns the SHA-256 hex hash.
 */
export function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Writes one asset into the requested scope.
 *
 * @param hash - the client-declared SHA-256 hex hash.
 * @param bytes - the received payload.
 * @param project - the project `.icb` path (null → the media inbox).
 * @returns the stored path + dedupe flag, or a typed failure.
 */
export async function writeAsset(
  hash: string,
  bytes: Buffer,
  project: string | null,
  config: FsBridgeConfig = defaultBridgeConfig(),
): Promise<AssetWriteResult> {
  if (!isValidAssetHash(hash)) {
    return fail("bad-hash", "the hash must be 64 lower-case hex characters");
  }
  if (bytes.byteLength > ASSET_ROUTE_MAX_BYTES) {
    return fail(
      "too-large",
      `assets above ${ASSET_ROUTE_MAX_BYTES} bytes are refused`,
    );
  }
  const targetDir = await resolveScopeDir(project, config);
  if (!targetDir.ok) {
    return targetDir;
  }
  if (hashBytes(bytes) !== hash) {
    return fail(
      "hash-mismatch",
      "the payload's SHA-256 does not match the declared hash",
    );
  }
  const target = `${targetDir.path}/${hash}`;
  try {
    const existing = await stat(target).catch(() => null);
    if (existing !== null && existing.isFile()) {
      // Identical imports dedupe to one file (ACM1.4).
      return { ok: true, hash, path: target, dedupe: true };
    }
    await mkdir(targetDir.path, { recursive: true });
    await writeFile(target, bytes);
  } catch (error) {
    return fail("write-failed", describe(error));
  }
  return { ok: true, hash, path: target, dedupe: false };
}

/**
 * Reads one asset from the scope chain [sidecar(project), inbox].
 *
 * @param hash - the asset's SHA-256 hex hash.
 * @param project - the project `.icb` path (null → inbox only).
 * @param mime - optional MIME override (stored names carry no extension).
 * @returns the bytes + content type, or a typed failure.
 */
export async function readAsset(
  hash: string,
  project: string | null,
  mime?: string,
  config: FsBridgeConfig = defaultBridgeConfig(),
): Promise<AssetReadResult> {
  if (!isValidAssetHash(hash)) {
    return fail("bad-hash", "the hash must be 64 lower-case hex characters");
  }
  const candidates = await scopeChain(project, config);
  for (const dir of candidates) {
    const target = `${dir}/${hash}`;
    try {
      const bytes = await readFile(target);
      return {
        ok: true,
        bytes,
        contentType: mime ?? sniffContentType(bytes),
      };
    } catch {
      // Not in this scope — try the next.
    }
  }
  return fail("not-found", "the asset is not present in the scope chain");
}

/**
 * Relocates assets into a project's sidecar: inbox files MOVE (the first
 * Save As — A.2.1), a previous sidecar's files COPY (a later Save As —
 * the old project keeps working). Already-present targets are no-ops.
 *
 * @param to - the NEW project `.icb` path.
 * @param hashes - every referenced asset hash.
 * @param from - the PREVIOUS scope: null/"inbox" or a project path.
 * @returns the move/copy counts + missing hashes, or a typed failure.
 */
export async function relocateAssets(
  to: string,
  hashes: readonly string[],
  from: string | null,
  config: FsBridgeConfig = defaultBridgeConfig(),
): Promise<AssetRelocateResult> {
  const targetGuard = await resolveScopeDir(to, config);
  if (!targetGuard.ok) {
    return targetGuard;
  }
  const sourceDir = await resolveScopeDir(
    from === null || from === "inbox" ? null : from,
    config,
  );
  if (!sourceDir.ok) {
    return sourceDir;
  }
  let moved = 0;
  let copied = 0;
  const missing: string[] = [];
  const fromInbox = from === null || from === "inbox";
  for (const hash of hashes) {
    if (!isValidAssetHash(hash)) {
      continue;
    }
    const source = `${sourceDir.path}/${hash}`;
    const target = `${targetGuard.path}/${hash}`;
    try {
      const present = await stat(target).catch(() => null);
      if (present !== null && present.isFile()) {
        continue;
      }
      await mkdir(targetGuard.path, { recursive: true });
      if (fromInbox) {
        await rename(source, target);
        moved += 1;
      } else {
        await copyFile(source, target);
        copied += 1;
      }
    } catch {
      // A missing source (e.g. adopting an opened project whose assets
      // are already sidecar-resident) is reported, never fatal.
      missing.push(hash);
    }
  }
  return { ok: true, moved, copied, missing };
}

/**
 * Resolves the write/lookup directory of a scope.
 *
 * @param project - the project `.icb` path, or null for the inbox.
 * @returns the absolute directory, or a typed failure.
 */
async function resolveScopeDir(
  project: string | null,
  config: FsBridgeConfig,
): Promise<{ readonly ok: true; readonly path: string } | AssetFailure> {
  if (project === null) {
    const inbox = inboxDirFor(config.roots[0] ?? process.cwd());
    try {
      await mkdir(inbox, { recursive: true });
    } catch (error) {
      return fail("write-failed", describe(error));
    }
    return { ok: true, path: inbox };
  }
  const guard = guardProjectPath(project, config);
  if (!guard.ok) {
    return fail("outside-roots", describeGuard(guard));
  }
  return { ok: true, path: sidecarDirFor(guard.path) };
}

/**
 * The read scope chain: the project sidecar first, the inbox as the
 * fallback (content addressing makes any copy with the same hash valid).
 *
 * @param project - the project `.icb` path (null → inbox only).
 * @returns the candidate directories.
 */
async function scopeChain(
  project: string | null,
  config: FsBridgeConfig,
): Promise<readonly string[]> {
  const inbox = inboxDirFor(config.roots[0] ?? process.cwd());
  if (project === null) {
    return [inbox];
  }
  const guard = guardProjectPath(project, config);
  if (!guard.ok) {
    return [inbox];
  }
  return [sidecarDirFor(guard.path), inbox];
}

/**
 * Sniffs the content type of a stored asset from its magic bytes (the
 * sidecar names files by hash — no extension to trust).
 *
 * @param bytes - the asset payload.
 * @returns `image/jpeg` / `image/png` / `image/webp`, else the generic
 *          octet-stream default.
 */
export function sniffContentType(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

/**
 * Maps an asset failure code onto the HTTP status the routes return.
 *
 * @param code - the machine-readable failure code.
 * @returns the HTTP status for that failure family.
 */
export function assetHttpStatus(code: AssetErrorCode): number {
  switch (code) {
    case "not-found":
      return 404;
    case "too-large":
    case "hash-mismatch":
      return 413;
    case "bad-hash":
      return 400;
    default:
      return 500;
  }
}

/** @param code - the failure code. @param message - the description. */
function fail(code: AssetErrorCode, message: string): AssetFailure {
  return { ok: false, code, message };
}

/** @param error - a caught unknown. @returns a short description. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** @param guard - a failed path guard. @returns its message. */
function describeGuard(guard: BridgePathResult): string {
  return guard.ok ? "" : guard.message;
}
