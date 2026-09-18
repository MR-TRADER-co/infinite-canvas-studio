/**
 * Deep links (R13.2): the `infinitecanvas://` protocol.
 *
 * Scheme: `infinitecanvas://open?project=<path>&object=<id>&view=<bookmark>`
 * (every parameter optional; at least one expected). On the DESKTOP the
 * tauri-plugin-deep-link plugin delivers cold starts AND warm
 * single-instance redirects (second launch focuses the existing window).
 * On the WEB the same parameters are read from the `#open?…` hash — the
 * preview's fallback — so links behave identically in both shells.
 *
 * Pure parse/build functions are exported for tests; the subscribe
 * function picks the platform source at call time.
 */

/** A parsed deep link (every field optional). */
export interface DeepLink {
  /** A project file path to open (desktop) — absent on the web. */
  readonly project?: string;
  /** An object id to fly to after opening. */
  readonly object?: string;
  /** A camera bookmark id to fly to after opening. */
  readonly view?: string;
}

/** The protocol scheme the desktop shell registers. */
export const DEEP_LINK_SCHEME = "infinitecanvas://";

/**
 * Parses a deep-link URL of EITHER shape (`infinitecanvas://open?…` or
 * `#open?…` — the web fallback).
 *
 * @param url - the raw URL/hash string.
 * @returns the parsed link, or null when it carries no `open` host or no
 *          recognised parameter.
 */
export function parseDeepLink(url: string): DeepLink | null {
  if (typeof url !== "string" || url === "") {
    return null;
  }
  let query: string | null = null;
  const protoMatch = /^infinitecanvas:\/\/open\?(.*)$/u.exec(url);
  if (protoMatch !== null) {
    query = protoMatch[1] ?? "";
  } else {
    const hashMatch = /^#open\?(.*)$/u.exec(url);
    if (hashMatch !== null) {
      query = hashMatch[1] ?? "";
    }
  }
  if (query === null) {
    return null;
  }
  const params = new URLSearchParams(query);
  const project = params.get("project") ?? undefined;
  const object = params.get("object") ?? undefined;
  const view = params.get("view") ?? undefined;
  const link: DeepLink = {
    ...(project !== undefined && project !== "" ? { project } : {}),
    ...(object !== undefined && object !== "" ? { object } : {}),
    ...(view !== undefined && view !== "" ? { view } : {}),
  };
  if (link.project === undefined && link.object === undefined && link.view === undefined) {
    return null;
  }
  return link;
}

/**
 * Builds a deep-link URL from parameters (the automations' "copy deep
 * link" action and the dailies' prev/next links use this, R13.2).
 *
 * @param link - the link parameters.
 * @returns the desktop-scheme URL (`infinitecanvas://open?…`).
 */
export function buildDeepLink(link: DeepLink): string {
  const params = new URLSearchParams();
  if (link.project !== undefined && link.project !== "") {
    params.set("project", link.project);
  }
  if (link.object !== undefined && link.object !== "") {
    params.set("object", link.object);
  }
  if (link.view !== undefined && link.view !== "") {
    params.set("view", link.view);
  }
  return `${DEEP_LINK_SCHEME}open?${params.toString()}`;
}

/**
 * Builds the WEB fallback hash (`#open?…`) for the same parameters.
 *
 * @param link - the link parameters.
 * @returns the hash string (empty when no parameter is set).
 */
export function buildWebDeepLinkHash(link: DeepLink): string {
  const params = new URLSearchParams();
  if (link.object !== undefined && link.object !== "") {
    params.set("object", link.object);
  }
  if (link.view !== undefined && link.view !== "") {
    params.set("view", link.view);
  }
  const query = params.toString();
  return query === "" ? "" : `#open?${query}`;
}

/**
 * Reads the deep link from the current browser location (the web
 * fallback: the `#open?…` hash; SSR-safe).
 *
 * @returns the parsed link, or null when the hash carries none.
 */
export function readDeepLinkFromLocation(): DeepLink | null {
  if (typeof window === "undefined" || typeof location === "undefined") {
    return null;
  }
  const hash = window.location.hash;
  if (hash === "" || hash === "#") {
    return null;
  }
  return parseDeepLink(hash);
}

/**
 * Subscribes to deep links: the desktop plugin's `onNewUrl` (cold start
 * + warm single-instance redirect), or the web `hashchange` fallback.
 *
 * @param handler - invoked with every arriving link.
 * @returns an unsubscribe function (always callable; a no-op when the
 *          environment exposes no source).
 */
export function subscribeDeepLink(
  handler: (link: DeepLink) => void,
): () => void {
  if (isTauriWebview()) {
    let unsubscribe: (() => void) | null = null;
    void import("@tauri-apps/plugin-deep-link")
      .then((module) => {
        const listen = (
          module as {
            onNewUrl?: (
              callback: (event: { url: string }) => void,
            ) => Promise<() => void>;
          }
        ).onNewUrl;
        if (typeof listen !== "function") {
          return;
        }
        void listen((event) => {
          const link = parseDeepLink(event.url);
          if (link !== null) {
            handler(link);
          }
        }).then((stop) => {
          unsubscribe = stop;
        });
      })
      .catch(() => {
        // Plugin unavailable: fall through to the web source below.
      });
    return () => {
      unsubscribe?.();
    };
  }
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const onHashChange = (): void => {
    const link = readDeepLinkFromLocation();
    if (link !== null) {
      handler(link);
    }
  };
  window.addEventListener("hashchange", onHashChange);
  return () => {
    window.removeEventListener("hashchange", onHashChange);
  };
}

/** @returns whether the desktop webview environment is active. */
function isTauriWebview(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
}
