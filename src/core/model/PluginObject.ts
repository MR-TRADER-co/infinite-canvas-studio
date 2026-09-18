/**
 * Plugin object (R9.3/R9.9): a canvas widget owned by a plugin.
 *
 * The HOST owns the envelope (`kind: "plugin"`, `typeId`, geometry + the
 * verbatim `data` payload); the PLUGIN owns the payload semantics and
 * paints the widget through the PluginObjectLayer's sandboxed iframe
 * (`renderWidget(data)` → HTML, AC9.10: rendering is a snapshot — the
 * layer never executes plugin code to draw, the plugin itself is not even
 * pinged while the panel scrolls).
 *
 * Geometry follows the shape contract (`position` = top-left corner,
 * `width`/`height` in world units) so the shared manipulation machinery
 * (bbox, translate, resize, marquee, R-tree, hit-testing) covers plugin
 * widgets with zero extra code.
 *
 * When the owning plugin is disabled/uninstalled the typeId leaves the
 * ObjectRegistry and the file reload materialises the object as an
 * OpaqueObject placeholder (§1.7.4) — the payload is never lost.
 */
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Default plugin-widget footprint (world units). */
export const DEFAULT_PLUGIN_OBJECT_WIDTH = 160;

/** Default plugin-widget height (world units). */
export const DEFAULT_PLUGIN_OBJECT_HEIGHT = 120;

/** Data of a plugin-owned canvas widget. */
export interface PluginObjectData extends SceneObjectData {
  /** Discriminant: always `plugin`. */
  readonly kind: "plugin";
  /**
   * The owning plugin's registered wire type id
   * (`<pluginOwner>.<typeName>` — the ObjectRegistry key).
   */
  readonly typeId: string;
  /** Widget width in world units (≥ 0; `position` is the top-left corner). */
  readonly width: number;
  /** Widget height in world units (≥ 0). */
  readonly height: number;
  /**
   * The plugin's verbatim JSON payload. The host NEVER interprets it:
   * it round-trips exactly through save/load (the plugin's own
   * serialize/deserialize hooks own the semantics, §1.7.4).
   */
  readonly data: Record<string, unknown>;
}

/**
 * Type guard narrowing a generic scene object to its plugin variant.
 *
 * @param object - the object to test.
 * @returns whether `object` carries plugin-widget data.
 */
export function isPluginObject(
  object: SceneObjectData,
): object is PluginObjectData {
  return object.kind === "plugin";
}

/**
 * Builds a plugin widget instance from the plugin's factory payload.
 *
 * The host composes the envelope (id/zIndex/position/size) and keeps the
 * plugin payload verbatim inside `data`.
 *
 * @param id - the object id.
 * @param zIndex - the paint order slot.
 * @param typeId - the plugin's registered type id.
 * @param data - the plugin's factory payload (verbatim).
 * @param position - the top-left corner (default: origin).
 * @param size - the widget size (default: the catalog-declared size).
 * @returns the plugin object data.
 */
export function makePluginObject(
  id: string,
  zIndex: number,
  typeId: string,
  data: Record<string, unknown>,
  position: { x: number; y: number } = { x: 0, y: 0 },
  size: { width: number; height: number } = {
    width: DEFAULT_PLUGIN_OBJECT_WIDTH,
    height: DEFAULT_PLUGIN_OBJECT_HEIGHT,
  },
): PluginObjectData {
  return {
    kind: "plugin",
    id,
    typeId,
    position: { x: position.x, y: position.y },
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    width: Math.max(0, size.width),
    height: Math.max(0, size.height),
    data,
  };
}
