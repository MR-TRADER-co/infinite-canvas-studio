/**
 * Document service (R4.5): the lifecycle state of the OPEN document —
 * its file path, display name, dirty marker (title bar «*» + the
 * unsaved-changes close guard), read-only flag (future file versions,
 * R4.4a) and the plugins passthrough holder (§1.7.4).
 *
 * The service is the single source of truth the title bar, the file
 * commands and the recovery flow read from; every state change is
 * announced on the typed event bus (`project:document-changed`) so React
 * surfaces re-render without polling.
 *
 * Dirty semantics: the composition root marks the document dirty on every
 * scene/camera mutation EXCEPT during a document swap — the
 * `suspendDirtyTracking`/`resumeDirtyTracking` pair brackets restores so
 * a freshly opened file starts clean and the marker only appears on real
 * user edits afterwards.
 */
import type { EventBus } from "@/core/events/EventBus";
import type { AppEventMap } from "@/core/events/EventBus";
import { LAST_DISK_SAVE_STORAGE_KEY } from "@/persistence/ProjectFile";
import { baseNameOfPath } from "@/persistence/pathNames";

/** Snapshot of the open-document state (event payload). */
export interface DocumentState {
  /** Absolute path of the open file, or null for an untitled document. */
  readonly path: string | null;
  /** Display name (null = untitled — the UI renders its i18n label). */
  readonly name: string | null;
  /** Whether unsaved changes exist. */
  readonly dirty: boolean;
  /** Whether the document refuses writes (future file version). */
  readonly readOnly: boolean;
}

/** Reads the persisted last-disk-save timestamp (recovery comparison). */
function readLastDiskSaveAt(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_DISK_SAVE_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Persists the last-disk-save timestamp (best-effort). */
function writeLastDiskSaveAt(savedAt: number): void {
  try {
    window.localStorage.setItem(LAST_DISK_SAVE_STORAGE_KEY, String(savedAt));
  } catch {
    // Storage unavailable (privacy mode): recovery simply compares less.
  }
}

/** Tracks the open document's lifecycle state (R4.5). */
export class DocumentService {
  private readonly bus: EventBus<AppEventMap>;

  private path: string | null = null;

  private name: string | null = null;

  private dirty = false;

  private readOnly = false;

  private dirtySuspended = false;

  /** The plugins passthrough section (§1.7.4) of the open document. */
  private plugins: Readonly<Record<string, unknown>> = {};

  /**
   * @param bus - the application event bus (document-change announcements).
   */
  public constructor(bus: EventBus<AppEventMap>) {
    this.bus = bus;
  }

  /** @returns the current document state snapshot. */
  public state(): DocumentState {
    return {
      path: this.path,
      name: this.name,
      dirty: this.dirty,
      readOnly: this.readOnly,
    };
  }

  /** @returns whether unsaved changes exist. */
  public isDirty(): boolean {
    return this.dirty;
  }

  /** @returns whether the document refuses writes (R4.4a). */
  public isReadOnly(): boolean {
    return this.readOnly;
  }

  /** @returns the absolute path of the open file, or null. */
  public getPath(): string | null {
    return this.path;
  }

  /** @returns the display name, or null when untitled. */
  public getName(): string | null {
    return this.name;
  }

  /**
   * Marks the document dirty (a scene/camera mutation happened). No-op
   * while dirty tracking is suspended (document swap in flight) or on a
   * read-only document (its state is never "user's unsaved work").
   *
   * @returns whether the dirty flag actually flipped.
   */
  public markDirty(): boolean {
    if (this.dirtySuspended || this.readOnly || this.dirty) {
      return false;
    }
    this.dirty = true;
    this.emitChange();
    return true;
  }

  /**
   * Marks the document clean (a save or a fresh restore completed).
   *
   * @param path - the path the document now lives at (null keeps the
   *        current path; a value also refreshes the display name).
   */
  public markClean(path?: string | null): void {
    if (path !== undefined && path !== null) {
      this.path = path;
      this.name = baseNameOfPath(path);
    }
    this.readOnly = false;
    this.dirty = false;
    this.emitChange();
  }

  /**
   * Records a completed disk save: path/name refresh, clean flag, and the
   * persisted last-disk-save timestamp the startup recovery compares the
   * autosave slot against (R4.6).
   *
   * @param path - the absolute path the file was written to.
   * @param savedAt - epoch milliseconds of the completed save.
   */
  public noteDiskSave(path: string, savedAt: number): void {
    this.path = path;
    this.name = baseNameOfPath(path);
    this.readOnly = false;
    this.dirty = false;
    writeLastDiskSaveAt(savedAt);
    this.emitChange();
  }

  /**
   * @returns the persisted last-disk-save timestamp (null when the
   *          project was never saved to disk in this browser profile).
   */
  public lastDiskSaveAt(): number | null {
    return readLastDiskSaveAt();
  }

  /**
   * Opens a fresh untitled document (New Project): no path, clean, fully
   * editable, empty plugins section.
   */
  public openNew(): void {
    this.path = null;
    this.name = null;
    this.dirty = false;
    this.readOnly = false;
    this.plugins = {};
    this.emitChange();
  }

  /**
   * Marks the document as restored from a file on disk.
   *
   * @param path - the absolute path (null = an in-memory import without
   *        a path — e.g. the browser file picker; the document stays
   *        untitled but clean).
   * @param readOnly - whether the file must open read-only (R4.4a future
   *        versions refuse migrations AND re-saves).
   */
  public openedFromDisk(path: string | null, readOnly = false): void {
    this.path = path;
    this.name = path === null ? null : baseNameOfPath(path);
    this.dirty = false;
    this.readOnly = readOnly;
    if (path !== null && !readOnly) {
      // The file exists on disk at this exact state — the recovery
      // comparison baseline (a later autosave still wins).
      writeLastDiskSaveAt(Date.now());
    }
    this.emitChange();
  }

  /**
   * Sets the read-only flag (future-version files opened after the user
   * accepted the read-only offer, R4.4a).
   *
   * @param readOnly - the new flag value.
   */
  public setReadOnly(readOnly: boolean): void {
    if (this.readOnly === readOnly) {
      return;
    }
    this.readOnly = readOnly;
    if (readOnly) {
      this.dirty = false;
    }
    this.emitChange();
  }

  /**
   * Brackets a document swap: mutations between suspend and resume never
   * mark the document dirty (the restore itself is not a user edit).
   */
  public suspendDirtyTracking(): void {
    this.dirtySuspended = true;
  }

  /** Resumes dirty tracking after a document swap completed. */
  public resumeDirtyTracking(): void {
    this.dirtySuspended = false;
  }

  /**
   * Stores the document's plugins passthrough section (§1.7.4): the raw
   * object read from the file, written back verbatim on the next save —
   * the core never interprets it.
   *
   * @param plugins - the raw section (empty for fresh documents).
   */
  public setPlugins(plugins: Readonly<Record<string, unknown>>): void {
    this.plugins = plugins;
  }

  /**
   * @returns the current plugins passthrough section (never null —
   *          `{}` for fresh documents; R4.2: ALWAYS written).
   */
  public getPlugins(): Readonly<Record<string, unknown>> {
    return this.plugins;
  }

  /** Announces the current state on the bus (title bar re-render). */
  private emitChange(): void {
    this.bus.emit("project:document-changed", this.state());
  }
}
