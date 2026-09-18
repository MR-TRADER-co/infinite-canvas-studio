/**
 * The development-only QA introspection hook (فاز ۳۳).
 *
 * Attaches a read-only `window.__qa` surface exposing the live scene,
 * camera and selection state for E2E/QA rounds — the missing debugging
 * seam that forced earlier rounds to read state through the status bar,
 * canvas pixel scans and the autosave JSON (all fragile; the فاز-۳۳ QA
 * round burned most of its budget on exactly that gap).
 *
 * CONTRACT (deliberately tiny + read-only):
 * - `__qa.version()` — the phase banner + version strings.
 * - `__qa.sceneSummary()` — object/revision/pinned/selection counts.
 * - `__qa.objects()` — one compact record per scene object.
 * - `__qa.camera()` — the live camera (x/y/zoom/rotation).
 * - `__qa.selection()` — the selected object ids.
 *
 * Never attached in production builds, never mutates state, never
 * throws (each read is guarded — a half-booted app still answers).
 */
import type { Scene } from "@/core/model/Scene";
import type { Selection } from "@/core/selection/Selection";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { isPinnedObject } from "@/core/model/Pinned";

/** One compact object record exposed by `__qa.objects()`. */
export interface QaObjectRecord {
  readonly id: string;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly pinned: boolean;
  readonly visible: boolean;
  readonly locked: boolean;
}

/** The `window.__qa` surface (see the module doc). */
export interface QaHook {
  readonly version: () => { phase: string; version: string };
  readonly sceneSummary: () => {
    objectCount: number;
    revision: number;
    pinnedCount: number;
    selectionSize: number;
  };
  readonly objects: () => QaObjectRecord[];
  readonly camera: () => {
    x: number;
    y: number;
    zoom: number;
    rotation: number;
  };
  readonly selection: () => string[];
}

/**
 * Reads a sized field defensively (unsized kinds answer null — the hook
 * never throws on exotic object shapes).
 *
 * @param object - the scene object.
 * @param field - the sized field name.
 * @returns the number, or null.
 */
function sizedField(
  object: SceneObjectData,
  field: "width" | "height",
): number | null {
  const value = (object as Partial<Record<"width" | "height", number>>)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Attaches the hook to a global holder (idempotent; a no-op on the
 * server and when a hook is already present — the StrictMode
 * double-mount must not shadow the first instance). The holder
 * defaults to `window`; tests inject a plain object.
 *
 * @param deps - the live scene + selection + the version readers and
 *               the optional holder.
 */
export function attachQaHook(deps: {
  readonly scene: Scene;
  readonly selection: Selection;
  readonly phase: () => string;
  readonly version: () => string;
  readonly holder?: { __qa?: QaHook };
}): void {
  const holder = deps.holder ?? (globalThis as { __qa?: QaHook });
  if (typeof globalThis.window === "undefined" && deps.holder === undefined) {
    return;
  }
  if (holder.__qa !== undefined) {
    return;
  }
  holder.__qa = {
    version: () => ({ phase: deps.phase(), version: deps.version() }),
    sceneSummary: () => ({
      objectCount: deps.scene.objectCount,
      revision: deps.scene.revision,
      pinnedCount: deps.scene.objects.filter(isPinnedObject).length,
      selectionSize: deps.selection.size,
    }),
    objects: () =>
      deps.scene.objects.map((object) => ({
        id: object.id,
        kind: object.kind,
        x: object.position.x,
        y: object.position.y,
        width: sizedField(object, "width"),
        height: sizedField(object, "height"),
        pinned: isPinnedObject(object),
        visible: object.visible,
        locked: object.locked,
      })),
    camera: () => ({
      x: deps.scene.camera.x,
      y: deps.scene.camera.y,
      zoom: deps.scene.camera.zoom,
      rotation: deps.scene.camera.rotation,
    }),
    selection: () => [...deps.selection.ids],
  };
}
