/**
 * The per-plugin host runtime (R9.2/R9.3): one instance per ENABLED
 * plugin.
 *
 * Responsibilities:
 * - the SDK method surface — every `app.*` RPC the plugin issues is
 *   served HERE (permission-checked by the PermissionEngine first,
 *   fail-closed);
 * - contribution bookkeeping — every command/object-type/panel/
 *   settings-section/event-subscription the plugin registers is
 *   remembered so {@link stop} can unregister them wholesale (§1.7.5,
 *   R9.5/AC9.2);
 * - object factories — the async RPC round-trip behind plugin widget
 *   insertion (2 s timeout, Persian error toast, NO partial object —
 *   R9.9/AC9.10);
 * - widget snapshots — `renderWidgetHtml` fetches the plugin's HTML for
 *   the object layer (once per data revision; the catalog NEVER calls
 *   it — AC9.10);
 * - UI regions — panel bodies and settings sections attach their own
 *   transports (each region speaks the same SDK minus registrations);
 * - the bridge log — every host→plugin message is recorded (capped);
 *   the AC9.10 test asserts the catalog render/scroll sends ZERO.
 *
 * A plugin crash NEVER escapes: `start()` failures land in
 * {@link lastError} and the app keeps running (AC9.3).
 *
 * Layering: plain TypeScript + injected registrars — no React imports.
 */
import {
  RpcPeer,
  BridgeRpcError,
  isBridgeMessage,
  type BridgeTransport,
  type BridgeMessage,
  type RpcMethodHandler,
} from "@/plugins/protocol";
import type { PluginManifest } from "@/plugins/manifest";
import { sdkRangeSupportedMajors } from "@/plugins/manifest";
import {
  PermissionEngine,
  type PermissionId,
} from "@/plugins/host/PermissionEngine";
import { PluginStorage, type SqlStatement } from "@/plugins/host/PluginStorage";
import {
  makePluginObject,
  isPluginObject,
  type PluginObjectData,
} from "@/core/model/PluginObject";
import {
  textBoxFromRect,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING_Y,
} from "@/core/model/TextBoxObject";
import {
  makeFrameObject,
  isFrameObject,
  type FrameLayout,
} from "@/core/model/FrameObject";
import { normalizeProperties } from "@/core/model/Properties";
import { objectTitleOf } from "@/core/knowledge/KnowledgeIndex";
import type {
  LinkRegistry,
  ObjectLinkEntry,
} from "@/core/knowledge/LinkRegistry";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { Selection } from "@/core/selection/Selection";
import type { CommandContext } from "@/core/registry/CommandRegistry";
import type { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import type { AppEventMap } from "@/core/events/EventBus";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import { RemoveObjectCommand } from "@/core/commands/RemoveObjectCommand";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import {
  addManualLinkCommand,
  removeManualLinkCommand,
} from "@/core/commands/LinkCommands";
import { mergeNamespace, removeOwnerNamespace } from "@/ui/i18n";
import type { DataHub } from "@/datahub/DataHub";

/**
 * App events a plugin may subscribe to (R9.3 allowlist — conservative:
 * domain signals only, never UI-internal dialog events).
 */
export const PLUGIN_EVENT_ALLOWLIST: readonly string[] = [
  "app:started",
  "ui:language-changed",
  "ui:theme-changed",
  "camera:changed",
  "scene:changed",
  "selection:changed",
  "history:changed",
  "project:document-changed",
  "bookmarks:changed",
  "persistence:saved",
  // Pack R11.10: the knowledge-surface events — manual/plugin link
  // mutations + dangling resolutions, and structured property edits.
  "object:linking-changed",
  "object:properties-changed",
];

/** Injection surface the composition root provides (App.ts). */
export interface PluginRuntimeServices {
  readonly scene: Scene;
  readonly history: HistoryManager;
  readonly selection: Selection;
  readonly objectRegistry: ObjectRegistry;
  /** The app event bus (allowlist-filtered forwarding to plugins). */
  readonly eventBus: {
    on(
      event: keyof AppEventMap,
      handler: (payload: unknown) => void,
    ): () => void;
  };
  /** Registers/unregisters commands (CommandRegistry adapter). */
  readonly registerCommand: (entry: {
    id: string;
    titleKey: string;
    icon?: string;
    shortcut?: string;
    group: string;
    order: number;
    execute: (ctx: CommandContext) => void;
  }) => void;
  readonly unregisterCommand: (id: string) => void;
  /** Registers/unregisters a dock panel (PanelRegistry adapter). */
  readonly registerPanel: (entry: {
    id: string;
    titleKey: string;
    icon?: string;
    component: unknown;
    placement: "left" | "right" | "bottom";
    order: number;
  }) => void;
  readonly unregisterPanel: (id: string) => void;
  /** Registers/unregisters a settings section (registry adapter). */
  readonly registerSettingsSection: (entry: {
    id: string;
    titleKey: string;
    order: number;
    component: unknown;
  }) => void;
  readonly unregisterSettingsSection: (id: string) => void;
  /**
   * Builds the opaque React component for a plugin region (the
   * composition root binds this to the sandboxed PluginRegionFrame).
   */
  readonly regionFrame: (
    pluginId: string,
    regionId: string,
    titleKey?: string,
  ) => unknown;
  /** The project document's passthrough `plugins` section. */
  readonly projectPlugins: {
    get(): Readonly<Record<string, unknown>>;
    set(plugins: Readonly<Record<string, unknown>>): void;
  };
  /** Object id allocator for plugin-created objects. */
  readonly nextObjectId: () => string;
  /** Executes ANY registered command through the dispatcher. */
  readonly executeCommand: (commandId: string) => void;
  /** The current viewport centre in world coordinates. */
  readonly viewportCentre: () => { x: number; y: number };
  /** Persian error-toast sink (the 2 s factory timeout path). */
  readonly notifyError: (message: string) => void;
  /** Diagnostics sink. */
  readonly logger: Pick<Console, "warn" | "error" | "info">;
  /** Storage factory (tests inject a memory-backed shim). */
  readonly storageFactory?: (pluginId: string) => PluginStorage;
  /** The Data Hub (Phase 10; absent in pre-datahub tests → typed errors). */
  readonly dataHub?: DataHub;
  /**
   * The object-link registry (pack-14 `app.scene` seam; absent in
   * older tests → the scene surface answers typed errors).
   */
  readonly links?: LinkRegistry;
  /** Camera flight onto one object (pack-14 `app.scene.focusObject`). */
  readonly flyToObject?: (objectId: string) => void;
  /** Persian info-toast sink (pack-14 `app.scene.notifyInfo`). */
  readonly notifyInfo?: (message: string) => void;
}

/** Runtime lifecycle state. */
export type PluginRuntimeState = "starting" | "running" | "stopped" | "error";

/** One bridge-log record (AC9.10 — outgoing traffic only). */
export interface BridgeLogEntry {
  readonly at: number;
  readonly method: string;
}

/** The async factory timeout (R9.9: 2 s + Persian error toast). */
export const PLUGIN_FACTORY_TIMEOUT_MS = 2_000;

/** The data-hub provider call timeout (R10.1 — queries may be heavier). */
export const DATAHUB_QUERY_TIMEOUT_MS = 4_000;

/** The maximum network body size a plugin may POST (bytes). */
const NETWORK_BODY_CAP = 512 * 1024;

/** HTTP methods a plugin's fetch may use. */
const NETWORK_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/** The handshake timeout (a dead sandbox never hangs the boot). */
const READY_TIMEOUT_MS = 8_000;

/** Bridge-log cap (diagnostics, never unbounded). */
const BRIDGE_LOG_CAP = 256;

/**
 * One plugin's live runtime.
 */
export class PluginRuntime {
  private peer: RpcPeer | null = null;
  private state: PluginRuntimeState = "starting";
  private lastError: string | null = null;
  private permissionEngine: PermissionEngine;
  private storage: PluginStorage;

  /** Contribution bookkeeping (wholesale unregister on stop, §1.7.5). */
  private readonly registeredCommandIds = new Set<string>();
  private readonly registeredTypeIds = new Set<string>();
  private readonly registeredPanelIds = new Set<string>();
  private readonly registeredSectionIds = new Set<string>();
  private readonly eventUnsubscribers = new Map<number, () => void>();
  private eventSubscriptionSeq = 0;

  /** Data-hub bookkeeping (R10.1: contracts resolve only while enabled). */
  private readonly registeredContractIds = new Set<string>();
  private readonly hubSubscriptions = new Map<
    number,
    { contractId: string; unsubscribe: () => void; peer: RpcPeer }
  >();
  private hubSubscriptionSeq = 0;

  /** Declared object registrations (sizes for factory envelopes). */
  private readonly objectDeclarations = new Map<
    string,
    { width: number; height: number }
  >();

  /** Region peers (panel bodies / settings sections). */
  private readonly regionPeers = new Map<string, RpcPeer>();

  /** The bridge log (outgoing host→plugin traffic, capped). */
  private readonly bridgeLog: BridgeLogEntry[] = [];

  /**
   * @param manifest - the validated manifest.
   * @param transport - the raw sandbox transport (in-process in tests).
   * @param services - the composition root's injection surface.
   */
  public constructor(
    public readonly manifest: PluginManifest,
    private readonly transport: BridgeTransport,
    private readonly services: PluginRuntimeServices,
  ) {
    this.permissionEngine = new PermissionEngine(manifest.permissions);
    this.storage =
      services.storageFactory?.(manifest.id) ?? new PluginStorage(manifest.id);
  }

  /**
   * Boots the sandbox: hello → wait `ready` → serve SDK calls.
   * A crash/failure lands in {@link lastError} — the app NEVER fails
   * with it (AC9.3).
   */
  public async start(): Promise<void> {
    const negotiated = this.negotiateSdkMajor();
    if (negotiated === null) {
      this.fail(
        `افزونهٔ «${this.manifest.name}» با نسخهٔ SDK برنامه سازگار نیست.`,
      );
      return;
    }
    try {
      const hello: BridgeMessage = {
        v: 1,
        kind: "hello",
        pluginId: this.manifest.id,
        sdkMajor: negotiated,
        regionId: null,
        host: "infinite-canvas-studio",
      };
      this.transport.post(hello);
      await this.waitForReady();
      this.peer = new RpcPeer(this.transport, `host:${this.manifest.id}`);
      // AC9.3: a sandbox crash (the bootstrap's try/catch posts this
      // event) lands in the error surface — the app keeps running.
      this.peer.on("plugin.crashed", (payload) => {
        const message = payload as { message?: string };
        this.fail(
          `افزونهٔ «${this.manifest.name}» دچار خطا شد: ${
            message.message ?? "خطای ناشناخته"
          }`,
        );
      });
      this.serveSdkMethods(this.peer, { allowRegistrations: true });
      this.state = "running";
    } catch (error) {
      this.fail(
        `افزونهٔ «${this.manifest.name}» راه‌اندازی نشد: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Unregisters EVERY contribution + tears the bridge down (R9.5).
   * Existing plugin objects stay in the scene file verbatim (they
   * reload as opaque placeholders until the plugin returns, §1.7.4).
   */
  public stop(): void {
    if (this.state === "stopped") {
      return;
    }
    // Pack-14 AC14.6: links owned by this plugin vanish with its
    // runtime (the dailies stay as normal text objects) — the runtime
    // itself owns the cleanup so BOTH stop paths (direct + through
    // the manager) behave identically.
    if (this.services.links !== undefined) {
      const doomed = this.services.links
        .list()
        .filter((entry) => entry.ownerId === this.manifest.id);
      for (const entry of doomed) {
        this.services.links.remove(entry.id);
      }
    }
    for (const id of this.registeredCommandIds) {
      this.services.unregisterCommand(id);
    }
    this.registeredCommandIds.clear();
    for (const id of this.registeredTypeIds) {
      this.services.objectRegistry.unregister(id);
    }
    this.registeredTypeIds.clear();
    for (const id of this.registeredPanelIds) {
      this.services.unregisterPanel(id);
    }
    this.registeredPanelIds.clear();
    for (const id of this.registeredSectionIds) {
      this.services.unregisterSettingsSection(id);
    }
    this.registeredSectionIds.clear();
    for (const unsubscribe of this.eventUnsubscribers.values()) {
      unsubscribe();
    }
    this.eventUnsubscribers.clear();
    // R10.1: contracts resolve only from ENABLED plugins — the hub
    // forgets this owner's providers + subscriptions wholesale.
    if (this.services.dataHub !== undefined) {
      this.services.dataHub.unregisterOwner(this.manifest.id);
    }
    for (const subscription of this.hubSubscriptions.values()) {
      subscription.unsubscribe();
    }
    this.hubSubscriptions.clear();
    this.registeredContractIds.clear();
    removeOwnerNamespace(this.manifest.id);
    for (const peer of this.regionPeers.values()) {
      peer.teardown();
    }
    this.regionPeers.clear();
    this.peer?.teardown();
    this.peer = null;
    this.state = "stopped";
  }

  /**
   * @returns the runtime state (the manager's list badge).
   */
  public get runtimeState(): PluginRuntimeState {
    return this.state;
  }

  /**
   * @returns the Persian failure message (AC9.3's manager surface).
   */
  public get runtimeError(): string | null {
    return this.lastError;
  }

  /**
   * @returns the granted permission set (the manager's chips).
   */
  public get permissions(): readonly PermissionId[] {
    return this.permissionEngine.list();
  }

  /**
   * @returns the live bridge log (outgoing host→plugin traffic).
   */
  public get outgoingBridgeLog(): readonly BridgeLogEntry[] {
    return this.bridgeLog;
  }

  /**
   * @returns the plugin's storage (the archive path).
   */
  public get pluginStorage(): PluginStorage {
    return this.storage;
  }

  /**
   * Inserts one plugin widget with its centre at a world point (the
   * R9.9 async factory path). A dead/slow plugin produces the Persian
   * error toast and NOTHING else — no partial object (AC9.10).
   *
   * @param typeId - the full type id (`<pluginId>.<localId>`).
   * @param centre - the world point to centre on.
   * @returns the created object, or null on failure.
   */
  public async insertObjectAt(
    typeId: string,
    centre: { x: number; y: number },
  ): Promise<PluginObjectData | null> {
    if (!this.registeredTypeIds.has(typeId)) {
      return null;
    }
    const localId = typeId.slice(this.manifest.id.length + 1);
    const declared = this.objectDeclarations.get(typeId) ?? {
      width: 160,
      height: 120,
    };
    try {
      const data = (await this.callPlugin(
        "app.objects.__serve",
        { op: "factory", typeId: localId, point: centre },
        PLUGIN_FACTORY_TIMEOUT_MS,
      )) as Record<string, unknown> | null;
      if (data === null || typeof data !== "object") {
        throw new BridgeRpcError("bad-params", "bad factory payload");
      }
      const object = makePluginObject(
        this.services.nextObjectId(),
        this.services.scene.nextZIndex(),
        typeId,
        data,
        {
          x: centre.x - declared.width / 2,
          y: centre.y - declared.height / 2,
        },
        declared,
      );
      const command = new AddObjectCommand(this.services.scene, object);
      command.do();
      this.services.history.push(command);
      return object;
    } catch (error) {
      const isTimeout =
        error instanceof BridgeRpcError && error.code === "timeout";
      this.services.notifyError(
        isTimeout
          ? `افزونهٔ «${this.manifest.name}» پاسخ نداد؛ شیء ساخته نشد.`
          : `ساخت شیء با افزونهٔ «${this.manifest.name}» ممکن نشد.`,
      );
      this.services.logger.error(
        `[plugins] factory failed for ${typeId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Serves one data-hub query INTO the plugin sandbox (R10.1 — the
   * provider side of its registered contract). The hub routes here
   * through the closure captured at `provide` time.
   *
   * @param method - the contract method.
   * @param params - the method parameters.
   * @returns the provider's result.
   * @throws BridgeRpcError on timeout/death (the hub degrades).
   */
  public async serveDatahubQuery(
    method: string,
    params: unknown,
  ): Promise<unknown> {
    if (this.peer === null || this.state !== "running") {
      throw new BridgeRpcError("plugin-dead", "plugin not running");
    }
    return this.callPlugin(
      "app.datahub.__serve",
      { op: "query", method, params },
      DATAHUB_QUERY_TIMEOUT_MS,
    );
  }

  /**
   * Fetches the widget's HTML snapshot (the object layer's paint
   * source — once per data revision; AC9.10's catalog-safety property
   * holds because the CATALOG never calls this).
   *
   * @param typeId - the full type id.
   * @param data - the object's verbatim plugin payload.
   * @param size - the widget's world-unit size.
   * @returns the HTML string (empty when the plugin has no renderer or
   *          the call fails — the object still renders its fallback).
   */
  public async renderWidgetHtml(
    typeId: string,
    data: Record<string, unknown>,
    size: { width: number; height: number },
  ): Promise<string> {
    if (!this.registeredTypeIds.has(typeId)) {
      return "";
    }
    const localId = typeId.slice(this.manifest.id.length + 1);
    try {
      const html = await this.callPlugin(
        "app.objects.__serve",
        {
          op: "render",
          typeId: localId,
          data,
          width: size.width,
          height: size.height,
        },
        PLUGIN_FACTORY_TIMEOUT_MS,
      );
      return typeof html === "string" ? html : "";
    } catch {
      return "";
    }
  }

  /**
   * Whether this runtime owns the given wire type id.
   *
   * @param typeId - the candidate.
   * @returns ownership.
   */
  public ownsTypeId(typeId: string): boolean {
    return typeId.startsWith(`${this.manifest.id}.`);
  }

  /**
   * Attaches a UI region (panel body / settings section): the region's
   * transport speaks the SAME SDK minus registrations.
   *
   * @param regionId - the region identifier (`panel:<id>`/`settings:<id>`).
   * @param transport - the region's bridge transport.
   */
  public attachRegion(regionId: string, transport: BridgeTransport): void {
    const peer = new RpcPeer(transport, `host-region:${regionId}`);
    this.serveSdkMethods(peer, { allowRegistrations: false });
    this.regionPeers.set(regionId, peer);
  }

  /**
   * Detaches one region (its iframe unmounted).
   *
   * @param regionId - the region identifier.
   */
  public detachRegion(regionId: string): void {
    const peer = this.regionPeers.get(regionId);
    if (peer !== undefined) {
      peer.teardown();
      this.regionPeers.delete(regionId);
    }
  }

  /**
   * Calls INTO the plugin with a timeout (the factory/render guard).
   *
   * @param method - the bridge method.
   * @param params - the parameters.
   * @param timeoutMs - the guard window.
   * @returns the plugin's result.
   */
  private async callPlugin(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.peer === null || this.state !== "running") {
      throw new BridgeRpcError("plugin-dead", "plugin not running");
    }
    this.bridgeLog.push({ at: Date.now(), method });
    if (this.bridgeLog.length > BRIDGE_LOG_CAP) {
      this.bridgeLog.shift();
    }
    const call = this.peer.call(method, params);
    const timer = new Promise<never>((_resolve, reject) => {
      const handle = setTimeout(() => {
        reject(new BridgeRpcError("timeout", `${method} timed out`));
      }, timeoutMs);
      // Keep the Node test loop snappy.
      if (typeof handle === "object" && "unref" in handle) {
        (handle as { unref(): void }).unref();
      }
    });
    return Promise.race([call, timer]);
  }

  /**
   * Serves the SDK surface on one peer.
   *
   * @param peer - the peer (main sandbox or a region).
   * @param options - whether registrations are accepted (main only).
   */
  private serveSdkMethods(
    peer: RpcPeer,
    options: { allowRegistrations: boolean },
  ): void {
    const prefix = this.manifest.id;

    // R9.4 runtime enforcement: EVERY SDK method is permission-checked
    // before dispatch (fail-closed typed errors, AC9.4).
    const handle = (method: string, handler: RpcMethodHandler): void => {
      peer.handle(method, (params: unknown) => {
        const verdict = this.permissionEngine.checkMethod(method);
        if (verdict !== null) {
          throw new BridgeRpcError(verdict.code, verdict.message);
        }
        return handler(params);
      });
    };

    // ---- commands ----
    handle("app.commands.register", (params) => {
      if (!options.allowRegistrations) {
        throw new BridgeRpcError(
          "permission-denied",
          "ثبت فرمان فقط در sandbox اصلی افزونه مجاز است.",
        );
      }
      const request = params as {
        id: string;
        titleKey: string;
        icon?: string;
        shortcut?: string;
      };
      const fullId = `${prefix}.${request.id}`;
      this.services.registerCommand({
        id: fullId,
        titleKey: request.titleKey,
        icon: request.icon,
        shortcut: request.shortcut,
        group: "tools",
        order: 500,
        execute: () => {
          peer.emit("plugin.command.invoke", { commandId: request.id });
        },
      });
      this.registeredCommandIds.add(fullId);
      return fullId;
    });
    handle("app.commands.execute", (params) => {
      const request = params as { commandId: string };
      this.services.executeCommand(request.commandId);
      return null;
    });

    // ---- objects ----
    handle("app.objects.register", (params) => {
      if (!options.allowRegistrations) {
        throw new BridgeRpcError(
          "permission-denied",
          "ثبت نوع شیء فقط در sandbox اصلی افزونه مجاز است.",
        );
      }
      const request = params as {
        id: string;
        titleKey: string;
        group?: string;
        order?: number;
        icon?: string;
        preview?: string;
        width?: number;
        height?: number;
      };
      const typeId = `${prefix}.${request.id}`;
      const width =
        typeof request.width === "number" && request.width > 0
          ? request.width
          : 160;
      const height =
        typeof request.height === "number" && request.height > 0
          ? request.height
          : 120;
      const group = request.group ?? `${prefix}:group`;
      this.services.objectRegistry.register({
        id: typeId,
        kind: typeId,
        titleKey: request.titleKey,
        version: 1,
        factory: () =>
          makePluginObject(
            "plugin-factory-pending",
            0,
            typeId,
            {},
            { x: 0, y: 0 },
            { width, height },
          ),
        serialize: (object) => ({
          id: object.id,
          typeId,
          typeVersion: 1,
          kind: "plugin",
          ...(object.name !== undefined ? { name: object.name } : {}),
          ...(object.parentId !== undefined
            ? { parentId: object.parentId }
            : {}),
          position: { x: object.position.x, y: object.position.y },
          rotation: object.rotation,
          zIndex: object.zIndex,
          visible: object.visible,
          locked: object.locked,
          width,
          height,
          data: (object as PluginObjectData).data,
        }),
        deserialize: (raw) => {
          const id = typeof raw.id === "string" ? raw.id : null;
          const data =
            typeof raw.data === "object" && raw.data !== null
              ? (raw.data as Record<string, unknown>)
              : null;
          if (id === null || data === null) {
            return null;
          }
          const position =
            typeof raw.position === "object" && raw.position !== null
              ? (raw.position as { x?: unknown; y?: unknown })
              : {};
          return makePluginObject(
            id,
            typeof raw.zIndex === "number" ? raw.zIndex : 0,
            typeId,
            data,
            {
              x: typeof position.x === "number" ? position.x : 0,
              y: typeof position.y === "number" ? position.y : 0,
            },
            {
              width: typeof raw.width === "number" ? raw.width : width,
              height: typeof raw.height === "number" ? raw.height : height,
            },
          );
        },
        catalog: {
          icon: request.icon,
          titleKey: request.titleKey,
          group,
          order: request.order ?? 900,
          preview: request.preview,
        },
      });
      this.registeredTypeIds.add(typeId);
      this.objectDeclarations.set(typeId, { width, height });
      return typeId;
    });
    handle("app.objects.create", async (params) => {
      const request = params as {
        typeId: string;
        point?: { x: number; y: number } | null;
      };
      const centre = request.point ?? this.services.viewportCentre();
      const object = await this.insertObjectAt(
        `${prefix}.${request.typeId}`,
        centre,
      );
      return object === null ? null : this.toJsonish(object);
    });
    handle("app.objects.get", (params) => {
      const request = params as { objectId: string };
      const object = this.services.scene.findById(request.objectId);
      if (object === undefined) {
        return null;
      }
      return this.toJsonish(object);
    });
    handle("app.objects.list", () => {
      return this.services.scene.objects.map((object) =>
        this.toJsonish(object),
      );
    });
    handle("app.objects.update", (params) => {
      const request = params as {
        objectId: string;
        dataPatch: Record<string, unknown>;
      };
      const object = this.services.scene.findById(request.objectId);
      if (
        object === undefined ||
        !isPluginObject(object) ||
        !this.ownsTypeId(object.typeId)
      ) {
        return false;
      }
      const patch = { data: { ...object.data, ...request.dataPatch } };
      const command = new UpdateObjectCommand(
        this.services.scene,
        object.id,
        patch,
        object,
      );
      command.do();
      this.services.history.push(command);
      return true;
    });
    handle("app.objects.remove", (params) => {
      const request = params as { objectId: string };
      const object = this.services.scene.findById(request.objectId);
      if (
        object === undefined ||
        !isPluginObject(object) ||
        !this.ownsTypeId(object.typeId)
      ) {
        return false;
      }
      const command = new RemoveObjectCommand(this.services.scene, object);
      command.do();
      this.services.history.push(command);
      return true;
    });

    // ---- scene (permission: scene — pack-14 R14.1) ----
    // A tightly-validated CORE-object surface: real text boxes, real
    // auto-layout frames, plugin-owned links, read-only link queries,
    // camera flights and info toasts. Every mutation crosses as ONE
    // undo step; every payload is validated fail-closed so a buggy
    // plugin can never corrupt the scene graph.
    handle("app.scene.insertText", (params) => {
      const scene = this.services.scene;
      const request = params as {
        text?: unknown;
        width?: unknown;
        fontSize?: unknown;
        position?: { x?: unknown; y?: unknown } | null;
        props?: Record<string, unknown> | null;
        select?: unknown;
      };
      const text =
        typeof request.text === "string"
          ? request.text.replace(/\r/g, "").slice(0, 8000)
          : "";
      const width =
        typeof request.width === "number" && Number.isFinite(request.width)
          ? Math.min(Math.max(request.width, 40), 2000)
          : 300;
      const fontSize =
        typeof request.fontSize === "number" && Number.isFinite(request.fontSize)
          ? Math.min(Math.max(request.fontSize, 8), 96)
          : 16;
      const rawPosition =
        typeof request.position === "object" && request.position !== null
          ? request.position
          : null;
      const position =
        rawPosition !== null &&
        typeof rawPosition.x === "number" &&
        Number.isFinite(rawPosition.x) &&
        typeof rawPosition.y === "number" &&
        Number.isFinite(rawPosition.y)
          ? { x: rawPosition.x, y: rawPosition.y }
          : this.services.viewportCentre();
      const lines = text.length === 0 ? 1 : text.split("\n").length;
      const height =
        lines * fontSize * TEXT_LINE_HEIGHT + 2 * TEXT_PADDING_Y + 8;
      const properties = normalizeProperties(request.props ?? undefined);
      const object = textBoxFromRect(
        {
          minX: position.x - width / 2,
          minY: position.y - height / 2,
          maxX: position.x + width / 2,
          maxY: position.y + height / 2,
        },
        text,
        fontSize,
        this.services.nextObjectId(),
        scene.nextZIndex(),
        "fixed",
      );
      const withObject =
        properties === undefined ? object : { ...object, properties };
      const command = new AddObjectCommand(scene, withObject);
      command.do();
      this.services.history.push(command);
      if (request.select !== false) {
        this.services.selection.replaceAll([withObject.id]);
      }
      return { objectId: withObject.id };
    });
    handle("app.scene.insertFrame", (params) => {
      const scene = this.services.scene;
      const request = params as {
        title?: unknown;
        width?: unknown;
        height?: unknown;
        position?: { x?: unknown; y?: unknown } | null;
        layout?: Record<string, unknown> | null;
        props?: Record<string, unknown> | null;
      };
      const title =
        typeof request.title === "string" ? request.title.slice(0, 200) : "";
      const width =
        typeof request.width === "number" && Number.isFinite(request.width)
          ? Math.min(Math.max(request.width, 40), 4000)
          : 640;
      const height =
        typeof request.height === "number" && Number.isFinite(request.height)
          ? Math.min(Math.max(request.height, 40), 8000)
          : 400;
      const rawPosition =
        typeof request.position === "object" && request.position !== null
          ? request.position
          : null;
      const position =
        rawPosition !== null &&
        typeof rawPosition.x === "number" &&
        Number.isFinite(rawPosition.x) &&
        typeof rawPosition.y === "number" &&
        Number.isFinite(rawPosition.y)
          ? { x: rawPosition.x, y: rawPosition.y }
          : (() => {
              const centre = this.services.viewportCentre();
              return { x: centre.x - width / 2, y: centre.y - height / 2 };
            })();
      const layoutRaw = request.layout ?? null;
      const layout: FrameLayout | undefined =
        layoutRaw !== null &&
        (layoutRaw.dir === "row" || layoutRaw.dir === "column") &&
        typeof layoutRaw.gap === "number" &&
        Number.isFinite(layoutRaw.gap) &&
        layoutRaw.gap >= 0 &&
        typeof layoutRaw.padding === "number" &&
        Number.isFinite(layoutRaw.padding) &&
        layoutRaw.padding >= 0
          ? {
              dir: layoutRaw.dir,
              gap: layoutRaw.gap,
              padding: layoutRaw.padding,
              ...(layoutRaw.itemWidth === "fill"
                ? { itemWidth: "fill" as const }
                : {}),
            }
          : undefined;
      const properties = normalizeProperties(request.props ?? undefined);
      const base = makeFrameObject(
        this.services.nextObjectId(),
        scene.nextZIndex(),
        position,
      );
      const object = {
        ...base,
        width,
        height,
        title,
        ...(layout !== undefined ? { layout } : {}),
        ...(properties !== undefined ? { properties } : {}),
      };
      const command = new AddObjectCommand(scene, object);
      command.do();
      this.services.history.push(command);
      return { objectId: object.id };
    });
    handle("app.scene.addLink", (params) => {
      const registry = this.services.links;
      if (registry === undefined) {
        throw new BridgeRpcError(
          "bad-params",
          "سطح «صحنه» در این محیط در دسترس نیست.",
        );
      }
      const request = params as {
        sourceId?: unknown;
        targetId?: unknown;
        label?: unknown;
      };
      if (
        typeof request.sourceId !== "string" ||
        typeof request.targetId !== "string" ||
        request.sourceId === "" ||
        request.targetId === ""
      ) {
        throw new BridgeRpcError(
          "bad-params",
          "شناسهٔ مبدأ و مقصد پیوند لازم است.",
        );
      }
      const source = this.services.scene.findById(request.sourceId);
      const target = this.services.scene.findById(request.targetId);
      if (source === undefined || target === undefined) {
        throw new BridgeRpcError(
          "bad-params",
          "شیء مبدأ یا مقصد پیوند در صحنه نیست.",
        );
      }
      const targetTitle =
        objectTitleOf(target)?.display ??
        (isFrameObject(target) ? target.title : "");
      if (targetTitle.trim() === "") {
        throw new BridgeRpcError(
          "bad-params",
          "شیء مقصد عنوان قابل پیوند ندارد.",
        );
      }
      const entry: ObjectLinkEntry = {
        id: this.services.nextObjectId(),
        sourceId: request.sourceId,
        targetId: request.targetId,
        targetTitle,
        kind: "plugin",
        ...(typeof request.label === "string" && request.label !== ""
          ? { label: request.label.slice(0, 80) }
          : {}),
        ownerId: this.manifest.id,
        createdAt: Date.now(),
      };
      // ONE undo step (the manual-link precedent): a reversible
      // command over the registry, not a bare mutation.
      const command = addManualLinkCommand(registry, entry);
      command.do();
      this.services.history.push(command);
      return { linkId: entry.id };
    });
    handle("app.scene.listLinks", (params) => {
      const registry = this.services.links;
      if (registry === undefined) {
        throw new BridgeRpcError(
          "bad-params",
          "سطح «صحنه» در این محیط در دسترس نیست.",
        );
      }
      const request = params as {
        ownerId?: unknown;
        sourceId?: unknown;
        targetId?: unknown;
      };
      return registry
        .list()
        .filter(
          (entry) =>
            (typeof request.ownerId !== "string" ||
              entry.ownerId === request.ownerId) &&
            (typeof request.sourceId !== "string" ||
              entry.sourceId === request.sourceId) &&
            (typeof request.targetId !== "string" ||
              entry.targetId === request.targetId),
        )
        .map((entry) => ({
          id: entry.id,
          sourceId: entry.sourceId,
          targetId: entry.targetId,
          targetTitle: entry.targetTitle,
          kind: entry.kind,
          ...(entry.label !== undefined ? { label: entry.label } : {}),
          ...(entry.ownerId !== undefined ? { ownerId: entry.ownerId } : {}),
          createdAt: entry.createdAt,
        }));
    });
    handle("app.scene.removeLinksByOwner", () => {
      const registry = this.services.links;
      if (registry === undefined) {
        throw new BridgeRpcError(
          "bad-params",
          "سطح «صحنه» در این محیط در دسترس نیست.",
        );
      }
      const doomed = registry
        .list()
        .filter((entry) => entry.ownerId === this.manifest.id);
      for (const entry of doomed) {
        const command = removeManualLinkCommand(registry, entry);
        command.do();
        this.services.history.push(command);
      }
      return { removed: doomed.length };
    });
    handle("app.scene.focusObject", (params) => {
      const request = params as { objectId?: unknown };
      if (
        typeof request.objectId !== "string" ||
        this.services.scene.findById(request.objectId) === undefined
      ) {
        throw new BridgeRpcError("bad-params", "شیء موردنظر در صحنه نیست.");
      }
      this.services.flyToObject?.(request.objectId);
      return null;
    });
    handle("app.scene.notifyInfo", (params) => {
      const request = params as { message?: unknown };
      const message =
        typeof request.message === "string" ? request.message.trim() : "";
      if (message !== "") {
        this.services.notifyInfo?.(message.slice(0, 300));
      }
      return null;
    });

    // ---- selection ----
    handle("app.selection.ids", () => {
      return { ids: [...this.services.selection.ids] };
    });

    // ---- panels ----
    handle("app.panels.register", (params) => {
      if (!options.allowRegistrations) {
        throw new BridgeRpcError(
          "permission-denied",
          "ثبت پنل فقط در sandbox اصلی افزونه مجاز است.",
        );
      }
      const request = params as {
        id: string;
        titleKey: string;
        icon?: string;
        placement: "left" | "right" | "bottom";
        order?: number;
      };
      const fullId = `${prefix}.${request.id}`;
      const regionId = `panel:${fullId}`;
      const component = this.services.regionFrame(prefix, regionId);
      this.services.registerPanel({
        id: fullId,
        titleKey: request.titleKey,
        icon: request.icon,
        component,
        placement: request.placement,
        order: request.order ?? 800,
      });
      this.registeredPanelIds.add(fullId);
      return fullId;
    });

    // ---- settings ----
    handle("app.settings.register", (params) => {
      if (!options.allowRegistrations) {
        throw new BridgeRpcError(
          "permission-denied",
          "ثبت بخش تنظیمات فقط در sandbox اصلی افزونه مجاز است.",
        );
      }
      const request = params as {
        id: string;
        titleKey: string;
        order?: number;
      };
      const fullId = `${prefix}.${request.id}`;
      const regionId = `settings:${fullId}`;
      const component = this.services.regionFrame(
        prefix,
        regionId,
        request.titleKey,
      );
      this.services.registerSettingsSection({
        id: fullId,
        titleKey: request.titleKey,
        order: request.order ?? 800,
        component,
      });
      this.registeredSectionIds.add(fullId);
      return fullId;
    });

    // ---- storage (permission: storage) ----
    handle("app.storage.get", (params) => {
      const request = params as { key: string };
      const value = this.storage.get(request.key);
      return value === undefined ? null : value;
    });
    handle("app.storage.set", (params) => {
      const request = params as { key: string; value: unknown };
      this.storage.set(request.key, request.value);
      return null;
    });
    handle("app.storage.delete", (params) => {
      const request = params as { key: string };
      this.storage.delete(request.key);
      return null;
    });
    handle("app.storage.sql", (params) => {
      const request = params as { statements: SqlStatement[] };
      const results = this.storage.sql(request.statements ?? []);
      return { results };
    });

    // ---- events (allowlist) ----
    handle("app.events.subscribe", (params) => {
      const request = params as { event: string };
      if (!PLUGIN_EVENT_ALLOWLIST.includes(request.event)) {
        throw new BridgeRpcError(
          "disallowed-event",
          `رویداد «${request.event}» برای افزونه‌ها در دسترس نیست.`,
        );
      }
      const subscriptionId = this.eventSubscriptionSeq;
      this.eventSubscriptionSeq += 1;
      const eventName = `app.event.${request.event}`;
      const unsubscribe = this.subscribeAppEvent(request.event, (payload) => {
        peer.emit(eventName, payload);
      });
      this.eventUnsubscribers.set(subscriptionId, unsubscribe);
      return { subscriptionId };
    });
    handle("app.events.unsubscribe", (params) => {
      const request = params as { subscriptionId: number };
      const unsubscribe = this.eventUnsubscribers.get(request.subscriptionId);
      if (unsubscribe !== undefined) {
        unsubscribe();
        this.eventUnsubscribers.delete(request.subscriptionId);
      }
      return null;
    });

    // ---- project (permissions: projectRead/projectWrite) ----
    handle("app.project.read", () => {
      return this.services.projectPlugins.get()[this.manifest.id] ?? null;
    });
    handle("app.project.write", (params) => {
      const request = params as { data: unknown };
      const plugins = { ...this.services.projectPlugins.get() };
      plugins[this.manifest.id] = request.data;
      this.services.projectPlugins.set(plugins);
      return null;
    });

    // ---- datahub (permission: datahub — R10.1) ----
    handle("app.datahub.provide", (params) => {
      if (!options.allowRegistrations) {
        throw new BridgeRpcError(
          "permission-denied",
          "ثبت قرارداد داده فقط در sandbox اصلی افزونه مجاز است.",
        );
      }
      const hub = this.services.dataHub;
      if (hub === undefined) {
        throw new BridgeRpcError(
          "unknown-method",
          "مرکز داده در این برنامه فعال نیست.",
        );
      }
      const request = params as {
        contractId: string;
        version: string;
        methods: string[];
      };
      if (
        typeof request.contractId !== "string" ||
        request.contractId.length === 0 ||
        !/^[a-z][a-z0-9.-]*$/i.test(request.contractId) ||
        typeof request.version !== "string" ||
        !Array.isArray(request.methods) ||
        request.methods.length === 0
      ) {
        throw new BridgeRpcError(
          "bad-params",
          "شناسهٔ قرارداد، نسخه یا فهرست روش‌ها نامعتبر است.",
        );
      }
      hub.registerPluginProvider(
        {
          contractId: request.contractId,
          version: request.version,
          providerId: this.manifest.id,
          methods: request.methods.filter(
            (method): method is string => typeof method === "string",
          ),
        },
        (method, methodParams) => this.serveDatahubQuery(method, methodParams),
      );
      this.registeredContractIds.add(request.contractId);
      return request.contractId;
    });
    handle("app.datahub.query", async (params) => {
      const hub = this.services.dataHub;
      if (hub === undefined) {
        throw new BridgeRpcError(
          "unknown-method",
          "مرکز داده در این برنامه فعال نیست.",
        );
      }
      const request = params as {
        contractId: string;
        versionRange: string;
        method: string;
        params?: unknown;
      };
      return hub.query(this.manifest.id, {
        contractId: request.contractId,
        versionRange:
          typeof request.versionRange === "string" ? request.versionRange : "*",
        method: request.method,
        params: request.params,
      });
    });
    handle("app.datahub.subscribe", (params) => {
      const hub = this.services.dataHub;
      if (hub === undefined) {
        throw new BridgeRpcError(
          "unknown-method",
          "مرکز داده در این برنامه فعال نیست.",
        );
      }
      const request = params as { contractId: string; versionRange?: string };
      const subscriptionId = this.hubSubscriptionSeq;
      this.hubSubscriptionSeq += 1;
      const subscription = hub.subscribe(
        this.manifest.id,
        request.contractId,
        request.versionRange ?? "*",
        (change) => {
          peer.emit("app.datahub.changed", {
            contractId: request.contractId,
            change,
          });
        },
      );
      this.hubSubscriptions.set(subscriptionId, {
        contractId: request.contractId,
        unsubscribe: subscription.unsubscribe,
        peer,
      });
      return {
        subscriptionId,
        ok: subscription.ok,
        message: subscription.message,
      };
    });
    handle("app.datahub.unsubscribe", (params) => {
      const request = params as { subscriptionId: number };
      const subscription = this.hubSubscriptions.get(request.subscriptionId);
      if (subscription !== undefined) {
        subscription.unsubscribe();
        this.hubSubscriptions.delete(request.subscriptionId);
      }
      return null;
    });
    handle("app.datahub.publish", (params) => {
      const hub = this.services.dataHub;
      if (hub === undefined) {
        throw new BridgeRpcError(
          "unknown-method",
          "مرکز داده در این برنامه فعال نیست.",
        );
      }
      const request = params as { contractId: string; change: unknown };
      if (
        !this.registeredContractIds.has(
          typeof request.contractId === "string" ? request.contractId : "",
        )
      ) {
        throw new BridgeRpcError(
          "permission-denied",
          "افزونه فقط می‌تواند در قرارداد خودش تغییر اعلام کند.",
        );
      }
      const accepted = hub.publish(
        this.manifest.id,
        request.contractId,
        request.change,
      );
      return accepted;
    });

    // ---- i18n ----
    handle("app.i18n.merge", (params) => {
      const dictionaries = params as {
        fa?: Record<string, string>;
        en?: Record<string, string>;
      };
      const conflicts = mergeNamespace(this.manifest.id, dictionaries);
      return { conflicts };
    });

    // ---- network (permission: network) ----
    handle("app.network.fetch", async (params) => {
      const request = params as {
        url: string;
        init?: {
          method?: string;
          headers?: Record<string, string>;
          body?: string;
        } | null;
      };
      if (
        typeof request.url !== "string" ||
        !/^https?:\/\//.test(request.url)
      ) {
        throw new BridgeRpcError("bad-params", "نشانی باید http(s) باشد.");
      }
      const method = (request.init?.method ?? "GET").toUpperCase();
      if (!NETWORK_METHODS.has(method)) {
        throw new BridgeRpcError(
          "bad-params",
          "روش درخواست مجاز نیست (GET/POST/PUT/PATCH/DELETE).",
        );
      }
      const body = request.init?.body;
      if (
        body !== undefined &&
        (typeof body !== "string" || body.length > NETWORK_BODY_CAP)
      ) {
        throw new BridgeRpcError(
          "bad-params",
          "بدنهٔ درخواست باید متن کمتر از ۵۱۲ کیلوبایت باشد.",
        );
      }
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.init?.headers ?? {})) {
        if (typeof value === "string" && Object.keys(headers).length < 32) {
          headers[key] = value;
        }
      }
      const response = await fetch(request.url, {
        method,
        ...(body === undefined ? {} : { body }),
        ...(Object.keys(headers).length === 0 ? {} : { headers }),
      });
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      return {
        status: response.status,
        bodyText: await response.text(),
        headers: responseHeaders,
      };
    });

    // ---- region messaging (plugin → host one-way pushes) ----
    peer.on("host.region.message", (payload) => {
      // The composition root may observe region traffic; the runtime
      // keeps it observable for debugging (no behaviour by default).
      this.services.logger.info?.(
        `[plugins] region message from ${this.manifest.id}: ${JSON.stringify(payload)}`,
      );
    });
  }

  /**
   * Subscribes to one allowlisted app event with payload widening.
   *
   * @param event - the app event name.
   * @param forward - the sink receiving the payload.
   * @returns an unsubscriber.
   */
  private subscribeAppEvent(
    event: string,
    forward: (payload: unknown) => void,
  ): () => void {
    const bus = this.services.eventBus;
    if (event === "selection:changed") {
      return bus.on("selection:changed", () => {
        forward({ ids: [...this.services.selection.ids] });
      });
    }
    return bus.on(event as keyof AppEventMap, forward);
  }

  /**
   * @returns the negotiated SDK major, or null when unsupported.
   */
  private negotiateSdkMajor(): number | null {
    const supported = sdkRangeSupportedMajors(this.manifest.sdkRange);
    return supported.length > 0 ? (supported[0] ?? null) : null;
  }

  /**
   * Waits for the plugin's `ready` frame.
   */
  private waitForReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("sandbox handshake timed out"));
      }, READY_TIMEOUT_MS);
      if (typeof timer === "object" && "unref" in timer) {
        (timer as { unref(): void }).unref();
      }
      const detach = this.transport.onMessage((message) => {
        if (isBridgeMessage(message) && message.kind === "ready") {
          clearTimeout(timer);
          detach();
          resolve();
        }
      });
    });
  }

  /**
   * Records a startup failure (AC9.3: never rethrown).
   *
   * @param message - the Persian message.
   */
  private fail(message: string): void {
    this.state = "error";
    this.lastError = message;
    this.services.logger.error(`[plugins] ${message}`);
  }

  /**
   * Serialises one scene object to a JSON-ish record (the SDK's object
   * read surface).
   *
   * @param object - the scene object.
   * @returns the JSON-ish record.
   */
  private toJsonish(object: SceneObjectData): Record<string, unknown> {
    const record: Record<string, unknown> = {
      id: object.id,
      kind: object.kind,
      position: { x: object.position.x, y: object.position.y },
      rotation: object.rotation,
      zIndex: object.zIndex,
      visible: object.visible,
      locked: object.locked,
      ...(object.name !== undefined ? { name: object.name } : {}),
      ...(object.parentId !== undefined ? { parentId: object.parentId } : {}),
      // Pack R11.10: the structured properties record + the applied
      // named style ride the object DTO (absent when the object has
      // neither — the pre-Phase-18 DTO shape stays valid).
      ...(object.properties !== undefined
        ? { properties: { ...object.properties } }
        : {}),
      ...(styleIdOf(object) !== undefined
        ? { styleId: styleIdOf(object) }
        : {}),
      // Pack-14: the plain-text projection rides the READ DTO for the
      // knowledge-y plugins (dailies word counts, analyst reports) —
      // the write surface stays the typed commands above.
      ...(typeof (object as { text?: unknown }).text === "string"
        ? { text: (object as { text?: string }).text }
        : {}),
    };
    if (isPluginObject(object)) {
      record.typeId = object.typeId;
      record.width = object.width;
      record.height = object.height;
      record.data = object.data;
    } else if ("width" in object && "height" in object) {
      record.width = (object as { width: number }).width;
      record.height = (object as { height: number }).height;
    }
    return record;
  }
}

/**
 * Reads the optional applied named-style id off any object (R13.3's
 * styleId rides objects as a loose field — read defensively, mirroring
 * the inspector's own accessor).
 *
 * @param object - the scene object.
 * @returns the style id, or undefined.
 */
function styleIdOf(object: SceneObjectData): string | undefined {
  const candidate = (object as { styleId?: unknown }).styleId;
  return typeof candidate === "string" ? candidate : undefined;
}
