/**
 * Text-layer selection UX (fix2) — the pdf.js TextLayerBuilder contract
 * (pdf_viewer.mjs #bindMouse + #enableGlobalSelectionListener, Apache-2.0),
 * ported for the FloatingPdfViewer's single text layer.
 *
 * Why this exists (exe bug report 3 — «متن‌ها قابل سلکت نیست»):
 * pdf.js's TextLayer paints TRANSPARENT spans whose only interactive job
 * is hit-testing for selection. The reference viewer therefore wraps every
 * text layer with three pieces of selection UX that the raw `TextLayer`
 * class does NOT provide itself:
 *
 * 1. `.endOfContent` — an invisible block appended BELOW the layer; while
 *    the layer has the `selecting` class it spans the WHOLE page, so a
 *    drag that continues past the last text run extends the selection to
 *    the end of the page instead of collapsing;
 * 2. the `selecting` class toggled on mousedown / selectionchange /
 *    pointerup / blur — the layer's selection state machine;
 * 3. a `copy` handler that runs the selection through pdf.js's
 *    `normalizeUnicode` — NFKC-folding Arabic/Persian presentation forms
 *    back to their base letters — plus `removeNullCharacters`, so Ctrl+C
 *    from a shaped-script PDF pastes real text (pre-fix2 the app had NO
 *    copy handler and the clipboard received the raw span text verbatim).
 *
 * Parity note (verified against a reference harness): drags that START
 * on empty space between text runs still select nothing — generic
 * Chromium behavior for absolutely-positioned text; pdf.js's own viewer
 * behaves the same. Drags that start ON a run select the full run and
 * everything crossed.
 *
 * The pre-Chromium-148 "moving endOfContent" workaround from the
 * reference is ported too (guarded the same way): older engines need the
 * endDiv re-inserted next to the selection anchor or selections that
 * start on the layer's tail truncate.
 */
"use client";

/** Unicode code point helpers — avoids literal escape sequences. */
function char(code: number): string {
  return String.fromCharCode(code);
}

function range(from: number, to: number): string {
  return char(from) + "-" + char(to);
}

/**
 * The pdf.js `normalizeUnicode` compat ranges (build/pdf.mjs):
 * general NFKC-folding classes + the Arabic presentation forms used by
 * shaped-text PDFs (Chrome/Word Persian exports map glyphs to these).
 * EXTENDED (deliberate, fix2): pdf.js folds only a narrow subset of the
 * Arabic blocks; this app is first-class Persian (فاز صفر), so the fold
 * covers BOTH Arabic presentation blocks in full — Arabic Presentation
 * Forms-A (U+FB50–U+FDFF) and Forms-B (U+FE70–U+FEFF). NFKC maps every
 * contextual/ligature form back to its base letters, so logical-order
 * text (Word/InDesign exports — already base letters) passes through
 * untouched, while visual-order text (Chrome print exports) at least
 * pastes as real, searchable Persian letters.
 */
const NORMALIZE_CLASS = [
  range(0x00a0, 0x00a0),
  range(0x00b5, 0x00b5),
  range(0x037e, 0x037e),
  range(0x0eb3, 0x0eb3),
  range(0x2000, 0x200a),
  range(0x202f, 0x202f),
  range(0x2126, 0x2126),
  range(0xfb00, 0xfb04),
  range(0xfb06, 0xfb06),
  range(0xfb20, 0xfb36),
  range(0xfb38, 0xfb3c),
  range(0xfb3e, 0xfb3e),
  range(0xfb40, 0xfb41),
  range(0xfb43, 0xfb44),
  range(0xfb46, 0xfba1),
  range(0xfba4, 0xfba9),
  range(0xfbae, 0xfbb1),
  range(0xfbd3, 0xfbdc),
  range(0xfbde, 0xfbe7),
  range(0xfbea, 0xfbf8),
  range(0xfbfc, 0xfbfd),
  range(0xfc00, 0xfc5d),
  range(0xfc64, 0xfcf1),
  range(0xfcf5, 0xfd3d),
  range(0xfd88, 0xfd88),
  range(0xfdf4, 0xfdf4),
  range(0xfdfa, 0xfdfa),
  range(0xfdfb, 0xfdfb),
  range(0xfe71, 0xfe71),
  range(0xfe77, 0xfe77),
  range(0xfe79, 0xfe79),
  range(0xfe7b, 0xfe7b),
  range(0xfe7d, 0xfe7d),
  // fix2 extension: the full Arabic presentation blocks.
  range(0xfb50, 0xfdff),
  range(0xfe70, 0xfeff),
].join("");

/** The ligature pdf.js maps specially (ﬅ → ſt, U+FB05). */
const LIGATURE_ST = char(0xfb05);
const LIGATURE_ST_REPLACEMENT = char(0x017f) + "t";

/** One combined regex, built once (pdf.js builds the same lazily). */
const NORMALIZE_REGEX = new RegExp(
  "([" + NORMALIZE_CLASS + "]+)|(" + LIGATURE_ST + "+)",
  "gu",
);

/**
 * pdf.js `normalizeUnicode`: NFKC-fold compat/presentation sequences,
 * special-case the long-s ligature. Ported from the reference, with one
 * deliberate improvement: pdf.js's own map lookup returns `undefined`
 * (→ the literal string "undefined" on the clipboard!) for runs of two
 * or more consecutive long-s ligatures — here each ligature maps.
 */
export function normalizeUnicode(str: string): string {
  return str.replace(
    NORMALIZE_REGEX,
    (match: string, compat: string | undefined): string =>
      compat !== undefined
        ? compat.normalize("NFKC")
        : LIGATURE_ST_REPLACEMENT.repeat(match.length),
  );
}

/** pdf.js `removeNullCharacters` (default branch): strip NUL bytes. */
export function removeNullCharacters(str: string): string {
  const nul = char(0);
  return str.includes(nul) ? str.split(nul).join("") : str;
}

/** pdf.js `stopEvent`. */
function stopEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

/** The controller returned by {@link bindTextLayerSelection}. */
export interface TextLayerSelectionHandle {
  /** Detaches every listener + the endOfContent node. Idempotent. */
  dispose: () => void;
}

/**
 * Wires the reference viewer's text-selection UX onto one rendered
 * `.pdf-text-layer` host. Call AFTER the pdf.js `TextLayer.render()`
 * finished (the host's children get wiped on each page render — rebind
 * each time, `dispose()` the previous handle first).
 *
 * @param host - the `.pdf-text-layer` container element.
 * @returns the dispose handle for cleanup on page change / close.
 */
export function bindTextLayerSelection(
  host: HTMLElement,
): TextLayerSelectionHandle {
  // 1. The endOfContent bridge (reference: TextLayerBuilder.#render).
  const end = document.createElement("div");
  end.className = "endOfContent";
  host.append(end);

  // 2. The `selecting` state machine (reference: #bindMouse).
  const controller = new AbortController();
  const signal = controller.signal;

  host.addEventListener(
    "mousedown",
    () => {
      host.classList.add("selecting");
    },
    { signal },
  );

  // 3. Copy normalization (reference: #bindMouse's copy branch).
  host.addEventListener(
    "copy",
    (event: ClipboardEvent) => {
      const selection = document.getSelection();
      if (selection !== null) {
        event.clipboardData?.setData(
          "text/plain",
          removeNullCharacters(normalizeUnicode(selection.toString())),
        );
      }
      stopEvent(event);
    },
    { signal },
  );

  /** Reference `reset(end, textLayer)`. */
  const reset = (): void => {
    host.append(end);
    end.style.width = "";
    end.style.height = "";
    host.classList.remove("selecting");
  };

  let pointerDown = false;
  document.addEventListener(
    "pointerdown",
    () => {
      pointerDown = true;
    },
    { signal },
  );
  document.addEventListener(
    "pointerup",
    () => {
      pointerDown = false;
      reset();
    },
    { signal },
  );
  window.addEventListener(
    "blur",
    () => {
      pointerDown = false;
      reset();
    },
    { signal },
  );
  document.addEventListener(
    "keyup",
    () => {
      if (!pointerDown) {
        reset();
      }
    },
    { signal },
  );

  // 4. selectionchange: keep `selecting` in sync + the pre-148 engine
  //    workaround (reference: #enableGlobalSelectionListener).
  const isFirefox =
    getComputedStyle(host).getPropertyValue("-moz-user-select") === "none";
  let modernEngine = isFirefox;
  if (!modernEngine) {
    const brands =
      (navigator as { userAgentData?: { brands?: Array<{ brand: string; version: string }> } })
        .userAgentData?.brands ?? [];
    const chromium =
      brands.find((b) => b.brand === "Chromium")?.version ??
      /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
    modernEngine = chromium !== undefined && Number.parseInt(chromium, 10) >= 148;
  }

  let previousRange: Range | null = null;
  document.addEventListener(
    "selectionchange",
    () => {
      const selection = document.getSelection();
      if (selection === null || selection.rangeCount === 0) {
        reset();
        return;
      }
      const intersects = Array.from(
        { length: selection.rangeCount },
        (_, index) => selection.getRangeAt(index),
      ).some((range) => range.intersectsNode(host));
      if (intersects) {
        host.classList.add("selecting");
      } else {
        reset();
        return;
      }
      if (modernEngine) {
        return;
      }
      // The moving-endOfContent workaround (older Chromium).
      const current = selection.getRangeAt(0);
      const modifyStart =
        previousRange !== null &&
        (current.compareBoundaryPoints(Range.END_TO_END, previousRange) === 0 ||
          current.compareBoundaryPoints(Range.START_TO_END, previousRange) === 0);
      let anchor: Node = modifyStart ? current.startContainer : current.endContainer;
      if (anchor.nodeType === Node.TEXT_NODE) {
        anchor = anchor.parentNode as Node;
      }
      if (!modifyStart && current.endOffset === 0) {
        do {
          while (anchor.previousSibling === null) {
            anchor = anchor.parentNode as Node;
          }
          anchor = anchor.previousSibling as Node;
        } while (anchor.childNodes.length === 0);
      }
      const parentTextLayer = (anchor as Element).parentElement?.closest(
        ".pdf-text-layer",
      );
      if (parentTextLayer === host) {
        end.style.width = host.style.width;
        end.style.height = host.style.height;
        end.style.userSelect = "text";
        const anchorElement = anchor as Element;
        anchorElement.parentElement?.insertBefore(
          end,
          modifyStart ? anchorElement : anchorElement.nextSibling,
        );
      }
      previousRange = current.cloneRange();
    },
    { signal },
  );

  return {
    dispose: (): void => {
      controller.abort();
      end.remove();
      host.classList.remove("selecting");
    },
  };
}
