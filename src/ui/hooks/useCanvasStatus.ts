"use client";

/**
 * Live canvas readouts for the status bar.
 *
 * Subscribes to the typed event bus (`camera:changed`, `scene:changed`,
 * `history:changed`, `pointer:moved`) and re-renders the consumer with the
 * current zoom, pointer world position, object count and undo/redo state.
 * Values are projections of domain state — the UI store stays untouched
 * (CLAUDE.md §1.2: Zustand never holds domain data).
 */
import { useEffect, useState } from "react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type { AppEventMap, EventBus } from "@/core/events/EventBus";

/** Save-state chip values derived from persistence events. */
export type SaveState = "idle" | "dirty" | "saved" | "failed";

/** Live status snapshot consumed by the status bar. */
export interface CanvasStatus {
  /** Current camera zoom (1 = 100%). */
  readonly zoom: number;
  /** Pointer position in world coordinates, or null before first move. */
  readonly pointer: { readonly x: number; readonly y: number } | null;
  /** Number of objects in the scene. */
  readonly objectCount: number;
  /** Number of currently selected objects (0 = nothing selected). */
  readonly selectionSize: number;
  /** Live object dimensions while a resize gesture runs, or null. */
  readonly resizeDims: {
    readonly width: number;
    readonly height: number;
  } | null;
  /** Whether a text object is currently being edited. */
  readonly editingText: boolean;
  /** Whether the history manager can undo. */
  readonly canUndo: boolean;
  /** Whether the history manager can redo. */
  readonly canRedo: boolean;
  /** Autosave state: idle → dirty (change) → saved | failed. */
  readonly saveState: SaveState;
  /** Epoch milliseconds of the last successful save, or null. */
  readonly lastSavedAt: number | null;
  /** Live rotation delta of the running rotation gesture, in degrees. */
  readonly rotationDeg: number | null;
  /** Undoes the most recent command. */
  readonly undo: () => void;
  /** Redoes the most recently undone command. */
  readonly redo: () => void;
  /** Saves the project now (Ctrl+S). */
  readonly saveNow: () => void;
}

/**
 * Subscribes to canvas events once the app booted and returns the live
 * status snapshot. Before boot, defaults are returned.
 *
 * @returns the current {@link CanvasStatus}.
 */
export function useCanvasStatus(): CanvasStatus {
  const [zoom, setZoom] = useState(1);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [objectCount, setObjectCount] = useState(0);
  const [selectionSize, setSelectionSize] = useState(0);
  const [resizeDims, setResizeDims] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [rotationDeg, setRotationDeg] = useState<number | null>(null);
  const [editingText, setEditingText] = useState(false);
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribers: Array<() => void> = [];
    let cancelled = false;

    const install = (bus: EventBus<AppEventMap>): void => {
      unsubscribers.push(
        bus.on("camera:changed", ({ zoom: value }) => setZoom(value)),
        bus.on("scene:changed", ({ objectCount: count }) =>
          setObjectCount(count),
        ),
        bus.on("selection:changed", ({ size }) => setSelectionSize(size)),
        bus.on("history:changed", ({ canUndo, canRedo }) =>
          setHistoryState({ canUndo, canRedo }),
        ),
        bus.on("pointer:moved", (payload) =>
          setPointer({ x: payload.x, y: payload.y }),
        ),
        bus.on("resize:live", (payload) =>
          setResizeDims({ width: payload.width, height: payload.height }),
        ),
        // Ended also carries the final size; the chip simply hides.
        bus.on("resize:ended", () => setResizeDims(null)),
        bus.on("rotate:live", ({ angle }) => setRotationDeg(angle)),
        bus.on("rotate:ended", () => setRotationDeg(null)),
        bus.on("text:edit-began", () => setEditingText(true)),
        bus.on("text:edit-ended", () => setEditingText(false)),
        // Autosave state machine: change → dirty, save → saved, error → failed.
        // (A restore emits scene:changed first, but project:restored right
        // after resets to idle in the same tick — no flash.)
        bus.on("scene:changed", () => setSaveState("dirty")),
        bus.on("persistence:saved", ({ timestamp }) => {
          setSaveState("saved");
          setLastSavedAt(timestamp);
        }),
        bus.on("persistence:save-failed", () => setSaveState("failed")),
        bus.on("project:restored", () => setSaveState("idle")),
      );
      // Seed from the live model: the boot-time project restore emits its
      // scene/camera events before this hook installs, so events alone
      // would leave stale zeros until the next mutation.
      seedFromServices();
    };

    /**
     * Reads the current domain state once (post-boot snapshot).
     */
    const seedFromServices = (): void => {
      const context = AppContext.getDefault();
      const scene = context.tryGet(Services.scene);
      const history = context.tryGet(Services.history);
      if (scene !== undefined) {
        setObjectCount(scene.objectCount);
        setZoom(scene.camera.zoom);
        setSelectionSize(scene.selection.size);
      }
      if (history !== undefined) {
        setHistoryState({
          canUndo: history.canUndo(),
          canRedo: history.canRedo(),
        });
      }
    };

    void Application.boot().then((context: AppContext) => {
      if (!cancelled) {
        install(context.get(Services.eventBus));
      }
    });

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  const undo = (): void => {
    AppContext.getDefault().tryGet(Services.history)?.undo();
  };
  const redo = (): void => {
    AppContext.getDefault().tryGet(Services.history)?.redo();
  };
  const saveNow = (): void => {
    void AppContext.getDefault().tryGet(Services.autosave)?.saveNow("manual");
  };

  return {
    zoom,
    pointer,
    objectCount,
    selectionSize,
    resizeDims,
    rotationDeg,
    editingText,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    saveState,
    lastSavedAt,
    undo,
    redo,
    saveNow,
  };
}
