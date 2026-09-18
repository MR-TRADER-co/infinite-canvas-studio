"use client";

/**
 * Link context bubble (R3B.3): a small floating bar that appears while the
 * caret or selection sits inside a link (live editing only). Offers open
 * (with the Persian confirmation), edit (opens the link dialog) and remove
 * (strips the mark). Positioning mirrors the floating format toolbar:
 * fully above the selection/caret rect, clamped into the viewport.
 *
 * Tagged `data-text-format-ui` so mousedown/click on it never commits the
 * edit session (the text layer's transient-focus rule).
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ExternalLink, Pencil, Unlink } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import { getSharedTextEditor } from "@/text/editor/TipTapFactory";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import {
  requestLinkDialog,
  requestOpenLinkConfirmation,
} from "@/ui/text/intents";
import { cn } from "@/lib/utils";

/** Clear gap between the bubble and the selection (screen px). */
const SELECTION_GAP = 10;

/** Safety margin from the viewport edges (screen px). */
const EDGE_MARGIN = 16;

/** Snapshot of the link-at-caret state the bubble renders from. */
interface BubbleState {
  readonly href: string;
  readonly rect: { left: number; top: number; right: number; bottom: number };
}

/**
 * Measures the caret/selection rect in client space.
 *
 * @param editor - the shared editor.
 * @returns the rect, or null when unmeasurable.
 */
function measureRect(editor: Editor): BubbleState["rect"] | null {
  const selection = editor.state.selection;
  try {
    if (!selection.empty) {
      const from = editor.view.coordsAtPos(selection.from);
      const to = editor.view.coordsAtPos(selection.to);
      return {
        left: Math.min(from.left, to.left),
        top: Math.min(from.top, to.top),
        right: Math.max(from.right, to.right),
        bottom: Math.max(from.bottom, to.bottom),
      };
    }
    const at = editor.view.coordsAtPos(selection.from);
    return { left: at.left, top: at.top, right: at.right, bottom: at.bottom };
  } catch {
    return null;
  }
}

/**
 * The link bubble (mounted app-wide; renders nothing without a link).
 *
 * @returns the bubble, or null.
 */
export default function LinkBubble(): ReactNode {
  const { t } = useTranslation();
  const language = useUiStore((state) => state.language);
  const [state, setState] = useState<BubbleState | null>(null);
  const [token, setToken] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barSize, setBarSize] = useState({ width: 280, height: 38 });

  // Track link-at-caret: recompute on every editor event while a rich
  // session is active (the useRichTextSession pattern, inlined and
  // rAF-batched).
  useEffect(() => {
    let scheduled = false;
    let editor: Editor | null = null;
    const offs: Array<() => void> = [];

    const compute = (): void => {
      const layer = AppContext.getDefault().tryGet(Services.textLayer);
      const service = getSharedTextEditor();
      const live = service.tryGetEditor();
      const active = layer !== undefined && layer.isRichEditing;
      if (!active || live === null) {
        if (state !== null) {
          setState(null);
        }
        return;
      }
      const href = live.getAttributes("link").href as string | undefined;
      if (typeof href !== "string" || href.length === 0) {
        setState(null);
        return;
      }
      const rect = measureRect(live);
      if (rect === null) {
        setState(null);
        return;
      }
      setState({ href, rect });
      setToken((value) => value + 1);
    };

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

    const bind = (): void => {
      const live = getSharedTextEditor().tryGetEditor();
      if (live === null || live === editor) {
        return;
      }
      editor = live;
      const events = [
        "transaction",
        "selectionUpdate",
        "focus",
        "blur",
        "update",
      ] as const;
      for (const name of events) {
        live.on(name, schedule);
        offs.push(() => live.off(name, schedule));
      }
    };

    bind();
    const bus = AppContext.getDefault().tryGet(Services.eventBus);
    offs.push(
      bus?.on("camera:changed", schedule) ?? (() => undefined),
      getSharedTextEditor().subscribe(() => {
        bind();
        schedule();
      }),
    );
    compute();
    return () => {
      for (const off of offs) {
        off();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (bar === null) {
      return;
    }
    setBarSize((previous) =>
      Math.abs(previous.width - bar.offsetWidth) <= 1 &&
      Math.abs(previous.height - bar.offsetHeight) <= 1
        ? previous
        : { width: bar.offsetWidth, height: bar.offsetHeight },
    );
  }, [token, state]);

  if (state === null) {
    return null;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const centerX = (state.rect.left + state.rect.right) / 2;
  const half = Math.min(barSize.width, viewportWidth - 2 * EDGE_MARGIN) / 2;
  const left = Math.min(
    Math.max(centerX, EDGE_MARGIN + half),
    viewportWidth - EDGE_MARGIN - half,
  );
  const roomAbove =
    state.rect.top - EDGE_MARGIN - barSize.height - SELECTION_GAP;
  const top =
    roomAbove >= 0
      ? state.rect.top - SELECTION_GAP - barSize.height
      : Math.min(
          Math.max(state.rect.bottom + SELECTION_GAP, EDGE_MARGIN),
          Math.max(EDGE_MARGIN, viewportHeight - EDGE_MARGIN - barSize.height),
        );

  const editor = getSharedTextEditor().tryGetEditor();
  const removeLink = (): void => {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
  };

  return (
    <div
      ref={barRef}
      data-text-format-ui
      dir={language === "fa" ? "rtl" : "ltr"}
      style={{ left, top, width: "max-content" }}
      className={cn(
        "fixed z-40 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-border/60",
        "bg-background/90 px-2 py-1 shadow-2xl shadow-black/40 backdrop-blur-xl",
        "animate-[panel-pop-in_0.2s_cubic-bezier(0.22,1,0.36,1)_both]",
      )}
    >
      <a
        dir="ltr"
        href={state.href}
        onClick={(event) => {
          event.preventDefault();
          requestOpenLinkConfirmation(state.href);
        }}
        title={state.href}
        className="max-w-52 truncate rounded-md px-1.5 py-0.5 font-mono text-[11px] text-primary underline decoration-primary/50"
      >
        {state.href}
      </a>
      <span className="mx-0.5 h-4 w-px bg-border/70" aria-hidden="true" />
      <button
        type="button"
        title={t("link.bubbleOpen")}
        aria-label={t("link.bubbleOpen")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => requestOpenLinkConfirmation(state.href)}
        className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
      >
        <ExternalLink className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        title={t("link.bubbleEdit")}
        aria-label={t("link.bubbleEdit")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => requestLinkDialog()}
        className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        title={t("link.bubbleRemove")}
        aria-label={t("link.bubbleRemove")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={removeLink}
        className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
      >
        <Unlink className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
