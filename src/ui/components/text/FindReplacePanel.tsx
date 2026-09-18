"use client";

/**
 * Find & Replace panel (R3B.8): a floating panel (Ctrl+F) searching the
 * plain text of EVERY text object — substring matching on the logical text
 * order (RTL-correct by construction). Next/previous navigation flies the
 * camera to the object (300 ms eased flight) and selects the match range
 * inside the object's live editor; Replace applies one undoable command,
 * Replace All bundles every object into ONE composite undo step.
 *
 * The panel re-runs the search whenever the scene changes (revision-keyed)
 * and keeps its input focus without committing a live edit session (the
 * root is tagged `data-text-format-ui`, the text layer's transient focus
 * owner).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Replace,
  ReplaceAll,
  Search,
  X,
} from "lucide-react";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import type { CameraController } from "@/core/camera/CameraController";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { Scene } from "@/core/model/Scene";
import { objectBBox } from "@/core/model/SceneObject";
import { isTextBoxObject } from "@/core/model/TextBoxObject";
import type { TextLayerView } from "@/text/view/TextLayerView";
import { getSharedTextEditor } from "@/text/editor/TipTapFactory";
import { selectLogicalRange } from "@/text/find/FindSelection";
import { findMatches, type FindMatch } from "@/text/find/FindReplaceModel";
import {
  collectTargets,
  replaceAllMatches,
  replaceMatch,
} from "@/text/find/TextReplaceService";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import { formatInteger } from "@/ui/i18n/numbers";
import { cn } from "@/lib/utils";

/** Deps bundle resolved once the app booted (services stay app-scoped). */
interface PanelDeps {
  readonly scene: Scene;
  readonly history: HistoryManager;
  readonly controller: CameraController;
  readonly textLayer: TextLayerView;
}

/**
 * @returns the canvas viewport size (client px), fallback window size.
 */
function viewportSize(): { width: number; height: number } {
  const canvas = document.querySelector("canvas");
  if (canvas !== null && canvas.clientWidth > 0) {
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * The Find & Replace panel (mounted app-wide; visibility in the UI store).
 *
 * @returns the panel, or null while closed.
 */
export default function FindReplacePanel(): ReactNode {
  const { t } = useTranslation();
  const language = useUiStore((state) => state.language);
  const persianDigits = useUiStore((state) => state.persianDigits);
  const open = useUiStore((state) => state.findPanelOpen);
  const setOpen = useUiStore((state) => state.setFindPanelOpen);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matches, setMatches] = useState<readonly FindMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [revision, setRevision] = useState(0);
  const queryInputRef = useRef<HTMLInputElement | null>(null);

  // Ctrl+F (from canvas shortcuts AND the in-editor Ctrl+F intent) opens
  // the panel and focuses the query field.
  useEffect(() => {
    const bus = AppContext.getDefault().tryGet(Services.eventBus);
    return bus?.on("ui:find-requested", () => {
      setOpen(true);
    });
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      queryInputRef.current?.focus();
      queryInputRef.current?.select();
    }
  }, [open]);

  // Re-run the search on scene changes (revision-keyed, rAF-batched).
  useEffect(() => {
    if (!open) {
      return;
    }
    const bus = AppContext.getDefault().tryGet(Services.eventBus);
    return bus?.on("scene:changed", () => setRevision((value) => value + 1));
  }, [open]);

  // The search itself: query + current scene state.
  useEffect(() => {
    if (!open) {
      return;
    }
    const scene = AppContext.getDefault().tryGet(Services.scene);
    if (scene === undefined) {
      return;
    }
    // Deferred to a microtask: the lint rule forbids synchronous setState
    // in effects (cascading renders); the panel only re-renders once more.
    const next = findMatches(collectTargets(scene), query);
    const task = (): void => {
      setMatches(next);
      setActiveIndex((index) =>
        next.length === 0 ? 0 : Math.min(index, next.length - 1),
      );
    };
    void Promise.resolve().then(task);
  }, [open, query, revision]);

  /** Resolves the service deps needed by navigation and replacement. */
  const deps = useCallback((): PanelDeps | null => {
    const context = AppContext.getDefault();
    const scene = context.tryGet(Services.scene);
    const history = context.tryGet(Services.history);
    const controller = context.tryGet(Services.cameraController);
    const textLayer = context.tryGet(Services.textLayer);
    if (
      scene === undefined ||
      history === undefined ||
      controller === undefined ||
      textLayer === undefined
    ) {
      return null;
    }
    return { scene, history, controller, textLayer };
  }, []);

  /** Navigates to the match at the given (wrapped) index. */
  const goTo = useCallback(
    (index: number): void => {
      if (matches.length === 0) {
        return;
      }
      const wrapped =
        ((index % matches.length) + matches.length) % matches.length;
      const match = matches[wrapped];
      const bundle = deps();
      if (match === undefined || bundle === null) {
        return;
      }
      setActiveIndex(wrapped);
      const object = bundle.scene.findById(match.objectId);
      if (object === undefined) {
        return;
      }
      // 1) Camera flight to the object (R3B.8: next/prev flies the camera).
      bundle.controller.flyTo(objectBBox(object), viewportSize());
      // 2) Open the object's editor and select the match range inside it.
      if (!object.locked) {
        bundle.textLayer.beginEditing(match.objectId);
        if (isTextBoxObject(object)) {
          const editor = getSharedTextEditor().tryGetEditor();
          if (editor !== null && bundle.textLayer.isRichEditing) {
            selectLogicalRange(editor, match.start, match.end);
          }
        }
      }
    },
    [matches, deps],
  );

  /** Replaces the ACTIVE match (one undoable command). */
  const replaceCurrent = useCallback((): void => {
    const match = matches[activeIndex];
    const bundle = deps();
    if (match === undefined || bundle === null || query.length === 0) {
      return;
    }
    const result = replaceMatch(
      {
        scene: bundle.scene,
        history: bundle.history,
        commitEditing: () => bundle.textLayer.endEditing(true),
      },
      match,
      replacement,
    );
    if (result.recorded) {
      setRevision((value) => value + 1); // refresh the match list
    }
  }, [matches, activeIndex, query, replacement, deps]);

  /** Replaces EVERY match as ONE undo step (R3B.8 / AC3B.8). */
  const replaceAll = useCallback((): void => {
    const bundle = deps();
    if (bundle === null || query.length === 0) {
      return;
    }
    const result = replaceAllMatches(
      {
        scene: bundle.scene,
        history: bundle.history,
        commitEditing: () => bundle.textLayer.endEditing(true),
      },
      query,
      replacement,
    );
    if (result.recorded) {
      setRevision((value) => value + 1);
      AppContext.getDefault()
        .tryGet(Services.eventBus)
        ?.emit("ui:notice", {
          messageKey: "find.replacedAllNotice",
          severity: "info",
          values: {
            count: formatInteger(result.replaced, { language, persianDigits }),
          },
        });
    }
  }, [query, replacement, deps, language, persianDigits]);

  const countLabel = useMemo(() => {
    if (query.length === 0) {
      return t("find.emptyQuery");
    }
    if (matches.length === 0) {
      return t("find.noMatches");
    }
    const locale = { language, persianDigits };
    return t("find.matchCount")
      .replace("{current}", formatInteger(activeIndex + 1, locale))
      .replace("{total}", formatInteger(matches.length, locale));
  }, [query, matches.length, activeIndex, language, persianDigits, t]);

  if (!open) {
    return null;
  }

  const inputBase =
    "h-8 w-44 rounded-lg border border-border/60 bg-background/80 px-2.5 text-xs outline-none " +
    "transition-colors placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div
      data-text-format-ui
      dir={language === "fa" ? "rtl" : "ltr"}
      role="search"
      aria-label={t("find.title")}
      className={cn(
        "fixed top-4 z-40 flex flex-col gap-2 rounded-2xl border border-border/60",
        "bg-background/90 p-2.5 shadow-2xl shadow-black/40 backdrop-blur-xl end-4",
        "animate-[panel-pop-in_0.2s_cubic-bezier(0.22,1,0.36,1)_both]",
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
        }
      }}
    >
      <div className="flex items-center gap-2">
        <Search
          className="size-4 flex-none text-muted-foreground"
          aria-hidden="true"
        />
        <span className="text-xs font-semibold">{t("find.title")}</span>
        <button
          type="button"
          aria-label={t("find.close")}
          title={t("find.close")}
          onClick={() => setOpen(false)}
          className="ms-auto grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          ref={queryInputRef}
          value={query}
          placeholder={t("find.queryPlaceholder")}
          aria-label={t("find.queryLabel")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              goTo(event.shiftKey ? activeIndex - 1 : activeIndex + 1);
            }
          }}
          className={inputBase}
        />
        <button
          type="button"
          aria-label={t("find.prev")}
          title={t("find.prev")}
          disabled={matches.length === 0}
          onClick={() => goTo(activeIndex - 1)}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground disabled:opacity-40"
        >
          <ArrowUp className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t("find.next")}
          title={t("find.next")}
          disabled={matches.length === 0}
          onClick={() => goTo(activeIndex + 1)}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground disabled:opacity-40"
        >
          <ArrowDown className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={replacement}
          placeholder={t("find.replacePlaceholder")}
          aria-label={t("find.replaceLabel")}
          onChange={(event) => setReplacement(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              replaceCurrent();
            }
          }}
          className={inputBase}
        />
        <button
          type="button"
          disabled={matches.length === 0}
          onClick={replaceCurrent}
          title={t("find.replace")}
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground disabled:opacity-40"
        >
          <Replace className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={matches.length === 0}
          onClick={replaceAll}
          title={t("find.replaceAll")}
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground disabled:opacity-40"
        >
          <ReplaceAll className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <p
        className="px-0.5 text-[11px] text-muted-foreground"
        aria-live="polite"
      >
        {countLabel}
      </p>
    </div>
  );
}
