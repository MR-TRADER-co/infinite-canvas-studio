"use client";

/**
 * Save-at-path dialog: writes the current project to a user-chosen location
 * in the app's own `.icb` format (the versioned envelope of
 * `VersionedSerializer` — the same payload the autosave slot, the `.icb`
 * download and the desktop build all share).
 *
 * Address modes by shell:
 * - **Desktop (Tauri)** — the NATIVE Windows save dialog opens
 *   automatically («پنجرهٔ ذخیرهٔ خود ویندوز»): the user browses the real
 *   folder tree and names the file; the payload is written through the
 *   `save_text_file` IPC command. The typed path stays as a power-user
 *   alternative (the literal «آدرسی که بهش میدم» flow).
 * - **Web + local bridge** — when the app is served from the same machine
 *   the user addresses (local preview / self-hosted), the typed path is
 *   written for real through the Next.js server bridge (`/api/fs/save`).
 * - **Web elsewhere** — the system save picker (File System Access API) is
 *   the browser-sanctioned way to "give an address"; when the API is
 *   unavailable (sandboxed preview, Firefox/Safari…), the dialog offers the
 *   download fallback instead.
 *
 * Feedback flows through `ui:notice` toasts; the path input is LTR/mono
 * even in the Persian shell (paths are Latin-script artifacts).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  FileJson,
  FolderInput,
  HardDriveDownload,
  Loader2,
  Save,
  Server,
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
  hasSystemSavePicker,
  normalizeSavePath,
  saveProjectToPath,
  saveProjectViaNativeDialog,
  saveProjectViaPicker,
  serializeProjectFile,
  type ProjectSaveSections,
} from "@/persistence/SaveToDisk";
import {
  probeLocalFsBridge,
  saveViaLocalFsBridge,
  type LocalFsBridgeInfo,
} from "@/persistence/LocalFsBridge";
import { buildProjectData } from "@/persistence/ProjectFile";
import { collectVideoAssetHashes } from "@/core/model/VideoObject";
import { collectAudioAssetHashes } from "@/core/model/AudioObject";
import { useTranslation } from "@/ui/i18n";
import { cn } from "@/lib/utils";

/** Props: the dialog's open state is owned by the menu. */
export interface SaveAtPathDialogProps {
  /** Whether the dialog is visible. */
  readonly open: boolean;
  /** Callback toggling the open state (Escape / overlay / cancel). */
  readonly onOpenChange: (open: boolean) => void;
}

/** Resolves the scene + serializer pair, or null when not booted yet. */
function resolvePersistenceDeps(): {
  scene: unknown;
  serializer: unknown;
} | null {
  const context = AppContext.getDefault();
  const scene = context.tryGet(Services.scene);
  const serializer = context.tryGet(Services.serializer);
  if (scene === undefined || serializer === undefined) {
    return null;
  }
  return { scene, serializer };
}

/** @returns the document's plugins passthrough (§1.7.4, or {}). */
function pluginsOf(): Readonly<Record<string, unknown>> | undefined {
  return AppContext.getDefault().tryGet(Services.document)?.getPlugins();
}

/**
 * Collects EVERY persisted document section for the save paths (the
 * save-path fix): bookmarks, named styles, the property schema and the
 * link registry — so no save route (typed path / native dialog /
 * picker / download) ever silently drops a section again.
 *
 * @returns the sections bundle for SaveToDisk calls, or undefined when
 *          the app has not booted far enough to own a scene.
 */
function saveSectionsOf(): ProjectSaveSections | undefined {
  const context = AppContext.getDefault();
  const scene = context.tryGet(Services.scene);
  if (scene === undefined) {
    return undefined;
  }
  const links = context.tryGet(Services.links);
  return {
    bookmarks: context.tryGet(Services.bookmarks)?.list(),
    styles: context.tryGet(Services.styles)?.toSection(),
    propertySchema: context.tryGet(Services.propertySchema)?.toSection(),
    links: links?.toSection(
      new Set(scene.objects.map((object) => object.id)),
    ),
  };
}

/** @returns the suggested save name: the document's own name or the default. */
function suggestedNameOf(): string {
  const name = AppContext.getDefault().tryGet(Services.document)?.getName();
  return name === null || name === undefined ? "infinite-canvas.icb" : name;
}

/**
 * @param documentName - the document's display name (or null).
 * @returns the download file name (document name or the default).
 */
function downloadNameOf(documentName: string | null | undefined): string {
  return documentName === null || documentName === undefined
    ? "infinite-canvas.icb"
    : documentName;
}

/** Emits one notice toast on the app bus (rendered by NoticeToasts; unknown
 *  keys render verbatim, so composed text with the path works). */
function emitNotice(message: string, severity: "info" | "error"): void {
  AppContext.getDefault()
    .tryGet(Services.eventBus)
    ?.emit("ui:notice", { messageKey: message, severity });
}

/**
 * Records a completed disk save in the document lifecycle (R4.5): the
 * path/name refresh, clean flag, recovery baseline and the recent-files
 * entry all flow from the composition root's services.
 *
 * @param path - the absolute path the project was written to.
 */
function noteSaved(path: string): void {
  const context = AppContext.getDefault();
  const document = context.tryGet(Services.document);
  const recentFiles = context.tryGet(Services.recentFiles);
  const bus = context.tryGet(Services.eventBus);
  const savedAt = Date.now();
  document?.noteDiskSave(path, savedAt);
  recentFiles?.add(path);
  bus?.emit("project:file-saved", { path, savedAt });
  // فاز M1 (A.2.1): every completed disk save adopts the asset scope —
  // inbox files MOVE into this project's sidecar on the first Save As;
  // a later save to a new path COPIES (the old file keeps working).
  // فاز A1: audio hashes ride the SAME manifest (video + audio lists).
  const assets = context.tryGet(Services.assetStore);
  const scene = context.tryGet(Services.scene);
  if (assets !== undefined && scene !== undefined) {
    void assets.syncProjectPath(path, [
      ...collectVideoAssetHashes(scene.objects),
      ...collectAudioAssetHashes(scene.objects),
    ]);
  }
}

/**
 * @param props - open state plumbing from the project menu.
 * @returns the save-at-path dialog.
 */
export default function SaveAtPathDialog({
  open,
  onOpenChange,
}: SaveAtPathDialogProps): ReactNode {
  const { t } = useTranslation();
  const [pathDraft, setPathDraft] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"none" | "typed" | "picker">("none");
  const [bridge, setBridge] = useState<"probing" | "ready" | "off">("probing");
  const [bridgeInfo, setBridgeInfo] = useState<LocalFsBridgeInfo | null>(null);
  /** StrictMode-safe guard: the native picker auto-opens at most once. */
  const autoLaunched = useRef(false);
  /** In-flight guard: the application-modal native picker can't be
   *  double-opened while it is up. */
  const nativeInFlight = useRef(false);

  const desktop = isTauriEnvironment();
  const pickerAvailable = hasSystemSavePicker();

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

  /** Resolves the scene + serializer pair, or null when not booted yet. */
  const persistence = resolvePersistenceDeps;

  /** Emits one translated notice toast on the app bus. */
  const notify = emitNotice;

  /** Maps a bridge failure code onto inline / toast feedback. */
  const applyBridgeError = (code: string): void => {
    if (
      code === "empty" ||
      code === "not-absolute" ||
      code === "invalid-path"
    ) {
      setPathError(t("saveAt.invalid"));
      return;
    }
    if (code === "outside-roots") {
      setPathError(t("saveAt.outside"));
      return;
    }
    if (code === "too-large") {
      setPathError(t("saveAt.tooLarge"));
      return;
    }
    notify(`${t("saveAt.failedToast")} — ${code}`, "error");
  };

  /** Typed-address flow: desktop IPC write or the local server bridge. */
  const onTypedSave = (): void => {
    const normalised = normalizeSavePath(pathDraft);
    if (normalised === null) {
      setPathError(t("saveAt.invalid"));
      return;
    }
    const deps = persistence();
    if (deps === null) {
      notify(t("saveAt.failedToast"), "error");
      return;
    }
    setBusy("typed");
    setPathError(null);
    if (desktop) {
      void saveProjectToPath(
        deps.scene as Parameters<typeof saveProjectToPath>[0],
        deps.serializer as Parameters<typeof saveProjectToPath>[1],
        pathDraft,
        pluginsOf(),
        saveSectionsOf(),
      ).then((result) => {
        setBusy("none");
        if (result.kind === "saved") {
          noteSaved(result.path);
          notify(`${t("saveAt.savedToast")} — ${result.path}`, "info");
          onOpenChange(false);
        } else if (result.kind === "failed") {
          setPathError(
            result.reason === "invalid-path"
              ? t("saveAt.invalid")
              : t("saveAt.failedToast"),
          );
        } else {
          notify(t("saveAt.failedToast"), "error");
        }
      });
      return;
    }
    const payload = serializeProjectFile(
      deps.scene as Parameters<typeof serializeProjectFile>[0],
      deps.serializer as Parameters<typeof serializeProjectFile>[1],
      pluginsOf(),
      saveSectionsOf(),
    );
    void saveViaLocalFsBridge(pathDraft, payload).then((result) => {
      setBusy("none");
      if (result.kind === "saved") {
        noteSaved(result.path);
        notify(`${t("saveAt.savedToast")} — ${result.path}`, "info");
        onOpenChange(false);
      } else {
        applyBridgeError(result.code);
      }
    });
  };

  /** Desktop flow: native Windows save dialog → real folder + file name.
   *  All state updates happen AFTER the OS dialog resolves (it is
   *  application-modal, so no busy overlay is needed while it is open; the
   *  in-flight ref keeps the picker from being double-opened). */
  const runNativeSave = useCallback((): void => {
    if (nativeInFlight.current) {
      return;
    }
    const deps = resolvePersistenceDeps();
    if (deps === null) {
      emitNotice(t("saveAt.failedToast"), "error");
      return;
    }
    nativeInFlight.current = true;
    void saveProjectViaNativeDialog(
      deps.scene as Parameters<typeof saveProjectViaNativeDialog>[0],
      deps.serializer as Parameters<typeof saveProjectViaNativeDialog>[1],
      suggestedNameOf(),
      pluginsOf(),
      saveSectionsOf(),
    ).then((result) => {
      nativeInFlight.current = false;
      if (result.kind === "saved") {
        noteSaved(result.path);
        emitNotice(`${t("saveAt.savedToast")} — ${result.path}`, "info");
        onOpenChange(false);
      } else if (result.kind === "failed") {
        emitNotice(`${t("saveAt.failedToast")} — ${result.reason}`, "error");
      }
      // cancelled / unsupported → stay open, stay quiet: the typed-path
      // alternative is right below and no error happened.
    });
  }, [t, onOpenChange]);

  /** Desktop: the native Windows save dialog opens AUTOMATICALLY as the
   *  dialog mounts — the user lands straight in the OS folder picker.
   *  Cancelling it just leaves the typed-path alternative on screen. */
  useEffect(() => {
    if (!open || !desktop || autoLaunched.current) {
      return;
    }
    autoLaunched.current = true;
    void runNativeSave();
  }, [open, desktop, runNativeSave]);

  /** Web flow (no bridge): system save picker (real folder + name). */
  const onPickerSave = (): void => {
    const deps = persistence();
    if (deps === null) {
      notify(t("saveAt.failedToast"), "error");
      return;
    }
    setBusy("picker");
    void saveProjectViaPicker(
      deps.scene as Parameters<typeof saveProjectViaPicker>[0],
      deps.serializer as Parameters<typeof saveProjectViaPicker>[1],
      suggestedNameOf(),
      pluginsOf(),
      saveSectionsOf(),
    ).then((result) => {
      setBusy("none");
      if (result.kind === "saved") {
        noteSaved(result.path);
        notify(`${t("saveAt.savedToast")} — ${result.path}`, "info");
        onOpenChange(false);
      } else if (result.kind === "failed") {
        notify(`${t("saveAt.failedToast")} — ${result.reason}`, "error");
      }
      // cancelled → stay open, stay quiet.
    });
  };

  /** Web last resort: the classic browser download to the Downloads folder.
   *  The payload carries the plugins passthrough (§1.7.4) and the download
   *  counts as a save of the document's CURRENT state (clean marker). */
  const onDownloadFallback = (): void => {
    const context = AppContext.getDefault();
    const scene = context.tryGet(Services.scene);
    const serializer = context.tryGet(Services.serializer);
    const documentService = context.tryGet(Services.document);
    if (scene === undefined || serializer === undefined) {
      notify(t("saveAt.failedToast"), "error");
      return;
    }
    const name = downloadNameOf(documentService?.getName());
    const payload = serializer.serialize(
      buildProjectData(
        scene,
        documentService?.getPlugins(),
        saveSectionsOf()?.bookmarks,
        saveSectionsOf()?.styles,
        saveSectionsOf()?.propertySchema,
        saveSectionsOf()?.links,
      ),
    );
    const url = URL.createObjectURL(
      new Blob([payload], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    documentService?.markClean();
    notify(`${t("saveAt.savedToast")} — ${name}`, "info");
    onOpenChange(false);
  };

  const typedMode = desktop || bridge === "ready";
  const examplePath =
    bridgeInfo !== null && bridgeInfo.roots.length > 0
      ? `${bridgeInfo.roots[bridgeInfo.roots.length - 1]}/board.icb`
      : "/home/you/board.icb";
  const rootsHint = bridgeInfo !== null ? bridgeInfo.roots.join(" · ") : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="auto"
        className="max-w-md rounded-2xl border-border/70 bg-popover/95 shadow-2xl shadow-black/25 backdrop-blur-xl"
      >
        <DialogHeader className="space-y-2">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <FolderInput className="size-5 text-primary" aria-hidden="true" />
            {t("saveAt.title")}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            {t("saveAt.description")}
          </DialogDescription>
        </DialogHeader>

        {/* Format + bridge badges — the app's own project format. */}
        <div className="flex flex-wrap items-center gap-2" dir="auto">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/50 px-2 py-1 text-[11px] font-medium text-muted-foreground">
            <FileJson className="size-3.5" aria-hidden="true" />
            {t("saveAt.formatBadge")}
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
                  onClick={() => void runNativeSave()}
                >
                  <FolderInput className="size-4" aria-hidden="true" />
                  {t("saveAt.nativePick")}
                </Button>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t("saveAt.nativeHint")}
                </p>
                <div
                  className="flex items-center gap-2 pt-1"
                  dir="auto"
                  aria-hidden="true"
                >
                  <span className="h-px flex-1 bg-border/60" />
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {t("saveAt.nativeDivider")}
                  </span>
                  <span className="h-px flex-1 bg-border/60" />
                </div>
              </>
            ) : null}
            <label
              htmlFor="save-at-path"
              className="block text-xs font-medium text-foreground/90"
            >
              {t("saveAt.pathLabel")}
            </label>
            <Input
              id="save-at-path"
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
                if (event.key === "Enter" && busy === "none") {
                  event.preventDefault();
                  onTypedSave();
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
                  ? t("saveAt.hint")
                  : `${t("saveAt.serverNote")} ${rootsHint}`}
              </p>
            )}
          </div>
        ) : (
          /* ── Web without the bridge: system picker or download fallback. ── */
          <div className="space-y-2" dir="auto">
            {bridge === "probing" ? (
              <p className="flex items-center gap-2 text-[11px] leading-relaxed text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                {t("saveAt.probing")}
              </p>
            ) : pickerAvailable ? (
              <Button
                type="button"
                variant="default"
                className="w-full justify-center gap-2 rounded-xl font-medium"
                disabled={busy !== "none"}
                onClick={() => void onPickerSave()}
              >
                {busy === "picker" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FolderInput className="size-4" aria-hidden="true" />
                )}
                {busy === "picker" ? t("saveAt.busy") : t("saveAt.pick")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="default"
                className="w-full justify-center gap-2 rounded-xl font-medium"
                onClick={onDownloadFallback}
              >
                <HardDriveDownload className="size-4" aria-hidden="true" />
                {t("saveAt.download")}
              </Button>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {pickerAvailable ? t("saveAt.webNote") : t("saveAt.downloadNote")}
            </p>
          </div>
        )}

        <DialogFooter className="mt-1 gap-2 sm:justify-start" dir="auto">
          {typedMode ? (
            <Button
              type="button"
              className="justify-center gap-2 rounded-xl font-medium"
              disabled={busy !== "none" || (!desktop && bridge === "probing")}
              onClick={onTypedSave}
            >
              {busy === "typed" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              {busy === "typed" ? t("saveAt.busy") : t("saveAt.save")}
            </Button>
          ) : null}
          {!desktop && bridge === "ready" ? (
            /* Secondary escape hatch: even with the bridge, a plain
               download always works (belt and braces). */
            <Button
              type="button"
              variant="outline"
              className="justify-center gap-2 rounded-xl font-medium"
              disabled={busy !== "none"}
              onClick={onDownloadFallback}
            >
              <HardDriveDownload className="size-4" aria-hidden="true" />
              {t("saveAt.download")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="justify-center rounded-xl font-medium"
            disabled={busy !== "none"}
            onClick={() => onOpenChange(false)}
          >
            {t("saveAt.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
