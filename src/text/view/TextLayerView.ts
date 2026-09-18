/**
 * Text layer view: the DOM overlay hosting every text object view plus the
 * live edit-session orchestration (CLAUDE.md §1.3).
 *
 * The layer has `pointer-events: none` — events are captured by the canvas
 * layer and routed via model hit-testing; tools express edit/create intents
 * on the typed event bus and the composition root forwards them here. Only
 * the object being edited enables pointer events: its view mounts the ONE
 * shared TipTap editor (R3A.1–R3A.4); sticky notes keep the legacy plain
 * contentEditable session. One `requestAnimationFrame` render loop drives
 * the canvas AND this layer: the host passes the layer as the render loop's
 * sync companion.
 *
 * Edit sessions: `beginCreation` adds the object to the scene WITHOUT a
 * history entry; the commit planner (`text/commands/TextCommit`) decides at
 * session end whether the edit lands as add/update/remove (or nothing), so
 * empty fresh boxes vanish silently and every real edit is one undo step.
 * Rich sessions (text boxes) push exactly ONE `RichTextCommand` on exit —
 * the whole pre-edit document + box restores in a single undo (R3A.3).
 *
 * Geometry (R3A.7): FIXED boxes keep their width (text wraps, height
 * follows content); AUTO boxes grow to the longest line up to a maximum.
 * Growth is anchored per direction (RTL pins the right edge) and applied
 * live while typing + statically whenever a box's content document changes
 * (undo/redo, whole-document formatting).
 */
import type { Camera } from "@/core/camera/Camera";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { EventBus, AppEventMap } from "@/core/events/EventBus";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { IdGenerator } from "@/core/id/IdGenerator";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import type { Selection } from "@/core/selection/Selection";
import { vec2 } from "@/core/geometry/Vec2";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import { RemoveObjectCommand } from "@/core/commands/RemoveObjectCommand";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import { planTextCommit } from "@/text/commands/TextCommit";
import type { TextBearingObject } from "@/text/commands/TextCommit";
import {
  RichTextCommand,
  type RichTextSnapshot,
} from "@/text/commands/RichTextCommand";
import { getSharedTextEditor } from "@/text/editor/TipTapFactory";
import {
  createTableDocument,
  documentContainsTable,
  dominantTextDirection,
  emptyRichTextDocument,
  plainTextOfDocument,
  richTextFromPlainText,
  serializeRichText,
  TABLE_COL_WIDTH,
  TABLE_ROW_HEIGHT,
  type RichTextDocument,
} from "@/text/editor/richtext";
import {
  isTextBoxObject,
  textBoxFromRect,
  TEXT_PADDING_X,
  type TextBoxObjectData,
  type TextBoxSizeMode,
} from "@/core/model/TextBoxObject";
import {
  isStickyNoteObject,
  stickyNoteFromRect,
  type StickyNoteObjectData,
} from "@/core/model/StickyNoteObject";
import { TextObjectView } from "@/text/view/TextObjectView";
import type {
  ScreenViewport,
  TextObjectVariant,
} from "@/text/view/TextObjectView";
import { resolveContentGeometry } from "@/text/view/TextMetrics";

/** UI-provided labels (injected by the composition root, language-aware). */
export interface TextLayerLabels {
  /** Placeholder shown while the edited text is empty. */
  readonly placeholder: string;
  /** Placeholder shown while an edited sticky note is empty. */
  readonly stickyPlaceholder: string;
}

/** Dependencies of the text layer (constructor injection). */
export interface TextLayerDeps {
  /** Scene owning the text objects. */
  readonly scene: Scene;
  /** Selection updated when an edit session starts. */
  readonly selection: Selection;
  /** History recording committed text edits. */
  readonly history: HistoryManager;
  /** Id allocator for newly created text boxes. */
  readonly ids: IdGenerator;
  /** Bus carrying the edit lifecycle events. */
  readonly bus: EventBus<AppEventMap>;
  /** Resolves the current UI labels (placeholder) on demand. */
  readonly getLabels: () => TextLayerLabels;
  /** Default font family for NEW text objects (R8.2; optional — absent
   * keeps the object's font unset). */
  readonly getFontFamily?: () => string;
}

/** Owns the overlay DOM subtree for all text-bearing objects. */
export class TextLayerView {
  /** The overlay root element (null while detached). */
  private root: HTMLDivElement | null = null;

  /** Views by object id (mirrors the scene's text objects). */
  private readonly views = new Map<string, TextObjectView>();

  /** Id order seen at the last sync (DOM reorder detection). */
  private lastOrder: readonly string[] = [];

  /** The ongoing edit session, or null. */
  private session: EditSession | null = null;

  /** Live content-geometry state per static view (re-measure triggers). */
  private readonly staticGeometry = new Map<string, StaticGeometryKey>();

  /** The editor whose "update" events drive live geometry (rich sessions). */
  private geometryEditor: Editor | null = null;

  /** Camera wheel handler forwarded from the canvas bridge (R3A.2). */
  private cameraWheel: ((event: WheelEvent) => void) | null = null;

  /**
   * @param deps - injected layer dependencies.
   */
  public constructor(private readonly deps: TextLayerDeps) {
    // Commit the live edit when the user switches tools (Figma parity) and
    // keep the placeholder language-fresh mid-edit. Both subscriptions live
    // for the app's lifetime — the layer is an app-scoped service while
    // attach/detach only manage DOM presence (StrictMode-safe).
    this.deps.bus.on("ui:tool-changed", () => this.endEditing(true));
    this.deps.bus.on("ui:language-changed", () => {
      if (this.session === null) {
        return;
      }
      const placeholder = this.placeholderFor(this.session.objectId);
      if (this.session.rich) {
        if (placeholder !== null) {
          getSharedTextEditor().setPlaceholder(placeholder);
        }
      } else if (placeholder !== null) {
        this.views.get(this.session.objectId)?.setPlaceholder(placeholder);
      }
    });
  }

  /**
   * Attaches the layer into its container element.
   *
   * @param container - host element for the overlay layer (the canvas
   *        surface wrapper — the layer covers it exactly).
   */
  public attach(container: HTMLElement): void {
    if (this.root !== null) {
      return;
    }
    const root = document.createElement("div");
    root.className = LAYER_CLASS;
    root.addEventListener("focusout", this.onFocusOut);
    root.addEventListener("keydown", this.onKeyDown);
    root.addEventListener("wheel", this.onWheel, { passive: false });
    container.appendChild(root);
    this.root = root;
  }

  /** Detaches the layer from the DOM (the live edit commits first). */
  public detach(): void {
    this.endEditing(true);
    if (this.root !== null) {
      this.root.removeEventListener("focusout", this.onFocusOut);
      this.root.removeEventListener("keydown", this.onKeyDown);
      this.root.removeEventListener("wheel", this.onWheel);
      this.root.remove();
      this.root = null;
    }
    for (const view of this.views.values()) {
      view.unmount();
    }
    this.views.clear();
    this.staticGeometry.clear();
    this.lastOrder = [];
    // NOTE: the bus subscriptions survive detach — the layer is an
    // app-scoped service while attach/detach only manage DOM presence
    // (React StrictMode remounts must not kill the subscriptions).
  }

  /**
   * Installs the camera wheel handler forwarded from the canvas bridge:
   * wheel events over the live editor (the only pointer-enabled area of
   * the layer) re-drive camera pan/zoom so navigation stays available
   * while editing (R3A.2) except when a text selection is active.
   *
   * @param handler - the canvas wheel handler, or null to clear.
   */
  public setCameraWheelHandler(
    handler: ((event: WheelEvent) => void) | null,
  ): void {
    this.cameraWheel = handler;
  }

  /**
   * Syncs layer state to the camera after pan/zoom (compatibility wrapper:
   * the render loop calls {@link TextLayerView.sync} each frame instead).
   *
   * @param camera - the current viewport transform.
   */
  public syncToCamera(camera: Camera): void {
    this.sync(this.deps.scene, camera);
  }

  /**
   * One frame: reconciles the view set with the scene's text-bearing
   * objects (text boxes + sticky notes), reapplies
   * geometry/content/culling, fixes the DOM paint order when the scene
   * order changed, and re-measures boxes whose static content changed
   * (undo/redo or whole-document restyles) after the reconciliation loop.
   *
   * @param scene - the scene providing the text-bearing objects.
   * @param camera - the current viewport transform.
   */
  public sync(scene: Scene, camera: Camera): void {
    const root = this.root;
    if (root === null) {
      return;
    }
    const viewport = screenViewport(root);
    const present = new Set<string>();
    const order: string[] = [];
    const stale: TextBoxObjectData[] = [];
    for (const object of scene.objects) {
      if (!isTextBearing(object)) {
        continue;
      }
      present.add(object.id);
      order.push(object.id);
      let view = this.views.get(object.id);
      if (view === undefined) {
        view = new TextObjectView(object.id, variantOf(object));
        view.mount(root);
        this.views.set(object.id, view);
        this.staticGeometry.delete(object.id);
      }
      view.update(object, camera, viewport);
      // فاز ۲۵: pinned views own their selection affordance — report the
      // live membership so the CSS ring follows selection changes.
      view.setSelected(this.deps.selection.has(object.id));
      if (isTextBoxObject(object) && object.doc !== null && !view.isEditing) {
        const key = this.staticGeometry.get(object.id);
        if (
          key === undefined ||
          key.doc !== object.doc ||
          key.fontSize !== object.fontSize ||
          key.sizeMode !== object.sizeMode
        ) {
          stale.push(object);
        }
      }
    }
    for (const [id, view] of this.views) {
      if (!present.has(id)) {
        view.unmount();
        this.views.delete(id);
        this.staticGeometry.delete(id);
      }
    }
    if (order.join("|") !== this.lastOrder.join("|")) {
      for (const id of order) {
        const node = this.views.get(id)?.rootElement();
        if (node !== null && node !== undefined) {
          root.appendChild(node);
        }
      }
      this.lastOrder = order;
    }
    // Deferred (post-iteration) static re-measures: content-driven boxes
    // whose document/font/size-mode changed get their geometry refreshed
    // without a history entry.
    for (const object of stale) {
      this.refreshStaticGeometry(object);
    }
  }

  /**
   * Begins editing an existing text-bearing object: rich session for text
   * boxes (the shared TipTap editor mounts over the object), legacy
   * contentEditable session for sticky notes.
   *
   * @param objectId - id of the object to edit.
   */
  public beginEditing(objectId: string): void {
    const object = this.deps.scene.findById(objectId);
    if (object === undefined || !isTextBearing(object) || object.locked) {
      return;
    }
    this.endEditing(true);
    const view = this.ensureView(object);
    const placeholder =
      this.placeholderFor(object.id) ?? this.deps.getLabels().placeholder;
    if (isTextBoxObject(object)) {
      this.beginRichSession(object, view, placeholder, false);
    } else {
      view.enterEdit(placeholder);
      this.session = {
        objectId,
        newlyCreated: false,
        startedAt: Date.now(),
        rich: false,
        before: null,
        anchorDirection: "rtl",
      };
    }
    this.deps.selection.replaceAll([objectId]);
    this.deps.bus.emit("text:edit-began", { objectId });
  }

  /**
   * Creates a new text box at the requested rectangle and immediately
   * enters edit mode on it. The object is added to the scene without a
   * history entry — the commit planner decides the recording at session
   * end (fresh empty boxes vanish silently).
   *
   * @param rect - the requested box rectangle.
   * @param fontSize - the font size in world units.
   * @param sizeMode - FIXED (drag-out, wrapping) or AUTO (tap, grows to
   *        the longest line) — R3A.7.
   */
  public beginCreation(
    rect: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    fontSize: number,
    sizeMode: TextBoxSizeMode = "auto",
  ): void {
    this.endEditing(true);
    // AUTO boxes anchor their RIGHT edge at the tap point (RTL-first) and
    // start at the minimum caret width — the caret lands on the click and
    // the box grows leftward as text arrives (AC3A.6: no drift).
    const minWidth = 2 * TEXT_PADDING_X + Math.max(fontSize * 0.75, 8);
    const x = sizeMode === "auto" ? rect.x - minWidth : rect.x;
    const width = sizeMode === "auto" ? minWidth : Math.max(rect.width, 2);
    const object: TextBoxObjectData = {
      ...textBoxFromRect(
        {
          minX: x,
          minY: rect.y,
          maxX: x + width,
          maxY: rect.y + Math.max(rect.height, 2),
        },
        "",
        fontSize,
        this.deps.ids.next(),
        this.deps.scene.nextZIndex(),
        sizeMode,
      ),
      ...this.applyDefaultFontFamily(),
    };
    this.startCreationSession(object);
  }

  /**
   * Creates a new sticky note at the requested rectangle and immediately
   * enters edit mode on it. Same silent-creation contract as
   * {@link TextLayerView.beginCreation}: the commit planner decides the
   * history recording at session end (fresh empty notes vanish silently).
   *
   * @param rect - the requested card rectangle.
   * @param noteColor - the card background colour (CSS string).
   * @param fontSize - the font size in world units.
   */
  public beginStickyCreation(
    rect: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    noteColor: string,
    fontSize: number,
  ): void {
    this.endEditing(true);
    const object: StickyNoteObjectData = {
      ...stickyNoteFromRect(
        {
          minX: rect.x,
          minY: rect.y,
          maxX: rect.x + rect.width,
          maxY: rect.y + rect.height,
        },
        noteColor,
        "",
        fontSize,
        this.deps.ids.next(),
        this.deps.scene.nextZIndex(),
      ),
      ...this.applyDefaultFontFamily(),
    };
    this.startCreationSession(object);
  }

  /**
   * Creates a new table text box at the requested rectangle and
   * immediately enters edit mode with the caret in the first header cell
   * (R6.1/R6.7). The table document is built up front (RTL, classic
   * preset, first row as header) so the live editor, the commit planner
   * and persistence all see the same structure from the first frame; the
   * session commit records exactly ONE undo step carrying the table
   * (R6.8 — a fresh table with empty cells is "structural" content and
   * never auto-removed).
   *
   * @param rect - the requested box rectangle (tap → picker footprint).
   * @param rows - the row count.
   * @param cols - the column count.
   * @param fontSize - the font size in world units.
   */
  public beginTableCreation(
    rect: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    rows: number,
    cols: number,
    fontSize: number,
  ): void {
    this.endEditing(true);
    const width = Math.max(rect.width, cols * TABLE_COL_WIDTH);
    const height = Math.max(rect.height, rows * TABLE_ROW_HEIGHT + 8);
    const base = textBoxFromRect(
      {
        minX: rect.x,
        minY: rect.y,
        maxX: rect.x + width,
        maxY: rect.y + height,
      },
      "",
      fontSize,
      this.deps.ids.next(),
      this.deps.scene.nextZIndex(),
      "fixed",
    );
    const object: TextBoxObjectData = {
      ...base,
      doc: createTableDocument(rows, cols, {
        dir: "rtl",
        preset: "classic",
        withHeaderRow: true,
      }),
    };
    this.startCreationSession(object);
    this.placeCaretInFirstCell();
  }

  /**
   * Ends the live edit session, applying the commit plan.
   *
   * @param commit - whether the live text is kept (blur/tool-switch) —
   *        currently the only mode (Figma/Excalidraw keep text on Esc).
   */
  public endEditing(commit: boolean): void {
    const session = this.session;
    if (session === null) {
      return;
    }
    this.session = null;
    this.stopLiveGeometry();
    const view = this.views.get(session.objectId);
    const object = this.deps.scene.findById(session.objectId);
    if (view === undefined || object === undefined || !isTextBearing(object)) {
      if (session.rich) {
        getSharedTextEditor().detach();
        const fallbackDoc =
          object !== undefined && isTextBoxObject(object) ? object.doc : null;
        view?.exitRichEdit(fallbackDoc);
      } else {
        view?.exitEdit("");
      }
      this.deps.bus.emit("text:edit-ended", {
        objectId: session.objectId,
        committed: false,
      });
      return;
    }
    if (session.rich && isTextBoxObject(object)) {
      this.endRichSession(session, object, view, commit);
      return;
    }
    const newText = commit ? (view.editorText() ?? object.text) : object.text;
    const plan = planTextCommit({
      object,
      newlyCreated: session.newlyCreated,
      newText,
    });
    this.applyPlan(object, newText, plan.action, plan.recordHistory, view);
    this.deps.bus.emit("text:edit-ended", {
      objectId: session.objectId,
      committed: plan.action !== "remove",
    });
  }

  /** @returns the id of the object being edited, or null. */
  public get editingObjectId(): string | null {
    return this.session?.objectId ?? null;
  }

  /** @returns whether the live session is a rich (TipTap) session. */
  public get isRichEditing(): boolean {
    return this.session?.rich ?? false;
  }

  /**
   * Ends a rich session: reads the final document from the shared editor,
   * plans the commit and pushes exactly ONE command (R3A.3).
   */
  private endRichSession(
    session: EditSession,
    object: TextBoxObjectData,
    view: TextObjectView,
    commit: boolean,
  ): void {
    const service = getSharedTextEditor();
    const newDoc: RichTextDocument = commit
      ? service.getDocument()
      : (object.doc ?? emptyRichTextDocument());
    const newText = plainTextOfDocument(newDoc);
    const newDocJSON = serializeRichText(newDoc);
    const plan = planTextCommit({
      object,
      newlyCreated: session.newlyCreated,
      newText,
      newDocJSON,
      // A table-bearing document is structural content (R6.1): empty
      // cells must never trigger the auto-remove branches.
      newDocHasTable: documentContainsTable(newDoc),
      // The baseline is the PRE-SESSION document: live typing syncs the
      // document into the scene object without history, so the object's
      // current doc equals the live document at commit time.
      baselineDocJSON: serializeRichText(session.before?.doc ?? null),
    });
    service.detach();
    if (plan.action === "remove") {
      if (plan.recordHistory) {
        const command = new RemoveObjectCommand(this.deps.scene, object);
        command.do();
        this.deps.history.push(command);
      } else {
        this.deps.scene.remove(object.id);
      }
      view.exitRichEdit(null);
    } else if (plan.action === "add") {
      const finalObject: TextBoxObjectData = {
        ...object,
        doc: newDoc,
        text: newText,
      };
      const command = new AddObjectCommand(this.deps.scene, finalObject);
      command.do();
      this.deps.history.push(command);
      view.exitRichEdit(newDoc);
    } else if (plan.action === "update") {
      // ONE undo step: the whole pre-edit document + box restores (the
      // live geometry mutations during the session were history-free).
      const after: RichTextSnapshot = {
        doc: newDoc,
        text: newText,
        position: object.position,
        width: object.width,
        height: object.height,
      };
      const command = new RichTextCommand(
        this.deps.scene,
        object.id,
        session.before ?? snapshotOf(object),
        after,
      );
      command.do();
      this.deps.history.push(command);
      view.exitRichEdit(newDoc);
    } else {
      // Unchanged content: the live-synced doc already sits on the object;
      // render it back synchronously (no scene event fires for "none").
      view.exitRichEdit(newDoc);
    }
    this.deps.bus.emit("text:edit-ended", {
      objectId: session.objectId,
      committed: plan.action !== "remove",
    });
  }

  /**
   * Opens the rich edit session: mounts the shared editor into the view,
   * loads the object's document (upgrading legacy plain text) and starts
   * the live geometry listener.
   */
  private beginRichSession(
    object: TextBoxObjectData,
    view: TextObjectView,
    placeholder: string,
    newlyCreated: boolean,
  ): void {
    const service = getSharedTextEditor();
    service.setPlaceholder(placeholder);
    view.enterRichEdit(service);
    service.loadDocument(
      object.doc ?? richTextFromPlainText(object.text),
      placeholder,
      object.id,
    );
    this.session = {
      objectId: object.id,
      newlyCreated,
      startedAt: Date.now(),
      rich: true,
      before: snapshotOf(object),
      // The growth anchor is sticky for the whole session: the first-strong
      // heuristic must never flip sides mid-typing (a neutral "!" then an
      // English word would otherwise re-anchor the box and make it drift).
      anchorDirection: newlyCreated
        ? "rtl"
        : dominantTextDirection(
            object.doc ?? richTextFromPlainText(object.text),
          ),
    };
    service.focus();
    this.startLiveGeometry();
    this.guardRichFocus();
  }

  /**
   * The R8.2 default-font-family patch for NEW text objects: spreads the
   * user's chosen family onto a freshly built object (absent probe or
   * the default family "Vazirmatn" keeps the factory value).
   *
   * @returns the fontFamily field when one should apply.
   */
  private applyDefaultFontFamily(): { fontFamily?: string } {
    const probe = this.deps.getFontFamily;
    if (probe === undefined) {
      return {};
    }
    const family = probe();
    if (family.length === 0 || family === "Vazirmatn") {
      return {};
    }
    return { fontFamily: family };
  }

  /**
   * Adds the freshly assembled object to the scene (without history) and
   * opens the edit session on it — the shared tail of the creation flows.
   *
   * @param object - the pending creation object.
   */
  private startCreationSession(object: TextBearingObject): void {
    this.deps.scene.add(object);
    const view = this.ensureView(object);
    const labels = this.deps.getLabels();
    if (isTextBoxObject(object)) {
      this.beginRichSession(object, view, labels.placeholder, true);
    } else {
      view.enterEdit(labels.stickyPlaceholder);
      this.session = {
        objectId: object.id,
        newlyCreated: true,
        startedAt: Date.now(),
        rich: false,
        before: null,
        anchorDirection: "rtl",
      };
    }
    this.deps.selection.replaceAll([object.id]);
    this.deps.bus.emit("text:edit-began", { objectId: object.id });
  }

  /**
   * Moves the caret into the first cell of the document's first table
   * (table creation UX: typing lands INSIDE the table, not after it).
   * No-op when the loaded document has no table.
   */
  private placeCaretInFirstCell(): void {
    const service = getSharedTextEditor();
    const editor = service.tryGetEditor();
    if (editor === null) {
      return;
    }
    let cellPos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (
        cellPos === null &&
        (node.type.name === "tableCell" || node.type.name === "tableHeader")
      ) {
        cellPos = pos;
        return false;
      }
      return true;
    });
    if (cellPos === null) {
      return;
    }
    const inside = cellPos + 1;
    const target = TextSelection.near(editor.state.doc.resolve(inside));
    editor.view.dispatch(editor.state.tr.setSelection(target).scrollIntoView());
    // Focus WITHOUT repositioning: commands.focus() defaults to keeping
    // the live selection — service.focus() would jump the caret to the
    // document end (the table's last cell) and undo the placement above.
    editor.commands.focus();
  }

  /** Subscribes the live content-geometry refresh to the shared editor's
   * update events (fires per typing transaction — TipTap v2 `on` chains,
   * so the editor is kept for the symmetric `off`). */
  private startLiveGeometry(): void {
    this.stopLiveGeometry();
    const editor = getSharedTextEditor().getEditor();
    editor.on("update", this.onEditorUpdate);
    this.geometryEditor = editor;
  }

  /** Unsubscribes the live geometry listener. */
  private stopLiveGeometry(): void {
    if (this.geometryEditor !== null) {
      this.geometryEditor.off("update", this.onEditorUpdate);
      this.geometryEditor = null;
    }
  }

  /**
   * Live typing: sync the live document + projection into the scene
   * object (history-free) and re-apply the content-driven geometry — the
   * eventual commit still lands as ONE undo step because it compares
   * against the SESSION BASELINE, and mid-typing autosaves now capture
   * the real content (a tab refresh no longer loses the session).
   */
  private readonly onEditorUpdate = (): void => {
    const session = this.session;
    if (session === null || !session.rich) {
      return;
    }
    const object = this.deps.scene.findById(session.objectId);
    if (object === undefined || !isTextBoxObject(object)) {
      return;
    }
    const service = getSharedTextEditor();
    this.applyContentGeometry(object, session.anchorDirection, {
      doc: service.getDocument(),
      text: service.getPlainText(),
    });
  };

  /**
   * Re-measures a static (non-edited) box whose content key changed and
   * applies the resolved geometry (no history entry — derived state).
   *
   * @param object - the text box to refresh.
   */
  private refreshStaticGeometry(object: TextBoxObjectData): void {
    this.applyContentGeometry(object, dominantTextDirection(object.doc));
    this.staticGeometry.set(object.id, {
      doc: object.doc,
      fontSize: object.fontSize,
      sizeMode: object.sizeMode,
    });
  }

  /**
   * Measures the view of a text box and applies the content-driven
   * geometry (width/height/anchored x) — plus, for live typing, the live
   * document + plain projection — to the scene object directly.
   *
   * @param object - the text box being measured.
   * @param direction - the dominant text direction (RTL pins the right
   *        edge while growing).
   * @param liveContent - the live document + text (typing frames only).
   */
  private applyContentGeometry(
    object: TextBoxObjectData,
    direction: "rtl" | "ltr",
    liveContent?: { doc: RichTextDocument; text: string },
  ): void {
    const view = this.views.get(object.id);
    if (view === undefined) {
      return;
    }
    const naturalWidth = view.measureNaturalWidth();
    const base = {
      mode: object.sizeMode,
      naturalWidth,
      currentX: object.position.x,
      currentWidth: object.width,
      direction,
      fontSize: object.fontSize,
    };
    const pass = resolveContentGeometry({ ...base, naturalHeight: 0 });
    const naturalHeight = view.measureHeightAt(pass.width);
    const geometry = resolveContentGeometry({ ...base, naturalHeight });
    const nextX = round2(object.position.x + (geometry.x - base.currentX));
    const nextWidth = round2(geometry.width);
    const nextHeight = round2(geometry.height);
    const geometryChanged =
      Math.abs(nextWidth - object.width) >= 0.05 ||
      Math.abs(nextHeight - object.height) >= 0.05;
    const contentChanged =
      liveContent !== undefined &&
      (serializeRichText(liveContent.doc) !== serializeRichText(object.doc) ||
        liveContent.text !== object.text);
    if (!geometryChanged && !contentChanged) {
      return;
    }
    this.deps.scene.add(
      nextTextBox(
        object,
        nextX,
        geometryChanged ? nextWidth : object.width,
        geometryChanged ? nextHeight : object.height,
        liveContent?.doc ?? object.doc,
        liveContent?.text ?? object.text,
      ),
    );
  }

  /**
   * Re-focuses the shared editor after the opening interactions (the
   * initiating click hands focus to the body; popovers restore focus to
   * their triggers a frame later) — three horizons like the legacy path.
   */
  private guardRichFocus(): void {
    const refocus = (delay: number): void => {
      window.setTimeout(() => {
        const session = this.session;
        if (session === null || !session.rich) {
          return;
        }
        const active = document.activeElement;
        if (active === null || active === document.body) {
          getSharedTextEditor().focus();
        }
      }, delay);
    };
    refocus(0);
    refocus(120);
    refocus(300);
  }

  /**
   * Executes one commit plan action (legacy plain sessions only — rich
   * sessions route through {@link TextLayerView.endRichSession}).
   *
   * @param object - the object as it sits in the scene.
   * @param newText - the final live text.
   * @param action - the planned action.
   * @param recordHistory - whether the action lands in history.
   * @param view - the view hosting the live editor.
   */
  private applyPlan(
    object: TextBearingObject,
    newText: string,
    action: "none" | "add" | "update" | "remove",
    recordHistory: boolean,
    view: TextObjectView,
  ): void {
    if (action === "remove") {
      if (recordHistory) {
        const command = new RemoveObjectCommand(this.deps.scene, object);
        command.do();
        this.deps.history.push(command);
      } else {
        this.deps.scene.remove(object.id);
      }
      view.exitEdit("");
      return;
    }
    if (action === "add") {
      const finalObject: TextBearingObject = { ...object, text: newText };
      const command = new AddObjectCommand(this.deps.scene, finalObject);
      command.do();
      this.deps.history.push(command);
      view.exitEdit(newText);
      return;
    }
    if (action === "update") {
      const command = new UpdateObjectCommand(
        this.deps.scene,
        object.id,
        { text: newText },
        object,
      );
      command.do();
      this.deps.history.push(command);
      view.exitEdit(newText);
      return;
    }
    view.exitEdit(object.text);
  }

  /**
   * Resolves the kind-appropriate placeholder of an object.
   *
   * @param objectId - id of the (possibly edited) object.
   * @returns the placeholder string, or null when the object is gone.
   */
  private placeholderFor(objectId: string): string | null {
    const object = this.deps.scene.findById(objectId);
    if (object === undefined) {
      return null;
    }
    const labels = this.deps.getLabels();
    return isStickyNoteObject(object)
      ? labels.stickyPlaceholder
      : labels.placeholder;
  }

  /**
   * Ensures a view exists and is mounted for the given object.
   *
   * @param object - the object needing a view.
   * @returns the view.
   */
  private ensureView(object: TextBearingObject): TextObjectView {
    const root = this.root;
    if (root === null) {
      throw new Error("text layer is not attached");
    }
    let view = this.views.get(object.id);
    if (view === undefined) {
      view = new TextObjectView(object.id, variantOf(object));
      view.mount(root);
      this.views.set(object.id, view);
      view.update(object, this.deps.scene.camera, screenViewport(root));
    }
    return view;
  }

  /**
   * Focus left the live editor (click-away, toolbar, window switch): the
   * session commits with the typed text — unless the new focus owner is
   * the floating format UI (its buttons only borrow the click, they never
   * end the session).
   */
  private readonly onFocusOut = (event: FocusEvent): void => {
    const session = this.session;
    if (session === null) {
      return;
    }
    const node = this.views.get(session.objectId)?.rootElement();
    if (node === null || node === undefined) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node) || !node.contains(target)) {
      return;
    }
    // Defer one task so an intra-frame focus move (re-focus) is not
    // mistaken for a click-away, and honour the opening grace period: a
    // focus loss within FOCUS_GRACE_MS of the session start is treated as a
    // transient steal (e.g. a popover's deferred focus restoration firing
    // after the editor grabbed focus), not a real click-away — otherwise a
    // freshly created note could be silently discarded before the user
    // types anything.
    window.setTimeout(() => {
      const current = this.session;
      if (current === null) {
        return;
      }
      const active = document.activeElement;
      if (active !== null && (node.contains(active) || isFormatUi(active))) {
        return;
      }
      if (Date.now() - current.startedAt < FOCUS_GRACE_MS) {
        return;
      }
      this.endEditing(true);
    }, 0);
  };

  /**
   * Escape or Ctrl+Enter inside the live editor: the session ends keeping
   * the typed text (Figma/Excalidraw rule).
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.session === null) {
      return;
    }
    if (
      event.key === "Escape" ||
      (event.key === "Enter" && (event.ctrlKey || event.metaKey))
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.endEditing(true);
    }
  };

  /**
   * Wheel events bubbling from the live editor re-drive camera pan/zoom
   * (R3A.2) except while a text selection is active.
   */
  private readonly onWheel = (event: WheelEvent): void => {
    if (this.session !== null) {
      const editor = getSharedTextEditor().tryGetEditor();
      if (editor !== null && !editor.state.selection.empty) {
        event.preventDefault();
        return;
      }
    }
    if (this.cameraWheel !== null) {
      event.preventDefault();
      this.cameraWheel(event);
    }
  };
}

/** The ongoing edit session facts. */
interface EditSession {
  /** The edited object id. */
  readonly objectId: string;
  /** Whether this session also created the object. */
  readonly newlyCreated: boolean;
  /** When the session started (epoch ms; drives the focus grace period). */
  readonly startedAt: number;
  /** Whether this is a rich TipTap session (text box). */
  readonly rich: boolean;
  /** The object state before the session (rich sessions; null otherwise). */
  readonly before: RichTextSnapshot | null;
  /** Sticky growth anchor side (RTL pins the right edge) — R3A.7/AC3A.6. */
  readonly anchorDirection: "rtl" | "ltr";
}

/** Static geometry re-measure key per object. */
interface StaticGeometryKey {
  readonly doc: RichTextDocument | null;
  readonly fontSize: number;
  readonly sizeMode: TextBoxSizeMode;
}

/**
 * Captures the rich-edit snapshot of a text box (document + projection +
 * content-driven box geometry).
 *
 * @param object - the text box.
 * @returns the snapshot.
 */
function snapshotOf(object: TextBoxObjectData): RichTextSnapshot {
  return {
    doc: object.doc,
    text: object.text,
    position: object.position,
    width: object.width,
    height: object.height,
  };
}

/**
 * @param element - the focused element to inspect.
 * @returns whether the element belongs to the floating format UI.
 */
function isFormatUi(element: Element): boolean {
  return element.closest("[data-text-format-ui]") !== null;
}

/**
 * @param value - the value to round.
 * @returns the value rounded to 1/100 world units.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Assembles the measured geometry replacement of a text box.
 *
 * @param object - the text box being resized.
 * @param x - the anchored x position.
 * @param width - the content-driven width.
 * @param height - the content-driven height.
 * @param doc - the replacement document (live typing).
 * @param text - the replacement plain projection (live typing).
 * @returns the replacement object data.
 */
function nextTextBox(
  object: TextBoxObjectData,
  x: number,
  width: number,
  height: number,
  doc: RichTextDocument | null = object.doc,
  text: string = object.text,
): TextBoxObjectData {
  return {
    ...object,
    position: vec2(x, object.position.y),
    width,
    height,
    doc,
    text,
  };
}

/**
 * @param object - the scene object to inspect.
 * @returns whether the object is rendered/edited by this layer.
 */
function isTextBearing(object: SceneObjectData): object is TextBearingObject {
  return isTextBoxObject(object) || isStickyNoteObject(object);
}

/**
 * @param object - a text-bearing object.
 * @returns the DOM view variant matching its kind.
 */
function variantOf(object: TextBearingObject): TextObjectVariant {
  return object.kind === "stickyNote" ? "card" : "plain";
}

/**
 * Computes the screen-space culling bounds of the layer element.
 *
 * @param root - the layer root element providing the size.
 * @returns the screen-space bounds (the layer covers the viewport).
 */
function screenViewport(root: HTMLElement): ScreenViewport {
  return { minX: 0, minY: 0, maxX: root.clientWidth, maxY: root.clientHeight };
}

/** Base classes of the layer root (Tailwind-scanned literals). */
const LAYER_CLASS =
  "text-layer pointer-events-none absolute inset-0 overflow-hidden z-[5]";

/**
 * Focus-loss grace period after a session opens (ms). Focus moves inside
 * this window are treated as transient steals (the opening click's focus
 * hand-off, a popover's deferred focus restoration), not click-aways.
 */
const FOCUS_GRACE_MS = 350;
