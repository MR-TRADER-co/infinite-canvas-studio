/**
 * Browser sandbox host (R9.2): spawns plugin iframes and wires their
 * postMessage channels into {@link BridgeTransport}s.
 *
 * Security model (the spec's hard requirements):
 * - `sandbox="allow-scripts"` — WITHOUT `allow-same-origin`: the frame
 *   has an OPAQUE origin, no DOM/storage access to the app, no Tauri
 *   APIs; script execution is the only capability;
 * - content via `srcdoc` (no network loads);
 * - every inbound frame message is validated against the bridge
 *   schema AND pinned to its `iframe.contentWindow` source — a foreign
 *   frame can never impersonate a plugin;
 * - `postMessage(..., "*")` both ways: sandboxed frames have the
 *   origin `null`, and the source check replaces origin checking.
 *
 * The bootstrap embedded in the srcdoc is the plain-JS twin of the
 * canonical TS shim (`plugins/sdk/createPluginSdk.ts`): same wire
 * methods, ~150 lines, no imports (docs/SEAMS.md §9 documents the
 * twin's contract).
 */
import {
  isBridgeMessage,
  type BridgeMessage,
  type BridgeTransport,
} from "@/plugins/protocol";
import type { PluginManifest } from "@/plugins/manifest";

/** A live sandbox: the transport + teardown. */
export interface PluginSandbox {
  readonly transport: BridgeTransport;
  /** The iframe element (the caller mounts it). */
  readonly frame: HTMLIFrameElement;
  /** Destroys the sandbox (removes listeners + the frame). */
  dispose(): void;
}

/** Options for one sandbox spawn. */
export interface SandboxOptions {
  /** `null` for the headless main runtime; the region id inside regions. */
  readonly regionId: string | null;
  /** The plugin's entry JS source (verbatim). */
  readonly entrySource: string;
  /** The host label (diagnostics). */
  readonly host: string;
}

/**
 * Builds the sandbox iframe's srcdoc.
 *
 * @param manifest - the plugin's manifest.
 * @param options - the spawn options.
 * @returns the srcdoc HTML.
 */
export function buildSandboxSrcdoc(
  manifest: PluginManifest,
  options: SandboxOptions,
): string {
  const bootstrap = `
(function () {
  "use strict";
  var PLUGIN_ID = ${JSON.stringify(manifest.id)};
  var REGION_ID = ${JSON.stringify(options.regionId)};
  var HOST = ${JSON.stringify(options.host)};
  var PROTOCOL_V = 1;
  var nextMsgId = 1;
  var pending = Object.create(null);
  var evtListeners = Object.create(null);
  var commandHandlers = Object.create(null);
  var objectRegistrations = Object.create(null);
  var regionListeners = [];
  var selectionListeners = [];
  var datahubProviders = Object.create(null);
  var datahubChangeListeners = [];

  function post(message) {
    try { parent.postMessage(message, "*"); } catch (e) { /* gone */ }
  }
  window.addEventListener("message", function (event) {
    if (event.source !== parent) { return; }
    var message = event.data;
    if (!message || message.v !== PROTOCOL_V) { return; }
    if (message.kind === "req") { serveRequest(message); return; }
    if (message.kind === "res") {
      var waiter = pending[message.msgId];
      if (waiter) {
        delete pending[message.msgId];
        if (message.ok) { waiter.resolve(message.result); }
        else {
          var error = new Error((message.error && message.error.message) || "bridge error");
          error.code = message.error && message.error.code;
          waiter.reject(error);
        }
      }
      return;
    }
    if (message.kind === "evt") {
      var listeners = evtListeners[message.event];
      if (listeners) { listeners.slice().forEach(function (cb) { cb(message.payload); }); }
    }
  });

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var msgId = nextMsgId++;
      pending[msgId] = { resolve: resolve, reject: reject };
      post({ v: PROTOCOL_V, kind: "req", msgId: msgId, method: method, params: params });
    });
  }
  function onEvent(name, cb) {
    var list = evtListeners[name] || (evtListeners[name] = []);
    list.push(cb);
    return function () {
      var index = list.indexOf(cb);
      if (index >= 0) { list.splice(index, 1); }
    };
  }
  function serveRequest(message) {
    var handler = methods[message.method];
    if (!handler) {
      post({ v: PROTOCOL_V, kind: "res", msgId: message.msgId, ok: false,
        error: { code: "unknown-method", message: "no handler: " + message.method } });
      return;
    }
    Promise.resolve()
      .then(function () { return handler(message.params); })
      .then(function (result) {
        post({ v: PROTOCOL_V, kind: "res", msgId: message.msgId, ok: true, result: result === undefined ? null : result });
      })
      .catch(function (error) {
        post({ v: PROTOCOL_V, kind: "res", msgId: message.msgId, ok: false,
          error: { code: (error && error.code) || "bad-params", message: (error && error.message) || String(error) } });
      });
  }

  onEvent("plugin.command.invoke", function (payload) {
    var registration = commandHandlers[payload.commandId];
    if (registration) {
      Promise.resolve().then(function () { return registration.execute(); }).catch(function () {});
    }
  });
  onEvent("plugin.region.message", function (payload) {
    if (REGION_ID !== null && payload.regionId === REGION_ID) {
      regionListeners.slice().forEach(function (cb) { cb(payload.message); });
    }
  });
  onEvent("app.event.selection:changed", function (payload) {
    var ids = (payload && payload.ids) || [];
    selectionListeners.slice().forEach(function (cb) { cb(ids); });
  });
  onEvent("app.datahub.changed", function (payload) {
    if (!payload) { return; }
    datahubChangeListeners.slice().forEach(function (sub) {
      if (sub.contractId === payload.contractId) { sub.listener(payload.change); }
    });
  });

  var methods = {
    "app.objects.__serve": function (params) {
      var registration = objectRegistrations[params.typeId];
      if (!registration) { throw new Error("unknown object type " + params.typeId); }
      if (params.op === "factory") {
        return Promise.resolve(registration.factory(params.point || { x: 0, y: 0 }));
      }
      if (!registration.renderWidget) { return ""; }
      return Promise.resolve(registration.renderWidget(params.data || {}, {
        width: params.width || 160, height: params.height || 120
      }));
    },
    "app.datahub.__serve": function (params) {
      for (var key in datahubProviders) {
        var provider = datahubProviders[key];
        if (provider && provider.methods && provider.methods.indexOf(params.method) >= 0) {
          return Promise.resolve(provider.query(params.method, params.params));
        }
      }
      throw new Error('no provider serves "' + params.method + '"');
    }
  };

  var app = {
    scene: {
      insertText: function (request) {
        return call("app.scene.insertText", {
          text: request.text, width: request.width, fontSize: request.fontSize,
          position: request.position || null, props: request.props || null,
          select: request.select
        });
      },
      insertFrame: function (request) {
        return call("app.scene.insertFrame", {
          title: request.title, width: request.width, height: request.height,
          position: request.position || null, layout: request.layout || null,
          props: request.props || null
        });
      },
      addLink: function (request) {
        return call("app.scene.addLink", {
          sourceId: request.sourceId, targetId: request.targetId, label: request.label
        });
      },
      listLinks: function (filter) {
        return call("app.scene.listLinks", {
          ownerId: filter && filter.ownerId, sourceId: filter && filter.sourceId,
          targetId: filter && filter.targetId
        });
      },
      removeLinksByOwner: function () { return call("app.scene.removeLinksByOwner", {}); },
      focusObject: function (objectId) { return call("app.scene.focusObject", { objectId: objectId }); },
      notifyInfo: function (message) { return call("app.scene.notifyInfo", { message: message }); }
    },
    commands: {
      register: function (registration) {
        commandHandlers[registration.id] = registration;
        // ONLY serialisable fields cross the bridge (functions cannot
        // be structured-cloned — execute stays plugin-side).
        return call("app.commands.register", {
          id: registration.id,
          titleKey: registration.titleKey,
          icon: registration.icon,
          shortcut: registration.shortcut
        });
      },
      execute: function (commandId) { return call("app.commands.execute", { commandId: commandId }); }
    },
    objects: {
      register: function (registration) {
        objectRegistrations[registration.id] = registration;
        return call("app.objects.register", {
          id: registration.id, titleKey: registration.titleKey, group: registration.group,
          order: registration.order, icon: registration.icon, preview: registration.preview,
          width: registration.width, height: registration.height,
          hasRenderer: typeof registration.renderWidget === "function"
        });
      },
      create: function (localTypeId, point) {
        return call("app.objects.create", { typeId: localTypeId, point: point || null });
      },
      get: function (objectId) { return call("app.objects.get", { objectId: objectId }); },
      list: function () { return call("app.objects.list", {}); },
      update: function (objectId, dataPatch) { return call("app.objects.update", { objectId: objectId, dataPatch: dataPatch }); },
      remove: function (objectId) { return call("app.objects.remove", { objectId: objectId }); }
    },
    selection: {
      ids: function () { return call("app.selection.ids", {}).then(function (r) { return r.ids; }); },
      on: function (cb) { selectionListeners.push(cb); return function () { selectionListeners.splice(selectionListeners.indexOf(cb), 1); }; }
    },
    panels: {
      register: function (registration) { return call("app.panels.register", registration); }
    },
    settings: {
      register: function (registration) { return call("app.settings.register", registration); }
    },
    storage: {
      get: function (key) { return call("app.storage.get", { key: key }).then(function (v) { return v === null ? undefined : v; }); },
      set: function (key, value) { return call("app.storage.set", { key: key, value: value }); },
      "delete": function (key) { return call("app.storage.delete", { key: key }); },
      sql: function (statements) { return call("app.storage.sql", { statements: statements }).then(function (r) { return r.results; }); }
    },
    events: {
      on: function (appEvent, cb) {
        var listeners = evtListeners["app.event." + appEvent] || (evtListeners["app.event." + appEvent] = []);
        listeners.push(cb);
        return call("app.events.subscribe", { event: appEvent }).then(function (result) {
          return function () {
            var index = listeners.indexOf(cb);
            if (index >= 0) { listeners.splice(index, 1); }
            call("app.events.unsubscribe", { subscriptionId: result.subscriptionId }).catch(function () {});
          };
        });
      }
    },
    project: {
      read: function () { return call("app.project.read", {}); },
      write: function (data) { return call("app.project.write", { data: data }); }
    },
    i18n: {
      merge: function (dictionaries) { return call("app.i18n.merge", dictionaries).then(function (r) { return r.conflicts; }); }
    },
    network: {
      fetch: function (url, init) {
        return call("app.network.fetch", {
          url: url,
          init: init ? { method: init.method, headers: init.headers, body: init.body } : null
        });
      }
    },
    datahub: {
      provide: function (provider) {
        datahubProviders[provider.contractId] = provider;
        return call("app.datahub.provide", {
          contractId: provider.contractId, version: provider.version, methods: provider.methods
        });
      },
      query: function (request) { return call("app.datahub.query", request); },
      subscribe: function (request, listener) {
        var sub = { contractId: request.contractId, listener: listener };
        datahubChangeListeners.push(sub);
        return call("app.datahub.subscribe", {
          contractId: request.contractId, versionRange: request.versionRange || "*"
        }).then(function (result) {
          return { ok: result.ok, message: result.message };
        });
      },
      unsubscribe: function (subscriptionId) {
        return call("app.datahub.unsubscribe", { subscriptionId: subscriptionId });
      },
      publish: function (request) {
        return call("app.datahub.publish", { contractId: request.contractId, change: request.change });
      }
    }
  };
  if (REGION_ID !== null) {
    app.region = {
      id: REGION_ID,
      post: function (message) { post({ v: PROTOCOL_V, kind: "evt", event: "host.region.message", payload: { regionId: REGION_ID, message: message } }); },
      onMessage: function (cb) { regionListeners.push(cb); return function () { regionListeners.splice(regionListeners.indexOf(cb), 1); }; }
    };
  }
  window.pluginApp = app;
  window.app = app;

  post({ v: PROTOCOL_V, kind: "ready" });

  var ENTRY_SOURCE = ${JSON.stringify(options.entrySource)};
  try {
    var runner = new Function(
      "app",
      "pluginApp",
      ENTRY_SOURCE + "\\n;\\nif (typeof pluginMain === 'function') { pluginMain(app); }"
    );
    runner(app, app);
  } catch (error) {
    post({ v: PROTOCOL_V, kind: "evt", event: "plugin.crashed",
      payload: { message: (error && error.message) || String(error) } });
  }
})();
`;
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: dark light; }
  html, body { margin: 0; padding: 0; height: 100%; font-family: system-ui, sans-serif; }
  body { overflow: hidden; }
</style>
</head>
<body>
<script>${bootstrap.replace(/<\/script>/gi, "<\\/script>")}</script>
</body>
</html>`;
}

/**
 * Spawns one sandboxed plugin iframe and returns its transport.
 *
 * The iframe is created UNMOUNTED (display:none) — the caller attaches
 * it (headless runtimes) or styles it (regions) as needed.
 *
 * @param manifest - the plugin's manifest.
 * @param options - the spawn options.
 * @returns the sandbox (transport + frame + dispose).
 */
export function spawnSandbox(
  manifest: PluginManifest,
  options: SandboxOptions,
): PluginSandbox {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("title", `sandbox:${manifest.id}`);
  frame.style.display = "none";
  frame.style.border = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.srcdoc = buildSandboxSrcdoc(manifest, options);

  let listener: ((message: MessageEvent) => void) | null = null;
  let disposed = false;

  const transport: BridgeTransport = {
    post(message: BridgeMessage): void {
      if (disposed || frame.contentWindow === null) {
        return;
      }
      frame.contentWindow.postMessage(message, "*");
    },
    onMessage(receive: (message: BridgeMessage) => void): () => void {
      if (listener !== null) {
        window.removeEventListener("message", listener);
      }
      listener = (message: MessageEvent): void => {
        if (disposed || message.source !== frame.contentWindow) {
          return;
        }
        if (!isBridgeMessage(message.data)) {
          return;
        }
        receive(message.data);
      };
      window.addEventListener("message", listener);
      return () => {
        if (listener !== null) {
          window.removeEventListener("message", listener);
          listener = null;
        }
      };
    },
  };

  return {
    transport,
    frame,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      if (listener !== null) {
        window.removeEventListener("message", listener);
        listener = null;
      }
      frame.remove();
    },
  };
}
