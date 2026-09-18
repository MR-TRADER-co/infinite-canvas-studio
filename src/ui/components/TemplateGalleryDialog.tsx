"use client";

/**
 * Template gallery (R8.4): the «New» flow's first screen — Blank + the
 * starter templates (Meeting Notes, Kanban, Mind Map, Weekly Planner,
 * Frame Storyboard). Each template ships as an `.icb` file in the app
 * resources (`public/templates/`); the gallery FETCHES it and hands the
 * raw payload to the existing import pipeline. A fetch failure (offline
 * file systems, dev proxies) falls back to the in-code builder + the
 * live serializer — byte-identical semantics, still fully offline.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarRange,
  FilePlus2,
  LayoutTemplate,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import { TEMPLATES, type TemplateDefinition } from "@/core/templates/templates";

/** Whether the module already imported a template (one-shot guard). */
let importUnderway = false;

/** The template gallery dialog (UI-store driven visibility). */
export default function TemplateGalleryDialog(): ReactNode {
  const { t, language } = useTranslation();
  const open = useUiStore((state) => state.templateGalleryOpen);
  const setOpen = useUiStore((state) => state.setTemplateGalleryOpen);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Closes the dialog when the import lands (the scene swaps under it). */
  useEffect(() => {
    if (!open) {
      return;
    }
    const bus = AppContext.getDefault().tryGet(Services.eventBus);
    const close = (): void => {
      setOpen(false);
      setBusyId(null);
    };
    const offRestored = bus?.on("project:restored", close);
    const offNew = bus?.on("project:restored", close);
    return () => {
      offRestored?.();
      offNew?.();
    };
  }, [open, setOpen]);

  /** Applies one template: blank resets; others import the .icb payload. */
  const applyTemplate = (template: TemplateDefinition): void => {
    if (importUnderway) {
      return;
    }
    const bus = AppContext.getDefault().tryGet(Services.eventBus);
    if (bus === undefined) {
      return;
    }
    if (template.id === "blank") {
      setOpen(false);
      bus.emit("project:new-requested", { discardUnsaved: true });
      return;
    }
    importUnderway = true;
    setBusyId(template.id);
    void (async (): Promise<void> => {
      try {
        const raw = await fetchTemplatePayload(template.id);
        bus.emit("project:import-requested", { raw });
      } catch {
        // Builder fallback: serialize the in-code definition.
        const serializer = AppContext.getDefault().tryGet(Services.serializer);
        if (serializer !== undefined) {
          const raw = serializer.serialize(template.build());
          bus.emit("project:import-requested", { raw });
        }
      } finally {
        importUnderway = false;
        setBusyId(null);
      }
    })();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        dir={language === "fa" ? "rtl" : "ltr"}
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplate className="size-4" aria-hidden="true" />
            {t("templates.galleryTitle")}
          </DialogTitle>
          <DialogDescription>{t("templates.galleryHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 py-1 sm:grid-cols-2">
          {TEMPLATES.map((template) => {
            const busy = busyId === template.id;
            return (
              <div
                key={template.id}
                className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-3 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start gap-2.5">
                  <span className="grid size-9 flex-none place-items-center rounded-lg bg-primary/10 text-primary">
                    {template.id === "blank" ? (
                      <FilePlus2 className="size-4.5" aria-hidden="true" />
                    ) : (
                      <CalendarRange className="size-4.5" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-semibold">{template.title}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {template.description}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="ms-auto"
                  disabled={busyId !== null}
                  onClick={() => applyTemplate(template)}
                >
                  {busy ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {t("templates.use")}
                </Button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Fetches a template's shipped `.icb` resource.
 *
 * @param id - the template id.
 * @returns the raw file payload.
 * @throws Error when the fetch or the parse fails.
 */
async function fetchTemplatePayload(id: string): Promise<string> {
  const base =
    typeof document !== "undefined"
      ? new URL(`templates/${id}.icb`, document.baseURI).href
      : `templates/${id}.icb`;
  const response = await fetch(base);
  if (!response.ok) {
    throw new Error(`template fetch failed: ${response.status}`);
  }
  const raw = await response.text();
  if (raw.trim() === "") {
    throw new Error("template resource is empty");
  }
  return raw;
}
