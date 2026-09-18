/**
 * AssetStore (فاز M1 — A.2.1): the sidecar media store keeping VIDEO
 * bytes (and their poster JPEGs) OUT of the `.icb` payload.
 *
 * Storage contract (shared with the server routes through the PURE
 * `persistence/assetPaths.ts`):
 * - a saved project's assets live in `<projectPath>.assets/` — the
 *   sidecar next to the `.icb` — every file named by its SHA-256 content
 *   hash (identical imports dedupe to one file, ACM1.4);
 * - imports into a not-yet-saved project land in the media inbox and are
 *   MOVED into the sidecar on the first Save As (ACM1.6); a later Save
 *   As to a different path COPIES the referenced assets into the new
 *   sidecar (the old project may still reference them);
 * - reads resolve against [current sidecar, inbox] — content addressing
 *   makes any copy with the same hash valid;
 * - a missing asset simply fails the read → the renderer paints the
 *   dashed Persian placeholder (ACM1.5), never a crash.
 *
 * `WebAssetStore` is the web-shell implementation (fetch against
 * `/api/assets/*`, mirroring LocalFsBridge's posture); the desktop
 * (Tauri) shell swaps in an fs-backed twin through the same ServiceKey.
 * The store is a service class injected via AppContext (A.4).
 */
import {
  inboxDirFor,
  isValidAssetHash,
  sidecarDirFor,
} from "@/persistence/assetPaths";

/** Largest asset the store accepts (video files can be large). */
export const ASSET_MAX_BYTES = 512 * 1024 * 1024;

/** Outcome of one scope adoption (Save As / open). */
export interface AssetScopeOutcome {
  /** Whether the requested relocation (if any) completed. */
  readonly relocated: boolean;
  /** Hashes the server could not find in the source scope. */
  readonly missing: readonly string[];
}

/** The content-addressed sidecar asset store (A.2.1). */
export interface AssetStore {
  /** The current project path scope (null = the media inbox). */
  currentProjectPath(): string | null;
  /**
   * Switches the read/write scope (open / new project / first save).
   * PURE scope switch — relocates nothing (callers with relocation
   * needs use {@link AssetStore.syncProjectPath}).
   *
   * @param path - the project `.icb` path, or null for the inbox.
   */
  setProjectPath(path: string | null): void;
  /**
   * Adopts a project path AND relocates the referenced hashes into its
   * sidecar: inbox files MOVE (first Save As, A.2.1); a previous
   * sidecar's files COPY (Save As over a saved project — the old file
   * keeps working). Same path / already-present files are no-ops.
   *
   * @param path - the NEW project `.icb` path.
   * @param hashes - every asset hash the scene references.
   * @returns the relocation outcome.
   */
  syncProjectPath(
    path: string,
    hashes: readonly string[],
  ): Promise<AssetScopeOutcome>;
  /**
   * Writes one asset into the CURRENT scope (sidecar of a saved project,
   * inbox otherwise). Content-addressed: the client computes the SHA-256
   * hash, the server verifies it against the received bytes and dedupes.
   *
   * @param bytes - the file contents.
   * @returns the content hash, or null when the write failed.
   */
  writeAsset(bytes: Blob): Promise<string | null>;
  /**
   * @param hash - the content hash.
   * @returns whether the asset exists in the current scope chain
   *          (sidecar + inbox).
   */
  exists(hash: string): Promise<boolean>;
  /**
   * A same-origin URL the `<img>`/fetch layer can load the asset from
   * (content-hashed → immutable, aggressively cached). Null when the
   * hash is malformed.
   *
   * @param hash - the content hash.
   * @param mime - optional MIME override for the response type.
   */
  assetUrl(hash: string, mime?: string): string | null;
}

/**
 * Computes the SHA-256 hash of a payload through Web Crypto (A.2.1).
 * The file is READ in chunks so huge videos never double-buffer, then
 * digested in one `crypto.subtle.digest` call (the API is atomic).
 *
 * @param bytes - the payload to hash.
 * @returns the lower-case hex hash, or null when crypto is unavailable.
 */
export async function hashAssetBytes(bytes: Blob): Promise<string | null> {
  const cryptoGlobal = globalThis.crypto;
  if (cryptoGlobal?.subtle === undefined) {
    return null;
  }
  try {
    const buffer = await bytes.arrayBuffer();
    const digest = await cryptoGlobal.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/** The web-shell AssetStore (fetch-based, same-origin `/api/assets/*`). */
export class WebAssetStore implements AssetStore {
  private projectPath: string | null = null;

  /** @returns the current project path scope (null = the media inbox). */
  public currentProjectPath(): string | null {
    return this.projectPath;
  }

  /** Switches the read/write scope without relocating anything. */
  public setProjectPath(path: string | null): void {
    this.projectPath = path;
  }

  /** Adopts a project path, relocating the referenced hashes. */
  public async syncProjectPath(
    path: string,
    hashes: readonly string[],
  ): Promise<AssetScopeOutcome> {
    const previous = this.projectPath;
    this.projectPath = path;
    if (previous === path) {
      return { relocated: true, missing: [] };
    }
    const valid = hashes.filter(isValidAssetHash);
    if (valid.length === 0) {
      return { relocated: true, missing: [] };
    }
    try {
      const response = await fetch("/api/assets/relocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: previous,
          to: path,
          hashes: valid,
        }),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok || data.ok !== true) {
        return { relocated: false, missing: valid };
      }
      return {
        relocated: true,
        missing: Array.isArray(data.missing)
          ? (data.missing as unknown[]).filter(
              (hash): hash is string => typeof hash === "string",
            )
          : [],
      };
    } catch {
      return { relocated: false, missing: valid };
    }
  }

  /** Writes one asset into the current scope (server verifies + dedupes). */
  public async writeAsset(bytes: Blob): Promise<string | null> {
    if (bytes.size > ASSET_MAX_BYTES) {
      return null;
    }
    const hash = await hashAssetBytes(bytes);
    if (hash === null) {
      return null;
    }
    const scope = this.projectPath;
    const query = new URLSearchParams({ hash });
    if (scope !== null) {
      query.set("project", scope);
    }
    try {
      const response = await fetch(`/api/assets/write?${query.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok || data.ok !== true || data.hash !== hash) {
        return null;
      }
      return hash;
    } catch {
      return null;
    }
  }

  /** Whether the asset exists in the current scope chain. */
  public async exists(hash: string): Promise<boolean> {
    if (!isValidAssetHash(hash)) {
      return false;
    }
    const scope = this.projectPath;
    const query = new URLSearchParams({ hash });
    if (scope !== null) {
      query.set("project", scope);
    }
    try {
      // probe=1: the server answers with a tiny JSON body instead of the
      // asset bytes — found ⇒ 200, missing ⇒ 404.
      const response = await fetch(
        `/api/assets/read?${query.toString()}&probe=1`,
        { method: "GET", cache: "no-store" },
      );
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /** The immutable load URL of an asset in the current scope chain. */
  public assetUrl(hash: string, mime?: string): string | null {
    if (!isValidAssetHash(hash)) {
      return null;
    }
    const scope = this.projectPath;
    const query = new URLSearchParams({ hash });
    if (scope !== null) {
      query.set("project", scope);
    }
    if (mime !== undefined) {
      query.set("mime", mime);
    }
    return `/api/assets/read?${query.toString()}`;
  }
}

/**
 * Test seam: resolves the inbox directory under a storage root — exposed
 * from the pure module for parity checks (see `assetPaths.ts`).
 */
export { inboxDirFor, sidecarDirFor, isValidAssetHash };
