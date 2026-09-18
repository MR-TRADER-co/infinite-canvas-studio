/**
 * Self-contained Jalali (Solar Hijri) ↔ Gregorian conversion + formatting
 * (R8.3).
 *
 * The arithmetic is the well-studied jalaali-js break-point algorithm
 * (Birashk/Khayyam line with empirical corrections): exact for the whole
 * supported range (Jalali years 1178–3177 ≈ Gregorian 1799–2798), with
 * correct leap-year handling — no external dependency, no `Intl` locale
 * availability assumption (offline guarantee).
 *
 * Persian month names and digit shaping compose with `ui/i18n/numbers`,
 * but live here as data so the utility stays framework-free and
 * node-testable (AC8.5: tested against known references).
 */

/** Persian names of the twelve Jalali months (Farvardin … Esfand). */
export const JALALI_MONTHS: readonly string[] = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

/** A Jalali calendar date. */
export interface JalaliDate {
  /** Jalali year (e.g. 1403). */
  readonly jy: number;
  /** Jalali month, 1–12. */
  readonly jm: number;
  /** Jalali day, 1–29/30/31. */
  readonly jd: number;
}

/** A Gregorian calendar date (calendar fields, not a timestamp). */
export interface GregorianDate {
  readonly gy: number;
  readonly gm: number;
  readonly gd: number;
}

/** Empirical break points of the Birashk calendar model (jalaali-js). */
const BREAKS: readonly number[] = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192,
  2262, 2324, 2394, 2456, 3178,
];

/** Lower Jalali-year bound supported by the break table. */
export const MIN_JALALI_YEAR = BREAKS[0]! + 1; // -60

/** Upper Jalali-year bound supported by the break table. */
export const MAX_JALALI_YEAR = BREAKS[BREAKS.length - 1]! - 1; // 3177

/**
 * Truncating division (the algorithm's convention — all operands stay
 * positive in the supported range, this just matches jalaali-js exactly).
 *
 * @param a - the dividend.
 * @param b - the divisor.
 * @returns the truncated quotient.
 */
function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

/**
 * Truncating modulo paired with {@link div}.
 *
 * @param a - the dividend.
 * @param b - the divisor.
 * @returns the remainder with the dividend's sign.
 */
function mod(a: number, b: number): number {
  return a - div(a, b) * b;
}

/**
 * Internal: Jalali year metadata (leap flag + the Gregorian day of March
 * on which the Jalali year starts).
 *
 * @param jy - the Jalali year.
 * @returns leap indicator + Gregorian year + March day of Nowruz.
 */
function jalCal(jy: number): {
  readonly leap: number;
  readonly gy: number;
  readonly march: number;
} {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0]!;
  let jm = BREAKS[1]!;
  let jump = jm - jp;
  for (let i = 1; i < bl; i += 1) {
    jm = BREAKS[i]!;
    jump = jm - jp;
    if (jy < jm) {
      break;
    }
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) {
    leapJ += 1;
  }
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) {
    n = n - jump + div(jump + 4, 33) * 33;
  }
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) {
    leap = 4;
  }
  return { leap, gy, march };
}

/**
 * Gregorian → Julian Day Number (jalaali-js `g2d`).
 *
 * @param gy - Gregorian year.
 * @param gm - Gregorian month (1–12).
 * @param gd - Gregorian day (1–31).
 * @returns the Julian Day Number.
 */
function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/**
 * Julian Day Number → Gregorian (jalaali-js `d2g`).
 *
 * @param jdn - the Julian Day Number.
 * @returns the Gregorian calendar date.
 */
function d2g(jdn: number): GregorianDate {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/**
 * Julian Day Number → Jalali (jalaali-js `d2j`).
 *
 * @param jdn - the Julian Day Number.
 * @returns the Jalali date.
 */
function d2j(jdn: number): JalaliDate {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 186) {
      return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    }
    k -= 186;
    return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
  }
  jy -= 1;
  k += 179;
  if (r.leap === 1) {
    k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

/**
 * Jalali → Julian Day Number (jalaali-js `j2d`).
 *
 * @param jy - Jalali year.
 * @param jm - Jalali month (1–12).
 * @param jd - Jalali day (1–31).
 * @returns the Julian Day Number.
 */
function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

/**
 * Converts a Gregorian calendar date to the Jalali calendar.
 *
 * @param gy - Gregorian year.
 * @param gm - Gregorian month (1–12).
 * @param gd - Gregorian day (1–31).
 * @returns the Jalali date.
 */
export function gregorianToJalali(
  gy: number,
  gm: number,
  gd: number,
): JalaliDate {
  return d2j(g2d(gy, gm, gd));
}

/**
 * Converts a Jalali calendar date to the Gregorian calendar.
 *
 * @param jy - Jalali year.
 * @param jm - Jalali month (1–12).
 * @param jd - Jalali day (1–31).
 * @returns the Gregorian date.
 */
export function jalaliToGregorian(
  jy: number,
  jm: number,
  jd: number,
): GregorianDate {
  return d2g(j2d(jy, jm, jd));
}

/**
 * Whether a Jalali year is a leap year (12 months + a 30th Esfand day).
 *
 * @param jy - the Jalali year.
 * @returns whether the year has 366 days.
 */
export function isJalaliLeapYear(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

/**
 * Number of days in a Jalali month.
 *
 * @param jy - the Jalali year (leap-aware for Esfand).
 * @param jm - the Jalali month (1–12).
 * @returns 31 (months 1–6), 30 (months 7–11) or 29/30 (Esfand).
 */
export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) {
    return 31;
  }
  if (jm <= 11) {
    return 30;
  }
  return isJalaliLeapYear(jy) ? 30 : 29;
}

/**
 * Extracts the (Gregorian) calendar fields of a JS date in LOCAL time.
 *
 * @param date - the timestamp.
 * @returns the Gregorian calendar date.
 */
function calendarFieldsOf(date: Date): GregorianDate {
  return {
    gy: date.getFullYear(),
    gm: date.getMonth() + 1,
    gd: date.getDate(),
  };
}

/**
 * Converts a JS date (local time) to the Jalali calendar.
 *
 * @param date - the timestamp (default: now).
 * @returns the Jalali date.
 */
export function dateToJalali(date: Date = new Date()): JalaliDate {
  const { gy, gm, gd } = calendarFieldsOf(date);
  return gregorianToJalali(gy, gm, gd);
}

/**
 * Formats a Jalali date numerically: `1403/05/21` (zero-padded, ASCII
 * digits — the spec's first format; pass through a digit shaper when the
 * UI wants Persian numerals).
 *
 * @param date - the Jalali date.
 * @returns the `jy/jm/jd` string.
 */
export function formatJalaliNumeric(date: JalaliDate): string {
  const jm = String(date.jm).padStart(2, "0");
  const jd = String(date.jd).padStart(2, "0");
  return `${date.jy}/${jm}/${jd}`;
}

/**
 * Formats a Jalali date long-form in Persian: `۲۱ مرداد ۱۴۰۳` (the spec's
 * second format; Persian digits + month name).
 *
 * @param date - the Jalali date.
 * @returns the «day month-name year» string with Persian digits.
 */
export function formatJalaliLong(date: JalaliDate): string {
  const month = JALALI_MONTHS[date.jm - 1] ?? "";
  return `${toPersianDigits(date.jd)} ${month} ${toPersianDigits(date.jy)}`;
}

/**
 * Maps ASCII digits of a number to Persian digits.
 *
 * @param value - the number to shape.
 * @returns the number rendered with Persian digits.
 */
function toPersianDigits(value: number): string {
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  return String(value).replace(/[0-9]/g, (digit) => {
    const index = Number(digit);
    return persian[index] ?? digit;
  });
}

/**
 * Both Jalali "insert current date" text formats (R8.3): the numeric
 * `1403/05/21` and the long `۲۱ مرداد ۱۴۰۳`.
 */
export type JalaliTextFormat = "numeric" | "long";

/**
 * Formats "today" (or any timestamp) as Persian text for insertion into
 * the canvas.
 *
 * @param format - which of the two spec formats.
 * @param date - the timestamp (default: now).
 * @returns the formatted Persian date string.
 */
export function formatTodayAsJalaliText(
  format: JalaliTextFormat,
  date: Date = new Date(),
): string {
  const jalali = dateToJalali(date);
  return format === "numeric"
    ? formatJalaliNumeric(jalali)
    : formatJalaliLong(jalali);
}
