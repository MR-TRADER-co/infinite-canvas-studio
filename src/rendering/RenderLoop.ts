/**
 * The single `requestAnimationFrame` render loop (CLAUDE.md §1.3).
 *
 * Frames are drawn only while dirty: producers (camera controller, scene
 * mutations, stroke overlay, pointer input) call {@link RenderLoop.markDirty}
 * and the next animation frame repaints exactly once. The scene model stays
 * the single source of truth; the loop owns no domain state.
 */
import type { Canvas2DRenderer } from "@/rendering/Canvas2DRenderer";
import type { StrokeOverlay } from "@/rendering/StrokeOverlay";
import type { ShapeOverlay } from "@/rendering/ShapeOverlay";
import type { ConnectorOverlay } from "@/rendering/ConnectorOverlay";
import type { GuidesOverlay } from "@/rendering/GuidesOverlay";
import type { Camera } from "@/core/camera/Camera";
import type { Scene } from "@/core/model/Scene";

/**
 * A DOM layer synced by the same frame as the canvas (CLAUDE.md §1.3: one
 * rAF loop drives both layers from one dirty flag). Structural interface —
 * the text layer implements it without any module dependency.
 */
export interface RenderCompanion {
  /** Syncs the companion layer for the current frame. */
  sync(scene: Scene, camera: Camera): void;
}

/** Dirty-flag driven animation-frame loop over the canvas renderer. */
export class RenderLoop {
  /** The renderer drawing each frame. */
  private readonly renderer: Canvas2DRenderer;

  /** The scene model to render. */
  private readonly scene: Scene;

  /** The viewport camera to render with. */
  private readonly camera: Camera;

  /** Transient drafts drawn above the scene. */
  private readonly overlay: StrokeOverlay;

  /** Transient shape draft drawn above the scene. */
  private readonly shapeOverlay: ShapeOverlay | null;

  /** Transient connector rubber-band drawn above the scene. */
  private readonly connectorOverlay: ConnectorOverlay | null;

  /** Optional DOM layers synced in the same frame (text + plugins). */
  private readonly companions: RenderCompanion[] = [];

  /** Transient smart-guide overlay (R7.4). */
  private readonly guidesOverlay: GuidesOverlay | null;

  /** Scheduled frame id (null when idle). */
  private frameId: number | null = null;

  /** Whether the loop is started (stop() latches until start() again). */
  private stopped = true;

  /**
   * @param renderer - the renderer drawing each frame.
   * @param scene - the scene model to render.
   * @param camera - the viewport camera to render with.
   * @param overlay - transient stroke drafts.
   * @param shapeOverlay - transient shape draft (optional).
   * @param companion - DOM layer synced by the same frame (optional).
   * @param connectorOverlay - transient connector draft (optional).
   * @param guidesOverlay - transient smart guides (optional, R7.4).
   */
  public constructor(
    renderer: Canvas2DRenderer,
    scene: Scene,
    camera: Camera,
    overlay: StrokeOverlay,
    shapeOverlay?: ShapeOverlay,
    companion?: RenderCompanion,
    connectorOverlay?: ConnectorOverlay,
    guidesOverlay?: GuidesOverlay,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.overlay = overlay;
    this.shapeOverlay = shapeOverlay ?? null;
    if (companion !== undefined) {
      this.companions.push(companion);
    }
    this.connectorOverlay = connectorOverlay ?? null;
    this.guidesOverlay = guidesOverlay ?? null;
  }

  /**
   * Adds a DOM layer synced by the same frame (R9.9: the plugin object
   * layer rides the one-rAF contract).
   *
   * @param companion - the layer to add.
   */
  public addCompanion(companion: RenderCompanion): void {
    if (!this.companions.includes(companion)) {
      this.companions.push(companion);
    }
  }

  /** @returns whether the loop is currently running (loop started). */
  public get running(): boolean {
    return this.frameId !== null;
  }

  /** Starts the loop by scheduling the first frame. */
  public start(): void {
    this.stopped = false;
    this.schedule();
  }

  /** Stops the loop and cancels any pending frame. */
  public stop(): void {
    this.stopped = true;
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  /** Marks the frame dirty; the next animation frame repaints once. */
  public markDirty(): void {
    this.schedule();
  }

  /** Schedules a frame when none is pending and the loop is started. */
  private schedule(): void {
    if (this.frameId === null && !this.stopped) {
      this.frameId = requestAnimationFrame(() => {
        this.frameId = null;
        this.renderer.render(this.scene, this.camera);
        this.renderer.renderDrafts(this.overlay.current, this.camera);
        if (this.shapeOverlay !== null) {
          this.renderer.renderShapeDraft(
            this.shapeOverlay.current,
            this.camera,
          );
        }
        if (this.connectorOverlay !== null) {
          this.renderer.renderConnectorDraft(
            this.connectorOverlay.current,
            this.camera,
            this.scene,
          );
        }
        if (this.guidesOverlay !== null) {
          this.renderer.renderGuides(this.guidesOverlay.current, this.camera);
        }
        for (const companion of this.companions) {
          companion.sync(this.scene, this.camera);
        }
      });
    }
  }
}
