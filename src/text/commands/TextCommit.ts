/**
 * Pure commit planner for text edit sessions.
 *
 * Decides how an ended edit session lands in the scene + history:
 * - unchanged content → nothing happens (no history noise);
 * - a fresh (pending) box that stayed empty → the object is removed without
 *   a history entry — the creation never "happened" (Excalidraw rule);
 * - a pre-existing box that was emptied → the object is removed through a
 *   recorded `RemoveObjectCommand` (the removal is undoable);
 * - otherwise the new content lands through an `AddObjectCommand` (pending
 *   creation) or a `RichTextCommand` (rich session on an existing box) /
 *   `UpdateObjectCommand` (legacy plain session), each exactly ONE step.
 *
 * The planner is pure: the DOM session executes the plan.
 */
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import type { StickyNoteObjectData } from "@/core/model/StickyNoteObject";
import { serializeRichText } from "@/text/editor/richtext";

/** Any object kind whose text is edited through the DOM overlay session. */
export type TextBearingObject = TextBoxObjectData | StickyNoteObjectData;

/** What the session should do when an edit ends. */
export type TextCommitAction = "none" | "add" | "update" | "remove";

/** The plan produced by {@link planTextCommit}. */
export interface TextCommitPlan {
  /** The action the session must execute. */
  readonly action: TextCommitAction;
  /** Whether the action is recorded into history (always false for "none"). */
  readonly recordHistory: boolean;
}

/** Inputs of the commit decision. */
export interface TextCommitInput {
  /** The object being edited (its state BEFORE the session's live text). */
  readonly object: TextBearingObject;
  /** Whether this session also created the object (pending creation). */
  readonly newlyCreated: boolean;
  /** The final plain text (live DOM content / document projection). */
  readonly newText: string;
  /**
   * The final serialized rich document of a rich session, or undefined for
   * legacy plain sessions (sticky notes).
   */
  readonly newDocJSON?: string;
  /**
   * Whether the final rich document contains a table node (R6.1): a table
   * with empty cells is real content — a fresh table box must be kept
   * (recorded as "add"), and an existing box whose text was cleared but
   * whose table remains must never be auto-removed.
   */
  readonly newDocHasTable?: boolean;
  /**
   * The serialized document captured BEFORE the session (the comparison
   * baseline). Live typing syncs the document into the scene object
   * without history, so the object's CURRENT doc equals the live doc at
   * commit time — the "unchanged" decision must compare against the
   * pre-session state, not the live-synced one.
   */
  readonly baselineDocJSON?: string;
}

/**
 * Plans the scene/history effect of an ended text edit session.
 *
 * @param input - the session facts (object, creation flag, final content).
 * @returns the action + whether it lands in history.
 */
export function planTextCommit(input: TextCommitInput): TextCommitPlan {
  const { object, newlyCreated, newText } = input;
  const trimmed = newText.trim();
  // A table-bearing document is never "empty" — even with every cell
  // blank the table structure itself is the content (R6.1).
  const structural = input.newDocHasTable === true;
  if (newlyCreated) {
    if (trimmed === "" && !structural) {
      // Fresh box left empty: the creation is rolled back silently —
      // nothing was ever recorded, so history stays untouched.
      return { action: "remove", recordHistory: false };
    }
    // The object already sits in the scene (added at session start without
    // history); recording the add now makes the creation undoable as one
    // step carrying the final content.
    return { action: "add", recordHistory: true };
  }
  if (trimmed === "" && !structural) {
    // A pre-existing box emptied by the edit is removed — but undoably.
    return { action: "remove", recordHistory: true };
  }
  if (input.newDocJSON !== undefined) {
    // Rich session: unchanged when the serialized document matches the
    // PRE-SESSION baseline (the live-synced object doc equals the live
    // document, not the original). Text boxes only — sticky notes stay on
    // the plain path.
    const baseline =
      input.baselineDocJSON ??
      (object.kind === "textBox" ? serializeRichText(object.doc) : undefined);
    if (input.newDocJSON === baseline) {
      return { action: "none", recordHistory: false };
    }
  } else if (newText === object.text) {
    return { action: "none", recordHistory: false };
  }
  return { action: "update", recordHistory: true };
}
