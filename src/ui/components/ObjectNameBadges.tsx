"use client";

/**
 * Object name badges: floating chips that show a named object's `name`
 * OUTSIDE its frame, anchored to the top-right corner above the object
 * (sticky notes, tables and pasted/dropped images — the NameBadge policy).
 *
 * A pure DOM overlay layer above everything else on the canvas (z-[15] —
 * above the z-[5] text layer, below the floating toolbars): badges must
 * never be occluded by neighbouring cards, which is exactly why they are
 * NOT painted on the canvas 2D layer underneath the DOM text views.
 *
 * Rendering is camera-driven: `scene:changed`/`camera:changed` bus events
 * schedule ONE rAF-coalesced pass that reads the live model imperatively
 * (mutable scene/camera, CLAUDE.md §1.2/§1.3), projects every badge and
 * commits the result as state — 60fps pans update the chips without ever
 * reconciling more than once per frame, and the render itself stays a
 * pure function of that snapshot. Chips live in screen space (constant
 * text size, upright regardless of object/camera rotation), fade out at
 * very low zoom, and cull against the viewport.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import { hasNameBadge } from "@/core/model/NameBadge";
import {
  rotatedObjectBBox,
  type SceneObjectData,
} from "@/core/model/SceneObject";
import type { Camera } from "@/core/camera/Camera";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";
import { cn } from "@/lib/utils";

/** Zoom below which badges are fully hidden (screen clutter guard). */
const BADGE_FADE_OUT_ZOOM = 0.4;

/** Zoom at/above which badges are fully opaque. */
const BADGE_FADE_IN_ZOOM = 0.6;

/** One badge's placement data (screen space, CSS pixels). */
interface BadgePlacement {
  /** The object's id (React key). */
  readonly id: string;
  /** The object's display name. */
  readonly name: string;
  /** Screen x of the object's covering-box RIGHT edge. */
  readonly right: number;
  /** Screen y of the object's covering-box TOP edge. */
  readonly top: number;
}

/** One committed badge pass (positions + shared zoom fade). */
interface BadgeFrame {
  /** Placements in paint order. */
  readonly placements: readonly BadgePlacement[];
  /** 0..1 zoom fade multiplier. */
  readonly zoomFade: number;
}

/** Empty pass (boot, no names, or below the fade-out zoom). */
const EMPTY_FRAME: BadgeFrame = { placements: [], zoomFade: 1 };

/**
 * @returns the name-badge overlay (chips above the top-right corner of
 *          every named sticky note / table / image).
 */
export default function ObjectNameBadges(): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<BadgeFrame>(EMPTY_FRAME);

  // Bus-driven, rAF-coalesced invalidation: one projection per frame at
  // most, however many scene/camera events fired inside it. The pass
  // itself reads the mutable model + the container rect imperatively
  // (allowed here — a callback, not render) and commits one snapshot.
  useEffect(() => {
    let frameId: number | null = null;
    const disposers: Array<() => void> = [];
    let cancelled = false;

    const run = (): void => {
      frameId = null;
      const container = containerRef.current;
      const scene = AppContext.getDefault().tryGet(Services.scene);
      if (container === null || scene === undefined) {
        return;
      }
      const camera = scene.camera;
      const zoomFade = Math.min(
        1,
        Math.max(
          0,
          (camera.zoom - BADGE_FADE_OUT_ZOOM) /
            (BADGE_FADE_IN_ZOOM - BADGE_FADE_OUT_ZOOM),
        ),
      );
      if (zoomFade <= 0) {
        setFrame(EMPTY_FRAME);
        return;
      }
      setFrame({
        placements: projectBadges(
          scene.objects,
          camera,
          container.getBoundingClientRect(),
        ),
        zoomFade,
      });
    };

    const schedule = (): void => {
      if (frameId === null) {
        frameId = requestAnimationFrame(run);
      }
    };

    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      const bus = context.get(Services.eventBus);
      disposers.push(
        bus.on("scene:changed", schedule),
        bus.on("camera:changed", schedule),
      );
      schedule();
    });

    return () => {
      cancelled = true;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      for (const dispose of disposers) {
        dispose();
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[15] overflow-hidden"
    >
      {frame.placements.map((badge) => (
        <div
          key={badge.id}
          className="absolute h-0 w-0"
          style={{ left: `${badge.right}px`, top: `${badge.top}px` }}
        >
          <span
            dir="auto"
            title={badge.name}
            style={{ opacity: frame.zoomFade }}
            className={cn(
              "absolute bottom-full right-0 mb-1.5 block max-w-[240px] truncate rounded-lg",
              "border border-border/70 bg-popover/95 px-2 py-0.5 text-[11px] font-medium",
              "leading-5 text-popover-foreground whitespace-nowrap shadow-lg shadow-black/20",
              "backdrop-blur-sm transition-opacity duration-150",
            )}
          >
            {badge.name}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Projects the named, badge-qualified, visible objects into screen space.
 *
 * Each badge anchors to the top-right of the object's COVERING box (object
 * rotation folded in via {@link rotatedObjectBBox}, then the camera
 * transform), so tilted objects still get a sensible outside-the-frame
 * anchor while the chip itself stays upright in screen space.
 *
 * @param objects - every scene object in paint order.
 * @param camera - the live viewport transform.
 * @param viewport - the overlay container's screen rect (culling bounds).
 * @returns the badge placements (React keys are the object ids).
 */
function projectBadges(
  objects: readonly SceneObjectData[],
  camera: Camera,
  viewport: DOMRect,
): readonly BadgePlacement[] {
  const placements: BadgePlacement[] = [];
  for (const object of objects) {
    if (!object.visible || !hasNameBadge(object)) {
      continue;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const corner of cornersOf(rotatedObjectBBox(object))) {
      const screen = camera.worldToScreen(corner);
      minX = Math.min(minX, screen.x);
      minY = Math.min(minY, screen.y);
      maxX = Math.max(maxX, screen.x);
      maxY = Math.max(maxY, screen.y);
    }
    const margin = 64;
    if (
      maxX < viewport.left - margin ||
      minX > viewport.right + margin ||
      maxY < viewport.top - margin ||
      minY > viewport.bottom + margin
    ) {
      continue;
    }
    const name = object.name;
    if (name === undefined) {
      continue;
    }
    placements.push({ id: object.id, name, right: maxX, top: minY });
  }
  return placements;
}

/**
 * @param box - the world-space covering box.
 * @returns the four box corners.
 */
function cornersOf(box: {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}): readonly Vec2[] {
  return [
    vec2(box.minX, box.minY),
    vec2(box.maxX, box.minY),
    vec2(box.maxX, box.maxY),
    vec2(box.minX, box.maxY),
  ];
}
