"use client";

/**
 * Insert Image dialog (R5.2 — the File→Insert Image path completing the
 * paste/drop pair): a file picker accepting every raster type, decoded and
 * downscaled through the SAME import pipeline (byte-identical pass-through
 * for small PNG/JPEG, proportional downscale for oversized ones) and
 * committed at the visible viewport centre with the R5.5 grid snap — one
 * image = one undo step.
 *
 * Opened by the `core.insert.image` command through the UI store's
 * `insertImageDialogOpen` slice (the same event-driven pattern as the
 * Export PNG dialog).
 */
import { useRef, useState, type ReactNode } from "react";
import { ImagePlus, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import { Application, Services } from "@/App";
import { AppContext } from "@/AppContext";
import { decodeImageFile, insertDecodedImage } from "@/ui/hooks/useImageImport";

/** The Insert Image dialog (UI-store driven visibility). */
export default function InsertImageDialog(): ReactNode {
  const { t, language } = useTranslation();
  const open = useUiStore((state) => state.insertImageDialogOpen);
  const setOpen = useUiStore((state) => state.setInsertImageDialogOpen);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Decodes every picked file and commits it through the shared pipeline. */
  const handleFiles = (files: readonly File[]): void => {
    if (files.length === 0) {
      return;
    }
    setBusy(true);
    void Application.boot().then(() => {
      const app = AppContext.getDefault();
      const bus = app.tryGet(Services.eventBus);
      void Promise.all(
        files.map((file) =>
          decodeImageFile(file).then((decoded) => ({ file, decoded })),
        ),
      ).then((results) => {
        const surface = document.querySelector<HTMLElement>("main");
        const rect =
          surface !== null
            ? { width: surface.clientWidth, height: surface.clientHeight }
            : null;
        for (const { decoded } of results) {
          if (decoded !== null) {
            const scene = app.tryGet(Services.scene);
            const history = app.tryGet(Services.history);
            const selection = app.tryGet(Services.selection);
            const ids = app.tryGet(Services.idGenerator);
            if (
              scene !== undefined &&
              history !== undefined &&
              selection !== undefined &&
              ids !== undefined &&
              bus !== undefined
            ) {
              insertDecodedImage(
                { scene, history, selection, ids, bus },
                decoded,
                rect,
              );
            }
          } else {
            bus?.emit("ui:notice", {
              messageKey: "image.pasteFailedNotice",
              severity: "error",
            });
          }
        }
        setBusy(false);
        setOpen(false);
      });
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        dir={language === "fa" ? "rtl" : "ltr"}
        className="w-[22rem] max-w-[calc(100vw-2rem)]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="size-5 text-primary" aria-hidden="true" />
            {t("insert.title")}
          </DialogTitle>
          <DialogDescription>{t("insert.description")}</DialogDescription>
        </DialogHeader>

        {/* Drop-zone-styled picker label wrapping the hidden input. */}
        <label
          className={
            "flex cursor-pointer flex-col items-center justify-center gap-3 " +
            "rounded-xl border-2 border-dashed border-border bg-muted/30 " +
            "px-6 py-10 text-center transition-colors hover:border-primary/50 hover:bg-primary/5 " +
            "focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-ring"
          }
        >
          <Upload className="size-7 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">
            {t("insert.browse")}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("insert.hint")}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              handleFiles(files);
            }}
          />
        </label>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            {t("insert.cancel")}
          </Button>
        </DialogFooter>

        {busy ? (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
