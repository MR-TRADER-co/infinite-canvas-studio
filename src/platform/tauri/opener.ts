/**
 * External link opening (R3B.3): delegate a URL to the OS default browser.
 *
 * The app itself NEVER makes network calls — opening a link is the only
 * sanctioned outbound hand-off, and it always follows a user confirmation.
 * On the Tauri desktop shell the call goes through the `tauri-plugin-opener`
 * IPC (`plugin:opener|open_url`, registered in `src-tauri/src/lib.rs`);
 * in the plain web preview `window.open` with `noopener` is the equivalent.
 *
 * The opener IPC is attempted lazily and falls back to `window.open` when
 * the plugin is unavailable, so a web preview loaded inside the Tauri
 * WebView before plugin registration still works.
 */

/** Signature of Tauri's `invoke` (kept local to avoid a static dependency). */
type InvokeFn = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/** Cached `invoke` import (null until first resolved). */
let invoke: InvokeFn | null = null;

/**
 * @returns whether the code runs inside the Tauri WebView (mirrors
 *          `isTauriEnvironment` — duplicated to keep this module
 *          dependency-free).
 */
function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Opens a URL with the OS default browser (never in-app).
 *
 * @param url - the validated http(s) URL to open.
 * @returns whether the hand-off succeeded (failures are logged, never thrown).
 */
export async function openExternalLink(url: string): Promise<boolean> {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return false;
  }
  if (isTauriEnvironment()) {
    try {
      if (invoke === null) {
        const core = await import("@tauri-apps/api/core");
        invoke = core.invoke;
      }
      await invoke("plugin:opener|open_url", { url });
      return true;
    } catch {
      // Plugin not registered (older desktop bundle / web preview inside
      // the WebView) — fall through to window.open below.
    }
  }
  if (typeof window === "undefined") {
    return false;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  return opened !== null;
}
