"use client";

/**
 * Floating rich text format toolbar (R3A.6): appears only while a text
 * RANGE is selected (caret-only editing stays chrome-free) and hovers
 * fully ABOVE that selection — never over the text — tracking its union
 * rect in client space (pan/zoom aware through the camera:changed binding).
 *
 * The bar never steals editor focus (mousedown is defaulted off — see
 * FormatControls) and never triggers the click-away commit: its root is
 * tagged `data-text-format-ui`, which the text layer's deferred focusout
 * check treats as a transient focus owner.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";
import {
  useRichTextSession,
  type SelectionRect,
} from "@/ui/hooks/useRichTextSession";
import FormatControls from "./FormatControls";
import { cn } from "@/lib/utils";

/** Clear gap between the bar's edge and the selection (screen px). */
const SELECTION_GAP = 12;

/** Safety margin from the viewport edges (screen px). */
const EDGE_MARGIN = 16;

/** Initial size guess before the first measurement lands. */
const INITIAL_BAR_SIZE = { width: 480, height: 46 };

/**
 * Computes the bar position for a selection rect: centred horizontally,
 * resting fully above the selection with a clear gap; flipped BELOW the
 * selection only when there is no room above; clamped into the viewport.
 *
 * @param rect - the selection rect in client space.
 * @param barWidth - the bar's measured width.
 * @param barHeight - the bar's measured height.
 * @param viewportWidth - the viewport width.
 * @param viewportHeight - the viewport height.
 * @returns the inline `left`/`top` style for the fixed bar.
 */
function computeBarStyle(
  rect: SelectionRect,
  barWidth: number,
  barHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): React.CSSProperties {
  const centerX = (rect.left + rect.right) / 2;
  const usableWidth = Math.max(viewportWidth - 2 * EDGE_MARGIN, 0);
  const half = Math.min(barWidth, usableWidth) / 2;
  const minX = EDGE_MARGIN + half;
  const maxX = Math.max(minX, viewportWidth - EDGE_MARGIN - half);
  const left = Math.min(Math.max(centerX, minX), maxX);

  // Prefer above the selection (user-requested placement); flip below only
  // when the bar would collide with the viewport top edge, and clamp the
  // flip so the bar never leaves the viewport either.
  const roomAbove = rect.top - EDGE_MARGIN - barHeight - SELECTION_GAP;
  const top =
    roomAbove >= 0
      ? rect.top - SELECTION_GAP - barHeight
      : Math.min(
          Math.max(rect.bottom + SELECTION_GAP, EDGE_MARGIN),
          Math.max(EDGE_MARGIN, viewportHeight - EDGE_MARGIN - barHeight),
        );

  return { left, top, width: "max-content" };
}

/**
 * @returns the floating toolbar while a text range is selected, else nothing.
 */
export default function TextFormatToolbar(): ReactNode {
  const { t } = useTranslation();
  const session = useRichTextSession();
  const language = useUiStore((state) => state.language);
  const baseFontSize = useUiStore((state) => state.fontSize);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barSize, setBarSize] = useState(INITIAL_BAR_SIZE);

  const editor = session.editor;
  const rect = session.selectionRect;

  // Keep the viewport clamping honest: re-measure the bar whenever its
  // content changes (token bumps per transaction/selection change). The
  // explicit `width: max-content` keeps the natural width independent of
  // the clamped `left` (a fixed element would otherwise shrink-to-fit into
  // the space right of `left`, stacking the controls vertically).
  // useLayoutEffect: correct the estimate before the first paint.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (bar === null) {
      return;
    }
    const width = bar.offsetWidth;
    const height = bar.offsetHeight;
    setBarSize((previous) =>
      Math.abs(previous.width - width) <= 1 &&
      Math.abs(previous.height - height) <= 1
        ? previous
        : { width, height },
    );
  }, [session.token]);

  // Selection-gated visibility (R3A.6 UX): only an actual text range —
  // not mere caret editing — summons the bar.
  if (!session.active || editor === null || rect === null) {
    return null;
  }

  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const style = computeBarStyle(
    rect,
    barSize.width,
    barSize.height,
    viewportWidth,
    viewportHeight,
  );

  return (
    <div
      ref={barRef}
      data-text-format-ui
      dir={language === "fa" ? "rtl" : "ltr"}
      aria-label={t("textFormat.title")}
      style={style}
      className={cn(
        "fixed z-40 -translate-x-1/2 rounded-2xl border border-border/60",
        "bg-background/90 px-2 py-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl",
        "animate-[panel-pop-in_0.2s_cubic-bezier(0.22,1,0.36,1)_both]",
        "max-w-[min(92vw,52rem)]",
      )}
    >
      <FormatControls
        editor={editor}
        baseFontSize={baseFontSize}
        compact
        execute={(chain) => {
          chain(editor.chain().focus()).run();
        }}
      />
    </div>
  );
}
