"use client";

/**
 * Plugin Manager panel body (R9.6): the registered «افزونه‌ها» dock
 * panel. Lists installed plugins (icon, name, version, permission
 * chips, enabled toggle, error states), installs (zip / sample /
 * desktop folder), uninstalls WITH archive confirmation, and restores
 * archives. The header's store button + the empty-state CTA open the
 * plugin marketplace («فروشگاه افزونه‌ها»). Fully RTL/Persian.
 */
import { useEffect, useState, type ReactElement } from "react";
import {
  Archive,
  ArchiveRestore,
  CircleCheck,
  CircleDot,
  Puzzle,
  Store,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type {
  LifecycleManager,
  PluginStatusRow,
} from "@/plugins/host/LifecycleManager";
import type { PluginArchive } from "@/plugins/host/PluginStore";
import { PERMISSION_DESCRIPTIONS } from "@/plugins/host/PermissionEngine";
import PluginInstallDialog from "@/ui/components/plugins/PluginInstallDialog";
import PluginMarketplaceDialog from "@/ui/components/plugins/PluginMarketplaceDialog";
import { useTranslation } from "@/ui/i18n";
import { cn } from "@/lib/utils";

/** Shared row action classes. */
const ACTION_BUTTON =
  "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors " +
  "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

/** The header's store button (opens the marketplace). */
const STORE_BUTTON =
  "inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 " +
  "text-[11px] font-medium text-primary transition-all hover:border-primary/50 " +
  "hover:bg-primary/15 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring active:scale-[0.98]";

/** The panel body. */
export default function PluginManagerPanelBody(): ReactElement {
  const { t } = useTranslation();
  const [rows, setRows] = useState<readonly PluginStatusRow[]>([]);
  const [archives, setArchives] = useState<readonly PluginArchive[]>([]);
  const [installOpen, setInstallOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = (): void => {
    const manager = AppContext.getDefault().tryGet(Services.pluginManager);
    if (manager === undefined) {
      return;
    }
    setRows(manager.listStatus());
    setArchives(manager.pluginStore.listArchives());
  };

  // Boot + live refresh on plugins:changed.
  useEffect(() => {
    let cancelled = false;
    void Application.boot().then(() => {
      if (cancelled) {
        return;
      }
      refresh();
      const bus = AppContext.getDefault().tryGet(Services.eventBus);
      const unsubscribe = bus?.on("plugins:changed", () => {
        // Defer a microtask: the manager mutates before emitting.
        queueMicrotask(refresh);
      });
      return () => {
        unsubscribe?.();
      };
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Resolves the manager (null before boot). */
  const managerOf = (): LifecycleManager | undefined =>
    AppContext.getDefault().tryGet(Services.pluginManager);

  return (
    <div className="flex flex-col gap-2 p-2.5">
      <div className="flex items-center justify-between gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t("plugins.manager.header")}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={ACTION_BUTTON}
            title={t("plugins.install.title")}
            aria-label={t("plugins.install.title")}
            onClick={() => setInstallOpen(true)}
          >
            <Upload className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={STORE_BUTTON}
            title={t("plugins.market.title")}
            aria-label={t("plugins.market.title")}
            onClick={() => setMarketOpen(true)}
          >
            <Store className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">
              {t("plugins.market.title")}
            </span>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain">
        {rows.length === 0 ? (
          <div className="space-y-2.5 rounded-xl border border-dashed border-border/60 bg-background/40 px-3 py-5 text-center">
            <Store
              className="mx-auto size-6 text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="text-[11px] text-muted-foreground/80">
              {t("plugins.manager.empty")}
            </p>
            <button
              type="button"
              className={cn(STORE_BUTTON, "mx-auto")}
              onClick={() => setMarketOpen(true)}
            >
              <Store className="size-3.5" aria-hidden="true" />
              {t("plugins.market.openStore")}
            </button>
          </div>
        ) : null}
        {rows.map((row) => {
          const running = row.runtimeState === "running";
          return (
          <div
            key={row.record.manifest.id}
            className={cn(
              "group rounded-xl border border-border/50 bg-background/60 p-2.5",
              "transition-[border-color,box-shadow] duration-200 hover:border-border/80 hover:shadow-sm",
              running && "border-primary/25 bg-primary/[0.03]",
              row.runtimeState === "error" &&
                "border-destructive/40 bg-destructive/[0.04]",
              row.runtimeState !== "running" &&
                row.runtimeState !== "error" &&
                "opacity-75",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate text-xs font-medium text-foreground/90">
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center justify-center size-5 rounded-md",
                      running
                        ? "bg-primary/15 text-primary"
                        : "bg-muted/60 text-muted-foreground",
                    )}
                    aria-hidden="true"
                  >
                    {row.record.iconDataUrl !== undefined ? (
                      <img
                        src={row.record.iconDataUrl}
                        alt=""
                        className="size-3.5"
                      />
                    ) : (
                      <Puzzle className="size-3.5" />
                    )}
                  </span>
                  <span className="truncate">{row.record.manifest.name}</span>
                </p>
                <p
                  className="mt-1 flex items-center gap-1.5 truncate text-[10px] text-muted-foreground"
                  dir="ltr"
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-1.5 py-px font-medium",
                      running
                        ? "bg-primary/12 text-primary"
                        : row.runtimeState === "error"
                          ? "bg-destructive/12 text-destructive"
                          : "bg-muted/60 text-muted-foreground",
                    )}
                    dir="rtl"
                  >
                    {running ? (
                      <CircleCheck className="size-2.5" aria-hidden="true" />
                    ) : (
                      <CircleDot className="size-2.5" aria-hidden="true" />
                    )}
                    {running
                      ? t("plugins.manager.running")
                      : t("plugins.manager.stopped")}
                  </span>
                  <span className="truncate">
                    {row.record.manifest.id} · v{row.record.manifest.version}
                  </span>
                </p>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
                <span className="sr-only">{t("plugins.manager.enabled")}</span>
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={running}
                  onChange={(event) => {
                    const manager = managerOf();
                    if (manager === undefined) {
                      return;
                    }
                    if (event.target.checked) {
                      void manager.enable(row.record.manifest.id);
                    } else {
                      manager.disable(row.record.manifest.id);
                    }
                  }}
                />
              </label>
            </div>

            {row.record.grantedPermissions.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {row.record.grantedPermissions.map((permission) => {
                  const description = PERMISSION_DESCRIPTIONS.find(
                    (candidate) => candidate.id === permission,
                  );
                  return (
                    <span
                      key={permission}
                      className={cn(
                        "rounded-full border px-1.5 py-px text-[9px] transition-colors",
                        "border-border/60 bg-muted/30 text-muted-foreground",
                        "group-hover:border-border/80",
                      )}
                      title={description?.detail ?? ""}
                    >
                      {description?.title ?? permission}
                    </span>
                  );
                })}
              </div>
            ) : null}

            {row.runtimeError !== null ? (
              <p className="mt-1.5 flex items-start gap-1 rounded-md bg-destructive/10 px-2 py-1.5 text-[10px] leading-4 text-destructive">
                <TriangleAlert
                  className="mt-px size-3 shrink-0"
                  aria-hidden="true"
                />
                {row.runtimeError}
              </p>
            ) : null}

            <div
              className={cn(
                "mt-1.5 flex justify-end transition-opacity duration-200",
                "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
                "focus-within:opacity-100",
              )}
            >
              <button
                type="button"
                className={cn(ACTION_BUTTON, "hover:text-destructive")}
                title={t("plugins.manager.uninstall")}
                aria-label={t("plugins.manager.uninstall")}
                onClick={() => setConfirmId(row.record.manifest.id)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
          );
        })}

        {archives.length > 0 ? (
          <div className="pt-1">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {t("plugins.manager.archives")}
            </p>
            {archives.map((archive) => (
              <div
                key={archive.archiveId}
                className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-border/50 bg-background/40 p-2"
              >
                <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  <Archive
                    className="me-1 inline size-3 align-[-2px]"
                    aria-hidden="true"
                  />
                  {archive.record.manifest.name}
                </p>
                <button
                  type="button"
                  className={ACTION_BUTTON}
                  title={t("plugins.manager.restore")}
                  aria-label={t("plugins.manager.restore")}
                  onClick={() => {
                    const manager = managerOf();
                    if (manager === undefined) {
                      return;
                    }
                    void manager
                      .restore(archive.record.manifest.id)
                      .then(() => {
                        refresh();
                      });
                  }}
                >
                  <ArchiveRestore className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {installOpen ? (
        <PluginInstallDialog
          manager={managerOf() as LifecycleManager}
          onClose={() => setInstallOpen(false)}
          onInstalled={() => refresh()}
        />
      ) : null}

      {marketOpen ? (
        <PluginMarketplaceDialog
          manager={managerOf() as LifecycleManager}
          onClose={() => setMarketOpen(false)}
        />
      ) : null}

      {confirmId !== null ? (
        <UninstallConfirm
          name={
            rows.find((row) => row.record.manifest.id === confirmId)?.record
              .manifest.name ?? confirmId
          }
          onCancel={() => setConfirmId(null)}
          onConfirm={(archive) => {
            const manager = managerOf();
            if (manager !== undefined) {
              manager.uninstall(confirmId, archive);
            }
            setConfirmId(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** The uninstall confirmation (archive choice, AC9.7). */
function UninstallConfirm(props: {
  readonly name: string;
  readonly onCancel: () => void;
  readonly onConfirm: (archive: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("plugins.manager.uninstall")}
    >
      <div
        className="pointer-events-auto w-full max-w-sm rounded-2xl border border-border/60 bg-card/95 p-5 shadow-2xl shadow-black/40 backdrop-blur-md"
        dir="rtl"
      >
        <p className="text-sm leading-6">
          {t("plugins.manager.uninstallConfirm1")}
          <span className="font-semibold">{props.name}</span>
          {t("plugins.manager.uninstallConfirm2")}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={props.onCancel}
          >
            {t("dialog.cancel")}
          </button>
          <button
            type="button"
            className="rounded-lg border border-destructive/50 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
            onClick={() => props.onConfirm(true)}
          >
            {t("plugins.manager.uninstallArchive")}
          </button>
          <button
            type="button"
            className="rounded-lg border border-destructive/50 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
            onClick={() => props.onConfirm(false)}
          >
            {t("plugins.manager.uninstallNoArchive")}
          </button>
        </div>
      </div>
    </div>
  );
}
