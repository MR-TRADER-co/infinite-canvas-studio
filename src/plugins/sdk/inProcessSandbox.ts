/**
 * In-process sandbox factory (the test + node harness for the plugin
 * runtime): pairs an in-process transport with the CANONICAL TS SDK
 * shim and runs the plugin's entry through `new Function` — the exact
 * execution contract of the browser srcdoc bootstrap (docs/SEAMS.md
 * §9: `pluginMain(app)` / global `app`).
 *
 * Security note: this harness does NOT sandbox (it runs in the host's
 * JS context); it exists so the protocol/SDK surface is exercised with
 * the REAL entry source in unit tests. The browser always uses the
 * iframe {@link spawnSandbox} (opaque origin, `allow-scripts` only).
 */
import {
  createInProcessTransportPair,
  type BridgeTransport,
} from "@/plugins/protocol";
import { createPluginSdk } from "@/plugins/sdk/createPluginSdk";
import type { InstalledPluginRecord } from "@/plugins/host/PluginStore";

/** One in-process sandbox spawn. */
export interface InProcessSandbox {
  readonly transport: BridgeTransport;
  dispose(): void;
}

/**
 * Creates the sandbox factory the LifecycleManager uses in tests (and
 * any non-DOM host).
 *
 * @returns the factory (record + regionId → sandbox).
 */
export function createInProcessSandboxFactory(): (
  record: InstalledPluginRecord,
  regionId: string | null,
) => InProcessSandbox {
  return (record: InstalledPluginRecord, regionId: string | null) => {
    const { a, b } = createInProcessTransportPair();
    // Side A = the host; side B = the plugin. The plugin side waits for
    // the host's `hello` BEFORE running anything (the browser bootstrap
    // loads inside an iframe that only exists once the host spawned it —
    // deferring mirrors that ordering; the host's handshake listener is
    // up first, so early RPC frames are never lost).
    const detachBootstrap = b.onMessage((message) => {
      if (message.kind !== "hello") {
        return;
      }
      detachBootstrap();
      const { app, notifyReady } = createPluginSdk(b, {
        pluginId: record.manifest.id,
        sdkMajor: 1,
        regionId,
      });
      notifyReady();
      const crash = runEntrySource(app, record.entrySource);
      if (crash !== null) {
        // The browser bootstrap posts the same frame; the runtime's
        // crash listener lands it in its error surface (AC9.3).
        b.post({
          v: 1,
          kind: "evt",
          event: "plugin.crashed",
          payload: { message: crash.message },
        });
      }
    });
    return {
      transport: a,
      dispose(): void {
        // The in-process peer pair is garbage-collected with the
        // transport references.
      },
    };
  };
}

/**
 * Runs one plugin entry source the way the browser bootstrap does.
 *
 * @param app - the SDK surface.
 * @param entrySource - the entry JS source (verbatim).
 * @returns the crash error when the entry threw, or null.
 */
export function runEntrySource(
  app: unknown,
  entrySource: string,
): Error | null {
  try {
    const runner = new Function(
      "app",
      "pluginApp",
      `${entrySource}\n;\nif (typeof pluginMain === "function") { pluginMain(app); }`,
    );
    runner(app, app);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
