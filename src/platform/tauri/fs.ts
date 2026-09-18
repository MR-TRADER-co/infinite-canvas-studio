/**
 * Typed wrappers around the Tauri filesystem APIs.
 *
 * The Tauri plugin is imported dynamically in a later phase so this module
 * stays loadable in the plain web preview; Phase 0 wrappers are harmless
 * no-ops. Project files never leave the local disk (CLAUDE.md §1.1).
 *
 * PHASE 0 STUB — fully implemented in a later phase.
 */

/**
 * Reads a UTF-8 text file from disk.
 *
 * @param _path - absolute path of the file to read.
 * @returns the file contents, or null when unreadable (always null in
 *          Phase 0).
 */
export async function readTextFile(_path: string): Promise<string | null> {
  return null;
}

/**
 * Writes a UTF-8 text file to disk.
 *
 * @param _path - absolute path of the file to write.
 * @param _contents - the text payload to write.
 * @returns whether the write succeeded (always false in Phase 0).
 */
export async function writeTextFile(
  _path: string,
  _contents: string,
): Promise<boolean> {
  return false;
}
