/**
 * TipTap editor factory (R3A.4): the ONE configured editor instance shared
 * by every canvas text object.
 *
 * The service is app-scoped and lazily created (browser DOM required).
 * `mount` re-parents the editor's host element into the view of the object
 * being edited — the ProseMirror view is never re-created, so switching the
 * edit target costs one `EditorState` rebuild (which also resets the
 * editor's internal undo history: the next object's Ctrl+Z must never
 * replay the previous object's typing — R3A.3).
 *
 * Static (non-edited) views render through the same ProseMirror schema via
 * `renderRichTextHTML`, so live and static rendering are byte-identical
 * (AC3A.1).
 */
import { Editor } from "@tiptap/core";
import {
  Node as PMNode,
  DOMSerializer,
  type Node as ProseMirrorNode,
} from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { createTextExtensions } from "./extensions";
import {
  emptyRichTextDocument,
  richTextFromPlainText,
  tabularToTableDocument,
  type RichTextDocument,
} from "./richtext";
import { isSelectionInTable } from "./tableCommands";
import { sanitizePastedHTML } from "./pasteSanitizer";
import { planClipboardPaste } from "./pastePlanner";

/** Listener invoked whenever the editor mounts, detaches or loads a doc. */
export type TextEditorListener = () => void;

/** Listener invoked for user-facing notices (e.g. rejected pastes). */
export type TextEditorNotice = (messageKey: string) => void;

/**
 * Editor-originated UI intents (R3B.3/R3B.8/R6.2): the in-editor keyboard
 * or pointer wants to open a UI surface (link dialog via Ctrl+K, find panel
 * via Ctrl+F, the context menu via right-click). The text layer must never
 * import the UI layer — the composition root forwards these to the typed
 * event bus, which the React shell consumes.
 */
export type TextEditorIntent =
  | { readonly type: "link-dialog" }
  | { readonly type: "find" }
  | {
      /** R6.2: a right-click inside the editor resolved to its region. */
      readonly type: "context-menu";
      /** "table" when the caret sits in a table cell, else "text". */
      readonly region: "table" | "text";
      /** Viewport-space anchor of the right-click. */
      readonly x: number;
      readonly y: number;
    };

/** Listener invoked for editor-originated UI intents. */
export type TextEditorIntentHandler = (intent: TextEditorIntent) => void;

/** Subscription removal function. */
export type Unsubscribe = () => void;

/** Count of live Editor instances (AC3A.8 contract: never above one). */
let instanceCount = 0;

/**
 * @returns how many TipTap editors this module has created (diagnostics +
 *          the one-instance test).
 */
export function textEditorInstanceCount(): number {
  return instanceCount;
}

/** The single shared rich text editor service. */
export class TextEditorService {
  private editor: Editor | null = null;
  private host: HTMLDivElement | null = null;
  private container: HTMLElement | null = null;
  private placeholder = "";
  private targetId: string | null = null;
  private targetDoc: RichTextDocument | null = null;
  private notice: TextEditorNotice | null = null;
  private intentHandler: TextEditorIntentHandler | null = null;
  private readonly listeners = new Set<TextEditorListener>();

  /**
   * Installs the user-facing notice listener (the composition root wires
   * it to the event bus → the toast UI). R6.6's rejected nested paste and
   * R3B.5's dropped remote images are the consumers.
   *
   * @param notice - the listener, or null to remove it.
   */
  public setNoticeHandler(notice: TextEditorNotice | null): void {
    this.notice = notice;
  }

  /**
   * Installs the UI-intent listener (the composition root forwards
   * in-editor Ctrl+K / Ctrl+F to the typed event bus — R3B.3/R3B.8).
   *
   * @param handler - the listener, or null to remove it.
   */
  public setIntentHandler(handler: TextEditorIntentHandler | null): void {
    this.intentHandler = handler;
  }

  /** Emits a notice key to the installed listener (no-op without one). */
  private notifyUser(messageKey: string): void {
    this.notice?.(messageKey);
  }

  /** Forwards an editor-originated UI intent (no-op without a listener). */
  private emitIntent(intent: TextEditorIntent): void {
    this.intentHandler?.(intent);
  }

  /** @returns the live TipTap editor (creating it on first use). */
  public getEditor(): Editor {
    return this.ensureEditor();
  }

  /** @returns the editor, or null before the first use. */
  public tryGetEditor(): Editor | null {
    return this.editor;
  }

  /** @returns the ProseMirror schema of the shared editor. */
  public getSchema() {
    return this.ensureEditor().schema;
  }

  /** @returns the host element wrapping the live `.ProseMirror` root. */
  public getHost(): HTMLDivElement {
    this.ensureEditor();
    return this.host as HTMLDivElement;
  }

  /** @returns the element the host currently lives in, or null. */
  public mountedIn(): HTMLElement | null {
    return this.container;
  }

  /**
   * Moves the editor host into a container (the edited object's view).
   *
   * @param container - the element receiving the live editor.
   */
  public mount(container: HTMLElement): void {
    const host = this.getHost();
    if (this.container === container && host.parentElement === container) {
      return;
    }
    container.appendChild(host);
    this.container = container;
    this.notify();
  }

  /** Detaches the editor host from the DOM (the editor stays alive). */
  public detach(): void {
    if (this.host !== null && this.host.parentElement !== null) {
      this.host.parentElement.removeChild(this.host);
    }
    this.container = null;
    this.notify();
  }

  /**
   * Swaps the edited document: rebuilds the editor state (fresh plugin
   * states ⇒ history reset) with the caret at the end, then focuses.
   *
   * @param doc - the document to load (null → an empty paragraph).
   * @param placeholder - the placeholder shown while the doc is empty.
   * @param targetId - the object id the document belongs to (whole-document
   *        formatting loads a selected object without opening a session).
   */
  public loadDocument(
    doc: RichTextDocument | null,
    placeholder: string,
    targetId: string | null = null,
  ): void {
    const editor = this.ensureEditor();
    this.placeholder = placeholder;
    this.targetId = targetId;
    this.targetDoc = doc ?? null;
    const document = doc ?? emptyRichTextDocument();
    const content = PMNode.fromJSON(editor.schema, document);
    const state = EditorState.create({
      doc: content,
      selection: TextSelection.atEnd(content),
      plugins: editor.state.plugins,
    });
    editor.view.updateState(state);
    this.notify();
  }

  /** @returns the object id whose document the editor currently holds. */
  public get currentObjectId(): string | null {
    return this.targetId;
  }

  /** @returns the document instance the editor currently holds (identity). */
  public get currentDocument(): RichTextDocument | null {
    return this.targetDoc;
  }

  /**
   * Updates the placeholder text of the mounted editor (language switch).
   *
   * @param placeholder - the new placeholder string.
   */
  public setPlaceholder(placeholder: string): void {
    if (this.placeholder === placeholder) {
      return;
    }
    this.placeholder = placeholder;
    if (this.editor !== null) {
      // A no-op selection transaction forces the Placeholder decoration
      // (whose getter reads the live service state) to re-render.
      const { tr } = this.editor.state;
      this.editor.view.dispatch(tr.setSelection(this.editor.state.selection));
    }
  }

  /** Focuses the editor caret. */
  public focus(): void {
    this.ensureEditor().commands.focus("end");
  }

  /**
   * @returns the current document as TipTap JSON.
   */
  public getDocument(): RichTextDocument {
    return this.getEditor().getJSON() as RichTextDocument;
  }

  /**
   * @returns the current plain-text projection (live typing).
   */
  public getPlainText(): string {
    return this.getEditor().state.doc.textBetween(
      0,
      this.getEditor().state.doc.content.size,
      "\n",
      "\n",
    );
  }

  /**
   * Subscribes to mount/detach/load notifications (React toolbars).
   *
   * @param listener - invoked after every service state change.
   * @returns an unsubscribe function.
   */
  public subscribe(listener: TextEditorListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Destroys the editor (tests / app teardown). */
  public destroy(): void {
    this.detach();
    this.editor?.destroy();
    this.editor = null;
    this.host = null;
    instanceCount = Math.max(0, instanceCount - 1);
    this.notify();
  }

  /** @returns the current placeholder text. */
  public currentPlaceholder(): string {
    return this.placeholder;
  }

  /** Notifies every subscriber of a state change. */
  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  /**
   * Lazily creates the editor and its host element exactly once.
   *
   * @returns the live editor.
   */
  private ensureEditor(): Editor {
    if (this.editor !== null) {
      return this.editor;
    }
    const host = document.createElement("div");
    host.className = "text-editor-host";
    // Per-block `dir` attributes decide the actual bidi layout; the host
    // itself stays neutral so mixed blocks each get their own direction.
    host.dir = "auto";
    this.host = host;
    this.editor = new Editor({
      element: host,
      extensions: createTextExtensions(() => this.placeholder),
      content: emptyRichTextDocument(),
      editable: true,
      autofocus: false,
      // Markdown input rules ON (R3B.4): "# " → H1, "## " → H2,
      // "### " → H3, "- " → bullet, "1. " → ordered, "> " → quote,
      // "[] " → task, **bold**, *italic*, ~~strike~~, `code`.
      // Paste RULES stay off — the R3B.5 sanitiser owns the paste pipeline.
      enableInputRules: true,
      enablePasteRules: false,
      editorProps: {
        attributes: {
          class: "rich-text-prose",
          spellcheck: "false",
          translate: "no",
        },
        // Editor-originated UI intents (R3B.3): Ctrl+K opens the link dialog
        // — it leaves the text layer through the injected handler
        // (layering: never import the UI). Ctrl+F is handled by the shell's
        // window-level shortcut (its events bubble out of the editor).
        handleKeyDown: (view, event) => {
          if (event.ctrlKey || event.metaKey) {
            if (event.code === "KeyK" && !event.shiftKey) {
              event.preventDefault();
              this.emitIntent({ type: "link-dialog" });
              return true;
            }
          }
          return false;
        },
        // R6.2: right-click inside the editor opens the REGISTERED context
        // menu (region "table" when the caret sits in a table cell, else
        // "text") instead of the browser's native menu. The resolved region
        // + anchor leave the text layer through the intent handler.
        handleDOMEvents: {
          contextmenu: (view, event) => {
            const mouse = event as MouseEvent;
            mouse.preventDefault();
            const region: "table" | "text" = isSelectionInTable(view)
              ? "table"
              : "text";
            this.emitIntent({
              type: "context-menu",
              region,
              x: mouse.clientX,
              y: mouse.clientY,
            });
            return true;
          },
        },
        // R3B.5 paste pipeline (the decision table lives in the PURE
        // `planClipboardPaste`; the sanitiser is likewise pure):
        // - Ctrl+Shift+V → plain text;
        // - HTML (Word/Excel/web) → strictly sanitised, keeps
        //   bold/italic/underline/strike/headings/lists/links, drops
        //   scripts/styles/handlers/comments and remote images (with a
        //   visible Persian notice);
        // - a table pasted INTO a table cell is rejected (R6.6);
        // - plain TSV becomes a real RTL table (R6.6);
        // - sanitized tables parse into real rich tables (R6.1 schema).
        handlePaste: (view, event) => {
          if (!view.editable) {
            return false;
          }
          const clipboard = event.clipboardData;
          if (clipboard === null) {
            return false;
          }
          // Chromium's ClipboardEvent carries the modifier state (UIEvent
          // inheritance) — read defensively: anything else counts as plain.
          const shiftHeld =
            (event as ClipboardEvent & { readonly shiftKey?: boolean })
              .shiftKey === true;
          const plan = planClipboardPaste({
            plain: clipboard.getData("text/plain"),
            html: clipboard.getData("text/html"),
            shiftKey: shiftHeld,
            selectionInTable: isSelectionInTable({ state: view.state }),
          });
          switch (plan.kind) {
            case "reject-nested-table":
              event.preventDefault();
              this.notifyUser("table.pasteNestedRejected");
              return true;
            case "plain-text":
              event.preventDefault();
              this.insertPlainText(plan.text);
              return true;
            case "rich-html": {
              event.preventDefault();
              const sanitized = sanitizePastedHTML(plan.html);
              if (sanitized.html.trim().length > 0) {
                this.insertSanitizedHTML(sanitized.html);
              } else {
                this.insertPlainText(clipboard.getData("text/plain"));
              }
              if (sanitized.droppedRemoteImages > 0) {
                this.notifyUser("paste.remoteImagesDropped");
              }
              return true;
            }
            case "table-from-tabular": {
              event.preventDefault();
              const document = tabularToTableDocument(plan.cells, "rtl");
              const table = document.content?.[0];
              if (table !== undefined) {
                this.editor?.chain().focus().insertContent(table).run();
              }
              return true;
            }
            default:
              return false;
          }
        },
      },
    });
    instanceCount += 1;
    return this.editor;
  }

  /**
   * Inserts plain clipboard text as content: a single line becomes text at
   * the caret; multi-line text becomes one paragraph per line (R3B.5).
   *
   * @param text - the clipboard's plain-text payload.
   */
  private insertPlainText(text: string): void {
    const editor = this.editor;
    if (editor === null || text.length === 0) {
      return;
    }
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    if (lines.length === 1) {
      editor
        .chain()
        .focus()
        .insertContent(lines[0] ?? "")
        .run();
      return;
    }
    const document = richTextFromPlainText(lines.join("\n"));
    editor.chain().focus().insertContent(document).run();
  }

  /**
   * Inserts sanitised HTML through the schema parser.
   *
   * @param html - the sanitised clipboard HTML.
   */
  private insertSanitizedHTML(html: string): void {
    this.editor?.chain().focus().insertContent(html).run();
  }
}

/** The module-scoped shared service (one per app run). */
let sharedService: TextEditorService | null = null;

/**
 * @returns the app-scoped shared editor service (created on first call).
 */
export function getSharedTextEditor(): TextEditorService {
  if (sharedService === null) {
    sharedService = new TextEditorService();
  }
  return sharedService;
}

/**
 * Renders a document to static HTML through the shared editor's schema —
 * the exact serialization ProseMirror's live view produces, so static and
 * editing rendering are identical (AC3A.1).
 *
 * @param schema - the ProseMirror schema of the shared editor.
 * @param doc - the document to serialize.
 * @returns the HTML string of the document's content.
 */
export function renderRichTextHTML(
  schema: ReturnType<TextEditorService["getSchema"]>,
  doc: RichTextDocument,
): string {
  const root = PMNode.fromJSON(schema, doc) as ProseMirrorNode;
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(
    root.content,
  );
  const wrapper = document.createElement("div");
  wrapper.appendChild(fragment);
  return wrapper.innerHTML;
}
