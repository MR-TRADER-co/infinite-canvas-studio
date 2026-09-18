"use client";

/**
 * Open-from-path dialog: the recall half of the "save at an address" system —
 * brings a saved `.icb` project back from a full typed path.
 *
 * Address modes by shell:
 * - **Desktop (Tauri)** — the NATIVE Windows open dialog opens
 *   AUTOMATICALLY («پنجرهٔ بازکردن خود ویندوز»): the user browses the real
 *   folder tree, the OS returns an existing file's path, and the payload is
 *   read through the `read_text_file` IPC command. The typed path stays as
 *   a power-user alternative.
 * - **Web + local bridge** — when the app is served from the same machine the
 *   user addresses (local preview / self-hosted), the path is read through
 *   the Next.js server bridge (`/api/fs/load`).
 * - **Web without bridge** — typed paths are impossible, so the dialog offers
 *   the standard file-open picker instead (the desktop build is the home of
 *   path recall).
 *
 * The loaded payload is pre-validated with the app serializer, then handed to
 * the composition root via `project:import-requested` (feature modules never
 * mutate the scene directly). Feedback flows through `ui:notice` toasts.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  FileJson,
  FolderOpen,
  FolderSearch,
  Loader2,
  Server,
  Upload,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import { isTauriEnvironment } from "@/platform/tauri/log";
import {
  loadProjectFromPath,
  loadProjectViaNativeDialog,
} from "@/persistence/LoadFromDisk";
import {
  probeLocalFsBridge,
  type LocalFsBridgeInfo,
} from "@/persistence/LocalFsBridge";
import type { VersionedSerializer } from "@/persistence/VersionedSerializer";
import { useTranslation } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import { cn } from "@/lib/utils";

/** Props: the dialog's open state is owned by the menu. */
export interface OpenFromPathDialogProps {
  /** Whether the dialog is visible. */
  readonly open: boolean;
  /** Callback toggling the open state (Escape / overlay / cancel). */
  readonly onOpenChange: (open: boolean) => void;
}

/** Emits one notice toast on the app bus (rendered by NoticeToasts). */
function emitNotice(message: string, severity: "info" | "error"): void {
  AppContext.getDefault()
    .tryGet(Services.eventBus)
    ?.emit("ui:notice", { messageKey: message, severity });
}

/**
 * @param props - open state plumbing from the project menu.
 * @returns the open-from-path dialog.
 */
export default function OpenFromPathDialog({
  open,
  onOpenChange,
}: OpenFromPathDialogProps): ReactNode {
  const { t, language } = useTranslation();
  const [pathDraft, setPathDraft] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"none" | "load">("none");
  const [bridge, setBridge] = useState<"probing" | "ready" | "off">("probing");
  const [bridgeInfo, setBridgeInfo] = useState<LocalFsBridgeInfo | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** StrictMode-safe guard: the native picker auto-opens at most once. */
  const autoLaunched = useRef(false);
  /** In-flight guard: the application-modal native picker can't be
   *  double-opened while it is up. */
  const nativeInFlight = useRef(false);

  const desktop = isTauriEnvironment();

  /** Probes the local bridge once per mount (memoised module-wide). */
  useEffect(() => {
    if (desktop) {
      return;
    }
    let cancelled = false;
    void probeLocalFsBridge().then((info) => {
      if (cancelled) {
        return;
      }
      setBridgeInfo(info);
      setBridge(info === null ? "off" : "ready");
    });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  /** Emits one translated notice toast on the app bus. */
  const notify = emitNotice;

  /**
   * Pre-validates a raw `.icb` payload with the app serializer, then hands
   * it — plus its source PATH — to the composition root
   * (`project:import-requested` → full restore + document title/recent
   * files). Future-format files dispatch too: the root surfaces the
   * Persian error and opens the document read-only (R4.4a).
   *
   * @param raw - the raw file payload.
   * @param path - the absolute path the payload was read from (native /
   *        bridge opens; the picker import has none).
   * @returns whether the import was dispatched.
   */
  const ingestRaw = useCallback(
    (raw: string, path?: string): boolean => {
      const serializer = AppContext.getDefault().tryGet(Services.serializer);
      if (serializer === undefined) {
        emitNotice(t("openAt.failedToast"), "error");
        return false;
      }
      const outcome = (serializer as VersionedSerializer).deserialize(raw);
      if (outcome === null || outcome.status === "corrupt") {
        setPathError(t("openAt.corrupt"));
        return false;
      }
      AppContext.getDefault()
        .tryGet(Services.eventBus)
        ?.emit("project:import-requested", { raw, path });
      emitNotice(
        `${t("openAt.loadedToast")} — ${formatInteger(outcome.data.objects.length, language)} ${t("openAt.loadedUnit")}`,
        "info",
      );
      onOpenChange(false);
      return true;
    },
    [t, language, onOpenChange],
  );

  /** Typed-path flow: normalise, load through the shell's dispatcher. */
  const onLoad = (): void => {
    if (busy !== "none") {
      return;
    }
    if (pathDraft.trim().length === 0) {
      setPathError(t("openAt.invalid"));
      return;
    }
    setBusy("load");
    setPathError(null);
    void loadProjectFromPath(pathDraft).then((result) => {
      setBusy("none");
      if (result.kind === "loaded") {
        ingestRaw(result.raw, result.path);
        return;
      }
      if (result.kind === "cancelled") {
        // The typed-path reader never cancels, but staying quiet beats a
        // bogus error toast if that ever changes.
        return;
      }
      if (result.kind === "unsupported") {
        notify(t("openAt.failedToast"), "error");
        return;
      }
      // Machine-readable codes → inline / toast feedback.
      if (result.reason === "invalid-path") {
        setPathError(t("openAt.invalid"));
      } else if (result.reason === "not-found") {
        setPathError(t("openAt.notFound"));
      } else if (result.reason === "not-icb") {
        setPathError(t("openAt.corrupt"));
      } else if (result.reason === "outside-roots") {
        setPathError(t("saveAt.outside"));
      } else if (result.reason === "too-large") {
        setPathError(t("saveAt.tooLarge"));
      } else {
        notify(`${t("openAt.failedToast")} — ${result.reason}`, "error");
      }
    });
  };

  /** No-bridge web fallback: the standard file-open picker. */
  const onPickFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    // Allow re-picking the same file: clear the value after reading.
    event.target.value = "";
    if (file === undefined) {
      return;
    }
    void file.text().then((raw) => {
      ingestRaw(raw);
    });
  };

  /** Desktop flow: native Windows open dialog → real file → recall.
   *  All state updates happen AFTER the OS dialog resolves (it is
   *  application-modal, so no busy overlay is needed while it is open; the
   *  in-flight ref keeps the picker from being double-opened). */
  const runNativeOpen = useCallback((): void => {
    if (nativeInFlight.current) {
      return;
    }
    nativeInFlight.current = true;
    void loadProjectViaNativeDialog().then((result) => {
      nativeInFlight.current = false;
      if (result.kind === "loaded") {
        ingestRaw(result.raw, result.path);
        return;
      }
      if (result.kind === "failed") {
        emitNotice(`${t("openAt.failedToast")} — ${result.reason}`, "error");
      }
      // cancelled / unsupported → stay open, stay quiet: the typed-path
      // alternative is right below and no error happened.
    });
  }, [t, ingestRaw]);

  /** Desktop: the native Windows open dialog opens AUTOMATICALLY as the
   *  dialog mounts — the user lands straight in the OS file picker.
   *  Cancelling it just leaves the typed-path alternative on screen. */
  useEffect(() => {
    if (!open || !desktop || autoLaunched.current) {
      return;
    }
    autoLaunched.current = true;
    void runNativeOpen();
  }, [open, desktop, runNativeOpen]);

  const typedMode = desktop || bridge === "ready";
  const examplePath =
    bridgeInfo !== null && bridgeInfo.roots.length > 0
      ? `${bridgeInfo.roots[bridgeInfo.roots.length - 1]}/board.icb`
      : "/home/you/board.icb";
  const rootsHint =
    bridgeInfo !== null ? bridgeInfo.roots.join(" · ") : t("openAt.hint");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="auto"
        className="max-w-md rounded-2xl border-border/70 bg-popover/95 shadow-2xl shadow-black/25 backdrop-blur-xl"
      >
        <DialogHeader className="space-y-2">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <FolderSearch className="size-5 text-primary" aria-hidden="true" />
            {t("openAt.title")}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            {t("openAt.description")}
          </DialogDescription>
        </DialogHeader>

        {/* Format + bridge badges — the app's own project format. */}
        <div className="flex flex-wrap items-center gap-2" dir="auto">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/50 px-2 py-1 text-[11px] font-medium text-muted-foreground">
            <FileJson className="size-3.5" aria-hidden="true" />
            {t("openAt.formatBadge")}
          </span>
          {!desktop && bridge === "ready" ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
              <Server className="size-3.5" aria-hidden="true" />
              {t("saveAt.bridgeBadge")}
            </span>
          ) : null}
        </div>

        {typedMode ? (
          <div className="space-y-2" dir="auto">
            {desktop ? (
              /* ── Native Windows picker: the primary desktop action —
                 it also auto-opened when this dialog mounted. ── */
              <>
                <Button
                  type="button"
                  variant="default"
                  className="w-full justify-center gap-2 rounded-xl font-medium"
                  disabled={busy !== "none"}
                  onClick={() => void runNativeOpen()}
                >
                  <FolderOpen className="size-4" aria-hidden="true" />
                  {t("openAt.nativePick")}
                </Button>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t("openAt.nativeHint")}
                </p>
                <div
                  className="flex items-center gap-2 pt-1"
                  dir="auto"
                  aria-hidden="true"
                >
                  <span className="h-px flex-1 bg-border/60" />
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {t("openAt.nativeDivider")}
                  </span>
                  <span className="h-px flex-1 bg-border/60" />
                </div>
              </>
            ) : null}
            <label
              htmlFor="open-at-path"
              className="block text-xs font-medium text-foreground/90"
            >
              {t("openAt.pathLabel")}
            </label>
            <Input
              id="open-at-path"
              dir="ltr"
              spellCheck={false}
              autoComplete="off"
              className={cn(
                "rounded-xl border-border/60 bg-background/80 font-mono text-[13px] text-left",
                pathError !== null &&
                  "border-red-500/60 focus-visible:ring-red-500/40",
              )}
              placeholder={
                desktop ? "C:\\Users\\You\\Desktop\\board.icb" : examplePath
              }
              value={pathDraft}
              onChange={(event) => {
                setPathDraft(event.target.value);
                if (pathError !== null) {
                  setPathError(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onLoad();
                }
              }}
            />
            {pathError !== null ? (
              <p className="text-[11px] font-medium text-red-500" role="alert">
                {pathError}
              </p>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {desktop
                  ? t("openAt.hint")
                  : `${t("openAt.serverNote")} ${rootsHint}`}
              </p>
            )}
          </div>
        ) : (
          /* ── Web without the bridge: the standard file-open picker. ── */
          <div className="space-y-2" dir="auto">
            {bridge === "off" ? (
              <>
                <Button
                  type="button"
                  variant="default"
                  className="w-full justify-center gap-2 rounded-xl font-medium"
                  onClick={() => inputRef.current?.click()}
                >
                  <Upload className="size-4" aria-hidden="true" />
                  {t("openAt.pickFile")}
                </Button>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t("openAt.noBridgeNote")}
                </p>
              </>
            ) : (
              <p className="flex items-center gap-2 text-[11px] leading-relaxed text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                {t("openAt.probing")}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="mt-1 gap-2 sm:justify-start" dir="auto">
          {typedMode ? (
            <Button
              type="button"
              className="justify-center gap-2 rounded-xl font-medium"
              disabled={busy !== "none" || bridge === "probing"}
              onClick={onLoad}
            >
              {busy === "load" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <FolderSearch className="size-4" aria-hidden="true" />
              )}
              {busy === "load" ? t("openAt.busy") : t("openAt.load")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="justify-center rounded-xl font-medium"
            disabled={busy !== "none"}
            onClick={() => onOpenChange(false)}
          >
            {t("openAt.cancel")}
          </Button>
        </DialogFooter>
        {/* Hidden file input for the no-bridge web fallback (same import
            contract as the project menu's "Open project…"). */}
        <input
          ref={inputRef}
          type="file"
          accept=".icb,application/json"
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={onPickFile}
        />
      </DialogContent>
    </Dialog>
  );
}
