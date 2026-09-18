/**
 * Pure AssetStore path algebra (فاز M1 — A.2.1), shared VERBATIM by the
 * web client (`persistence/AssetStore.ts`) and the server routes
 * (`/api/assets/*` + `lib/serverAssets.ts`) so both halves always agree
 * on where an asset lives:
 *
 * - a SAVED project keeps its assets in the sidecar folder
 *   `<projectPath>.assets/` next to the `.icb` file;
 * - imports into a NOT-YET-SAVED project land in the media inbox
 *   (`<root>/media-inbox/`) and are MOVED into the sidecar on the first
 *   Save As (A.2.1);
 * - every asset file is named by its SHA-256 content hash — identical
 *   imports dedupe to one file.
 *
 * Pure string math only (no node:fs, no DOM) — unit-testable anywhere.
 */

/** The sidecar folder suffix appended to a project path. */
export const ASSET_SIDECAR_SUFFIX = ".assets";

/** The media-inbox folder name (the unsaved-project scope). */
export const MEDIA_INBOX_DIR_NAME = "media-inbox";

/** SHA-256 hex-content hashes are 64 lower-case hex characters. */
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Resolves the sidecar directory of a project path.
 *
 * @param projectPath - the absolute `.icb` path.
 * @returns `<projectPath>.assets` (the literal A.2.1 contract).
 */
export function sidecarDirFor(projectPath: string): string {
  return `${projectPath}${ASSET_SIDECAR_SUFFIX}`;
}

/**
 * Resolves the media-inbox directory under a storage root.
 *
 * @param root - the absolute root directory (the server's working area).
 * @returns `<root>/media-inbox`.
 */
export function inboxDirFor(root: string): string {
  return `${root.replace(/[\\/]$/, "")}/${MEDIA_INBOX_DIR_NAME}`;
}

/**
 * @param hash - the candidate content hash.
 * @returns whether it is a well-formed SHA-256 hex hash.
 */
export function isValidAssetHash(hash: string): boolean {
  return HASH_PATTERN.test(hash);
}
