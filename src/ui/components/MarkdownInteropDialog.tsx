"use client";

/**
 * The Markdown interop dialog (R13.1): one dialog, two tabs.
 *
 * Export: lists the per-object `.md` files (index.md + one per text
 * object) with the documented LOSSY notice for non-text objects, and
 * downloads the whole folder as a ZIP (fflate) on the web.
 *
 * Import: a multi-file `.md` picker — each file becomes one text-box
 * draft (frontmatter restores geometry/colours; the body tokenises
 * through markdown-it); ONE composite undo step for the whole batch.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Download, Upload, AlertTriangle } from "lucide-react";
import { Application, Services } from "@/App";
import { AppContext } from "@/AppContext";
import {
  exportSceneToMarkdown,
  importMarkdownFiles,
  type MarkdownExportFile,
  type MarkdownInputFile,
} from "@/persistence/MarkdownInterop";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import { CompositeCommand } from "@/core/commands/CompositeCommand";
import { zipSync } from "fflate";
import { cn } from "@/lib/utils";

/** UTF-8 text encoder for the ZIP blobs. */
const ENCODER = new TextEncoder();

/**
 * @returns the Markdown interop dialog (mounted by the AppShell).
 */
export default function MarkdownInteropDialog(): React.ReactElement | null {
  const { t } = useTranslation();
  const open = useUiStore((state) => state.markdownDialogOpen);
  const tab = useUiStore((state) => state.markdownDialogTab);
  const setOpen = useUiStore((state) => state.setMarkdownDialogOpen);

  const [files, setFiles] = useState<readonly MarkdownExportFile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<readonly MarkdownInputFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refresh the export listing whenever the dialog opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    void Application.boot().then((context: AppContext) => {
      const scene = context.tryGet(Services.scene);
      const document = context.tryGet(Services.document);
      if (scene === undefined) {
        return;
      }
      setFiles(
        exportSceneToMarkdown(scene.objects, document?.getName() ?? "project"),
      );
      setNotice(null);
    });
  }, [open]);

  const onDownloadZip = (): void => {
    const tree: Record<string, Uint8Array> = {};
    for (const file of files) {
      tree[file.path] = ENCODER.encode(file.content);
    }
    const zipped = zipSync(tree);
    const blob = new Blob([zipped as unknown as BlobPart], {
      type: "application/zip",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "infinite-canvas-markdown.zip";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(t("markdown.exportedNotice").replace("{count}", String(files.length)));
  };

  const onPickFiles = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const list = event.target.files;
    if (list === null) {
      return;
    }
    const readers: Promise<MarkdownInputFile>[] = [];
    for (const file of Array.from(list)) {
      readers.push(
        file.text().then((content) => ({ name: file.name, content })),
      );
    }
    void Promise.all(readers).then((loaded) => {
      setPicked(loaded);
      setNotice(null);
    });
  };

  const onImport = (): void => {
    if (picked.length === 0) {
      setNotice(t("markdown.emptyNotice"));
      return;
    }
    void Application.boot().then((context: AppContext) => {
      const scene = context.tryGet(Services.scene);
      const history = context.tryGet(Services.history);
      const ids = context.tryGet(Services.idGenerator);
      if (scene === undefined || history === undefined || ids === undefined) {
        return;
      }
      const imported = importMarkdownFiles(picked, () => ids.next());
      const commands = imported
        .map((entry) => entry.object)
        .filter(
          (draft) =>
            typeof draft.id === "string" &&
            draft.id !== "" &&
            draft.kind !== undefined,
        )
        .map((draft) => {
          const object = draft as unknown as import("@/core/model/SceneObject").SceneObjectData;
          return new AddObjectCommand(scene, object);
        })
        .filter((command): command is AddObjectCommand => command !== null);
      if (commands.length === 0) {
        setNotice(t("markdown.emptyNotice"));
        return;
      }
      const composite = new CompositeCommand("command.markdownImport", commands);
      composite.do();
      history.push(composite);
      setNotice(
          t("markdown.importedNotice").replace("{count}", String(commands.length)),
        );
      setPicked([]);
    });
  };

  const textFileCount = useMemo(
    () => files.filter((file) => file.path !== "index.md").length,
    [files],
  );

  if (!open) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4 text-primary" aria-hidden="true" />
            {t("markdown.title")}
          </DialogTitle>
        </DialogHeader>
        <div
          role="tablist"
          aria-label={t("markdown.title")}
          className="flex gap-1 rounded-lg bg-accent/40 p-1"
        >
          {(["export", "import"] as const).map((key) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={tab === key}
              onClick={() =>
                useUiStore.setState({ markdownDialogTab: key })
              }
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(
                key === "export"
                  ? "markdown.exportTitle"
                  : "markdown.importTitle",
              )}
            </button>
          ))}
        </div>

        {tab === "export" ? (
          <div className="space-y-3">
            <p className="text-[11px] leading-5 text-muted-foreground">
              {t("markdown.exportHint")}
            </p>
            <p className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-400">
              <AlertTriangle
                className="size-3.5 flex-none"
                aria-hidden="true"
              />
              {t("markdown.lossyNotice")}
            </p>
            <p className="text-xs font-medium text-foreground">
              {t("markdown.fileCount").replace("{count}", String(textFileCount))}
            </p>
            <ul className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border/60 bg-background/60 p-2 text-[11px] panel-scroll">
              {files.map((file) => (
                <li
                  key={file.path}
                  className="flex items-center gap-2 px-1 py-0.5"
                >
                  <FileText
                    className="size-3 flex-none text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="truncate" dir="ltr">
                    {file.path}
                  </span>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              onClick={onDownloadZip}
              className="w-full gap-2"
            >
              <Download className="size-4" aria-hidden="true" />
              {t("markdown.downloadZip")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] leading-5 text-muted-foreground">
              {t("markdown.importHint")}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,text/markdown"
              multiple
              onChange={onPickFiles}
              className="hidden"
              aria-label={t("markdown.pickFiles")}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4" aria-hidden="true" />
              {t("markdown.pickFiles")}
            </Button>
            {picked.length > 0 && (
              <p className="text-xs font-medium text-foreground">
                {t("markdown.fileCount").replace("{count}", String(picked.length))}
              </p>
            )}
            <Button
              type="button"
              onClick={onImport}
              disabled={picked.length === 0}
              className="w-full"
            >
              {t("markdown.importButton").replace("{count}", String(picked.length))}
            </Button>
          </div>
        )}

        {notice !== null && (
          <p
            role="status"
            className="rounded-lg bg-accent/50 px-3 py-2 text-[11px] leading-5 text-foreground"
          >
            {notice}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
