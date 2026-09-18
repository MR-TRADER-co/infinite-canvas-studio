/**
 * Sticker-library insertion (R12.1 — «کتابخانه استیکر»): places an
 * ARBITRARY emoji glyph (one of the library's ~230, not just the eight
 * curated registry cards) as a sticker object with its bbox centre on
 * the target world point — the shared engine behind the Sticker Picker
 * dialog's click path.
 *
 * فاز ۳۲ «درج سنجاق‌شده»: the optional `pinnedAt` screen point creates
 * the sticker ALREADY PINNED — its screen footprint centred on the
 * release point, so a drag-out of the picker lands exactly under the
 * cursor and stays put while the camera moves (the فاز ۲۵–۳۰ pin
 * machinery: rendering ignores the world position while pinned and
 * unpinning recomputes it from the anchor, so the stored world point
 * is a best-effort snapshot of the drop point).
 *
 * Mirrors `interaction/CatalogInsert` exactly (one AddObjectCommand =
 * exactly one undo step, default square footprint, kind-aware
 * translation re-centring). Pure resolution logic — no React/DOM
 * imports, node-testable.
 */
import type { Scene } from "@/core/model/Scene";
import {
  makeStickerObject,
  STICKER_DEFAULT_SIZE,
} from "@/core/model/StickerObject";
import type { StickerObjectData } from "@/core/model/StickerObject";
import { objectBBox, translateSceneObject } from "@/core/model/SceneObject";
import {
  screenToPinAnchor,
  type PinAnchor,
  type ViewportSize,
} from "@/core/model/Pinned";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { IdGenerator } from "@/core/id/IdGenerator";

/** Options of a library sticker insertion (فاز ۳۲ + ۳۳). */
export interface StickerInsertOptions {
  /**
   * Insert the sticker PINNED, with its screen footprint CENTRED on this
   * canvas-relative point (CSS pixels). The anchor is derived so the
   * sticker appears exactly under the point and survives window resizes
   * (normalized fractions, `core/model/Pinned.ts`).
   */
  readonly pinnedAt?: {
    readonly point: Vec2;
    readonly viewport: ViewportSize;
  };
  /**
   * The sticker's square footprint in world px (فاز ۳۳ quick sizes).
   * Clamped to {@link STICKER_MIN_SIZE}..{@link STICKER_MAX_SIZE};
   * defaults to {@link STICKER_DEFAULT_SIZE} (the pre-فاز-۳۳ behaviour).
   */
  readonly size?: number;
}

/** The smallest insertable sticker footprint (فاز ۳۳ quick sizes). */
export const STICKER_MIN_SIZE = 24;

/** The largest insertable sticker footprint (فاز ۳۳ quick sizes). */
export const STICKER_MAX_SIZE = 320;

/**
 * The three quick-size presets offered by the picker footer (فاز ۳۳):
 * small markers, the classic default, and a statement-sized glyph. The
 * labels and chips are i18n'd in the dialog; the values stay here so
 * the insert engine owns the contract (node-testable).
 */
export const STICKER_SIZE_PRESETS: readonly number[] = [48, 96, 160];

/**
 * Clamps a requested sticker footprint into the legal insert range
 * (فاز ۳۳): non-finite and non-positive values fall back to the default
 * size rather than refusing the insert (a bad preset must never eat
 * the user's emoji).
 *
 * @param size - the requested footprint (world px).
 * @returns the clamped size.
 */
export function clampStickerSize(size: number | undefined): number {
  if (size === undefined || !Number.isFinite(size) || size <= 0) {
    return STICKER_DEFAULT_SIZE;
  }
  return Math.min(Math.max(size, STICKER_MIN_SIZE), STICKER_MAX_SIZE);
}

/**
 * Computes the pin anchor that centres a sticker of the given footprint
 * on a screen point (فاز ۳۲; فاز ۳۳ made the size a parameter): the
 * top-left anchor denoting a footprint whose centre is the point —
 * clamped to the viewport by the shared contract.
 *
 * @param point - the canvas-relative screen point (CSS pixels).
 * @param viewport - the viewport size in CSS pixels.
 * @param size - the sticker footprint (world px, already clamped).
 * @returns the normalized, clamped pin anchor.
 */
export function pinnedStickerAnchor(
  point: Vec2,
  viewport: ViewportSize,
  size: number = STICKER_DEFAULT_SIZE,
): PinAnchor {
  return screenToPinAnchor(
    vec2(point.x - size / 2, point.y - size / 2),
    viewport,
  );
}

/**
 * Inserts one library sticker with its bbox centre at the target point.
 *
 * @param scene - the scene receiving the sticker.
 * @param history - the history stack (one AddObjectCommand).
 * @param idGenerator - the app id generator (unique object ids).
 * @param emoji - the emoji glyph (validated: non-empty, bounded).
 * @param centre - the world point the sticker centres on.
 * @param options - insertion options (فاز ۳۲: `pinnedAt` screen insert).
 * @returns the created sticker, or null when the emoji is unusable.
 */
export function insertStickerObject(
  scene: Scene,
  history: HistoryManager,
  idGenerator: IdGenerator,
  emoji: string,
  centre: Vec2,
  options?: StickerInsertOptions,
): StickerObjectData | null {
  if (emoji.length === 0 || emoji.length > 12) {
    return null;
  }
  // فاز ۳۳: the quick-size preset threads through the same centring
  // math — the anchor math and the factory footprint share one value.
  const size = clampStickerSize(options?.size);
  const draft = makeStickerObject(
    idGenerator.next(),
    emoji,
    { x: centre.x - size / 2, y: centre.y - size / 2 },
    size,
  );
  const box = objectBBox(draft);
  const offsetX = centre.x - (box.minX + box.maxX) / 2;
  const offsetY = centre.y - (box.minY + box.maxY) / 2;
  const placed =
    offsetX === 0 && offsetY === 0
      ? draft
      : (translateSceneObject(draft, { x: offsetX, y: offsetY }) as StickerObjectData);
  // فاز ۳۲: the pinned path stamps the screen anchor alongside the world
  // snapshot — one object, one AddObjectCommand, still exactly one undo.
  const object =
    options?.pinnedAt !== undefined
      ? {
          ...placed,
          pinned: true,
          pinAnchor: pinnedStickerAnchor(
            options.pinnedAt.point,
            options.pinnedAt.viewport,
            size,
          ),
        }
      : placed;
  const command = new AddObjectCommand(scene, object);
  command.do();
  history.push(command);
  return object;
}
