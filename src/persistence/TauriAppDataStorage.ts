/**
 * Tauri app-data storage (R4.6): the autosave slot as the
 * `autosave.icb` file inside the app's data directory on the desktop
 * shell.
 *
 * Writes go through the existing `save_text_file` IPC command (parent
 * directories are created Rust-side), reads through `read_text_file`,
 * and clears through the `delete_text_file` command — the directory is
 * resolved once via `@tauri-apps/api/path` `appDataDir()` (dynamically
 * imported so the web bundle stays clean). Every step degrades
 * gracefully: outside the Tauri shell, or when the path resolution /
 * IPC fails, the slot falls back to the localStorage backend — a
 * missing app-data file must never break autosave entirely.
 */
import type { IProjectStorage } from "@/persistence/StorageBackend";
import { WebStorageBackend } from "@/persistence/StorageBackend";
import { isTauriEnvironment } from "@/platform/tauri/log";

/** Name of the autosave slot file inside the app-data directory. */
const AUTOSAVE_FILE_NAME = "autosave.icb";

/** localStorage fallback used when the desktop slot is unavailable. */
export class TauriAppDataStorage implements IProjectStorage {
  /** localStorage fallback (resolved lazily, reused across calls). */
  private fallback: WebStorageBackend | null = null;

  /** Resolved app-data directory (null until resolution fails once). */
  private dir: string | null = null;

  /** Whether the directory resolution already ran (memoised failure). */
  private dirResolved = false;

  /**
   * @param fileName - the slot file name (default `autosave.icb`).
   */
  public constructor(private readonly fileName: string = AUTOSAVE_FILE_NAME) {}

  /**
   * @returns the persisted payload, or null when absent/unreadable.
   */
  public async read(): Promise<string | null> {
    const path = await this.slotPath();
    if (path === null) {
      return this.fallbackBackend().read();
    }
    try {
      const core = await import("@tauri-apps/api/core");
      return await core.invoke<string>("read_text_file", { path });
    } catch {
      // Missing file (first run) or IPC failure → no snapshot.
      return null;
    }
  }

  /**
   * @param contents - the payload to persist.
   * @returns whether the write succeeded.
   */
  public async write(contents: string): Promise<boolean> {
    const path = await this.slotPath();
    if (path === null) {
      return this.fallbackBackend().write(contents);
    }
    try {
      const core = await import("@tauri-apps/api/core");
      await core.invoke("save_text_file", { path, contents });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @returns whether the slot was removed (or was already absent).
   */
  public async clear(): Promise<boolean> {
    const path = await this.slotPath();
    if (path === null) {
      return this.fallbackBackend().clear();
    }
    try {
      const core = await import("@tauri-apps/api/core");
      await core.invoke("delete_text_file", { path });
      return true;
    } catch {
      // A missing file is already "cleared"; real IPC failures degrade.
      return true;
    }
  }

  /**
   * Resolves the absolute slot path (memoised; null outside Tauri or on
   * resolution failure — the caller falls back to localStorage).
   */
  private async slotPath(): Promise<string | null> {
    if (!isTauriEnvironment()) {
      return null;
    }
    if (this.dirResolved) {
      return this.dir === null ? null : joinPath(this.dir, this.fileName);
    }
    this.dirResolved = true;
    try {
      const pathApi = await import("@tauri-apps/api/path");
      this.dir = await pathApi.appDataDir();
    } catch {
      this.dir = null;
    }
    return this.dir === null ? null : joinPath(this.dir, this.fileName);
  }

  /** @returns the lazily created localStorage fallback backend. */
  private fallbackBackend(): WebStorageBackend {
    this.fallback ??= new WebStorageBackend();
    return this.fallback;
  }
}

/**
 * Joins a directory and a file name with the platform-appropriate shape
 * (the dialog/fs layer accepts forward slashes on Windows, but a native
 * separator is the safest spelling for the IPC commands).
 *
 * @param dir - the directory path.
 * @param fileName - the file name.
 * @returns the joined path.
 */
function joinPath(dir: string, fileName: string): string {
  const trimmed =
    dir.endsWith("/") || dir.endsWith("\\") ? dir.slice(0, -1) : dir;
  const separator =
    trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  return `${trimmed}${separator}${fileName}`;
}
