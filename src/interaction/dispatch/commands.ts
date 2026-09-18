/**
 * The core command catalog (R3B5.2/R3B5.3): EVERY user-invokable action of
 * the pre-refactor app, migrated to registered commands under the reserved
 * `core.` owner (§1.7.2). The registry is the single source of truth the
 * toolbar, menus, the global keyboard handler AND the future command
 * palette (Phase 7) render/dispatch FROM.
 *
 * Dependency injection keeps this module layering-clean: service keys and
 * UI-facing behaviours arrive through {@link CoreCommandWiring} (the
 * composition root binds them), so interaction/ never imports ui/ and
 * stays node-testable.
 */
import type { ServiceKey } from "@/AppContext";
import type {
  CommandContext,
  CommandEntry,
  CommandRegistry,
} from "@/core/registry/CommandRegistry";
import type { Scene } from "@/core/model/Scene";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { Selection } from "@/core/selection/Selection";
import type { IdGenerator } from "@/core/id/IdGenerator";
import type { CameraController } from "@/core/camera/CameraController";
import { objectBBox, type SceneObjectData } from "@/core/model/SceneObject";
import { isPinnableObject, isPinnedObject } from "@/core/model/Pinned";
import {
  deleteSelection,
  duplicateSelection,
  flushNudgeHistory,
  groupSelection,
  toggleLockSelection,
  ungroupSelection,
  zOrderSelection,
} from "@/core/commands/SelectionOps";
import {
  alignSelection,
  distributeSelection,
  type AlignMode,
  type DistributeAxis,
} from "@/core/commands/AlignDistribute";
import type { ZOrderOp } from "@/core/commands/ZOrderOps";
import {
  isImageObject,
  imageInsertStateDrifted,
  imageSizeDrifted,
  type ImageObjectData,
} from "@/core/model/ImageObject";
import type { LinkRegistry } from "@/core/knowledge/LinkRegistry";
import { removeAllManualLinksCommand } from "@/core/commands/LinkCommands";
import type { KnowledgeService } from "@/core/knowledge/KnowledgeService";
import { graphArrangeEligible } from "@/core/knowledge/GraphArrange";

/** Text-editor actions the wiring executes against the live editor. */
export type EditorTextAction =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "subscript"
  | "superscript"
  | "zwnj"
  | "insertDate"
  | "insertDateNumeric"
  | "clearFormatting"
  | "heading1"
  | "heading2"
  | "heading3"
  | "paragraph"
  | "blockquote"
  | "codeBlock"
  | "horizontalRule"
  | "bulletList"
  | "orderedList"
  | "taskList";

/** Canvas tool ids (string-typed: the wiring binds the real union). */
export type ToolCommandId =
  | "select"
  | "hand"
  | "pen"
  | "eraser"
  | "text"
  | "sticky"
  | "table"
  | "shape"
  | "connector";

/**
 * Rich-text TABLE actions (R6.1–R6.5): executed against the live shared
 * editor by the wiring's table executor. The direction-aware column
 * inserts carry VISUAL semantics — the executor resolves the table's
 * current direction and picks the logical TipTap command.
 */
export type TableAction =
  | "insert"
  | "insertRowAbove"
  | "insertRowBelow"
  | "deleteRow"
  | "insertColumnLeft"
  | "insertColumnRight"
  | "deleteColumn"
  | "deleteTable"
  | "mergeCells"
  | "splitCellHorizontal"
  | "splitCellVertical"
  | "toggleHeaderRow"
  | "toggleHeaderColumn"
  | "toggleDirection"
  | "distributeColumns"
  | "alignCellTop"
  | "alignCellMiddle"
  | "alignCellBottom"
  | `preset:${string}`;

/** The composition-root bindings the catalog executes through. */
export interface CoreCommandWiring {
  /** Service keys resolved lazily through the dispatch context. */
  readonly keys: {
    readonly scene: ServiceKey<Scene>;
    readonly history: ServiceKey<HistoryManager>;
    readonly selection: ServiceKey<Selection>;
    readonly idGenerator: ServiceKey<IdGenerator>;
    readonly cameraController: ServiceKey<CameraController>;
    /** Structural contracts: the composition root's concrete keys are
     * covariant-assignable, and tests can register stub services. */
    readonly autosave: ServiceKey<{
      saveNow: (reason?: "auto" | "manual" | "flush") => Promise<boolean>;
    }>;
    readonly textLayer: ServiceKey<{ beginEditing: (id: string) => void }>;
    /** Pack R11.2/R11.6: §1.7.8's link store (the unlink command). */
    readonly links: ServiceKey<LinkRegistry>;
    /** The knowledge service (pack R12.3's arrange eligibility probe). */
    readonly knowledge: ServiceKey<KnowledgeService>;
  };
  /** UI behaviours (bound to the UI store / event bus by the root). */
  readonly ui: {
    /** Activates a canvas tool. */
    readonly activateTool: (tool: ToolCommandId) => void;
    /** Toggles the background grid. */
    readonly toggleGrid: () => void;
    /** Opens the link dialog (Ctrl+K flow). */
    readonly openLinkDialog: () => void;
    /** Opens the Find & Replace panel (Ctrl+F flow). */
    readonly openFind: () => void;
    /** Starts the New Project flow (R4.5: unsaved-changes guarded). */
    readonly newProject: () => void;
    /** Starts the Open Project flow (R4.5: unsaved-changes guarded). */
    readonly openProject: () => void;
    /** Saves the current file — or starts Save-As when unpathed (R4.5). */
    readonly saveProject: () => void;
    /** Starts the Save-As flow with a fresh path pick (R4.5). */
    readonly saveProjectAs: () => void;
    /** Opens the Export PNG dialog (R4.8). */
    readonly openExportPng: () => void;
    /** Opens the Export dialog on the SVG format (R8.7). */
    readonly openExportSvg: () => void;
    /** Opens the Export dialog on the PDF format (R8.7). */
    readonly openExportPdf: () => void;
    /** Exports the selection's (or the whole scene's) text content —
     * including TABLES — as a real Word `.docx` file download
     * (فاز ۳۶ «جدول به ورد»). */
    readonly exportWord: () => void;
    /** Opens the Insert Image dialog (R5.2). */
    readonly insertImage: () => void;
    /** Opens the Insert Video dialog (فاز M1 — the video card's
     * registered insert action opens the file picker, A.2.6). */
    readonly insertVideo: () => void;
    /** Opens the Insert Audio dialog (فاز A1 — the audio card's
     * registered insert action opens the file picker, A.2.6). */
    readonly insertAudio: () => void;
    /** Opens the Insert PDF dialog (فاز P1 — the PDF card's registered
     * insert action opens the file picker, A.2.6). */
    readonly insertPdf: () => void;
    /** Opens the bookmark-name prompt (R7.9, Ctrl+Shift+B). */
    readonly promptBookmark: () => void;
    /** Opens the command palette (R7.11, Ctrl+K outside the editor). */
    readonly openCommandPalette: () => void;
    /** Opens the composed Settings dialog (R8.2, Ctrl+,). */
    readonly openSettings: () => void;
    /** Opens the sticker-library picker dialog (R12.1, Ctrl+Shift+K). */
    readonly openStickerPicker: () => void;
    /** Toggles presentation mode (R8.3, F5). */
    readonly togglePresentation: () => void;
    /** Toggles one registered dock panel by id (R7.1). */
    readonly togglePanel: (panelId: string) => void;
    /** Inserts an Insert-Panel card at the viewport centre (R7.12). */
    readonly insertCard: (typeId: string, cardKey: string) => void;
    /** Opens the Markdown interop dialog (R13.1) on a tab. */
    readonly openMarkdownDialog: (tab: "export" | "import") => void;
    /** Copies a deep link to the first selected object (R13.2). */
    readonly copyDeepLink: () => void;
    /** Opens the manual-link target picker (pack R11.6 «لینک به این شیء…»). */
    readonly openLinkPicker: (sourceId: string) => void;
    /** Runs the force-directed knowledge-graph arrange (pack R12.3). */
    readonly arrangeKnowledgeGraph: () => void;
    /** Toggles the on-canvas knowledge-edge overlay (pack R12.4). */
    readonly toggleKnowledgeEdges: () => void;
    /** Copies the selection (internal buffer + system clipboard, P23). */
    readonly copySelection: () => void;
    /** Cuts the selection (copy + one-step removal, P23). */
    readonly cutSelection: () => void;
    /** Pastes the internal buffer — or the system clipboard when empty. */
    readonly pasteFromClipboard: () => void;
    /** Copies the single selected image to the OS clipboard (PNG, original size). */
    readonly copyImageToSystem: () => void;
    /** Rasterises ANY selection into a PNG on the OS clipboard (فاز ۲۴). */
    readonly copySelectionAsImage: () => void;
    /** Resets the single selected image to its natural size (P23).
     * @returns whether a reset command ran. */
    readonly resetImageToNatural: () => boolean;
    /** Restores the single selected image to its «زمان صفر» insert
     * snapshot — placed size/position/rotation (فاز ۳۴).
     * @returns whether a reset command ran. */
    readonly resetImageToInsertState: () => boolean;
    /**
     * Toggles the selection's screen pin (فاز ۲۵ — «سنجاش روی صفحه»):
     * resolves the viewport, runs `togglePinSelection`, and surfaces the
     * Persian notice.
     * @returns whether any pin state changed.
     */
    readonly togglePin: () => boolean;
  };
  /** Rich-text editor actions (bound to the shared TipTap editor). */
  readonly text: {
    /** Runs one editor action; false when no live editor accepts it. */
    readonly runEditorAction: (action: EditorTextAction) => boolean;
    /** Whether a live editing session is mounted (painter availability). */
    readonly hasLiveEditor: () => boolean;
    /** Copies the selection's formatting into the painter (R7.5). */
    readonly copyFormat: () => boolean;
    /** Applies the painter clipboard onto the selection (R7.5). */
    readonly applyFormat: () => boolean;
  };
  /** Rich-text TABLE actions (R6.1–R6.5, bound to the shared editor). */
  readonly table: {
    /** Runs one table action; false when no live editor accepts it. */
    readonly runTableAction: (action: TableAction) => boolean;
    /** Probes one table action's availability (menu disabled states). */
    readonly canTableAction: (action: TableAction) => boolean;
  };
}

/** Zoom factor per zoom-in/out command press. */
const KEY_ZOOM_FACTOR = 1.25;

/**
 * Whether an object carries exportable text (فاز ۳۶): rich/plain text
 * boxes and sticky notes — the Word export's aggregation set.
 *
 * @param object - the object to probe.
 * @returns whether the object contributes to the Word file.
 */
function isTextualObject(object: SceneObjectData): boolean {
  return object.kind === "textBox" || object.kind === "stickyNote";
}

/**
 * Registers the whole core catalog onto a command registry.
 *
 * @param registry - the target registry (typically empty).
 * @param wiring - the composition-root bindings.
 * @returns the registry (chaining).
 */
export function registerCoreCommands(
  registry: CommandRegistry,
  wiring: CoreCommandWiring,
): CommandRegistry {
  const editorActions: Array<[EditorTextAction, string, string, number]> = [
    ["bold", "textFormat.bold", "text.format", 10],
    ["italic", "textFormat.italic", "text.format", 11],
    ["underline", "textFormat.underline", "text.format", 12],
    ["strike", "textFormat.strike", "text.format", 13],
    ["subscript", "textFormat.subscript", "text.format", 14],
    ["superscript", "textFormat.superscript", "text.format", 15],
    ["zwnj", "textFormat.zwnj", "text.format", 30],
    // R8.3: the Jalali "insert current date" pair (long + numeric).
    ["insertDate", "textFormat.insertDate", "text.insert", 34],
    ["insertDateNumeric", "textFormat.insertDateNumeric", "text.insert", 35],
    ["clearFormatting", "textFormat.clearFormatting", "text.format", 31],
  ];
  const blockActions: Array<[EditorTextAction, string, number]> = [
    ["paragraph", "textFormat.paragraph", 0],
    ["heading1", "textFormat.heading1", 1],
    ["heading2", "textFormat.heading2", 2],
    ["heading3", "textFormat.heading3", 3],
    ["blockquote", "textFormat.blockquote", 4],
    ["codeBlock", "textFormat.codeBlock", 5],
    ["horizontalRule", "textFormat.horizontalRule", 6],
    ["bulletList", "textFormat.bulletList", 7],
    ["orderedList", "textFormat.orderedList", 8],
    ["taskList", "textFormat.taskList", 9],
  ];

  const commands: CommandEntry[] = [
    /* ── edit ───────────────────────────────────────────────────────── */
    {
      id: "core.edit.undo",
      titleKey: "a11y.undo",
      shortcut: "Mod-Z",
      group: "edit" as const,
      order: 0,
      execute: (ctx) => {
        const history = ctx.services.tryGet(wiring.keys.history);
        if (history !== undefined) {
          flushNudgeHistory(history);
          history.undo();
        }
      },
      isEnabled: (ctx) =>
        ctx.services.tryGet(wiring.keys.history)?.canUndo() ?? false,
    },
    {
      id: "core.edit.redo",
      titleKey: "a11y.redo",
      shortcut: "Mod-Shift-Z",
      group: "edit" as const,
      order: 1,
      execute: (ctx) => {
        const history = ctx.services.tryGet(wiring.keys.history);
        if (history !== undefined) {
          flushNudgeHistory(history);
          history.redo();
        }
      },
      isEnabled: (ctx) =>
        ctx.services.tryGet(wiring.keys.history)?.canRedo() ?? false,
    },
    {
      id: "core.edit.redoAlternate",
      titleKey: "a11y.redo",
      shortcut: "Mod-Y",
      group: "edit" as const,
      order: 2,
      execute: (ctx) => {
        const history = ctx.services.tryGet(wiring.keys.history);
        if (history !== undefined) {
          flushNudgeHistory(history);
          history.redo();
        }
      },
    },
    /* ── Phase 23 «پل کلیپ‌بورد»: copy / cut / paste — the selection
     *    clipboard plus the OS bridge (Word, Photoshop, After Effects…). */
    {
      id: "core.edit.copy",
      titleKey: "clipboard.copyCommand",
      shortcut: "Mod-C",
      group: "edit" as const,
      order: 3,
      execute: () => wiring.ui.copySelection(),
      isEnabled: (ctx) =>
        !(ctx.services.tryGet(wiring.keys.selection)?.isEmpty() ?? true),
    },
    {
      id: "core.edit.cut",
      titleKey: "clipboard.cutCommand",
      shortcut: "Mod-X",
      group: "edit" as const,
      order: 4,
      execute: () => wiring.ui.cutSelection(),
      isEnabled: (ctx) =>
        !(ctx.services.tryGet(wiring.keys.selection)?.isEmpty() ?? true),
    },
    {
      // No shortcut BY DESIGN: the raw Mod-V gesture (useCanvasShortcuts)
      // routes to this command only when the INTERNAL buffer has content;
      // an empty buffer lets the browser's paste event flow to the import
      // bridge (OS images/text) instead.
      id: "core.edit.paste",
      titleKey: "clipboard.pasteCommand",
      group: "edit" as const,
      order: 5,
      execute: () => wiring.ui.pasteFromClipboard(),
    },
    {
      // فاز ۲۴ «کپی چندشیء به‌صورت تصویر»: the explicit snapshot command —
      // ANY selection rasterises into a transparent 2x image/png (the
      // implicit Mod-C copy already rasters multi-object selections; this
      // command also covers lone text boxes and is the palette entry).
      id: "core.edit.copyAsImage",
      titleKey: "clipboard.copyAsImageCommand",
      shortcut: "Mod-Alt-C",
      group: "edit" as const,
      order: 6,
      execute: () => wiring.ui.copySelectionAsImage(),
      isEnabled: (ctx) =>
        !(ctx.services.tryGet(wiring.keys.selection)?.isEmpty() ?? true),
    },
    /* ── file (R4.5): New / Open / Save / Save As — registered commands,
     *    unsaved-changes guarded, wired through the document lifecycle. */
    {
      id: "core.file.new",
      titleKey: "file.new",
      shortcut: "Mod-N",
      group: "file" as const,
      order: 0,
      execute: () => wiring.ui.newProject(),
    },
    {
      id: "core.file.open",
      titleKey: "file.open",
      shortcut: "Mod-O",
      group: "file" as const,
      order: 1,
      execute: () => wiring.ui.openProject(),
    },
    {
      id: "core.file.save",
      titleKey: "file.save",
      shortcut: "Mod-S",
      group: "file" as const,
      order: 2,
      execute: () => wiring.ui.saveProject(),
    },
    {
      id: "core.file.saveAs",
      titleKey: "file.saveAs",
      shortcut: "Mod-Shift-S",
      group: "file" as const,
      order: 3,
      execute: () => wiring.ui.saveProjectAs(),
    },
    {
      id: "core.export.png",
      titleKey: "file.exportPng",
      group: "export" as const,
      order: 0,
      execute: () => wiring.ui.openExportPng(),
    },
    {
      id: "core.export.svg",
      titleKey: "file.exportSvg",
      group: "export" as const,
      order: 1,
      execute: () => wiring.ui.openExportSvg(),
    },
    {
      id: "core.export.pdf",
      titleKey: "file.exportPdf",
      group: "export" as const,
      order: 2,
      execute: () => wiring.ui.openExportPdf(),
    },
    {
      // R13.1: the Markdown interop dialog (export tab).
      id: "core.export.markdown",
      titleKey: "file.exportMarkdown",
      group: "export" as const,
      order: 3,
      execute: () => wiring.ui.openMarkdownDialog("export"),
    },
    {
      // R13.1: the Markdown interop dialog (import tab).
      id: "core.import.markdown",
      titleKey: "file.importMarkdown",
      group: "export" as const,
      order: 4,
      execute: () => wiring.ui.openMarkdownDialog("import"),
    },
    {
      // فاز ۳۶ «جدول به ورد»: the text/table → Word FILE export. The
      // SELECTION's text-bearing objects travel out when any are picked,
      // else the whole scene's — real `w:tbl` tables, Word heading
      // styles, lists and links inside a downloadable .docx.
      id: "core.export.word",
      titleKey: "file.exportWord",
      group: "export" as const,
      order: 5,
      execute: () => wiring.ui.exportWord(),
      isEnabled: (ctx) => {
        const scene = ctx.services.tryGet(wiring.keys.scene);
        if (scene === undefined) {
          return false;
        }
        const selection = ctx.services.tryGet(wiring.keys.selection);
        const selectedTextual = [...(selection?.ids ?? [])].some((id) => {
          const object = scene.findById(id);
          return object !== undefined && isTextualObject(object);
        });
        return selectedTextual || scene.objects.some(isTextualObject);
      },
    },
    {
      // R13.2: copy a deep link to the first selected object.
      id: "core.link.copyDeepLink",
      titleKey: "deeplink.copyCommand",
      group: "view" as const,
      order: 8,
      execute: () => wiring.ui.copyDeepLink(),
    },
    {
      id: "core.app.settings",
      titleKey: "settings.title",
      shortcut: "Mod-Comma",
      group: "project" as const,
      order: 5,
      execute: () => wiring.ui.openSettings(),
    },
    {
      id: "core.insert.image",
      titleKey: "project.insertImage",
      group: "file" as const,
      order: 4,
      execute: () => wiring.ui.insertImage(),
    },
    // فاز M1 (A.2.6): the Insert-Panel video card's registered insert
    // action — the file picker (never a contentless placeholder).
    {
      id: "core.insert.video",
      titleKey: "project.insertVideo",
      group: "file" as const,
      order: 5,
      execute: () => wiring.ui.insertVideo(),
    },
    // فاز A1 (A.2.6): the audio card's insert action opens the file
    // picker — never a contentless placeholder.
    {
      id: "core.insert.audio",
      titleKey: "project.insertAudio",
      group: "file" as const,
      order: 6,
      execute: () => wiring.ui.insertAudio(),
    },
    // فاز P1 (A.2.6): the PDF card's insert action opens the file
    // picker — never a contentless placeholder.
    {
      id: "core.insert.pdf",
      titleKey: "project.insertPdf",
      group: "file" as const,
      order: 7,
      execute: () => wiring.ui.insertPdf(),
    },
    // R12.1: Ctrl+Shift+K («کتابخانه») opens the sticker library picker —
    // the full ~230-glyph catalog with search, categories and recents.
    {
      id: "core.insert.stickerLibrary",
      titleKey: "stickerLibrary.command",
      shortcut: "Mod-Shift-K",
      group: "insert" as const,
      order: 5,
      execute: () => wiring.ui.openStickerPicker(),
    },

    /* ── view ───────────────────────────────────────────────────────── */
    {
      id: "core.view.zoomIn",
      titleKey: "a11y.zoomIn",
      shortcut: "Mod-Equal",
      group: "view" as const,
      order: 0,
      execute: (ctx) => zoomFromKeyboard(ctx, KEY_ZOOM_FACTOR, wiring),
    },
    {
      id: "core.view.zoomOut",
      titleKey: "a11y.zoomOut",
      shortcut: "Mod-Minus",
      group: "view" as const,
      order: 1,
      execute: (ctx) => zoomFromKeyboard(ctx, 1 / KEY_ZOOM_FACTOR, wiring),
    },
    {
      id: "core.view.resetZoom",
      titleKey: "a11y.resetZoom",
      shortcut: "Mod-0",
      group: "view" as const,
      order: 2,
      execute: (ctx) =>
        ctx.services.tryGet(wiring.keys.cameraController)?.reset(),
    },
    {
      id: "core.view.fitAll",
      titleKey: "a11y.fitAll",
      shortcut: "Mod-1",
      group: "view" as const,
      order: 3,
      execute: (ctx) => fitToContent(ctx, wiring),
    },
    {
      id: "core.view.toggleGrid",
      titleKey: "a11y.toggleGrid",
      shortcut: "Mod-Quote",
      group: "view" as const,
      order: 4,
      execute: () => wiring.ui.toggleGrid(),
    },
    {
      // Pack R12.3: the force-directed knowledge-graph arrange — every
      // titled object lands at its graph position as ONE undo step.
      id: "core.graph.arrange",
      titleKey: "knowledge.arrangeCommand",
      icon: "Network",
      group: "view" as const,
      order: 5,
      execute: () => wiring.ui.arrangeKnowledgeGraph(),
      isEnabled: (ctx) => {
        const knowledge = ctx.services.tryGet(wiring.keys.knowledge);
        return knowledge !== undefined && graphArrangeEligible(knowledge.current());
      },
    },
    {
      // Pack R12.4: the on-canvas knowledge-edge overlay toggle.
      id: "core.graph.toggleEdges",
      titleKey: "knowledge.edgesCommand",
      icon: "Spline",
      shortcut: "Mod-Shift-E",
      group: "view" as const,
      order: 6,
      execute: () => wiring.ui.toggleKnowledgeEdges(),
    },

    /* ── selection ──────────────────────────────────────────────────── */
    {
      id: "core.selection.clear",
      titleKey: "a11y.clearSelection",
      shortcut: "Escape",
      group: "selection" as const,
      order: 0,
      execute: (ctx) => {
        ctx.services.tryGet(wiring.keys.selection)?.clear();
      },
    },
    {
      id: "core.selection.selectAll",
      titleKey: "a11y.selectAll",
      shortcut: "Mod-A",
      group: "selection" as const,
      order: 1,
      execute: (ctx) => {
        const scene = ctx.services.tryGet(wiring.keys.scene);
        const selection = ctx.services.tryGet(wiring.keys.selection);
        if (scene !== undefined && selection !== undefined) {
          selection.replaceAll(scene.objects.map((object) => object.id));
        }
      },
    },
    {
      id: "core.selection.duplicate",
      titleKey: "selectionActions.duplicate",
      shortcut: "Mod-D",
      group: "selection" as const,
      order: 2,
      execute: (ctx) => {
        const services = resolveSelectionServices(ctx, wiring);
        if (services !== null) {
          duplicateSelection(
            services.scene,
            services.history,
            services.selection,
            services.ids,
          );
        }
      },
    },
    {
      id: "core.selection.delete",
      titleKey: "selectionActions.delete",
      shortcut: "Delete",
      group: "selection" as const,
      order: 3,
      execute: (ctx) => {
        const services = resolveSelectionServices(ctx, wiring);
        if (services !== null) {
          deleteSelection(services.scene, services.history, services.selection);
        }
      },
      isEnabled: (ctx) =>
        !ctx.services.tryGet(wiring.keys.selection)?.isEmpty(),
    },
    {
      id: "core.selection.deleteBackspace",
      titleKey: "selectionActions.delete",
      shortcut: "Backspace",
      group: "selection" as const,
      order: 4,
      execute: (ctx) => {
        const services = resolveSelectionServices(ctx, wiring);
        if (services !== null) {
          deleteSelection(services.scene, services.history, services.selection);
        }
      },
      isEnabled: (ctx) =>
        !ctx.services.tryGet(wiring.keys.selection)?.isEmpty(),
    },
    {
      id: "core.selection.group",
      titleKey: "selectionActions.group",
      shortcut: "Mod-G",
      group: "selection" as const,
      order: 5,
      execute: (ctx) => {
        const services = resolveSelectionServices(ctx, wiring);
        if (services !== null) {
          groupSelection(
            services.scene,
            services.history,
            services.selection,
            services.ids,
          );
        }
      },
    },
    {
      id: "core.selection.ungroup",
      titleKey: "selectionActions.ungroup",
      shortcut: "Mod-Shift-G",
      group: "selection" as const,
      order: 6,
      execute: (ctx) => {
        const services = resolveSelectionServices(ctx, wiring);
        if (services !== null) {
          ungroupSelection(
            services.scene,
            services.history,
            services.selection,
          );
        }
      },
    },
    {
      id: "core.selection.toggleLock",
      titleKey: "selectionActions.lock",
      shortcut: "Mod-L",
      group: "selection" as const,
      order: 7,
      execute: (ctx) => {
        const services = resolveSelectionServices(ctx, wiring);
        if (services !== null) {
          toggleLockSelection(
            services.scene,
            services.history,
            services.selection,
          );
        }
      },
    },
    {
      // فاز ۲۵ «سنجاش روی صفحه»: pin the selection to the SCREEN — it
      // stops following pans/zooms and rides the viewport at its anchor
      // (Mod-Shift-P; the wiring owns the viewport + notice).
      id: "core.selection.togglePin",
      titleKey: "pin.toggleCommand",
      icon: "Pin",
      shortcut: "Mod-Shift-P",
      group: "selection" as const,
      order: 8,
      execute: () => {
        wiring.ui.togglePin();
      },
      isEnabled: (ctx) => {
        const scene = ctx.services.tryGet(wiring.keys.scene);
        const selection = ctx.services.tryGet(wiring.keys.selection);
        if (scene === undefined || selection === undefined) {
          return false;
        }
        for (const id of selection.ids) {
          const object = scene.findById(id);
          if (object !== undefined && isPinnableObject(object)) {
            return true;
          }
        }
        return false;
      },
    },
    {
      // Pack R11.6: the manual-link flow — «لینک به این شیء…» opens the
      // target picker for the ONE selected source object.
      id: "core.knowledge.linkTo",
      titleKey: "knowledge.linkToCommand",
      icon: "Link2",
      group: "selection" as const,
      order: 12,
      execute: (ctx) => {
        const selection = ctx.services.tryGet(wiring.keys.selection);
        const ids = [...(selection?.ids ?? [])];
        const sourceId = ids[0];
        if (ids.length === 1 && sourceId !== undefined) {
          wiring.ui.openLinkPicker(sourceId);
        }
      },
      isEnabled: (ctx) =>
        (ctx.services.tryGet(wiring.keys.selection)?.ids.size ?? 0) === 1,
    },
    {
      // Pack R11.6: «حذف پیوندهای این شیء» — every outgoing manual link of
      // the selected object vanishes as ONE composite undo step.
      id: "core.knowledge.unlinkAll",
      titleKey: "knowledge.unlinkAllCommand",
      icon: "Link2Off",
      group: "selection" as const,
      order: 13,
      execute: (ctx) => {
        const registry = ctx.services.tryGet(wiring.keys.links);
        const history = ctx.services.tryGet(wiring.keys.history);
        const ids = [
          ...(ctx.services.tryGet(wiring.keys.selection)?.ids ?? []),
        ];
        const objectId = ids[0];
        if (
          registry === undefined ||
          history === undefined ||
          ids.length !== 1 ||
          objectId === undefined
        ) {
          return;
        }
        const command = removeAllManualLinksCommand(registry, objectId);
        if (command === null) {
          return;
        }
        command.do();
        history.push(command);
      },
      isEnabled: (ctx) => {
        const registry = ctx.services.tryGet(wiring.keys.links);
        const ids = [
          ...(ctx.services.tryGet(wiring.keys.selection)?.ids ?? []),
        ];
        const objectId = ids[0];
        if (
          registry === undefined ||
          ids.length !== 1 ||
          objectId === undefined
        ) {
          return false;
        }
        return registry
          .outgoingOf(objectId)
          .some((item) => item.kind === "manual");
      },
    },
    {
      id: "core.selection.bringFront",
      titleKey: "selectionActions.bringFront",
      shortcut: "Mod-Shift-BracketRight",
      group: "selection" as const,
      order: 8,
      execute: (ctx) => zOrder(ctx, wiring, "front"),
    },
    {
      id: "core.selection.bringForward",
      titleKey: "selectionActions.bringForward",
      shortcut: "Mod-BracketRight",
      group: "selection" as const,
      order: 9,
      execute: (ctx) => zOrder(ctx, wiring, "forward"),
    },
    {
      id: "core.selection.sendBackward",
      titleKey: "selectionActions.sendBackward",
      shortcut: "Mod-BracketLeft",
      group: "selection" as const,
      order: 10,
      execute: (ctx) => zOrder(ctx, wiring, "backward"),
    },
    {
      id: "core.selection.sendBack",
      titleKey: "selectionActions.sendBack",
      shortcut: "Mod-Shift-BracketLeft",
      group: "selection" as const,
      order: 11,
      execute: (ctx) => zOrder(ctx, wiring, "back"),
    },

    /* ── Phase 23 «پل کلیپ‌بورد»: image-scoped OS-clipboard and
     *    reset affordances (single-image selection). */
    {
      id: "core.image.copy",
      titleKey: "image.copyCommand",
      group: "selection" as const,
      order: 12,
      execute: () => wiring.ui.copyImageToSystem(),
      isEnabled: (ctx) => singleImageOf(ctx, wiring) !== null,
    },
    {
      id: "core.image.resetSize",
      titleKey: "image.resetSize",
      group: "selection" as const,
      order: 13,
      execute: () => {
        wiring.ui.resetImageToNatural();
      },
      isEnabled: (ctx) => {
        const image = singleImageOf(ctx, wiring);
        return image !== null && imageSizeDrifted(image);
      },
    },
    {
      id: "core.image.resetInsert",
      titleKey: "image.resetToInsert",
      group: "selection" as const,
      order: 14,
      execute: () => {
        wiring.ui.resetImageToInsertState();
      },
      isEnabled: (ctx) => {
        const image = singleImageOf(ctx, wiring);
        return image !== null && imageInsertStateDrifted(image);
      },
    },

    /* ── selection: alignment & distribution (R7.3) — Figma-style, one
     *    undo step each; the SelectionActions cluster renders them from
     *    this group automatically. */
    ...alignCommands(wiring),

    /* ── tools (physical-key shortcuts, R2-2 parity) ─────────────────── */
    ...toolCommands(wiring),

    /* ── view: bookmarks, palette, panel toggles (R7.9/R7.11/R7.1) ──── */
    {
      id: "core.view.addBookmark",
      titleKey: "bookmarks.add",
      shortcut: "Mod-Shift-B",
      group: "view" as const,
      order: 5,
      execute: () => wiring.ui.promptBookmark(),
    },
    {
      id: "core.view.commandPalette",
      titleKey: "palette.title",
      shortcut: "Mod-K",
      group: "view" as const,
      order: 6,
      execute: () => wiring.ui.openCommandPalette(),
    },
    {
      id: "core.view.presentation",
      titleKey: "presentation.enter",
      shortcut: "F5",
      group: "view" as const,
      order: 7,
      execute: () => wiring.ui.togglePresentation(),
    },
    ...panelToggleCommands(wiring),

    /* ── insert: catalog cards (R7.12) — the Insert Panel's click path,
     *    identical objects to the panel (same factory, same defaults). */
    ...insertCardCommands(wiring),

    /* ── text: edit-selection entry point (Enter) ────────────────────── */
    {
      id: "core.text.editSelection",
      titleKey: "selectionActions.editText",
      shortcut: "Enter",
      group: "text.format" as const,
      order: 100,
      execute: (ctx) => {
        const scene = ctx.services.tryGet(wiring.keys.scene);
        const selection = ctx.services.tryGet(wiring.keys.selection);
        const textLayer = ctx.services.tryGet(wiring.keys.textLayer);
        if (
          scene === undefined ||
          selection === undefined ||
          textLayer === undefined
        ) {
          return;
        }
        const firstId =
          selection.ids.size === 1
            ? (selection.ids.values().next().value ?? null)
            : null;
        if (firstId === null) {
          return;
        }
        const target = scene.findById(firstId);
        if (
          target !== undefined &&
          (target.kind === "textBox" || target.kind === "stickyNote") &&
          !target.locked
        ) {
          textLayer.beginEditing(firstId);
        }
      },
      isEnabled: (ctx) => {
        const scene = ctx.services.tryGet(wiring.keys.scene);
        const selection = ctx.services.tryGet(wiring.keys.selection);
        if (
          scene === undefined ||
          selection === undefined ||
          selection.ids.size !== 1
        ) {
          return false;
        }
        const target = scene.findById(
          selection.ids.values().next().value ?? "",
        );
        return (
          target !== undefined &&
          (target.kind === "textBox" || target.kind === "stickyNote") &&
          !target.locked
        );
      },
    },

    /* ── text: rich-text editor actions (floating bar + palette) ─────── */
    ...editorActions.map(([action, titleKey, group, order]): CommandEntry => ({
      id: `core.text.${action}`,
      titleKey,
      group: group as CommandEntry["group"],
      order,
      execute: () => {
        wiring.text.runEditorAction(action);
      },
    })),

    /* ── text: blocks & lists (same executor, block group) ──────────── */
    ...blockActions.map(([action, titleKey, order]): CommandEntry => ({
      id: `core.text.${action}`,
      titleKey,
      group: "text.block",
      order,
      execute: () => {
        wiring.text.runEditorAction(action);
      },
    })),

    /* ── text: Format Painter (R7.5) — copies the selection's
     *    formatting (marks + block) and applies it to the next text
     *    selection, same or another object. */
    {
      id: "core.text.formatPainterCopy",
      titleKey: "formatPainter.copy",
      shortcut: "Mod-Shift-C",
      group: "text.format" as const,
      order: 32,
      execute: () => {
        wiring.text.copyFormat();
      },
      isEnabled: () => wiring.text.hasLiveEditor(),
    },
    {
      id: "core.text.formatPainterApply",
      titleKey: "formatPainter.apply",
      shortcut: "Mod-Shift-V",
      group: "text.format" as const,
      order: 33,
      execute: () => {
        wiring.text.applyFormat();
      },
      isEnabled: () => wiring.text.hasLiveEditor(),
    },

    /* ── text: link dialog (R3B.3) ───────────────────────────────────── */
    {
      id: "core.text.linkDialog",
      titleKey: "textFormat.link",
      group: "text.link" as const,
      order: 0,
      execute: () => wiring.ui.openLinkDialog(),
    },

    /* ── find (R3B.8) ────────────────────────────────────────────────── */
    {
      id: "core.find.open",
      titleKey: "find.title",
      shortcut: "Mod-F",
      group: "find" as const,
      order: 0,
      execute: () => wiring.ui.openFind(),
    },

    /* ── table (R6.1/R6.2/R6.3/R6.4): EVERY table menu action is a
     *    registered command — the table context menu, the floating table
     *    toolbar and the future command palette dispatch these ids. */
    ...tableCommands(wiring),
  ];

  for (const command of commands) {
    registry.register(command);
  }
  return registry;
}

/**
 * Alignment + distribution command entries (R7.3): Figma-style,
 * selection-relative, ONE undo step each. Enabled at ≥2 selected for
 * align and ≥3 for distribute (locked objects are skipped by the applier).
 */
function alignCommands(wiring: CoreCommandWiring): CommandEntry[] {
  const aligns: Array<[AlignMode, string, number]> = [
    ["left", "align.left", 20],
    ["centerHorizontal", "align.centerHorizontal", 21],
    ["right", "align.right", 22],
    ["top", "align.top", 23],
    ["middle", "align.middle", 24],
    ["bottom", "align.bottom", 25],
  ];
  const distributes: Array<[DistributeAxis, string, number]> = [
    ["horizontal", "align.distributeHorizontal", 26],
    ["vertical", "align.distributeVertical", 27],
  ];
  const selectionSize = (ctx: CommandContext): number =>
    ctx.services.tryGet(wiring.keys.selection)?.size ?? 0;
  const resolve = (ctx: CommandContext) => ({
    scene: ctx.services.tryGet(wiring.keys.scene),
    history: ctx.services.tryGet(wiring.keys.history),
    selection: ctx.services.tryGet(wiring.keys.selection),
  });
  return [
    ...aligns.map(([mode, titleKey, order]): CommandEntry => ({
      id: `core.selection.align${mode}`,
      titleKey,
      group: "selection" as const,
      order,
      execute: (ctx) => {
        const services = resolve(ctx);
        if (
          services.scene !== undefined &&
          services.history !== undefined &&
          services.selection !== undefined
        ) {
          alignSelection(
            services.scene,
            services.history,
            services.selection,
            mode,
          );
        }
      },
      isEnabled: (ctx) => selectionSize(ctx) >= 2,
    })),
    ...distributes.map(([axis, titleKey, order]): CommandEntry => ({
      id: `core.selection.distribute${axis === "horizontal" ? "Horizontal" : "Vertical"}`,
      titleKey,
      group: "selection" as const,
      order,
      execute: (ctx) => {
        const services = resolve(ctx);
        if (
          services.scene !== undefined &&
          services.history !== undefined &&
          services.selection !== undefined
        ) {
          distributeSelection(
            services.scene,
            services.history,
            services.selection,
            axis,
          );
        }
      },
      isEnabled: (ctx) => selectionSize(ctx) >= 3,
    })),
  ];
}

/**
 * Panel-toggle command entries (R7.1): every core panel is toggleable
 * through the dispatcher (the palette lists them; the dock rail buttons
 * dispatch the same ids).
 */
function panelToggleCommands(wiring: CoreCommandWiring): CommandEntry[] {
  const panels: Array<[string, string, number]> = [
    ["core.panels.layers", "panels.layers", 20],
    ["core.panels.inspector", "panels.inspector", 21],
    ["core.panels.search", "panels.search", 22],
    ["core.panels.outline", "panels.outline", 23],
    ["core.panels.minimap", "panels.minimap", 24],
    ["core.panels.insert", "panels.insert", 25],
    ["core.panels.history", "panels.history", 26],
    // R15.1: the knowledge-graph overview panel.
    ["core.panels.knowledgeGraph", "panels.knowledgeGraph", 27],
  ];
  return panels.map(([panelId, titleKey, order]): CommandEntry => ({
    id: `core.view.panel.${panelId.split(".").pop() ?? panelId}`,
    titleKey,
    group: "view" as const,
    order,
    execute: () => wiring.ui.togglePanel(panelId),
  }));
}

/**
 * Insert-card command entries (R7.12): the Insert Panel's click path —
 * one command per core catalog card, inserting at the viewport centre
 * through the SAME factory the panel drags use.
 */
function insertCardCommands(wiring: CoreCommandWiring): CommandEntry[] {
  const cards: Array<[string, string, string, number]> = [
    ["core.shape", "rectangle", "shape.kind.rectangle", 10],
    ["core.shape", "ellipse", "shape.kind.ellipse", 11],
    ["core.frame", "core.frame", "tool.frame", 12],
    ["core.textBox", "core.textBox", "tool.text", 20],
    ["core.stickyNote", "core.stickyNote", "tool.sticky", 21],
    // R11.1: the sticker variant cards — one insert command per emoji
    // (the panel click + command palette share these exact ids).
    ["core.sticker", "sticker.star", "sticker.star", 30],
    ["core.sticker", "sticker.smile", "sticker.smile", 31],
    ["core.sticker", "sticker.love", "sticker.love", 32],
    ["core.sticker", "sticker.fire", "sticker.fire", 33],
    ["core.sticker", "sticker.idea", "sticker.idea", 34],
    ["core.sticker", "sticker.target", "sticker.target", 35],
    ["core.sticker", "sticker.rocket", "sticker.rocket", 36],
    ["core.sticker", "sticker.check", "sticker.check", 37],
    ["core.connector", "core.connector", "tool.connector", 40],
    ["core.freehand", "core.freehand", "tool.pen", 41],
    // R15.2: the live knowledge-query card.
    ["core.query", "query.live", "query.card", 42],
    // R12.2: the structured-filter card (the full QuerySpec editor
    // opens in the inspector — law §1.7.9).
    ["core.query", "query.filter", "query.cardFilter", 43],
    // NOTE: the image card reuses the R5.2 `core.insert.image` command
    // (the asset-picking dialog) instead of a duplicate id.
  ];
  return cards.map(([typeId, cardKey, titleKey, order]): CommandEntry => ({
    id: `core.insert.${
      cardKey === "core.textBox"
        ? "text"
        : cardKey === "core.stickyNote"
          ? "sticky"
          : cardKey === "core.image"
            ? "image"
            : cardKey === "core.connector"
              ? "connector"
              : cardKey === "core.freehand"
                ? "pen"
                : cardKey === "core.frame"
                  ? "frame"
                  : cardKey
    }`,
    titleKey,
    group: "insert" as const,
    order,
    execute: () => wiring.ui.insertCard(typeId, cardKey),
  }));
}

/** Tool command entries with their physical-key shortcuts. */
function toolCommands(wiring: CoreCommandWiring): CommandEntry[] {
  const tools: Array<[ToolCommandId, string, string]> = [
    ["select", "tool.select", "v"],
    ["hand", "tool.hand", "h"],
    ["pen", "tool.pen", "p"],
    ["eraser", "tool.eraser", "e"],
    ["text", "tool.text", "t"],
    ["sticky", "tool.sticky", "n"],
    ["table", "tool.table", "g"],
    ["shape", "tool.shape", "s"],
    ["connector", "tool.connector", "c"],
  ];
  return tools.map(([tool, titleKey, shortcut], index): CommandEntry => ({
    id: `core.tools.${tool}`,
    titleKey,
    shortcut,
    group: "tools",
    order: index,
    execute: () => wiring.ui.activateTool(tool),
  }));
}

/** Table action → command id + title key + ordering (R6.1–R6.5). */
const TABLE_ACTION_ENTRIES: ReadonlyArray<{
  action: TableAction;
  id: string;
  titleKey: string;
  order: number;
}> = [
  {
    action: "insert",
    id: "core.table.insert",
    titleKey: "table.insert",
    order: 0,
  },
  {
    action: "insertRowAbove",
    id: "core.table.insertRowAbove",
    titleKey: "table.insertRowBefore",
    order: 1,
  },
  {
    action: "insertRowBelow",
    id: "core.table.insertRowBelow",
    titleKey: "table.insertRowAfter",
    order: 2,
  },
  {
    action: "deleteRow",
    id: "core.table.deleteRow",
    titleKey: "table.deleteRow",
    order: 3,
  },
  {
    action: "insertColumnLeft",
    id: "core.table.insertColumnLeft",
    titleKey: "table.insertColumnLeft",
    order: 4,
  },
  {
    action: "insertColumnRight",
    id: "core.table.insertColumnRight",
    titleKey: "table.insertColumnRight",
    order: 5,
  },
  {
    action: "deleteColumn",
    id: "core.table.deleteColumn",
    titleKey: "table.deleteColumn",
    order: 6,
  },
  {
    action: "deleteTable",
    id: "core.table.deleteTable",
    titleKey: "table.deleteTable",
    order: 7,
  },
  {
    action: "mergeCells",
    id: "core.table.mergeCells",
    titleKey: "table.mergeCells",
    order: 8,
  },
  {
    action: "splitCellHorizontal",
    id: "core.table.splitCellHorizontal",
    titleKey: "table.splitCellHorizontal",
    order: 9,
  },
  {
    action: "splitCellVertical",
    id: "core.table.splitCellVertical",
    titleKey: "table.splitCellVertical",
    order: 10,
  },
  {
    action: "toggleHeaderRow",
    id: "core.table.toggleHeaderRow",
    titleKey: "table.toggleHeaderRow",
    order: 11,
  },
  {
    action: "toggleHeaderColumn",
    id: "core.table.toggleHeaderColumn",
    titleKey: "table.toggleHeaderColumn",
    order: 12,
  },
  {
    action: "toggleDirection",
    id: "core.table.toggleDirection",
    titleKey: "table.direction",
    order: 13,
  },
  {
    action: "distributeColumns",
    id: "core.table.distributeColumns",
    titleKey: "table.distributeColumns",
    order: 14,
  },
  {
    action: "alignCellTop",
    id: "core.table.alignCellTop",
    titleKey: "table.alignTop",
    order: 15,
  },
  {
    action: "alignCellMiddle",
    id: "core.table.alignCellMiddle",
    titleKey: "table.alignMiddle",
    order: 16,
  },
  {
    action: "alignCellBottom",
    id: "core.table.alignCellBottom",
    titleKey: "table.alignBottom",
    order: 17,
  },
];

/** Style presets registered as commands (R6.4 — the gallery ids). */
const TABLE_PRESET_ENTRIES: ReadonlyArray<{
  preset: string;
  id: string;
  titleKey: string;
  order: number;
}> = [
  {
    preset: "classic",
    id: "core.table.preset.classic",
    titleKey: "table.preset.classic",
    order: 30,
  },
  {
    preset: "minimal",
    id: "core.table.preset.minimal",
    titleKey: "table.preset.minimal",
    order: 31,
  },
  {
    preset: "zebra",
    id: "core.table.preset.zebra",
    titleKey: "table.preset.zebra",
    order: 32,
  },
  {
    preset: "soft",
    id: "core.table.preset.soft",
    titleKey: "table.preset.soft",
    order: 33,
  },
  {
    preset: "grid",
    id: "core.table.preset.grid",
    titleKey: "table.preset.grid",
    order: 34,
  },
  {
    preset: "dark",
    id: "core.table.preset.dark",
    titleKey: "table.preset.dark",
    order: 35,
  },
];

/**
 * The table command family (R6.1/R6.2/R6.3/R6.4): every table menu
 * action — structural edits, direction toggle, distribution, per-cell
 * vertical alignment and the style presets — exists as a registered
 * command (AC6.7). All execute through the wiring's table executor, so
 * interaction/ stays free of TipTap imports.
 *
 * @param wiring - the composition-root bindings.
 * @returns the table command entries.
 */
function tableCommands(wiring: CoreCommandWiring): CommandEntry[] {
  const structural: CommandEntry[] = TABLE_ACTION_ENTRIES.map(
    ({ action, id, titleKey, order }): CommandEntry => ({
      id,
      titleKey,
      group: "table",
      order,
      execute: () => {
        wiring.table.runTableAction(action);
      },
      isEnabled: () => wiring.table.canTableAction(action),
    }),
  );
  const presets: CommandEntry[] = TABLE_PRESET_ENTRIES.map(
    ({ preset, id, titleKey, order }): CommandEntry => ({
      id,
      titleKey,
      group: "table",
      order,
      execute: () => {
        wiring.table.runTableAction(`preset:${preset}` as TableAction);
      },
      isEnabled: () => wiring.table.canTableAction("toggleHeaderRow"),
    }),
  );
  return [...structural, ...presets];
}

/** Resolves the selection-op services for one dispatch. */
function resolveSelectionServices(
  ctx: CommandContext,
  wiring: CoreCommandWiring,
): {
  scene: Scene;
  history: HistoryManager;
  selection: Selection;
  ids: IdGenerator;
} | null {
  const scene = ctx.services.tryGet(wiring.keys.scene);
  const history = ctx.services.tryGet(wiring.keys.history);
  const selection = ctx.services.tryGet(wiring.keys.selection);
  const ids = ctx.services.tryGet(wiring.keys.idGenerator);
  if (
    scene === undefined ||
    history === undefined ||
    selection === undefined ||
    ids === undefined
  ) {
    return null;
  }
  return { scene, history, selection, ids };
}

/** Runs one z-order operation. */
function zOrder(
  ctx: CommandContext,
  wiring: CoreCommandWiring,
  operation: ZOrderOp,
): void {
  const services = resolveSelectionServices(ctx, wiring);
  if (services !== null) {
    zOrderSelection(
      services.scene,
      services.history,
      services.selection,
      operation,
    );
  }
}

/**
 * Resolves the single IMAGE object of a selection (Phase 23's image
 * commands act on exactly one image).
 */
function singleImageOf(
  ctx: CommandContext,
  wiring: CoreCommandWiring,
): ImageObjectData | null {
  const scene = ctx.services.tryGet(wiring.keys.scene);
  const selection = ctx.services.tryGet(wiring.keys.selection);
  if (scene === undefined || selection === undefined) {
    return null;
  }
  const ids = [...selection.ids];
  if (ids.length !== 1) {
    return null;
  }
  const object = scene.findById(ids[0] ?? "");
  return object !== undefined && isImageObject(object) ? object : null;
}

/** Zooms around the canvas centre (keyboard zoom has no cursor anchor). */
function zoomFromKeyboard(
  ctx: CommandContext,
  factor: number,
  wiring: CoreCommandWiring,
): void {
  const controller = ctx.services.tryGet(wiring.keys.cameraController);
  if (controller === undefined) {
    return;
  }
  const canvas =
    typeof document !== "undefined" ? document.querySelector("canvas") : null;
  if (canvas === null) {
    controller.zoomAt({ x: 0, y: 0 }, factor);
    return;
  }
  const rect = canvas.getBoundingClientRect();
  controller.zoomAt({ x: rect.width / 2, y: rect.height / 2 }, factor);
}

/** Frames every scene object (empty scene resets the framing). */
function fitToContent(ctx: CommandContext, wiring: CoreCommandWiring): void {
  const controller = ctx.services.tryGet(wiring.keys.cameraController);
  const scene = ctx.services.tryGet(wiring.keys.scene);
  if (controller === undefined || scene === undefined) {
    return;
  }
  const canvas =
    typeof document !== "undefined" ? document.querySelector("canvas") : null;
  const viewport =
    canvas !== null
      ? { width: canvas.clientWidth, height: canvas.clientHeight }
      : {
          width: typeof window !== "undefined" ? window.innerWidth : 0,
          height: typeof window !== "undefined" ? window.innerHeight : 0,
        };
  let bounds: ReturnType<typeof objectBBox> | null = null;
  for (const object of scene.objects) {
    // فاز ۲۵: pinned objects live in screen space — their world bbox is
    // camera-stale and never constrains the fit.
    if (isPinnedObject(object)) {
      continue;
    }
    const box = objectBBox(object);
    bounds =
      bounds === null
        ? box
        : {
            minX: Math.min(bounds.minX, box.minX),
            minY: Math.min(bounds.minY, box.minY),
            maxX: Math.max(bounds.maxX, box.maxX),
            maxY: Math.max(bounds.maxY, box.maxY),
          };
  }
  if (bounds === null) {
    controller.reset();
    return;
  }
  controller.fitToBBox(bounds, viewport);
}
