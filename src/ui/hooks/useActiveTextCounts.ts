"use client";

/**
 * Live word/character counts of the ACTIVE rich text editor (R3B.6).
 *
 * Reads the shared editor's CharacterCount storage (configured with the
 * ZWNJ-aware Persian counters — see `wordCount.ts`) and re-renders on every
 * editor transaction while a rich edit session is open. Returns nulls when
 * no session is active (the status bar hides the chip).
 */
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import { getSharedTextEditor } from "@/text/editor/TipTapFactory";

/** The live counts consumed by the status bar. */
export interface TextCounts {
  /** Words in the edited document (ZWNJ-joined compounds count as one). */
  readonly words: number;
  /** Characters in the edited document. */
  readonly characters: number;
}

/**
 * @returns the counts of the active editor, or null while not editing.
 */
export function useActiveTextCounts(): TextCounts | null {
  const [counts, setCounts] = useState<TextCounts | null>(null);

  useEffect(() => {
    let editor: Editor | null = null;
    const offs: Array<() => void> = [];
    let scheduled = false;

    const compute = (): void => {
      const layer = AppContext.getDefault().tryGet(Services.textLayer);
      const live = getSharedTextEditor().tryGetEditor();
      const active =
        layer !== undefined && layer.isRichEditing && live !== null;
      if (!active || live === null) {
        setCounts(null);
        return;
      }
      const storage = live.storage.characterCount as
        { words: () => number; characters: () => number } | undefined;
      if (storage === undefined) {
        setCounts(null);
        return;
      }
      setCounts({ words: storage.words(), characters: storage.characters() });
    };

    const schedule = (): void => {
      if (scheduled) {
        return;
      }
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        compute();
      });
    };

    const bind = (): void => {
      const live = getSharedTextEditor().tryGetEditor();
      if (live === null || live === editor) {
        return;
      }
      editor = live;
      const events = [
        "transaction",
        "update",
        "selectionUpdate",
        "focus",
        "blur",
      ] as const;
      for (const name of events) {
        live.on(name, schedule);
        offs.push(() => live.off(name, schedule));
      }
    };

    bind();
    offs.push(
      getSharedTextEditor().subscribe(() => {
        bind();
        schedule();
      }),
    );
    const bus = AppContext.getDefault().tryGet(Services.eventBus);
    offs.push(bus?.on("text:edit-began", schedule) ?? (() => undefined));
    offs.push(bus?.on("text:edit-ended", schedule) ?? (() => undefined));
    compute();

    return () => {
      for (const off of offs) {
        off();
      }
    };
  }, []);

  return counts;
}
