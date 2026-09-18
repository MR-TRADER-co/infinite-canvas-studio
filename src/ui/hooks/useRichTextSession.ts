"use client";

/**
 * React binding to the rich-text edit session (R3A.6): exposes the shared
 * TipTap editor, a re-render token bumped on every editor transaction, and
 * the client-space rect of the live (non-collapsed) selection that the
 * floating format toolbar positions itself above (camera-aware).
 *
 * The toolbar visibility rule (UX decision, tldraw-style): the bar is a
 * *selection* affordance — it appears only once the user has an actual text
 * range selected (caret-only editing stays chrome-free), and it tracks the
 * union rect of that range so it never covers the selected text.
 */
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import { getSharedTextEditor } from "@/text/editor/TipTapFactory";

/** Client-space rect of the live text selection (viewport px). */
export interface SelectionRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Snapshot of the rich edit session consumed by the format UI. */
export interface RichTextSessionState {
  /** Whether a rich (TipTap) edit session is active. */
  readonly active: boolean;
  /** The edited object id, or null. */
  readonly objectId: string | null;
  /** Bumped on every editor transaction/service change (re-render driver). */
  readonly token: number;
  /** Union rect of the non-collapsed selection, or null when none. */
  readonly selectionRect: SelectionRect | null;
  /** The shared editor (created lazily; null before the first session). */
  readonly editor: Editor | null;
}

/** Idle state before boot/listeners attach. */
const IDLE: RichTextSessionState = {
  active: false,
  objectId: null,
  token: 0,
  selectionRect: null,
  editor: null,
};

/**
 * Measures the live selection as a client-space rect (bidi-correct).
 *
 * Prefers the DOM selection's union rect (handles wrapped multi-line
 * ranges and mixed RTL/LTR runs); falls back to ProseMirror's per-position
 * coordinates (which work even when the DOM selection is not mirrored).
 *
 * @param editor - the shared TipTap editor.
 * @returns the selection rect, or null when collapsed/unmeasurable.
 */
function measureSelectionRect(editor: Editor): SelectionRect | null {
  const selection = editor.state.selection;
  if (selection.empty) {
    return null;
  }
  const dom = editor.view.dom.ownerDocument.getSelection();
  if (dom !== null && dom.rangeCount > 0 && !dom.isCollapsed) {
    const rect = dom.getRangeAt(0).getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    }
  }
  try {
    const from = editor.view.coordsAtPos(selection.from);
    const to = editor.view.coordsAtPos(selection.to);
    return {
      left: Math.min(from.left, to.left),
      top: Math.min(from.top, to.top),
      right: Math.max(from.right, to.right),
      bottom: Math.max(from.bottom, to.bottom),
    };
  } catch {
    return null;
  }
}

/**
 * Tracks the rich edit session for the floating toolbar.
 *
 * @returns the session state (re-rendered per transaction while active).
 */
export function useRichTextSession(): RichTextSessionState {
  const [state, setState] = useState<RichTextSessionState>(IDLE);

  useEffect(() => {
    let token = 0;
    let scheduled = false;
    let boundEditor: Editor | null = null;
    const editorOffs: Array<[Editor, () => void]> = [];

    const compute = (): void => {
      const layer = AppContext.getDefault().tryGet(Services.textLayer);
      const service = getSharedTextEditor();
      const editor = service.tryGetEditor();
      const active = layer !== undefined && layer.isRichEditing;
      const objectId = layer?.editingObjectId ?? null;
      const selectionRect =
        active && editor !== null ? measureSelectionRect(editor) : null;
      token += 1;
      setState({ active, objectId, token, selectionRect, editor });
    };

    // rAF-batched recompute: transactions arrive in bursts while typing.
    const schedule = (): void => {
      if (scheduled) {
        return;
      }
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        compute();
      });
    };

    const bindEditor = (): void => {
      const editor = getSharedTextEditor().tryGetEditor();
      if (editor === null || boundEditor === editor) {
        return;
      }
      boundEditor = editor;
      const events: Array<
        "transaction" | "selectionUpdate" | "focus" | "blur" | "update"
      > = ["transaction", "selectionUpdate", "focus", "blur", "update"];
      for (const name of events) {
        editor.on(name, schedule);
        editorOffs.push([editor, () => editor.off(name, schedule)]);
      }
    };

    const bus = AppContext.getDefault().tryGet(Services.eventBus);
    const unsubscribers = [
      getSharedTextEditor().subscribe(() => {
        bindEditor();
        schedule();
      }),
      bus?.on("text:edit-began", schedule) ?? (() => undefined),
      bus?.on("text:edit-ended", schedule) ?? (() => undefined),
      bus?.on("camera:changed", schedule) ?? (() => undefined),
    ];
    bindEditor();
    compute();

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      for (const [, off] of editorOffs) {
        off();
      }
    };
  }, []);

  return state;
}
