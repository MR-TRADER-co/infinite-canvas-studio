import { describe, expect, it } from "vitest";
import {
  dateToJalali,
  formatJalaliLong,
  formatJalaliNumeric,
  formatTodayAsJalaliText,
  gregorianToJalali,
  isJalaliLeapYear,
  jalaliMonthLength,
  jalaliToGregorian,
  JALALI_MONTHS,
  type JalaliDate,
} from "@/core/utils/jalali";

describe("Jalali conversion (R8.3 / AC8.5)", () => {
  it("converts the spec's reference date (2024-08-11 → 1403/05/21)", () => {
    expect(gregorianToJalali(2024, 8, 11)).toEqual({
      jy: 1403,
      jm: 5,
      jd: 21,
    });
  });

  it("converts Nowruz 1403 (2024-03-20 → 1403/01/01)", () => {
    expect(gregorianToJalali(2024, 3, 20)).toEqual({
      jy: 1403,
      jm: 1,
      jd: 1,
    });
  });

  it("handles the leap-year tail (2025-03-20 → 1403/12/30)", () => {
    expect(gregorianToJalali(2025, 3, 20)).toEqual({
      jy: 1403,
      jm: 12,
      jd: 30,
    });
    expect(isJalaliLeapYear(1403)).toBe(true);
  });

  it("rolls into the next year (2025-03-21 → 1404/01/01)", () => {
    expect(gregorianToJalali(2025, 3, 21)).toEqual({
      jy: 1404,
      jm: 1,
      jd: 1,
    });
    expect(isJalaliLeapYear(1404)).toBe(false);
  });

  it("converts today's reference (2026-09-12 → 1405/06/21)", () => {
    expect(gregorianToJalali(2026, 9, 12)).toEqual({
      jy: 1405,
      jm: 6,
      jd: 21,
    });
  });

  it("round-trips Jalali → Gregorian → Jalali across the year", () => {
    const samples: JalaliDate[] = [
      { jy: 1403, jm: 1, jd: 1 },
      { jy: 1403, jm: 5, jd: 21 },
      { jy: 1403, jm: 12, jd: 29 },
      { jy: 1403, jm: 12, jd: 30 },
      { jy: 1404, jm: 7, jd: 15 },
      { jy: 1399, jm: 10, jd: 10 },
      { jy: 1470, jm: 3, jd: 31 },
    ];
    for (const sample of samples) {
      const gregorian = jalaliToGregorian(sample.jy, sample.jm, sample.jd);
      const back = gregorianToJalali(gregorian.gy, gregorian.gm, gregorian.gd);
      expect(back).toEqual(sample);
    }
  });

  it("round-trips a dense Gregorian year (every day of 2024)", () => {
    for (let day = 1; day <= 366; day += 1) {
      const date = new Date(Date.UTC(2024, 0, day));
      const jalali = gregorianToJalali(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
      );
      const gregorian = jalaliToGregorian(jalali.jy, jalali.jm, jalali.jd);
      expect(
        gregorianToJalali(gregorian.gy, gregorian.gm, gregorian.gd),
      ).toEqual(jalali);
      expect(jalaliMonthLength(jalali.jy, jalali.jm)).toBeGreaterThanOrEqual(
        jalali.jd,
      );
    }
  });

  it("reports month lengths (31/30/29-or-30)", () => {
    expect(jalaliMonthLength(1403, 1)).toBe(31);
    expect(jalaliMonthLength(1403, 6)).toBe(31);
    expect(jalaliMonthLength(1403, 7)).toBe(30);
    expect(jalaliMonthLength(1403, 11)).toBe(30);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
  });

  it("formats the numeric form (1403/05/21)", () => {
    expect(formatJalaliNumeric({ jy: 1403, jm: 5, jd: 21 })).toBe("1403/05/21");
    expect(formatJalaliNumeric({ jy: 1404, jm: 1, jd: 1 })).toBe("1404/01/01");
  });

  it("formats the long Persian form (۲۱ مرداد ۱۴۰۳)", () => {
    expect(formatJalaliLong({ jy: 1403, jm: 5, jd: 21 })).toBe("۲۱ مرداد ۱۴۰۳");
    expect(JALALI_MONTHS[4]).toBe("مرداد");
  });

  it("formats arbitrary dates through dateToJalali", () => {
    const date = new Date(2024, 7, 11);
    expect(dateToJalali(date)).toEqual({ jy: 1403, jm: 5, jd: 21 });
  });

  it("exposes the insert-text helper in both formats", () => {
    const date = new Date(2024, 7, 11);
    expect(formatTodayAsJalaliText("numeric", date)).toBe("1403/05/21");
    expect(formatTodayAsJalaliText("long", date)).toBe("۲۱ مرداد ۱۴۰۳");
  });
});
