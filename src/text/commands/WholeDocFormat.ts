/**
 * Whole-document formatting (R3A.6, inspector path): applies a formatting
 * chain to EVERY span of a selected (not currently edited) text box and
 * records exactly ONE `RichTextCommand` undo step.
 *
 * The flow reuses the ONE shared editor (R3A.4) headlessly: the object's
 * document is loaded, the whole range is selected, the chain runs, and the
 * resulting document replaces the object's — the live selection state then
 * also powers the inspector's active-control highlights until the
 * selection changes.
 */
import type { Scene } from "@/core/model/Scene";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { ChainedCommands } from "@tiptap/core";
import { isTextBoxObject } from "@/core/model/TextBoxObject";
import { RichTextCommand } from "@/text/commands/RichTextCommand";
import { getSharedTextEditor } from "@/text/editor/TipTapFactory";
import {
  plainTextOfDocument,
  richTextFromPlainText,
} from "@/text/editor/richtext";

/** Executor signature: receives a fresh chain, appends commands, runs it. */
export type FormatChain = (chain: ChainedCommands) => ChainedCommands;

/**
 * Loads a text box's document into the shared editor (without opening an
 * edit session) so inspector controls can read/apply whole-document state.
 * No-op when the editor already holds this object's current document.
 *
 * @param scene - the scene owning the object.
 * @param objectId - the selected text box id.
 * @param expectedDoc - the document instance expected in the editor (skips
 *        the reload when already loaded — identity comparison, so an undo
 *        swap with a new instance reloads).
 */
export function syncEditorToObject(
  scene: Scene,
  objectId: string,
  expectedDoc?: unknown,
): void {
  const object = scene.findById(objectId);
  if (object === undefined || !isTextBoxObject(object) || object.doc === null) {
    return;
  }
  const service = getSharedTextEditor();
  if (
    service.currentObjectId === objectId &&
    service.currentDocument === (object.doc ?? expectedDoc ?? null)
  ) {
    return;
  }
  service.loadDocument(object.doc, "", objectId);
}

/**
 * Applies a formatting chain to the whole document of a selected text box
 * and pushes ONE undoable `RichTextCommand`.
 *
 * @param scene - the scene owning the object.
 * @param history - the history manager recording the step.
 * @param objectId - the selected text box id.
 * @param apply - the chain to run against the whole-document selection.
 * @returns whether the command ran and changed the document.
 */
export function applyWholeDocumentFormat(
  scene: Scene,
  history: HistoryManager,
  objectId: string,
  apply: FormatChain,
): boolean {
  const object = scene.findById(objectId);
  if (object === undefined || !isTextBoxObject(object)) {
    return false;
  }
  const service = getSharedTextEditor();
  const editor = service.getEditor();
  const before = object.doc ?? richTextFromPlainText(object.text);
  // Load the object's CURRENT document, select everything, run the chain.
  service.loadDocument(before, "", objectId);
  editor.commands.selectAll();
  const ran = apply(editor.chain()).run();
  if (!ran) {
    return false;
  }
  const after = service.getDocument();
  const afterText = plainTextOfDocument(after);
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return false;
  }
  const command = new RichTextCommand(
    scene,
    objectId,
    {
      doc: object.doc,
      text: object.text,
      position: object.position,
      width: object.width,
      height: object.height,
    },
    {
      doc: after,
      text: afterText,
      position: object.position,
      width: object.width,
      height: object.height,
    },
  );
  command.do();
  history.push(command);
  return true;
}
