"use client";

/**
 * The core settings sections (R8.2): every control reads and writes LIVE
 * state (the UI store slices) — each change takes effect immediately and
 * the persistence subscriber stores it in app data. There is no Apply
 * button anywhere in the dialog.
 *
 * Sections register through `registerCoreSettingsSections` (the dialog
 * composes FROM the registry — AC8.3).
 */
import type { ReactElement } from "react";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/ui/i18n";
import {
  AUTOSAVE_INTERVAL_MAX_SEC,
  AUTOSAVE_INTERVAL_MIN_SEC,
  FONT_FAMILY_OPTIONS,
  SNAP_SPACING_PRESETS,
  useUiStore,
} from "@/ui/store/uiStore";
import { formatInteger } from "@/ui/i18n/numbers";
import type { ThemeMode } from "@/ui/store/uiStore";
import { cn } from "@/lib/utils";

/** Shared row layout: label block (start) + control (end). */
export function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        {hint !== undefined ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      <div className="flex flex-none items-center gap-2">{children}</div>
    </div>
  );
}

/** Shared section header. */
export function SectionHeader({ title }: { title: string }): ReactElement {
  return (
    <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
    </p>
  );
}

/** Segmented control (one of a small set of options). */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}): ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex gap-1 rounded-lg border border-border/60 p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 rounded-md px-2.5 text-xs font-medium tabular-nums transition-colors",
              active
                ? "bg-primary/15 text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** General section: UI language + the two digit behaviours (R8.2). */
export function GeneralSettingsSection(): ReactElement {
  const { t, language, setLanguage } = useTranslation();
  const persianDigits = useUiStore((state) => state.persianDigits);
  const setPersianDigits = useUiStore((state) => state.setPersianDigits);
  const convertTypedDigits = useUiStore((state) => state.convertTypedDigits);
  const setConvertTypedDigits = useUiStore(
    (state) => state.setConvertTypedDigits,
  );
  return (
    <div>
      <SectionHeader title={t("settings.section.general")} />
      <Row title={t("settings.language")} hint={t("settings.languageHint")}>
        <Segmented
          ariaLabel={t("settings.language")}
          value={language}
          onChange={(value) => setLanguage(value)}
          options={[
            { value: "fa" as const, label: t("lang.fa") },
            { value: "en" as const, label: t("lang.en") },
          ]}
        />
      </Row>
      <Row
        title={t("settings.persianDigits")}
        hint={t("settings.persianDigitsHint")}
      >
        <Switch
          checked={persianDigits}
          onCheckedChange={setPersianDigits}
          aria-label={t("settings.persianDigits")}
        />
      </Row>
      <Row
        title={t("settings.convertTypedDigits")}
        hint={t("settings.convertTypedDigitsHint")}
      >
        <Switch
          checked={convertTypedDigits}
          onCheckedChange={setConvertTypedDigits}
          aria-label={t("settings.convertTypedDigits")}
        />
      </Row>
    </div>
  );
}

/** Appearance section: the theme (R8.1). */
export function AppearanceSettingsSection(): ReactElement {
  const { t } = useTranslation();
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  return (
    <div>
      <SectionHeader title={t("settings.section.appearance")} />
      <Row title={t("settings.theme")} hint={t("settings.themeHint")}>
        <Segmented
          ariaLabel={t("settings.theme")}
          value={theme}
          onChange={(value: ThemeMode) => setTheme(value)}
          options={[
            { value: "dark" as const, label: t("settings.themeDark") },
            { value: "light" as const, label: t("settings.themeLight") },
          ]}
        />
      </Row>
    </div>
  );
}

/** Text section: the defaults NEW text objects use (R8.2). */
export function TextSettingsSection(): ReactElement {
  const { t, language } = useTranslation();
  const fontSize = useUiStore((state) => state.fontSize);
  const setFontSize = useUiStore((state) => state.setFontSize);
  const defaultFontFamily = useUiStore((state) => state.defaultFontFamily);
  const setDefaultFontFamily = useUiStore(
    (state) => state.setDefaultFontFamily,
  );
  const locale = {
    language,
    persianDigits: useUiStore((state) => state.persianDigits),
  };
  return (
    <div>
      <SectionHeader title={t("settings.section.text")} />
      <Row
        title={t("settings.defaultFontFamily")}
        hint={t("settings.defaultFontFamilyHint")}
      >
        <select
          aria-label={t("settings.defaultFontFamily")}
          value={defaultFontFamily}
          onChange={(event) => setDefaultFontFamily(event.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          {FONT_FAMILY_OPTIONS.map((family) => (
            <option key={family} value={family}>
              {family}
            </option>
          ))}
        </select>
      </Row>
      <Row
        title={t("settings.defaultFontSize")}
        hint={t("settings.defaultFontSizeHint")}
      >
        <Segmented
          ariaLabel={t("settings.defaultFontSize")}
          value={fontSize}
          onChange={(value) => setFontSize(value)}
          options={[14, 18, 20, 24, 32].map((size) => ({
            value: size,
            label: formatInteger(size, locale),
          }))}
        />
      </Row>
    </div>
  );
}

/** Canvas section: grid + snap defaults (R8.2). */
export function CanvasSettingsSection(): ReactElement {
  const { t, language } = useTranslation();
  const gridSpacing = useUiStore((state) => state.gridSpacing);
  const setGridSpacing = useUiStore((state) => state.setGridSpacing);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const toggleSnap = useUiStore((state) => state.toggleSnap);
  const snapSpacing = useUiStore((state) => state.snapSpacing);
  const setSnapSpacing = useUiStore((state) => state.setSnapSpacing);
  const locale = {
    language,
    persianDigits: useUiStore((state) => state.persianDigits),
  };
  return (
    <div>
      <SectionHeader title={t("settings.section.canvas")} />
      <Row
        title={t("settings.gridSpacing")}
        hint={t("settings.gridSpacingHint")}
      >
        <Segmented
          ariaLabel={t("settings.gridSpacing")}
          value={gridSpacing}
          onChange={(value) => setGridSpacing(value)}
          options={[10, 20, 40, 80].map((spacing) => ({
            value: spacing,
            label: formatInteger(spacing, locale),
          }))}
        />
      </Row>
      <Row title={t("settings.snapToGrid")} hint={t("settings.snapOnHint")}>
        <Switch
          checked={snapEnabled}
          onCheckedChange={() => toggleSnap()}
          aria-label={t("settings.snapToGrid")}
        />
      </Row>
      <Row
        title={t("settings.snapSpacing")}
        hint={t("settings.snapSpacingHint")}
      >
        <Segmented
          ariaLabel={t("settings.snapSpacing")}
          value={snapSpacing}
          onChange={(value) => setSnapSpacing(value)}
          options={SNAP_SPACING_PRESETS.map((preset) => ({
            value: preset,
            label: formatInteger(preset, locale),
          }))}
        />
      </Row>
    </div>
  );
}

/** Storage section: the autosave interval (R8.2, 10 s–5 min). */
export function StorageSettingsSection(): ReactElement {
  const { t, language } = useTranslation();
  const mirrorEnabled = useUiStore((state) => state.mirrorFolderEnabled);
  const autosaveIntervalSec = useUiStore((state) => state.autosaveIntervalSec);
  const setAutosaveIntervalSec = useUiStore(
    (state) => state.setAutosaveIntervalSec,
  );
  const locale = {
    language,
    persianDigits: useUiStore((state) => state.persianDigits),
  };
  const minute = (seconds: number): string =>
    seconds < 60
      ? formatInteger(seconds, locale)
      : formatInteger(seconds / 60, locale);
  return (
    <div>
      <SectionHeader title={t("settings.section.storage")} />
      <Row
        title={t("settings.autosaveInterval")}
        hint={t("settings.autosaveIntervalHint")}
      >
        <Segmented
          ariaLabel={t("settings.autosaveInterval")}
          value={autosaveIntervalSec}
          onChange={(value) => setAutosaveIntervalSec(value)}
          options={[10, 30, 60, 120, 300].map((seconds) => ({
            value: seconds,
            label:
              seconds >= 60
                ? `${minute(seconds)} ${seconds >= 120 ? t("settings.minutes") : t("settings.minute")}`
                : `${minute(seconds)} ${t("settings.seconds")}`,
          }))}
        />
      </Row>
      <p className="text-[0.6875rem] text-muted-foreground">
        {t("settings.autosaveRangeNote")
          .replace("{min}", formatInteger(AUTOSAVE_INTERVAL_MIN_SEC, locale))
          .replace(
            "{max}",
            formatInteger(AUTOSAVE_INTERVAL_MAX_SEC / 60, locale),
          )}
      </p>
      {/* R13.1 (AC13.2): the one-way Markdown mirror — after every disk
          save the project re-exports to <project>.icb.md/; the .icb stays
          the source of truth (the Persian notice documents this). */}
      <Row
        title={t("settings.mirrorFolder")}
        hint={t("settings.mirrorFolderHint")}
      >
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={mirrorEnabled}
            onChange={(event) => {
              useUiStore
                .getState()
                .setMirrorFolderEnabled(event.target.checked);
            }}
            className="size-4 accent-(--color-primary)"
            aria-label={t("settings.mirrorFolder")}
          />
        </label>
      </Row>
    </div>
  );
}
