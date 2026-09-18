"use client";

/**
 * Insert PDF dialog (فاز P1 — RP1.3a, the File→«درج PDF…» path
 * completing the paste/drop pair): a file picker accepting PDF files
 * (multi-select), imported through the ONE PDF pipeline (signature
 * gate → AssetStore write → page-1 poster → shared placement) at the
 * visible viewport centre.
 *
 * Opened by the `core.insert.pdf` command (the Insert-Panel card's
 * registered insert action, A.2.6) through the UI store's
 * `insertPdfDialogOpen` slice — the same event-driven pattern as the
 * Insert Image / Video / Audio dialogs.
 */
import { useState, type ReactNode } from "react";
import { FileText, Loader2, Upload } from "lucide-react";
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
import { classifyPdfFiles, importPdfFiles } from "@/ui/clipboard/pdfImport";

/** The Insert PDF dialog (UI-store driven visibility). */
export default function InsertPdfDialog(): ReactNode {
  const { t, language } = useTranslation();
  const open = useUiStore((state) => state.insertPdfDialogOpen);
  const setOpen = useUiStore((state) => state.setInsertPdfDialogOpen);
  const [busy, setBusy] = useState(false);

  /** Imports every picked file through the shared pipeline. */
  const handleFiles = (files: readonly File[]): void => {
    if (files.length === 0) {
      return;
    }
    const classified = classifyPdfFiles(files);
    if (classified.accepted.length === 0) {
      return;
    }
    setBusy(true);
    void Application.boot().then(() => {
      const app = AppContext.getDefault();
      const bus = app.tryGet(Services.eventBus);
      const scene = app.tryGet(Services.scene);
      const history = app.tryGet(Services.history);
      const selection = app.tryGet(Services.selection);
      const ids = app.tryGet(Services.idGenerator);
      const assets = app.tryGet(Services.assetStore);
      const pdf = app.tryGet(Services.pdfRenderer);
      const surface = document.querySelector<HTMLElement>("main");
      const rect =
        surface !== null
          ? { width: surface.clientWidth, height: surface.clientHeight }
          : null;
      if (
        scene !== undefined &&
        history !== undefined &&
        selection !== undefined &&
        ids !== undefined &&
        assets !== undefined &&
        pdf !== undefined &&
        bus !== undefined
      ) {
        void importPdfFiles(
          { scene, history, selection, ids, bus, assets, pdf },
          classified.accepted,
          rect,
        ).then(() => {
          setBusy(false);
          setOpen(false);
        });
        return;
      }
      bus?.emit("ui:notice", {
        messageKey: "pdf.importFailedNotice",
        severity: "error",
      });
      setBusy(false);
      setOpen(false);
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
            <FileText className="size-5 text-primary" aria-hidden="true" />
            {t("insertPdf.title")}
          </DialogTitle>
          <DialogDescription>{t("insertPdf.description")}</DialogDescription>
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
            {t("insertPdf.browse")}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("insertPdf.hint")}
          </span>
          <input
            type="file"
            accept=".pdf,application/pdf"
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
            {t("insertPdf.cancel")}
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
