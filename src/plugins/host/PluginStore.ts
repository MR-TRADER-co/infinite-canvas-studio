/**
 * Plugin store (R9.5): the persisted world of installed plugins + the
 * uninstall archives.
 *
 * Storage layout (localStorage, app-data — never the project file):
 * - `plugins:installed:v1` — the installed records (manifest + entry
 *   source + dictionaries + icon + enabled flag);
 * - `plugins:archive:v1:<id>` — ONE restorable archive per plugin id
 *   (the record + the plugin's full storage snapshot; reinstalling the
 *   same id replaces the archive).
 *
 * Fail-closed reads: corrupt records/archives are DROPPED (never a
 * crash — the same contract as every persistence layer in the app).
 *
 * Layering: plain TypeScript — no React imports.
 */
import type { PluginManifest } from "@/plugins/manifest";
import type { PermissionId } from "@/plugins/host/PermissionEngine";
import type { OwnerDictionary } from "@/ui/i18n";
import { safeStorage, type StorageShim } from "@/plugins/host/PluginStorage";

/** One installed plugin's persisted record. */
export interface InstalledPluginRecord {
  readonly manifest: PluginManifest;
  /** The entry JS source (verbatim, captured at install). */
  readonly entrySource: string;
  /** The plugin's i18n dictionaries (fa/en). */
  readonly dictionaries: OwnerDictionary;
  /** The icon asset as a data URL (manager list; optional). */
  readonly iconDataUrl?: string;
  /** The CONSENTED permission subset (install dialog, R9.4). */
  readonly grantedPermissions: readonly PermissionId[];
  /** Whether the plugin boots with the app. */
  enabled: boolean;
  /** Install timestamp (epoch ms). */
  readonly installedAt: number;
}

/** One uninstall archive (R9.5 — restorable). */
export interface PluginArchive {
  readonly archiveId: string;
  readonly record: InstalledPluginRecord;
  /** The plugin's storage snapshot at uninstall time (AC9.7). */
  readonly storage: {
    kv: Record<string, unknown>;
    tables: Record<string, unknown[]>;
  };
  readonly archivedAt: number;
}

/** The installed-records slot. */
const INSTALLED_SLOT = "plugins:installed:v1";

/** The archive slot prefix. */
const ARCHIVE_PREFIX = "plugins:archive:v1:";

/**
 * The store.
 */
export class PluginStore {
  /**
   * @param storage - the persistence shim (tests inject a memory map).
   */
  public constructor(
    private readonly storage: StorageShim | null = safeStorage(),
  ) {}

  /**
   * @returns every installed record (install order).
   */
  public listRecords(): InstalledPluginRecord[] {
    const raw = this.storage?.getItem(INSTALLED_SLOT);
    if (raw === null || raw === undefined) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as InstalledPluginRecord[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(
        (record) =>
          record !== null &&
          typeof record === "object" &&
          record.manifest !== undefined &&
          typeof record.manifest.id === "string",
      );
    } catch {
      return [];
    }
  }

  /**
   * @param id - the plugin id.
   * @returns the record, or undefined.
   */
  public getRecord(id: string): InstalledPluginRecord | undefined {
    return this.listRecords().find((record) => record.manifest.id === id);
  }

  /**
   * Inserts or replaces one record (preserve install order on replace).
   *
   * @param record - the record.
   */
  public saveRecord(record: InstalledPluginRecord): void {
    const records = this.listRecords();
    const index = records.findIndex(
      (candidate) => candidate.manifest.id === record.manifest.id,
    );
    if (index >= 0) {
      records[index] = record;
    } else {
      records.push(record);
    }
    this.persist(records);
  }

  /**
   * @param id - the plugin id.
   * @param enabled - the new flag.
   */
  public setEnabled(id: string, enabled: boolean): void {
    const records = this.listRecords();
    const record = records.find((candidate) => candidate.manifest.id === id);
    if (record === undefined) {
      return;
    }
    record.enabled = enabled;
    this.persist(records);
  }

  /**
   * Removes one record (the uninstall path — AFTER archiving).
   *
   * @param id - the plugin id.
   */
  public removeRecord(id: string): void {
    const records = this.listRecords().filter(
      (record) => record.manifest.id !== id,
    );
    this.persist(records);
  }

  /**
   * Writes one archive (replacing the plugin's previous archive).
   *
   * @param archive - the archive.
   */
  public writeArchive(archive: PluginArchive): void {
    this.storage?.setItem(
      ARCHIVE_PREFIX + archive.record.manifest.id,
      JSON.stringify(archive),
    );
  }

  /**
   * @returns every archive (archived-at order, newest first).
   */
  public listArchives(): PluginArchive[] {
    if (this.storage === null) {
      return [];
    }
    const archives: PluginArchive[] = [];
    const keys: string[] = [];
    const enumerable = this.storage as StorageShim & {
      length?: number;
      key?: (index: number) => string | null;
    };
    if (
      typeof enumerable.length === "number" &&
      typeof enumerable.key === "function"
    ) {
      for (let index = 0; index < enumerable.length; index += 1) {
        const key = enumerable.key(index);
        if (key !== null && key.startsWith(ARCHIVE_PREFIX)) {
          keys.push(key);
        }
      }
    }
    for (const key of keys) {
      const raw = this.storage.getItem(key);
      if (raw === null) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as PluginArchive;
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          parsed.record?.manifest?.id !== undefined
        ) {
          archives.push(parsed);
        }
      } catch {
        // Corrupt archive — dropped.
      }
    }
    archives.sort((a, b) => b.archivedAt - a.archivedAt);
    return archives;
  }

  /**
   * @param pluginId - the plugin id.
   * @returns its archive, or undefined.
   */
  public readArchive(pluginId: string): PluginArchive | undefined {
    const raw = this.storage?.getItem(ARCHIVE_PREFIX + pluginId);
    if (raw === null || raw === undefined) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as PluginArchive;
      if (parsed?.record?.manifest?.id === pluginId) {
        return parsed;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * @param pluginId - the plugin id.
   */
  public removeArchive(pluginId: string): void {
    this.storage?.removeItem(ARCHIVE_PREFIX + pluginId);
  }

  /**
   * Persists the records.
   *
   * @param records - the records to write.
   */
  private persist(records: readonly InstalledPluginRecord[]): void {
    this.storage?.setItem(INSTALLED_SLOT, JSON.stringify(records));
  }
}

/**
 * A memory-backed storage shim (tests).
 *
 * @returns the shim.
 */
export function memoryStorage(): StorageShim & {
  length: number;
  key(index: number): string | null;
} {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    get length(): number {
      return map.size;
    },
    key(index: number): string | null {
      return [...map.keys()][index] ?? null;
    },
  };
}
