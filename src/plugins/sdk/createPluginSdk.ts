/**
 * The plugin-side SDK surface (R9.3): the `app` object handed to a
 * plugin's `pluginMain(app)`.
 *
 * This module is the CANONICAL typed surface. It runs over any
 * {@link RpcPeer} transport:
 * - in tests / in-process: directly over an in-process pair;
 * - in the browser sandbox: the SandboxHost injects a hand-rolled JS
 *   twin of this shim into the iframe's srcdoc bootstrap (the wire
 *   surface is the same `app.*` RPC method family; the twin is ~60
 *   lines of plain JS documented in docs/SEAMS.md).
 *
 * Every call crossing the bridge is permission-checked HOST-side
 * (fail-closed, AC9.4); plugin-side code never needs to think about
 * permissions — it just gets typed errors.
 *
 * The plugin contract (docs/SEAMS.md §9): the entry JS defines a global
 * `pluginMain(app)` function; the bootstrap invokes it after the
 * handshake.
 */
import {
  RpcPeer,
  BridgeRpcError,
  type BridgeTransport,
} from "@/plugins/protocol";

/** Point in world coordinates (host-owned precision). */
export interface SdkPoint {
  readonly x: number;
  readonly y: number;
}

/** One command a plugin registers. */
export interface PluginCommandRegistration {
  /** Local id — the final command id is `<pluginId>.<id>`. */
  readonly id: string;
  /** Full i18n key (from the plugin's merged namespace). */
  readonly titleKey: string;
  /** Optional lucide icon name (toolbar/palette rendering). */
  readonly icon?: string;
  /** Optional keyboard shortcut (the Mod/Ctrl notation). */
  readonly shortcut?: string;
  /** Runs when the user invokes the command. */
  execute(point?: SdkPoint): void | Promise<void>;
}

/** One canvas-widget object type a plugin registers. */
export interface PluginObjectRegistration {
  /** Local type name — the final typeId is `<pluginId>.<id>`. */
  readonly id: string;
  /** Full i18n key of the catalog card title. */
  readonly titleKey: string;
  /**
   * Catalog group: a plugin i18n key resolved to the plugin's display
   * group name (default: `plugins.group` inside the plugin namespace).
   */
  readonly group?: string;
  /** Order inside the catalog group (ascending). */
  readonly order?: number;
  /** Optional lucide icon name for the catalog card. */
  readonly icon?: string;
  /** Optional preview hint (emoji or CSS gradient string). */
  readonly preview?: string;
  /** Default widget footprint (world units). */
  readonly width?: number;
  readonly height?: number;
  /**
   * Produces the plugin's verbatim data payload for a new instance
   * (the host wraps it into the scene envelope — called at the exact
   * world drop/click point).
   */
  factory(
    point: SdkPoint,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  /**
   * Renders the widget's HTML snapshot (display-only, sandboxed without
   * scripts; AC9.10 — the plugin is pinged once per data revision,
   * never during panel scroll).
   */
  renderWidget?(
    data: Record<string, unknown>,
    size: { width: number; height: number },
  ): string | Promise<string>;
}

/** One dock panel a plugin registers. */
export interface PluginPanelRegistration {
  /** Local id — the final panel id is `<pluginId>.<id>`. */
  readonly id: string;
  /** Full i18n key of the panel title. */
  readonly titleKey: string;
  /** Optional lucide icon name. */
  readonly icon?: string;
  /** Dock edge. */
  readonly placement: "left" | "right" | "bottom";
  /** Order inside the dock. */
  readonly order?: number;
}

/** One settings section a plugin registers. */
export interface PluginSettingsRegistration {
  /** Local id — the final section id is `<pluginId>.<id>`. */
  readonly id: string;
  /** Full i18n key of the section title. */
  readonly titleKey: string;
  /** Order inside the dialog. */
  readonly order?: number;
}

/** The per-plugin key-value store (permission: `storage`). */
export interface SdkStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Runs SQL statements against the plugin's OWN prefix-scoped engine
   * (localStorage-backed on the web shell, SQLite on the desktop).
   */
  sql(statements: readonly SdkSqlStatement[]): Promise<unknown[]>;
}

/** One datahub contract a plugin provides (R10.1). */
export interface SdkDatahubProvider {
  /** The contract id (e.g. `calendar.events`). */
  readonly contractId: string;
  /** The provider's semver version (e.g. `1.0.0`). */
  readonly version: string;
  /** The query method names the contract serves. */
  readonly methods: readonly string[];
  /** Serves one query (stays plugin-side — only the result crosses). */
  query(method: string, params: unknown): unknown | Promise<unknown>;
}

/** The outcome of one hub query from the consumer side (R10.1). */
export interface SdkHubQueryOutcome {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly reason?: string;
  /** The Persian degradation message when `ok` is false. */
  readonly message?: string;
}

/** A structured property value the scene seam accepts (R11.3 shapes). */
export type SdkPropertyValue = string | number | boolean | readonly string[];

/** Insert-text request (pack-14 `app.scene.insertText`). */
export interface SdkSceneInsertTextRequest {
  /** The note's plain text (\n paragraphs; 8000-char cap). */
  readonly text: string;
  /** Box width in world units (40..2000, default 300). */
  readonly width?: number;
  /** Font size in world units (8..96, default 16). */
  readonly fontSize?: number;
  /** Box CENTRE in world units (default: the viewport centre). */
  readonly position?: SdkPoint;
  /** Structured properties set at creation (validated host-side). */
  readonly props?: Record<string, SdkPropertyValue>;
  /** Whether the new object becomes the selection (default true). */
  readonly select?: boolean;
}

/** Insert-frame request (pack-14 `app.scene.insertFrame`). */
export interface SdkSceneInsertFrameRequest {
  /** The frame's title-bar label. */
  readonly title?: string;
  /** Frame width (default 640). */
  readonly width?: number;
  /** Frame height (default 400). */
  readonly height?: number;
  /** Frame TOP-LEFT in world units (default: centred on the viewport). */
  readonly position?: SdkPoint;
  /** Auto-layout definition ({dir, gap, padding, itemWidth?}). */
  readonly layout?: {
    readonly dir: "row" | "column";
    readonly gap: number;
    readonly padding: number;
    readonly itemWidth?: "fill";
  };
  /** Structured properties set at creation (validated host-side). */
  readonly props?: Record<string, SdkPropertyValue>;
}

/** One registry link (the read shape of `listLinks`). */
export interface SdkSceneLink {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string | null;
  readonly targetTitle: string;
  readonly kind: "manual" | "plugin";
  readonly label?: string;
  readonly ownerId?: string;
  readonly createdAt: number;
}

/** The scene seam (permission: `scene`; pack-14 R14.1). */
export interface SdkScene {
  /** Creates a REAL plain-text box (one undo step; returns its id). */
  insertText(
    request: SdkSceneInsertTextRequest,
  ): Promise<{ objectId: string } | null>;
  /** Creates a REAL frame, optionally auto-layout (one undo step). */
  insertFrame(
    request: SdkSceneInsertFrameRequest,
  ): Promise<{ objectId: string } | null>;
  /** Adds a plugin-owned link (kind "plugin", owner = this plugin). */
  addLink(request: {
    sourceId: string;
    targetId: string;
    label?: string;
  }): Promise<{ linkId: string } | null>;
  /** Reads registry links (filter by owner/source/target). */
  listLinks(filter?: {
    ownerId?: string;
    sourceId?: string;
    targetId?: string;
  }): Promise<readonly SdkSceneLink[]>;
  /** Removes every link this plugin owns (the archive path). */
  removeLinksByOwner(): Promise<{ removed: number } | null>;
  /** Flies the camera onto one object (no-op-safe). */
  focusObject(objectId: string): Promise<void>;
  /** Posts a Persian info toast (300-char cap). */
  notifyInfo(message: string): Promise<void>;
}

/** The Data Hub surface (permission: `datahub`). */
export interface SdkDatahub {
  /** Registers the plugin as a contract's provider (main sandbox only). */
  provide(provider: SdkDatahubProvider): Promise<string>;
  /** Queries another contract (version-checked; degrades gracefully). */
  query(request: {
    contractId: string;
    versionRange: string;
    method: string;
    params?: unknown;
  }): Promise<SdkHubQueryOutcome>;
  /** Subscribes to a contract's changes (fires for late providers too). */
  subscribe(
    request: { contractId: string; versionRange?: string },
    listener: (change: unknown) => void,
  ): Promise<{ ok: boolean; message: string | null }>;
  /** Stops one subscription (the id `subscribe` resolved with). */
  unsubscribe(subscriptionId: number): Promise<void>;
  /** Notifies consumers of a change on the plugin's OWN contract. */
  publish(change: { contractId: string; change: unknown }): Promise<boolean>;
}

/** One parameterised SQL statement (the same family as the host's). */
export interface SdkSqlStatement {
  readonly sql: string;
  readonly params?: readonly unknown[];
}

/** The region API handed to a plugin inside a UI-region iframe. */
export interface SdkRegion {
  /** The region id (`panel:<panelId>` / `settings:<sectionId>`). */
  readonly id: string;
  /** Sends a one-way message to the host side of the region. */
  post(message: unknown): void;
  /** Receives messages the host pushes into the region. */
  onMessage(listener: (message: unknown) => void): () => void;
}

/** The `app` surface (R9.3). */
export interface PluginApp {
  /**
   * The scene seam (pack-14, permission: `scene`): creates REAL core
   * objects (plain-text boxes + auto-layout frames), owns plugin
   * links, reads the link registry, flies the camera and posts info
   * toasts. Everything is host-validated fail-closed.
   */
  readonly scene: SdkScene;
  /** Registers commands owned by the plugin. */
  readonly commands: {
    register(registration: PluginCommandRegistration): Promise<string>;
    /** Executes ANY registered command by its full id (core or plugin). */
    execute(commandId: string): Promise<void>;
  };
  /** Registers canvas-widget object types owned by the plugin. */
  readonly objects: {
    register(registration: PluginObjectRegistration): Promise<string>;
    /**
     * Creates one plugin-owned object at a world point (async factory
     * round-trip; omit the point for the viewport centre). One undo
     * step; returns the created object's id or null on failure.
     */
    create(
      localTypeId: string,
      point?: SdkPoint,
    ): Promise<Record<string, unknown> | null>;
    /** Reads one scene object (core or plugin) as JSON-ish data. */
    get(objectId: string): Promise<Record<string, unknown> | null>;
    /** Lists scene objects (id, kind, typeId, position, size). */
    list(): Promise<readonly Record<string, unknown>[]>;
    /** Patches a plugin-owned object's data (one undo step). */
    update(
      objectId: string,
      dataPatch: Record<string, unknown>,
    ): Promise<boolean>;
    /** Removes a plugin-owned object (one undo step). */
    remove(objectId: string): Promise<boolean>;
  };
  /** Reads the current selection. */
  readonly selection: {
    ids(): Promise<readonly string[]>;
    on(listener: (ids: readonly string[]) => void): () => void;
  };
  /** Registers dock panels whose bodies are the plugin's regions. */
  readonly panels: {
    register(registration: PluginPanelRegistration): Promise<string>;
  };
  /** Registers settings sections rendered inside the plugin's region. */
  readonly settings: {
    register(registration: PluginSettingsRegistration): Promise<string>;
  };
  /** Namespaced persistence (permission: `storage`). */
  readonly storage: SdkStorage;
  /**
   * Subscribes to an ALLOWLIST of app events (the host refuses
   * non-allowlisted names with a typed error).
   */
  readonly events: {
    on(
      appEvent: string,
      listener: (payload: unknown) => void,
    ): Promise<() => void>;
  };
  /** The plugin's own project-file section. */
  readonly project: {
    read(): Promise<unknown>;
    write(data: unknown): Promise<void>;
  };
  /** Merges runtime dictionaries under the plugin's owner namespace. */
  readonly i18n: {
    merge(dictionaries: {
      fa?: Record<string, string>;
      en?: Record<string, string>;
    }): Promise<readonly string[]>;
  };
  /** External fetch (permission: `network`; the core stays offline). */
  readonly network: {
    fetch(
      url: string,
      init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      },
    ): Promise<{
      status: number;
      bodyText: string;
      headers: Record<string, string>;
    }>;
  };
  /** The Data Hub (permission: `datahub`; R10.1). */
  readonly datahub: SdkDatahub;
  /** Present only inside a UI-region iframe (panel body / settings). */
  readonly region?: SdkRegion;
}

/** Handshake info the bootstrap receives from the host. */
export interface SdkHello {
  readonly pluginId: string;
  readonly sdkMajor: number;
  readonly regionId: string | null;
}

/**
 * Creates the plugin-side `app` surface over a transport.
 *
 * @param transport - the raw channel to the host.
 * @param hello - the handshake parameters.
 * @returns the `app` object + the `ready` notifier.
 */
export function createPluginSdk(
  transport: BridgeTransport,
  hello: SdkHello,
): { app: PluginApp; notifyReady: () => void } {
  const peer = new RpcPeer(transport, `plugin:${hello.pluginId}`);

  // Local callbacks the host invokes through events.
  const commandHandlers = new Map<string, PluginCommandRegistration>();
  const objectFactories = new Map<string, PluginObjectRegistration>();
  const regionListeners = new Set<(message: unknown) => void>();
  const selectionListeners = new Set<(ids: readonly string[]) => void>();
  const datahubProviders = new Map<string, SdkDatahubProvider>();
  const datahubChangeListeners = new Set<{
    contractId: string;
    listener: (change: unknown) => void;
  }>();

  peer.on("plugin.command.invoke", (payload) => {
    const request = payload as { commandId: string };
    const registration = commandHandlers.get(request.commandId);
    if (registration !== undefined) {
      void Promise.resolve(registration.execute()).catch(() => {
        // A plugin command failure never crashes the sandbox; the host
        // surfaces its own notice toast.
      });
    }
  });

  peer.on("plugin.region.message", (payload) => {
    const message = payload as { regionId: string; message: unknown };
    if (message.regionId === hello.regionId) {
      for (const listener of [...regionListeners]) {
        listener(message.message);
      }
    }
  });

  peer.on("app.event.selection:changed", (payload) => {
    const event = payload as { ids?: readonly string[] };
    const ids = event.ids ?? [];
    for (const listener of [...selectionListeners]) {
      listener(ids);
    }
  });

  peer.on("app.datahub.changed", (payload) => {
    const event = payload as { contractId?: string; change?: unknown };
    for (const subscription of [...datahubChangeListeners]) {
      if (subscription.contractId === event.contractId) {
        subscription.listener(event.change);
      }
    }
  });

  // The plugin-side object factory/renderWidget service: the host calls
  // `app.objects.__serve` with the work request; the shim resolves it
  // from the local registrations and returns the result.
  peer.handle("app.objects.__serve", async (params) => {
    const request = params as {
      op: "factory" | "render";
      typeId: string;
      point?: SdkPoint;
      data?: Record<string, unknown>;
      width?: number;
      height?: number;
    };
    const registration = objectFactories.get(request.typeId);
    if (registration === undefined) {
      throw new BridgeRpcError(
        "bad-params",
        `unknown object type ${request.typeId}`,
      );
    }
    if (request.op === "factory") {
      return await registration.factory(request.point ?? { x: 0, y: 0 });
    }
    if (registration.renderWidget === undefined) {
      return "";
    }
    return await registration.renderWidget(request.data ?? {}, {
      width: request.width ?? 160,
      height: request.height ?? 120,
    });
  });

  // The plugin-side datahub provider service (R10.1): the host routes
  // contract queries here; the shim dispatches to the local provider.
  peer.handle("app.datahub.__serve", async (params) => {
    const request = params as {
      op: "query";
      method: string;
      params?: unknown;
    };
    for (const provider of datahubProviders.values()) {
      if (provider.methods.includes(request.method)) {
        return await provider.query(request.method, request.params);
      }
    }
    throw new BridgeRpcError(
      "bad-params",
      `no provider serves "${request.method}"`,
    );
  });

  const app: PluginApp = {
    scene: {
      async insertText(request) {
        return (await peer.call("app.scene.insertText", {
          text: request.text,
          width: request.width,
          fontSize: request.fontSize,
          position: request.position ?? null,
          props: request.props ?? null,
          select: request.select,
        })) as { objectId: string } | null;
      },
      async insertFrame(request) {
        return (await peer.call("app.scene.insertFrame", {
          title: request.title,
          width: request.width,
          height: request.height,
          position: request.position ?? null,
          layout: request.layout ?? null,
          props: request.props ?? null,
        })) as { objectId: string } | null;
      },
      async addLink(request) {
        return (await peer.call("app.scene.addLink", {
          sourceId: request.sourceId,
          targetId: request.targetId,
          label: request.label,
        })) as { linkId: string } | null;
      },
      async listLinks(filter) {
        return (await peer.call("app.scene.listLinks", {
          ownerId: filter?.ownerId,
          sourceId: filter?.sourceId,
          targetId: filter?.targetId,
        })) as readonly SdkSceneLink[];
      },
      async removeLinksByOwner() {
        return (await peer.call("app.scene.removeLinksByOwner", {})) as {
          removed: number;
        } | null;
      },
      async focusObject(objectId) {
        await peer.call("app.scene.focusObject", { objectId });
      },
      async notifyInfo(message) {
        await peer.call("app.scene.notifyInfo", { message });
      },
    },
    commands: {
      async register(registration) {
        commandHandlers.set(registration.id, registration);
        const result = (await peer.call("app.commands.register", {
          id: registration.id,
          titleKey: registration.titleKey,
          icon: registration.icon,
          shortcut: registration.shortcut,
        })) as string;
        return result;
      },
      async execute(commandId) {
        await peer.call("app.commands.execute", { commandId });
      },
    },
    objects: {
      async register(registration) {
        objectFactories.set(registration.id, registration);
        const result = (await peer.call("app.objects.register", {
          id: registration.id,
          titleKey: registration.titleKey,
          group: registration.group,
          order: registration.order,
          icon: registration.icon,
          preview: registration.preview,
          width: registration.width,
          height: registration.height,
          hasRenderer: registration.renderWidget !== undefined,
        })) as string;
        return result;
      },
      async create(localTypeId, point) {
        return (await peer.call("app.objects.create", {
          typeId: localTypeId,
          point: point ?? null,
        })) as Record<string, unknown> | null;
      },
      async get(objectId) {
        return (await peer.call("app.objects.get", { objectId })) as Record<
          string,
          unknown
        > | null;
      },
      async list() {
        return (await peer.call("app.objects.list", {})) as Record<
          string,
          unknown
        >[];
      },
      async update(objectId, dataPatch) {
        return (await peer.call("app.objects.update", {
          objectId,
          dataPatch,
        })) as boolean;
      },
      async remove(objectId) {
        return (await peer.call("app.objects.remove", { objectId })) as boolean;
      },
    },
    selection: {
      async ids() {
        const result = (await peer.call("app.selection.ids", {})) as {
          ids: readonly string[];
        };
        return result.ids;
      },
      on(listener) {
        selectionListeners.add(listener);
        return () => {
          selectionListeners.delete(listener);
        };
      },
    },
    panels: {
      async register(registration) {
        return (await peer.call("app.panels.register", {
          id: registration.id,
          titleKey: registration.titleKey,
          icon: registration.icon,
          placement: registration.placement,
          order: registration.order,
        })) as string;
      },
    },
    settings: {
      async register(registration) {
        return (await peer.call("app.settings.register", {
          id: registration.id,
          titleKey: registration.titleKey,
          order: registration.order,
        })) as string;
      },
    },
    storage: {
      async get(key) {
        const result = await peer.call("app.storage.get", { key });
        return result === null ? undefined : result;
      },
      async set(key, value) {
        await peer.call("app.storage.set", { key, value });
      },
      async delete(key) {
        await peer.call("app.storage.delete", { key });
      },
      async sql(statements) {
        const result = (await peer.call("app.storage.sql", { statements })) as {
          results: unknown[];
        };
        return result.results;
      },
    },
    events: {
      async on(appEvent, listener) {
        // The host validates the event name against the allowlist and
        // replies with the subscription id (or a typed error).
        const result = (await peer.call("app.events.subscribe", {
          event: appEvent,
        })) as { subscriptionId: number };
        const eventName = `app.event.${appEvent}`;
        const unsubscribeEvent = peer.on(eventName, (payload) => {
          listener(payload);
        });
        return () => {
          unsubscribeEvent();
          void peer
            .call("app.events.unsubscribe", {
              subscriptionId: result.subscriptionId,
            })
            .catch(() => {
              // The sandbox is going away — unsubscribing is moot.
            });
        };
      },
    },
    project: {
      async read() {
        return await peer.call("app.project.read", {});
      },
      async write(data) {
        await peer.call("app.project.write", { data });
      },
    },
    i18n: {
      async merge(dictionaries) {
        const result = (await peer.call("app.i18n.merge", dictionaries)) as {
          conflicts: string[];
        };
        return result.conflicts;
      },
    },
    network: {
      async fetch(url, init) {
        return (await peer.call("app.network.fetch", {
          url,
          init:
            init === undefined
              ? null
              : {
                  method: init.method,
                  headers: init.headers,
                  body: init.body,
                },
        })) as {
          status: number;
          bodyText: string;
          headers: Record<string, string>;
        };
      },
    },
    datahub: {
      async provide(provider) {
        datahubProviders.set(provider.contractId, provider);
        const result = (await peer.call("app.datahub.provide", {
          contractId: provider.contractId,
          version: provider.version,
          methods: provider.methods,
        })) as string;
        return result;
      },
      async query(request) {
        return (await peer.call(
          "app.datahub.query",
          request,
        )) as SdkHubQueryOutcome;
      },
      async subscribe(request, listener) {
        const subscription = {
          contractId: request.contractId,
          listener,
        };
        datahubChangeListeners.add(subscription);
        const result = (await peer.call("app.datahub.subscribe", {
          contractId: request.contractId,
          versionRange: request.versionRange ?? "*",
        })) as { subscriptionId: number; ok: boolean; message: string | null };
        return { ok: result.ok, message: result.message };
      },
      async unsubscribe(subscriptionId) {
        await peer.call("app.datahub.unsubscribe", { subscriptionId });
      },
      async publish(request) {
        return (await peer.call("app.datahub.publish", {
          contractId: request.contractId,
          change: request.change,
        })) as boolean;
      },
    },
  };

  const region: SdkRegion | null =
    hello.regionId === null
      ? null
      : {
          id: hello.regionId,
          post(message: unknown) {
            peer.emit("host.region.message", {
              regionId: hello.regionId,
              message,
            });
          },
          onMessage(listener: (message: unknown) => void) {
            regionListeners.add(listener);
            return () => {
              regionListeners.delete(listener);
            };
          },
        };
  const appWithRegion: PluginApp = region === null ? app : { ...app, region };

  return {
    app: appWithRegion,
    notifyReady() {
      transport.post({ v: 1, kind: "ready" });
    },
  };
}
