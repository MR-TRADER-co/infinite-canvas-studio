"use client";

/**
 * Reusable inspector controls: colour swatch grids, the stroke-width picker,
 * the font-size stepper and the numeric geometry field.
 *
 * Every control is a controlled component over the live scene snapshot: the
 * current value is derived by the panel (mixed selections pass `null`, which
 * renders no active state), and picks dispatch command-backed model actions.
 * Numeric fields own a local draft while focused and re-sync from the model
 * when blurred, so live drags never clobber in-progress typing. All visible
 * strings come from the i18n dictionaries (CLAUDE.md §1.5); Persian digits
 * format through the shared numbers module.
 */
import { Minus, Plus, Slash } from "lucide-react";
import { useLayoutEffect, useRef, type ReactElement } from "react";
import { useTranslation, type TranslationKey } from "@/ui/i18n";
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from "@/core/commands/StylePatches";
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  type RenderPalette,
} from "@/rendering/Canvas2DRenderer";
import { STICKY_NOTE_COLORS } from "@/core/model/StickyNoteObject";
import { cn } from "@/lib/utils";

/**
 * Curated literal swatch colours (warm/neutral family that harmonises with
 * the oklch-340 canvas accent; blue/indigo deliberately omitted).
 */
export const INK_SWATCHES: readonly string[] = [
  "oklch(0.72 0.19 350)", // rose — the accent family
  "oklch(0.62 0.24 25)", // red
  "oklch(0.75 0.16 60)", // orange
  "oklch(0.82 0.16 85)", // amber
  "oklch(0.72 0.16 150)", // green
  "oklch(0.76 0.11 195)", // teal
  "oklch(0.55 0.09 55)", // brown
  "oklch(0.72 0.01 0)", // gray
];

/** Label keys of the curated swatch colours (same order as {@link INK_SWATCHES}). */
const INK_SWATCH_KEYS: readonly TranslationKey[] = [
  "color.rose",
  "color.red",
  "color.orange",
  "color.amber",
  "color.green",
  "color.teal",
  "color.brown",
  "color.gray",
];

/** Label keys of the sticky card palette (same order as STICKY_NOTE_COLORS). */
const STICKY_SWATCH_KEYS: readonly TranslationKey[] = [
  "color.amber",
  "color.yellow",
  "color.peach",
  "color.coral",
  "color.rose",
  "color.green",
  "color.teal",
  "color.lilac",
];

/** Solid preview of the semi-transparent accent fill token. */
const ACCENT_PREVIEW = "oklch(0.72 0.17 340)";

/** Ink preview of the text token per theme (display-only, mirrors globals.css). */
const THEME_FOREGROUND: Record<"dark" | "light", string> = {
  dark: "oklch(0.985 0 0)",
  light: "oklch(0.145 0 0)",
};

/** Stroke-width presets offered by the picker (world units). */
const WIDTH_PRESETS: readonly number[] = [1, 2, 4, 8];

/** One selectable colour of a swatch grid. */
export interface SwatchOption {
  /** Value stored on the object when picked (token or literal CSS colour). */
  readonly value: string;
  /** CSS colour the swatch dot is painted with (display-only). */
  readonly preview: string;
  /** i18n key naming the swatch (tooltips + a11y labels). */
  readonly labelKey: TranslationKey;
  /** Renders the slashed "no fill" affordance instead of a colour dot. */
  readonly none?: boolean;
}

/**
 * Builds the stroke-colour swatches for the active theme: the palette token
 * first, then the curated literals.
 *
 * @param theme - the active UI theme (token preview only; the stored value
 *        is theme-independent).
 * @returns the stroke swatch options.
 */
export function strokeSwatchOptions(
  theme: "dark" | "light",
): readonly SwatchOption[] {
  const palette: RenderPalette =
    theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
  return [
    {
      value: "primary",
      preview: palette.stroke,
      labelKey: "inspector.themeColor",
    },
    ...INK_SWATCHES.map((value, index) => ({
      value,
      preview: value,
      labelKey: INK_SWATCH_KEYS[index] ?? "inspector.color",
    })),
  ];
}

/**
 * Builds the fill swatches: the accent token, the curated literals and the
 * transparent "no fill" option last.
 *
 * @returns the fill swatch options.
 */
export function fillSwatchOptions(): readonly SwatchOption[] {
  return [
    {
      value: "accent",
      preview: ACCENT_PREVIEW,
      labelKey: "inspector.themeColor",
    },
    ...INK_SWATCHES.map((value, index) => ({
      value,
      preview: value,
      labelKey: INK_SWATCH_KEYS[index] ?? "inspector.color",
    })),
    {
      value: "transparent",
      preview: "transparent",
      labelKey: "inspector.noFill",
      none: true,
    },
  ];
}

/**
 * Builds the text ink swatches: the foreground token, then the literals.
 *
 * @param theme - the active UI theme (token preview only; the stored value
 *        is theme-independent).
 * @returns the text swatch options.
 */
export function textSwatchOptions(
  theme: "dark" | "light",
): readonly SwatchOption[] {
  return [
    {
      value: "token://text",
      preview: THEME_FOREGROUND[theme],
      labelKey: "inspector.themeColor",
    },
    ...INK_SWATCHES.map((value, index) => ({
      value,
      preview: value,
      labelKey: INK_SWATCH_KEYS[index] ?? "inspector.color",
    })),
  ];
}

/**
 * Builds the sticky note card swatches from the curated model palette.
 * Values are literal CSS colours (the card background is theme-independent
 * by design — the ink is fixed dark).
 *
 * @returns the sticky card swatch options.
 */
export function stickySwatchOptions(): readonly SwatchOption[] {
  return STICKY_NOTE_COLORS.map((value, index) => ({
    value,
    preview: value,
    labelKey: STICKY_SWATCH_KEYS[index] ?? "inspector.color",
  }));
}

/**
 * Grid of colour swatches (5 per row). The current value highlights its
 * swatch; a `null` current value (mixed selection or out-of-set literal)
 * renders no highlight.
 *
 * @param props - options, current value, pick handler, disabled flag.
 * @returns the swatch grid element.
 */
export function SwatchGrid(props: {
  readonly options: readonly SwatchOption[];
  readonly current: string | null;
  readonly onPick: (value: string) => void;
  readonly disabled?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {props.options.map((option) => {
        const active = props.current !== null && props.current === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={t(option.labelKey)}
            title={t(option.labelKey)}
            disabled={props.disabled}
            onClick={() => props.onPick(option.value)}
            className={cn(
              "grid size-7 place-items-center rounded-full border border-border/70 outline-none",
              "transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring",
              "hover:scale-110 hover:border-foreground/30 disabled:pointer-events-none disabled:opacity-40",
              active &&
                "ring-2 ring-primary ring-offset-2 ring-offset-background",
            )}
            style={
              option.none === true
                ? undefined
                : { backgroundColor: option.preview }
            }
          >
            {option.none === true && (
              <Slash
                className="size-3.5 text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Stroke-width picker: one tile per preset showing a proportional line bar.
 *
 * @param props - current width (null when mixed), pick handler, disabled flag.
 * @returns the width picker element.
 */
export function WidthPicker(props: {
  readonly current: number | null;
  readonly onPick: (width: number) => void;
  readonly disabled?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {WIDTH_PRESETS.map((preset) => {
        const active = props.current !== null && props.current === preset;
        const label = t(`inspector.width.${preset}` as TranslationKey);
        return (
          <button
            key={preset}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={label}
            disabled={props.disabled}
            onClick={() => props.onPick(preset)}
            className={cn(
              "flex h-8 items-center justify-center rounded-lg border outline-none",
              "transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-40",
              active
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border/60 bg-background/60 text-muted-foreground hover:border-foreground/25 hover:text-foreground",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "w-5 rounded-full",
                active ? "bg-primary" : "bg-current",
              )}
              style={{ height: `${Math.max(2, preset * 1.4)}px` }}
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Font-size stepper: −/+ buttons around an exact numeric field. Each click
 * or commit dispatches one model action (one history entry each).
 *
 * @param props - current font size, commit handler, disabled flag.
 * @returns the stepper element.
 */
export function FontSizeStepper(props: {
  readonly value: number;
  readonly onCommit: (fontSize: number) => void;
  readonly disabled?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const step = (delta: number): void => {
    props.onCommit(
      Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, props.value + delta)),
    );
  };
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={t("inspector.decrease")}
        title={t("inspector.decrease")}
        disabled={props.disabled || props.value <= FONT_SIZE_MIN}
        onClick={() => step(-2)}
        className={cn(
          "grid size-8 place-items-center rounded-lg border border-border/60 bg-background/60",
          "text-muted-foreground outline-none transition-all duration-150",
          "hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        <Minus className="size-3.5" aria-hidden="true" />
      </button>
      <NumberField
        value={props.value}
        min={FONT_SIZE_MIN}
        max={FONT_SIZE_MAX}
        onCommit={props.onCommit}
        disabled={props.disabled}
        className="w-14 text-center"
      />
      <button
        type="button"
        aria-label={t("inspector.increase")}
        title={t("inspector.increase")}
        disabled={props.disabled || props.value >= FONT_SIZE_MAX}
        onClick={() => step(2)}
        className={cn(
          "grid size-8 place-items-center rounded-lg border border-border/60 bg-background/60",
          "text-muted-foreground outline-none transition-all duration-150",
          "hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Compact numeric field with focus-safe external sync.
 *
 * Uncontrolled input (the DOM owns the draft): a layout effect syncs the
 * element's value from the model only while blurred, so live drags update
 * the readout without ever clobbering in-progress typing. Enter/blur parse,
 * clamp and commit a changed value; Escape reverts. Latin digits with LTR
 * direction (the numeric-input convention, DECISIONS #43).
 *
 * @param props - external value, optional min/max, commit handler,
 *        disabled flag, optional classes and a11y label key.
 * @returns the numeric field element.
 */
export function NumberField(props: {
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly onCommit: (value: number) => void;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly ariaLabelKey?: TranslationKey;
}): ReactElement {
  const { t } = useTranslation();
  const { value, min, max, onCommit, disabled } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef(false);

  // DOM sync (the legit effect job): mirror the model value into the input
  // while the user is not focused on it.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (
      input !== null &&
      !focusedRef.current &&
      input.value !== value.toString()
    ) {
      input.value = value.toString();
    }
  }, [value]);

  const clamp = (raw: number): number => {
    let clamped = raw;
    if (min !== undefined) {
      clamped = Math.max(min, clamped);
    }
    if (max !== undefined) {
      clamped = Math.min(max, clamped);
    }
    return clamped;
  };

  const revert = (): void => {
    const input = inputRef.current;
    if (input !== null) {
      input.value = value.toString();
    }
  };

  const commit = (): void => {
    focusedRef.current = false;
    const input = inputRef.current;
    if (input === null) {
      return;
    }
    const parsed = Number(input.value);
    if (Number.isFinite(parsed)) {
      const clamped = Math.round(clamp(parsed));
      if (clamped !== value) {
        input.value = clamped.toString();
        onCommit(clamped);
        return;
      }
    }
    revert();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      dir="ltr"
      defaultValue={value}
      disabled={disabled}
      aria-label={t(props.ariaLabelKey ?? "inspector.field")}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          revert();
          event.currentTarget.blur();
        }
      }}
      className={cn(
        "h-8 rounded-lg border border-border/60 bg-background/60 px-2 text-xs tabular-nums",
        "text-foreground outline-none transition-all duration-150 placeholder:text-muted-foreground/50",
        "hover:border-foreground/25 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        props.className,
      )}
    />
  );
}

/**
 * Builds the inline style previewing a dash pattern (solid line, dashed
 * line, dotted dots) — used by the connector picker previews and the
 * inspector dash row.
 *
 * @param dash - the dash style to preview.
 * @returns the CSS style object for the preview strip.
 */
export function dashPreviewStyle(
  dash: "solid" | "dashed" | "dotted",
): React.CSSProperties {
  if (dash === "dashed") {
    return {
      backgroundImage:
        "linear-gradient(to right, currentColor 55%, transparent 55%, transparent 75%, currentColor 75%)",
      backgroundSize: "8px 100%",
      backgroundRepeat: "repeat-x",
    };
  }
  if (dash === "dotted") {
    return {
      backgroundImage:
        "radial-gradient(circle, currentColor 38%, transparent 40%)",
      backgroundSize: "6px 100%",
      backgroundRepeat: "repeat-x",
      backgroundPosition: "center",
    };
  }
  return {};
}
