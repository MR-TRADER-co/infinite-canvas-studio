"use client";

/**
 * Insert Video dialog (فاز M1 — RM1.3a, the File→«درج ویدئو…» path
 * completing the paste/drop pair): a file picker accepting the five
 * native extensions (multi-select), imported through the ONE video
 * pipeline (AssetStore write → poster capture → shared placement) at
 * the visible viewport centre.
 *
 * Opened by the `core.insert.video` command (the Insert-Panel card's
 * registered insert action, A.2.6) through the UI store's
 * `insertVideoDialogOpen` slice — the same event-driven pattern as the
 * Insert Image dialog.
 */
import { useState, type ReactNode } from "react";
import { FileVideo, Loader2, Upload } from "lucide-react";
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
import {
  classifyVideoFiles,
  importOrQueueVideoFiles,
} from "@/ui/clipboard/videoImport";

/** The Insert Video dialog (UI-store driven visibility). */
export default function InsertVideoDialog(): ReactNode {
  const { t, language } = useTranslation();
  const open = useUiStore((state) => state.insertVideoDialogOpen);
  const setOpen = useUiStore((state) => state.setInsertVideoDialogOpen);
  const [busy, setBusy] = useState(false);

  /** Imports every picked file through the shared gated pipeline. */
  const handleFiles = (files: readonly File[]): void => {
    if (files.length === 0) {
      return;
    }
    // فاز M2: EVERY video candidate (accepted extensions AND foreign
    // containers) enters the gate — playable files import now, the rest
    // queue for the offline conversion dialog.
    const classified = classifyVideoFiles(files);
    const candidates = [...classified.accepted, ...classified.rejected];
    setBusy(true);
    void Application.boot().then(() => {
      const app = AppContext.getDefault();
      const bus = app.tryGet(Services.eventBus);
      const scene = app.tryGet(Services.scene);
      const history = app.tryGet(Services.history);
      const selection = app.tryGet(Services.selection);
      const ids = app.tryGet(Services.idGenerator);
      const assets = app.tryGet(Services.assetStore);
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
        bus !== undefined
      ) {
        void importOrQueueVideoFiles(
          { scene, history, selection, ids, bus, assets },
          candidates,
          rect,
        ).then(() => {
          setBusy(false);
          setOpen(false);
        });
        return;
      }
      bus?.emit("ui:notice", {
        messageKey: "video.importFailedNotice",
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
            <FileVideo className="size-5 text-primary" aria-hidden="true" />
            {t("insertVideo.title")}
          </DialogTitle>
          <DialogDescription>{t("insertVideo.description")}</DialogDescription>
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
            {t("insertVideo.browse")}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("insertVideo.hint")}
          </span>
          <input
            type="file"
            accept=".mp4,.m4v,.mov,.webm,.ogv,video/mp4,video/webm,video/quicktime,video/ogg"
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
            {t("insertVideo.cancel")}
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
