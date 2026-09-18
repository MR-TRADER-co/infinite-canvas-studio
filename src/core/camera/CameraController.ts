/**
 * Translates user input intents (pan/zoom/rotate) into camera updates.
 *
 * Keeping the controller separate from the `Camera` state keeps the state
 * serialisable and the intent logic independently testable. Every mutation
 * invokes the injected `onChange` notifier (composition-root wiring) so
 * render loop and readouts can react without polling.
 *
 * Zoom is clamped to [`MIN_ZOOM`, `MAX_ZOOM`]; `zoomAt` keeps the world
 * point under the given screen anchor stationary (the standard "zoom to
 * cursor" behaviour), also under rotation.
 */
import type { Camera } from "@/core/camera/Camera";
import { vec2 } from "@/core/geometry/Vec2";
import type { Vec2 } from "@/core/geometry/Vec2";
import type { BBox } from "@/core/geometry/BBox";

/** Lowest zoom the controller will allow (2%). */
export const MIN_ZOOM = 0.02;

/** Highest zoom the controller will allow (6400%). */
export const MAX_ZOOM = 64;

/** Intent-driven controller owning exactly one camera. */
export class CameraController {
  /** Notifier invoked after every applied mutation. */
  private readonly notifyChange: (() => void) | undefined;

  /** Handle of the running camera-flight animation (null when idle). */
  private flight: number | null = null;

  /**
   * @param camera - the camera this controller mutates.
   * @param onChange - optional notifier invoked after each mutation.
   */
  public constructor(camera: Camera, onChange?: () => void) {
    this.camera = camera;
    this.notifyChange = onChange;
  }

  /** The camera this controller owns. */
  public readonly camera: Camera;

  /**
   * Pans the camera by a world-space delta.
   *
   * @param delta - pan offset applied to the camera anchor (content moves by
   * `-delta`).
   */
  public panBy(delta: Vec2): void {
    this.cancelFlight();
    this.camera.x -= delta.x;
    this.camera.y -= delta.y;
    this.changed();
  }

  /**
   * Pans by a screen-space delta (e.g. a drag of `(dx, dy)` CSS pixels or a
   * wheel scroll amount), compensating for zoom and rotation.
   *
   * @param dx - horizontal screen delta (positive drags content right).
   * @param dy - vertical screen delta (positive drags content down).
   */
  public panByScreen(dx: number, dy: number): void {
    this.cancelFlight();
    const world = this.screenDeltaToWorld(dx, dy);
    this.camera.x -= world.x;
    this.camera.y -= world.y;
    this.changed();
  }

  /**
   * Zooms around a fixed screen point so that point stays stationary
   * ("zoom to cursor"). No-op when clamped or the factor is not positive.
   *
   * @param screenPoint - screen-space anchor of the zoom gesture.
   * @param factor - multiplicative zoom factor (>1 zooms in).
   */
  public zoomAt(screenPoint: Vec2, factor: number): void {
    this.cancelFlight();
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) {
      return;
    }
    const nextZoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, this.camera.zoom * factor),
    );
    if (nextZoom === this.camera.zoom) {
      return;
    }
    const worldUnder = this.camera.screenToWorld(screenPoint);
    this.camera.zoom = nextZoom;
    // Keep `worldUnder` under `screenPoint` at the new zoom: the anchor is
    // the world point minus the (unrotated, zoom-scaled) screen offset.
    const unrotated = rotate(screenPoint, -this.camera.rotation);
    this.camera.x = worldUnder.x - unrotated.x / nextZoom;
    this.camera.y = worldUnder.y - unrotated.y / nextZoom;
    this.changed();
  }

  /**
   * Rotates the viewport by a delta.
   *
   * @param deltaRadians - rotation offset in radians.
   */
  public rotateBy(deltaRadians: number): void {
    this.cancelFlight();
    this.camera.rotation += deltaRadians;
    this.changed();
  }

  /** Resets the camera to its default framing (origin, 100%, no rotation). */
  public reset(): void {
    this.cancelFlight();
    this.camera.x = 0;
    this.camera.y = 0;
    this.camera.zoom = 1;
    this.camera.rotation = 0;
    this.changed();
  }

  /**
   * Frames the given world-space box so it fills the viewport (with
   * padding), keeping the current rotation. Degenerate boxes (empty or
   * non-finite) reset the framing instead of dividing by zero. The chosen
   * zoom is clamped to [`MIN_ZOOM`, `MAX_ZOOM`].
   *
   * @param box - the world-space content bounds to frame.
   * @param viewport - viewport size in CSS pixels.
   * @param padding - fraction of the viewport kept empty on EACH side
   * (0–0.5, default 0.1 = 10% per side / 20% total margin).
   */
  public fitToBBox(
    box: BBox,
    viewport: { width: number; height: number },
    padding = 0.1,
  ): void {
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      viewport.width <= 0 ||
      viewport.height <= 0
    ) {
      this.reset();
      return;
    }
    const margin = Math.min(Math.max(padding, 0), 0.5);
    // Content extents rotated into the viewport's screen-aligned axes: the
    // axis-aligned world box occupies this (larger-or-equal) rect on screen
    // when the viewport is rotated.
    const corners = [
      rotate(vec2(box.minX, box.minY), this.camera.rotation),
      rotate(vec2(box.maxX, box.minY), this.camera.rotation),
      rotate(vec2(box.minX, box.maxY), this.camera.rotation),
      rotate(vec2(box.maxX, box.maxY), this.camera.rotation),
    ];
    const rotatedWidth =
      Math.max(...corners.map((c) => c.x)) -
      Math.min(...corners.map((c) => c.x));
    const rotatedHeight =
      Math.max(...corners.map((c) => c.y)) -
      Math.min(...corners.map((c) => c.y));
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Math.min(
          (viewport.width * (1 - 2 * margin)) / rotatedWidth,
          (viewport.height * (1 - 2 * margin)) / rotatedHeight,
        ),
      ),
    );
    this.camera.zoom = zoom;
    // Anchor so the box centre lands exactly at the viewport centre:
    // screen = zoom * rotate(p - anchor) ⇒ anchor = c - rotate⁻¹(center/zoom).
    const center = vec2((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
    const unrotated = rotate(
      vec2(viewport.width / 2, viewport.height / 2),
      -this.camera.rotation,
    );
    this.camera.x = center.x - unrotated.x / zoom;
    this.camera.y = center.y - unrotated.y / zoom;
    this.changed();
  }

  /** Invokes the change notifier after an applied mutation. */
  private changed(): void {
    this.notifyChange?.();
  }

  /**
   * Animates the camera to frame the given world box (R3B.8 navigation):
   * a 300 ms eased flight (cubic ease-out) interpolating x/y/zoom from the
   * current framing to the `fitToBBox` framing, notifying per frame. The
   * flight is cancelled by any user-driven camera intent (pan/zoom/rotate/
   * reset) and by the next {@link flyTo}.
   *
   * Node/test environments without `requestAnimationFrame` fall back to an
   * instant snap (the same end framing, zero frames).
   *
   * @param box - the world-space content bounds to frame.
   * @param viewport - viewport size in CSS pixels.
   * @param durationMs - flight duration in milliseconds (default 300).
   */
  public flyTo(
    box: BBox,
    viewport: { width: number; height: number },
    durationMs = 300,
  ): void {
    this.cancelFlight();
    const startX = this.camera.x;
    const startY = this.camera.y;
    const startZoom = this.camera.zoom;
    // Target framing: compute WITHOUT applying (fitToBBox mutates), so the
    // flight interpolates from the live start to this snapshot.
    const target = this.computeFit(box, viewport);
    if (target === null) {
      this.reset();
      return;
    }
    if (durationMs <= 0 || startZoom === target.zoom) {
      this.applyFit(target);
      return;
    }
    const raf: typeof requestAnimationFrame | undefined =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : undefined;
    if (raf === undefined) {
      this.applyFit(target);
      return;
    }
    const startedAt = performance.now();
    const tick = (): void => {
      const progress = Math.min(
        1,
        (performance.now() - startedAt) / durationMs,
      );
      const eased = 1 - Math.pow(1 - progress, 3);
      this.camera.x = startX + (target.x - startX) * eased;
      this.camera.y = startY + (target.y - startY) * eased;
      this.camera.zoom = startZoom * Math.pow(target.zoom / startZoom, eased);
      this.changed();
      if (progress < 1) {
        this.flight = raf(tick);
      } else {
        this.flight = null;
      }
    };
    this.flight = raf(tick);
  }

  /**
   * Animates the camera to an absolute framing (R7.9 bookmark flights):
   * a 300 ms eased flight interpolating x/y/zoom/rotation from the live
   * state to the target — the same easing family as {@link flyTo},
   * cancelled by any user camera intent.
   *
   * @param target - the absolute camera state to fly to.
   * @param durationMs - flight duration in milliseconds (default 300).
   */
  public flyToCamera(
    target: { x: number; y: number; zoom: number; rotation: number },
    durationMs = 300,
  ): void {
    this.cancelFlight();
    const startX = this.camera.x;
    const startY = this.camera.y;
    const startZoom = this.camera.zoom;
    const startRotation = this.camera.rotation;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, target.zoom));
    if (
      durationMs <= 0 ||
      (startX === target.x &&
        startY === target.y &&
        startZoom === zoom &&
        startRotation === target.rotation)
    ) {
      this.applyFit({
        x: target.x,
        y: target.y,
        zoom,
        // applyFit only sets x/y/zoom; rotation is applied manually below.
        ...{},
      });
      this.camera.rotation = target.rotation;
      this.changed();
      return;
    }
    const raf: typeof requestAnimationFrame | undefined =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : undefined;
    if (raf === undefined) {
      this.applyFit({ x: target.x, y: target.y, zoom });
      this.camera.rotation = target.rotation;
      this.changed();
      return;
    }
    const startedAt = performance.now();
    // Shortest angular path for the rotation interpolation.
    let rotationDelta = target.rotation - startRotation;
    rotationDelta = Math.atan2(
      Math.sin(rotationDelta),
      Math.cos(rotationDelta),
    );
    const tick = (): void => {
      const progress = Math.min(
        1,
        (performance.now() - startedAt) / durationMs,
      );
      const eased = 1 - Math.pow(1 - progress, 3);
      this.camera.x = startX + (target.x - startX) * eased;
      this.camera.y = startY + (target.y - startY) * eased;
      this.camera.zoom = startZoom * Math.pow(zoom / startZoom, eased);
      this.camera.rotation = startRotation + rotationDelta * eased;
      this.changed();
      if (progress < 1) {
        this.flight = raf(tick);
      } else {
        this.flight = null;
      }
    };
    this.flight = raf(tick);
  }

  /** Cancels the running flight animation (user took over the camera). */
  private cancelFlight(): void {
    if (this.flight !== null) {
      cancelAnimationFrame(this.flight);
      this.flight = null;
    }
  }

  /**
   * Computes the `fitToBBox` framing without applying it.
   *
   * @param box - the world-space content bounds.
   * @param viewport - viewport size in CSS pixels.
   * @returns the target camera anchor/zoom, or null for degenerate boxes.
   */
  private computeFit(
    box: BBox,
    viewport: { width: number; height: number },
  ): { x: number; y: number; zoom: number } | null {
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      viewport.width <= 0 ||
      viewport.height <= 0
    ) {
      return null;
    }
    const margin = 0.1;
    const corners = [
      rotate(vec2(box.minX, box.minY), this.camera.rotation),
      rotate(vec2(box.maxX, box.minY), this.camera.rotation),
      rotate(vec2(box.minX, box.maxY), this.camera.rotation),
      rotate(vec2(box.maxX, box.maxY), this.camera.rotation),
    ];
    const rotatedWidth =
      Math.max(...corners.map((c) => c.x)) -
      Math.min(...corners.map((c) => c.x));
    const rotatedHeight =
      Math.max(...corners.map((c) => c.y)) -
      Math.min(...corners.map((c) => c.y));
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Math.min(
          (viewport.width * (1 - 2 * margin)) / rotatedWidth,
          (viewport.height * (1 - 2 * margin)) / rotatedHeight,
        ),
      ),
    );
    const center = vec2((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
    const unrotated = rotate(
      vec2(viewport.width / 2, viewport.height / 2),
      -this.camera.rotation,
    );
    return {
      x: center.x - unrotated.x / zoom,
      y: center.y - unrotated.y / zoom,
      zoom,
    };
  }

  /**
   * Applies a precomputed framing snapshot instantly.
   *
   * @param fit - the target anchor/zoom.
   */
  private applyFit(fit: { x: number; y: number; zoom: number }): void {
    this.camera.x = fit.x;
    this.camera.y = fit.y;
    this.camera.zoom = fit.zoom;
    this.changed();
  }

  /**
   * Converts a screen-space delta into a world-space delta.
   *
   * @param dx - horizontal screen delta.
   * @param dy - vertical screen delta.
   * @returns the equivalent world-space delta.
   */
  private screenDeltaToWorld(dx: number, dy: number): Vec2 {
    const unrotated = rotate(vec2(dx, dy), -this.camera.rotation);
    return vec2(unrotated.x / this.camera.zoom, unrotated.y / this.camera.zoom);
  }
}

/**
 * Rotates a point around the origin by `angle` radians.
 *
 * @param point - the point to rotate.
 * @param angle - rotation angle in radians.
 * @returns the rotated point.
 */
function rotate(point: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return vec2(point.x * cos - point.y * sin, point.x * sin + point.y * cos);
}
