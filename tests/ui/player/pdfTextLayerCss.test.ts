/**
 * pdfTextLayerCss tests (fix round 2): the CSS CONTRACT of the floating
 * PDF viewer's text layer — the regression guard for the exact class of
 * bug that shipped in P2 and surfaced in the exe.
 *
 * Root cause recap: pdf.js v6's TextLayer sizes/positions its spans
 * through CSS custom properties (pdf_viewer.css's .textLayer block).
 * The old inlined `.pdf-text-layer` predated that contract — no
 * `--total-scale-factor` bridge (so the layer's box drifted off the
 * canvas and selection highlights landed beside the glyphs), no
 * `font-size: calc(var(--text-scale-factor) * var(--font-height))` and
 * no `transform: rotate(...) scaleX(...)` (so the transparent hit boxes
 * stayed at the inherited ~16px — drags landed in the gaps and selected
 * nothing). These tests pin every piece of the contract to the source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(process.cwd(), "src", "app", "globals.css"),
  "utf8",
);

/** The `.pdf-text-layer` block (from its opening brace to the next top-level rule). */
const block = css.slice(css.indexOf(".pdf-text-layer {"));

describe("the pdf.js v6 text-layer CSS contract (globals.css)", () => {
  it("bridges --scale-factor into --total-scale-factor (the .page contract)", () => {
    expect(block).toContain(
      "--total-scale-factor: calc(var(--scale-factor, 1) * var(--user-unit))",
    );
  });

  it("declares the rounding quanta pdf.js's setLayerDimensions consumes", () => {
    expect(block).toContain("--scale-round-x: 1px");
    expect(block).toContain("--scale-round-y: 1px");
  });

  it("derives the text scale factor + its inverse", () => {
    expect(block).toContain(
      "--text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size))",
    );
    expect(block).toContain("--min-font-size-inv: calc(1 / var(--min-font-size))");
  });

  it("sizes spans from the measured PDF font height (NOT the inherited size)", () => {
    expect(block).toContain(
      "font-size: calc(var(--text-scale-factor) * var(--font-height))",
    );
  });

  it("applies the per-span rotate/scaleX transform machinery", () => {
    expect(block).toContain(
      "transform: rotate(var(--rotate)) scaleX(var(--scale-x))",
    );
  });

  it("keeps span text selectable and transparent", () => {
    expect(block).toMatch(/\.pdf-text-layer span,\s*\.pdf-text-layer br \{/);
    expect(block).toContain("color: transparent");
    expect(block).toContain("user-select: text");
  });

  it("never boxes marked-content wrappers", () => {
    expect(block).toContain(".pdf-text-layer .markedContent");
    expect(block).toContain("display: contents");
  });

  it("pins the layer LTR (the .page containment the reference enforces)", () => {
    expect(block).toContain("direction: ltr");
  });

  it("carries the endOfContent selection bridge + the selecting state", () => {
    expect(block).toContain(".pdf-text-layer .endOfContent");
    expect(block).toContain("inset: 100% 0 0");
    expect(block).toContain(".pdf-text-layer.selecting .endOfContent");
    expect(block).toContain("top: 0");
  });

  it("uses a valid selection color (not hsl() wrapping an oklch var)", () => {
    // The old rule was `hsl(var(--primary) / 0.35)` — Tailwind 4's --primary
    // is an oklch() value, which makes hsl() invalid at computed-value time
    // (the highlight silently fell back to the UA default).
    expect(block).not.toContain("hsl(var(--primary)");
    expect(block).toContain(
      "color-mix(in oklab, var(--primary) 35%, transparent)",
    );
  });
});
