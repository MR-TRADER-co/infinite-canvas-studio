/**
 * About-section tests (v1.48.5): the public-identity contract — the
 * repository URL, the author attribution, and the version-sync guard
 * (the exact drift class that 1.48.3 had to fix by hand: a bumped
 * package.json with a stale i18n string).
 *
 * Source-text assertions follow the pdfTextLayerCss precedent: the
 * contract is pinned to the source so it cannot silently drift.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/ui/i18n/en";
import { fa } from "@/ui/i18n/fa";
import { ABOUT_SECTION_ID, APP_GITHUB_URL } from "@/ui/settings/about";

/** Reads a project file relative to the repo root. */
const read = (...parts: string[]): string =>
  readFileSync(join(process.cwd(), ...parts), "utf8");

/** The canonical public repository of this project. */
const EXPECTED_URL = "https://github.com/MR-TRADER-co/infinite-canvas-studio";

describe("the About section (v1.48.5 identity contract)", () => {
  it("points at the author's public repository", () => {
    expect(APP_GITHUB_URL).toBe(EXPECTED_URL);
  });

  it("uses the reserved core owner scheme for its section id", () => {
    expect(ABOUT_SECTION_ID).toBe("core.settings.about");
  });

  it("resolves every about.* key in BOTH dictionaries", () => {
    for (const dictionary of [fa, en]) {
      expect(dictionary["settings.section.about"]).toBeTruthy();
      expect(dictionary["settings.about.version"]).toBeTruthy();
      expect(dictionary["settings.about.author"]).toBeTruthy();
      expect(dictionary["settings.about.authorValue"]).toBeTruthy();
      expect(dictionary["settings.about.license"]).toBeTruthy();
      expect(dictionary["settings.about.licenseValue"]).toBeTruthy();
      expect(dictionary["settings.about.github"]).toBeTruthy();
      expect(dictionary["settings.about.githubHint"]).toBeTruthy();
      expect(dictionary["settings.about.open"]).toBeTruthy();
    }
  });

  it("registers the section through the settings seam (registerSettings)", () => {
    const source = read("src", "ui", "settings", "registerSettings.ts");
    expect(source).toContain('"core.settings.about"');
    expect(source).toContain('"settings.section.about"');
    expect(source).toContain("AboutSettingsSection");
    expect(source).toContain("order: 60");
  });

  it("opens the URL ONLY through the R3B.3 confirmation flow", () => {
    const source = read("src", "ui", "settings", "aboutSection.tsx");
    expect(source).toContain("requestOpenLinkConfirmation(APP_GITHUB_URL)");
    // The section itself never bypasses the confirmation dialog with a
    // direct opener call (R3B.3: every external open is confirmed first).
    expect(source).not.toContain("openExternalLink");
    expect(source).not.toContain("window.open");
  });

  it("attributes the author everywhere users and tooling look", () => {
    expect(read("LICENSE")).toContain("MR-TRADER-co");
    const pkg = JSON.parse(read("package.json")) as {
      author: string;
      homepage: string;
      repository: { url: string };
    };
    expect(pkg.author).toBe("MR-TRADER-co");
    expect(pkg.homepage).toBe(`${EXPECTED_URL}#readme`);
    expect(pkg.repository.url).toBe(
      "git+https://github.com/MR-TRADER-co/infinite-canvas-studio.git",
    );
    const tauri = JSON.parse(
      read("src-tauri", "tauri.conf.json"),
    ) as { bundle: { publisher: string } };
    expect(tauri.bundle.publisher).toBe("MR-TRADER-co");
    expect(fa["settings.about.authorValue"]).toBe("MR-TRADER-co");
    expect(en["settings.about.authorValue"]).toBe("MR-TRADER-co");
    expect(read("README.md")).toContain(EXPECTED_URL);
  });

  it("keeps every version string in sync (the 1.48.3 drift cannot recur)", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    const tauri = JSON.parse(read("src-tauri", "tauri.conf.json")) as {
      version: string;
    };
    expect(tauri.version).toBe(pkg.version);
    const enSource = read("src", "ui", "i18n", "en.ts");
    expect(enSource).toContain(`"status.version": "Version ${pkg.version}"`);
    // The Persian string uses Persian digits + the decimal separator ٫.
    const faDigits = pkg.version
      .replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(digit)))
      .replace(/\./g, "٫");
    expect(read("src", "ui", "i18n", "fa.ts")).toContain(
      `"status.version": "نسخهٔ ${faDigits}"`,
    );
    expect(read("README.md")).toContain(faDigits);
    expect(read("docs", "USER_GUIDE.md")).toContain(
      `Infinite Canvas Studio_${pkg.version}_x64-setup.exe`,
    );
  });
});
