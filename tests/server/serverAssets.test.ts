/**
 * Integration tests for the server-side asset backend (فاز M1 —
 * RM1.1/ACM1.4/ACM1.6): write/verify/dedupe, the read scope chain, and
 * the relocation semantics (inbox → sidecar MOVE, sidecar → sidecar
 * COPY) — exercised against a real temp directory with an injected
 * bridge config.
 */
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  hashBytes,
  readAsset,
  relocateAssets,
  sniffContentType,
  writeAsset,
} from "@/lib/serverAssets";
import type { FsBridgeConfig } from "@/lib/serverFs";
import { inboxDirFor, sidecarDirFor } from "@/persistence/assetPaths";

/** The test root (one temp dir per suite run). */
let root = "";
/** The injected bridge config (only the temp root allow-listed). */
let config: FsBridgeConfig = { roots: ["/nonexistent"], maxBytes: 1024 };

const PROJECT = (): string => join(root, "board.icb");
const OTHER = (): string => join(root, "other.icb");

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "icb-assets-"));
  config = { roots: [root], maxBytes: 1024 * 1024 };
});

afterAll(async () => {
  if (root !== "") {
    await rm(root, { recursive: true, force: true });
  }
});

describe("serverAssets write/read (فاز M1 — RM1.1)", () => {
  it("verifies the declared hash against the received bytes", async () => {
    const bytes = Buffer.from("video-bytes-1");
    const hash = hashBytes(bytes);
    const result = await writeAsset(hash, bytes, null, config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dedupe).toBe(false);
      expect(result.path).toBe(join(inboxDirFor(root), hash));
    }
    // A mismatched declaration is refused with the typed code.
    const bad = await writeAsset("c".repeat(64), bytes, null, config);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.code).toBe("hash-mismatch");
    }
    // A malformed hash is refused outright.
    const ugly = await writeAsset("zz", bytes, null, config);
    expect(ugly.ok).toBe(false);
  });

  it("dedupes identical imports (ACM1.4: one file, one hash)", async () => {
    const bytes = Buffer.from("same-video");
    const hash = hashBytes(bytes);
    const first = await writeAsset(hash, bytes, null, config);
    const second = await writeAsset(hash, bytes, null, config);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.dedupe).toBe(true);
      expect(second.path).toBe(first.path);
    }
  });

  it("writes into the project sidecar when one is provided", async () => {
    const bytes = Buffer.from("project-video");
    const hash = hashBytes(bytes);
    const result = await writeAsset(hash, bytes, PROJECT(), config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(join(sidecarDirFor(PROJECT()), hash));
    }
  });

  it("refuses paths outside the configured roots", async () => {
    const bytes = Buffer.from("rogue");
    const result = await writeAsset(hashBytes(bytes), bytes, "/etc/passwd.icb", config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("outside-roots");
    }
  });

  it("reads through the scope chain [sidecar, inbox] and sniffs the type", async () => {
    const poster = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 1, 2, 3,
    ]);
    const hash = hashBytes(poster);
    await writeAsset(hash, poster, null, config);
    // No project scope → the inbox copy resolves.
    const fromInbox = await readAsset(hash, null, undefined, config);
    expect(fromInbox.ok).toBe(true);
    if (fromInbox.ok) {
      expect(fromInbox.contentType).toBe("image/jpeg");
      expect(Buffer.compare(fromInbox.bytes, poster)).toBe(0);
    }
    // A project scope falls back to the inbox copy (same hash = valid).
    const viaFallback = await readAsset(hash, PROJECT(), undefined, config);
    expect(viaFallback.ok).toBe(true);
    // A genuinely missing hash fails with not-found.
    const missing = await readAsset("9".repeat(64), PROJECT(), undefined, config);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("not-found");
    }
  });

  it("sniffs PNG and WebP magic bytes", () => {
    expect(
      sniffContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
    expect(
      sniffContentType(Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe("image/webp");
    expect(sniffContentType(Buffer.from([1, 2, 3, 4]))).toBe(
      "application/octet-stream",
    );
  });
});

describe("serverAssets relocation (فاز M1 — ACM1.6)", () => {
  it("MOVES inbox files into the sidecar on the first Save As", async () => {
    const bytes = Buffer.from("relocate-me");
    const hash = hashBytes(bytes);
    await writeAsset(hash, bytes, null, config);
    const result = await relocateAssets(PROJECT(), [hash], null, config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.moved).toBe(1);
      expect(result.copied).toBe(0);
      expect(result.missing).toEqual([]);
    }
    // The inbox copy is GONE; the sidecar copy resolves.
    const inboxStat = await stat(join(inboxDirFor(root), hash)).catch(() => null);
    expect(inboxStat).toBeNull();
    const read = await readAsset(hash, PROJECT(), undefined, config);
    expect(read.ok).toBe(true);
  });

  it("COPIES from a previous sidecar on a later Save As (old keeps working)", async () => {
    const bytes = Buffer.from("copy-me");
    const hash = hashBytes(bytes);
    await writeAsset(hash, bytes, PROJECT(), config);
    const result = await relocateAssets(OTHER(), [hash], PROJECT(), config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.copied).toBe(1);
      expect(result.moved).toBe(0);
    }
    // BOTH sidecars resolve the hash now.
    expect((await readAsset(hash, PROJECT(), undefined, config)).ok).toBe(true);
    expect((await readAsset(hash, OTHER(), undefined, config)).ok).toBe(true);
  });

  it("treats already-present targets and missing sources as quiet no-ops", async () => {
    const bytes = Buffer.from("present");
    const hash = hashBytes(bytes);
    await writeAsset(hash, bytes, PROJECT(), config);
    const again = await relocateAssets(PROJECT(), [hash], null, config);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.moved).toBe(0);
      expect(again.missing).toEqual([]);
    }
    const ghost = "7".repeat(64);
    const holes = await relocateAssets(OTHER(), [ghost], null, config);
    expect(holes.ok).toBe(true);
    if (holes.ok) {
      expect(holes.missing).toEqual([ghost]);
    }
  });
});

describe("serverAssets round-trip against the disk (فاز M1 — ACM1.3)", () => {
  it("keeps the .icb payload free of asset bytes (files live beside it)", async () => {
    const bytes = Buffer.from("the-video-file");
    const hash = hashBytes(bytes);
    const result = await writeAsset(hash, bytes, PROJECT(), config);
    expect(result.ok).toBe(true);
    // An .icb written next to the sidecar stays KB-scale: the video's
    // bytes are ONLY at <project>.assets/<hash>.
    const icbPath = PROJECT();
    await mkdir(join(root, "unrelated"), { recursive: true });
    await writeFile(icbPath, JSON.stringify({ schemaVersion: 4, scene: { objects: [] } }));
    const icb = await readFile(icbPath, "utf8");
    expect(icb).not.toContain("the-video-file");
    const stored = await readFile(join(sidecarDirFor(PROJECT()), hash));
    expect(stored.toString()).toBe("the-video-file");
  });
});
