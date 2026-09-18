/**
 * Load-from-disk: reads a project file from a user-typed location — the
 * recall half of the "save at an address" system (see
 * {@link "@/persistence/SaveToDisk"} for the save half).
 *
 * Address modes, one per shell:
 * - **Desktop (Tauri)**: the typed absolute path is read by the
 *   `read_text_file` IPC command (see `src-tauri/src/lib.rs`).
 * - **Web**: when the local filesystem bridge is reachable
 *   ({@link "@/persistence/LocalFsBridge"}) the typed path is read through
 *   the Next.js server; otherwise the dialogs fall back to the standard
 *   file-open picker.
 *
 * The returned raw payload is validated by the composition root's
 * `project:import-requested` handler (a corrupt file never crashes the app).
 */
import { normalizeSavePath } from "@/persistence/SaveToDisk";
import { isTauriEnvironment } from "@/platform/tauri/log";
import { openFileDialog } from "@/platform/tauri/dialog";
import { loadViaLocalFsBridge } from "@/persistence/LocalFsBridge";

/** Outcome of a load-from-disk attempt. */
export type LoadFromDiskResult =
  | { readonly kind: "loaded"; readonly path: string; readonly raw: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Reads a project file from the typed absolute path.
 *
 * @param rawPath - the path exactly as typed by the user.
 * @returns the file payload (`loaded`), `unsupported` outside the desktop
 *          shell without a bridge, or `failed` with a machine-readable code
 *          (`invalid-path`, `not-found`, `not-icb`, `outside-roots`, …).
 */
export async function loadProjectFromPath(
  rawPath: string,
): Promise<LoadFromDiskResult> {
  const path = normalizeSavePath(rawPath);
  if (path === null) {
    return { kind: "failed", reason: "invalid-path" };
  }
  if (isTauriEnvironment()) {
    try {
      const core = await import("@tauri-apps/api/core");
      const raw = await core.invoke<string>("read_text_file", { path });
      return { kind: "loaded", path, raw };
    } catch (error) {
      return {
        kind: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const bridge = await loadViaLocalFsBridge(path);
  if (bridge.kind === "loaded") {
    return { kind: "loaded", path: bridge.path, raw: bridge.contents };
  }
  return { kind: "failed", reason: bridge.code };
}

/**
 * Opens the NATIVE OS file-open dialog and reads the picked `.icb` — the
 * desktop «پنجرهٔ بازکردن خود ویندوز» flow: the user browses the real
 * folder tree, the OS hands back an existing file's absolute path, and the
 * payload is read verbatim through `read_text_file` (no path surgery — the
 * OS already guaranteed the file exists with that exact name).
 *
 * @returns the file payload (`loaded`), `cancelled` when the picker was
 *          closed, `unsupported` outside the desktop shell, or `failed`.
 */
export async function loadProjectViaNativeDialog(): Promise<LoadFromDiskResult> {
  if (!isTauriEnvironment()) {
    return { kind: "unsupported", reason: "native-dialog-desktop-only" };
  }
  const picked = await openFileDialog({
    filters: [{ name: "Infinite Canvas Project (.icb)", extensions: ["icb"] }],
  });
  if (picked === null) {
    return { kind: "cancelled" };
  }
  try {
    const core = await import("@tauri-apps/api/core");
    const raw = await core.invoke<string>("read_text_file", { path: picked });
    return { kind: "loaded", path: picked, raw };
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Probes whether a recent-files entry still exists on disk (R4.7: missing
 * files gray out in the File menu). Desktop: a `read_text_file` attempt;
 * web: the local bridge load (only when the bridge is reachable — remote
 * deployments return null = "cannot validate", entries stay enabled and
 * the click itself reports the failure).
 *
 * @param path - the absolute path of the recent entry.
 * @returns whether the file is readable, or null when the shell cannot
 *          validate the path at all.
 */
export async function probeRecentFileExists(
  path: string,
): Promise<boolean | null> {
  if (isTauriEnvironment()) {
    try {
      const core = await import("@tauri-apps/api/core");
      await core.invoke<string>("read_text_file", { path });
      return true;
    } catch {
      return false;
    }
  }
  try {
    const bridge = await loadViaLocalFsBridge(path);
    if (bridge.kind === "loaded") {
      return true;
    }
    if (bridge.code === "not-found" || bridge.code === "not-icb") {
      return false;
    }
    // outside-roots / network / probe refused: the shell cannot validate
    // this path — null keeps the entry enabled (the click reports failures).
    return null;
  } catch {
    return null;
  }
}
