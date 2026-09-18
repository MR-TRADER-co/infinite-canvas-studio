import { describe, expect, it } from "vitest";
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeRpcError,
  RpcPeer,
  createInProcessTransportPair,
  isBridgeMessage,
  type BridgeMessage,
} from "@/plugins/protocol";

describe("Bridge protocol (R9.2)", () => {
  it("accepts every well-formed message family", () => {
    const messages: BridgeMessage[] = [
      {
        v: BRIDGE_PROTOCOL_VERSION,
        kind: "hello",
        pluginId: "acme",
        sdkMajor: 1,
        regionId: null,
        host: "test",
      },
      { v: BRIDGE_PROTOCOL_VERSION, kind: "ready" },
      {
        v: BRIDGE_PROTOCOL_VERSION,
        kind: "req",
        msgId: 1,
        method: "a.b",
        params: {},
      },
      {
        v: BRIDGE_PROTOCOL_VERSION,
        kind: "res",
        msgId: 1,
        ok: true,
        result: 7,
      },
      {
        v: BRIDGE_PROTOCOL_VERSION,
        kind: "res",
        msgId: 2,
        ok: false,
        error: { code: "permission-denied", message: "no" },
      },
      { v: BRIDGE_PROTOCOL_VERSION, kind: "evt", event: "e", payload: null },
    ];
    for (const message of messages) {
      expect(isBridgeMessage(message)).toBe(true);
    }
  });

  it("rejects malformed / wrong-version frames (fail-closed)", () => {
    expect(isBridgeMessage(null)).toBe(false);
    expect(isBridgeMessage("req")).toBe(false);
    expect(isBridgeMessage({ v: 2, kind: "ready" })).toBe(false);
    expect(isBridgeMessage({ v: 1, kind: "wat" })).toBe(false);
    expect(isBridgeMessage({ v: 1, kind: "req", msgId: "x", method: 1 })).toBe(
      false,
    );
    expect(isBridgeMessage({ v: 1, kind: "res", msgId: 1 })).toBe(false);
  });

  it("round-trips an RPC call through the in-process pair", async () => {
    const { a, b } = createInProcessTransportPair();
    const host = new RpcPeer(a, "host");
    const plugin = new RpcPeer(b, "plugin");
    host.handle("app.echo", (params) => ({ echo: params }));
    const result = (await plugin.call("app.echo", { ping: 1 })) as {
      echo: { ping: number };
    };
    expect(result.echo.ping).toBe(1);
  });

  it("maps remote errors to typed BridgeRpcError", async () => {
    const { a, b } = createInProcessTransportPair();
    const host = new RpcPeer(a, "host");
    const plugin = new RpcPeer(b, "plugin");
    host.handle("app.deny", () => {
      throw new BridgeRpcError("permission-denied", "مجوز داده نشده");
    });
    await expect(plugin.call("app.deny", {})).rejects.toMatchObject({
      code: "permission-denied",
      message: "مجوز داده نشده",
    });
  });

  it("answers unknown methods with a typed error", async () => {
    const { a, b } = createInProcessTransportPair();
    const _host = new RpcPeer(a, "host");
    const plugin = new RpcPeer(b, "plugin");
    await expect(plugin.call("app.nope", {})).rejects.toMatchObject({
      code: "unknown-method",
    });
  });

  it("rejects pending calls on teardown (a dead plugin never hangs the host)", async () => {
    const { a, b } = createInProcessTransportPair();
    const _host = new RpcPeer(a, "host");
    const plugin = new RpcPeer(b, "plugin");
    const pending = plugin.call("app.slow", {});
    plugin.teardown();
    await expect(pending).rejects.toMatchObject({ code: "plugin-dead" });
    expect(plugin.isTorn).toBe(true);
    expect(plugin.pendingCount).toBe(0);
  });

  it("delivers one-way events in both directions", async () => {
    const { a, b } = createInProcessTransportPair();
    const host = new RpcPeer(a, "host");
    const plugin = new RpcPeer(b, "plugin");
    const seen: string[] = [];
    plugin.on("app.event.scene:changed", (payload) => {
      seen.push(String((payload as { revision: number }).revision));
    });
    host.on("plugin.command.invoke", (payload) => {
      seen.push((payload as { commandId: string }).commandId);
    });
    host.emit("app.event.scene:changed", { revision: 3 });
    plugin.emit("plugin.command.invoke", { commandId: "insertStar" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Both directions delivered (cross-direction order is not guaranteed).
    expect(seen.sort()).toEqual(["3", "insertStar"]);
  });

  it("does not synchronously recurse when a handler posts back", async () => {
    const { a, b } = createInProcessTransportPair();
    const host = new RpcPeer(a, "host");
    const plugin = new RpcPeer(b, "plugin");
    let depth = 0;
    let maxDepth = 0;
    host.handle("app.ping", async () => {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      if (depth < 3) {
        await host.call("plugin.pong", {});
      }
      depth -= 1;
      return depth;
    });
    plugin.handle("plugin.pong", () => {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      depth -= 1;
      return null;
    });
    await plugin.call("app.ping", {});
    // No synchronous recursion blew the stack (depth stayed tiny).
    expect(maxDepth).toBeLessThan(5);
  });
});
