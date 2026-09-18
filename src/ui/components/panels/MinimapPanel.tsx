"use client";

/**
 * Minimap panel body (R7.8): the bird's-eye overview — object footprints
 * as scaled boxes + the current viewport rectangle — registered as the
 * `core.panels.minimap` bottom dock panel.
 *
 * A canvas paints the scaled scene (content bbox fitted into the map);
 * dragging inside the minimap pans the camera (the world point under the
 * pointer stays anchored). Subscribes to scene + camera events; RTL-safe
 * by construction (the map is a coordinate space, not a text layout).
 *
 * فاز ۲۹ «هم‌ترازی سنجاش در نقشه و ارائه»: the map is now PIN-AWARE.
 * World content (visible, unpinned) fills the map and frames it; each
 * PINNED object paints as an amber quad at its LIVE effective world
 * position (the world quad under its screen footprint at the current
 * camera — `pinnedFootprintWorldQuad`), so the footprint rides the
 * viewport rectangle as the camera moves, telling the truth about the
 * object that follows the screen. The stale pre-pin world position never
 * reaches the map. When the scene has no world objects at all, the map
 * falls back to framing the current viewport so pins and the view stay
 * visible (previously the map collapsed to "—").
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type { Scene } from "@/core/model/Scene";
import type { CameraController } from "@/core/camera/CameraController";
import { isPinnedObject } from "@/core/model/Pinned";
import {
  minimapSceneFit,
  pinnedFootprintWorldQuad,
  MINIMAP_MAP_WIDTH,
  MINIMAP_MAP_HEIGHT,
  MINIMAP_PADDING_PX,
  type MinimapFit,
} from "@/core/minimap/Minimap";
import { rotatedObjectBBox } from "@/core/model/SceneObject";
import { useTranslation } from "@/ui/i18n";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";

/** Amber fill of a pinned footprint (the pin identity, فاز ۲۷ palette). */
const PIN_FOOTPRINT_FILL = "oklch(0.8 0.14 80 / 55%)";

/** Amber stroke of a pinned footprint at rest. */
const PIN_FOOTPRINT_STROKE = "oklch(0.8 0.14 80 / 90%)";

/** Viewport-rectangle fill (a translucent accent veil — فاز ۲۹ polish). */
const VIEWPORT_FILL = "oklch(0.58 0.19 340 / 14%)";

/**
 * @returns the minimap panel body.
 */
export default function MinimapPanelBody(): ReactElement {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [controller, setController] = useState<CameraController | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const stateRef = useRef<{
    controller: CameraController | null;
    scene: Scene | null;
  }>({ controller: null, scene: null });

  // Boot → subscribe to scene/camera events → repaint.
  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      const liveScene = context.get(Services.scene);
      const liveController = context.get(Services.cameraController);
      const bus = context.get(Services.eventBus);
      setScene(liveScene);
      setController(liveController);
      stateRef.current = { controller: liveController, scene: liveScene };
      const repaint = (): void => {
        drawMinimap(canvasRef.current, liveScene, liveController);
      };
      repaint();
      unsubscribers.push(
        bus.on("scene:changed", repaint),
        bus.on("camera:changed", repaint),
      );
    });
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  // Keep the map fresh on resize/mount too. فاز ۲۹: window resizes also
  // move pinned footprints (their anchor is a viewport fraction) and the
  // viewport-rectangle fallback frame — repaint on them as well.
  useEffect(() => {
    drawMinimap(canvasRef.current, scene, controller);
    if (scene === null || controller === null) {
      return;
    }
    const onResize = (): void => {
      drawMinimap(canvasRef.current, scene, controller);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [scene, controller]);

  /**
   * Converts a minimap pointer event to world coordinates and pans the
   * camera so the world point sits at the viewport centre.
   *
   * @param event - the pointer event over the minimap canvas.
   */
  const navigate = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    const liveScene = stateRef.current.scene;
    const liveController = stateRef.current.controller;
    if (canvas === null || liveScene === null || liveController === null) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const map: Vec2 = vec2(event.clientX - rect.left, event.clientY - rect.top);
    const fit = contentFit(liveScene, liveController, rect.width, rect.height);
    if (fit === null) {
      return;
    }
    const world = vec2(
      fit.minX + (map.x - MINIMAP_PADDING_PX) / fit.scale,
      fit.minY + (map.y - MINIMAP_PADDING_PX) / fit.scale,
    );
    // Centre the viewport on the world point (pan, keep zoom).
    const camera = liveController.camera;
    const canvasEl =
      typeof document !== "undefined" ? document.querySelector("canvas") : null;
    const size =
      canvasEl !== null
        ? vec2(canvasEl.clientWidth, canvasEl.clientHeight)
        : vec2(800, 600);
    const unrotated = rotatePoint(
      vec2(size.x / 2, size.y / 2),
      -camera.rotation,
    );
    camera.x = world.x - unrotated.x / camera.zoom;
    camera.y = world.y - unrotated.y / camera.zoom;
    // Drive the change through the controller's notifier contract.
    liveController.panByScreen(0, 0);
  };

  return (
    <div className="p-1.5">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t("minimap.title")}
        title={t("minimap.hint")}
        width={MINIMAP_MAP_WIDTH * 2}
        height={MINIMAP_MAP_HEIGHT * 2}
        style={{ width: MINIMAP_MAP_WIDTH, height: MINIMAP_MAP_HEIGHT }}
        className="block cursor-pointer touch-none rounded-lg border border-border/40 bg-background/60 shadow-inner"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          navigate(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            navigate(event);
          }
        }}
      />
    </div>
  );
}

/**
 * Resolves the live canvas viewport size (the pin coordinate space).
 *
 * @returns the main canvas' CSS size, or a sane fallback.
 */
function canvasViewport(): { width: number; height: number } {
  const canvasEl =
    typeof document !== "undefined" ? document.querySelector("canvas") : null;
  return {
    width: canvasEl !== null ? canvasEl.clientWidth : 800,
    height: canvasEl !== null ? canvasEl.clientHeight : 600,
  };
}

/**
 * Resolves the map's content fit (فاز ۲۹ pin-aware, view-aware): world
 * content ∪ the current viewport frames the map — the view rectangle and
 * the pinned quads riding it are never clipped off-map when the world
 * content sits far from the camera, and a scene with NO world objects
 * falls back to the viewport alone (so pins + the view stay visible).
 *
 * @param scene - the scene being mapped.
 * @param controller - the camera controller (the viewport transform).
 * @param width - map width in CSS pixels.
 * @param height - map height in CSS pixels.
 * @returns the fit, or null for a truly empty scene.
 */
function contentFit(
  scene: Scene,
  controller: CameraController,
  width: number,
  height: number,
): MinimapFit | null {
  return minimapSceneFit(scene, controller, canvasViewport(), width, height);
}

/**
 * Paints the minimap: world footprints, the pinned footprints at their
 * LIVE effective world positions (amber quads), and the viewport
 * rectangle (stroked + veiled fill).
 *
 * @param canvas - the minimap canvas.
 * @param scene - the live scene.
 * @param controller - the camera controller (viewport rectangle).
 */
function drawMinimap(
  canvas: HTMLCanvasElement | null,
  scene: Scene | null,
  controller: CameraController | null,
): void {
  if (canvas === null || scene === null || controller === null) {
    return;
  }
  const context = canvas.getContext("2d");
  if (context === null) {
    return;
  }
  const dpr = 2;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const dark = document.documentElement.classList.contains("dark");
  context.clearRect(0, 0, width, height);
  const camera = controller.camera;
  const viewport = canvasViewport();
  const fit = contentFit(scene, controller, width, height);
  if (fit === null) {
    // Truly empty scene: no world objects, no pinned objects — the map
    // has nothing to frame or show.
    context.fillStyle = dark ? "oklch(0.35 0 0 / 60%)" : "oklch(0.7 0 0 / 60%)";
    context.font = "11px Vazirmatn, ui-sans-serif, system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("—", width / 2, height / 2);
    return;
  }
  const toMap = (point: Vec2): Vec2 =>
    vec2(
      MINIMAP_PADDING_PX + (point.x - fit.minX) * fit.scale,
      MINIMAP_PADDING_PX + (point.y - fit.minY) * fit.scale,
    );

  // World footprints (فاز ۲۹: pinned objects are NOT world content —
  // their stale pre-pin position must never fill the map).
  const fill = dark
    ? "oklch(0.72 0.14 340 / 45%)"
    : "oklch(0.55 0.19 340 / 40%)";
  for (const object of scene.objects) {
    if (!object.visible || isPinnedObject(object)) {
      continue;
    }
    const box = rotatedObjectBBox(object);
    const min = toMap(vec2(box.minX, box.minY));
    const max = toMap(vec2(box.maxX, box.maxY));
    context.fillStyle =
      object.kind === "opaque" ? "oklch(0.6 0 0 / 30%)" : fill;
    context.fillRect(
      Math.min(min.x, max.x),
      Math.min(min.y, max.y),
      Math.max(Math.abs(max.x - min.x), 1.5),
      Math.max(Math.abs(max.y - min.y), 1.5),
    );
  }

  // Pinned footprints at their LIVE effective world positions (فاز ۲۹):
  // the world quad under the screen footprint at the CURRENT camera —
  // the footprint travels with the viewport rectangle, mirroring the
  // real screen behaviour (the object follows the view).
  for (const object of scene.objects) {
    if (!object.visible || !isPinnedObject(object)) {
      continue;
    }
    const quad = pinnedFootprintWorldQuad(object, camera, viewport);
    if (quad === null) {
      continue;
    }
    const mapQuad = quad.map(toMap);
    context.beginPath();
    mapQuad.forEach((corner, index) => {
      if (index === 0) {
        context.moveTo(corner.x, corner.y);
      } else {
        context.lineTo(corner.x, corner.y);
      }
    });
    context.closePath();
    context.fillStyle = PIN_FOOTPRINT_FILL;
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = PIN_FOOTPRINT_STROKE;
    context.stroke();
  }

  // Viewport rectangle: the world rect shown at the current framing —
  // veiled fill first (legibility on crowded maps, فاز ۲۹ polish),
  // then the stroke on top.
  const viewW = viewport.width;
  const viewH = viewport.height;
  const corners: Vec2[] = [
    camera.screenToWorld(vec2(0, 0)),
    camera.screenToWorld(vec2(viewW, 0)),
    camera.screenToWorld(vec2(viewW, viewH)),
    camera.screenToWorld(vec2(0, viewH)),
  ];
  const mapCorners = corners.map(toMap);
  const path = (): void => {
    context.beginPath();
    mapCorners.forEach((corner, index) => {
      if (index === 0) {
        context.moveTo(corner.x, corner.y);
      } else {
        context.lineTo(corner.x, corner.y);
      }
    });
    context.closePath();
  };
  path();
  context.fillStyle = VIEWPORT_FILL;
  context.fill();
  path();
  context.strokeStyle = dark ? "oklch(0.9 0.1 340)" : "oklch(0.45 0.2 340)";
  context.lineWidth = 1.5;
  context.stroke();
}

/**
 * Rotates a point around the origin.
 *
 * @param point - the point.
 * @param angle - radians.
 * @returns the rotated point.
 */
function rotatePoint(point: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return vec2(point.x * cos - point.y * sin, point.x * sin + point.y * cos);
}
