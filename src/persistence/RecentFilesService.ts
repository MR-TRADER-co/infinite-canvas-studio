/**
 * Recent files service (R4.7): tracks the last ten opened/saved
 * projects (path + name + timestamp) for the File menu.
 *
 * Entries are stored through an injectable store (localStorage by
 * default — offline, both shells) and managed defensively: corrupt
 * storage collapses to an empty list, entries are validated on read,
 * duplicates move to the front, and the list is hard-trimmed to ten.
 *
 * Existence validation (missing files gray out in the menu) is an async,
 * shell-dependent probe kept OUT of this service — see
 * `probeRecentFileExists` in `LoadFromDisk.ts`.
 */
import { baseNameOfPath } from "@/persistence/pathNames";

/** Storage key of the recent-files list. */
const RECENT_STORAGE_KEY = "infinite-canvas-studio/recent-files/v1";

/** Maximum number of remembered projects (R4.7: "last 10"). */
const MAX_RECENT_FILES = 10;

/** One entry of the recent-files list. */
export interface RecentFileEntry {
  /** Absolute path of the project file on disk. */
  readonly path: string;
  /** Display name of the file (its basename). */
  readonly name: string;
  /** Epoch milliseconds of the last time the file was opened/saved. */
  readonly openedAt: number;
}

/** Offline storage contract for the recent-files list. */
export interface IRecentFilesStore {
  /** Reads the persisted entries (never throws; [] on absence/corruption). */
  read(): RecentFileEntry[];
  /** Persists the entries (best-effort). */
  write(entries: readonly RecentFileEntry[]): void;
}

/** localStorage-backed recent-files store (both shells; WebView2 has it). */
export class LocalRecentFilesStore implements IRecentFilesStore {
  /** @returns the persisted entries, or [] when absent or corrupt. */
  public read(): RecentFileEntry[] {
    try {
      const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
      if (raw === null) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      const entries: RecentFileEntry[] = [];
      for (const entry of parsed) {
        const candidate = entry as Partial<RecentFileEntry>;
        if (
          typeof candidate.path !== "string" ||
          candidate.path.length === 0 ||
          typeof candidate.name !== "string" ||
          typeof candidate.openedAt !== "number" ||
          !Number.isFinite(candidate.openedAt)
        ) {
          continue;
        }
        entries.push({
          path: candidate.path,
          name: candidate.name,
          openedAt: candidate.openedAt,
        });
      }
      return entries;
    } catch {
      return [];
    }
  }

  /**
   * @param entries - the entries to persist (best-effort; failures are
   *        swallowed — an unavailable storage must never break opens).
   */
  public write(entries: readonly RecentFileEntry[]): void {
    try {
      window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage unavailable: the list simply won't survive a restart.
    }
  }
}

/** In-memory store (tests / embedded contexts without storage). */
export class MemoryRecentFilesStore implements IRecentFilesStore {
  private entries: RecentFileEntry[] = [];

  /** @returns the stored entries. */
  public read(): RecentFileEntry[] {
    return [...this.entries];
  }

  /** @param entries - the entries to store. */
  public write(entries: readonly RecentFileEntry[]): void {
    this.entries = [...entries];
  }
}

/** Maintains the ordered recent-files list (R4.7). */
export class RecentFilesService {
  private readonly store: IRecentFilesStore;

  /**
   * @param store - the persistence store (defaults to localStorage).
   */
  public constructor(store: IRecentFilesStore = new LocalRecentFilesStore()) {
    this.store = store;
  }

  /**
   * @returns the recent files, most recently opened first, hard-trimmed
   *          to ten entries.
   */
  public getRecentFiles(): readonly RecentFileEntry[] {
    return this.store.read().slice(0, MAX_RECENT_FILES);
  }

  /**
   * Records a file as just opened/saved: de-duplicates by exact path,
   * moves the entry to the front, stamps the timestamp and trims to ten.
   *
   * @param path - absolute path of the project file.
   */
  public add(path: string): void {
    const trimmed = path.trim();
    if (trimmed.length === 0) {
      return;
    }
    const entries = this.store.read().filter((entry) => entry.path !== trimmed);
    entries.unshift({
      path: trimmed,
      name: baseNameOfPath(trimmed),
      openedAt: Date.now(),
    });
    this.store.write(entries.slice(0, MAX_RECENT_FILES));
  }

  /**
   * Removes one entry (e.g. the user dismissed a stale path).
   *
   * @param path - the exact path to forget.
   */
  public remove(path: string): void {
    this.store.write(this.store.read().filter((entry) => entry.path !== path));
  }

  /** Clears the whole list (the «پاک‌کردن فهرست اخیر» menu action). */
  public clear(): void {
    this.store.write([]);
  }
}
