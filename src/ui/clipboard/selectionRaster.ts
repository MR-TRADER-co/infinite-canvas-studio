"use client";

/**
 * Selection rasterisation (فاز ۲۴ — «کپی چندشیء به‌صورت تصویر»).
 *
 * The OUTBOUND half of the Word bridge for MULTI-object selections: a
 * subset scene containing ONLY the copied objects (groups ride with their
 * members — the same expansion the internal clipboard applies) is exported
 * through the battle-tested PNG pipeline (canvas layer + rasterized rich
 * text layer with embedded Vazirmatn), producing a transparent 2x
 * `image/png` snapshot that lands on the system clipboard beside the
 * plain-text projection.
 *
 * Split deliberately: {@link buildSelectionSubsetScene} is SYNCHRONOUS —
 * the caller snapshots the scene BEFORE a cut removes the objects — while
 * {@link rasterizeSceneToPngBlob} owns the async rasterisation.
 */
import { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { isPinnedObject } from "@/core/model/Pinned";
import { expandGroupMemberIds } from "@/core/model/GroupObject";
import { isImageObject } from "@/core/model/ImageObject";
import { plainTextOfObjects } from "@/core/clipboard/SelectionClipboard";
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  type RenderPalette,
} from "@/rendering/Canvas2DRenderer";
import { exportToPng } from "@/persistence/exporters/PngExporter";
import {
  getSharedTextEditor,
  renderRichTextHTML,
} from "@/text/editor/TipTapFactory";
import { useUiStore } from "@/ui/store/uiStore";
import { t } from "@/ui/i18n";

/** Pixel scale of the selection snapshot (the export dialog's crispness). */
export const SELECTION_RASTER_SCALE = 2;

/** World-unit margin around the snapshot (tighter than a file export). */
export const SELECTION_RASTER_PADDING = 12;

/**
 * Builds the export scene containing ONLY the selection: top-level ids
 * expand through their groups (a copied group rides with its members, the
 * internal clipboard's contract) and keep the parent scene's paint order.
 * Objects are shared by reference — the subset is read-only.
 *
 * @param scene - the live scene the selection lives in.
 * @param topLevelIds - the selection's top-level object ids.
 * @returns the subset scene (empty when nothing resolves).
 */
export function buildSelectionSubsetScene(
  scene: Scene,
  topLevelIds: readonly string[],
): Scene {
  const subset = new Scene();
  if (topLevelIds.length === 0) {
    return subset;
  }
  const expanded = new Set(expandGroupMemberIds(scene, [...topLevelIds]));
  // Iterate the PARENT scene's paint order so the snapshot stacks the
  // objects exactly as they appear on the canvas. PINNED objects join as
  // UNPINNED clones (فاز ۲۸): a snapshot is world-space — the pin state
  // is live-screen furniture with no meaning inside an export image, and
  // the stored world position is exactly where the object drops on unpin.
  for (const object of scene.objects) {
    if (expanded.has(object.id)) {
      subset.add(
        isPinnedObject(object)
          ? ({ ...object, pinned: false, pinAnchor: undefined } as SceneObjectData)
          : object,
      );
    }
  }
  return subset;
}

/**
 * Whether a copied selection should rasterise into the system clipboard
 * (فاز ۲۴ decision table):
 * - a single IMAGE keeps the Phase-23 original-quality path (caller);
 * - a single TEXT-BEARING object keeps the pure text/plain path;
 * - everything else — multi-object clusters, lone shapes, frames,
 *   connectors, stickers, freehand strokes — becomes an image/png
 *   snapshot (with the text projection riding along when present).
 *
 * @param objects - the resolved top-level objects being copied.
 * @returns whether the selection rasterises.
 */
export function shouldRasterizeSelection(
  objects: readonly SceneObjectData[],
): boolean {
  if (objects.length === 0) {
    return false;
  }
  if (objects.length > 1) {
    return true;
  }
  const only = objects[0] as SceneObjectData;
  if (isImageObject(only)) {
    return false; // the original-quality PNG path owns single images
  }
  return plainTextOfObjects([only]) === null;
}

/**
 * Reads the theme colours the prose CSS needs (CSS variables resolve to
 * the ACTIVE theme — dark/light; same fallbacks as the export dialog).
 */
function readThemeColors(): { ink: string; border: string; muted: string } {
  if (typeof document === "undefined") {
    return { ink: "#1c1917", border: "#57534e", muted: "#a8a29e" };
  }
  const styles = getComputedStyle(document.documentElement);
  return {
    ink: styles.getPropertyValue("--foreground").trim() || "#1c1917",
    border: styles.getPropertyValue("--border").trim() || "#57534e",
    muted: styles.getPropertyValue("--muted-foreground").trim() || "#a8a29e",
  };
}

/**
 * Rasterises a pre-built subset scene into a transparent 2x PNG blob.
 *
 * @param subset - the scene view containing exactly the copied objects.
 * @returns the PNG blob, or null when the rasterisation cannot run (no
 *          DOM, empty subset, canvas/font failure — the caller degrades
 *          to the text-only clipboard write).
 */
export async function rasterizeSceneToPngBlob(
  subset: Scene,
): Promise<Blob | null> {
  if (typeof document === "undefined" || subset.objectCount === 0) {
    return null;
  }
  const theme = useUiStore.getState().theme;
  const palette: RenderPalette = {
    ...(theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE),
    opaqueLabel: t("object.opaque"),
    brokenImageLabel: t("image.broken"),
    frameUntitledLabel: t("object.frame"),
  };
  const themeColors = readThemeColors();
  try {
    return await exportToPng(subset, {
      region: { mode: "scene" },
      scale: SELECTION_RASTER_SCALE,
      // Transparent: the snapshot floats over Word pages / PowerPoint
      // slides instead of carrying a canvas-coloured rectangle.
      transparent: true,
      palette,
      themeInk: themeColors.ink,
      themeBorder: themeColors.border,
      themeMuted: themeColors.muted,
      padding: SELECTION_RASTER_PADDING,
      renderRichHtml: (doc) =>
        renderRichTextHTML(getSharedTextEditor().getSchema(), doc),
    });
  } catch {
    // Typed PngExportError or an unexpected rasterisation failure — the
    // copy flow degrades to the plain-text write instead of failing loud
    // (the copiedNotice for the INTERNAL buffer already fired).
    return null;
  }
}

/**
 * Convenience compose: snapshot the selection, then rasterise it. For CUT
 * flows call {@link buildSelectionSubsetScene} BEFORE the removal and feed
 * {@link rasterizeSceneToPngBlob} instead.
 *
 * @param scene - the live scene the selection lives in.
 * @param topLevelIds - the selection's top-level object ids.
 * @returns the PNG blob, or null (see {@link rasterizeSceneToPngBlob}).
 */
export async function rasterizeSelectionToPngBlob(
  scene: Scene,
  topLevelIds: readonly string[],
): Promise<Blob | null> {
  return rasterizeSceneToPngBlob(
    buildSelectionSubsetScene(scene, topLevelIds),
  );
}
