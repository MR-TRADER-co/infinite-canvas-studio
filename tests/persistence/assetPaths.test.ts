/**
 * Unit tests for the pure AssetStore path algebra (فاز M1 — RM1.1):
 * the sidecar derivation, the inbox home and the hash validation shared
 * VERBATIM by the client store and the server routes.
 */
import { describe, expect, it } from "vitest";
import {
  ASSET_SIDECAR_SUFFIX,
  MEDIA_INBOX_DIR_NAME,
  inboxDirFor,
  isValidAssetHash,
  sidecarDirFor,
} from "@/persistence/assetPaths";

describe("assetPaths (فاز M1 — RM1.1)", () => {
  it("derives the sidecar as <projectPath>.assets (the literal A.2.1 contract)", () => {
    expect(sidecarDirFor("/home/z/projects/board.icb")).toBe(
      "/home/z/projects/board.icb.assets",
    );
    expect(ASSET_SIDECAR_SUFFIX).toBe(".assets");
  });

  it("derives the media inbox under a storage root (trailing separators tolerated)", () => {
    expect(inboxDirFor("/tmp")).toBe(`/tmp/${MEDIA_INBOX_DIR_NAME}`);
    expect(inboxDirFor("/tmp/")).toBe(`/tmp/${MEDIA_INBOX_DIR_NAME}`);
    expect(MEDIA_INBOX_DIR_NAME).toBe("media-inbox");
  });

  it("validates 64-character lower-case hex hashes", () => {
    expect(isValidAssetHash("a".repeat(64))).toBe(true);
    expect(isValidAssetHash("0123456789abcdef".repeat(4))).toBe(true);
    expect(isValidAssetHash("A".repeat(64))).toBe(false);
    expect(isValidAssetHash("a".repeat(63))).toBe(false);
    expect(isValidAssetHash("")).toBe(false);
    expect(isValidAssetHash("zzzz")).toBe(false);
  });
});
