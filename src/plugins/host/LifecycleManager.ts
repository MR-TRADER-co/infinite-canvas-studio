/**
 * Plugin lifecycle manager (R9.5/R9.6): install (folder/zip/package),
 * enable/disable, uninstall-with-archive, restore — the single owner
 * of the live {@link PluginRuntime} map.
 *
 * Install-time pipeline (every failure Persian, R9.1/AC9.5/AC9.6):
 * manifest validation → dependency resolution → permission CONSENT
 * (the caller shows the dialog and passes the granted subset; a
 * rejected consent aborts) → record persisted → sandbox spawned →
 * runtime started (a crash lands in the manager's error surface,
 * AC9.3 — the app NEVER fails).
 *
 * Disable semantics (AC9.2): runtime.stop() unregisters every
 * contribution (commands, panels, settings sections, object types,
 * i18n namespace, event subscriptions); existing plugin objects stay
 * in the file verbatim — reloading materialises them as OpaqueObject
 * placeholders until the plugin returns.
 *
 * Uninstall semantics (AC9.7): disable + storage ARCHIVED (restorable)
 * + record removed; the project file's `plugins` section is never
 * touched.
 */
import { validateManifest, normaliseManifest } from "@/plugins/manifest";
import type { BridgeTransport } from "@/plugins/protocol";
import {
  PluginRuntime,
  type PluginRuntimeServices,
} from "@/plugins/host/PluginRuntime";
import { PluginStorage } from "@/plugins/host/PluginStorage";
import {
  PluginStore,
  type InstalledPluginRecord,
} from "@/plugins/host/PluginStore";
import type { PermissionId } from "@/plugins/host/PermissionEngine";
import type { OwnerDictionary } from "@/ui/i18n";
import { mergeNamespace } from "@/ui/i18n";
import type { AppEventMap } from "@/core/events/EventBus";

/** One install package (from a folder, a zip, or the in-repo sample). */
export interface PluginPackage {
  /** The parsed `manifest.json` value. */
  readonly manifestJson: unknown;
  /** The entry JS source text. */
  readonly entrySource: string;
  /** The plugin's dictionaries (fa/en). */
  readonly dictionaries: OwnerDictionary;
  /** The icon asset as a data URL (optional). */
  readonly iconDataUrl?: string;
}

/** The sandbox spawn contract (browser: iframe; tests: in-process). */
export interface SandboxSpawn {
  readonly transport: BridgeTransport;
  /** The iframe to mount (regions; null for headless/in-process). */
  readonly frame?: HTMLIFrameElement;
  dispose(): void;
}

/** The sandbox factory the manager delegates frame creation to. */
export type SandboxFactory = (
  record: InstalledPluginRecord,
  regionId: string | null,
) => SandboxSpawn;

/** Install outcome (Persian errors for the dialog). */
export interface InstallOutcome {
  readonly ok: boolean;
  /** Persian validation/consent errors (empty on success). */
  readonly errors: readonly string[];
  /** The installed plugin id on success. */
  readonly pluginId?: string;
}

/** The manager's list row (R9.6). */
export interface PluginStatusRow {
  readonly record: InstalledPluginRecord;
  readonly runtimeState: "off" | "starting" | "running" | "stopped" | "error";
  readonly runtimeError: string | null;
  readonly runtime: PluginRuntime | null;
}

/**
 * The lifecycle manager.
 */
export class LifecycleManager {
  private readonly runtimes = new Map<string, PluginRuntime>();
  private readonly sandboxen = new Map<string, SandboxSpawn>();

  /**
   * @param services - the runtime services (injected by App.ts).
   * @param sandboxFactory - the sandbox spawner (iframe or in-process).
   * @param store - the persistence (tests inject a memory-backed one).
   * @param eventBus - the app bus (plugins:changed refreshes the UI).
   */
  public constructor(
    private readonly services: PluginRuntimeServices,
    private readonly sandboxFactory: SandboxFactory,
    private readonly store: PluginStore = new PluginStore(),
    private readonly eventBus: {
      emit(
        event: "plugins:changed",
        payload: AppEventMap["plugins:changed"],
      ): void;
    },
  ) {}

  /**
   * Boots every ENABLED plugin (the app-start path).
   */
  public async bootEnabled(): Promise<void> {
    for (const record of this.store.listRecords()) {
      if (record.enabled) {
        await this.enable(record.manifest.id);
      }
    }
  }

  /**
   * Validates + installs one package (the consent must ALREADY be
   * granted — the dialog ran before; the granted subset is recorded).
   *
   * @param pkg - the package.
   * @param grantedPermissions - the consented permission subset.
   * @returns the outcome (Persian errors).
   */
  public async install(
    pkg: PluginPackage,
    grantedPermissions: readonly PermissionId[],
  ): Promise<InstallOutcome> {
    const records = this.store.listRecords();
    const context = {
      installedIds: records.map((record) => record.manifest.id),
      installedVersions: Object.fromEntries(
        records.map((record) => [record.manifest.id, record.manifest.version]),
      ),
    };
    const errors = validateManifest(pkg.manifestJson, context);
    if (errors.length > 0) {
      return { ok: false, errors: errors.map((error) => error.message) };
    }
    if (
      typeof pkg.entrySource !== "string" ||
      pkg.entrySource.trim().length === 0
    ) {
      return {
        ok: false,
        errors: ["فایل ورودی افزونه خالی است یا خوانده نشد."],
      };
    }
    const manifest = normaliseManifest(pkg.manifestJson);
    const granted = manifest.permissions.filter((permission) =>
      grantedPermissions.includes(permission),
    );
    if (granted.length < manifest.permissions.length) {
      return {
        ok: false,
        errors: [
          "رضایت مجوزها کامل نیست؛ نصب لغو شد. برای نصب باید همهٔ مجوزهای درخواستی را بپذیرید.",
        ],
      };
    }
    const record: InstalledPluginRecord = {
      manifest,
      entrySource: pkg.entrySource,
      dictionaries: pkg.dictionaries ?? {},
      iconDataUrl: pkg.iconDataUrl,
      grantedPermissions: granted,
      enabled: false,
      installedAt: Date.now(),
    };
    this.store.saveRecord(record);
    this.emitChange(manifest.id, "install");
    await this.enable(manifest.id);
    return { ok: true, errors: [], pluginId: manifest.id };
  }

  /**
   * Removes every object-link the plugin owns (pack-14 AC14.6: the
   * dailies stay as normal text objects; links owned by the plugin
   * vanish with its runtime — the host lifecycle owns the cleanup).
   *
   * @param id - the plugin id.
   */
  private removeOwnedLinks(id: string): void {
    const registry = this.services.links;
    if (registry === undefined) {
      return;
    }
    const doomed = registry.list().filter((entry) => entry.ownerId === id);
    for (const entry of doomed) {
      registry.remove(entry.id);
    }
  }

  /**
   * Enables one plugin (spawn sandbox + start runtime + merge i18n).
   *
   * @param id - the plugin id.
   */
  public async enable(id: string): Promise<void> {
    const record = this.store.getRecord(id);
    if (record === undefined || this.runtimes.has(id)) {
      return;
    }
    this.store.setEnabled(id, true);
    const spawn = this.sandboxFactory(record, null);
    this.sandboxen.set(id, spawn);
    const runtime = new PluginRuntime(
      record.manifest,
      spawn.transport,
      this.services,
    );
    this.runtimes.set(id, runtime);
    mergeNamespace(id, record.dictionaries);
    await runtime.start();
    if (runtime.runtimeState === "error") {
      this.emitChange(id, "error");
      return;
    }
    this.emitChange(id, "enable");
  }

  /**
   * Disables one plugin (unregister everything, keep the record).
   *
   * @param id - the plugin id.
   */
  public disable(id: string): void {
    const runtime = this.runtimes.get(id);
    if (runtime !== undefined) {
      runtime.stop();
      this.runtimes.delete(id);
    }
    this.removeOwnedLinks(id);
    this.sandboxen.get(id)?.dispose();
    this.sandboxen.delete(id);
    this.store.setEnabled(id, false);
    this.emitChange(id, "disable");
  }

  /**
   * Uninstalls one plugin (disable + archive storage + remove record).
   * The project file's plugin section is NEVER touched (AC9.7).
   *
   * @param id - the plugin id.
   * @param archive - whether to write the restorable archive.
   */
  public uninstall(id: string, archive: boolean): void {
    const record = this.store.getRecord(id);
    if (record === undefined) {
      return;
    }
    const runtime = this.runtimes.get(id);
    if (runtime !== undefined) {
      runtime.stop();
      this.runtimes.delete(id);
    }
    this.removeOwnedLinks(id);
    this.sandboxen.get(id)?.dispose();
    this.sandboxen.delete(id);
    if (archive) {
      const storage =
        this.services.storageFactory?.(id) ?? new PluginStorage(id);
      const snapshot = storage.exportAll();
      this.store.writeArchive({
        archiveId: `archive:${id}:${Date.now()}`,
        record: { ...record, enabled: false },
        storage: snapshot,
        archivedAt: Date.now(),
      });
    }
    this.store.removeRecord(id);
    this.emitChange(id, "uninstall");
  }

  /**
   * Reinstalls from the archive + restores the plugin's storage
   * (AC9.7: the data returns exactly).
   *
   * @param id - the archived plugin id.
   * @returns whether the restore succeeded.
   */
  public async restore(id: string): Promise<boolean> {
    const archive = this.store.readArchive(id);
    if (archive === undefined) {
      return false;
    }
    const outcome = await this.install(
      {
        manifestJson: archive.record.manifest,
        entrySource: archive.record.entrySource,
        dictionaries: archive.record.dictionaries,
        iconDataUrl: archive.record.iconDataUrl,
      },
      archive.record.grantedPermissions,
    );
    if (!outcome.ok) {
      return false;
    }
    const storage = this.services.storageFactory?.(id) ?? new PluginStorage(id);
    storage.importAll(archive.storage);
    this.emitChange(id, "restore");
    return true;
  }

  /**
   * @param id - the plugin id.
   * @returns the live runtime (regions, inserts), or undefined.
   */
  public getRuntime(id: string): PluginRuntime | undefined {
    return this.runtimes.get(id);
  }

  /**
   * @returns every installed plugin's status row (the manager panel).
   */
  public listStatus(): PluginStatusRow[] {
    return this.store.listRecords().map((record) => {
      const runtime = this.runtimes.get(record.manifest.id);
      return {
        record,
        runtimeState: runtime?.runtimeState ?? "off",
        runtimeError: runtime?.runtimeError ?? null,
        runtime: runtime ?? null,
      };
    });
  }

  /**
   * @returns the store (archive listing for the panel).
   */
  public get pluginStore(): PluginStore {
    return this.store;
  }

  /**
   * Finds the runtime owning a wire type id (the insert path).
   *
   * @param typeId - the full type id.
   * @returns the owning runtime, or undefined.
   */
  public runtimeForTypeId(typeId: string): PluginRuntime | undefined {
    const owner = typeId.split(".")[0] ?? "";
    return this.runtimes.get(owner);
  }

  /**
   * Attaches a UI region transport to the owning runtime.
   *
   * @param pluginId - the plugin id.
   * @param regionId - the region id.
   * @param transport - the region's transport.
   * @returns whether a live runtime accepted it.
   */
  public attachRegion(
    pluginId: string,
    regionId: string,
    transport: BridgeTransport,
  ): boolean {
    const runtime = this.runtimes.get(pluginId);
    if (runtime === undefined || runtime.runtimeState !== "running") {
      return false;
    }
    runtime.attachRegion(regionId, transport);
    return true;
  }

  /**
   * Spawns a region sandbox through the factory (browser: the iframe).
   *
   * @param pluginId - the plugin id.
   * @param regionId - the region id.
   * @returns the spawn (transport + frame), or undefined when the
   *          plugin is not running.
   */
  public spawnRegion(
    pluginId: string,
    regionId: string,
  ): SandboxSpawn | undefined {
    const record = this.store.getRecord(pluginId);
    const runtime = this.runtimes.get(pluginId);
    if (record === undefined || runtime?.runtimeState !== "running") {
      return undefined;
    }
    return this.sandboxFactory(record, regionId);
  }

  /**
   * Shuts every plugin down (app teardown).
   */
  public shutdown(): void {
    for (const id of [...this.runtimes.keys()]) {
      this.disable(id);
    }
  }

  /**
   * Emits the UI refresh event.
   */
  private emitChange(
    pluginId: string,
    reason: AppEventMap["plugins:changed"]["reason"],
  ): void {
    this.eventBus.emit("plugins:changed", { pluginId, reason });
  }
}
