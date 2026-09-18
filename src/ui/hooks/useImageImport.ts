"use client";

/**
 * The clipboard/drop import BRIDGE (Phase 23 — «پل کلیپ‌بورد»).
 *
 * Installs the document-level listeners that turn EXTERNAL payloads into
 * scene objects (the commit machinery lives in `ui/clipboard/canvasImport`
 * with explicit dependency injection):
 * - `paste` anywhere outside the live rich-text editor and native form
 *   fields: image FILES become image objects; plain TEXT (copied from
 *   Word, a web page, our own copy-out) becomes a text box at the
 *   viewport centre;
 * - `drop` onto the canvas surface: image files as before, plus dragged
 *   TEXT and dragged WEB IMAGES (`text/html` `<img src>` / `text/uri-list`
 *   URLs) which are fetched and imported at ORIGINAL quality, landing
 *   exactly on the drop point (CORS/offline failures degrade into a text
 *   box carrying the address);
 * - the internal-paste suppression window coordinates with the in-canvas
 *   selection clipboard so an internal Mod-V paste never double-imports.
 */
import { useEffect, type RefObject } from "react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import { extractDropPayload } from "@/core/clipboard/DropPayload";
import {
  decodeImageFile,
  imageFilesOf,
  insertDecodedImage,
  insertRichTextBoxAt,
  insertTextBoxAt,
  isDocumentPasteSuppressed,
  type ImportServices,
} from "@/ui/clipboard/canvasImport";
import {
  classifyVideoFiles,
  importOrQueueVideoFiles,
  type VideoImportServices,
} from "@/ui/clipboard/videoImport";
import {
  classifyAudioFiles,
  importOrQueueAudioFiles,
  type AudioImportServices,
} from "@/ui/clipboard/audioImport";
import {
  classifyPdfFiles,
  importPdfFiles,
  type PdfImportServices,
} from "@/ui/clipboard/pdfImport";
import { planRichTextPaste } from "@/ui/clipboard/richPasteImport";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";

// Re-exported for the historical import paths (InsertImageDialog, tests).
export {
  decodeImageFile,
  imageFilesOf,
  insertDecodedImage,
  insertTextBoxAt,
  pastedPosition,
  type DecodedImage,
  type ImportServices,
} from "@/ui/clipboard/canvasImport";

/**
 * Installs the clipboard/drop import bridge on the canvas surface.
 *
 * @param surfaceRef - ref of the canvas surface element (the `<main>`)
 *        providing the viewport rect for placement.
 * @returns void (effect-only hook).
 */
export function useImageImport(
  surfaceRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    let cancelled = false;
    const teardown: Array<() => void> = [];

    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      const bus = context.get(Services.eventBus);
      const servicesOf = (): ImportServices | null => {
        const scene = context.tryGet(Services.scene);
        const history = context.tryGet(Services.history);
        const selection = context.tryGet(Services.selection);
        const ids = context.tryGet(Services.idGenerator);
        if (
          scene === undefined ||
          history === undefined ||
          selection === undefined ||
          ids === undefined
        ) {
          return null;
        }
        return { scene, history, selection, ids, bus };
      };
      // فاز M1: the video import funnel needs the sidecar AssetStore on
      // top of the scene services — same DI style, resolved lazily.
      const videoServicesOf = (): VideoImportServices | null => {
        const base = servicesOf();
        const assets = context.tryGet(Services.assetStore);
        if (base === null || assets === undefined) {
          return null;
        }
        return { ...base, assets };
      };
      // فاز A1: the audio funnel needs the SAME services — one resolver,
      // two funnels (RA1.3's ONE import pipeline rule).
      const audioServicesOf = (): AudioImportServices | null => {
        const base = servicesOf();
        const assets = context.tryGet(Services.assetStore);
        if (base === null || assets === undefined) {
          return null;
        }
        return { ...base, assets };
      };
      // فاز P1: the PDF funnel needs the SAME services — one resolver,
      // plus the pdf.js wrapper (RP1.3's ONE import pipeline rule).
      const pdfServicesOf = (): PdfImportServices | null => {
        const base = servicesOf();
        const assets = context.tryGet(Services.assetStore);
        const pdf = context.tryGet(Services.pdfRenderer);
        if (base === null || assets === undefined || pdf === undefined) {
          return null;
        }
        return { ...base, assets, pdf };
      };

      const onPaste = (event: ClipboardEvent): void => {
        // An internal (in-canvas) paste just ran — never double-import.
        if (isDocumentPasteSuppressed()) {
          return;
        }
        const files = imageFilesOf(event.clipboardData);
        // فاز M1: video files join the paste gesture; فاز M2 routes them
        // through the offline-conversion gate (playable imports now,
        // unplayable containers queue for the dialog).
        const videos = classifyVideoFiles(
          event.clipboardData !== null
            ? Array.from(event.clipboardData.files)
            : [],
        );
        const videoCandidates = [...videos.accepted, ...videos.rejected];
        // فاز A1: audio files join the SAME gesture through their own
        // classifier — never hijacking image/video payloads (RA1.3).
        const audios = classifyAudioFiles(
          event.clipboardData !== null
            ? Array.from(event.clipboardData.files)
            : [],
        );
        // فاز P1 (RP1.3c): PDF files join the SAME gesture through their
        // own classifier — never hijacking image/video/audio payloads.
        const pdfs = classifyPdfFiles(
          event.clipboardData !== null
            ? Array.from(event.clipboardData.files)
            : [],
        );
        if (
          files.length === 0 &&
          videoCandidates.length === 0 &&
          audios.accepted.length === 0 &&
          audios.rejected.length === 0 &&
          pdfs.accepted.length === 0
        ) {
          // Phase 23: plain TEXT from ANYWHERE (Word, web, our own copy)
          // becomes a text box when pasted outside the editor/fields.
          // فاز ۲۴ «پیوند غنی Word»: a `text/html` payload sanitises and
          // parses into a RICH text box — bold/lists/tables/headings/links
          // survive the trip from Word; unformatted text keeps the exact
          // Phase-23 plain-box behaviour.
          const data = event.clipboardData;
          const text = data?.getData("text/plain") ?? "";
          if (
            data !== null &&
            !isInsideEditable(event.target) &&
            !isInsideFormControl(event.target)
          ) {
            const html = data.getData("text/html");
            const plan = planRichTextPaste(html, text);
            if (plan !== null) {
              event.preventDefault();
              const services = servicesOf();
              if (services !== null) {
                if (plan.kind === "rich") {
                  insertRichTextBoxAt(
                    services,
                    plan.doc,
                    plan.text,
                    viewportCentreWorld(surfaceRef.current, services.scene),
                  );
                  bus.emit("ui:notice", {
                    messageKey: "clipboard.richTextPastedNotice",
                    severity: "info",
                  });
                } else {
                  insertTextBoxAt(
                    services,
                    plan.text,
                    viewportCentreWorld(surfaceRef.current, services.scene),
                  );
                  bus.emit("ui:notice", {
                    messageKey: "clipboard.textPastedNotice",
                    severity: "info",
                  });
                }
              }
            }
          }
          return;
        }
        // The live rich-text editor owns its own paste pipeline; while it
        // is focused its contenteditable is the event target.
        if (isInsideEditable(event.target)) {
          return;
        }
        event.preventDefault();
        for (const file of files) {
          void decodeImageFile(file).then((decoded) => {
            if (decoded !== null) {
              const services = servicesOf();
              if (services !== null) {
                insertDecodedImage(
                  services,
                  decoded,
                  rectOf(surfaceRef.current),
                );
              }
            } else {
              bus.emit("ui:notice", {
                messageKey: "image.pasteFailedNotice",
                severity: "error",
              });
            }
          });
        }
        if (videos.accepted.length > 0 || videos.rejected.length > 0) {
          const videoServices = videoServicesOf();
          if (videoServices !== null) {
            void importOrQueueVideoFiles(
              videoServices,
              videoCandidates,
              rectOf(surfaceRef.current),
            );
          } else {
            bus.emit("ui:notice", {
              messageKey: "video.importFailedNotice",
              severity: "error",
            });
          }
        }
        // فاز A1→A2 (RA1.3c + RA2.5): pasted audio files → the ONE gated
        // pipeline (playable imports now; wav/flac queue for the dialog).
        if (audios.accepted.length > 0 || audios.rejected.length > 0) {
          const audioServices = audioServicesOf();
          if (audioServices !== null) {
            void importOrQueueAudioFiles(
              audioServices,
              audios.accepted,
              rectOf(surfaceRef.current),
            );
          } else {
            bus.emit("ui:notice", {
              messageKey: "audio.importFailedNotice",
              severity: "error",
            });
          }
          if (audios.rejected.length > 0) {
            // Truly unknown extensions → the Persian toast, NO object
            // (RA1.3) — one notice per gesture, never a toast storm.
            bus.emit("ui:notice", {
              messageKey: "audio.unsupportedNotice",
              severity: "error",
            });
          }
        }
        // فاز P1 (RP1.3c): pasted PDF files → the ONE pipeline
        // (signature gate → store → poster → shared placement).
        if (pdfs.accepted.length > 0) {
          const pdfServices = pdfServicesOf();
          if (pdfServices !== null) {
            void importPdfFiles(
              pdfServices,
              pdfs.accepted,
              rectOf(surfaceRef.current),
            );
          } else {
            bus.emit("ui:notice", {
              messageKey: "pdf.importFailedNotice",
              severity: "error",
            });
          }
        }
      };

      const onDragOver = (event: DragEvent): void => {
        // Prevent the browser NAVIGATING to dropped links/text: claim the
        // drop everywhere except live editables and native form fields.
        if (
          isInsideEditable(event.target) ||
          isInsideFormControl(event.target)
        ) {
          return;
        }
        const data = event.dataTransfer;
        const importable =
          imageFilesOf(data).length > 0 ||
          (data !== null &&
            data.files.length > 0 &&
            classifyVideoFiles(Array.from(data.files)).accepted.length > 0) ||
          (data !== null &&
            data.files.length > 0 &&
            classifyAudioFiles(Array.from(data.files)).accepted.length > 0) ||
          (data !== null &&
            data.files.length > 0 &&
            classifyPdfFiles(Array.from(data.files)).accepted.length > 0) ||
          (data !== null &&
            data.types.some(
              (type) =>
                type === "text/uri-list" ||
                type === "text/plain" ||
                type === "text/html",
            ));
        if (importable) {
          event.preventDefault();
          if (event.dataTransfer !== null) {
            event.dataTransfer.dropEffect = "copy";
          }
        }
      };

      const onDrop = (event: DragEvent): void => {
        const data = event.dataTransfer;
        if (
          isInsideEditable(event.target) ||
          isInsideFormControl(event.target)
        ) {
          return;
        }
        // Drops landing OUTSIDE the canvas surface must not sprinkle
        // objects over panels — but still cancel the navigation.
        const surface = surfaceRef.current;
        const onSurface =
          surface !== null && surface.contains(event.target as Node);
        if (!onSurface) {
          event.preventDefault();
          return;
        }
        const files = imageFilesOf(data);
        const videos = classifyVideoFiles(
          data !== null ? Array.from(data.files) : [],
        );
        const videoCandidates = [...videos.accepted, ...videos.rejected];
        const audios = classifyAudioFiles(
          data !== null ? Array.from(data.files) : [],
        );
        // فاز P1 (RP1.3b): Explorer-dropped PDF files land ON THE DROP
        // POINT through their own classifier (never hijacking others).
        const pdfs = classifyPdfFiles(
          data !== null ? Array.from(data.files) : [],
        );
        if (
          files.length > 0 ||
          videoCandidates.length > 0 ||
          audios.accepted.length > 0 ||
          audios.rejected.length > 0 ||
          pdfs.accepted.length > 0
        ) {
          event.preventDefault();
          for (const file of files) {
            void decodeImageFile(file).then((decoded) => {
              const services = servicesOf();
              if (decoded !== null && services !== null) {
                insertDecodedImage(
                  services,
                  decoded,
                  rectOf(surface),
                  dropPointWorld(event, surface, services.scene),
                );
              } else if (decoded === null) {
                bus.emit("ui:notice", {
                  messageKey: "image.pasteFailedNotice",
                  severity: "error",
                });
              }
            });
          }
          if (videoCandidates.length > 0) {
            const videoServices = videoServicesOf();
            if (videoServices !== null) {
              void importOrQueueVideoFiles(
                videoServices,
                videoCandidates,
                rectOf(surface),
                dropPointWorld(event, surface, videoServices.scene),
              );
            } else {
              bus.emit("ui:notice", {
                messageKey: "video.importFailedNotice",
                severity: "error",
              });
            }
          }
          // فاز A1→A2 (RA1.3b + RA2.5): Explorer-dropped audio files land
          // ON THE DROP POINT through the gated pipeline (playable now;
          // wav/flac queue for the conversion dialog).
          if (audios.accepted.length > 0 || audios.rejected.length > 0) {
            const audioServices = audioServicesOf();
            if (audioServices !== null) {
              void importOrQueueAudioFiles(
                audioServices,
                audios.accepted,
                rectOf(surface),
                dropPointWorld(event, surface, audioServices.scene),
              );
            } else {
              bus.emit("ui:notice", {
                messageKey: "audio.importFailedNotice",
                severity: "error",
              });
            }
            if (audios.rejected.length > 0) {
              bus.emit("ui:notice", {
                messageKey: "audio.unsupportedNotice",
                severity: "error",
              });
            }
          }
          // فاز P1 (RP1.3b): Explorer-dropped PDF files land ON THE DROP
          // POINT through the ONE pipeline (A.2.10's shared placement).
          if (pdfs.accepted.length > 0) {
            const pdfServices = pdfServicesOf();
            if (pdfServices !== null) {
              void importPdfFiles(
                pdfServices,
                pdfs.accepted,
                rectOf(surface),
                dropPointWorld(event, surface, pdfServices.scene),
              );
            } else {
              bus.emit("ui:notice", {
                messageKey: "pdf.importFailedNotice",
                severity: "error",
              });
            }
          }
          return;
        }
        if (data === null) {
          return;
        }
        // Phase 23: dragged TEXT or a dragged WEB IMAGE (no File rides
        // along — only uri-list/html strings).
        const payload = extractDropPayload(
          Array.from(data.types),
          (type) => data.getData(type),
        );
        if (payload === null) {
          return;
        }
        event.preventDefault();
        const services = servicesOf();
        if (services === null) {
          return;
        }
        const dropPoint = dropPointWorld(event, surface, services.scene);
        if (payload.kind === "text") {
          insertTextBoxAt(services, payload.text, dropPoint);
          bus.emit("ui:notice", {
            messageKey: "clipboard.dropTextNotice",
            severity: "info",
          });
          return;
        }
        void fetchDroppedImage(payload.url)
          .then((file) => {
            if (file === null) {
              insertTextBoxAt(services, payload.url, dropPoint);
              bus.emit("ui:notice", {
                messageKey: "clipboard.dropFetchFailedNotice",
                severity: "info",
              });
              return;
            }
            return decodeImageFile(file).then((decoded) => {
              if (decoded !== null) {
                insertDecodedImage(services, decoded, rectOf(surface), dropPoint);
              } else {
                insertTextBoxAt(services, payload.url, dropPoint);
                bus.emit("ui:notice", {
                  messageKey: "clipboard.dropFetchFailedNotice",
                  severity: "info",
                });
              }
            });
          })
          .catch(() => {
            insertTextBoxAt(services, payload.url, dropPoint);
            bus.emit("ui:notice", {
              messageKey: "clipboard.dropFetchFailedNotice",
              severity: "info",
            });
          });
      };

      document.addEventListener("paste", onPaste);
      document.addEventListener("dragover", onDragOver);
      document.addEventListener("drop", onDrop);
      teardown.push(() => {
        document.removeEventListener("paste", onPaste);
        document.removeEventListener("dragover", onDragOver);
        document.removeEventListener("drop", onDrop);
      });
    });

    return () => {
      cancelled = true;
      for (const dispose of teardown) {
        dispose();
      }
    };
    // The surface ref is a stable object; listeners are installed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * The client rect of a surface element (null when unavailable).
 *
 * @param surface - the canvas surface element.
 * @returns the {width, height} of its bounding rect.
 */
function rectOf(
  surface: HTMLElement | null,
): { readonly width: number; readonly height: number } | null {
  if (surface === null) {
    return null;
  }
  const rect = surface.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

/**
 * The world-space viewport centre of the canvas surface.
 *
 * @param surface - the canvas surface element.
 * @param scene - the scene owning the camera.
 * @returns the visible centre in world coordinates.
 */
function viewportCentreWorld(surface: HTMLElement | null, scene: { camera: { screenToWorld: (screen: Vec2) => Vec2 } }): Vec2 {
  const rect = rectOf(surface) ?? { width: 800, height: 600 };
  return scene.camera.screenToWorld(vec2(rect.width / 2, rect.height / 2));
}

/**
 * The world-space DROP point of a drop event on the surface.
 *
 * @param event - the drop event.
 * @param surface - the canvas surface element (coordinate frame).
 * @param scene - the scene owning the camera.
 * @returns the drop position in world coordinates.
 */
function dropPointWorld(
  event: DragEvent,
  surface: HTMLElement,
  scene: { camera: { screenToWorld: (screen: Vec2) => Vec2 } },
): Vec2 {
  const rect = surface.getBoundingClientRect();
  return scene.camera.screenToWorld(
    vec2(event.clientX - rect.left, event.clientY - rect.top),
  );
}

/**
 * Fetches a dropped image URL into a decodable File (data: URLs ride the
 * same path — `fetch` understands them).
 *
 * @param url - the dropped image address.
 * @returns the image File, or null when the fetch fails (CORS/offline).
 */
async function fetchDroppedImage(url: string): Promise<File | null> {
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    const type = blob.type.startsWith("image/") ? blob.type : "image/png";
    return new File([blob], "dropped-image", { type });
  } catch {
    return null;
  }
}

/**
 * @param target - the event target to inspect.
 * @returns whether the target sits inside a live editable host (the rich
 *          text editor or any contenteditable).
 */
function isInsideEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) {
    return false;
  }
  const element = target instanceof Element ? target : target.parentElement;
  return (
    element !== null &&
    element.closest('[contenteditable="true"]') !== null
  );
}

/**
 * @param target - the event target to inspect.
 * @returns whether the target sits inside a native form field (any text
 *          input, textarea, select or role=textbox) — panel search boxes,
 *          dialogs and the command palette own their paste/drop natively.
 */
function isInsideFormControl(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) {
    return false;
  }
  const element = target instanceof Element ? target : target.parentElement;
  return (
    element !== null &&
    element.closest(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [role="textbox"]',
    ) !== null
  );
}
