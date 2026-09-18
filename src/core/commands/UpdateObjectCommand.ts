/**
 * Patches user-facing properties of one object (layers-panel operations,
 * text commits and inspector restyles).
 *
 * `do()` merges the patch into the CURRENT object data (immutable replace
 * through `Scene.add`), `undo()` restores the captured before snapshot —
 * exact restore, so redo/undo cycles never drift even when successive
 * commands patch the same object. Objects removed in the meantime are
 * skipped (the `MoveCommand` convention). Geometry edits (position/size)
 * deliberately do NOT use this command: they flow through `MoveCommand` /
 * `ResizeCommand` which keep freehand points and stroke padding consistent.
 */
import type { ICommand } from "@/core/commands/Command";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { FrameLayout } from "@/core/model/FrameObject";
import type {
  ArrowStyle,
  ConnectorEndpoint,
  ConnectorRoutingKind,
} from "@/core/model/ConnectorObject";
import type { StrokeStyleKind } from "@/core/model/FreehandObject";
import type { PropertyValue } from "@/core/model/Properties";

/**
 * Style fields the inspector may patch, unioned across object kinds. The
 * per-kind validity matrix (which field applies to which kind) is enforced
 * by {@link planStylePatch} in `core/commands/StylePatches.ts` — command
 * consumers build kind-valid patches only.
 */
export interface StylePatchFields {
  /** Fill colour (shape only): token or literal CSS colour. */
  fill: string;
  /** Stroke colour (shape only): token or literal CSS colour. */
  stroke: string;
  /** Stroke colour (freehand + connector): token or literal CSS colour. */
  strokeColor: string;
  /** Stroke width in world units (shape + freehand + connector). */
  strokeWidth: number;
  /** Font size in world units (textBox + stickyNote). */
  fontSize: number;
  /** Ink colour (textBox + stickyNote): token or literal CSS colour. */
  color: string;
  /** Base font family (textBox + stickyNote; undefined clears, R7.2). */
  fontFamily?: string;
  /** Card background colour (stickyNote only): literal CSS colour. */
  noteColor: string;
  /** Dash pattern (freehand + connector). */
  strokeStyle: StrokeStyleKind;
  /** Routing strategy (connector only). */
  routingKind: ConnectorRoutingKind;
  /** Start arrowhead (connector only). */
  startArrow: ArrowStyle;
  /** End arrowhead (connector only). */
  endArrow: ArrowStyle;
  /** Emoji glyph (sticker only, R11.1). */
  emoji: string;
  /** Font weight (textBox, R13.3 text styles). */
  fontWeight: number;
  /** Line-height multiplier (textBox, R13.3 text styles). */
  lineHeight: number;
  /** Named-style reference id (R13.3; undefined detaches). */
  styleId?: string;
  /** Frame auto-layout definition (R13.4; undefined = free placement). */
  layout?: FrameLayout;
}

/** Set of object fields the panels, text commits and tools may patch. */
export type ObjectPatch = Partial<
  Pick<SceneObjectData, "name" | "visible" | "locked"> & {
    text: string;
  } & StylePatchFields & {
      /** Start endpoint replacement (connector re-glue gesture). */
      start: ConnectorEndpoint;
      /** End endpoint replacement (connector re-glue gesture). */
      end: ConnectorEndpoint;
      /** Midpoint label caption (connector only, R5.3; empty clears). */
      label: string;
      /**
       * Verbatim plugin payload replacement (plugin objects only,
       * R9.3 — one undo step; the host never interprets the contents).
       */
      data: Record<string, unknown>;
      /** Query kind (query objects only, R15.2). */
      queryType: import("@/core/model/QueryObject").QueryType;
      /** Query target key (query objects only, R15.2; empty = none). */
      queryTarget: string;
      /**
       * Structured QuerySpec replacement (filter cards only, R12.2): the
       * WHOLE spec swaps in one undo step — the inspector's spec editor
       * computes the next spec (filter add/edit/remove, tags, sort…) and
       * commits it here.
       */
      querySpec: import("@/core/knowledge/QueryEngine").SceneQuerySpec;
      /**
       * Results-table column replacement (filter cards only, R12.2; the
       * WHOLE ≤3-element array swaps in one undo step).
       */
      columns: readonly string[];
      /**
       * Structured properties replacement (pack R11.3): the WHOLE record
       * swaps in one undo step — the inspector's Properties section
       * computes the next record (add/edit/remove) and commits it here.
       */
      properties: Record<string, PropertyValue>;
      /**
       * Pin flag + anchor (فاز ۲۵): pinning sets both together; unpinning
       * clears the flag through `SelectionOps.togglePinSelection` (which
       * pairs it with a `MoveCommand` so the world position lands under
       * the anchor — the documented geometry-command exception).
       */
      pinned: boolean;
      pinAnchor: import("@/core/geometry/Vec2").Vec2;
      /**
       * PDF page flip (فاز P1 — RP1.5): the wheel gesture patches the
       * current page + its freshly rendered poster hash in ONE undo step
       * (debounced — one command per 300 ms pause).
       */
      currentPage: number;
      /** The page poster's AssetStore hash (PDF objects, فاز P1). */
      thumbHash: string | null;
    }
>;

/** Reversible property patch of a single object. */
export class UpdateObjectCommand implements ICommand {
  /** Command label shown in the history UI. */
  public readonly label = "command.updateObject";

  /**
   * @param scene - the scene whose object is patched.
   * @param objectId - id of the object being patched.
   * @param patch - the fields to merge (name/visible/locked/style).
   * @param before - the full object data captured before the patch.
   */
  public constructor(
    public readonly scene: Scene,
    public readonly objectId: string,
    public readonly patch: ObjectPatch,
    public readonly before: SceneObjectData,
  ) {}

  /** Applies the patch when the object still exists. */
  public do(): void {
    const object = this.scene.findById(this.objectId);
    if (object === undefined) {
      return;
    }
    this.scene.add({ ...object, ...this.patch });
  }

  /** Restores the before snapshot when the object still exists. */
  public undo(): void {
    if (this.scene.findById(this.objectId) === undefined) {
      return;
    }
    this.scene.add(this.before);
  }

  /** Re-applies the patch. */
  public redo(): void {
    this.do();
  }
}
