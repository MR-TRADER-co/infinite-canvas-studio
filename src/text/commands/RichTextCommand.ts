/**
 * Rich text command (R3A.3): a reversible edit of one text object's
 * document, pushed exactly ONCE per edit session (on exit).
 *
 * While the editor is focused, TipTap's internal history handles Ctrl+Z at
 * typing granularity; this command snapshots the WHOLE object state
 * (document, plain projection and the content-driven geometry that grew
 * live during the session) so object-level undo restores the exact
 * pre-edit content AND box in a single step (AC3A.7).
 *
 * The only sanctioned cross-module import from text/ into core/
 * (CLAUDE.md §1.3 dependency rule).
 */
import type { ICommand } from "@/core/commands/Command";
import type { Scene } from "@/core/model/Scene";
import type { Vec2 } from "@/core/geometry/Vec2";
import {
  isTextBoxObject,
  type TextBoxObjectData,
} from "@/core/model/TextBoxObject";
import type { RichTextDocument } from "@/text/editor/richtext";

/** The object state captured before/after a rich text edit session. */
export interface RichTextSnapshot {
  /** The TipTap JSON document (null = legacy plain box). */
  readonly doc: RichTextDocument | null;
  /** The plain-text projection. */
  readonly text: string;
  /** Top-left position in world units. */
  readonly position: Vec2;
  /** Box width in world units. */
  readonly width: number;
  /** Box height in world units. */
  readonly height: number;
}

/** Reversible rich text edit of a single text box. */
export class RichTextCommand implements ICommand {
  /** Command label shown in the history UI. */
  public readonly label = "command.richText";

  /**
   * @param scene - the scene whose object is edited.
   * @param objectId - id of the text box.
   * @param before - the state before the edit session.
   * @param after - the state after the edit session.
   */
  public constructor(
    public readonly scene: Scene,
    public readonly objectId: string,
    public readonly before: RichTextSnapshot,
    public readonly after: RichTextSnapshot,
  ) {}

  /** Applies the post-edit state. */
  public do(): void {
    this.apply(this.after);
  }

  /** Restores the pre-edit state (whole document + geometry). */
  public undo(): void {
    this.apply(this.before);
  }

  /** Re-applies the post-edit state. */
  public redo(): void {
    this.apply(this.after);
  }

  /**
   * Merges one snapshot into the live object (replace-in-place keeps paint
   * order; objects removed in the meantime are skipped — the MoveCommand
   * convention).
   *
   * @param snapshot - the state to apply.
   */
  private apply(snapshot: RichTextSnapshot): void {
    const object = this.scene.findById(this.objectId);
    if (object === undefined || !isTextBoxObject(object)) {
      return;
    }
    const textBox = object as TextBoxObjectData;
    const next: TextBoxObjectData = {
      ...textBox,
      doc: snapshot.doc,
      text: snapshot.text,
      position: snapshot.position,
      width: snapshot.width,
      height: snapshot.height,
    };
    this.scene.add(next);
  }
}
