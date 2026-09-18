/**
 * Find & Replace execution service (R3B.8) — the bridge between the pure
 * model (`FindReplaceModel`) and the scene/history stack.
 *
 * Replacement contract (spec AC3B.8):
 * - Replace (single) applies exactly ONE undoable command to the affected
 *   object (a `RichTextCommand` for rich text boxes, an
 *   `UpdateObjectCommand` for sticky notes / legacy plain boxes);
 * - Replace ALL applies ALL replacements as ONE `CompositeCommand` — a
 *   single undo step restores every object's pre-replacement content;
 * - an open edit session is committed (closed) first, so replacements
 *   always operate on the persisted documents and never fight the live
 *   editor's internal history.
 *
 * All functions are DOM-free (node-testable): the panel supplies the scene
 * and history services; the object model owns the documents.
 */
import type { Scene } from "@/core/model/Scene";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { ICommand } from "@/core/commands/Command";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { CompositeCommand } from "@/core/commands/CompositeCommand";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import {
  isTextBoxObject,
  type TextBoxObjectData,
} from "@/core/model/TextBoxObject";
import { isStickyNoteObject } from "@/core/model/StickyNoteObject";
import { RichTextCommand } from "@/text/commands/RichTextCommand";
import {
  plainTextOfDocument,
  richTextFromPlainText,
  type RichTextDocument,
} from "@/text/editor/richtext";
import {
  findMatches,
  replaceRangeInDocument,
  type FindMatch,
  type FindTarget,
} from "./FindReplaceModel";

/** Callback used to end a live edit session before replacing (wired to the text layer). */
export type CommitEditing = () => void;

/** Dependencies of the replace service. */
export interface TextReplaceDeps {
  /** The scene whose objects are searched. */
  readonly scene: Scene;
  /** The history recording the undo steps. */
  readonly history: HistoryManager;
  /** Ends (commits) an open edit session — null when none can be open. */
  readonly commitEditing?: CommitEditing | null;
}

/** Outcome of a replace operation. */
export interface ReplaceResult {
  /** How many textual replacements were applied. */
  readonly replaced: number;
  /** Whether a history entry was recorded (false = nothing changed). */
  readonly recorded: boolean;
}

/** History label of the Replace All composite (ONE undo step, R3B.8). */
const REPLACE_ALL_LABEL = "command.replaceAll";

/**
 * Collects the searchable targets (text boxes + sticky notes, z-order)
 * directly from the scene.
 *
 * @param scene - the scene to scan.
 * @returns the searchable targets in document order.
 */
export function collectTargets(scene: Scene): FindTarget[] {
  const targets: FindTarget[] = [];
  for (const object of scene.objects) {
    if (isTextBoxObject(object)) {
      targets.push({ id: object.id, kind: "textBox", text: object.text });
    } else if (isStickyNoteObject(object)) {
      targets.push({ id: object.id, kind: "stickyNote", text: object.text });
    }
  }
  return targets;
}

/**
 * Applies ONE replacement to the object of the given match (R3B.8).
 *
 * @param deps - scene/history/commitEditing.
 * @param match - the match being replaced.
 * @param replacement - the replacement text.
 * @returns the replace outcome.
 */
export function replaceMatch(
  deps: TextReplaceDeps,
  match: FindMatch,
  replacement: string,
): ReplaceResult {
  deps.commitEditing?.();
  const commands = buildReplaceCommands(deps.scene, [match], replacement);
  if (commands.length === 0) {
    return { replaced: 0, recorded: false };
  }
  const command: ICommand =
    commands.length === 1
      ? commands[0]!
      : new CompositeCommand("command.replace", commands);
  command.do();
  deps.history.push(command);
  return { replaced: 1, recorded: true };
}

/**
 * Applies EVERY match's replacement as ONE undo step (R3B.8 / AC3B.8):
 * all objects are spliced against a snapshot of their CURRENT documents,
 * and the per-object commands are bundled into a single composite.
 *
 * @param deps - scene/history/commitEditing.
 * @param query - the query being replaced everywhere.
 * @param replacement - the replacement text.
 * @returns the replace outcome.
 */
export function replaceAllMatches(
  deps: TextReplaceDeps,
  query: string,
  replacement: string,
): ReplaceResult {
  deps.commitEditing?.();
  const matches = findMatches(collectTargets(deps.scene), query);
  if (matches.length === 0) {
    return { replaced: 0, recorded: false };
  }
  const commands = buildReplaceCommands(deps.scene, matches, replacement);
  if (commands.length === 0) {
    return { replaced: 0, recorded: false };
  }
  const composite = new CompositeCommand(REPLACE_ALL_LABEL, commands);
  composite.do();
  deps.history.push(composite);
  return { replaced: matches.length, recorded: true };
}

/**
 * Builds the command list for a set of matches on the CURRENT object state
 * (matches are re-validated: the scene may have changed since the search
 * ran).
 *
 * @param scene - the scene owning the objects.
 * @param matches - the matches to replace.
 * @param replacement - the replacement text.
 * @returns the per-object commands (unexecuted), empty when nothing to do.
 */
function buildReplaceCommands(
  scene: Scene,
  matches: readonly FindMatch[],
  replacement: string,
): ICommand[] {
  // Group by object so each object's occurrences splice against one
  // consistent snapshot (offsets shift as earlier occurrences are cut —
  // splicing from the LAST occurrence to the first keeps them valid).
  const byObject = new Map<string, FindMatch[]>();
  for (const match of matches) {
    const group = byObject.get(match.objectId);
    if (group === undefined) {
      byObject.set(match.objectId, [match]);
    } else {
      group.push(match);
    }
  }
  const commands: ICommand[] = [];
  for (const [objectId, group] of byObject) {
    const object = scene.findById(objectId);
    if (object === undefined) {
      continue;
    }
    if (isTextBoxObject(object)) {
      const command = buildTextBoxReplace(scene, object, group, replacement);
      if (command !== null) {
        commands.push(command);
      }
    } else if (isStickyNoteObject(object)) {
      const command = buildPlainReplace(scene, object, group, replacement);
      if (command !== null) {
        commands.push(command);
      }
    }
  }
  if (commands.length === 0) {
    return [];
  }
  return commands;
}
/**
 * Builds the rich replace command for one text box: clones the object's
 * document (legacy plain boxes are upgraded from `text`), splices every
 * occurrence (last→first) and snapshots before/after for the undo step.
 *
 * @param scene - the scene owning the object.
 * @param object - the text box being edited.
 * @param group - the box's matches (any order; spliced last→first).
 * @param replacement - the replacement text.
 * @returns the command, or null when the document did not change.
 */
function buildTextBoxReplace(
  scene: Scene,
  object: TextBoxObjectData,
  group: readonly FindMatch[],
  replacement: string,
): ICommand | null {
  const before: RichTextDocument =
    object.doc ?? richTextFromPlainText(object.text);
  // Deep clone: the splicer mutates in place and the "before" snapshot must
  // stay pristine for undo.
  const working = JSON.parse(JSON.stringify(before)) as RichTextDocument;
  const ordered = [...group].sort((a, b) => b.start - a.start);
  let changed = false;
  for (const match of ordered) {
    const result = replaceRangeInDocument(
      working,
      match.start,
      match.end,
      replacement,
    );
    if (result !== null) {
      changed = true;
    }
  }
  if (!changed) {
    return null;
  }
  const afterText = plainTextOfDocument(working);
  return new RichTextCommand(
    scene,
    object.id,
    {
      doc: object.doc,
      text: object.text,
      position: object.position,
      width: object.width,
      height: object.height,
    },
    {
      doc: working,
      text: afterText,
      position: object.position,
      width: object.width,
      height: object.height,
    },
  );
}
/**
 * Builds the plain-text replace for sticky notes (no rich document): the
 * spliced text lands through an `UpdateObjectCommand` patch.
 *
 * @param scene - the scene owning the object.
 * @param object - the sticky note being edited.
 * @param group - the note's matches (spliced last→first).
 * @param replacement - the replacement text.
 * @returns the command, or null when the text did not change.
 */
function buildPlainReplace(
  scene: Scene,
  object: SceneObjectData & { readonly text: string },
  group: readonly FindMatch[],
  replacement: string,
): ICommand | null {
  let text = object.text;
  const ordered = [...group].sort((a, b) => b.start - a.start);
  for (const match of ordered) {
    text = text.slice(0, match.start) + replacement + text.slice(match.end);
  }
  if (text === object.text) {
    return null;
  }
  return new UpdateObjectCommand(scene, object.id, { text }, object);
}
