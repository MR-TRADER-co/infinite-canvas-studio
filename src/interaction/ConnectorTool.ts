/**
 * Connector tool: drag from an object to another object (or empty canvas)
 * to create a connector — OR use the click-click mode: tap an object (press
 * and release without dragging) to "arm" the start, then click another
 * object to finish. Both modes share the same rubber-band preview and the
 * same commit path (AddObjectCommand).
 *
 * Pointer down on an object glues the start endpoint to the object's
 * nearest anchor; every move resolves an end candidate — glued to the
 * hovered object's nearest anchor (highlighted by the preview) or floating
 * at the pointer — and streams the rubber-band draft into the
 * `ConnectorOverlay`. Release commits the connector through an
 * `AddObjectCommand` recorded in history; a release on the SAME object, a
 * sub-threshold drag, or Escape mid-drag cancels without touching history.
 * A sub-threshold release (a TAP) instead ARMS the start for click-click
 * mode: the draft keeps following the cursor until the next click — on a
 * different object it commits, on the same object or empty canvas (or
 * Escape / tool switch) it disarms.
 * A press on empty canvas starts nothing (connectors begin on objects).
 */
import type { ITool, ToolCursor, ToolPointerEvent } from "@/interaction/Tool";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { IdGenerator } from "@/core/id/IdGenerator";
import type { Scene } from "@/core/model/Scene";
import { objectBBox, type SceneObjectData } from "@/core/model/SceneObject";
import { nearestAnchor } from "@/core/model/Anchors";
import {
  connectorFromEndpoints,
  isConnectorObject,
  type ConnectorEndpoint,
  type ConnectorStyle,
} from "@/core/model/ConnectorObject";
import type {
  ConnectorDraft,
  ConnectorOverlay,
} from "@/rendering/ConnectorOverlay";
import { hitTestTopMost } from "@/interaction/objectHitTest";
import { snapPointIfEnabled, type SnapConfig } from "@/interaction/SnapEngine";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import type { Vec2 } from "@/core/geometry/Vec2";

/** Dependencies of the connector tool (constructor injection). */
export interface ConnectorToolDeps {
  /** Scene providing hit-testing and the committed objects. */
  readonly scene: Scene;
  /** History recording the commit command. */
  readonly history: HistoryManager;
  /** Id allocator for new connector objects (shared generator). */
  readonly ids: IdGenerator;
  /** Overlay holding the in-progress rubber-band draft. */
  readonly overlay: ConnectorOverlay;
  /** Resolves the connector style each time a connector is started. */
  readonly getConnectorStyle: () => ConnectorStyle;
  /** Optional snap configuration (R5.5 — floating endpoints land on the grid). */
  readonly getSnapConfig?: () => SnapConfig;
}

/** Screen-pixel drag length below which a release counts as a tap. */
const TAP_MIN_PX = 6;

/** Connector creation tool. */
export class ConnectorTool implements ITool {
  /** Unique tool id. */
  public readonly id = "connector";
  /** Cursor hint requested while active. */
  public readonly cursor: ToolCursor = "crosshair";

  /** Glued start endpoint of the running gesture, or null while idle. */
  private start: ConnectorEndpoint | null = null;

  /** Screen position where the gesture began (tap detection). */
  private startScreen: Vec2 | null = null;

  /**
   * Armed start endpoint for click-click mode: set by a TAP on an object,
   * consumed by the next click on a different object (or disarmed by
   * same-object/empty-canvas clicks, Escape, or a tool switch).
   */
  private armed: ConnectorEndpoint | null = null;

  /**
   * @param deps - injected tool dependencies.
   */
  public constructor(private readonly deps: ConnectorToolDeps) {}

  /** Called when the tool becomes active (drops any open draft). */
  public onActivate(): void {
    this.cancelDraft();
  }

  /** Called when the tool stops being active (drops any open draft). */
  public onDeactivate(): void {
    this.cancelDraft();
  }

  /**
   * Handles pointer press: glues the start endpoint to the pressed
   * object's nearest anchor. Presses on empty canvas or on a connector
   * start nothing.
   *
   * In click-click mode (an endpoint is armed) the press instead RESOLVES
   * the armed gesture: a different object commits the connector, the same
   * object or empty canvas disarms it.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerDown(event: ToolPointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    if (this.armed !== null) {
      const hit = hitTestTopMost(
        this.deps.scene,
        event.world,
        this.clickTolerance(),
      );
      if (
        hit !== null &&
        !isConnectorObject(hit) &&
        hit.id !== this.armed.objectId
      ) {
        // Click-click completion: commit armed → hit.
        const end = glueTo(hit, event.world);
        this.commit(this.armed, end);
      }
      // Any resolution ends the armed state (same object / empty canvas /
      // connector press = cancel).
      this.cancelDraft();
      return;
    }
    const hit = hitTestTopMost(
      this.deps.scene,
      event.world,
      this.clickTolerance(),
    );
    if (hit === null || isConnectorObject(hit)) {
      return;
    }
    const anchor = nearestAnchor(objectBBox(hit), event.world);
    this.start = {
      objectId: hit.id,
      anchorIndex: anchor.index,
      position: anchor.position,
    };
    this.startScreen = event.screen;
  }

  /**
   * Handles pointer move: resolves the end candidate (glued to the hovered
   * object or floating) and streams the rubber-band draft — both mid-drag
   * and while a click-click start is armed (the draft follows the cursor).
   *
   * @param event - normalised pointer payload.
   */
  public onPointerMove(event: ToolPointerEvent): void {
    if (this.start === null && this.armed === null) {
      return;
    }
    const draft: ConnectorDraft = {
      start: this.start ?? this.armed!,
      end: this.resolveEndCandidate(event.world),
      style: this.deps.getConnectorStyle(),
    };
    if (this.deps.overlay.current === null) {
      this.deps.overlay.begin(draft);
    } else {
      this.deps.overlay.update(draft);
    }
  }

  /**
   * Handles pointer release: a real drag commits the connector; a TAP on an
   * object ARMS the start for click-click mode (the draft keeps following
   * the cursor); releases on the start object and equal endpoints cancel.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerUp(event: ToolPointerEvent): void {
    const start = this.start;
    const startScreen = this.startScreen;
    if (start === null) {
      return;
    }
    this.start = null;
    this.startScreen = null;
    const end = this.resolveEndCandidate(event.world);
    const dragged =
      startScreen !== null &&
      Math.hypot(
        event.screen.x - startScreen.x,
        event.screen.y - startScreen.y,
      ) >= TAP_MIN_PX;
    if (!dragged) {
      // TAP: arm the start for click-click completion instead of silently
      // doing nothing (the draft follows the cursor until the next click).
      this.armed = start;
      return;
    }
    this.deps.overlay.end();
    if (
      end.objectId === start.objectId ||
      samePoint(start.position, end.position)
    ) {
      return;
    }
    this.commit(start, end);
  }

  /**
   * Commits a connector between two endpoints as one history step.
   *
   * @param start - the glued start endpoint.
   * @param end - the resolved end endpoint.
   */
  private commit(start: ConnectorEndpoint, end: ConnectorEndpoint): void {
    const connector = connectorFromEndpoints(
      start,
      end,
      this.deps.getConnectorStyle(),
      this.deps.ids.next(),
      this.deps.scene.nextZIndex(),
    );
    const command = new AddObjectCommand(this.deps.scene, connector);
    command.do();
    this.deps.history.push(command);
  }

  /**
   * Context-sensitive cursor refinement: a hovered object advertises that a
   * connection can start/end there ("pointer"); empty canvas keeps the
   * crosshair.
   *
   * @param event - the latest normalised pointer payload.
   * @returns a context cursor hint, or null for the static hint.
   */
  public hoverCursor(event: ToolPointerEvent): ToolCursor | null {
    const hit = hitTestTopMost(
      this.deps.scene,
      event.world,
      this.clickTolerance(),
    );
    return hit !== null && !isConnectorObject(hit) ? "pointer" : null;
  }

  /**
   * Escape mid-drag or while armed: drops the draft without committing.
   *
   * @returns whether a draft was cancelled.
   */
  public onCancel(): boolean {
    if (this.start === null && this.armed === null) {
      return false;
    }
    this.cancelDraft();
    return true;
  }

  /**
   * Resolves the end candidate at a world position: glued to the hovered
   * object's nearest anchor, or floating at the position.
   *
   * @param world - the pointer world position.
   * @returns the end endpoint candidate.
   */
  private resolveEndCandidate(world: Vec2): ConnectorEndpoint {
    const hit = hitTestTopMost(this.deps.scene, world, this.clickTolerance());
    if (hit !== null && !isConnectorObject(hit)) {
      const anchor = nearestAnchor(objectBBox(hit), world);
      return {
        objectId: hit.id,
        anchorIndex: anchor.index,
        position: anchor.position,
      };
    }
    // R5.5: free endpoints snap to the grid (glued ones ride anchors —
    // object-snapping is the Phase 7 smart-guides engine).
    return {
      objectId: null,
      anchorIndex: 0,
      position: snapPointIfEnabled(world, this.deps.getSnapConfig?.()),
    };
  }

  /**
   * Removes the overlay draft and resets gesture bookkeeping (both the
   * running drag and any armed click-click start).
   */
  private cancelDraft(): void {
    this.start = null;
    this.startScreen = null;
    this.armed = null;
    if (this.deps.overlay.current !== null) {
      this.deps.overlay.end();
    }
  }

  /**
   * @returns the world-space click tolerance at the current zoom.
   */
  private clickTolerance(): number {
    return 6 / Math.max(this.deps.scene.camera.zoom, 0.01);
  }
}

/**
 * @param a - first point.
 * @param b - second point.
 * @returns whether the two points coincide exactly.
 */
function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Glues an endpoint to the pressed object's nearest anchor.
 *
 * @param hit - the object being pressed.
 * @param world - the press position in world space.
 * @returns the glued endpoint.
 */
function glueTo(hit: SceneObjectData, world: Vec2): ConnectorEndpoint {
  const anchor = nearestAnchor(objectBBox(hit), world);
  return {
    objectId: hit.id,
    anchorIndex: anchor.index,
    position: anchor.position,
  };
}
