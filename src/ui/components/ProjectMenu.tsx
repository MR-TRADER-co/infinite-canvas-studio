"use client";

/**
 * Project menu: document-level commands, floating at the inline-start top
 * corner of the canvas (the "file" corner opposite the layers panel).
 *
 * Commands (R4.5 — every action dispatches a REGISTERED core.* command):
 * - Save (Ctrl+S) → `core.file.save` — re-saves the known path or opens
 *   the Save-As flow when the document is unpathed.
 * - Save to path… (Ctrl+Shift+S) → `core.file.saveAs` — the typed-address
 *   / native-picker / bridge / download dialog.
 * - Open from path… — the recall twin (typed `.icb` path).
 * - Open project… (Ctrl+O) → `core.file.open` — file picker / native
 *   open dialog (guarded when dirty).
 * - New project (Ctrl+N) → `core.file.new` (guarded when dirty).
 * - Export PNG… → `core.export.png` (R4.8).
 * - Recent files (R4.7) — the last ten projects, missing files grayed
 *   out (validated per shell), one click re-opens the file.
 * - Download project / source bundle — the web-shell escapes.
 *
 * The menu also HOSTS the command-triggered dialogs: the
 * `ui:save-project-requested` / `ui:open-project-requested` events (from
 * the shortcuts and the unsaved-changes guard) open the matching dialog.
 *
 * A failed import (corrupt file) shakes the button and marks it with a red
 * dot for a few seconds — self-contained feedback, no toast infra needed.
 */
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  Check,
  Copy,
  FileArchive,
  FileDown,
  FilePlus2,
  FileAudio,
  FileText,
  FileX,
  FolderOpen,
  FolderSearch,
  Group,
  HardDriveDownload,
  ImageDown,
  ImagePlus,
  Lock,
  PenLine,
  Printer,
  Save,
  Trash2,
  Ungroup,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AppContext } from "@/AppContext";
import { dispatchCommand } from "@/ui/hooks/useCommands";
import { Application, Services } from "@/App";
import { buildProjectData } from "@/persistence/ProjectFile";
import { useTranslation } from "@/ui/i18n";
import SaveAtPathDialog from "@/ui/components/SaveAtPathDialog";
import OpenFromPathDialog from "@/ui/components/OpenFromPathDialog";
import type { ZOrderOp } from "@/core/commands/ZOrderOps";
import ExportPngDialog from "@/ui/components/ExportPngDialog";
import {
  loadProjectFromPath,
  probeRecentFileExists,
} from "@/persistence/LoadFromDisk";
import type { RecentFileEntry } from "@/persistence/RecentFilesService";
import { isTauriEnvironment } from "@/platform/tauri/log";
import { cn } from "@/lib/utils";

/** How long the import-failure marker stays visible, in milliseconds. */
const IMPORT_ERROR_MS = 2400;

/** Default file name of a downloaded project. */
const DOWNLOAD_NAME = "infinite-canvas.icb";

/** URL of the full-source bundle (complete project, ready to build an EXE). */
const SOURCE_BUNDLE_URL = "/downloads/infinite-canvas-studio.zip";

export default function ProjectMenu() {
  const { t } = useTranslation();
  const [importError, setImportError] = useState(false);
  const [sourceReady, setSourceReady] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [openAtDialogOpen, setOpenAtDialogOpen] = useState(false);
  const [recent, setRecent] = useState<readonly RecentFileEntry[]>([]);
  /** Path → existence map (null = unvalidated / unvalidatable). */
  const [recentExists, setRecentExists] = useState<
    Record<string, boolean | null>
  >({});

  /**
   * Source-bundle availability probe: the zip ships only with the hosted
   * preview build. Local clones and the desktop shell get a failed HEAD
   * and the menu item hides itself — no dead links anywhere.
   */
  useEffect(() => {
    let cancelled = false;
    fetch(SOURCE_BUNDLE_URL, { method: "HEAD" })
      .then((response) => {
        if (!cancelled) {
          setSourceReady(response.ok);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSourceReady(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /** Transient red-dot marker when an import was refused (boot-safe). */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | undefined;

    const markError = (): void => {
      setImportError(true);
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => setImportError(false), IMPORT_ERROR_MS);
    };

    const install = (): void => {
      const bus = AppContext.getDefault().tryGet(Services.eventBus);
      if (bus !== undefined) {
        unsubscribe = bus.on("project:import-failed", markError);
      }
    };

    install();
    if (unsubscribe === undefined) {
      // The bus registers during boot; retry once it resolved.
      void Application.boot().then(() => {
        if (!cancelled) {
          install();
        }
      });
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, []);

  /** Re-reads the recent list whenever the menu (re)opens (R4.7). */
  const refreshRecent = (openState: boolean): void => {
    if (!openState) {
      return;
    }
    const service = AppContext.getDefault().tryGet(Services.recentFiles);
    const entries = service?.getRecentFiles() ?? [];
    setRecent(entries);
    // Validate every entry in parallel (missing files gray out).
    const checks: Array<Promise<void>> = entries.map(async (entry) => {
      const exists = await probeRecentFileExists(entry.path);
      setRecentExists((previous) => ({ ...previous, [entry.path]: exists }));
    });
    void Promise.all(checks);
  };

  /** Opens one recent entry: read → import (with its path). */
  const openRecent = (entry: RecentFileEntry): void => {
    void loadProjectFromPath(entry.path).then((result) => {
      if (result.kind === "loaded") {
        const bus = AppContext.getDefault().tryGet(Services.eventBus);
        bus?.emit("project:import-requested", {
          raw: result.raw,
          path: result.path,
        });
        return;
      }
      emitNotice(t("recent.openFailed"), "error");
    });
  };

  /** The menu hosts the command-triggered dialogs (R4.5). */
  useEffect(() => {
    let cancelled = false;
    let detachSave: (() => void) | undefined;
    let detachOpen: (() => void) | undefined;
    const install = (): void => {
      const bus = AppContext.getDefault().tryGet(Services.eventBus);
      if (bus === undefined) {
        return;
      }
      detachSave = bus.on("ui:save-project-requested", () => {
        setSaveDialogOpen(true);
      });
      detachOpen = bus.on("ui:open-project-requested", () => {
        // Desktop: the recall dialog auto-launches the native picker;
        // web: the hidden file input.
        if (isTauriEnvironment()) {
          setOpenAtDialogOpen(true);
          return;
        }
        inputRef.current?.click();
      });
    };
    install();
    if (detachSave === undefined) {
      void Application.boot().then(() => {
        if (!cancelled) {
          install();
        }
      });
    }
    return () => {
      cancelled = true;
      detachSave?.();
      detachOpen?.();
    };
  }, []);

  const onPickFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    // Allow re-picking the same file: clear the value after reading.
    event.target.value = "";
    if (file === undefined) {
      return;
    }
    void file.text().then((raw) => {
      const bus = AppContext.getDefault().tryGet(Services.eventBus);
      bus?.emit("project:import-requested", { raw });
    });
  };

  return (
    <TooltipProvider delayDuration={400}>
      <input
        ref={inputRef}
        type="file"
        accept=".icb,application/json"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={onPickFile}
      />
      <DropdownMenu onOpenChange={refreshRecent}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger
              aria-label={t("project.menu")}
              className={cn(
                "absolute start-4 top-4 z-10 flex size-9 items-center justify-center rounded-xl border",
                "outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring",
                "border-border/60 bg-background/80 text-muted-foreground shadow-md shadow-black/15",
                "backdrop-blur-xl hover:text-foreground data-[state=open]:border-border/60",
                "data-[state=open]:bg-background/90 data-[state=open]:text-foreground",
                "data-[state=open]:shadow-lg data-[state=open]:shadow-black/20",
                importError && "animate-shake border-red-500/60",
              )}
            >
              <HardDriveDownload className="size-4" aria-hidden="true" />
              {importError ? (
                <span
                  className="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-red-500"
                  aria-hidden="true"
                />
              ) : null}
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            {t("project.menu")}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-[11px] tracking-wide text-muted-foreground">
            {t("project.menu")}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => dispatchCommand("core.file.save")}>
            <Check className="size-4" aria-hidden="true" />
            {t("file.save")}
            <MenuHint>Ctrl+S</MenuHint>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => dispatchCommand("core.file.saveAs")}
          >
            <Save className="size-4" aria-hidden="true" />
            {t("project.saveAt")}
            <MenuHint>Ctrl+Shift+S</MenuHint>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpenAtDialogOpen(true)}>
            <FolderSearch className="size-4" aria-hidden="true" />
            {t("project.openAt")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => dispatchCommand("core.file.open")}>
            <FolderOpen className="size-4" aria-hidden="true" />
            {t("file.open")}
            <MenuHint>Ctrl+O</MenuHint>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => dispatchCommand("core.file.new")}>
            <FilePlus2 className="size-4" aria-hidden="true" />
            {t("file.new")}
            <MenuHint>Ctrl+N</MenuHint>
          </DropdownMenuItem>
          {recent.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] tracking-wide text-muted-foreground">
                {t("recent.title")}
              </DropdownMenuLabel>
              {recent.map((entry) => {
                const exists = recentExists[entry.path] ?? null;
                const missing = exists === false;
                return (
                  <DropdownMenuItem
                    key={entry.path}
                    disabled={missing}
                    onSelect={() => openRecent(entry)}
                    className={cn(missing && "opacity-45")}
                  >
                    {missing ? (
                      <FileX className="size-4" aria-hidden="true" />
                    ) : (
                      <FileText className="size-4" aria-hidden="true" />
                    )}
                    <span
                      className="truncate"
                      title={missing ? t("recent.missing") : entry.path}
                    >
                      {entry.name}
                    </span>
                    <MenuHint>{missing ? t("recent.missing") : ""}</MenuHint>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuItem
                onSelect={() => {
                  AppContext.getDefault().tryGet(Services.recentFiles)?.clear();
                  setRecent([]);
                  setRecentExists({});
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t("recent.clear")}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => dispatchCommand("core.insert.image")}
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            {t("project.insertImage")}
          </DropdownMenuItem>
          {/* فاز A1 (RA1.3a): the File→«درج صوت…» path — the SAME
              command the Insert-Panel audio card registers. */}
          <DropdownMenuItem
            onSelect={() => dispatchCommand("core.insert.audio")}
          >
            <FileAudio className="size-4" aria-hidden="true" />
            {t("project.insertAudio")}
          </DropdownMenuItem>
          {/* فاز P1 (RP1.3a): the File→«درج PDF…» path — the SAME
              command the Insert-Panel PDF card registers. */}
          <DropdownMenuItem onSelect={() => dispatchCommand("core.insert.pdf")}>
            <FileText className="size-4" aria-hidden="true" />
            {t("project.insertPdf")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => dispatchCommand("core.export.png")}>
            <ImageDown className="size-4" aria-hidden="true" />
            {t("file.exportPng")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => dispatchCommand("core.export.svg")}>
            <PenLine className="size-4" aria-hidden="true" />
            {t("file.exportSvg")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => dispatchCommand("core.export.pdf")}>
            <Printer className="size-4" aria-hidden="true" />
            {t("file.exportPdf")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => dispatchCommand("core.export.markdown")}
          >
            <FileText className="size-4" aria-hidden="true" />
            {t("file.exportMarkdown")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => dispatchCommand("core.import.markdown")}
          >
            <FileText className="size-4" aria-hidden="true" />
            {t("file.importMarkdown")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={downloadProject}>
            <FileDown className="size-4" aria-hidden="true" />
            {t("project.download")}
          </DropdownMenuItem>
          {sourceReady ? (
            <DropdownMenuItem onSelect={downloadSourceBundle}>
              <FileArchive className="size-4" aria-hidden="true" />
              {t("project.downloadSource")}
              <MenuHint>ZIP · ۱٫۵MB</MenuHint>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {/* Edit section (R2.9): selection-level commands, the twins of
              the contextual cluster and the keyboard shortcuts. */}
          <DropdownMenuLabel className="text-[11px] tracking-wide text-muted-foreground">
            {t("project.edit")}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={editDuplicate}>
            <Copy className="size-4" aria-hidden="true" />
            {t("selectionActions.duplicate")}
            <MenuHint>Ctrl+D</MenuHint>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={editDelete} variant="destructive">
            <Trash2 className="size-4" aria-hidden="true" />
            {t("selectionActions.delete")}
            <MenuHint>Del</MenuHint>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={editGroup}>
            <Group className="size-4" aria-hidden="true" />
            {t("selectionActions.group")}
            <MenuHint>Ctrl+G</MenuHint>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={editUngroup}>
            <Ungroup className="size-4" aria-hidden="true" />
            {t("selectionActions.ungroup")}
            <MenuHint>Ctrl+Shift+G</MenuHint>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={editLock}>
            <Lock className="size-4" aria-hidden="true" />
            {t("layers.lock")}
            <MenuHint>Ctrl+L</MenuHint>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <HardDriveDownload className="size-4" aria-hidden="true" />
              {t("selectionActions.zOrder")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              <DropdownMenuItem onSelect={() => editZOrder("front")}>
                {t("selectionActions.bringFront")}
                <MenuHint>Ctrl+Shift+]</MenuHint>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editZOrder("forward")}>
                {t("selectionActions.bringForward")}
                <MenuHint>Ctrl+]</MenuHint>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editZOrder("backward")}>
                {t("selectionActions.sendBackward")}
                <MenuHint>Ctrl+[</MenuHint>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editZOrder("back")}>
                {t("selectionActions.sendBack")}
                <MenuHint>Ctrl+Shift+[</MenuHint>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => inputRef.current?.click()}>
            <FolderOpen className="size-4" aria-hidden="true" />
            {t("project.open")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Save-at-path dialog: the desktop "typed address" / web "system
          picker" flow, in the app's own .icb format. The keyed remount
          resets the draft state every time it opens. */}
      {saveDialogOpen ? (
        <SaveAtPathDialog
          key="save-at-open"
          open
          onOpenChange={setSaveDialogOpen}
        />
      ) : null}
      {/* Open-from-path dialog: the recall twin — desktop IPC read or the
          local server bridge, in the app's own .icb format. Keyed remount
          resets the draft state every time it opens. */}
      {openAtDialogOpen ? (
        <OpenFromPathDialog
          key="open-at-open"
          open
          onOpenChange={setOpenAtDialogOpen}
        />
      ) : null}
      {/* Export PNG dialog (R4.8): UI-store visibility, command-opened. */}
      <ExportPngDialog />
    </TooltipProvider>
  );
}

/** Emits one notice toast on the app bus. */
function emitNotice(message: string, severity: "info" | "error"): void {
  AppContext.getDefault()
    .tryGet(Services.eventBus)
    ?.emit("ui:notice", { messageKey: message, severity });
}

/** Inline hint chip at the inline end of a menu row (keyboard shortcut). */
function MenuHint({ children }: { children: ReactNode }) {
  return (
    <span
      className="ms-auto rounded border border-border/60 bg-muted/40 px-1 py-px font-mono text-[10px] text-muted-foreground"
      dir="ltr"
    >
      {children}
    </span>
  );
}

/**
 * Serialises the live scene and downloads it as a `.icb` file — the exact
 * payload the desktop build persists to disk.
 */
function downloadProject(): void {
  const context = AppContext.getDefault();
  const scene = context.tryGet(Services.scene);
  const serializer = context.tryGet(Services.serializer);
  if (scene === undefined || serializer === undefined) {
    return;
  }
  const payload = serializer.serialize(buildProjectData(scene));
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = DOWNLOAD_NAME;
  anchor.click();
  // Give the navigation a tick before releasing the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Downloads the full source bundle — the complete project (source, Tauri
 * shell, tests, README with local-run and EXE-build instructions) as a
 * ready-to-extract zip. Delivery twin of the desktop installer.
 */
function downloadSourceBundle(): void {
  const anchor = document.createElement("a");
  anchor.href = SOURCE_BUNDLE_URL;
  anchor.download = "infinite-canvas-studio.zip";
  anchor.rel = "noopener";
  anchor.click();
}

/*
 * Phase 3B.5 (R3B5.2): every menu action now dispatches the REGISTERED
 * core.* command through the single dispatcher — identical execution to
 * the toolbar and the keyboard (one funnel, one undo semantics).
 */

/** Menu twin of the duplicate action (Ctrl+D). */
function editDuplicate(): void {
  dispatchCommand("core.selection.duplicate");
}

/** Menu twin of the delete action (Del). */
function editDelete(): void {
  dispatchCommand("core.selection.delete");
}

/** Menu twin of the group action (Ctrl+G). */
function editGroup(): void {
  dispatchCommand("core.selection.group");
}

/** Menu twin of the ungroup action (Ctrl+Shift+G). */
function editUngroup(): void {
  dispatchCommand("core.selection.ungroup");
}

/** Menu twin of the lock toggle (Ctrl+L). */
function editLock(): void {
  dispatchCommand("core.selection.toggleLock");
}

/** Menu twin of the z-order operations (Ctrl+[/]). */
function editZOrder(op: ZOrderOp): void {
  const id =
    op === "front"
      ? "core.selection.bringFront"
      : op === "forward"
        ? "core.selection.bringForward"
        : op === "backward"
          ? "core.selection.sendBackward"
          : "core.selection.sendBack";
  dispatchCommand(id);
}
