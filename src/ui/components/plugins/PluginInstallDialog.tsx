"use client";

/**
 * Plugin install + consent dialog (R9.4/R9.6): reads a package (zip
 * upload / desktop folder / the built-in sample), VALIDATES the
 * manifest, shows every requested permission in plain Persian, and
 * installs only on explicit consent (AC9.4: the exact permission list
 * precedes consent; a rejection aborts cleanly).
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Puzzle, ShieldQuestion, Upload } from "lucide-react";
import type { LifecycleManager } from "@/plugins/host/LifecycleManager";
import type { PluginPackage } from "@/plugins/host/LifecycleManager";
import {
  PERMISSION_DESCRIPTIONS,
  type PermissionId,
} from "@/plugins/host/PermissionEngine";
import {
  readPackageFromZipFile,
  readPackageFromFolder,
  readSamplePackage,
  readFirstPartyPackage,
  FIRSTPARTY_PLUGIN_IDS,
} from "@/plugins/host/readPackage";
import type { PluginManifest } from "@/plugins/manifest";
import { useTranslation } from "@/ui/i18n";
import { cn } from "@/lib/utils";

/** Shared dialog surface classes (the app's dialog conventions). */
const DIALOG_SURFACE =
  "fixed inset-0 z-50 grid place-items-center bg-black/50 p-4";
const DIALOG_CARD =
  "pointer-events-auto w-full max-w-md rounded-2xl border border-border/60 " +
  "bg-card/95 p-5 shadow-2xl shadow-black/40 backdrop-blur-md";
const BUTTON_PRIMARY =
  "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground " +
  "transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
const BUTTON_QUIET =
  "rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors " +
  "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring";

/**
 * @param props - the manager + close callback.
 * @returns the dialog element.
 */
export default function PluginInstallDialog(props: {
  readonly manager: LifecycleManager;
  readonly onClose: () => void;
  readonly onInstalled: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [pkg, setPkg] = useState<PluginPackage | null>(null);
  const [manifest, setManifest] = useState<PluginManifest | null>(null);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [folderPath, setFolderPath] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && pkg === null) {
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [props, pkg]);

  /** Applies one read outcome (manifest peek for the consent list). */
  const applyPackage = (outcome: PluginPackage | { error: string }): void => {
    if ("error" in outcome) {
      setErrors([outcome.error]);
      setPkg(null);
      setManifest(null);
      return;
    }
    setErrors([]);
    setPkg(outcome);
    const candidate = outcome.manifestJson as Partial<PluginManifest>;
    setManifest({
      id: String(candidate.id ?? "?"),
      name: String(candidate.name ?? "?"),
      version: String(candidate.version ?? "?"),
      sdkRange: String(candidate.sdkRange ?? "?"),
      permissions: Array.isArray(candidate.permissions)
        ? (candidate.permissions as PermissionId[])
        : [],
      dependencies: Array.isArray(candidate.dependencies)
        ? (candidate.dependencies as string[])
        : [],
      entry: String(candidate.entry ?? "entry.js"),
    });
  };

  /** Installs with the full consent (every manifest permission). */
  const install = async (): Promise<void> => {
    if (pkg === null || manifest === null) {
      return;
    }
    setBusy(true);
    const outcome = await props.manager.install(pkg, manifest.permissions);
    setBusy(false);
    if (!outcome.ok) {
      setErrors(outcome.errors);
      return;
    }
    props.onInstalled();
    props.onClose();
  };

  return (
    <div
      className={DIALOG_SURFACE}
      role="dialog"
      aria-modal="true"
      aria-label={t("plugins.install.title")}
    >
      <div className={DIALOG_CARD} dir="rtl">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Puzzle className="size-5 text-primary" aria-hidden="true" />
          {t("plugins.install.title")}
        </h2>

        {pkg === null ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs leading-6 text-muted-foreground">
              {t("plugins.install.hint")}
            </p>
            <div className="grid gap-2">
              <button
                type="button"
                className={cn(BUTTON_PRIMARY, "justify-start")}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="ms-2 inline size-4" aria-hidden="true" />
                {t("plugins.install.fromZip")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file === undefined) {
                    return;
                  }
                  void readPackageFromZipFile(file).then(applyPackage);
                }}
              />
              <button
                type="button"
                className={cn(BUTTON_PRIMARY, "justify-start")}
                onClick={() => {
                  setBusy(true);
                  void readSamplePackage().then((outcome) => {
                    setBusy(false);
                    applyPackage(outcome);
                  });
                }}
                disabled={busy}
              >
                <Puzzle className="ms-2 inline size-4" aria-hidden="true" />
                {t("plugins.install.sample")}
              </button>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={folderPath}
                  onChange={(event) => setFolderPath(event.target.value)}
                  placeholder={t("plugins.install.folderPlaceholder")}
                  dir="ltr"
                  className="w-full rounded-lg border border-border/60 bg-background/70 px-2.5 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  className={BUTTON_QUIET}
                  disabled={busy || folderPath.trim().length === 0}
                  onClick={() => {
                    setBusy(true);
                    void readPackageFromFolder(folderPath.trim()).then(
                      (outcome) => {
                        setBusy(false);
                        applyPackage(outcome);
                      },
                    );
                  }}
                >
                  {t("plugins.install.fromFolder")}
                </button>
              </div>
            </div>
            {/* R10.3–R10.6: the four bundled first-party plugins — REAL
                packages installed through the SAME consent flow. */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground">
                {t("plugins.install.firstPartyHeader")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {FIRSTPARTY_PLUGIN_IDS.map((pluginId) => (
                  <button
                    key={pluginId}
                    type="button"
                    disabled={busy}
                    className={cn(
                      BUTTON_QUIET,
                      "justify-start rounded-lg border border-border/50 bg-background/60 text-start",
                    )}
                    onClick={() => {
                      setBusy(true);
                      void readFirstPartyPackage(pluginId).then((outcome) => {
                        setBusy(false);
                        applyPackage(outcome);
                      });
                    }}
                  >
                    {t(`plugins.install.firstparty.${pluginId}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-border/50 bg-background/60 p-3">
              <p className="text-sm font-medium">
                {manifest?.name}{" "}
                <span className="text-xs text-muted-foreground" dir="ltr">
                  v{manifest?.version}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground" dir="ltr">
                {manifest?.id}
              </p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <ShieldQuestion
                  className="size-4 text-amber-400"
                  aria-hidden="true"
                />
                {t("plugins.install.permissionsTitle")}
              </p>
              {manifest !== null && manifest.permissions.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("plugins.install.noPermissions")}
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {manifest?.permissions.map((permission) => {
                    const description = PERMISSION_DESCRIPTIONS.find(
                      (candidate) => candidate.id === permission,
                    );
                    return (
                      <li
                        key={permission}
                        className="rounded-lg border border-border/50 bg-background/60 p-2.5"
                      >
                        <p className="text-xs font-medium">
                          {description?.title ?? permission}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                          {description?.detail ?? ""}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {errors.length > 0 ? (
          <ul className="mt-3 space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5">
            {errors.map((error) => (
              <li
                key={error}
                className="text-[11px] leading-5 text-destructive"
              >
                {error}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            className={BUTTON_QUIET}
            onClick={props.onClose}
          >
            {t("dialog.cancel")}
          </button>
          {pkg !== null ? (
            <button
              type="button"
              className={BUTTON_PRIMARY}
              disabled={busy}
              onClick={() => void install()}
            >
              {busy ? t("plugins.install.busy") : t("plugins.install.accept")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
