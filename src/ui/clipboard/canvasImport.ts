"use client";

/**
 * Canvas import machinery (Phase 23 — «پل کلیپ‌بورد») with explicit
 * dependency injection: every entry point receives the scene services it
 * needs, so the module imports NOTHING from the composition root (`@/App`)
 * — the root itself calls these functions from its wiring without cycles.
 *
 * Owners:
 * - the OS image decode/downscale pipeline (`decodeImageFile`) shared by
 *   the paste/drop bridge, the Insert-Image dialog and the system-clipboard
 *   read path;
 * - the two object-commit pipelines: images (`insertDecodedImage`, R5.2)
 *   and pasted/dropped TEXT (`insertTextBoxAt`, Phase 23) — one
 *   `AddObjectCommand` each, viewport-centre or exact drop-point placement,
 *   burst cascade, grid snap, auto-select;
 * - the internal-paste suppression window that keeps the in-canvas
 *   selection clipboard and the document `paste` event from
 *   double-importing.
 */
import type {
  AppEventMap,
  EventBus,
} from "@/core/events/EventBus";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { IdGenerator } from "@/core/id/IdGenerator";
import type { Selection } from "@/core/selection/Selection";
import type { Scene } from "@/core/model/Scene";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import {
  MAX_IMAGE_DIMENSION,
  MAX_INLINE_IMAGE_BYTES,
  createImageObject,
  placedImageSize,
} from "@/core/model/ImageObject";
import { textBoxFromRect } from "@/core/model/TextBoxObject";
import {
  estimateRichPasteBoxSize,
  pastedTextBoxSize,
  PASTED_TEXT_FONT_SIZE,
} from "@/core/clipboard/DropPayload";
import type { RichTextDocument } from "@/text/editor/richtext";
import { snapPointIfEnabled } from "@/interaction/SnapEngine";
import { useUiStore } from "@/ui/store/uiStore";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";

/** One decoded, import-ready bitmap. */
export interface DecodedImage {
  /** Inline data-URL source (already downscaled when oversized). */
  readonly src: string;
  /** Final intrinsic width in pixels. */
  readonly width: number;
  /** Final intrinsic height in pixels. */
  readonly height: number;
}

/** Fraction of the visible viewport an imported image/VIDEO may span. */
export const PASTE_VIEWPORT_SPAN = 0.45;

/** Cascade step between successive burst pastes (world units). */
export const PASTE_CASCADE_STEP = 28;

/** Window within which consecutive pastes keep cascading (ms). */
const PASTE_CASCADE_WINDOW_MS = 8000;

/** How long an internal-paste suppression blocks the document paste (ms). */
const INTERNAL_PASTE_SUPPRESS_MS = 150;

/** Burst-cascade bookkeeping (app-global: one paste stream). */
let cascadeIndex = 0;
let lastInsertAt = 0;

/** Timestamp of the last INTERNAL (in-canvas) paste handling. */
let internalPasteHandledAt = 0;

/** The services an import commit needs (structurally typed, DI style). */
export interface ImportServices {
  readonly scene: Scene;
  readonly history: HistoryManager;
  readonly selection: Selection;
  readonly ids: IdGenerator;
  readonly bus: Pick<EventBus<AppEventMap>, "emit">;
}

/**
 * Marks the current instant as internally pasted — the document paste
 * event (when the browser still fires it) must not double-import.
 */
export function markInternalPasteHandled(): void {
  internalPasteHandledAt = Date.now();
}

/** @returns whether a document paste should be skipped (internal paste). */
export function isDocumentPasteSuppressed(): boolean {
  return Date.now() - internalPasteHandledAt < INTERNAL_PASTE_SUPPRESS_MS;
}

/** Resets the burst cascade (test hook). */
export function resetPasteCascade(): void {
  cascadeIndex = 0;
  lastInsertAt = 0;
}

/** The current cascade step (test hook). */
export function currentCascadeOffset(): number {
  return (cascadeIndex % 8) * PASTE_CASCADE_STEP;
}

/**
 * The SHARED paste/drop placement core (فاز M1 — A.2.10): burst-cascade
 * bookkeeping + the R5.5 grid snap of the placed top-left corner.
 * EVERY imported object — image, VIDEO and pasted text — commits through
 * here so no import surface ever grows a second placement system.
 *
 * @param centre - the world centre (viewport centre or exact drop point).
 * @param placed - the object's placed size in world units.
 * @returns the snapped top-left position for the new object.
 */
export function pastePlacementPosition(
  centre: Vec2,
  placed: { readonly width: number; readonly height: number },
): Vec2 {
  const now = Date.now();
  if (now - lastInsertAt > PASTE_CASCADE_WINDOW_MS) {
    cascadeIndex = 0;
  }
  lastInsertAt = now;
  const cascade = (cascadeIndex % 8) * PASTE_CASCADE_STEP;
  cascadeIndex += 1;
  const rawPosition = vec2(
    centre.x - placed.width / 2 + cascade,
    centre.y - placed.height / 2 + cascade,
  );
  const uiState = useUiStore.getState();
  return snapPointIfEnabled(rawPosition, {
    enabled: uiState.snapEnabled,
    spacing: uiState.snapSpacing,
  });
}

/**
 * Commits one decoded image at the visible viewport centre — or an exact
 * world point (R5.2's shared insertion pipeline; the paste/drop bridge,
 * the Insert-Image dialog AND the system-clipboard read path all land
 * here): downscaled placement, burst cascade, R5.5 grid snap of the placed
 * top-left corner, one `AddObjectCommand` (one undo step), auto-select and
 * a Persian toast.
 *
 * @param services - the scene services committing the object.
 * @param image - the decoded, import-ready bitmap.
 * @param surfaceRect - the viewport rect (client size); falls back to
 *        800×600 when unavailable.
 * @param at - optional world centre overriding the viewport centre (the
 *        drop point of an external drag).
 * @returns whether the object was committed.
 */
export function insertDecodedImage(
  services: ImportServices,
  image: DecodedImage,
  surfaceRect: { readonly width: number; readonly height: number } | null,
  at?: Vec2,
): boolean {
  const { scene, history, selection, ids, bus } = services;
  const camera = scene.camera;
  const rect =
    surfaceRect !== null ? surfaceRect : { width: 800, height: 600 };
  const centerScreen = vec2(rect.width / 2, rect.height / 2);
  const centerWorld =
    at !== undefined ? at : camera.screenToWorld(centerScreen);
  const visibleSpan = Math.max(
    1,
    Math.min(rect.width / camera.zoom, rect.height / camera.zoom),
  );
  const placed = placedImageSize(image, visibleSpan * PASTE_VIEWPORT_SPAN);
  const position = pastePlacementPosition(centerWorld, placed);
  const object = createImageObject(
    ids.next(),
    image.src,
    { width: image.width, height: image.height },
    position,
    placed,
    scene.nextZIndex(),
  );
  const command = new AddObjectCommand(scene, object);
  command.do();
  history.push(command);
  selection.replaceAll([object.id]);
  bus.emit("ui:notice", {
    messageKey: "image.pastedNotice",
    severity: "info",
  });
  return true;
}

/**
 * Commits one pasted/dropped text as a text box centred on a world point:
 * heuristic sizing (longest line → width, line count → height), burst
 * cascade, grid snap, one `AddObjectCommand`, auto-select.
 *
 * @param services - the scene services committing the object.
 * @param text - the imported text (already length-validated by callers
 *        through {@link isImportablePasteText}).
 * @param centre - the world centre to place at (viewport centre for
 *        pastes, the drop point for drags).
 * @returns whether the object was committed.
 */
export function insertTextBoxAt(
  services: ImportServices,
  text: string,
  centre: Vec2,
): boolean {
  const { scene, history, selection, ids } = services;
  const size = pastedTextBoxSize(text);
  const position = pastePlacementPosition(centre, size);
  const object = textBoxFromRect(
    {
      minX: position.x,
      minY: position.y,
      maxX: position.x + size.width,
      maxY: position.y + size.height,
    },
    text,
    PASTED_TEXT_FONT_SIZE,
    ids.next(),
    scene.nextZIndex(),
    "fixed",
  );
  const command = new AddObjectCommand(scene, object);
  command.do();
  history.push(command);
  selection.replaceAll([object.id]);
  return true;
}

/**
 * Commits one RICH pasted document as a formatted text box centred on a
 * world point (فاز ۲۴ — «پیوند غنی Word»): the parsed TipTap document is
 * the object's `doc` (bold/lists/tables/headings/links render through the
 * shared schema), the plain-text projection keeps the legacy `text` field,
 * sizing comes from {@link estimateRichPasteBoxSize}, the width behaviour
 * is FIXED (Word-like wrapping), and — like every import — burst cascade,
 * grid snap, ONE `AddObjectCommand` and auto-select.
 *
 * @param services - the scene services committing the object.
 * @param doc - the parsed rich document (source of truth).
 * @param text - the document's plain-text projection (legacy field).
 * @param centre - the world centre to place at.
 * @returns whether the object was committed.
 */
export function insertRichTextBoxAt(
  services: ImportServices,
  doc: RichTextDocument,
  text: string,
  centre: Vec2,
): boolean {
  const { scene, history, selection, ids } = services;
  const size = estimateRichPasteBoxSize(doc, text);
  const position = pastePlacementPosition(centre, size);
  const plain = textBoxFromRect(
    {
      minX: position.x,
      minY: position.y,
      maxX: position.x + size.width,
      maxY: position.y + size.height,
    },
    text,
    PASTED_TEXT_FONT_SIZE,
    ids.next(),
    scene.nextZIndex(),
    // FIXED width: rich content wraps like a Word paragraph instead of
    // growing to the longest (possibly table-wide) line.
    "fixed",
  );
  const object = { ...plain, doc };
  const command = new AddObjectCommand(scene, object);
  command.do();
  history.push(command);
  selection.replaceAll([object.id]);
  return true;
}

/**
 * Collects the image files of a clipboard/drag payload.
 *
 * @param data - the clipboard or drag payload (null when absent).
 * @returns the image files, in payload order.
 */
export function imageFilesOf(data: DataTransfer | null): readonly File[] {
  if (data === null || typeof data.files?.length !== "number") {
    return [];
  }
  const files: File[] = [];
  for (const file of Array.from(data.files)) {
    if (file.type.startsWith("image/")) {
      files.push(file);
    }
  }
  return files;
}

/** MIME types an offscreen canvas can re-encode losslessly-cheaply. */
const CANVAS_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

/** The import decision for one decoded image file (فاز ۳۴, pure). */
export type ImageImportPlan =
  | { readonly kind: "passthrough" }
  | {
      readonly kind: "rescale";
      readonly width: number;
      readonly height: number;
    };

/**
 * Decides how an imported image file enters the canvas (فاز ۳۴ —
 * «کیفیت اصلی»): ORIGINAL bytes ride through byte-identical while the
 * decoded edge stays ≤ 4096 AND the payload stays ≤ 2.5 MB (any MIME —
 * PNG/JPEG/WebP/AVIF/GIF/BMP/SVG alike); only genuinely gigantic payloads
 * take the proportional 4096-px downscale fallback (localStorage sanity).
 *
 * @param natural - the decoded intrinsic size in pixels.
 * @param byteSize - the ORIGINAL file size in bytes.
 * @returns the import plan for the file.
 */
export function planImageImport(
  natural: { readonly width: number; readonly height: number },
  byteSize: number,
): ImageImportPlan {
  const longest = Math.max(natural.width, natural.height);
  if (longest <= MAX_IMAGE_DIMENSION && byteSize <= MAX_INLINE_IMAGE_BYTES) {
    return { kind: "passthrough" };
  }
  const scale =
    longest > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / longest : 1;
  return {
    kind: "rescale",
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  };
}

/**
 * Decodes one image file into an import-ready bitmap (فاز ۳۴ — «کیفیت
 * اصلی»): files inside the original-quality thresholds keep their EXACT
 * bytes (a byte-identical data URL — any decodable MIME, no canvas
 * round-trip, no generation loss); only gigantic payloads (edge > 4096 px
 * or > 2.5 MB) are downscaled proportionally and re-encoded to a
 * canvas-safe MIME.
 *
 * @param file - the pasted/dropped image file.
 * @returns the decoded image, or null when the file cannot be decoded.
 */
export async function decodeImageFile(
  file: File,
): Promise<DecodedImage | null> {
  const url = URL.createObjectURL(file);
  try {
    const bitmap = await loadBitmapElement(url);
    const width = bitmap.naturalWidth;
    const height = bitmap.naturalHeight;
    if (width === 0 || height === 0) {
      return null;
    }
    const plan = planImageImport({ width, height }, file.size);
    if (plan.kind === "passthrough") {
      return { src: await readFileAsDataUrl(file), width, height };
    }
    const mime = CANVAS_MIME_TYPES.includes(file.type)
      ? file.type
      : "image/png";
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext("2d");
    if (context === null) {
      return null;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, plan.width, plan.height);
    return {
      src: canvas.toDataURL(mime),
      width: plan.width,
      height: plan.height,
    };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param url - the object URL of the bitmap to decode.
 * @returns the decoded image element.
 */
function loadBitmapElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image decode failed"));
    image.src = url;
  });
}

/**
 * @param file - the file to read.
 * @returns the file contents as a data URL.
 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Exposed for tests: the world position of a burst-cascade paste.
 *
 * @param center - the visible viewport centre in world space.
 * @param placed - the placed image size.
 * @param cascadeIndex - the burst index (0-based).
 * @returns the top-left position for the image object.
 */
export function pastedPosition(
  center: Vec2,
  placed: { readonly width: number; readonly height: number },
  cascadeIndex: number,
): Vec2 {
  const cascade = (cascadeIndex % 8) * PASTE_CASCADE_STEP;
  return vec2(
    center.x - placed.width / 2 + cascade,
    center.y - placed.height / 2 + cascade,
  );
}
