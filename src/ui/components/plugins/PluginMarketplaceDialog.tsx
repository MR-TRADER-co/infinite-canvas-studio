"use client";

/**
 * The plugin marketplace («فروشگاه افزونه‌ها») — the rich catalog dialog.
 *
 * One searchable, category-filtered surface for every bundled plugin
 * (the five first-party plugins + the official sample): live install
 * states (absent / running / stopped / error), the featured banner, and
 * installation through the SAME consent semantics as every other path
 * (the exact permission list precedes the accept; AC9.4 preserved).
 * Enable/disable toggles + the two-choice uninstall confirm operate on
 * the real LifecycleManager; the catalog refreshes live on
 * `plugins:changed`. Rendered through a PORTAL to document.body — the
 * dock panel's backdrop-blur creates a containing block that would
 * otherwise confine the wide catalog card to the narrow panel shell.
 * Fully RTL/Persian, keyboard accessible.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import {
  CircleCheck,
  CircleDot,
  CircleSlash,
  Loader2,
  Puzzle,
  Search,
  Sparkles,
  Store,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { LifecycleManager, PluginPackage } from "@/plugins/host/LifecycleManager";
import type { PermissionId } from "@/plugins/host/PermissionEngine";
import {
  PERMISSION_DESCRIPTIONS,
} from "@/plugins/host/PermissionEngine";
import {
  readFirstPartyPackage,
  readSamplePackage,
} from "@/plugins/host/readPackage";
import {
  CATEGORY_ORDER,
  CATALOG_SOURCES,
  entryFromManifest,
  filterEntries,
  mergeInstallStates,
  splitFeatured,
  type CatalogCategory,
  type CatalogEntry,
  type MarketCard,
  type StatusLike,
} from "@/plugins/host/pluginCatalog";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import type { PluginManifest } from "@/plugins/manifest";
import { formatInteger } from "@/ui/i18n/numbers";
import { useTranslation } from "@/ui/i18n";
import type { Language } from "@/ui/i18n";
import { cn } from "@/lib/utils";

/** Shared surface classes (the app dialog family conventions). */
const OVERLAY =
  "fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-[2px]";
const CARD =
  "pointer-events-auto flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden " +
  "rounded-2xl border border-border/60 bg-card/95 shadow-2xl shadow-black/40 backdrop-blur-md";
const BUTTON_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 " +
  "text-xs font-medium text-primary-foreground transition-all hover:bg-primary/90 " +
  "hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40";
const BUTTON_QUIET =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 " +
  "text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:pointer-events-none disabled:opacity-40";
const INPUT =
  "w-full rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-xs " +
  "text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 " +
  "focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring";
const CATEGORY_CHIP =
  "rounded-full border px-3 py-1 text-[11px] font-medium transition-all " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "border-border/60 bg-background/50 text-muted-foreground hover:border-border hover:text-foreground";
const CATEGORY_CHIP_ACTIVE =
  "border-primary/40 bg-primary/10 text-primary hover:border-primary/50 hover:text-primary";

/** One card's footer action area height (keeps rows aligned). */
const ICON_TILE =
  "grid size-11 shrink-0 place-items-center rounded-xl border border-border/40 " +
  "bg-background/70 transition-colors group-hover/card:border-border/70";

/** A no-op external-store subscription (the mounted check). */
function subscribeNoop(): () => void {
  return () => undefined;
}

/**
 * @param props - the manager + close callback.
 * @returns the marketplace dialog element.
 */
export default function PluginMarketplaceDialog(props: {
  readonly manager: LifecycleManager;
  readonly onClose: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<readonly CatalogEntry[] | null>(null);
  const [rows, setRows] = useState<readonly StatusLike[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CatalogCategory | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [consent, setConsent] = useState<{
    readonly entry: CatalogEntry;
    readonly pkg: PluginPackage;
    readonly manifest: PluginManifest;
  } | null>(null);
  const [consentErrors, setConsentErrors] = useState<readonly string[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // The portal needs document.body — this SSR-safe mounted check avoids
  // a setState-in-effect (true after hydration, false during SSR render).
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  /** Loads the catalog manifests (offline public assets, partial-tolerant).
   * Every setState lands in an async continuation — never synchronously
   * in an effect body (the react-hooks lint holds us to that). */
  const loadCatalog = useCallback(async (): Promise<void> => {
    const loaded = await Promise.all(
      CATALOG_SOURCES.map(async ({ id, source }) => {
        try {
          const base =
            source === "firstparty"
              ? `/plugins-firstparty/${id}`
              : `/plugins-sample/${id}`;
          const response = await fetch(`${base}/manifest.json`);
          if (!response.ok) {
            return null;
          }
          return entryFromManifest(id, await response.json(), source);
        } catch {
          return null;
        }
      }),
    );
    const found = loaded.filter(
      (entry): entry is CatalogEntry => entry !== null,
    );
    if (found.length === 0) {
      setPageError(t("plugins.market.loadError"));
      setEntries([]);
      return;
    }
    setEntries(found);
  }, [t]);

  /** Refreshes the live install states. */
  const refreshStates = useCallback((): void => {
    setRows(props.manager.listStatus() as readonly StatusLike[]);
  }, [props.manager]);

  // Boot: catalog + states + LIVE refresh on plugins:changed (deferred —
  // the manager mutates before emitting).
  useEffect(() => {
    queueMicrotask(() => void loadCatalog());
    queueMicrotask(refreshStates);
    const bus = AppContext.getDefault().tryGet(Services.eventBus);
    const unsubscribe = bus?.on("plugins:changed", () => {
      queueMicrotask(refreshStates);
    });
    return () => {
      unsubscribe?.();
    };
  }, [loadCatalog, refreshStates]);

  // Escape: cancels the consent/confirm step first, then closes.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      if (confirmId !== null) {
        setConfirmId(null);
        return;
      }
      if (consent !== null) {
        setConsent(null);
        setConsentErrors([]);
        return;
      }
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [props, consent, confirmId]);

  /** The filtered + merged cards. */
  const cards = useMemo<readonly MarketCard[]>(() => {
    if (entries === null) {
      return [];
    }
    return mergeInstallStates(
      filterEntries(entries, { query, category }),
      rows,
    );
  }, [entries, query, category, rows]);

  const { featured, rest } = useMemo(
    () => splitFeatured(cards),
    [cards],
  );

  /** Starts the install: fetch the package, then show the consent step. */
  const beginInstall = (entry: CatalogEntry): void => {
    if (busyId !== null) {
      return;
    }
    setBusyId(entry.id);
    setConsentErrors([]);
    void (entry.source === "firstparty"
      ? readFirstPartyPackage(entry.id)
      : readSamplePackage()
    ).then((outcome) => {
      setBusyId(null);
      if ("error" in outcome) {
        setConsentErrors([outcome.error]);
        setConsent(null);
        return;
      }
      const candidate = outcome.manifestJson as Partial<PluginManifest>;
      setConsent({
        entry,
        pkg: outcome,
        manifest: {
          id: String(candidate.id ?? entry.id),
          name: String(candidate.name ?? entry.name),
          version: String(candidate.version ?? entry.version),
          sdkRange: String(candidate.sdkRange ?? "?"),
          permissions: Array.isArray(candidate.permissions)
            ? (candidate.permissions as PermissionId[])
            : [],
          dependencies: Array.isArray(candidate.dependencies)
            ? (candidate.dependencies as string[])
            : [],
          entry: String(candidate.entry ?? "entry.js"),
        },
      });
    });
  };

  /** Installs with the full consent (every manifest permission). */
  const install = async (): Promise<void> => {
    if (consent === null) {
      return;
    }
    setBusyId(consent.entry.id);
    const outcome = await props.manager.install(
      consent.pkg,
      consent.manifest.permissions,
    );
    setBusyId(null);
    if (!outcome.ok) {
      setConsentErrors(outcome.errors);
      return;
    }
    setConsent(null);
    setConsentErrors([]);
    refreshStates();
  };

  /** The category chip list (all + the curated order). */
  const chips: readonly { id: CatalogCategory | "all"; label: string }[] = [
    { id: "all", label: t("plugins.market.category.all") },
    ...CATEGORY_ORDER.map((id) => ({
      id,
      label: t(`plugins.market.category.${id}`),
    })),
  ];

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      className={OVERLAY}
      role="dialog"
      aria-modal="true"
      aria-label={t("plugins.market.title")}
    >
      <div className={CARD} dir="rtl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border/50 px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="grid size-10 place-items-center rounded-xl bg-primary/12 text-primary"
              aria-hidden="true"
            >
              <Store className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold leading-6">
                {t("plugins.market.title")}
              </h2>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                {t("plugins.market.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={cn(BUTTON_QUIET, "size-8 p-0")}
            aria-label={t("plugins.market.close")}
            onClick={props.onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {consent !== null ? (
          /* ── The consent step (the exact permission list precedes
             acceptance — the install dialog's AC9.4 semantics). */
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
            <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/60 p-3">
              <img
                src={consent.entry.iconUrl}
                alt=""
                className="size-9 rounded-lg"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {consent.manifest.name}{" "}
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    v{consent.manifest.version}
                  </span>
                </p>
                <p className="truncate text-[11px] text-muted-foreground" dir="ltr">
                  {consent.manifest.id}
                </p>
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <TriangleAlert
                className="size-4 text-amber-400"
                aria-hidden="true"
              />
              {t("plugins.install.permissionsTitle")}
            </p>
            {consent.manifest.permissions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("plugins.install.noPermissions")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {consent.manifest.permissions.map((permission) => {
                  const description =
                    PERMISSION_DESCRIPTIONS.find(
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
            {consentErrors.length > 0 ? (
              <ul className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5">
                {consentErrors.map((error) => (
                  <li
                    key={error}
                    className="text-[11px] leading-5 text-destructive"
                  >
                    {error}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-auto flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                className={BUTTON_QUIET}
                disabled={busyId !== null}
                onClick={() => {
                  setConsent(null);
                  setConsentErrors([]);
                }}
              >
                {t("dialog.cancel")}
              </button>
              <button
                type="button"
                className={BUTTON_PRIMARY}
                disabled={busyId !== null}
                onClick={() => void install()}
              >
                {busyId !== null ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                {busyId !== null
                  ? t("plugins.install.busy")
                  : t("plugins.install.accept")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Toolbar: search + category chips */}
            <div className="space-y-2.5 border-b border-border/50 px-5 py-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
                  aria-hidden="true"
                />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("plugins.market.search")}
                  aria-label={t("plugins.market.search")}
                  className={cn(INPUT, "pe-8")}
                />
              </div>
              <div className="flex flex-wrap gap-1.5" role="tablist">
                {chips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    role="tab"
                    aria-selected={category === chip.id}
                    className={cn(
                      CATEGORY_CHIP,
                      category === chip.id && CATEGORY_CHIP_ACTIVE,
                    )}
                    onClick={() => setCategory(chip.id)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Content */}
            <div className="panel-scroll min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
              {pageError !== null ? (
                <div className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/[0.06] p-4 text-center">
                  <p className="text-xs leading-5 text-destructive">
                    {pageError}
                  </p>
                  <button
                    type="button"
                    className={BUTTON_PRIMARY}
                    onClick={() => {
                      setEntries(null);
                      setPageError(null);
                      void loadCatalog();
                    }}
                  >
                    {t("plugins.market.retry")}
                  </button>
                </div>
              ) : null}

              {entries === null
                ? [0, 1, 2].map((index) => (
                    <div
                      key={index}
                      className="h-28 animate-pulse rounded-xl border border-border/40 bg-muted/30"
                    />
                  ))
                : null}

              {entries !== null && pageError === null ? (
                <>
                  {featured !== null ? (
                    <FeaturedCard
                      card={featured}
                      busy={busyId === featured.id}
                      onInstall={() => beginInstall(featured)}
                      onToggle={() => toggleCard(props.manager, featured)}
                    />
                  ) : null}

                  {rest.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {rest.map((card) => (
                        <MarketCardView
                          key={card.id}
                          card={card}
                          busy={busyId === card.id}
                          confirm={confirmId === card.id}
                          onInstall={() => beginInstall(card)}
                          onToggle={() => toggleCard(props.manager, card)}
                          onUninstallRequest={() => setConfirmId(card.id)}
                          onUninstallCancel={() => setConfirmId(null)}
                          onUninstall={(archive) => {
                            props.manager.uninstall(card.id, archive);
                            setConfirmId(null);
                            refreshStates();
                          }}
                        />
                      ))}
                    </div>
                  ) : null}

                  {cards.length === 0 ? (
                    <div className="space-y-2 rounded-xl border border-dashed border-border/60 bg-background/40 p-8 text-center">
                      <Puzzle
                        className="mx-auto size-7 text-muted-foreground/50"
                        aria-hidden="true"
                      />
                      <p className="text-xs font-medium text-foreground/80">
                        {t("plugins.market.empty.title")}
                      </p>
                      <p className="text-[11px] leading-5 text-muted-foreground">
                        {t("plugins.market.empty.hint")}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Toggles one installed card through the manager (the live refresh
 * rides on plugins:changed). */
function toggleCard(
  manager: LifecycleManager,
  card: MarketCard,
): void {
  if (card.installState === "running") {
    manager.disable(card.id);
  } else if (card.installState === "stopped" || card.installState === "error") {
    void manager.enable(card.id);
  }
  // absent cards install through the consent step instead.
}

/** The featured banner card (the editor's pick). */
function FeaturedCard(props: {
  readonly card: MarketCard;
  readonly busy: boolean;
  readonly onInstall: () => void;
  readonly onToggle: () => void;
}): ReactElement {
  const { t, language } = useTranslation();
  const { card } = props;
  return (
    <div
      className={cn(
        "group/card relative overflow-hidden rounded-xl border border-primary/25",
        "bg-gradient-to-bl from-primary/[0.10] via-background/70 to-background/40 p-4",
        "transition-[border-color,box-shadow] duration-200 hover:border-primary/40 hover:shadow-md",
      )}
    >
      <span
        className="absolute end-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[9px] font-semibold text-primary"
        dir="rtl"
      >
        <Sparkles className="size-2.5" aria-hidden="true" />
        {t("plugins.market.featured")}
      </span>
      <div className="flex items-start gap-3.5">
        <span className={cn(ICON_TILE, "size-12")}>
          <img src={card.iconUrl} alt="" className="size-7" />
        </span>
        <div className="min-w-0 flex-1 pe-16">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {card.name}
            <span
              className="text-[10px] font-normal text-muted-foreground"
              dir="ltr"
            >
              v{card.version}
            </span>
          </p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
            {card.description}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            {card.installState === "absent" ? (
              <button
                type="button"
                className={BUTTON_PRIMARY}
                disabled={props.busy}
                onClick={props.onInstall}
              >
                {props.busy ? (
                  <Loader2
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {t("plugins.market.install")}
              </button>
            ) : (
              <InstalledControls
                card={card}
                onToggle={props.onToggle}
                compact={false}
              />
            )}
            <PermissionDots permissions={card.permissions} language={language} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** One grid card. */
function MarketCardView(props: {
  readonly card: MarketCard;
  readonly busy: boolean;
  readonly confirm: boolean;
  readonly onInstall: () => void;
  readonly onToggle: () => void;
  readonly onUninstallRequest: () => void;
  readonly onUninstallCancel: () => void;
  readonly onUninstall: (archive: boolean) => void;
}): ReactElement {
  const { t, language } = useTranslation();
  const { card } = props;
  return (
    <div
      className={cn(
        "group/card flex flex-col rounded-xl border border-border/50 bg-background/60 p-3.5",
        "transition-[border-color,box-shadow,transform] duration-200",
        "hover:border-border/80 hover:shadow-sm hover:-translate-y-px",
        card.installState === "running" &&
          "border-primary/25 bg-primary/[0.03]",
        card.installState === "error" &&
          "border-destructive/40 bg-destructive/[0.04]",
      )}
    >
      <div className="flex items-start gap-3">
        <span className={ICON_TILE}>
          <img src={card.iconUrl} alt="" className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground/90">
            {card.name}
          </p>
          <p
            className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground"
            dir="ltr"
          >
            <span className="truncate">{card.id}</span>
            <span aria-hidden="true">·</span>
            <span>v{card.version}</span>
          </p>
        </div>
      </div>

      <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-[11px] leading-5 text-muted-foreground">
        {card.description}
      </p>

      <div className="mt-2.5 flex items-end justify-between gap-2">
        <PermissionDots permissions={card.permissions} language={language} />
        {card.installState === "absent" ? (
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={props.busy}
            onClick={props.onInstall}
          >
            {props.busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            {t("plugins.market.install")}
          </button>
        ) : (
          <div className="flex items-center gap-1">
            {props.confirm ? (
              <>
                <button
                  type="button"
                  className={cn(
                    BUTTON_QUIET,
                    "text-[10px] hover:text-destructive",
                  )}
                  onClick={() => props.onUninstall(true)}
                >
                  {t("plugins.manager.uninstallArchive")}
                </button>
                <button
                  type="button"
                  className={cn(
                    BUTTON_QUIET,
                    "text-[10px] hover:text-destructive",
                  )}
                  onClick={() => props.onUninstall(false)}
                >
                  {t("plugins.manager.uninstallNoArchive")}
                </button>
                <button
                  type="button"
                  className={cn(BUTTON_QUIET, "size-7 p-0")}
                  aria-label={t("dialog.cancel")}
                  onClick={props.onUninstallCancel}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={cn(
                    BUTTON_QUIET,
                    "size-7 p-0 hover:text-destructive",
                    "opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100",
                    "focus-visible:opacity-100",
                  )}
                  title={t("plugins.manager.uninstall")}
                  aria-label={t("plugins.manager.uninstall")}
                  onClick={props.onUninstallRequest}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
                <InstalledControls card={card} onToggle={props.onToggle} compact />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The running/stopped state pill + the enable/disable toggle. */
function InstalledControls(props: {
  readonly card: MarketCard;
  readonly onToggle: () => void;
  readonly compact: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { card } = props;
  const running = card.installState === "running";
  const errored = card.installState === "error";
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
          running
            ? "bg-primary/12 text-primary"
            : errored
              ? "bg-destructive/12 text-destructive"
              : "bg-muted/70 text-muted-foreground",
        )}
        dir="rtl"
      >
        {running ? (
          <CircleCheck className="size-3" aria-hidden="true" />
        ) : errored ? (
          <CircleSlash className="size-3" aria-hidden="true" />
        ) : (
          <CircleDot className="size-3" aria-hidden="true" />
        )}
        {errored
          ? t("plugins.market.errorState")
          : running
            ? t("plugins.manager.running")
            : t("plugins.manager.stopped")}
      </span>
      <button
        type="button"
        className={props.compact ? cn(BUTTON_QUIET, "text-[10px]") : BUTTON_QUIET}
        onClick={props.onToggle}
      >
        {running
          ? t("plugins.market.disable")
          : t("plugins.market.activate")}
      </button>
    </div>
  );
}

/** The compact permission summary (dots + count, tooltip = the list). */
function PermissionDots(props: {
  readonly permissions: readonly string[];
  readonly language: Language;
}): ReactElement {
  const { t } = useTranslation();
  if (props.permissions.length === 0) {
    return (
      <span className="text-[10px] text-muted-foreground/70">
        {t("plugins.market.noPermissions")}
      </span>
    );
  }
  const titles = props.permissions
    .map(
      (permission) =>
        PERMISSION_DESCRIPTIONS.find(
          (candidate) => candidate.id === permission,
        )?.title ?? permission,
    )
    .join(" · ");
  const countLabel = t("plugins.market.permissionsCount").replace(
    "{n}",
    formatInteger(props.permissions.length, props.language),
  );
  return (
    <span
      className="inline-flex items-center gap-1"
      title={titles}
      aria-label={countLabel}
    >
      {props.permissions.slice(0, 3).map((permission) => (
        <span
          key={permission}
          className="size-1.5 rounded-full bg-primary/45"
          aria-hidden="true"
        />
      ))}
      {props.permissions.length > 3 ? (
        <span className="size-1.5 rounded-full bg-muted-foreground/30" aria-hidden="true" />
      ) : null}
      <span className="ms-0.5 text-[10px] text-muted-foreground/80">
        {countLabel}
      </span>
    </span>
  );
}
