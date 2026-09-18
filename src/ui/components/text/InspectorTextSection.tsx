"use client";

/**
 * Inspector rich-text section (R3A.6): the full format control set for a
 * selected text box. While the object is being edited, controls run against
 * the live selection (TipTap history granularity); while merely selected,
 * the editor is synced to the object's document and every control applies
 * to the WHOLE document through ONE `RichTextCommand` undo step.
 */
import { useEffect, type ReactNode } from "react";
import { Type } from "lucide-react";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import { useRichTextSession } from "@/ui/hooks/useRichTextSession";
import { useTranslation } from "@/ui/i18n";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import {
  applyWholeDocumentFormat,
  syncEditorToObject,
  type FormatChain,
} from "@/text/commands/WholeDocFormat";
import FormatControls from "./FormatControls";

/**
 * @param props - the single selected text box.
 * @returns the inspector's rich text section.
 */
export default function InspectorTextSection(props: {
  readonly object: TextBoxObjectData;
}): ReactNode {
  const { t } = useTranslation();
  const session = useRichTextSession();
  const editingThis = session.active && session.objectId === props.object.id;
  const editor = session.editor;

  // While merely selected, mirror the object's document into the shared
  // editor so the controls read real active states. Re-runs whenever the
  // content changes (undo/redo swaps the doc instance).
  useEffect(() => {
    if (editingThis || props.object.doc === null) {
      return;
    }
    const scene = AppContext.getDefault().tryGet(Services.scene);
    if (scene !== undefined) {
      syncEditorToObject(scene, props.object.id);
    }
  }, [editingThis, props.object.id, props.object.doc]);

  if (editor === null || props.object.doc === null) {
    return null;
  }

  const execute =
    editingThis === true
      ? (chain: FormatChain): void => {
          chain(editor.chain().focus()).run();
        }
      : (chain: FormatChain): void => {
          const scene = AppContext.getDefault().tryGet(Services.scene);
          const history = AppContext.getDefault().tryGet(Services.history);
          if (scene !== undefined && history !== undefined) {
            applyWholeDocumentFormat(scene, history, props.object.id, chain);
          }
        };

  return (
    <section
      aria-label={t("textFormat.title")}
      data-text-format-ui
      className="space-y-2.5"
    >
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <Type
          className="size-3.5 text-muted-foreground/70"
          aria-hidden="true"
        />
        {t("textFormat.title")}
      </h3>
      <FormatControls
        editor={editor}
        baseFontSize={props.object.fontSize}
        execute={execute}
      />
      {editingThis !== true && (
        <p className="px-0.5 text-[10px] leading-4 text-muted-foreground/70">
          {t("textFormat.wholeDocHint")}
        </p>
      )}
    </section>
  );
}
