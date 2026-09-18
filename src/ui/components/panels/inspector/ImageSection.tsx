"use client";

/**
 * Image inspector section (Phase 23 — «پل کلیپ‌بورد»; فاز ۳۴ — «زمان صفر»):
 * the ORIGINAL-quality contract made visible. Shows the intrinsic pixel
 * size, the current scale/ratio versus the original, the «زمان صفر»
 * insert-state snapshot (فاز ۳۴) and the three reset affordances:
 * «بازنشانی به حالت درج» (the exact placed size/position/rotation at the
 * instant the image entered THIS canvas), «بازنشانی نسبت» (keep width,
 * restore the intrinsic ratio) and «بازنشانی به اندازهٔ اصلی» (full
 * natural-size reset, centre preserved) — each ONE undo step, so any
 * resize/move/rotate drift is always exactly reversible.
 *
 * Renders for a single-image selection (the resets are per-object by
 * design; mixed selections keep the geometry section only).
 */
import { Lock, RefreshCw, Ratio, History } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";
import { formatInteger, toPersianDigits } from "@/ui/i18n/numbers";
import type { InspectorSectionProps } from "@/ui/registry/InspectorSectionRegistry";
import { isImageObject } from "@/core/model/ImageObject";
import {
  imageInsertStateDrifted,
  imageNaturalAspectRatio,
  imageRatioDeviationPercent,
  imageScalePercent,
  imageSizeDrifted,
} from "@/core/model/ImageObject";

/** Fills one `{slot}` placeholder of a translated label. */
function fill(label: string, slot: string, value: string): string {
  return label.replace(`{${slot}}`, value);
}

/** Formats a ratio like 1.78 with locale digits. */
function formatRatio(ratio: number, persian: boolean): string {
  return persian ? toPersianDigits(ratio.toFixed(2)) : ratio.toFixed(2);
}

/** Formats a decimal percent like 12.5 with locale digits. */
function formatPercent(value: number, persian: boolean): string {
  const rounded = Math.round(value * 10) / 10;
  const text = rounded.toFixed(1).replace(/\.0$/, "");
  return persian ? toPersianDigits(text) : text;
}

/** Formats a world coordinate with locale digits. */
function formatCoord(value: number, persian: boolean): string {
  const rounded = Math.round(value);
  return formatInteger(rounded, persian ? "fa" : "en");
}

export default function ImageSection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects, model } = props;
  const { t } = useTranslation();
  const persian = useUiStore((state) => state.persianDigits);
  const images = objects.filter(isImageObject);
  if (images.length !== 1) {
    return null;
  }
  const image = images[0];
  if (image === undefined) {
    return null;
  }
  const locked = image.locked;
  const scale = imageScalePercent(image);
  const ratioDeviation = imageRatioDeviationPercent(image);
  const naturalRatio = imageNaturalAspectRatio(image);
  const currentRatio =
    image.height > 0 ? image.width / image.height : 0;
  const drifted = imageSizeDrifted(image);
  const ratioDrifted = ratioDeviation > 0.5;
  // فاز ۳۴ «زمان صفر»: the insert snapshot and its drift state.
  const initial = image.initial;
  const insertDrifted = imageInsertStateDrifted(image);

  return (
    <section aria-label="inspector.image" className="space-y-2.5">
      {/* The preview tile + the original-size caption. */}
      <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-accent/30 px-2.5 py-2">
        <span
          className="relative grid size-10 flex-none place-items-center overflow-hidden rounded-lg border border-border/50 bg-background/70"
          aria-hidden="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- inline data-URL object preview */}
          <img
            src={image.src}
            alt=""
            className="size-full object-contain"
            draggable={false}
          />
        </span>
        <p className="text-[11px] leading-5 text-muted-foreground">
          {fill(
            t("image.naturalSize"),
            "width",
            formatInteger(image.naturalWidth, persian ? "fa" : "en"),
          ).replace(
            "{height}",
            formatInteger(image.naturalHeight, persian ? "fa" : "en"),
          )}
        </p>
      </div>

      {/* فاز ۳۴ «زمان صفر»: the insert-state snapshot chip — the state the
          reset-to-insert button restores (dashed ring marks the time-zero
          bookmark; the status dot turns amber once the object drifts). */}
      {initial !== undefined ? (
        <div
          className={`flex items-center gap-2 rounded-xl border border-dashed px-2.5 py-1.5 transition-colors ${
            insertDrifted
              ? "border-primary/45 bg-primary/5"
              : "border-border/60 bg-background/40"
          }`}
        >
          <History
            className={`size-3.5 flex-none ${
              insertDrifted ? "text-primary" : "text-muted-foreground"
            }`}
            aria-hidden="true"
          />
          <p className="text-[11px] leading-5 text-muted-foreground">
            {fill(
              fill(
                t("image.insertState"),
                "width",
                formatInteger(initial.width, persian ? "fa" : "en"),
              ).replace(
                "{height}",
                formatInteger(initial.height, persian ? "fa" : "en"),
              ),
              "x",
              formatCoord(initial.x, persian),
            ).replace("{y}", formatCoord(initial.y, persian))}
          </p>
          <span
            className={`ml-auto flex-none rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              insertDrifted
                ? "bg-primary/15 text-primary"
                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            }`}
            title={insertDrifted ? undefined : t("image.atInsertState")}
          >
            {insertDrifted ? t("image.driftedBadge") : t("image.atInsertState")}
          </span>
        </div>
      ) : null}

      {/* The scale/ratio readouts (warning tint once the ratio drifts). */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/50 bg-background/40 px-2.5 py-1.5">
          <p className="text-[10px] text-muted-foreground/80">
            {t("image.ratioNatural")}
          </p>
          <p className="font-mono text-xs text-foreground/90">
            {formatRatio(naturalRatio, persian)}
          </p>
        </div>
        <div
          className={`rounded-lg border px-2.5 py-1.5 ${
            ratioDrifted
              ? "border-destructive/40 bg-destructive/10"
              : "border-border/50 bg-background/40"
          }`}
        >
          <p className="text-[10px] text-muted-foreground/80">
            {t("image.ratioCurrent")}
          </p>
          <p className="font-mono text-xs text-foreground/90">
            {formatRatio(currentRatio, persian)}
            {ratioDrifted
              ? ` · ${fill(
                  t("image.ratioDeviation"),
                  "delta",
                  formatPercent(ratioDeviation, persian),
                )}`
              : ""}
          </p>
        </div>
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">
        {fill(
          t("image.currentScale"),
          "scale",
          formatInteger(scale, persian ? "fa" : "en"),
        )}
      </p>

      {/* The resets (فاز ۳۴ ordering): the «زمان صفر» restore FIRST (the
          user's "back to the moment it entered this canvas"), then the
          ratio fix (keeps the current width), then the full natural-size
          restore. Locked images refuse all three. */}
      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          disabled={locked || !insertDrifted}
          onClick={() => {
            model.resetImageToInsertState();
          }}
          className="group inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-medium text-primary outline-none transition-colors hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <History
            className="size-3.5 transition-transform group-hover:-rotate-12 group-disabled:group-hover:rotate-0"
            aria-hidden="true"
          />
          {locked ? <Lock className="size-3.5" aria-hidden="true" /> : null}
          {t("image.resetToInsert")}
        </button>
        <button
          type="button"
          disabled={locked || !ratioDrifted}
          onClick={() => {
            model.resetImageRatio();
          }}
          className="group inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-medium text-foreground/90 outline-none transition-colors hover:border-primary/40 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Ratio
            className="size-3.5 transition-transform group-hover:scale-110 group-disabled:group-hover:scale-100"
            aria-hidden="true"
          />
          {t("image.resetRatio")}
        </button>
        <button
          type="button"
          disabled={locked || !drifted}
          onClick={() => {
            model.resetImageToNatural();
          }}
          className="group inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-medium text-foreground/90 outline-none transition-colors hover:border-primary/40 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {locked ? (
            <Lock className="size-3.5" aria-hidden="true" />
          ) : (
            <RefreshCw
              className="size-3.5 transition-transform group-hover:rotate-180 group-disabled:group-hover:rotate-0"
              aria-hidden="true"
            />
          )}
          {t("image.resetSize")}
        </button>
      </div>
    </section>
  );
}
