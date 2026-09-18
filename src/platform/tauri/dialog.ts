/**
 * Typed wrappers around the Tauri dialog APIs (native OS file pickers).
 *
 * The plugin (`tauri-plugin-dialog`, registered in `src-tauri/src/lib.rs`
 * and allowed by the `dialog:default` capability) is imported DYNAMICALLY
 * and only inside the Tauri WebView, so the plain web shell never loads
 * the native module. Outside Tauri both wrappers resolve to `null`
 * (= "cancelled/unavailable") and the callers fall back to their
 * web flows.
 *
 * Windows note — this is exactly the «پنجرهٔ ذخیره/بازکردن خود ویندوز»:
 * `saveFileDialog` opens the native Save As dialog (folder tree + file
 * name + `.icb` filter), `openFileDialog` the native Open dialog.
 */
import { isTauriEnvironment } from "@/platform/tauri/log";

/** Filter restricting which files a dialog offers. */
export interface FileDialogFilter {
  /** Display name of the filter group. */
  readonly name: string;
  /** File extensions included, without leading dots. */
  readonly extensions: readonly string[];
}

/** Options shared by the open and save dialogs. */
export interface FileDialogOptions {
  /** Dialog window title. */
  readonly title?: string;
  /** Initially selected directory or file. */
  readonly defaultPath?: string;
  /** Extension filters offered by the dialog. */
  readonly filters?: readonly FileDialogFilter[];
}

/** Maps the public filter shape onto the plugin's mutable one. */
const toPluginFilters = (
  filters: readonly FileDialogFilter[] | undefined,
): { name: string; extensions: string[] }[] | undefined =>
  filters === undefined
    ? undefined
    : filters.map((filter) => ({
        name: filter.name,
        extensions: [...filter.extensions],
      }));

/**
 * Opens the native file-open dialog (the Windows "Open" picker).
 *
 * @param options - dialog configuration (single file, no directories).
 * @returns the chosen absolute path, or null when cancelled / outside the
 *          desktop shell (errors are reported once on the console and
 *          collapse to null so a broken picker can never crash the app).
 */
export async function openFileDialog(
  options?: FileDialogOptions,
): Promise<string | null> {
  if (!isTauriEnvironment()) {
    return null;
  }
  try {
    const plugin = await import("@tauri-apps/plugin-dialog");
    const picked = await plugin.open({
      title: options?.title,
      defaultPath: options?.defaultPath,
      filters: toPluginFilters(options?.filters),
      multiple: false,
      directory: false,
    });
    return typeof picked === "string" ? picked : null;
  } catch (error) {
    console.warn("[dialog] native open picker unavailable:", error);
    return null;
  }
}

/**
 * Opens the native save dialog (the Windows "Save As" picker).
 *
 * @param options - dialog configuration (folder tree + file name).
 * @returns the chosen absolute path, or null when cancelled / outside the
 *          desktop shell (errors collapse to null — the caller then keeps
 *          its typed-path alternative open instead of failing loudly).
 */
export async function saveFileDialog(
  options?: FileDialogOptions,
): Promise<string | null> {
  if (!isTauriEnvironment()) {
    return null;
  }
  try {
    const plugin = await import("@tauri-apps/plugin-dialog");
    return await plugin.save({
      title: options?.title,
      defaultPath: options?.defaultPath,
      filters: toPluginFilters(options?.filters),
    });
  } catch (error) {
    console.warn("[dialog] native save picker unavailable:", error);
    return null;
  }
}
