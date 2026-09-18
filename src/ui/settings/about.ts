/**
 * The About constants (v1.48.5): the single source of truth for the
 * project's public identity — the GitHub repository URL and the
 * settings-section id. Every consumer (the About section, the tests'
 * identity-consistency guards, the docs) refers to these values, so
 * moving house is a one-line change.
 */

/** The public GitHub repository (the user-facing source of truth). */
export const APP_GITHUB_URL =
  "https://github.com/MR-TRADER-co/infinite-canvas-studio";

/** The registered About settings-section id (§1.7.2 owner scheme). */
export const ABOUT_SECTION_ID = "core.settings.about";
