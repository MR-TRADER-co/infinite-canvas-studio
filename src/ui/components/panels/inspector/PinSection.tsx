"use client";

/**
 * Pin-to-screen inspector section (فاز ۲۵ — «سنجاش روی صفحه»): the
 * affordance that detaches an object from the canvas and pins it to the
 * VIEWPORT — it stops following pans/zooms and rides the screen at a
 * normalized anchor (the FigJam/Miro pinned-note contract).
 *
 * Renders for a single pinnable selection: the toggle button (dynamic
 * label — «سنجاش به صفحه» / «برداشتن سنجاق»), the live anchor readout,
 * and while pinned the 3×3 position grid that snaps the object to the
 * nine screen regions (each ONE undo step) — plus فاز ۲۷'s precise
 * on-screen size row (two NumberFields; the anchor stays fixed) and
 * فاز ۳۰'s quick-turn row (±90° buttons + reset, live angle readout).
 */
import { Pin, PinOff, RotateCcw, RotateCw } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";
import { toPersianDigits } from "@/ui/i18n/numbers";
import type { InspectorSectionProps } from "@/ui/registry/InspectorSectionRegistry";
import { NumberField } from "@/ui/components/panels/inspector/Controls";
import {
  PIN_POSITION_PRESETS,
  isPinnableObject,
  isPinnedObject,
} from "@/core/model/Pinned";

/** Minimum on-screen size the inspector accepts (فاز ۲۷, pixels). */
const MIN_PINNED_SIZE_PX = 8;

/** Maximum on-screen size the inspector accepts (فاز ۲۷, pixels). */
const MAX_PINNED_SIZE_PX = 4096;

/** Fills one `{slot}` placeholder of a translated label. */
function fill(label: string, slot: string, value: string): string {
  return label.replace(`{${slot}}`, value);
}

/** Formats a 0..1 anchor axis as a rounded percentage with locale digits. */
function formatAxisPercent(axis: number, persian: boolean): string {
  const rounded = Math.round(axis * 1000) / 10;
  const text = rounded.toFixed(1).replace(/\.0$/, "");
  return persian ? toPersianDigits(text) : text;
}

/** Formats an angle in degrees with locale digits (LTR-safe). */
function formatDegrees(degrees: number, persian: boolean): string {
  return persian ? toPersianDigits(String(degrees)) : String(degrees);
}

export default function PinSection(
  props: InspectorSectionProps,
): ReactElement | null {
  const { objects, model } = props;
  const { t } = useTranslation();
  const persian = useUiStore((state) => state.persianDigits);
  const pinnables = objects.filter(isPinnableObject);
  if (pinnables.length !== 1) {
    return null;
  }
  const object = pinnables[0];
  if (object === undefined) {
    return null;
  }
  const pinned = isPinnedObject(object);
  const anchor = object.pinAnchor;
  const locked = object.locked;
  const rotationDeg = Math.round((object.rotation * 180) / Math.PI);
  const width = (object as { readonly width?: unknown }).width;
  const height = (object as { readonly height?: unknown }).height;
  const sized =
    typeof width === "number" && typeof height === "number"
      ? { width: Math.round(width), height: Math.round(height) }
      : null;

  // The nearest grid preset of the current anchor (highlight state).
  const activePreset =
    anchor === undefined
      ? null
      : PIN_POSITION_PRESETS.reduce<
          | null
          | (typeof PIN_POSITION_PRESETS)[number]
        >((best, preset) => {
          if (best === null) {
            return preset;
          }
          const distance = (candidate: { readonly anchor: { readonly x: number; readonly y: number } }): number =>
            Math.hypot(candidate.anchor.x - anchor.x, candidate.anchor.y - anchor.y);
          return distance(preset) < distance(best) ? preset : best;
        }, null);

  return (
    <section aria-label="pin.inspector" className="space-y-2.5">
      {/* The state banner: amber while pinned, muted while free. */}
      <div
        className={`rounded-xl border px-2.5 py-2 ${
          pinned
            ? "border-[oklch(0.8_0.14_80/45%)] bg-[oklch(0.8_0.14_80/12%)]"
            : "border-border/60 bg-accent/30"
        }`}
      >
        <p className="flex items-center gap-1.5 text-[11px] leading-5 text-muted-foreground">
          <Pin
            className={`size-3.5 flex-none ${
              pinned ? "text-[oklch(0.75_0.13_75)]" : "text-muted-foreground/70"
            }`}
            aria-hidden="true"
          />
          {pinned ? t("pin.status") : t("pin.hint")}
        </p>
      </div>

      {/* The toggle: pin (amber, prominent) / unpin (quiet). */}
      <button
        type="button"
        disabled={locked}
        onClick={() => {
          model.togglePin();
        }}
        className={
          pinned
            ? "group inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs font-medium text-foreground/90 outline-none transition-colors hover:border-primary/40 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
            : "group inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-[oklch(0.75_0.13_75/50%)] bg-[oklch(0.8_0.14_80/14%)] px-3 text-xs font-medium text-foreground/90 outline-none transition-colors hover:bg-[oklch(0.8_0.14_80/24%)] focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
        }
      >
        {pinned ? (
          <PinOff
            className="size-3.5 transition-transform group-hover:scale-110 group-disabled:group-hover:scale-100"
            aria-hidden="true"
          />
        ) : (
          <Pin
            className="size-3.5 transition-transform group-hover:-rotate-12 group-disabled:group-hover:rotate-0"
            aria-hidden="true"
          />
        )}
        {pinned ? t("pin.unpinAction") : t("pin.pinAction")}
      </button>

      {/* While pinned: the anchor readout + the 3×3 position grid. */}
      {pinned && anchor !== undefined ? (
        <div className="space-y-2">
          <p className="text-[11px] leading-5 text-muted-foreground">
            {fill(
              t("pin.positionReadout"),
              "x",
              formatAxisPercent(anchor.x, persian),
            ).replace("{y}", formatAxisPercent(anchor.y, persian))}
          </p>
          {sized !== null ? (
            <div className="rounded-lg border border-border/50 bg-background/40 p-2">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                {t("pin.size")}
              </p>
              <div className="flex items-center gap-1.5" dir="ltr">
                <NumberField
                  value={sized.width}
                  min={MIN_PINNED_SIZE_PX}
                  max={MAX_PINNED_SIZE_PX}
                  disabled={locked}
                  ariaLabelKey="pin.sizeWidth"
                  className="min-w-0 flex-1"
                  onCommit={(value) => {
                    model.setPinnedSize(value, sized.height);
                  }}
                />
                <span
                  className="text-[10px] text-muted-foreground/70"
                  aria-hidden="true"
                >
                  ×
                </span>
                <NumberField
                  value={sized.height}
                  min={MIN_PINNED_SIZE_PX}
                  max={MAX_PINNED_SIZE_PX}
                  disabled={locked}
                  ariaLabelKey="pin.sizeHeight"
                  className="min-w-0 flex-1"
                  onCommit={(value) => {
                    model.setPinnedSize(sized.width, value);
                  }}
                />
                <span
                  className="flex-none text-[10px] tabular-nums text-muted-foreground/80"
                  aria-hidden="true"
                >
                  {persian ? toPersianDigits("px") : "px"}
                </span>
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground/70">
                {t("pin.sizeHint")}
              </p>
            </div>
          ) : null}
          {/* فاز ۳۰: the quick-turn row — ±90° buttons + reset, with the
              live angle readout; the grip above the object rotates freely. */}
          <div className="rounded-lg border border-border/50 bg-background/40 p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                {t("pin.rotation")}
              </p>
              <span
                dir="ltr"
                className="rounded-full border border-[oklch(0.8_0.14_80/40%)] bg-[oklch(0.8_0.14_80/14%)] px-2 py-0.5 text-[10px] font-medium tabular-nums text-[oklch(0.75_0.13_75)]"
              >
                {formatDegrees(rotationDeg, persian)}°
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  model.rotatePinnedBy(-90);
                }}
                aria-label={t("pin.rotateCcw")}
                title={t("pin.rotateCcw")}
                className="group inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-border/50 bg-background/40 text-[11px] font-medium text-foreground/85 outline-none transition-all hover:border-[oklch(0.75_0.13_75/45%)] hover:bg-[oklch(0.8_0.14_80/14%)] focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw
                  className="size-3.5 text-[oklch(0.75_0.13_75)] transition-transform group-hover:-rotate-45 group-disabled:group-hover:rotate-0"
                  aria-hidden="true"
                />
                <span dir="ltr">{formatDegrees(-90, persian)}°</span>
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  model.rotatePinnedBy(90);
                }}
                aria-label={t("pin.rotateCw")}
                title={t("pin.rotateCw")}
                className="group inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-border/50 bg-background/40 text-[11px] font-medium text-foreground/85 outline-none transition-all hover:border-[oklch(0.75_0.13_75/45%)] hover:bg-[oklch(0.8_0.14_80/14%)] focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCw
                  className="size-3.5 text-[oklch(0.75_0.13_75)] transition-transform group-hover:rotate-45 group-disabled:group-hover:rotate-0"
                  aria-hidden="true"
                />
                <span dir="ltr">+{formatDegrees(90, persian)}°</span>
              </button>
              <button
                type="button"
                disabled={locked || rotationDeg === 0}
                onClick={() => {
                  model.rotatePinnedBy(-rotationDeg);
                }}
                aria-label={t("pin.rotateReset")}
                title={t("pin.rotateReset")}
                className="inline-flex h-8 flex-none items-center justify-center rounded-md border border-border/50 bg-background/40 px-2.5 text-[11px] font-medium tabular-nums text-foreground/85 outline-none transition-all hover:border-[oklch(0.75_0.13_75/45%)] hover:bg-[oklch(0.8_0.14_80/14%)] focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span dir="ltr">{formatDegrees(0, persian)}°</span>
              </button>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground/70">
              {t("pin.rotationHint")}
            </p>
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
              {t("pin.position")}
            </p>
            <div
              className="grid grid-cols-3 gap-1.5"
              role="group"
              aria-label={t("pin.position")}
            >
              {PIN_POSITION_PRESETS.map((preset) => {
                const active = activePreset?.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-label={t(`pin.pos.${preset.id}`)}
                    title={t(`pin.pos.${preset.id}`)}
                    disabled={locked}
                    onClick={() => {
                      model.setPinAnchor(preset.anchor);
                    }}
                    className={`grid h-8 place-items-center rounded-md border outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40 ${
                      active
                        ? "border-[oklch(0.75_0.13_75/60%)] bg-[oklch(0.8_0.14_80/28%)]"
                        : "border-border/50 bg-background/40 hover:border-[oklch(0.75_0.13_75/40%)] hover:bg-[oklch(0.8_0.14_80/14%)]"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`size-1.5 rounded-full ${
                        active
                          ? "bg-[oklch(0.7_0.13_75)]"
                          : "bg-muted-foreground/45"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
