"use client";

/**
 * Plugin command cluster (R9.9/AC9.1): a host-generic toolbar strip
 * rendering every PLUGIN-registered command that carries an icon —
 * the palette covers discovery, the strip covers one-click access.
 *
 * Zero per-plugin code: the cluster reads the CommandRegistry, filters
 * third-party owners, re-renders on late registrations + plugin
 * lifecycle changes, and dispatches through the shared dispatcher.
 */
import { useEffect, useState, type ReactElement } from "react";
import { Heart, Puzzle, Sparkles, Star, type LucideIcon } from "lucide-react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type { CommandEntry } from "@/core/registry/CommandRegistry";
import { dispatchCommand } from "@/ui/hooks/useCommands";
import { useTranslation, type TranslationKey } from "@/ui/i18n";

/** Plugin-supplied icon names the host maps (fallback: Puzzle). */
const PLUGIN_ICONS: Readonly<Record<string, LucideIcon>> = {
  Star,
  Heart,
  Sparkles,
  Puzzle,
};

/**
 * @returns the toolbar strip (nothing when no plugin commands exist).
 */
export default function PluginCommandCluster(): ReactElement | null {
  const { t } = useTranslation();
  const [commands, setCommands] = useState<readonly CommandEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      const registry = context.get(Services.commands);
      const bus = context.get(Services.eventBus);
      const read = (): void => {
        setCommands(
          registry
            .list()
            .filter(
              (entry) =>
                !entry.id.startsWith("core.") && entry.icon !== undefined,
            ),
        );
      };
      read();
      unsubscribers.push(registry.onRegistered(read));
      unsubscribers.push(
        bus.on("plugins:changed", () => {
          // Disable/uninstall unregisters → re-read (deferred: the
          // manager mutates before emitting).
          queueMicrotask(read);
        }),
      );
    });
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  if (commands.length === 0) {
    return null;
  }

  return (
    <>
      {commands.map((command) => {
        const Icon = PLUGIN_ICONS[command.icon ?? ""] ?? Puzzle;
        const title = t(command.titleKey as TranslationKey);
        return (
          <button
            key={command.id}
            type="button"
            aria-label={title}
            title={title}
            onClick={() => {
              dispatchCommand(command.id);
            }}
            className="relative grid size-11 place-items-center rounded-xl outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <Icon className="size-5" aria-hidden="true" />
          </button>
        );
      })}
    </>
  );
}
