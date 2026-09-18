/**
 * Name badge policy: which objects show their user-assigned `name` as a
 * floating chip above the top-right corner of their frame.
 *
 * Per the product decision (user request): sticky notes (برچسب‌ها), tables
 * (جدول‌ها) and images imported from outside the canvas (عکس‌ها) — the three
 * "content carriers" — display their name outside their frame the moment
 * they are named. Other kinds keep their name in the layers panel only
 * (extending the predicate later is a one-line change).
 *
 * Table detection walks the rich-text document; results are cached by
 * document identity (a WeakMap) so per-frame badge passes stay O(1) per
 * text box even though documents are structurally immutable.
 */
import type { SceneObjectData } from "@/core/model/SceneObject";
import { isStickyNoteObject } from "@/core/model/StickyNoteObject";
import { isImageObject } from "@/core/model/ImageObject";
import { isTextBoxObject } from "@/core/model/TextBoxObject";
import {
  documentContainsTable,
  type RichTextDocument,
} from "@/text/editor/richtext";

/** Identity-keyed cache of "this document contains a table". */
const tableCache = new WeakMap<RichTextDocument, boolean>();

/**
 * @param doc - the rich-text document to test (identity-cached).
 * @returns whether the document contains a table node.
 */
function documentHasTableCached(doc: RichTextDocument): boolean {
  const cached = tableCache.get(doc);
  if (cached !== undefined) {
    return cached;
  }
  const result = documentContainsTable(doc);
  tableCache.set(doc, result);
  return result;
}

/**
 * @param object - the object to inspect.
 * @returns whether a named instance of this object shows the floating
 *          name badge outside its frame.
 */
export function showsNameBadge(object: SceneObjectData): boolean {
  if (isStickyNoteObject(object) || isImageObject(object)) {
    return true;
  }
  if (isTextBoxObject(object)) {
    return object.doc !== null && documentHasTableCached(object.doc);
  }
  return false;
}

/**
 * @param object - the object to inspect.
 * @returns whether the object is named AND badge-qualified (visible enough
 *          to draw; callers still respect `object.visible`).
 */
export function hasNameBadge(object: SceneObjectData): boolean {
  return (
    typeof object.name === "string" &&
    object.name.length > 0 &&
    showsNameBadge(object)
  );
}
