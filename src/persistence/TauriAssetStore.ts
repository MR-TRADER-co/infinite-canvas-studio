/**
 * The DESKTOP-shell AssetStore (فاز D1, DECISIONS #63) — the fs-backed
 * twin of {@link WebAssetStore}, registered behind the SAME
 * `Services.assetStore` seam (the composition root swaps it in when
 * `isTauriEnvironment()` holds; the web shell and its tests never load it).
 *
 * The contract is identical to the web routes (`lib/serverAssets.ts`):
 *
 * - a SAVED project keeps its assets in the sidecar
 *   `<projectPath>.assets/`; imports into a NOT-YET-SAVED project land in
 *   the desktop media inbox (`<appData>/media-inbox/`, resolved
 *   Rust-side) and MOVE into the sidecar on the first Save As (a later
 *   Save As COPIES — the old project keeps resolving);
 * - every asset file is named by its SHA-256 content hash — identical
 *   imports dedupe to one file;
 * - reads stream through the custom `icbasset://` scheme: the URL
 *   carries only the hash, so relocations never invalidate URLs.
 *
 * Writes are CHUNKED (4 MiB per IPC call) so a multi-hundred-MB video
 * never sits inside one IPC payload, and offsets make an interrupted
 * import safely resumable — content addressing guarantees every offset
 * always receives the same bytes for the same hash. Every IPC failure
 * degrades to the web semantics: `null` / `false` / the missing-asset
 * dashed placeholder, never a crash.
 */
import type { AssetStore, AssetScopeOutcome } from "@/persistence/AssetStore";
import { ASSET_MAX_BYTES, hashAssetBytes } from "@/persistence/AssetStore";
import { isValidAssetHash, sidecarDirFor } from "@/persistence/assetPaths";

/** Largest payload per IPC write (4 MiB — keeps every call cheap). */
const IPC_CHUNK_BYTES = 4 * 1024 * 1024;

/** The `@tauri-apps/api/core` surface this store touches. */
interface TauriCore {
  readonly invoke: (
    command: string,
    args?: Record<string, unknown>,
  ) => Promise<unknown>;
}

/**
 * Resolves the Tauri IPC bridge (lazy — the import stays out of the web
 * bundle, the {@link TauriAppDataStorage} precedent).
 *
 * @returns the core API, or null outside a working Tauri shell.
 */
async function tauriCore(): Promise<TauriCore | null> {
  try {
    return (await import("@tauri-apps/api/core")) as unknown as TauriCore;
  } catch {
    return null;
  }
}

/**
 * Builds the `icbasset` protocol URL — SYNC string math (no IPC): the
 * scheme serves `<hash>` directly and resolves the scope chain itself
 * Rust-side. `window.__TAURI_INTERNALS__.convertFileSrc` is injected
 * before any app script runs, so it is available synchronously; the UA
 * fallback mirrors wry's platform mapping (`http://<scheme>.localhost`
 * on Windows/Android, `<scheme>://localhost` elsewhere).
 *
 * @param hash - the SHA-256 content hash (already validated).
 * @param query - the pre-encoded query string ("" when empty).
 * @returns the URL the WebView loads the asset from.
 */
export function desktopAssetUrl(hash: string, query: string): string {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: {
        convertFileSrc?: (path: string, protocol?: string) => string;
      };
    }
  ).__TAURI_INTERNALS__;
  if (internals?.convertFileSrc !== undefined) {
    return `${internals.convertFileSrc(hash, "icbasset")}${query}`;
  }
  const windowsLike = /Windows|Android/.test(navigator.userAgent);
  const base = windowsLike
    ? `http://icbasset.localhost/${hash}`
    : `icbasset://localhost/${hash}`;
  return `${base}${query}`;
}

/**
 * Base64-encodes one blob slice in 32 KiB steps (a single
 * `String.fromCharCode(...bytes)` spread would blow the call stack on
 * multi-megabyte chunks).
 *
 * @param bytes - the slice to encode.
 * @returns the base64 payload of the slice.
 */
async function blobToBase64(bytes: Blob): Promise<string> {
  const buffer = new Uint8Array(await bytes.arrayBuffer());
  let binary = "";
  const STEP = 0x8000;
  for (let index = 0; index < buffer.length; index += STEP) {
    binary += String.fromCharCode(...buffer.subarray(index, index + STEP));
  }
  return btoa(binary);
}

/** The desktop-shell AssetStore — the `icbasset` protocol + IPC twin. */
export class TauriAssetStore implements AssetStore {
  private projectPath: string | null = null;

  /** @returns the current project path scope (null = the media inbox). */
  public currentProjectPath(): string | null {
    return this.projectPath;
  }

  /** Switches the read/write scope without relocating anything. */
  public setProjectPath(path: string | null): void {
    this.projectPath = path;
  }

  /**
   * Adopts a project path, relocating the referenced hashes (A.2.1):
   * the FIRST Save As MOVES the inbox files into the sidecar; a later
   * one COPIES — both decided here, executed by one IPC command.
   */
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
    const core = await tauriCore();
    if (core === null) {
      return { relocated: false, missing: valid };
    }
    const mode = previous === null ? "move" : "copy";
    try {
      const missing = (await core.invoke("asset_relocate", {
        fromScope: previous === null ? null : sidecarDirFor(previous),
        toScope: sidecarDirFor(path),
        hashes: valid,
        mode,
      })) as string[] | null;
      return {
        relocated: true,
        missing: Array.isArray(missing)
          ? missing.filter((hash): hash is string => typeof hash === "string")
          : [],
      };
    } catch {
      return { relocated: false, missing: valid };
    }
  }

  /**
   * Writes one asset into the CURRENT scope (sidecar of a saved project,
   * inbox otherwise) — hashed first, then streamed in 4 MiB IPC chunks.
   */
  public async writeAsset(bytes: Blob): Promise<string | null> {
    if (bytes.size > ASSET_MAX_BYTES) {
      return null;
    }
    const hash = await hashAssetBytes(bytes);
    if (hash === null) {
      return null;
    }
    const core = await tauriCore();
    if (core === null) {
      return null;
    }
    const scope = this.projectPath !== null ? sidecarDirFor(this.projectPath) : null;
    try {
      let offset = 0;
      while (offset < bytes.size) {
        const payload = await blobToBase64(
          bytes.slice(offset, offset + IPC_CHUNK_BYTES),
        );
        await core.invoke("asset_write_chunk", {
          scope,
          hash,
          offset,
          contents: payload,
        });
        offset += IPC_CHUNK_BYTES;
      }
      return hash;
    } catch {
      return null;
    }
  }

  /** Whether the asset exists in the scope chain [sidecar, inbox]. */
  public async exists(hash: string): Promise<boolean> {
    if (!isValidAssetHash(hash)) {
      return false;
    }
    const core = await tauriCore();
    if (core === null) {
      return false;
    }
    const scope = this.projectPath !== null ? sidecarDirFor(this.projectPath) : null;
    try {
      return (await core.invoke("asset_exists", { scope, hash })) === true;
    } catch {
      return false;
    }
  }

  /**
   * The load URL — the `icbasset` scheme with the project scope and
   * MIME as query (the handler resolves [sidecar, inbox] itself, so
   * relocation never changes a URL).
   */
  public assetUrl(hash: string, mime?: string): string | null {
    if (!isValidAssetHash(hash)) {
      return null;
    }
    const params = new URLSearchParams();
    if (this.projectPath !== null) {
      params.set("project", this.projectPath);
    }
    if (mime !== undefined) {
      params.set("mime", mime);
    }
    const encoded = params.toString();
    return desktopAssetUrl(hash, encoded === "" ? "" : `?${encoded}`);
  }
}
