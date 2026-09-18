/**
 * Unit tests for the server half of the local filesystem bridge: the path
 * guard policy (quote stripping, tilde expansion, root containment with a
 * separator boundary, the .icb extension policy) and the save/load
 * round-trip on a real temp directory — the contract the `/api/fs/*`
 * routes expose to the web shell.
 */
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bridgeHttpStatus,
  defaultBridgeConfig,
  loadBridgeFile,
  normalizeBridgePath,
  saveBridgeFile,
  type FsBridgeConfig,
} from "@/lib/serverFs";
import { VersionedSerializer } from "@/persistence/VersionedSerializer";

/** A valid `.icb` envelope for round-trip tests. */
const serializer = new VersionedSerializer();
const envelope = serializer.serialize({
  camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
  objects: [],
});

/** Guard-only config (no I/O — pure prefix arithmetic). */
const guardConfig: FsBridgeConfig = {
  roots: ["/allowed", "/home/z"],
  maxBytes: 1024,
};

/** Real temp-directory config for round-trip tests (created in beforeAll). */
let sandbox = "";
let ioConfig: FsBridgeConfig;

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "ics-bridge-"));
  ioConfig = { roots: [sandbox], maxBytes: 1024 * 1024 };
});

afterAll(async () => {
  if (sandbox !== "") {
    await rm(sandbox, { recursive: true, force: true });
  }
});

describe("normalizeBridgePath — the guard policy", () => {
  it("strips surrounding double quotes (Windows Copy-as-path)", () => {
    expect(normalizeBridgePath('"/allowed/board.icb"', guardConfig)).toEqual({
      ok: true,
      path: "/allowed/board.icb",
    });
  });

  it("expands a leading tilde into the injected home directory", () => {
    expect(normalizeBridgePath("~/board", guardConfig, "/home/z")).toEqual({
      ok: true,
      path: "/home/z/board.icb",
    });
    expect(normalizeBridgePath("~/board.icb", guardConfig, "/home/z")).toEqual({
      ok: true,
      path: "/home/z/board.icb",
    });
    // An expansion landing outside the roots is still refused.
    expect(
      normalizeBridgePath("~/board", guardConfig, "/elsewhere"),
    ).toMatchObject({
      ok: false,
      code: "outside-roots",
    });
  });

  it("enforces the .icb extension (append when missing, replace foreign)", () => {
    expect(normalizeBridgePath("/allowed/board", guardConfig)).toEqual({
      ok: true,
      path: "/allowed/board.icb",
    });
    expect(normalizeBridgePath("/allowed/board.txt", guardConfig)).toEqual({
      ok: true,
      path: "/allowed/board.icb",
    });
    expect(normalizeBridgePath("/allowed/ARCHIVE.TAR.GZ", guardConfig)).toEqual(
      {
        ok: true,
        path: "/allowed/ARCHIVE.TAR.icb",
      },
    );
    expect(normalizeBridgePath("/allowed/.icb", guardConfig)).toEqual({
      ok: true,
      path: "/allowed/.icb",
    });
  });

  it("rejects empty, relative and directory-only input", () => {
    expect(normalizeBridgePath("   ", guardConfig).ok).toBe(false);
    expect(
      normalizeBridgePath("relative/board.icb", guardConfig),
    ).toMatchObject({
      ok: false,
      code: "not-absolute",
    });
    expect(normalizeBridgePath("/allowed/", guardConfig)).toMatchObject({
      ok: false,
      code: "invalid-path",
    });
  });

  it("rejects forbidden and control characters", () => {
    expect(
      normalizeBridgePath("/allowed/bo?ard.icb", guardConfig),
    ).toMatchObject({
      ok: false,
      code: "invalid-path",
    });
    expect(
      normalizeBridgePath("/allowed/bo\u0000ard.icb", guardConfig),
    ).toMatchObject({
      ok: false,
      code: "invalid-path",
    });
  });

  it("keeps writes inside the roots (separator boundary + traversal)", () => {
    // Prefix spoof: /home/zombie is NOT inside /home/z.
    expect(
      normalizeBridgePath("/home/zombie/board.icb", guardConfig),
    ).toMatchObject({
      ok: false,
      code: "outside-roots",
    });
    // Traversal collapses before the containment check.
    expect(
      normalizeBridgePath("/allowed/../secret.icb", guardConfig),
    ).toMatchObject({
      ok: false,
      code: "outside-roots",
    });
    // The root itself would become a sibling file → outside.
    expect(normalizeBridgePath("/allowed", guardConfig)).toMatchObject({
      ok: false,
      code: "outside-roots",
    });
    // Deep nesting inside a root passes.
    expect(
      normalizeBridgePath("/allowed/nested/deep/board.icb", guardConfig),
    ).toEqual({
      ok: true,
      path: "/allowed/nested/deep/board.icb",
    });
  });
});

describe("saveBridgeFile / loadBridgeFile — the round-trip contract", () => {
  it("writes an .icb payload with parent directories and reads it back", async () => {
    const path = join(sandbox, "nested", "deep", "board.icb");
    const saved = await saveBridgeFile(path, envelope, ioConfig);
    expect(saved).toMatchObject({
      ok: true,
      path,
      bytes: Buffer.byteLength(envelope, "utf8"),
    });
    await expect(readFile(path, "utf8")).resolves.toBe(envelope);

    const loaded = await loadBridgeFile(path, ioConfig);
    expect(loaded).toMatchObject({ ok: true, path, contents: envelope });
    expect(loaded.ok && Number.isFinite(loaded.modifiedAt)).toBe(true);
  });

  it("refuses to write payloads without the .icb magic", async () => {
    const path = join(sandbox, "junk.icb");
    const result = await saveBridgeFile(path, '{"magic":"nope"}', ioConfig);
    expect(result).toMatchObject({ ok: false, code: "not-icb" });
    await expect(stat(path)).rejects.toThrow();
  });

  it("refuses payloads above the configured size cap", async () => {
    const tiny: FsBridgeConfig = { roots: [sandbox], maxBytes: 8 };
    const result = await saveBridgeFile(
      join(sandbox, "big.icb"),
      envelope,
      tiny,
    );
    expect(result).toMatchObject({ ok: false, code: "too-large" });
  });

  it("reports missing files as not-found", async () => {
    const result = await loadBridgeFile(join(sandbox, "missing.icb"), ioConfig);
    expect(result).toMatchObject({ ok: false, code: "not-found" });
  });

  it("reports directories masquerading as files", async () => {
    const dirPath = join(sandbox, "dir.icb");
    await mkdir(dirPath, { recursive: true });
    const result = await loadBridgeFile(dirPath, ioConfig);
    expect(result).toMatchObject({ ok: false, code: "not-a-file" });
  });

  it("refuses hand-written junk that slips past the extension", async () => {
    const path = join(sandbox, "spoof.icb");
    await writeFile(path, "not json at all", "utf8");
    const result = await loadBridgeFile(path, ioConfig);
    expect(result).toMatchObject({ ok: false, code: "not-icb" });
  });
});

describe("bridgeHttpStatus — the route status mapping", () => {
  it("maps failure families onto HTTP statuses", () => {
    expect(bridgeHttpStatus("not-found")).toBe(404);
    expect(bridgeHttpStatus("too-large")).toBe(413);
    expect(bridgeHttpStatus("not-icb")).toBe(422);
    expect(bridgeHttpStatus("write-failed")).toBe(500);
    expect(bridgeHttpStatus("read-failed")).toBe(500);
    expect(bridgeHttpStatus("invalid-path")).toBe(400);
    expect(bridgeHttpStatus("outside-roots")).toBe(400);
    expect(bridgeHttpStatus("not-absolute")).toBe(400);
    expect(bridgeHttpStatus("bad-payload")).toBe(400);
  });
});

describe("defaultBridgeConfig (machine roots)", () => {
  it("advertises resolved, de-duplicated roots including the temp dir", () => {
    const config = defaultBridgeConfig();
    expect(config.roots).toContain(resolve(tmpdir()));
    expect(config.maxBytes).toBeGreaterThan(0);
    const unique = new Set(config.roots);
    expect(unique.size).toBe(config.roots.length);
  });
});
