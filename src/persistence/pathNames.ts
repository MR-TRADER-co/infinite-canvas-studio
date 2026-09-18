/**
 * Shared path string helpers (pure, unit-testable) — the display-name
 * derivation used by the document title bar, the recent-files list and
 * the save dialogs.
 */

/**
 * Extracts the file display name (basename) from an absolute path,
 * handling both Windows (`\`) and POSIX (`/`) separators.
 *
 * @param path - the path to split.
 * @returns the final path segment, or the whole string when no separator
 *          is present.
 */
export function baseNameOfPath(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = separator === -1 ? path : path.slice(separator + 1);
  return name.trim();
}

/**
 * Strips the `.icb` extension from a file name (display purposes).
 *
 * @param name - the file name (with or without the extension).
 * @returns the name without a trailing `.icb` (case-insensitive).
 */
export function withoutIcbExtension(name: string): string {
  if (name.length >= 4 && name.slice(-4).toLowerCase() === ".icb") {
    return name.slice(0, -4);
  }
  return name;
}
