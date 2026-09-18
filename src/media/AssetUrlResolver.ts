/**
 * Asset URL resolver seam (فاز M1): the tiny module that lets the
 * RENDERER resolve content hashes into loadable URLs WITHOUT importing
 * the composition root (which would cycle: App → CanvasSurface →
 * renderer → App).
 *
 * The boot sequence installs the AssetStore-backed delegate once
 * (`setAssetUrlResolver`); the renderer (and the export preload path)
 * resolve through {@link assetUrlOf}. Until boot — and in unit tests —
 * the resolver is null and posters render as the dashed placeholder,
 * exactly like a missing asset.
 */

/** The delegate: hash (+ optional MIME hint) → same-origin URL, or null. */
export type AssetUrlResolver = (hash: string, mime?: string) => string | null;

/** The installed delegate (null until the composition root boots). */
let delegate: AssetUrlResolver | null = null;

/**
 * Installs (or clears) the resolver delegate.
 *
 * @param resolver - the AssetStore-backed delegate, or null.
 */
export function setAssetUrlResolver(resolver: AssetUrlResolver | null): void {
  delegate = resolver;
}

/**
 * Resolves an asset hash into a loadable URL.
 *
 * @param hash - the SHA-256 content hash.
 * @param mime - optional MIME hint for the response type.
 * @returns the URL, or null when no resolver is installed / the hash is
 *          malformed (placeholder rendering).
 */
export function assetUrlOf(hash: string, mime?: string): string | null {
  return delegate?.(hash, mime) ?? null;
}
