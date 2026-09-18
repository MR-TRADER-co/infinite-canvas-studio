/**
 * Open-file channel (R8.8): the desktop shell's file-association /
 * single-instance plumbing. When the user double-clicks an associated
 * `.icb` in Explorer (or launches a second instance with a file), the
 * Rust side emits `open-file` with the absolute path — this module
 * subscribes and hands the path to the composition root, which imports
 * the file through the regular pipeline.
 *
 * Web shell: a no-op (there is no OS launcher).
 */
import { isTauriEnvironment } from "@/platform/tauri/log";

/**
 * Subscribes to OS-opened `.icb` file paths (Tauri only).
 *
 * @param onOpen - invoked with the absolute path of each file the OS
 *        asks the app to open.
 * @returns an unsubscriber (a no-op on the web shell).
 */
export function subscribeOpenFile(onOpen: (path: string) => void): () => void {
  if (!isTauriEnvironment() || typeof window === "undefined") {
    return () => undefined;
  }
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  void (async (): Promise<void> => {
    try {
      const eventModule = (await import("@tauri-apps/api/event")) as {
        listen: (
          event: string,
          handler: (payload: { payload: string }) => void,
        ) => Promise<() => void>;
      };
      const detach = await eventModule.listen(
        "open-file",
        (payload: { payload: string }) => {
          if (typeof payload.payload === "string" && payload.payload !== "") {
            onOpen(payload.payload);
          }
        },
      );
      if (cancelled) {
        detach();
        return;
      }
      unsubscribe = detach;
    } catch (error) {
      console.warn("[open-file] tauri event listen unavailable", error);
    }
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

/**
 * Reads a UTF-8 text file through the app's own `read_text_file` IPC
 * (used by the open-file channel — a thin, typed wrapper).
 *
 * @param path - the absolute file path.
 * @returns the file contents.
 * @throws Error when the read fails (missing file, non-UTF-8…).
 */
export async function readProjectFileRaw(path: string): Promise<string> {
  const core = (await import("@tauri-apps/api/core")) as {
    invoke: (
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<string>;
  };
  return core.invoke("read_text_file", { path });
}
