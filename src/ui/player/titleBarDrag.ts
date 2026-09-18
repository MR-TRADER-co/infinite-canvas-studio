/**
 * Title-bar drag guard (fix round 1 — the exe close-button bug).
 *
 * The three floating windows (FloatingPlayerWindow, FloatingMiniPlayer,
 * FloatingPdfViewer) drag by their title bar with the pointer-capture
 * pattern: `titleBar.setPointerCapture(pointerId)` on pointerdown, then
 * pointermove/pointerup listeners on the bar. That capture has one
 * spec-level consequence (Pointer Events §"Compatibility mapping"): every
 * FOLLOWING pointer event of that pointer — including the pointerup — is
 * retargeted to the capturing element, and the resulting `click` is
 * dispatched on the nearest common inclusive ancestor of the pointerdown
 * and pointerup targets. When the pointerdown starts on the bar's × close
 * BUTTON, that ancestor is the bar itself — so the button's onClick
 * NEVER fires and the window could not be closed by its button (Esc
 * still worked; the click path was silently dead in every browser).
 *
 * The fix: a pointerdown that starts on an interactive descendant (the
 * close button, any future control) simply never starts the drag — the
 * element keeps its native click. Dragging by the bar's chrome (icon,
 * title text, spacers) behaves exactly as before.
 */

/**
 * Whether a title-bar pointerdown target sits inside an interactive
 * descendant and therefore must NOT start the window drag.
 *
 * @param target - the event's target (may be an SVG glyph inside the
 *        control — `closest()` resolves through it).
 * @param currentTarget - the title bar (the drag surface).
 * @returns true when the pointerdown belongs to an interactive child
 *          (button, input, link, menu, separator…) and the drag must be
 *          skipped so the child's click survives.
 */
export function isInteractiveTitleBarTarget(
  target: unknown,
  currentTarget: object,
): boolean {
  if (
    typeof target !== "object" ||
    target === null ||
    !(target instanceof Element) ||
    target === currentTarget
  ) {
    return false;
  }
  return (
    target.closest(
      "button, input, select, textarea, a[href], [role='separator'], [role='menu'], [role='menuitem'], [role='slider'], [contenteditable='true']",
    ) !== null
  );
}
