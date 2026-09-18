/**
 * Locale-aware number formatting for the status bar and other readouts.
 *
 * Persian output uses Extended Arabic-Indic digits (۰-۹); the decimal
 * separator conversion (`. → ٫`) only applies to whole-number-free values
 * (zoom percentages and rounded coordinates are integers, so the mapping
 * stays exact).
 *
 * R3B.7 — the Persian-digits UI setting: every formatter accepts either a
 * bare `Language` (digits default ON, the pre-3B behaviour) or a
 * {@link NumberFormatPrefs} pair `{ language, persianDigits }`. When the
 * setting is OFF the UI renders ASCII digits even in the Persian UI
 * language. The setting applies to UI CHROME only — text content inside
 * canvas objects is never touched.
 */
import type { Language } from "@/ui/store/uiStore";

/** Persian digit substitutions for 0-9. */
const PERSIAN_DIGITS: readonly string[] = [
  "۰",
  "۱",
  "۲",
  "۳",
  "۴",
  "۵",
  "۶",
  "۷",
  "۸",
  "۹",
];

/** Digit-rendering preferences of one call site. */
export interface NumberFormatPrefs {
  /** UI language. */
  readonly language: Language;
  /** Whether UI numerals render as Persian digits (R3B.7; default true). */
  readonly persianDigits: boolean;
}

/** Anything the formatters accept as a locale description. */
export type NumberFormatInput = Language | NumberFormatPrefs;

/**
 * Normalises a formatter input to full preferences (bare languages keep
 * the pre-3B behaviour: Persian digits on).
 *
 * @param input - the call-site input.
 * @returns the resolved preferences.
 */
function resolvePrefs(input: NumberFormatInput): NumberFormatPrefs {
  return typeof input === "string"
    ? { language: input, persianDigits: true }
    : input;
}

/**
 * Decides whether a call renders Persian digits.
 *
 * @param input - the call-site input.
 * @returns whether ۰-۹ should be used.
 */
export function wantsPersianDigits(input: NumberFormatInput): boolean {
  const prefs = resolvePrefs(input);
  return prefs.persianDigits && prefs.language === "fa";
}

/**
 * Substitutes every ASCII digit with its Persian counterpart.
 *
 * @param value - the digit string to convert.
 * @returns the same string with Persian digits.
 */
export function toPersianDigits(value: string): string {
  return value.replace(
    /[0-9]/g,
    (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit,
  );
}

/**
 * Formats an integer in the UI locale's digits.
 *
 * @param value - the integer to format.
 * @param input - the locale (or bare language) to format for.
 * @returns the localised integer string.
 */
export function formatInteger(value: number, input: NumberFormatInput): string {
  const rounded = Math.round(value).toString();
  return wantsPersianDigits(input) ? toPersianDigits(rounded) : rounded;
}

/**
 * Formats a zoom factor as a percentage ("۱۲۵٪" / "125%").
 *
 * @param zoom - the zoom factor (1 = 100%).
 * @param input - the locale (or bare language) to format for.
 * @returns the localised percentage string.
 */
export function formatZoom(zoom: number, input: NumberFormatInput): string {
  const percent = Math.round(zoom * 100);
  return wantsPersianDigits(input)
    ? `${toPersianDigits(percent.toString())}٪`
    : `${percent}%`;
}

/**
 * Formats a world coordinate pair for the status readout.
 *
 * @param x - world x coordinate.
 * @param y - world y coordinate.
 * @param input - the locale (or bare language) to format for.
 * @returns the localised "x · y" pair.
 */
export function formatCoords(
  x: number,
  y: number,
  input: NumberFormatInput,
): string {
  return `${formatInteger(x, input)} · ${formatInteger(y, input)}`;
}

/**
 * Formats a video duration as a media timecode (فاز M1 — the thumbnail
 * duration badge, A.2.8): `m:ss` under an hour, `h:mm:ss` above; the
 * timecode itself reads LTR (the universal media convention) while the
 * DIGIT shaping follows the app's Persian-digits setting.
 *
 * @param durationMs - the duration in milliseconds.
 * @param input - the locale (or bare language) to format for.
 * @returns the localised timecode (e.g. `۴:۰۷`, `1:02:03`).
 */
export function formatTimecode(
  durationMs: number,
  input: NumberFormatInput,
): string {
  const total = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const latin =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${minutes}:${String(seconds).padStart(2, "0")}`;
  return wantsPersianDigits(input) ? toPersianDigits(latin) : latin;
}
