/**
 * Local-filesystem bridge: the web-shell half of the "save at an address"
 * system (server half: `src/lib/serverFs.ts` + `/api/fs/*` routes).
 *
 * When the app is served from the machine the user addresses (local preview,
 * self-hosted single-user setup), the typed path can be written and read for
 * real — through the Next.js server, which shares the user's filesystem.
 * The desktop (Tauri) shell never uses this module (IPC commands instead),
 * and remote web deployments fail the probe → the dialogs fall back to the
 * system picker / download.
 *
 * All functions are fetch-based with typed outcomes; unknown server errors
 * collapse into machine-readable codes the UI maps to translations.
 */

/** Capabilities advertised by a reachable bridge. */
export interface LocalFsBridgeInfo {
  /** Allow-listed absolute directories (hinted in the dialogs). */
  readonly roots: readonly string[];
  /** Maximum payload size accepted for one file, in bytes. */
  readonly maxBytes: number;
}

/** Outcome of a bridge save attempt. */
export type BridgeSaveOutcome =
  | { readonly kind: "saved"; readonly path: string }
  | { readonly kind: "failed"; readonly code: string };

/** Outcome of a bridge load attempt. */
export type BridgeLoadOutcome =
  | {
      readonly kind: "loaded";
      readonly path: string;
      readonly contents: string;
    }
  | { readonly kind: "failed"; readonly code: string };

/** Memoised probe (one round-trip per session; tests/HMR can reset it). */
let cachedProbe: Promise<LocalFsBridgeInfo | null> | null = null;

/**
 * Resets the memoised probe so the next call re-checks the bridge.
 */
export function resetLocalFsBridgeProbe(): void {
  cachedProbe = null;
}

/**
 * Probes the local filesystem bridge.
 *
 * @param force - re-probe even when a previous result is memoised.
 * @returns the bridge capabilities, or null when unreachable (remote
 *          deployment, Tauri shell, SSR — the dialogs then degrade).
 */
export function probeLocalFsBridge(
  force = false,
): Promise<LocalFsBridgeInfo | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  if (!force && cachedProbe !== null) {
    return cachedProbe;
  }
  cachedProbe = (async () => {
    try {
      const response = await fetch("/api/fs", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        return null;
      }
      return asBridgeInfo(await response.json());
    } catch {
      return null;
    }
  })();
  return cachedProbe;
}

/**
 * Saves an `.icb` payload at a typed path through the bridge.
 *
 * @param rawPath - the path exactly as typed by the user.
 * @param contents - the serialised `.icb` payload.
 * @returns the canonical saved path, or a failure code.
 */
export async function saveViaLocalFsBridge(
  rawPath: string,
  contents: string,
): Promise<BridgeSaveOutcome> {
  try {
    const response = await fetch("/api/fs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: rawPath, contents }),
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (response.ok && data.ok === true && typeof data.path === "string") {
      return { kind: "saved", path: data.path };
    }
    return {
      kind: "failed",
      code: typeof data.error === "string" ? data.error : "unknown",
    };
  } catch {
    return { kind: "failed", code: "network" };
  }
}

/**
 * Loads an `.icb` project file from a typed path through the bridge.
 *
 * @param rawPath - the path exactly as typed by the user.
 * @returns the file contents, or a failure code (`not-found`, `not-icb`, …).
 */
export async function loadViaLocalFsBridge(
  rawPath: string,
): Promise<BridgeLoadOutcome> {
  try {
    const response = await fetch("/api/fs/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: rawPath }),
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (response.ok && data.ok === true && typeof data.contents === "string") {
      return {
        kind: "loaded",
        path: typeof data.path === "string" ? data.path : rawPath,
        contents: data.contents,
      };
    }
    return {
      kind: "failed",
      code: typeof data.error === "string" ? data.error : "unknown",
    };
  } catch {
    return { kind: "failed", code: "network" };
  }
}

/**
 * Narrows a probe response into bridge capabilities.
 *
 * @param data - the parsed JSON response body.
 * @returns the capabilities, or null when the shape is unexpected.
 */
function asBridgeInfo(data: unknown): LocalFsBridgeInfo | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  if (record.ok !== true) {
    return null;
  }
  if (
    !Array.isArray(record.roots) ||
    !record.roots.every((root) => typeof root === "string")
  ) {
    return null;
  }
  if (
    typeof record.maxBytes !== "number" ||
    !Number.isFinite(record.maxBytes)
  ) {
    return null;
  }
  return {
    roots: record.roots as readonly string[],
    maxBytes: record.maxBytes,
  };
}
