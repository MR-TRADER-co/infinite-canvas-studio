/**
 * فاز D1 — the desktop AssetStore twin's unit tests: chunked IPC writes,
 * the sync `icbasset` URL builder, scope switching (sidecar vs inbox)
 * and the A.2.1 move/copy relocation semantics — all against a mocked
 * `@tauri-apps/api/core` (the TauriAppDataStorage test precedent).
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { Buffer } from "node:buffer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  TauriAssetStore,
  desktopAssetUrl,
} from "@/persistence/TauriAssetStore";
import { sidecarDirFor } from "@/persistence/assetPaths";

/** A deterministic pseudo-random payload of an exact byte length. */
function payloadOf(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  let state = 0x2f6e2f1d;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

/** The sha-256 hex digest of a payload (the store's naming rule). */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktopAssetUrl (the sync protocol URL builder)", () => {
  it("uses the injected convertFileSrc with the icbasset protocol", () => {
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        convertFileSrc: (path: string, protocol?: string) =>
          `mock://${protocol ?? "asset"}/${path}`,
      },
    });
    expect(desktopAssetUrl("ab", "?mime=image/jpeg")).toBe(
      "mock://icbasset/ab?mime=image/jpeg",
    );
  });

  it("falls back to the Windows http form when internals are absent", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    expect(desktopAssetUrl("ab", "")).toBe("http://icbasset.localhost/ab");
  });

  it("falls back to the unix scheme form on non-Windows agents", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });
    expect(desktopAssetUrl("ab", "?project=%2Fa.icb")).toBe(
      "icbasset://localhost/ab?project=%2Fa.icb",
    );
  });
});

describe("TauriAssetStore.assetUrl", () => {
  it("refuses malformed hashes (null, the web twin's contract)", () => {
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        convertFileSrc: (path: string, protocol?: string) =>
          `mock://${protocol}/${path}`,
      },
    });
    const store = new TauriAssetStore();
    expect(store.assetUrl("not-a-hash")).toBeNull();
  });

  it("carries the project scope and MIME as the query", () => {
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        convertFileSrc: (path: string, protocol?: string) =>
          `mock://${protocol}/${path}`,
      },
    });
    const hash = "a".repeat(64);
    const store = new TauriAssetStore();
    store.setProjectPath("C:\\b\\board.icb");
    const url = store.assetUrl(hash, "application/pdf");
    expect(url).toContain(`mock://icbasset/${hash}`);
    expect(url).toContain("project=C%3A%5Cb%5Cboard.icb");
    expect(url).toContain("mime=application%2Fpdf");
  });

  it("omits the project query for the inbox scope", () => {
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        convertFileSrc: (path: string) => `mock://icbasset/${path}`,
      },
    });
    const store = new TauriAssetStore();
    expect(store.assetUrl("b".repeat(64))).toBe(
      `mock://icbasset/${"b".repeat(64)}`,
    );
  });
});

describe("TauriAssetStore.writeAsset (chunked IPC)", () => {
  it("streams a 4 MiB + 128 blob as two chunks with correct offsets", async () => {
    vi.stubGlobal("window", {});
    const bytes = payloadOf(4 * 1024 * 1024 + 128);
    const blob = new Blob([bytes]);
    const store = new TauriAssetStore();

    const hash = await store.writeAsset(blob);

    expect(hash).toBe(await sha256Hex(bytes));
    expect(invokeMock).toHaveBeenCalledTimes(2);
    const first = invokeMock.mock.calls[0];
    const second = invokeMock.mock.calls[1];
    const firstArgs = (first?.[1] ?? {}) as Record<string, unknown>;
    const secondArgs = (second?.[1] ?? {}) as Record<string, unknown>;
    expect(first?.[0]).toBe("asset_write_chunk");
    expect(firstArgs).toMatchObject({ hash, offset: 0, scope: null });
    expect(secondArgs).toMatchObject({
      hash,
      offset: 4 * 1024 * 1024,
      scope: null,
    });
    // The base64 payloads round-trip to the exact slices.
    const firstBytes = Buffer.from(String(firstArgs.contents), "base64");
    const secondBytes = Buffer.from(String(secondArgs.contents), "base64");
    expect(firstBytes.length).toBe(4 * 1024 * 1024);
    expect(secondBytes.length).toBe(128);
    expect(
      firstBytes.equals(Buffer.from(bytes.subarray(0, 4 * 1024 * 1024))),
    ).toBe(true);
    expect(
      secondBytes.equals(Buffer.from(bytes.subarray(4 * 1024 * 1024))),
    ).toBe(true);
  });

  it("writes into the sidecar scope once a project path is adopted", async () => {
    vi.stubGlobal("window", {});
    const store = new TauriAssetStore();
    store.setProjectPath("/home/u/board.icb");
    const hash = await store.writeAsset(new Blob([payloadOf(1024)]));
    expect(hash).not.toBeNull();
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      scope: sidecarDirFor("/home/u/board.icb"),
    });
  });

  it("returns null over the size cap, with zero IPC calls", async () => {
    vi.stubGlobal("window", {});
    const store = new TauriAssetStore();
    // The size gate fires before any hashing/IPC — a size-only stub is
    // the exact contract surface.
    const huge = { size: 512 * 1024 * 1024 + 1 } as Blob;
    expect(await store.writeAsset(huge)).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("degrades to null when a chunk write fails", async () => {
    vi.stubGlobal("window", {});
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    const store = new TauriAssetStore();
    expect(await store.writeAsset(new Blob([payloadOf(64)]))).toBeNull();
  });
});

describe("TauriAssetStore.exists", () => {
  it("refuses malformed hashes without IPC", async () => {
    const store = new TauriAssetStore();
    expect(await store.exists("zz")).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("probes the current scope chain through asset_exists", async () => {
    vi.stubGlobal("window", {});
    invokeMock.mockResolvedValueOnce(true);
    const store = new TauriAssetStore();
    store.setProjectPath("/p/board.icb");
    expect(await store.exists("c".repeat(64))).toBe(true);
    expect(invokeMock.mock.calls[0]).toEqual([
      "asset_exists",
      { scope: sidecarDirFor("/p/board.icb"), hash: "c".repeat(64) },
    ]);
  });

  it("treats an IPC failure as absent", async () => {
    vi.stubGlobal("window", {});
    invokeMock.mockRejectedValueOnce(new Error("no shell"));
    const store = new TauriAssetStore();
    expect(await store.exists("d".repeat(64))).toBe(false);
  });
});

describe("TauriAssetStore.syncProjectPath (A.2.1 relocation)", () => {
  const hash = "e".repeat(64);

  it("MOVES the inbox into the sidecar on the first Save As", async () => {
    vi.stubGlobal("window", {});
    invokeMock.mockResolvedValueOnce([]);
    const store = new TauriAssetStore();
    const outcome = await store.syncProjectPath("/q/first.icb", [hash]);
    expect(outcome).toEqual({ relocated: true, missing: [] });
    expect(invokeMock.mock.calls[0]).toEqual([
      "asset_relocate",
      {
        fromScope: null,
        toScope: sidecarDirFor("/q/first.icb"),
        hashes: [hash],
        mode: "move",
      },
    ]);
  });

  it("COPIES between sidecars on later Save As (old project resolves)", async () => {
    vi.stubGlobal("window", {});
    invokeMock.mockResolvedValueOnce([]);
    const store = new TauriAssetStore();
    store.setProjectPath("/q/first.icb");
    await store.syncProjectPath("/q/second.icb", [hash]);
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      fromScope: sidecarDirFor("/q/first.icb"),
      toScope: sidecarDirFor("/q/second.icb"),
      mode: "copy",
    });
  });

  it("is a no-op when the path is unchanged", async () => {
    vi.stubGlobal("window", {});
    const store = new TauriAssetStore();
    store.setProjectPath("/q/first.icb");
    const outcome = await store.syncProjectPath("/q/first.icb", [hash]);
    expect(outcome).toEqual({ relocated: true, missing: [] });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reports the missing hashes when relocation reports them", async () => {
    vi.stubGlobal("window", {});
    invokeMock.mockResolvedValueOnce(["f".repeat(64)]);
    const store = new TauriAssetStore();
    const outcome = await store.syncProjectPath("/q/new.icb", [
      hash,
      "f".repeat(64),
    ]);
    expect(outcome).toEqual({
      relocated: true,
      missing: ["f".repeat(64)],
    });
  });

  it("degrades to a failed relocation on IPC errors", async () => {
    vi.stubGlobal("window", {});
    invokeMock.mockRejectedValueOnce(new Error("no shell"));
    const store = new TauriAssetStore();
    const outcome = await store.syncProjectPath("/q/new.icb", [hash]);
    expect(outcome).toEqual({ relocated: false, missing: [hash] });
  });
});
