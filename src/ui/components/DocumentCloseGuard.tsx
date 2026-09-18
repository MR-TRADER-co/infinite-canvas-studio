"use client";

/**
 * Document close guard (R4.5): intercepts the window close when the
 * document is dirty and routes it through the Persian unsaved-changes
 * confirm dialog (the shared {@link UnsavedConfirmDialog} answers via
 * `ui:unsaved-confirm-resolved`).
 *
 * Per shell:
 * - **Web**: a `beforeunload` handler triggers the native browser
 *   confirm (custom dialogs cannot block the OS close reliably there).
 * - **Desktop (Tauri)**: `onCloseRequested` → preventDefault → the
 *   Persian dialog; «save» performs the disk save then closes,
 *   «discard» closes, «انصراف» stays. The actual close uses
 *   `destroy()` (the close request was already consumed).
 */
import { useEffect, type ReactNode } from "react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import { isTauriEnvironment } from "@/platform/tauri/log";

/** Mounted app-wide; no visuals (behaviour only). */
export default function DocumentCloseGuard(): ReactNode {
  useEffect(() => {
    let cancelled = false;
    let detachBus: (() => void) | undefined;
    let closeWindow: (() => void) | null = null;
    let detachTauriClose: (() => void) | null = null;

    const install = (): void => {
      const bus = AppContext.getDefault().tryGet(Services.eventBus);
      if (bus === undefined) {
        return;
      }
      // The close decision (emitted by the shared confirm dialog).
      detachBus = bus.on(
        "ui:unsaved-confirm-resolved",
        ({ action, decision }) => {
          if (action !== "close") {
            return;
          }
          const document = AppContext.getDefault().tryGet(Services.document);
          const finish = (): void => {
            closeWindow?.();
            closeWindow = null;
          };
          if (decision === "cancel") {
            closeWindow = null;
            return;
          }
          if (decision === "discard") {
            finish();
            return;
          }
          // "save": write the file (or flush the recovery slot when the
          // document has no path — nothing is ever lost), then close.
          const path = document?.getPath() ?? null;
          const autosave = AppContext.getDefault().tryGet(Services.autosave);
          if (path === null) {
            void autosave?.saveNow("flush").then(finish);
            return;
          }
          const scene = AppContext.getDefault().tryGet(Services.scene);
          const serializer = AppContext.getDefault().tryGet(
            Services.serializer,
          );
          if (scene === undefined || serializer === undefined) {
            finish();
            return;
          }
          const guardContext = AppContext.getDefault();
          // Every persisted section rides the closing save (the
          // save-path fix): bookmarks, styles, schema, links.
          const sections = {
            bookmarks: guardContext.tryGet(Services.bookmarks)?.list(),
            styles: guardContext.tryGet(Services.styles)?.toSection(),
            propertySchema: guardContext
              .tryGet(Services.propertySchema)
              ?.toSection(),
            links: guardContext.tryGet(Services.links)?.toSection(
              new Set(scene.objects.map((object) => object.id)),
            ),
          };
          void import("@/persistence/SaveToDisk")
            .then(({ writeProjectFile }) =>
              writeProjectFile(
                scene,
                serializer,
                path,
                document?.getPlugins(),
                sections,
              ),
            )
            .then(() => {
              document?.noteDiskSave(path, Date.now());
              finish();
            })
            .catch(() => {
              // The save failed: closing would lose work — the guard keeps
              // the window open (the user saw the save error toast).
              closeWindow = null;
            });
        },
      );

      // Desktop: intercept the native close request.
      if (isTauriEnvironment()) {
        void import("@tauri-apps/api/window")
          .then(({ getCurrentWindow }) => {
            const window = getCurrentWindow();
            const unlistenPromise = window.onCloseRequested(async (event) => {
              const document = AppContext.getDefault().tryGet(
                Services.document,
              );
              if (document === undefined || !document.isDirty()) {
                return; // clean: let the default close proceed
              }
              event.preventDefault();
              closeWindow = () => {
                void window.destroy();
              };
              bus.emit("ui:unsaved-confirm-requested", { action: "close" });
            });
            detachTauriClose = () => {
              void unlistenPromise.then((unlisten) => {
                unlisten();
              });
            };
          })
          .catch(() => {
            // Window API unavailable: the web fallback applies.
          });
      }

      // Web (and Tauri fallback): the browser's own beforeunload confirm.
      const onBeforeUnload = (event: BeforeUnloadEvent): void => {
        const document = AppContext.getDefault().tryGet(Services.document);
        if (document === undefined || !document.isDirty()) {
          return;
        }
        event.preventDefault();
        // Chromium requires a non-undefined returnValue to trigger the
        // native "leave site?" prompt.
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      const detachBeforeUnload = () => {
        window.removeEventListener("beforeunload", onBeforeUnload);
      };
      const originalDetach = detachBus;
      detachBus = () => {
        originalDetach?.();
        detachTauriClose?.();
        detachBeforeUnload();
      };
    };

    install();
    if (detachBus === undefined) {
      void Application.boot().then(() => {
        if (!cancelled) {
          install();
        }
      });
    }
    return () => {
      cancelled = true;
      detachBus?.();
    };
  }, []);

  return null;
}
