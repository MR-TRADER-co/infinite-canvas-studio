/**
 * Storage backend abstraction: where the autosave slot physically lives.
 *
 * The web shell persists to `localStorage` (offline, synchronous, always
 * available in the browser); the Tauri desktop shell later swaps in a
 * filesystem-backed implementation writing the `.icb` file into the
 * app-data directory — the async interface is already shaped for it
 * (CLAUDE.md §1.1: project files never leave the local disk).
 *
 * Backends degrade, never crash: when storage is unavailable (blocked
 * storage in an embedded context, quota errors), reads return null, writes
 * return false and the app simply runs without persistence.
 */
import { AUTOSAVE_STORAGE_KEY } from "@/persistence/ProjectFile";

/** Offline storage contract for the autosave slot. */
export interface IProjectStorage {
  /** Reads the persisted payload, or null when absent/unreadable. */
  read(): Promise<string | null>;
  /** Writes the payload. @returns whether the write succeeded. */
  write(contents: string): Promise<boolean>;
  /** Removes the persisted payload (new project). @returns success. */
  clear(): Promise<boolean>;
}

/**
 * localStorage-backed autosave slot.
 *
 * All operations are wrapped in try/catch: browsers can throw on access
 * (privacy modes, sandboxed frames) and on quota exhaustion. The
 * availability probe runs once on construction.
 */
export class WebStorageBackend implements IProjectStorage {
  /** Storage key of the autosave slot. */
  private readonly key: string;

  /** Whether localStorage is reachable (probed once at construction). */
  private readonly available: boolean;

  /**
   * @param key - storage key (defaults to {@link AUTOSAVE_STORAGE_KEY}).
   */
  public constructor(key: string = AUTOSAVE_STORAGE_KEY) {
    this.key = key;
    this.available = probeLocalStorage();
  }

  /**
   * @returns the persisted payload, or null when absent/unavailable.
   */
  public async read(): Promise<string | null> {
    if (!this.available) {
      return null;
    }
    try {
      return window.localStorage.getItem(this.key);
    } catch {
      return null;
    }
  }

  /**
   * @param contents - the payload to persist.
   * @returns whether the write succeeded.
   */
  public async write(contents: string): Promise<boolean> {
    if (!this.available) {
      return false;
    }
    try {
      window.localStorage.setItem(this.key, contents);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @returns whether the slot was removed (or was already absent).
   */
  public async clear(): Promise<boolean> {
    if (!this.available) {
      return false;
    }
    try {
      window.localStorage.removeItem(this.key);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Probes localStorage reachability with a harmless write+remove cycle.
 *
 * @returns whether localStorage can be read and written.
 */
function probeLocalStorage(): boolean {
  try {
    const probeKey = "infinite-canvas-studio/probe";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}
