// @vitest-environment jsdom
/**
 * titleBarDrag tests (fix round 1 — the exe close-button bug): the
 * interactive-descendant guard that keeps the floating windows'
 * title-bar pointer-capture drag from swallowing the × button's click.
 *
 * Root cause recap (Pointer Events spec): when the drag handler captures
 * the pointer on the TITLE BAR while the pointerdown started on the bar's
 * × BUTTON, the pointerup retargets to the bar and the resulting click
 * fires on their nearest common inclusive ancestor — the bar — so the
 * button's onClick never runs. The guard makes such pointerdowns skip the
 * capture entirely, keeping the button's native click alive.
 */
import { afterEach, describe, expect, it } from "vitest";
import { isInteractiveTitleBarTarget } from "@/ui/player/titleBarDrag";

/** Builds the title-bar shape: bar > [icon, title span, close button > svg]. */
function buildTitleBar(): {
  bar: HTMLDivElement;
  title: HTMLSpanElement;
  close: HTMLButtonElement;
  glyph: SVGSVGElement;
} {
  const bar = document.createElement("div");
  const title = document.createElement("span");
  title.textContent = "window title";
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "close");
  const glyph = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  close.appendChild(glyph);
  bar.append(title, close);
  document.body.appendChild(bar);
  return { bar, title, close, glyph };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("isInteractiveTitleBarTarget", () => {
  it("skips the drag when the pointerdown starts on the close button", () => {
    const { bar, close } = buildTitleBar();
    expect(isInteractiveTitleBarTarget(close, bar)).toBe(true);
  });

  it("skips the drag when it starts on an SVG glyph INSIDE the button", () => {
    const { bar, glyph } = buildTitleBar();
    expect(isInteractiveTitleBarTarget(glyph, bar)).toBe(true);
  });

  it("drags normally when the pointerdown starts on the bar itself", () => {
    const { bar } = buildTitleBar();
    expect(isInteractiveTitleBarTarget(bar, bar)).toBe(false);
  });

  it("drags normally when it starts on the bar's chrome (title text)", () => {
    const { bar, title } = buildTitleBar();
    expect(isInteractiveTitleBarTarget(title, bar)).toBe(false);
  });

  it("guards other interactive descendants (input, links, menus)", () => {
    const { bar } = buildTitleBar();
    const input = document.createElement("input");
    const link = document.createElement("a");
    link.setAttribute("href", "#");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const plain = document.createElement("div");
    bar.append(input, link, menu, plain);
    expect(isInteractiveTitleBarTarget(input, bar)).toBe(true);
    expect(isInteractiveTitleBarTarget(link, bar)).toBe(true);
    expect(isInteractiveTitleBarTarget(menu, bar)).toBe(true);
    expect(isInteractiveTitleBarTarget(plain, bar)).toBe(false);
  });

  it("ignores non-element targets without throwing", () => {
    const { bar } = buildTitleBar();
    expect(isInteractiveTitleBarTarget(null, bar)).toBe(false);
    expect(isInteractiveTitleBarTarget(undefined, bar)).toBe(false);
    expect(isInteractiveTitleBarTarget(42, bar)).toBe(false);
    expect(isInteractiveTitleBarTarget("button", bar)).toBe(false);
  });

  it("ignores targets outside the bar (foreign subtrees)", () => {
    const { close } = buildTitleBar();
    const other = document.createElement("div");
    document.body.appendChild(other);
    expect(isInteractiveTitleBarTarget(other, close)).toBe(false);
  });
});
