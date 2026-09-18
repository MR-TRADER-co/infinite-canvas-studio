/**
 * Autosave service (R4.6): periodically flushes a dirty project to the
 * autosave slot — the `autosave.icb` file in the app-data directory on
 * the desktop shell (via {@link TauriAppDataStorage}), the localStorage
 * slot in the web shell. The payload carries the save timestamp in its
 * `meta.savedAt`, which the startup recovery flow compares against the
 * last disk save to decide whether to offer «بازیابی آخرین تغییرات؟».
 *
 * The service is the single writer of the slot: the composition root marks
 * it dirty on `scene:changed`/`camera:changed`, the 30-second interval (or
 * a tab-hide flush) triggers {@link AutosaveService.saveNow}, which
 * snapshots the scene, serialises it and writes it. Success and failure
 * are announced on the event bus so the status chip can react. Manual
 * Ctrl+S saves no longer flow through here — they save the FILE (see the
 * `core.file.*` commands); the slot is purely the crash-recovery twin.
 */
import type { EventBus } from "@/core/events/EventBus";
import type { AppEventMap, SaveReason } from "@/core/events/EventBus";
import type { ProjectData } from "@/persistence/ProjectFile";
import type { VersionedSerializer } from "@/persistence/VersionedSerializer";
import type { IProjectStorage } from "@/persistence/StorageBackend";

/** Dependencies of the autosave service. */
export interface AutosaveOptions {
  /** Serialiser producing the `.icb` payload. */
  readonly serializer: VersionedSerializer;
  /** Live snapshot provider (called at save time, never cached). */
  readonly getProjectData: () => ProjectData;
  /** Offline slot the payload is written to. */
  readonly storage: IProjectStorage;
  /** Bus receiving save-success/failure events. */
  readonly bus: EventBus<AppEventMap>;
}

/** Default autosave interval (R4.6: every 30 s while dirty). */
const DEFAULT_INTERVAL_MS = 30_000;

/** Saves the project automatically after periods of change. */
export class AutosaveService {
  private readonly options: AutosaveOptions;

  private dirty = false;

  private saving = false;

  private timerId: ReturnType<typeof setInterval> | null = null;

  /** Detacher of the window flush listeners (null until attached). */
  private detachFlush: (() => void) | null = null;

  /**
   * @param options - service dependencies (see {@link AutosaveOptions}).
   */
  public constructor(options: AutosaveOptions) {
    this.options = options;
  }

  /** Marks the project as changed since the last save. */
  public markDirty(): void {
    this.dirty = true;
  }

  /** @returns whether unsaved changes exist. */
  public isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Starts the periodic autosave timer. An already-running timer is stopped
   * first (idempotent restart).
   *
   * @param intervalMs - tick interval in milliseconds.
   */
  public start(intervalMs: number = DEFAULT_INTERVAL_MS): void {
    this.stop();
    this.timerId = setInterval(() => {
      if (this.dirty && !this.saving) {
        void this.saveNow("auto");
      }
    }, intervalMs);
  }

  /** Stops the timer and detaches the window flush listeners. */
  public stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.detachFlush !== null) {
      this.detachFlush();
      this.detachFlush = null;
    }
  }

  /**
   * Attaches best-effort flush listeners: a save when the tab becomes
   * hidden and on `beforeunload` (localStorage writes complete
   * synchronously, so the last changes survive a reload).
   *
   * @returns a detacher (also called by {@link AutosaveService.stop}).
   */
  public attachWindowFlush(): () => void {
    const flush = (): void => {
      if (this.dirty && !this.saving) {
        void this.saveNow("flush");
      }
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("beforeunload", flush);
    const detach = (): void => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("beforeunload", flush);
    };
    this.detachFlush = detach;
    return detach;
  }

  /**
   * Saves immediately, ignoring the timer. Reentrant calls are skipped
   * (the first writer wins; the interval retries on the next tick).
   *
   * @param reason - what triggered the save (interval, Ctrl+S, tab flush).
   * @returns whether the save succeeded.
   */
  public async saveNow(reason: SaveReason = "auto"): Promise<boolean> {
    if (this.saving) {
      return false;
    }
    this.saving = true;
    try {
      const payload = this.options.serializer.serialize(
        this.options.getProjectData(),
      );
      const ok = await this.options.storage.write(payload);
      if (ok) {
        this.dirty = false;
        this.options.bus.emit("persistence:saved", {
          timestamp: Date.now(),
          reason,
        });
      } else {
        this.options.bus.emit("persistence:save-failed", {
          reason: "storage write rejected",
        });
      }
      return ok;
    } catch (error) {
      this.options.bus.emit("persistence:save-failed", {
        reason: error instanceof Error ? error.message : "unknown save error",
      });
      return false;
    } finally {
      this.saving = false;
    }
  }

  /**
   * Removes the autosave slot entirely (new project). The scene is expected
   * to be cleared by the caller; the next change re-establishes the slot.
   *
   * @returns whether the slot was removed.
   */
  public async clearStorage(): Promise<boolean> {
    this.dirty = false;
    return this.options.storage.clear();
  }
}
