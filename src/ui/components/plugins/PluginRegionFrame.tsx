"use client";

/**
 * Plugin region frame (R9.3/R9.9): the host-generic React component
 * every plugin UI region (panel body / settings section) renders —
 * a VS Code-webview-style sandboxed iframe running the plugin's OWN
 * entry in region mode.
 *
 * The component is created by the plugin runtime's regionFrame hook
 * (App.ts) — one instance per region id, ZERO plugin-specific code:
 * it spawns the region sandbox through the LifecycleManager, mounts
 * the frame, attaches the transport, and disposes on unmount. The
 * plugin paints its UI inside its own frame (opaque origin,
 * `allow-scripts` only — never same-origin).
 */
import { useEffect, useRef, type ReactElement } from "react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/ui/i18n";

/** The frame's base classes (fills the dock slot / settings body).
 *
 * A DEFINITE height (h-56 = 224px) — NOT `h-full`: the dock section
 * sizes itself from its body's intrinsic height, and `h-full` inside
 * the auto-sized `flex-1` scroll container is circular → the section
 * collapses to a ~59px sliver and the region gets clipped to ~20px
 * (visible since Phase 9; the first-party panels made it matter).
 */
const FRAME_CLASS = "h-56 w-full rounded-lg border-0 bg-transparent";

/**
 * @param props - plugin id + region id (the runtime's hook baked them).
 * @returns the region frame element.
 */
export default function PluginRegionFrame(props: {
  readonly pluginId: string;
  readonly regionId: string;
  /** i18n key of the section title (settings sections render a header). */
  readonly titleKey?: string;
}): ReactElement {
  const { t } = useTranslation();
  const isSettings = props.regionId.startsWith("settings:");
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    let disposed = false;
    let cleanup: (() => void) | null = null;

    void Application.boot().then(() => {
      if (disposed || host === null) {
        return;
      }
      const manager = AppContext.getDefault().tryGet(Services.pluginManager);
      if (manager === undefined) {
        return;
      }
      const regionSpawn = manager.spawnRegion(props.pluginId, props.regionId);
      if (regionSpawn === undefined) {
        return;
      }
      const frame = regionSpawn.frame;
      if (frame !== undefined) {
        // Region frames are interactive display surfaces.
        frame.style.display = "block";
        frame.style.width = "100%";
        frame.style.height = "100%";
        frame.style.border = "0";
        frame.style.borderRadius = "0";
        frame.removeAttribute("aria-hidden");
        frame.setAttribute("title", props.regionId);
        host.appendChild(frame);
      }
      manager.attachRegion(
        props.pluginId,
        props.regionId,
        regionSpawn.transport,
      );
      cleanup = () => {
        regionSpawn.dispose();
        manager.getRuntime(props.pluginId)?.detachRegion(props.regionId);
        host?.replaceChildren();
      };
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [props.pluginId, props.regionId]);

  return (
    <div
      className="pointer-events-auto py-4 first:pt-1 last:pb-1"
      aria-label={props.regionId}
    >
      {isSettings && props.titleKey !== undefined ? (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t(props.titleKey as never)}
        </p>
      ) : null}
      <div ref={hostRef} className={cn(FRAME_CLASS, "pointer-events-auto")} />
    </div>
  );
}
