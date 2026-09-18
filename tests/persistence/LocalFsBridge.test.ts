/**
 * Unit tests for the local-filesystem bridge (web-shell half of the
 * "save at an address" system): probe shaping/memoisation, and the typed
 * outcomes of the fetch-based save/load dispatchers. `fetch` is stubbed;
 * the SSR guard (no `window`) is covered explicitly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadViaLocalFsBridge,
  probeLocalFsBridge,
  resetLocalFsBridgeProbe,
  saveViaLocalFsBridge,
} from "@/persistence/LocalFsBridge";

/** JSON `Response` helper. */
const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  resetLocalFsBridgeProbe();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeLocalFsBridge", () => {
  it("returns null during SSR (no window)", async () => {
    expect(await probeLocalFsBridge(true)).toBeNull();
  });

  it("adopts the advertised roots and size cap", async () => {
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        roots: ["/tmp", "/home/z"],
        maxBytes: 1024,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const info = await probeLocalFsBridge(true);
    expect(info).toEqual({ roots: ["/tmp", "/home/z"], maxBytes: 1024 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("memoises the probe (one round-trip per session) unless forced", async () => {
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { ok: true, roots: [], maxBytes: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await probeLocalFsBridge(true);
    await probeLocalFsBridge();
    await probeLocalFsBridge();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await probeLocalFsBridge(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null for non-OK statuses, ok:false bodies and bad shapes", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(404, { ok: false })),
    );
    expect(await probeLocalFsBridge(true)).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { ok: true, roots: "nope", maxBytes: 1 }),
      ),
    );
    expect(await probeLocalFsBridge(true)).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { ok: true, roots: [], maxBytes: "big" }),
      ),
    );
    expect(await probeLocalFsBridge(true)).toBeNull();
  });

  it("returns null when the bridge is unreachable (network error)", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("bridge down");
      }),
    );
    expect(await probeLocalFsBridge(true)).toBeNull();
  });
});

describe("saveViaLocalFsBridge", () => {
  it("resolves the canonical saved path on success", async () => {
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) =>
      jsonResponse(200, { ok: true, path: "/tmp/board.icb", bytes: 42 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await saveViaLocalFsBridge("/tmp/board.icb", "{}");
    expect(result).toEqual({ kind: "saved", path: "/tmp/board.icb" });
    const input = fetchMock.mock.calls[0]?.[0];
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(input).toBe("/api/fs/save");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      path: "/tmp/board.icb",
      contents: "{}",
    });
  });

  it("surfaces the machine-readable error code on rejection", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(400, {
          ok: false,
          error: "outside-roots",
          message: "nope",
        }),
      ),
    );
    const result = await saveViaLocalFsBridge("/etc/board.icb", "{}");
    expect(result).toEqual({ kind: "failed", code: "outside-roots" });
  });

  it("fails with the network code when the bridge is unreachable", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const result = await saveViaLocalFsBridge("/tmp/board.icb", "{}");
    expect(result).toEqual({ kind: "failed", code: "network" });
  });
});

describe("loadViaLocalFsBridge", () => {
  it("delivers the raw payload on success", async () => {
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) =>
      jsonResponse(200, {
        ok: true,
        path: "/tmp/board.icb",
        contents: '{"magic":".icb"}',
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await loadViaLocalFsBridge("/tmp/board.icb");
    expect(result).toEqual({
      kind: "loaded",
      path: "/tmp/board.icb",
      contents: '{"magic":".icb"}',
    });
    const input = fetchMock.mock.calls[0]?.[0];
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(input).toBe("/api/fs/load");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ path: "/tmp/board.icb" });
  });

  it("maps 404 responses onto the not-found code", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(404, { ok: false, error: "not-found", message: "gone" }),
      ),
    );
    const result = await loadViaLocalFsBridge("/tmp/missing.icb");
    expect(result).toEqual({ kind: "failed", code: "not-found" });
  });

  it("fails with the network code when the bridge is unreachable", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const result = await loadViaLocalFsBridge("/tmp/board.icb");
    expect(result).toEqual({ kind: "failed", code: "network" });
  });
});
