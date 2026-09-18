"use client";

/**
 * ConvertVideoDialog (فاز M2 — RM2.4/RM2.5): the Persian gate for files
 * the browser cannot play.
 *
 * «تبدیل به MP4 (آفلاین)» runs the ffmpeg.wasm conversion (bundled,
 * lazy-loaded, 100% offline — A.2.5) with a live progress bar and a
 * WORKING cancel: aborting terminates the engine, cleans the temp FS
 * state and creates NOTHING (ACM2.5 — no object, no residue). The
 * ORIGINAL file is kept in the sidecar next to the converted asset
 * (`origAssetHash`); the object points at the converted MP4 while
 * `originalName` stays for display.
 *
 * The queue lives in the UI store (view state — never persisted).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FileVideo, Loader2 } from "lucide-react";
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
import { videoConverter } from "@/media/VideoConverter";
import { importConvertedVideoFile } from "@/ui/clipboard/videoImport";
import { formatInteger } from "@/ui/i18n/numbers";

/** The convert-gate dialog (visible while the queue is non-empty). */
export default function ConvertVideoDialog(): ReactNode {
  const { t, language } = useTranslation();
  const queue = useUiStore((state) => state.pendingVideoConversions);
  const clearQueue = useUiStore((state) => state.clearVideoConversions);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const open = queue.length > 0;

  /** Cancels: terminate the engine, clean temp state, queue empties. */
  const cancel = useCallback((): void => {
    abortRef.current?.abort();
    videoConverter.terminate();
    setBusy(false);
    setProgress(0);
    setFailed(false);
    clearQueue();
  }, [clearQueue]);

  /** Esc while converting cancels (the dialog's own key handling). */
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && busy) {
        event.stopPropagation();
        cancel();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, busy, cancel]);

  /** Runs the queue: convert → store both assets → commit the object. */
  const convert = useCallback((): void => {
    setBusy(true);
    setFailed(false);
    setProgress(0);
    const abort = new AbortController();
    abortRef.current = abort;
    void Application.boot().then((context) => {
      const scene = context.tryGet(Services.scene);
      const history = context.tryGet(Services.history);
      const selection = context.tryGet(Services.selection);
      const ids = context.tryGet(Services.idGenerator);
      const assets = context.tryGet(Services.assetStore);
      const bus = context.tryGet(Services.eventBus);
      if (
        scene === undefined ||
        history === undefined ||
        selection === undefined ||
        ids === undefined ||
        assets === undefined ||
        bus === undefined
      ) {
        setFailed(true);
        setBusy(false);
        return;
      }
      const services = { scene, history, selection, ids, bus, assets };
      const surface = document.querySelector<HTMLElement>("main");
      const rect =
        surface !== null
          ? { width: surface.clientWidth, height: surface.clientHeight }
          : null;
      const runQueue = async (): Promise<void> => {
        while (true) {
          const head = useUiStore.getState().pendingVideoConversions[0];
          if (head === undefined || abort.signal.aborted) {
            break;
          }
          setProgress(0);
          const converted = await videoConverter.convert({
            file: head.file,
            onProgress: (ratio) => setProgress(ratio),
            signal: abort.signal,
          });
          if (abort.signal.aborted) {
            break;
          }
          if (converted === null) {
            // Load failure or a failed run — surface the Persian error
            // and stop (the queue stays for a retry).
            setFailed(true);
            break;
          }
          const at =
            head.at !== undefined
              ? { x: head.at.x, y: head.at.y }
              : undefined;
          await importConvertedVideoFile(
            services,
            head.file,
            converted,
            rect,
            at,
          );
          // The object landed — consume this file's queue slot.
          useUiStore.getState().shiftVideoConversion();
        }
        setBusy(false);
      };
      void runQueue();
    });
  }, []);

  const totalFiles = queue.length;
  const headName = queue[0]?.file.name ?? "";

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next && busy) {
        // Closing the dialog mid-run is the CANCEL path.
        cancel();
        return;
      }
      if (!next) {
        clearQueue();
      }
    }}>
      <DialogContent
        dir={language === "fa" ? "rtl" : "ltr"}
        className="w-[24rem] max-w-[calc(100vw-2rem)]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileVideo className="size-5 text-primary" aria-hidden="true" />
            {t("videoConvert.title")}
          </DialogTitle>
          <DialogDescription>{t("videoConvert.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {queue.slice(0, 4).map((item, index) => (
            <div
              key={`${item.file.name}-${index}`}
              className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs"
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                {item.file.name}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {formatInteger(Math.round(item.file.size / 1024), language)}{" "}
                {t("videoConvert.kb")}
              </span>
            </div>
          ))}
          {totalFiles > 4 ? (
            <p className="text-center text-[11px] text-muted-foreground">
              +{formatInteger(totalFiles - 4, language)}…
            </p>
          ) : null}

          {busy ? (
            <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  {t("videoConvert.converting")} — {headName}
                </span>
                <span>{formatInteger(Math.round(progress * 100), language)}٪</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-[width] duration-150"
                  style={{ width: `${Math.min(1, progress) * 100}%` }}
                />
              </div>
            </div>
          ) : null}

          {failed ? (
            <p className="text-xs text-destructive">{t("videoConvert.failed")}</p>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          {busy ? (
            <Button type="button" variant="ghost" onClick={cancel}>
              {t("videoConvert.cancelRun")}
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={cancel}>
              {t("videoConvert.cancel")}
            </Button>
          )}
          <Button
            type="button"
            onClick={convert}
            disabled={busy}
            className="gap-2"
          >
            {!busy ? null : (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {t("videoConvert.convert")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
