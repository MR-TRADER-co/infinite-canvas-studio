"use client";

/**
 * Bookmark bar (R7.9): the floating chip row listing the document's camera
 * bookmarks — click flies the camera (300 ms eased flight), the × removes
 * one, and the prompt dialog (Ctrl+Shift+B → «نام نشانک…») captures the
 * current camera on confirm. The bar hides itself while empty (no chrome
 * on a bookmark-free document).
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { MapPin, X } from "lucide-react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type {
  Bookmark,
  BookmarkService,
} from "@/core/bookmarks/BookmarkService";
import type { CameraController } from "@/core/camera/CameraController";
import { useTranslation } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";
import { cn } from "@/lib/utils";

/**
 * @returns the bookmark bar + the name prompt dialog host.
 */
export default function BookmarkBar(): ReactElement {
  const { t } = useTranslation();
  const promptOpen = useUiStore((state) => state.bookmarkPromptOpen);
  const setPromptOpen = useUiStore((state) => state.setBookmarkPromptOpen);
  const [bookmarks, setBookmarks] = useState<readonly Bookmark[]>([]);
  // External-system handles (stable across renders): service + controller.
  const serviceRef = useRef<BookmarkService | null>(null);
  const controllerRef = useRef<CameraController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      const liveService = context.get(Services.bookmarks);
      serviceRef.current = liveService;
      controllerRef.current = context.get(Services.cameraController);
      const refresh = (): void => {
        setBookmarks(liveService.list());
      };
      refresh();
      unsubscribers.push(
        context.get(Services.eventBus).on("bookmarks:changed", refresh),
      );
    });
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  /**
   * Flies the camera to a bookmark's framing.
   *
   * @param bookmark - the target bookmark.
   */
  const flyTo = (bookmark: Bookmark): void => {
    // R7.9: a 300 ms eased camera flight to the bookmarked framing.
    controllerRef.current?.flyToCamera(bookmark.camera, 300);
  };

  return (
    <>
      {bookmarks.length > 0 && (
        <div
          className={cn(
            "absolute start-4 top-4 z-10 flex max-w-[min(30rem,60%)] flex-wrap",
            "items-center gap-1 rounded-xl border border-border/60 bg-background/85",
            "p-1 shadow-lg shadow-black/20 backdrop-blur-xl",
          )}
          role="toolbar"
          aria-label={t("bookmarks.title")}
        >
          {bookmarks.map((bookmark) => (
            <span
              key={bookmark.id}
              className="group inline-flex items-center gap-1 rounded-lg bg-accent/40 px-2 py-1 text-[11px] text-foreground"
            >
              <button
                type="button"
                onClick={() => flyTo(bookmark)}
                title={t("bookmarks.goto")}
                className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MapPin className="size-3 flex-none" aria-hidden="true" />
                <span className="max-w-[10rem] truncate">{bookmark.name}</span>
              </button>
              <button
                type="button"
                onClick={() => serviceRef.current?.remove(bookmark.id)}
                aria-label={t("bookmarks.delete")}
                title={t("bookmarks.delete")}
                className="grid size-5 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      {promptOpen && (
        <BookmarkPromptDialog
          onSubmit={(name) => {
            serviceRef.current?.add(name);
            setPromptOpen(false);
          }}
          onCancel={() => setPromptOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The bookmark-name prompt dialog («نام نشانک…»).
 *
 * @param props - submit/cancel callbacks.
 * @returns the dialog element.
 */
function BookmarkPromptDialog(props: {
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("bookmarks.add")}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onCancel();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          props.onCancel();
        }
      }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      <form
        className={cn(
          "relative mx-4 flex w-full max-w-xs flex-col gap-3 rounded-2xl",
          "border border-border/60 bg-background/95 p-4 shadow-2xl shadow-black/50",
          "backdrop-blur-xl animate-[panel-pop-in_0.24s_cubic-bezier(0.22,1,0.36,1)_both]",
        )}
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit(name);
        }}
      >
        <label
          htmlFor="bookmark-name"
          className="text-xs font-semibold text-foreground"
        >
          {t("bookmarks.nameLabel")}
        </label>
        <input
          id="bookmark-name"
          // Autofocus via the attribute (dialog mounts fresh each time).
          autoFocus
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("bookmarks.namePlaceholder")}
          dir="auto"
          className="w-full rounded-lg border border-border/60 bg-background/70 px-2.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("saveAt.cancel")}
          </button>
          <button
            type="submit"
            disabled={name.trim() === ""}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("bookmarks.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
