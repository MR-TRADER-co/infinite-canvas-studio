/**
 * Unit tests for the Persian-digits UI setting (R3B.7 / AC3B.7): the pure
 * conversion util plus the locale-aware formatters with the toggle on/off
 * (round-trips fa + digits-off → ASCII, fa + digits-on → ۰-۹).
 */
import { describe, expect, it } from "vitest";
import {
  formatCoords,
  formatInteger,
  formatTimecode,
  formatZoom,
  toPersianDigits,
  wantsPersianDigits,
} from "@/ui/i18n/numbers";

describe("toPersianDigits", () => {
  it("substitutes every ASCII digit", () => {
    expect(toPersianDigits("0123456789")).toBe("۰۱۲۳۴۵۶۷۸۹");
  });

  it("keeps non-digit characters intact", () => {
    expect(toPersianDigits("zoom 125% - x:12")).toBe("zoom ۱۲۵% - x:۱۲");
  });

  it("round-trips through the ASCII mapping", () => {
    const original = "3.14159";
    const persian = toPersianDigits(original);
    const back = [...persian]
      .map((digit) => "۰۱۲۳۴۵۶۷۸۹".indexOf(digit))
      .filter((value) => value >= 0)
      .join("");
    expect(back).toBe("314159");
  });
});

describe("formatters with the Persian-digits setting", () => {
  it("fa + digits ON renders Persian digits (default behaviour)", () => {
    expect(formatInteger(1234, { language: "fa", persianDigits: true })).toBe(
      "۱۲۳۴",
    );
    expect(formatZoom(1.25, { language: "fa", persianDigits: true })).toBe(
      "۱۲۵٪",
    );
    expect(formatCoords(-12, 30, { language: "fa", persianDigits: true })).toBe(
      "-۱۲ · ۳۰",
    );
  });

  it("fa + digits OFF renders ASCII digits immediately (R3B.7)", () => {
    expect(formatInteger(1234, { language: "fa", persianDigits: false })).toBe(
      "1234",
    );
    expect(formatZoom(1.25, { language: "fa", persianDigits: false })).toBe(
      "125%",
    );
    expect(
      formatCoords(-12, 30, { language: "fa", persianDigits: false }),
    ).toBe("-12 · 30");
  });

  it("en ignores the toggle (always ASCII)", () => {
    expect(formatInteger(1234, { language: "en", persianDigits: true })).toBe(
      "1234",
    );
    expect(formatInteger(1234, { language: "en", persianDigits: false })).toBe(
      "1234",
    );
  });

  it("bare language inputs keep the pre-3B behaviour (digits on)", () => {
    expect(formatInteger(1234, "fa")).toBe("۱۲۳۴");
    expect(wantsPersianDigits("fa")).toBe(true);
    expect(wantsPersianDigits("en")).toBe(false);
    expect(wantsPersianDigits({ language: "fa", persianDigits: false })).toBe(
      false,
    );
  });

  it("the toggle round-trips: off → on restores Persian digits", () => {
    const prefs = { language: "fa" as const, persianDigits: false };
    expect(formatInteger(99, prefs)).toBe("99");
    prefs.persianDigits = true;
    expect(formatInteger(99, prefs)).toBe("۹۹");
  });
});

describe("formatTimecode (فاز M1 — the duration badge, A.2.8)", () => {
  it("formats m:ss under an hour and h:mm:ss above (latin)", () => {
    expect(formatTimecode(0, "en")).toBe("0:00");
    expect(formatTimecode(4_700, "en")).toBe("0:04");
    expect(formatTimecode(247_000, "en")).toBe("4:07");
    expect(formatTimecode(3_723_000, "en")).toBe("1:02:03");
  });

  it("shapes the digits per the Persian setting (the timecode stays LTR)", () => {
    expect(formatTimecode(247_000, { language: "fa", persianDigits: true })).toBe("۴:۰۷");
    expect(formatTimecode(3_723_000, { language: "fa", persianDigits: true })).toBe("۱:۰۲:۰۳");
    // Setting OFF → ASCII digits even in the Persian UI.
    expect(formatTimecode(247_000, { language: "fa", persianDigits: false })).toBe("4:07");
    // English never shapes.
    expect(formatTimecode(247_000, "en")).toBe("4:07");
  });

  it("clamps negative durations", () => {
    expect(formatTimecode(-99_000, "fa")).toBe("۰:۰۰");
  });
});
