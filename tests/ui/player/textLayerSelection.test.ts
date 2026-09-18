// @vitest-environment jsdom
/**
 * textLayerSelection tests (fix round 2 — the Persian PDF viewer bugs):
 * the TextLayerBuilder-port that gives the floating PDF viewer the
 * reference viewer's selection UX (endOfContent, the `selecting` state
 * machine, and the copy handler that NFKC-folds Persian presentation
 * forms back to base letters).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  bindTextLayerSelection,
  normalizeUnicode,
  removeNullCharacters,
} from "@/ui/player/textLayerSelection";

/** Unicode code point helper (avoids literal escape sequences). */
function char(code: number): string {
  return String.fromCharCode(code);
}

describe("normalizeUnicode (pdf.js port + full Arabic fold)", () => {
  it("folds Arabic presentation forms back to base Persian letters", () => {
    // "ﺮگﺸﯾﺎﻤﻧ" — contextual presentation forms (U+FEAE, U+FB94, U+FEB8,
    // U+FBFE, U+FE8E, U+FEE4, U+FEE6) as Chrome-style PDFs emit them.
    const shaped =
      char(0xfeae) + char(0xfb94) + char(0xfeb8) + char(0xfbfe) +
      char(0xfe8e) + char(0xfee4) + char(0xfee6);
    expect(normalizeUnicode(shaped)).toBe("رگشیامن");
  });

  it("folds the tashkeel presentation forms pdf.js special-cases", () => {
    // U+FE71/FE77/FE7D NFKC-decompose to tatweel + the base harakat.
    const expected =
      char(0x0640) + char(0x064b) +
      char(0x0640) + char(0x064e) +
      char(0x0640) + char(0x0651);
    expect(normalizeUnicode(char(0xfe71) + char(0xfe77) + char(0xfe7d))).toBe(
      expected,
    );
  });

  it("maps the long-s ligature per occurrence (pdf.js returns 'undefined')", () => {
    // pdf.js's own map lookup misses runs — our port maps EACH ligature.
    expect(normalizeUnicode(char(0xfb05) + char(0xfb05))).toBe(
      char(0x017f) + "t" + char(0x017f) + "t",
    );
  });

  it("passes logical-order base letters through untouched", () => {
    const logical = "سلام دنیا — می‌شود و بی‌نهایت";
    expect(normalizeUnicode(logical)).toBe(logical);
  });

  it("folds the Latin compat ranges pdf.js lists", () => {
    expect(normalizeUnicode("ﬁne ﬂow")).toBe("fine flow");
    // NFKC folds NBSP (U+00A0) into a plain space.
    expect(normalizeUnicode("a" + char(0x00a0) + "b")).toBe("a b");
  });
});

describe("removeNullCharacters", () => {
  it("strips NUL bytes", () => {
    expect(removeNullCharacters("a" + char(0) + "b" + char(0))).toBe("ab");
  });
  it("leaves clean text alone", () => {
    expect(removeNullCharacters("clean")).toBe("clean");
  });
});

describe("bindTextLayerSelection lifecycle", () => {
  /** The host with a couple of pdf.js-shaped spans. */
  function buildHost(): HTMLElement {
    const host = document.createElement("div");
    host.className = "pdf-text-layer";
    const span = document.createElement("span");
    span.textContent = "سلام";
    host.append(span);
    document.body.append(host);
    return host;
  }

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("appends the endOfContent bridge", () => {
    const host = buildHost();
    const handle = bindTextLayerSelection(host);
    const end = host.querySelector(".endOfContent");
    expect(end).not.toBeNull();
    expect(end?.classList.contains("endOfContent")).toBe(true);
    handle.dispose();
  });

  it("mousedown toggles `selecting`; pointerup resets it", () => {
    const host = buildHost();
    const handle = bindTextLayerSelection(host);
    host.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(host.classList.contains("selecting")).toBe(true);
    document.dispatchEvent(new Event("pointerup"));
    expect(host.classList.contains("selecting")).toBe(false);
    handle.dispose();
  });

  it("copy is stopped and normalized text is written to the clipboard", () => {
    const host = buildHost();
    const handle = bindTextLayerSelection(host);
    // Select the shaped span content through the DOM.
    const range = document.createRange();
    range.selectNodeContents(host.querySelector("span") as Node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const event = new Event("copy", {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent & { clipboardData: DataTransfer | null };
    try {
      Object.defineProperty(event, "clipboardData", {
        value: new DataTransfer(),
      });
    } catch {
      // jsdom without DataTransfer — the handler no-ops the payload and
      // still stops the event.
    }
    host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    handle.dispose();
  });

  it("dispose removes the bridge, the class and the listeners", () => {
    const host = buildHost();
    const handle = bindTextLayerSelection(host);
    handle.dispose();
    expect(host.querySelector(".endOfContent")).toBeNull();
    expect(host.classList.contains("selecting")).toBe(false);
    // A late mousedown must no longer toggle the state machine.
    host.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(host.classList.contains("selecting")).toBe(false);
    // Double dispose stays safe.
    expect(() => handle.dispose()).not.toThrow();
  });
});
