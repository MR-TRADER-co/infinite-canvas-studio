/**
 * Unit tests for the WebAssetStore client (فاز M1 — RM1.1/ACM1.6):
 * scope switching, the Save-As relocation contract (inbox → sidecar
 * MOVE; old sidecar → new sidecar COPY; same path no-op), URL building
 * and write-failure surfaces — all against a stubbed fetch layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebAssetStore, hashAssetBytes } from "@/persistence/AssetStore";

/** One recorded fetch call. */
interface Call {
  readonly url: string;
  readonly init?: RequestInit;
}

/** Builds a stubbed fetch with per-URL responders. */
function stubFetch(
  respond: (call: Call) => { status: number; body: unknown },
): Call[] {
  const calls: Call[] = [];
  const fake = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), init };
    calls.push(call);
    const { status, body } = respond(call);
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status },
    );
  });
  vi.stubGlobal("fetch", fake);
  return calls;
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
/** The REAL SHA-256 of the single byte 0x09 (what writeAsset computes). */
const REAL_9 =
  "2b4c342f5433ebe591a1da77e013d1b72475562d48578dca8b84bac6651c3cb9";

describe("WebAssetStore (فاز M1 — RM1.1)", () => {
  beforeEach(() => {
    // Web Crypto digest is available in the node test runtime.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hashes payloads with Web Crypto (SHA-256 hex)", async () => {
    const digest = await hashAssetBytes(
      new Blob([new Uint8Array([1, 2, 3])]),
    );
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // SHA-256 of 0x010203 — a stable vector.
    expect(digest).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
  });

  it("writes into the INBOX scope when no project is set", async () => {
    const store = new WebAssetStore();
    const calls = stubFetch(() => ({
      status: 200,
      body: { ok: true, hash: REAL_9, path: "/tmp/media-inbox/aa", dedupe: false },
    }));
    const hash = await store.writeAsset(new Blob([new Uint8Array([9])]));
    expect(hash).toBe(REAL_9);
    expect(calls[0]?.url).toBe(`/api/assets/write?hash=${REAL_9}`);
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("writes into the project SIDECAR scope once a path is adopted", async () => {
    const store = new WebAssetStore();
    store.setProjectPath("/home/z/board.icb");
    const calls = stubFetch(() => ({
      status: 200,
      body: { ok: true, hash: REAL_9, dedupe: true },
    }));
    await store.writeAsset(new Blob([new Uint8Array([9])]));
    expect(calls[0]?.url).toBe(
      `/api/assets/write?hash=${REAL_9}&project=${encodeURIComponent("/home/z/board.icb")}`,
    );
  });

  it("fails the write when the server hash-check rejects (never trusts a mismatch)", async () => {
    const store = new WebAssetStore();
    stubFetch(() => ({ status: 413, body: { ok: false, code: "hash-mismatch" } }));
    const hash = await store.writeAsset(new Blob([new Uint8Array([9])]));
    expect(hash).toBeNull();
  });

  it("relocates inbox files on the FIRST Save As (from: null → move)", async () => {
    const store = new WebAssetStore();
    const calls = stubFetch(() => ({
      status: 200,
      body: { ok: true, moved: 2, copied: 0, missing: [] },
    }));
    const outcome = await store.syncProjectPath("/home/z/board.icb", [
      HASH_A,
      HASH_B,
    ]);
    expect(outcome.relocated).toBe(true);
    expect(outcome.missing).toEqual([]);
    expect(store.currentProjectPath()).toBe("/home/z/board.icb");
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toEqual({ from: null, to: "/home/z/board.icb", hashes: [HASH_A, HASH_B] });
  });

  it("copies from the previous sidecar on a LATER Save As", async () => {
    const store = new WebAssetStore();
    store.setProjectPath("/home/z/old.icb");
    const calls = stubFetch(() => ({
      status: 200,
      body: { ok: true, moved: 0, copied: 1, missing: [] },
    }));
    await store.syncProjectPath("/home/z/new.icb", [HASH_A]);
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.from).toBe("/home/z/old.icb");
    expect(body.to).toBe("/home/z/new.icb");
  });

  it("short-circuits a same-path adoption without any network call", async () => {
    const store = new WebAssetStore();
    store.setProjectPath("/home/z/board.icb");
    const calls = stubFetch(() => ({ status: 200, body: { ok: true } }));
    const outcome = await store.syncProjectPath("/home/z/board.icb", [HASH_A]);
    expect(outcome.relocated).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("skips the relocation round-trip when no hashes ride along (open flow)", async () => {
    const store = new WebAssetStore();
    const calls = stubFetch(() => ({ status: 200, body: { ok: true } }));
    const outcome = await store.syncProjectPath("/home/z/opened.icb", []);
    expect(outcome.relocated).toBe(true);
    expect(calls).toHaveLength(0);
    expect(store.currentProjectPath()).toBe("/home/z/opened.icb");
  });

  it("builds immutable read URLs scoped to the current project", () => {
    const store = new WebAssetStore();
    expect(store.assetUrl(HASH_A)).toBe(`/api/assets/read?hash=${HASH_A}`);
    store.setProjectPath("/home/z/board.icb");
    expect(store.assetUrl(HASH_A)).toBe(
      `/api/assets/read?hash=${HASH_A}&project=${encodeURIComponent("/home/z/board.icb")}`,
    );
    expect(store.assetUrl(HASH_A, "image/jpeg")).toContain("mime=image%2Fjpeg");
    expect(store.assetUrl("not-a-hash")).toBeNull();
  });

  it("probes existence through the read route (200 ⇒ present)", async () => {
    const store = new WebAssetStore();
    stubFetch(({ url }) => ({
      status: url.includes(HASH_A) ? 200 : 404,
      body: url.includes(HASH_A)
        ? { ok: true, hash: HASH_A }
        : { ok: false, code: "not-found" },
    }));
    expect(await store.exists(HASH_A)).toBe(true);
    expect(await store.exists(HASH_B)).toBe(false);
    expect(await store.exists("nope")).toBe(false);
  });
});
