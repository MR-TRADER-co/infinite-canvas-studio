"use client";

/**
 * History panel body (R8.5): lists the current project's version
 * snapshots (one per manual save). Preview restores a snapshot
 * READ-ONLY; Restore re-applies it and hands the user the save-as flow
 * («بازگردانی و ذخیره با نام…»); snapshots can be deleted. Timestamps
 * render in the Jalali calendar when Persian digits are on (R8.3
 * synergy).
 */
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Eye, History, RotateCcw, Trash2 } from "lucide-react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type { VersionSnapshot } from "@/core/history/VersionHistoryService";
import type { ProjectData } from "@/persistence/ProjectFile";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import { dateToJalali, formatJalaliLong } from "@/core/utils/jalali";
import { cn } from "@/lib/utils";

/** Shared classes of the compact row action buttons. */
const ACTION_BUTTON =
  "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors " +
  "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

/**
 * @returns the history panel body mounted inside the right dock.
 */
export default function HistoryPanelBody(): ReactElement {
  const { t, language } = useTranslation();
  const persianDigits = useUiStore((state) => state.persianDigits);
  const [snapshots, setSnapshots] = useState<readonly VersionSnapshot[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locale = { language, persianDigits };

  /** Loads the snapshot list for the current document path. */
  const refresh = (): void => {
    const history = AppContext.getDefault().tryGet(Services.versionHistory);
    const document = AppContext.getDefault().tryGet(Services.document);
    if (history === undefined) {
      return;
    }
    const currentPath = document?.getPath() ?? null;
    setPath(currentPath);
    const load =
      currentPath === null ? history.listAll(20) : history.list(currentPath);
    void load.then((rows) => {
      setSnapshots(rows);
    });
  };

  // Boot + live refresh: document switches + new snapshots both reload.
  useEffect(() => {
    let cancelled = false;
    const install = (): void => {
      if (cancelled) {
        return;
      }
      const bus = AppContext.getDefault().tryGet(Services.eventBus);
      bus?.on("project:restored", refresh);
      bus?.on("version-history:changed", refresh);
      bus?.on("project:file-saved", refresh);
      refresh();
    };
    void Application.boot().then(() => {
      if (!cancelled) {
        install();
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Applies one snapshot (read-only preview or editable restore). */
  const applySnapshot = (
    snapshot: VersionSnapshot,
    readOnly: boolean,
  ): void => {
    if (busy) {
      return;
    }
    setBusy(true);
    const bus = AppContext.getDefault().tryGet(Services.eventBus);
    const serializer = AppContext.getDefault().tryGet(Services.serializer);
    if (bus === undefined || serializer === undefined) {
      setBusy(false);
      return;
    }
    const outcome = serializer.deserialize(snapshot.json);
    setBusy(false);
    if (outcome.status !== "ok" && outcome.status !== "future") {
      bus.emit("ui:notice", {
        messageKey: "file.futureVersion",
        severity: "error",
        values: { version: snapshot.id.toString() },
      });
      return;
    }
    const data = outcome.data as ProjectData;
    bus.emit("ui:notice", {
      messageKey: "history.restoredToast",
      severity: "info",
    });
    // Read-only preview: apply + mark read-only; restore: apply editable
    // and immediately start the save-as flow (a NEW file, the original
    // on disk is untouched — R8.5).
    restoreSnapshot(data, readOnly);
    if (!readOnly) {
      bus.emit("ui:save-project-requested", { as: true });
    }
  };

  /** Deletes one snapshot (best-effort; the list refreshes). */
  const removeSnapshot = (snapshot: VersionSnapshot): void => {
    const history = AppContext.getDefault().tryGet(Services.versionHistory);
    if (history === undefined) {
      return;
    }
    void history.remove(snapshot.id).then(() => {
      refresh();
    });
  };

  const row = (snapshot: VersionSnapshot): ReactNode => {
    const stamp =
      language === "fa" || persianDigits
        ? formatJalaliLong(dateToJalali(new Date(snapshot.ts)))
        : new Intl.DateTimeFormat("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(snapshot.ts));
    const sizeKb = Math.max(1, Math.round(snapshot.json.length / 1024));
    return (
      <li
        key={snapshot.id}
        className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-2 py-1.5"
      >
        <History
          className="size-4 flex-none text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-xs font-medium" title={stamp}>
            {stamp}
          </p>
          <p className="text-[0.6875rem] text-muted-foreground">
            {t("history.snapshotSize").replace(
              "{size}",
              formatInteger(sizeKb, locale),
            )}
          </p>
        </div>
        <button
          type="button"
          className={ACTION_BUTTON}
          aria-label={t("history.preview")}
          title={t("history.preview")}
          onClick={() => applySnapshot(snapshot, true)}
        >
          <Eye className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={ACTION_BUTTON}
          aria-label={t("history.restore")}
          title={t("history.restore")}
          onClick={() => applySnapshot(snapshot, false)}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={cn(ACTION_BUTTON, "hover:text-red-500")}
          aria-label={t("history.remove")}
          title={t("history.remove")}
          onClick={() => removeSnapshot(snapshot)}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-2 px-2 py-2 text-xs">
      <p className="text-muted-foreground">{t("history.hint")}</p>
      {path === null ? (
        <p className="rounded-md border border-border/50 bg-muted/20 px-2 py-1.5 text-[0.6875rem] text-muted-foreground">
          {t("history.emptyPath")}
        </p>
      ) : null}
      {snapshots.length === 0 ? (
        <p className="px-1 text-muted-foreground">{t("history.empty")}</p>
      ) : (
        <ul className="space-y-1.5">{snapshots.map(row)}</ul>
      )}
    </div>
  );
}

/**
 * Restores project data through the app's import pipeline (the panel
 * never touches the scene directly — CLAUDE.md §1.2). The readOnly flag
 * travels on the import event (R8.5: previews are read-only).
 *
 * @param data - the snapshot's project data.
 * @param readOnly - whether the restore lands read-only (preview).
 */
function restoreSnapshot(data: ProjectData, readOnly: boolean): void {
  const bus = AppContext.getDefault().tryGet(Services.eventBus);
  const serializer = AppContext.getDefault().tryGet(Services.serializer);
  if (bus === undefined || serializer === undefined) {
    return;
  }
  const raw = serializer.serialize(data);
  bus.emit("project:import-requested", { raw, readOnly });
}
