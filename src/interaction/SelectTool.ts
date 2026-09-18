/**
 * Select tool: click-select, drag-move, marquee multi-select, handle-drag
 * resizing and rotation-handle spinning.
 *
 * Gesture state machine:
 * - `press`   — pointer down on an object (selection already updated);
 *              crossing the drag threshold promotes to `move`.
 * - `move`    — live translation of the selection; per-frame deltas are
 *              applied through `MoveCommand.do()` and folded by the
 *              `Coalescer`, so one drag = one undo entry. Shift constrains
 *              the displacement to the dominant axis; Alt at press turns
 *              the drag into a duplicate-and-move (copies move, originals
 *              stay — one composite undo entry).
 * - `resize`  — pointer down on a resize handle of a single selection; the
 *              `ResizeGesture` applies live frames and records one
 *              `ResizeCommand` on release (Shift locks the aspect ratio;
 *              rotated objects resize in their local frame).
 * - `rotate`  — pointer down on the rotation handle; the `RotateGesture`
 *              spins the object (or a group with its members) around the
 *              bounds centre. Shift snaps to 15° steps; one undo entry.
 * - `reconnect` — pointer down on a connector endpoint dot re-glues it.
 * - `marquee` — pointer down on empty canvas drags a selection rectangle
 *              (`MarqueeLogic`); release selects every substantially
 *              intersecting object.
 *
 * Shift modifies the gestures: shift-click toggles membership, a
 * shift-marquee adds to the selection, shift-resize keeps the aspect ratio.
 * Clicking a grouped child selects the enclosing GROUP (top-level
 * resolution); group drags move/delete/duplicate carry the members.
 * `hoverCursor` refines the pointer feedback per gesture state without
 * leaking DOM access into the tool.
 */
import type { ITool, ToolCursor, ToolPointerEvent } from "@/interaction/Tool";
import type { ICommand } from "@/core/commands/Command";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { Selection } from "@/core/selection/Selection";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import type { IdGenerator } from "@/core/id/IdGenerator";
import { Coalescer } from "@/core/commands/Coalescer";
import { MoveCommand } from "@/core/commands/MoveCommand";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import { CompositeCommand } from "@/core/commands/CompositeCommand";
import { duplicateObjectDeep } from "@/core/commands/SelectionOps";
import { MarqueeLogic } from "@/interaction/MarqueeLogic";
import { snapBoxDisplacement, type SnapConfig } from "@/interaction/SnapEngine";
import {
  RESIZE_HANDLE_CURSOR,
  ResizeGesture,
} from "@/interaction/ResizeGesture";
import { RotateGesture } from "@/interaction/RotateGesture";
import { PinResizeGesture } from "@/interaction/PinResizeGesture";
import { PinRotateGesture } from "@/interaction/PinRotateGesture";
import type { ResizeHandleId } from "@/core/geometry/resize";
import { hitRotateHandle } from "@/core/geometry/resize";
import { hitTestTopMost, hitTestPinned } from "@/interaction/objectHitTest";
import {
  isTextBoxObject,
  defaultTextBoxRect,
} from "@/core/model/TextBoxObject";
import { isStickyNoteObject } from "@/core/model/StickyNoteObject";
import { isVideoObject } from "@/core/model/VideoObject";
import { isAudioObject } from "@/core/model/AudioObject";
import { isPdfObject } from "@/core/model/PdfObject";
import {
  isConnectorObject,
  resolveConnectorEndpoints,
  type ConnectorEndpoint,
  type ConnectorObjectData,
} from "@/core/model/ConnectorObject";
import {
  expandGroupMemberIds,
  isGroupObject,
  resolveTopLevelId,
  worldBBoxOf,
} from "@/core/model/GroupObject";
import { isFreehandObject } from "@/core/model/FreehandObject";
import { nearestAnchor } from "@/core/model/Anchors";
import { objectBBox } from "@/core/model/SceneObject";
import {
  isPinnedObject,
  pinAnchorToScreen,
  screenToPinAnchor,
  type ViewportSize,
} from "@/core/model/Pinned";
import type { HandlesRenderer } from "@/rendering/HandlesRenderer";
import type { GuidesOverlay } from "@/rendering/GuidesOverlay";
import type { SceneSpatialIndex } from "@/core/spatial/SceneSpatialIndex";
import {
  collectReferenceBoxes,
  computeSmartSnap,
} from "@/interaction/SmartGuides";
import type { Vec2 } from "@/core/geometry/Vec2";
import { vec2 } from "@/core/geometry/Vec2";
import type { BBox } from "@/core/geometry/BBox";

/** Dependencies of the select tool (constructor injection). */
export interface SelectToolDeps {
  /** Scene providing objects, camera and selection. */
  readonly scene: Scene;
  /** History recording the finished gestures. */
  readonly history: HistoryManager;
  /** Selection being manipulated. */
  readonly selection: Selection;
  /** Coalescer folding per-frame move deltas into one command. */
  readonly coalescer: Coalescer;
  /** Marquee rectangle state machine. */
  readonly marquee: MarqueeLogic;
  /** Handles renderer carrying the live marquee rectangle. */
  readonly handles: HandlesRenderer;
  /** Bus carrying the live resize/rotate dimension events. */
  readonly bus: EventBus<AppEventMap>;
  /** Resolves the font size for double-click text creations. */
  readonly getFontSize: () => number;
  /** Allocates ids for Alt+drag duplication. */
  readonly ids: IdGenerator;
  /** Optional snap configuration (R5.5 — drag snaps to the grid). */
  readonly getSnapConfig?: () => SnapConfig;
  /** Optional smart-guide overlay (R7.4 — guides drawn while dragging). */
  readonly guides?: GuidesOverlay;
  /** Optional R-tree broad phase (R7.10 — hit-test acceleration). */
  readonly spatialIndex?: SceneSpatialIndex;
  /**
   * Viewport size in CSS pixels (فاز ۲۵ — the pin-anchor coordinate
   * space). Optional: without it, pinned objects are not interactive
   * (rendering still works — the layer owns its own viewport).
   */
  readonly getViewport?: () => ViewportSize;
}

/** Screen-pixel movement before a press turns into a move drag. */
const DRAG_THRESHOLD_PX = 3;

/** Screen-pixel tolerance for clicking near an object. */
const CLICK_TOLERANCE_PX = 6;

/** Screen-pixel tolerance for grabbing a connector endpoint dot. */
const ENDPOINT_TOLERANCE_PX = 11;

/**
 * Smart-guide snap radius in SCREEN pixels (R7.4: 6px screen space).
 * Converted to world units per frame via the camera zoom.
 */
const SMART_GUIDE_PX = 6;

/** Gesture phase of the select tool. */
type SelectPhase =
  | "idle"
  | "press"
  | "move"
  | "resize"
  | "rotate"
  | "reconnect"
  | "marquee"
  | "pin-press"
  | "pin-move"
  | "pin-resize"
  | "pin-rotate";

/** Running screen-pin drag gesture state (فاز ۲۵). */
interface PinDragGesture {
  /** Id of the pinned object being dragged. */
  readonly objectId: string;
  /** Full object snapshot captured before the gesture (undo source). */
  readonly before: SceneObjectData;
  /** Anchor (screen px) where the drag began. */
  readonly anchorAtDown: Vec2;
}

/** Running connector re-glue gesture state. */
interface ReconnectGesture {
  /** Id of the connector being edited. */
  readonly connectorId: string;
  /** Which endpoint is being dragged. */
  readonly endpoint: "start" | "end";
  /** Full connector snapshot captured before the gesture (undo source). */
  readonly before: ConnectorObjectData;
}

/** Alt+drag duplication bookkeeping of an in-progress move gesture. */
interface DuplicateDrag {
  /** Add commands of the copies (already executed, pending history). */
  readonly commands: readonly AddObjectCommand[];
  /** The selection ids before duplication (Escape restore source). */
  readonly originalIds: readonly string[];
}

/** Default pointer tool for selecting, moving and resizing objects. */
export class SelectTool implements ITool {
  /** Unique tool id. */
  public readonly id = "select";
  /** Cursor hint requested while active. */
  public readonly cursor: ToolCursor = "default";

  /** Gesture phase. */
  private phase: SelectPhase = "idle";

  /** World-space point where the gesture began. */
  private gestureStart: Vec2 | null = null;

  /** Screen-space point where the gesture began. */
  private startScreen: Vec2 | null = null;

  /** World position of the previous move frame (delta source). */
  private lastWorld: Vec2 | null = null;

  /** Displacement already applied by the move (Shift axis-lock source). */
  private appliedDisplacement: Vec2 = vec2(0, 0);

  /** Selection bounds captured at drag start (R5.5 grid-snap source). */
  private moveStartBounds: BBox | null = null;

  /** Object pressed in the `press` phase (top-level hit at pointer-down). */
  private pressedId: string | null = null;

  /** Whether Shift was held when the gesture began. */
  private shiftAtDown = false;

  /** Whether Alt was held when the gesture began (duplicate-and-move). */
  private altAtDown = false;

  /** Alt+drag duplication state, or null while no duplicate drag runs. */
  private duplicates: DuplicateDrag | null = null;

  /** Handle-drag resize gesture owned by this tool. */
  private readonly resize: ResizeGesture;

  /** Pinned handle-drag resize gesture owned by this tool (فاز ۲۷). */
  private readonly pinResize: PinResizeGesture;

  /** Pinned rotation-handle gesture owned by this tool (فاز ۳۰). */
  private readonly pinRotate: PinRotateGesture;

  /** Rotation-handle gesture owned by this tool. */
  private readonly rotate: RotateGesture;

  /** Running connector re-glue gesture, or null. */
  private reconnect: ReconnectGesture | null = null;

  /** Running screen-pin drag gesture, or null (فاز ۲۵). */
  private pinDrag: PinDragGesture | null = null;

  /**
   * @param deps - injected tool dependencies.
   */
  public constructor(private readonly deps: SelectToolDeps) {
    this.resize = new ResizeGesture({
      scene: deps.scene,
      history: deps.history,
      bus: deps.bus,
      handles: deps.handles,
      getSnapConfig: deps.getSnapConfig,
    });
    this.pinResize = new PinResizeGesture({
      scene: deps.scene,
      history: deps.history,
      bus: deps.bus,
      handles: deps.handles,
      getViewport: () => this.viewport(),
    });
    this.pinRotate = new PinRotateGesture({
      scene: deps.scene,
      history: deps.history,
      bus: deps.bus,
      handles: deps.handles,
      getViewport: () => this.viewport(),
    });
    this.rotate = new RotateGesture({
      scene: deps.scene,
      history: deps.history,
      bus: deps.bus,
      handles: deps.handles,
    });
  }

  /** Called when the tool becomes active (cancels any open gesture). */
  public onActivate(): void {
    this.cancelGesture();
  }

  /** Called when the tool stops being active (finishes any open gesture). */
  public onDeactivate(): void {
    // Live gestures end here (e.g. Space-pan mid-drag): the applied state
    // stays in the scene, so it must enter history too.
    if (this.phase === "move") {
      this.commitMove();
    } else if (this.phase === "pin-move") {
      this.commitPinMove();
    } else if (this.phase === "resize") {
      this.resize.commit();
      this.resetGestureState();
    } else if (this.phase === "pin-resize") {
      this.pinResize.commit();
      this.resetGestureState();
    } else if (this.phase === "pin-rotate") {
      this.pinRotate.commit();
      this.resetGestureState();
    } else if (this.phase === "rotate") {
      this.rotate.commit();
      this.resetGestureState();
    } else if (this.phase === "reconnect") {
      this.commitReconnect();
    } else {
      this.cancelGesture();
    }
  }

  /**
   * Handles pointer press: connector endpoints re-glue, a resize handle of
   * the single selection opens a resize gesture, the rotation handle opens a
   * rotate gesture, otherwise the top-most hit object selects (or an empty
   * canvas opens a marquee).
   *
   * @param event - normalised pointer payload.
   */
  public onPointerDown(event: ToolPointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    this.shiftAtDown = event.shiftKey;
    this.altAtDown = event.altKey;
    this.gestureStart = event.world;
    this.startScreen = event.screen;

    // فاز ۲۷: a resize handle of the single selected PINNED object opens a
    // screen-space resize gesture — BEFORE the pinned body probe (the
    // handles sit inside the body footprint, the `probeResizeHandle`
    // precedence mirrored in screen space).
    const pinResizeHandle = this.probePinResizeHandle(event);
    if (pinResizeHandle !== null) {
      this.pinResize.begin(pinResizeHandle.object, pinResizeHandle.handle);
      this.phase = "pin-resize";
      return;
    }

    // فاز ۳۰: the rotation grip of the single selected PINNED object opens
    // a screen-space rotation gesture — after the resize handles (the
    // `probeResizeHandle` precedence), before the pinned body probe (the
    // grip sits outside the body footprint, but the explicit order keeps
    // the world contract mirrored).
    const pinRotateHit = this.probePinRotateHandle(event);
    if (pinRotateHit !== null) {
      this.pinRotate.begin(pinRotateHit, event.screen);
      this.phase = "pin-rotate";
      return;
    }

    // فاز ۲۵: a PINNED object resolves in screen space first — pinned
    // singles show no WORLD resize/rotate handles (no phantom world
    // anchors); their screen-space handles opened the gesture above.
    const pinnedHit = this.probePinned(event);
    if (pinnedHit !== null) {
      this.pressedId = pinnedHit.id;
      if (event.shiftKey) {
        this.deps.selection.toggle(pinnedHit.id);
      } else if (!this.deps.selection.has(pinnedHit.id)) {
        this.deps.selection.replaceAll([pinnedHit.id]);
      }
      this.phase = "pin-press";
      this.pinDrag = {
        objectId: pinnedHit.id,
        before: pinnedHit,
        anchorAtDown: pinnedHit.pinAnchor
          ? pinAnchorToScreen(pinnedHit.pinAnchor, this.viewport())
          : event.screen,
      };
      return;
    }

    // A connector endpoint dot of the single selection opens a re-glue
    // gesture (before the resize handles — connectors have none).
    const reconnectTarget = this.probeConnectorEndpoint(event);
    if (reconnectTarget !== null) {
      this.reconnect = {
        connectorId: reconnectTarget.connector.id,
        endpoint: reconnectTarget.endpoint,
        before: reconnectTarget.connector,
      };
      this.phase = "reconnect";
      this.deps.handles.setActiveEndpoint(reconnectTarget.endpoint);
      return;
    }

    const resizeHandle = this.probeResizeHandle(event);
    if (resizeHandle !== null) {
      this.resize.begin(resizeHandle.object, resizeHandle.handle);
      this.phase = "resize";
      return;
    }

    if (this.probeRotateHandle(event)) {
      this.beginRotate();
      this.phase = "rotate";
      return;
    }

    const hit = hitTestTopMost(
      this.deps.scene,
      event.world,
      this.clickTolerance(),
      this.deps.spatialIndex,
    );
    if (hit !== null) {
      // Clicking a grouped child selects the enclosing group (top-level
      // resolution — the Figma contract).
      const topId = resolveTopLevelId(this.deps.scene, hit.id);
      this.pressedId = topId;
      if (event.shiftKey) {
        this.deps.selection.toggle(topId);
      } else if (!this.deps.selection.has(topId)) {
        this.deps.selection.replaceAll([topId]);
      }
      this.phase = "press";
      return;
    }

    if (!event.shiftKey) {
      this.deps.selection.clear();
    }
    this.phase = "marquee";
    this.deps.marquee.begin(event.world);
    this.deps.handles.setMarquee(this.deps.marquee.rect);
  }

  /**
   * Handles pointer move: drags, rotates, resizes or extends the marquee.
   *
   * @param event - normalised pointer payload.
   */
  public onPointerMove(event: ToolPointerEvent): void {
    if (this.phase === "pin-press") {
      const start = this.startScreen ?? event.screen;
      const distance = Math.hypot(
        event.screen.x - start.x,
        event.screen.y - start.y,
      );
      if (distance < DRAG_THRESHOLD_PX) {
        return;
      }
      this.phase = "pin-move";
    }

    if (this.phase === "pin-move") {
      this.applyPinMoveFrame(event);
      return;
    }

    if (this.phase === "pin-resize") {
      this.pinResize.moveTo(event);
      return;
    }

    if (this.phase === "pin-rotate") {
      this.pinRotate.moveTo(event);
      return;
    }

    if (this.phase === "press") {
      const start = this.startScreen ?? event.screen;
      const distance = Math.hypot(
        event.screen.x - start.x,
        event.screen.y - start.y,
      );
      if (distance < DRAG_THRESHOLD_PX) {
        return;
      }
      if (this.deps.selection.isEmpty()) {
        // Nothing selected to drag: keep the press idle (no marquee — the
        // gesture began on an object).
        this.phase = "idle";
        return;
      }
      if (this.altAtDown) {
        this.beginDuplicateDrag();
      }
      this.phase = "move";
      this.lastWorld = this.gestureStart ?? event.world;
      this.appliedDisplacement = vec2(0, 0);
      this.moveStartBounds = this.selectionBounds();
    }

    if (this.phase === "move") {
      this.applyMoveFrame(event);
      return;
    }

    if (this.phase === "resize") {
      this.resize.moveTo(event);
      return;
    }

    if (this.phase === "rotate") {
      this.rotate.moveTo(event);
      return;
    }

    if (this.phase === "reconnect") {
      this.applyReconnectFrame(event.world);
      return;
    }

    if (this.phase === "marquee") {
      this.deps.marquee.update(event.world);
      this.deps.handles.setMarquee(this.deps.marquee.rect);
    }
  }

  /**
   * Handles pointer release: finishes the gesture.
   *
   * @param event - normalised pointer payload (the marquee rectangle grows
   *   to the release position before resolving the selection).
   */
  public onPointerUp(event: ToolPointerEvent): void {
    if (this.phase === "pin-press") {
      // Plain click on a pinned object: collapse a multi-selection to it
      // (the familiar editors' behaviour, mirrored from the press phase).
      const pressed = this.pressedId;
      if (
        pressed !== null &&
        !this.shiftAtDown &&
        this.deps.selection.size > 1 &&
        this.deps.selection.has(pressed)
      ) {
        this.deps.selection.replaceAll([pressed]);
      }
      this.resetGestureState();
      return;
    }

    if (this.phase === "pin-move") {
      this.commitPinMove();
      return;
    }

    if (this.phase === "pin-resize") {
      this.pinResize.commit();
      this.resetGestureState();
      return;
    }

    if (this.phase === "pin-rotate") {
      this.pinRotate.commit();
      this.resetGestureState();
      return;
    }

    if (this.phase === "press") {
      // Plain click (no drag): collapse a multi-selection to the pressed
      // object, mirroring the familiar editors' behaviour.
      const pressed = this.pressedId;
      if (
        pressed !== null &&
        !this.shiftAtDown &&
        this.deps.selection.size > 1 &&
        this.deps.selection.has(pressed)
      ) {
        this.deps.selection.replaceAll([pressed]);
      }
      this.resetGestureState();
      return;
    }

    if (this.phase === "move") {
      this.commitMove();
      return;
    }

    if (this.phase === "resize") {
      this.resize.commit();
      this.resetGestureState();
      return;
    }

    if (this.phase === "rotate") {
      this.rotate.commit();
      this.resetGestureState();
      return;
    }

    if (this.phase === "reconnect") {
      this.applyReconnectFrame(event.world);
      this.commitReconnect();
      return;
    }

    if (this.phase === "marquee") {
      // Fast releases can jump between the last move sample and the release
      // position — grow the rectangle to the release position first so the
      // selection covers what the user saw under the cursor at release.
      this.deps.marquee.update(event.world);
      const ids = this.deps.marquee.end();
      this.deps.handles.setMarquee(null);
      const topLevel = [
        ...new Set(ids.map((id) => resolveTopLevelId(this.deps.scene, id))),
      ];
      if (this.shiftAtDown) {
        this.deps.selection.addMany(topLevel);
      } else {
        this.deps.selection.replaceAll(topLevel);
      }
      this.resetGestureState();
    }
  }

  /**
   * Context-sensitive cursor refinement (evaluated by the host after every
   * pointer move): the active resize handle, a hovered handle, the rotation
   * affordance, a move drag or a marquee drag.
   *
   * @param event - the latest normalised pointer payload.
   * @returns a context cursor hint, or null for the static hint.
   */
  public hoverCursor(event: ToolPointerEvent): ToolCursor | null {
    if (this.phase === "resize") {
      return this.resize.cursorHint;
    }
    if (this.phase === "pin-resize") {
      return this.pinResize.cursorHint;
    }
    if (this.phase === "pin-rotate") {
      return this.pinRotate.cursorHint;
    }
    if (this.phase === "rotate") {
      return this.rotate.cursorHint;
    }
    if (this.phase === "move") {
      return "move";
    }
    if (this.phase === "pin-move") {
      return "move";
    }
    if (this.phase === "reconnect") {
      return "pointer";
    }
    if (this.phase === "marquee") {
      return "crosshair";
    }
    if (this.phase === "idle") {
      const pinHandle = this.probePinResizeHandle(event);
      if (pinHandle !== null) {
        return pinHandle.cursor;
      }
      if (this.probePinRotateHandle(event) !== null) {
        return "grab";
      }
      if (this.probePinned(event) !== null) {
        return "move";
      }
      if (this.probeConnectorEndpoint(event) !== null) {
        return "pointer";
      }
      if (this.probeRotateHandle(event)) {
        return "grab";
      }
      const probed = this.probeResizeHandle(event);
      return probed === null ? null : probed.cursor;
    }
    return null;
  }

  /**
   * Escape hook: an in-progress resize/rotate is dropped without touching
   * history (the objects restore to their pre-gesture snapshots); an
   * Alt+drag duplication is reverted entirely.
   *
   * @returns whether the tool consumed the cancel.
   */
  public onCancel(): boolean {
    if (this.phase === "pin-resize") {
      this.pinResize.cancel();
      this.resetGestureState();
      return true;
    }
    if (this.phase === "pin-rotate") {
      this.pinRotate.cancel();
      this.resetGestureState();
      return true;
    }
    if (this.phase === "pin-move") {
      // Restore the pre-gesture snapshot without touching history.
      const gesture = this.pinDrag;
      if (gesture !== null) {
        this.deps.scene.add(gesture.before);
      }
      this.resetGestureState();
      return true;
    }
    if (this.phase === "reconnect") {
      // Restore the pre-gesture snapshot without touching history.
      const gesture = this.reconnect;
      if (gesture !== null) {
        this.deps.scene.add(gesture.before);
      }
      this.deps.handles.setActiveEndpoint(null);
      this.resetGestureState();
      return true;
    }
    if (this.phase === "resize") {
      this.resize.cancel();
      this.resetGestureState();
      return true;
    }
    if (this.phase === "rotate") {
      this.rotate.cancel();
      this.resetGestureState();
      return true;
    }
    if (this.phase === "move" && this.duplicates !== null) {
      this.cancelGesture();
      return true;
    }
    return false;
  }

  /**
   * Double-click hook: a text-bearing hit (text box or sticky note)
   * requests editing it; a connector hit requests editing its midpoint
   * label (R5.3 — the label editor is a plain input, not TipTap); an empty
   * spot requests creating a fresh text box (Excalidraw-style). All intents
   * are expressed on the bus — the feature owners handle the actual flow.
   *
   * @param event - normalised pointer payload of the final click.
   */
  public onDoubleClick(event: ToolPointerEvent): void {
    // فاز ۲۵: a pinned text-bearing object edits in place (screen-space
    // resolution first — its world footprint is camera-stale).
    const pinnedHit = this.probePinned(event);
    if (pinnedHit !== null) {
      if (isTextBoxObject(pinnedHit) || isStickyNoteObject(pinnedHit)) {
        this.deps.bus.emit("text:edit-requested", { objectId: pinnedHit.id });
      }
      // فاز M2 (A.2.7): double-click opens the floating player — a
      // PINNED video plays too (the window is screen-space anyway).
      if (isVideoObject(pinnedHit)) {
        this.deps.bus.emit("ui:video-play-requested", {
          objectId: pinnedHit.id,
        });
      }
      // فاز A2 note: a pinned audio clip opens the mini-player too (the
      // window is screen-space — pinned or not, the play request fires).
      if (isAudioObject(pinnedHit)) {
        this.deps.bus.emit("ui:audio-play-requested", {
          objectId: pinnedHit.id,
        });
      }
      // فاز P2 (A.2.7): a pinned PDF opens the viewer too (the window
      // is screen-space — pinned or not, the view request fires).
      if (isPdfObject(pinnedHit)) {
        this.deps.bus.emit("ui:pdf-view-requested", {
          objectId: pinnedHit.id,
        });
      }
      return;
    }
    const hit = hitTestTopMost(
      this.deps.scene,
      event.world,
      this.clickTolerance(),
      this.deps.spatialIndex,
    );
    if (hit !== null && isConnectorObject(hit)) {
      this.deps.bus.emit("ui:connector-label-requested", { objectId: hit.id });
      return;
    }
    // فاز M2 (A.2.3/A.2.7): double-click on a VIDEO thumbnail opens the
    // floating player (a clean double-click only — a drag moves/rotates
    // the object and never reaches here).
    if (hit !== null && isVideoObject(hit)) {
      this.deps.bus.emit("ui:video-play-requested", { objectId: hit.id });
      return;
    }
    // فاز A1→A2: double-click on an AUDIO thumbnail opens the floating
    // mini-player (a clean double-click only — a drag moves/rotates the
    // object and never reaches here; ONE instance across both players).
    if (hit !== null && isAudioObject(hit)) {
      this.deps.bus.emit("ui:audio-play-requested", { objectId: hit.id });
      return;
    }
    // فاز P1→P2: double-click on a PDF thumbnail opens the floating
    // viewer at its `currentPage` (a clean double-click only — a drag
    // moves/rotates the object and NEVER opens the viewer, ACP2.9;
    // ONE instance across all players, A.2.3).
    if (hit !== null && isPdfObject(hit)) {
      this.deps.bus.emit("ui:pdf-view-requested", { objectId: hit.id });
      return;
    }
    if (hit !== null && (isTextBoxObject(hit) || isStickyNoteObject(hit))) {
      this.deps.bus.emit("text:edit-requested", { objectId: hit.id });
      return;
    }
    const rect = defaultTextBoxRect(event.world);
    this.deps.bus.emit("text:create-requested", {
      x: rect.minX,
      y: rect.minY,
      width: rect.maxX - rect.minX,
      height: rect.maxY - rect.minY,
      fontSize: this.deps.getFontSize(),
      // Double-click on empty canvas creates a label-style AUTO box (R3A.7).
      sizeMode: "auto",
    });
  }

  /**
   * Starts the rotate gesture for the current single selection: a plain
   * object spins alone around its bounds centre; a group spins TOGETHER
   * with its members around the group's union centre (AC2.5).
   */
  private beginRotate(): void {
    const single = this.singleSelectedObject();
    if (single === null) {
      return;
    }
    const members = isGroupObject(single)
      ? [
          single,
          ...single.childIds
            .map((childId) => this.deps.scene.findById(childId))
            .filter((child): child is SceneObjectData => child !== undefined),
        ]
      : [single];
    const bounds = worldBBoxOf(this.deps.scene, single);
    const pivot = vec2(
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minY + bounds.maxY) / 2,
    );
    this.rotate.begin(members, pivot, this.gestureStart ?? pivot);
  }

  /**
   * Turns a press into a duplicate-and-move (Alt+drag): the selection is
   * copied in place (fresh ids, same paint-order tail), the copies become
   * the selection, and the move frames that follow drag the copies.
   */
  private beginDuplicateDrag(): void {
    const originalIds = [...this.deps.selection.ids];
    const expanded = expandGroupMemberIds(this.deps.scene, originalIds);
    if (expanded.length === 0) {
      return;
    }
    const idMap = new Map<string, string>();
    for (const id of expanded) {
      idMap.set(id, this.deps.ids.next());
    }
    let z = this.deps.scene.nextZIndex();
    const commands: AddObjectCommand[] = [];
    const copies: string[] = [];
    for (const id of expanded) {
      const object = this.deps.scene.findById(id);
      if (object === undefined) {
        continue;
      }
      const copy = duplicateObjectDeep(object, idMap, vec2(0, 0), z);
      z += 1;
      const command = new AddObjectCommand(this.deps.scene, copy);
      command.do();
      commands.push(command);
    }
    for (const id of originalIds) {
      const copy = idMap.get(id);
      if (copy !== undefined) {
        copies.push(copy);
      }
    }
    if (commands.length === 0) {
      return;
    }
    this.duplicates = { commands, originalIds };
    this.deps.selection.replaceAll(copies);
  }

  /**
   * Applies one move frame (R5.5: grid-snapped): the desired total
   * displacement (raw, or axis-locked to the dominant axis with Shift) is
   * mapped to a per-axis snap so a selection edge or centre lands exactly
   * on the grid; only the DIFFERENCE to the already-applied displacement
   * moves this frame, and it is expressed as a per-frame `MoveCommand` over
   * the selection expanded with group members, immediately executed and
   * offered to the coalescer (one drag = one undo entry).
   *
   * Snapping yields to the Shift axis-lock (an explicit precision gesture
   * wins over the grid — DECISIONS D-5.5).
   *
   * @param event - the latest normalised pointer payload.
   */
  private applyMoveFrame(event: ToolPointerEvent): void {
    const start = this.gestureStart ?? event.world;
    if (this.deps.selection.isEmpty()) {
      return;
    }
    // Frame delta from the LAST FRAME keeps freehand/connector translations
    // exact; the axis lock projects the ACCUMULATED displacement so a
    // mid-drag Shift press straightens the whole path, not just the frame.
    let desired = vec2(event.world.x - start.x, event.world.y - start.y);
    if (event.shiftKey) {
      desired = lockToAxis(desired);
    } else {
      const snap = this.deps.getSnapConfig?.();
      if (snap !== undefined && snap.enabled && this.moveStartBounds !== null) {
        const adjust = snapBoxDisplacement(
          this.moveStartBounds,
          desired,
          snap.spacing,
        );
        desired = vec2(desired.x + adjust.x, desired.y + adjust.y);
      }
      // R7.4 smart guides: magenta alignment snaps to other objects'
      // edges/centres (+ equal-gap hints), independent of the grid toggle.
      // Alt held mid-drag disables snapping temporarily (grid + guides);
      // Alt at PRESS already started a duplicate drag (no guides there).
      const guides = this.deps.guides;
      if (
        !event.altKey &&
        guides !== undefined &&
        this.moveStartBounds !== null &&
        this.duplicates === null
      ) {
        const zoom = Math.max(this.deps.scene.camera.zoom, 0.02);
        const threshold = SMART_GUIDE_PX / zoom;
        const movedBox: BBox = {
          minX: this.moveStartBounds.minX + desired.x,
          minY: this.moveStartBounds.minY + desired.y,
          maxX: this.moveStartBounds.maxX + desired.x,
          maxY: this.moveStartBounds.maxY + desired.y,
        };
        const excluded = new Set(
          expandGroupMemberIds(this.deps.scene, [...this.deps.selection.ids]),
        );
        const references = collectReferenceBoxes(
          this.deps.scene.objects,
          (id) => {
            const object = this.deps.scene.findById(id);
            return object === undefined
              ? undefined
              : worldBBoxOf(this.deps.scene, object);
          },
          excluded,
        );
        const result = computeSmartSnap(movedBox, references, threshold);
        desired = vec2(
          desired.x + result.adjust.x,
          desired.y + result.adjust.y,
        );
        guides.set(result.guides, result.hints);
      } else if (guides !== undefined) {
        guides.clear();
      }
    }
    const frameDelta = vec2(
      desired.x - this.appliedDisplacement.x,
      desired.y - this.appliedDisplacement.y,
    );
    this.appliedDisplacement = desired;
    this.lastWorld = event.world;
    if (frameDelta.x === 0 && frameDelta.y === 0) {
      return;
    }
    // Locked members refuse interactive edits (the `locked` contract) —
    // a mixed lock-state selection drags only its unlocked part. Pinned
    // members stay on screen (فاز ۲۵ — screen-space furniture never
    // follows a world-space drag).
    const ids = expandGroupMemberIds(this.deps.scene, [
      ...this.deps.selection.ids,
    ]).filter((id) => {
      const object = this.deps.scene.findById(id);
      return object !== undefined && !object.locked && !isPinnedObject(object);
    });
    if (ids.length === 0) {
      return;
    }
    const command = new MoveCommand(this.deps.scene, ids, frameDelta);
    command.do();
    this.deps.coalescer.offer(command);
  }

  /**
   * Computes the world-space union bounds of the top-level selection (the
   * R5.5 grid-snap source box; groups resolve to their own outer box).
   *
   * @returns the union bounds, or null while the selection is empty.
   */
  private selectionBounds(): BBox | null {
    let bounds: BBox | null = null;
    for (const id of this.deps.selection.ids) {
      const object = this.deps.scene.findById(id);
      if (object === undefined || isPinnedObject(object)) {
        continue;
      }
      const box = worldBBoxOf(this.deps.scene, object);
      bounds =
        bounds === null
          ? box
          : {
              minX: Math.min(bounds.minX, box.minX),
              minY: Math.min(bounds.minY, box.minY),
              maxX: Math.max(bounds.maxX, box.maxX),
              maxY: Math.max(bounds.maxY, box.maxY),
            };
    }
    return bounds;
  }

  /**
   * Ends the move gesture: the coalesced command (already applied) is
   * recorded as the single history entry; an Alt+drag wraps the adds and
   * the move into one composite "duplicate" entry.
   */
  private commitMove(): void {
    // R7.4: guides live only during the drag frame stream.
    this.deps.guides?.clear();
    const pending = this.deps.coalescer.takePending();
    this.deps.coalescer.reset();
    const duplicates = this.duplicates;
    if (duplicates !== null) {
      const commands: ICommand[] = [...duplicates.commands];
      if (pending !== null) {
        commands.push(pending);
      }
      this.deps.history.push(
        new CompositeCommand("command.duplicateSelection", commands),
      );
    } else if (pending !== null) {
      this.deps.history.push(pending);
    }
    this.resetGestureState();
  }

  /**
   * Applies one reconnect frame: resolves the endpoint candidate at the
   * pointer (glued to the hovered object or floating) and live-updates the
   * connector in the scene (the history entry lands on release).
   *
   * @param world - current world-space pointer position.
   */
  private applyReconnectFrame(world: Vec2): void {
    const gesture = this.reconnect;
    if (gesture === null) {
      return;
    }
    const current = this.deps.scene.findById(gesture.connectorId);
    if (current === undefined || !isConnectorObject(current)) {
      return;
    }
    const candidate = this.resolveReconnectCandidate(
      world,
      gesture.connectorId,
    );
    if (candidate === null) {
      return;
    }
    const updated: ConnectorObjectData =
      gesture.endpoint === "start"
        ? { ...current, start: candidate }
        : { ...current, end: candidate };
    this.deps.scene.add(updated);
  }

  /**
   * Ends the reconnect gesture: one `UpdateObjectCommand` (patch = the final
   * endpoint, before = the captured snapshot) enters history; the command's
   * `do()` is idempotent because the live frames already applied it.
   */
  private commitReconnect(): void {
    const gesture = this.reconnect;
    if (gesture !== null) {
      const current = this.deps.scene.findById(gesture.connectorId);
      if (current !== undefined && isConnectorObject(current)) {
        const patch =
          gesture.endpoint === "start"
            ? { start: current.start }
            : { end: current.end };
        const command = new UpdateObjectCommand(
          this.deps.scene,
          gesture.connectorId,
          patch,
          gesture.before,
        );
        command.do();
        this.deps.history.push(command);
      }
    }
    this.deps.handles.setActiveEndpoint(null);
    this.resetGestureState();
  }

  /**
   * Resolves the reconnect endpoint candidate: glued to the hovered object's
   * nearest anchor (the connector itself and its own other endpoint's line
   * do not count as targets), or floating at the pointer.
   *
   * @param world - the pointer world position.
   * @param connectorId - the id of the connector being edited.
   * @returns the endpoint candidate, or null while no object is hovered and
   *   the pointer did not move (candidate equals the current endpoint).
   */
  private resolveReconnectCandidate(
    world: Vec2,
    connectorId: string,
  ): ConnectorEndpoint | null {
    const hit = hitTestTopMost(
      this.deps.scene,
      world,
      this.clickTolerance(),
      this.deps.spatialIndex,
    );
    if (hit !== null && hit.id !== connectorId && !isConnectorObject(hit)) {
      const anchor = nearestAnchor(objectBBox(hit), world);
      return {
        objectId: hit.id,
        anchorIndex: anchor.index,
        position: anchor.position,
      };
    }
    return { objectId: null, anchorIndex: 0, position: vec2(world.x, world.y) };
  }

  /**
   * Probes a pointer event for a connector endpoint dot of the single
   * selection.
   *
   * @param event - the pointer event to probe.
   * @returns the connector, the grabbed endpoint side, or null.
   */
  private probeConnectorEndpoint(event: ToolPointerEvent): {
    readonly connector: ConnectorObjectData;
    readonly endpoint: "start" | "end";
  } | null {
    const single = this.singleSelectedObject();
    if (single === null || !isConnectorObject(single)) {
      return null;
    }
    const resolved = resolveConnectorEndpoints(single, this.deps.scene.objects);
    const tolerance =
      ENDPOINT_TOLERANCE_PX / Math.max(this.deps.scene.camera.zoom, 0.01);
    const distanceToStart = Math.hypot(
      event.world.x - resolved.start.x,
      event.world.y - resolved.start.y,
    );
    const distanceToEnd = Math.hypot(
      event.world.x - resolved.end.x,
      event.world.y - resolved.end.y,
    );
    if (distanceToStart <= tolerance && distanceToStart <= distanceToEnd) {
      return { connector: single, endpoint: "start" };
    }
    if (distanceToEnd <= tolerance) {
      return { connector: single, endpoint: "end" };
    }
    return null;
  }

  /**
   * Drops any open gesture without touching history (an in-progress resize
   * or rotation restores its before snapshots; an Alt+drag duplication
   * removes the copies and restores the original selection).
   */
  private cancelGesture(): void {
    // R7.4: guides live only during the drag frame stream.
    this.deps.guides?.clear();
    if (this.phase === "reconnect" && this.reconnect !== null) {
      this.deps.scene.add(this.reconnect.before);
      this.deps.handles.setActiveEndpoint(null);
    }
    if (this.phase === "move" && this.duplicates !== null) {
      for (const command of this.duplicates.commands) {
        this.deps.scene.remove(command.object.id);
      }
      this.deps.selection.replaceAll(this.duplicates.originalIds);
    }
    this.resize.cancel();
    if (this.rotate.active) {
      this.rotate.cancel();
    }
    this.deps.coalescer.reset();
    this.deps.marquee.reset();
    this.deps.handles.setMarquee(null);
    this.resetGestureState();
  }

  /** Clears the per-gesture bookkeeping fields. */
  private resetGestureState(): void {
    this.phase = "idle";
    this.gestureStart = null;
    this.startScreen = null;
    this.lastWorld = null;
    this.appliedDisplacement = vec2(0, 0);
    this.moveStartBounds = null;
    this.pressedId = null;
    this.shiftAtDown = false;
    this.altAtDown = false;
    this.duplicates = null;
    this.reconnect = null;
    this.pinDrag = null;
  }

  /**
   * @returns the viewport size for pin-anchor math (a degenerate 0×0 when
   *   the host wired no viewport — pinned interaction no-ops gracefully).
   */
  private viewport(): ViewportSize {
    return this.deps.getViewport?.() ?? { width: 0, height: 0 };
  }

  /**
   * Probes a pointer event for a PINNED object in screen space (فاز ۲۵).
   *
   * @param event - the pointer event to probe.
   * @returns the pinned object under the cursor, or null.
   */
  private probePinned(event: ToolPointerEvent): SceneObjectData | null {
    const viewport = this.viewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return null;
    }
    return hitTestPinned(this.deps.scene, event.screen, viewport);
  }

  /**
   * Probes a pointer event for a resize handle of the single selected
   * PINNED object (فاز ۲۷ — screen-space anchors, rotation-aware).
   *
   * @param event - the pointer event to probe.
   * @returns the object, grabbed handle and its cursor hint, or null.
   */
  private probePinResizeHandle(event: ToolPointerEvent): {
    readonly object: SceneObjectData;
    readonly handle: ResizeHandleId;
    readonly cursor: ToolCursor;
  } | null {
    const single = this.singleSelectedObject();
    if (single === null || !isPinnedObject(single)) {
      return null;
    }
    const handle = this.pinResize.probe(single, event);
    if (handle === null) {
      return null;
    }
    return { object: single, handle, cursor: RESIZE_HANDLE_CURSOR[handle] };
  }

  /**
   * Probes a pointer event for the rotation grip of the single selected
   * PINNED object (فاز ۳۰ — screen-space anchor, rotation-aware).
   *
   * @param event - the pointer event to probe.
   * @returns the pinned object under the grip, or null.
   */
  private probePinRotateHandle(event: ToolPointerEvent): SceneObjectData | null {
    const single = this.singleSelectedObject();
    if (single === null || !isPinnedObject(single)) {
      return null;
    }
    return this.pinRotate.probe(single, event) ? single : null;
  }

  /**
   * Applies one screen-pin drag frame (فاز ۲۵): the anchor follows the
   * pointer (the press offset preserved, Shift axis-locked); the scene
   * live-updates (the single history entry lands on release — the
   * `commitReconnect` convention).
   *
   * @param event - the latest normalised pointer payload.
   */
  private applyPinMoveFrame(event: ToolPointerEvent): void {
    const gesture = this.pinDrag;
    const viewport = this.viewport();
    if (gesture === null || viewport.width <= 0 || viewport.height <= 0) {
      return;
    }
    const start = this.startScreen ?? event.screen;
    let delta = vec2(
      event.screen.x - start.x,
      event.screen.y - start.y,
    );
    if (event.shiftKey) {
      delta = lockToAxis(delta);
    }
    const anchorPx = vec2(
      gesture.anchorAtDown.x + delta.x,
      gesture.anchorAtDown.y + delta.y,
    );
    const current = this.deps.scene.findById(gesture.objectId);
    if (current === undefined || !isPinnedObject(current)) {
      return;
    }
    this.deps.scene.add({
      ...current,
      pinAnchor: screenToPinAnchor(anchorPx, viewport),
    });
  }

  /**
   * Ends the screen-pin drag (فاز ۲۵): one `UpdateObjectCommand` (patch =
   * the final anchor, before = the captured snapshot) enters history; the
   * command's `do()` is idempotent because the live frames already
   * applied it — the `commitReconnect` convention.
   */
  private commitPinMove(): void {
    const gesture = this.pinDrag;
    if (gesture !== null) {
      const current = this.deps.scene.findById(gesture.objectId);
      if (
        current !== undefined &&
        isPinnedObject(current) &&
        current.pinAnchor !== undefined
      ) {
        const command = new UpdateObjectCommand(
          this.deps.scene,
          gesture.objectId,
          { pinAnchor: current.pinAnchor },
          gesture.before,
        );
        command.do();
        this.deps.history.push(command);
      }
    }
    this.resetGestureState();
  }

  /**
   * @returns the world-space click tolerance at the current zoom.
   */
  private clickTolerance(): number {
    return CLICK_TOLERANCE_PX / Math.max(this.deps.scene.camera.zoom, 0.01);
  }

  /**
   * Probes a pointer event for a resize handle of the single selection
   * (rotation-aware: the anchors ride the rotated box).
   *
   * @param event - the pointer event to probe.
   * @returns the object, grabbed handle and its cursor hint, or null.
   */
  private probeResizeHandle(event: ToolPointerEvent): {
    readonly object: SceneObjectData;
    readonly handle: ResizeHandleId;
    readonly cursor: ToolCursor;
  } | null {
    const single = this.singleSelectedObject();
    // Connectors are re-glued, never handle-resized; groups resize as a
    // unit only in a later phase (the spec's group transforms are move +
    // rotate, AC2.5). Pinned singles show no world-space handles (فاز ۲۵).
    if (
      single === null ||
      isConnectorObject(single) ||
      isGroupObject(single) ||
      isPinnedObject(single)
    ) {
      return null;
    }
    const handle = this.resize.probe(single, event);
    if (handle === null) {
      return null;
    }
    return { object: single, handle, cursor: RESIZE_HANDLE_CURSOR[handle] };
  }

  /**
   * Probes a pointer event for the rotation handle of the single selection
   * (groups included — rotating a group spins its members, AC2.5).
   *
   * @param event - the pointer event to probe.
   * @returns whether the pointer grabs the rotation affordance.
   */
  private probeRotateHandle(event: ToolPointerEvent): boolean {
    const single = this.singleSelectedObject();
    if (
      single === null ||
      isConnectorObject(single) ||
      isFreehandObject(single) ||
      isPinnedObject(single)
    ) {
      return false;
    }
    // The anchor rides the ROTATED top edge: pass the unrotated frame box
    // plus the object rotation. A group's covering box is already the
    // rotated footprint — its handle rides the union's plain top edge.
    const bounds = isGroupObject(single)
      ? worldBBoxOf(this.deps.scene, single)
      : objectBBox(single);
    const rotation = isGroupObject(single) ? 0 : single.rotation;
    return hitRotateHandle(
      event.screen,
      bounds,
      this.deps.scene.camera,
      rotation,
    );
  }

  /**
   * @returns the only selected object, or null unless exactly one
   *   interactive object is selected.
   */
  private singleSelectedObject(): SceneObjectData | null {
    if (this.deps.selection.size !== 1) {
      return null;
    }
    const id = [...this.deps.selection.ids][0];
    if (id === undefined) {
      return null;
    }
    const object = this.deps.scene.findById(id);
    return object === undefined || !object.visible || object.locked
      ? null
      : object;
  }
}

/**
 * Projects a displacement onto its dominant axis (Shift axis lock): the
 * larger absolute component survives, the other zeroes.
 *
 * @param displacement - the raw displacement.
 * @returns the axis-locked displacement.
 */
function lockToAxis(displacement: Vec2): Vec2 {
  if (Math.abs(displacement.x) >= Math.abs(displacement.y)) {
    return vec2(displacement.x, 0);
  }
  return vec2(0, displacement.y);
}
