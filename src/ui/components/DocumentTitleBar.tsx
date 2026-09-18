"use client";

/**
 * Document title bar (R4.5): the chip beside the project-menu button
 * showing the open document's file name plus the dirty marker («*»),
 * plus the `document.title` sync (the browser tab / the native Tauri
 * window title mirror the same string).
 *
 * State flows from the `project:document-changed` event — the component
 * never touches the scene (layering: ui → services only).
 */
import { useEffect, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import { useTranslation } from "@/ui/i18n";
import { t as translate } from "@/ui/i18n";
import type { DocumentState } from "@/persistence/DocumentService";
import { cn } from "@/lib/utils";

/** The document name chip (event-driven). */
export default function DocumentTitleBar(): ReactNode {
  const { t, language } = useTranslation();
  const [state, setState] = useState<DocumentState | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const install = (): void => {
      const bus = AppContext.getDefault().tryGet(Services.eventBus);
      const document = AppContext.getDefault().tryGet(Services.document);
      if (bus !== undefined) {
        if (document !== undefined && !cancelled) {
          setState(document.state());
        }
        unsubscribe = bus.on("project:document-changed", (next) => {
          if (!cancelled) {
            setState(next);
          }
        });
      }
    };
    install();
    if (unsubscribe === undefined) {
      void Application.boot().then(() => {
        if (!cancelled) {
          install();
        }
      });
    }
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  /** Mirrors the document name + dirty marker onto the window title. */
  useEffect(() => {
    const untitled = translate("document.untitled");
    const name = state?.name ?? untitled;
    const dirtySuffix = state?.dirty === true ? " *" : "";
    document.title = `${name}${dirtySuffix} — ${translate("app.name")}`;
  }, [state]);

  const displayName = state?.name ?? t("document.untitled");
  const dirty = state?.dirty ?? false;

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            aria-label={t("document.title")}
            className={cn(
              "absolute start-16 top-4 z-10 flex h-9 max-w-64 items-center gap-1.5 rounded-xl border px-3",
              "border-border/60 bg-background/80 text-muted-foreground shadow-md shadow-black/15",
              "backdrop-blur-xl transition-colors",
              dirty ? "text-foreground" : "text-muted-foreground",
              state?.readOnly === true && "opacity-70",
            )}
          >
            <FileText className="size-3.5 shrink-0" aria-hidden="true" />
            <span
              dir={language === "fa" ? "rtl" : "ltr"}
              className="truncate text-xs font-medium"
            >
              {displayName}
            </span>
            {dirty ? (
              <span
                className="text-xs font-bold text-amber-500"
                aria-hidden="true"
              >
                *
              </span>
            ) : null}
            {state?.readOnly === true ? (
              <span className="ms-1 rounded border border-border/60 px-1 text-[9px] uppercase tracking-wide">
                RO
              </span>
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          {dirty ? t("document.dirty") : displayName}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
