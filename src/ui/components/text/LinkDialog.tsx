"use client";

/**
 * Link dialog (R3B.3): Ctrl+K inserts or edits a link — URL + editable
 * label. Behaviours:
 * - a non-collapsed selection → the selection text becomes the label
 *   (editable); applying rewrites the range with the new label + link;
 * - the caret inside an existing link → the whole link range becomes the
 *   edit target (label pre-filled, URL pre-filled);
 * - the caret elsewhere → "insert" mode: the typed label is inserted at
 *   the caret as a new link (label required);
 * - Remove strips the link mark from the target range (text stays).
 *
 * The dialog never commits the edit session while it holds focus: its root
 * carries `data-text-format-ui`, the same transient-focus tag the text
 * layer exempts from its click-away commit check.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Link2, Unlink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Editor } from "@tiptap/core";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";
import { getSharedTextEditor } from "@/text/editor/TipTapFactory";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";

/** URL schemes the dialog accepts (the app never opens anything else). */
const URL_PATTERN = /^https?:\/\/\S+$/i;

/** The link target resolved from the live editor selection. */
interface LinkTarget {
  /** ProseMirror range the link applies to (insert mode: caret point). */
  readonly from: number;
  readonly to: number;
  /** Existing href, or null for a brand-new link. */
  readonly href: string | null;
  /** Current text of the range ("" in insert mode). */
  readonly text: string;
  /** Whether a text range exists to rewrite (false = pure insert). */
  readonly hasRange: boolean;
}

/**
 * @returns whether the app currently holds a rich text edit session.
 */
function isEditing(): boolean {
  const layer = AppContext.getDefault().tryGet(Services.textLayer);
  return layer !== undefined && layer.isRichEditing;
}

/**
 * Resolves the link target from the live editor: selection → range; caret
 * in link → the link's whole run; else the caret point (insert mode).
 *
 * @param editor - the shared editor.
 * @returns the resolved target, or null when no session is open.
 */
function resolveTarget(editor: Editor): LinkTarget | null {
  const { selection } = editor.state;
  if (!selection.empty) {
    const text = editor.state.doc.textBetween(
      selection.from,
      selection.to,
      "\n",
    );
    const href =
      (editor.getAttributes("link").href as string | undefined) ?? null;
    return {
      from: selection.from,
      to: selection.to,
      href,
      text,
      hasRange: true,
    };
  }
  const range = linkRunAtCaret(editor);
  if (range !== null) {
    const text = editor.state.doc.textBetween(range.from, range.to, "\n");
    const href =
      (editor.getAttributes("link").href as string | undefined) ?? null;
    return { ...range, href, text, hasRange: true };
  }
  return {
    from: selection.from,
    to: selection.to,
    href: null,
    text: "",
    hasRange: false,
  };
}

/**
 * Finds the contiguous link-marked text run around the caret (edit mode for
 * a click into an existing link).
 *
 * @param editor - the shared editor.
 * @returns the run's range, or null when the caret is not inside a link.
 */
function linkRunAtCaret(editor: Editor): { from: number; to: number } | null {
  const { $from } = editor.state.selection;
  if (!$from.parent.isTextblock) {
    return null;
  }
  const base = $from.pos - $from.parentOffset;
  const children: Array<{ from: number; to: number; linked: boolean }> = [];
  $from.parent.forEach((child, offset) => {
    children.push({
      from: base + offset,
      to: base + offset + child.nodeSize,
      linked:
        child.isText && child.marks.some((mark) => mark.type.name === "link"),
    });
  });
  const caret = $from.pos;
  const index = children.findIndex(
    (child) => caret >= child.from && caret <= child.to && child.linked,
  );
  if (index === -1) {
    return null;
  }
  let start = index;
  let end = index;
  while (
    start > 0 &&
    children[start - 1] !== undefined &&
    children[start - 1]!.linked
  ) {
    start -= 1;
  }
  while (
    end < children.length - 1 &&
    children[end + 1] !== undefined &&
    children[end + 1]!.linked
  ) {
    end += 1;
  }
  const first = children[start];
  const last = children[end];
  if (first === undefined || last === undefined) {
    return null;
  }
  return { from: first.from, to: last.to };
}

/**
 * The floating link dialog, opened by the editor's Ctrl+K (via the typed
 * event bus) and the toolbar's link button.
 *
 * @returns the dialog (mounted app-wide; visibility is event-driven).
 */
export default function LinkDialog(): ReactNode {
  const { t } = useTranslation();
  const language = useUiStore((state) => state.language);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Whether the dialog edits an EXISTING link (derives the remove button). */
  const [editingLink, setEditingLink] = useState(false);
  const targetRef = useRef<LinkTarget | null>(null);

  // Bus-driven open (editor Ctrl+K and the format toolbar's link button).
  useEffect(() => {
    const bus = AppContext.getDefault().tryGet(Services.eventBus);
    return bus?.on("ui:link-dialog-requested", () => {
      const editor = getSharedTextEditor().tryGetEditor();
      if (editor === null || !isEditing()) {
        return;
      }
      const target = resolveTarget(editor);
      if (target === null) {
        return;
      }
      targetRef.current = target;
      setUrl(target.href ?? "");
      setLabel(target.text);
      setError(null);
      setEditingLink(target.href != null);
      setOpen(true);
    });
  }, []);

  const apply = (): void => {
    const editor = getSharedTextEditor().tryGetEditor();
    const target = targetRef.current;
    if (editor === null || target === null) {
      return;
    }
    const trimmedUrl = url.trim();
    if (!URL_PATTERN.test(trimmedUrl)) {
      setError(t("link.invalidUrl"));
      return;
    }
    const trimmedLabel = label.trim();
    if (!target.hasRange && trimmedLabel.length === 0) {
      setError(t("link.emptySelection"));
      return;
    }
    if (target.hasRange) {
      // Rewrite the range with the (possibly new) label + the link mark.
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: target.from, to: target.to },
          {
            type: "text",
            text: trimmedLabel.length > 0 ? trimmedLabel : target.text,
            marks: [{ type: "link", attrs: { href: trimmedUrl } }],
          },
        )
        .run();
    } else {
      // Insert mode: new labelled link at the caret.
      editor
        .chain()
        .focus()
        .insertContentAt(target.from, {
          type: "text",
          text: trimmedLabel,
          marks: [{ type: "link", attrs: { href: trimmedUrl } }],
        })
        .run();
    }
    targetRef.current = null;
    setEditingLink(false);
    setOpen(false);
  };

  const remove = (): void => {
    const editor = getSharedTextEditor().tryGetEditor();
    const target = targetRef.current;
    if (editor === null || target === null || !target.hasRange) {
      setOpen(false);
      return;
    }
    editor
      .chain()
      .focus()
      .setTextSelection({ from: target.from, to: target.to })
      .unsetLink()
      .run();
    targetRef.current = null;
    setEditingLink(false);
    setOpen(false);
  };

  const close = (): void => {
    targetRef.current = null;
    setEditingLink(false);
    setOpen(false);
    // Give the caret back to the editor (the session continues).
    getSharedTextEditor().tryGetEditor()?.commands.focus();
  };

  // Derived from STATE, not the ref (render must never read refs).
  const canRemove = editingLink;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <DialogContent
        dir={language === "fa" ? "rtl" : "ltr"}
        data-text-format-ui
        className="max-w-md"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4" aria-hidden="true" />
            {t("link.dialogTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("link.dialogTitle")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("link.urlLabel")}
            </span>
            <Input
              dir="ltr"
              autoFocus
              value={url}
              placeholder={t("link.urlPlaceholder")}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  apply();
                }
              }}
              className="font-mono text-left text-xs"
              aria-invalid={error !== null}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("link.labelLabel")}
            </span>
            <Input
              value={label}
              placeholder={t("link.labelPlaceholder")}
              onChange={(event) => {
                setLabel(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  apply();
                }
              }}
            />
          </label>
          {error !== null && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          {canRemove && (
            <Button variant="outline" onClick={remove} className="gap-1.5">
              <Unlink className="size-4" aria-hidden="true" />
              {t("link.remove")}
            </Button>
          )}
          <Button variant="ghost" onClick={close}>
            {t("link.cancel")}
          </Button>
          <Button onClick={apply} className="gap-1.5">
            <ExternalLink className="size-4" aria-hidden="true" />
            {t("link.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
