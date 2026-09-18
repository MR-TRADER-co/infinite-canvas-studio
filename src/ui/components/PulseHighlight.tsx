"use client";

/**
 * Fly-to-object host (R7.6/R7.7/R7.9): listens for `ui:fly-to-object`
 * events (search results, outline entries), animates the camera to the
 * object (300 ms eased flight via {@link CameraController.flyTo}) and
 * pulses a highlight ring around the object's screen rect for ~1.2 s.
 *
 * The pulse is a pure CSS-animated overlay div positioned at the object's
 * live screen frame — RTL-safe (coordinate space) and cheap (one element,
 * no per-frame JS after placement; the ring follows the object while the
 * pulse runs by re-rendering on camera:changed).
 */
import { useEffect, useState, type ReactElement } from "react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import type { CameraController } from "@/core/camera/CameraController";
import type { Scene } from "@/core/model/Scene";
import { objectBBox } from "@/core/model/SceneObject";
import { useTranslation } from "@/ui/i18n";

/** Pulse duration in milliseconds. */
const PULSE_MS = 1200;

/** The live pulse state. */
interface Pulse {
  readonly objectId: string;
  readonly until: number;
}

/**
 * @returns the fly-to host (renders nothing visible except the pulse).
 */
export default function PulseHighlight(): ReactElement | null {
  const { t } = useTranslation();
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [camera, setCamera] = useState<CameraController | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      const liveScene = context.get(Services.scene);
      const liveCamera = context.get(Services.cameraController);
      const bus = context.get(Services.eventBus);
      setScene(liveScene);
      setCamera(liveCamera);
      unsubscribers.push(
        bus.on("ui:fly-to-object", ({ objectId }) => {
          const object = liveScene.findById(objectId);
          if (object === undefined) {
            return;
          }
          // 300 ms eased flight onto the object's (rotation-covering) box.
          const canvas =
            typeof document !== "undefined"
              ? document.querySelector("canvas")
              : null;
          const size =
            canvas !== null
              ? { width: canvas.clientWidth, height: canvas.clientHeight }
              : { width: 800, height: 600 };
          liveCamera.flyTo(objectBBox(object), size, 300);
          setPulse({ objectId, until: Date.now() + PULSE_MS });
          setFrame((value) => value + 1);
        }),
        // While a pulse runs, follow camera/scene changes (the ring stays
        // glued to the object through the flight's frames).
        bus.on("camera:changed", () => {
          setFrame((value) => value + 1);
        }),
        bus.on("scene:changed", () => {
          setFrame((value) => value + 1);
        }),
      );
    });
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  // Expire the pulse.
  useEffect(() => {
    if (pulse === null) {
      return;
    }
    const timer = window.setTimeout(
      () => {
        setPulse(null);
      },
      Math.max(PULSE_MS, pulse.until - Date.now()),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [pulse]);

  if (pulse === null || camera === null || scene === null) {
    return null;
  }
  const object = scene.findById(pulse.objectId);
  if (object === undefined) {
    return null;
  }
  void frame;
  const box = objectBBox(object);
  const min = camera.camera.worldToScreen({ x: box.minX, y: box.minY });
  const max = camera.camera.worldToScreen({ x: box.maxX, y: box.maxY });
  const left = Math.min(min.x, max.x);
  const top = Math.min(min.y, max.y);
  const width = Math.max(Math.abs(max.x - min.x), 12);
  const height = Math.max(Math.abs(max.y - min.y), 12);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-20 rounded-lg border-2 border-primary"
      style={{ left, top, width, height }}
    >
      <span className="sr-only">{t("search.pulseLabel")}</span>
      <span className="absolute inset-0 animate-ping rounded-lg border border-primary/60" />
    </div>
  );
}
