"use client";

/**
 * UI-only Zustand store.
 *
 * CLAUDE.md §1.2: Zustand holds VIEW/UI state ONLY — never domain/canvas
 * data. Phase 0 state: language, theme and the active tool; the shape tool
 * adds its last-picked primitive kind (a UI preference like `activeTool`).
 */
import { create } from "zustand";
import type { ContextMenuTarget } from "@/core/registry/ContextMenuRegistry";
import type { ShapeKind } from "@/core/model/ShapeObject";
import { DEFAULT_TEXT_FONT_SIZE } from "@/core/model/TextBoxObject";
import { DEFAULT_STICKY_NOTE_COLOR } from "@/core/model/StickyNoteObject";
import {
  DEFAULT_CONNECTOR_STYLE,
  type ConnectorArrowMode,
  type ConnectorRoutingKind,
} from "@/core/model/ConnectorObject";
import type { StrokeStyleKind } from "@/core/model/FreehandObject";
import { DEFAULT_SNAP_SPACING } from "@/interaction/SnapEngine";
import { DEFAULT_TABLE_COLS, DEFAULT_TABLE_ROWS } from "@/text/editor/richtext";
import type { SettingsSnapshot } from "@/ui/settings/settingsPersistence";

/** Default pen ink (the theme stroke token — readable on both themes). */
const DEFAULT_PEN_COLOR = "primary";

/** Default pen stroke width (world units). */
const DEFAULT_PEN_WIDTH = 2;

/** Identifier of the canvas tools. UI-level concept. */
export type ToolId =
  | "select"
  | "hand"
  | "pen"
  | "eraser"
  | "text"
  | "sticky"
  | "table"
  | "shape"
  | "connector";

/** Visual theme of the shell. */
export type ThemeMode = "dark" | "light";

/** UI language. Persian is the default product language. */
export type Language = "fa" | "en";

/** Marker width presets offered by the pen picker (world units, R5.4). */
export const PEN_WIDTH_PRESETS: readonly number[] = [2, 4, 8, 16];

/** Snap spacing presets offered by the settings popover (world units, R5.5). */
export const SNAP_SPACING_PRESETS: readonly number[] = [10, 20, 40, 80];

/** The open context menu's state (R6.2): anchor + resolved target. */
export interface ContextMenuState {
  /** Viewport-space anchor of the right-click. */
  readonly x: number;
  readonly y: number;
  /** Which surface was right-clicked. */
  readonly target: ContextMenuTarget;
  /** Bump counter: re-opening at the same anchor re-renders the host. */
  readonly token: number;
}

/** Autosave interval bounds (R8.2: 10 s–5 min). */
export const AUTOSAVE_INTERVAL_MIN_SEC = 10;
export const AUTOSAVE_INTERVAL_MAX_SEC = 300;

/** Default autosave interval (seconds — the pre-Phase-8 constant 30 s). */
export const DEFAULT_AUTOSAVE_INTERVAL_SEC = 30;

/** Default background-grid spacing (world units, R8.2). */
export const DEFAULT_GRID_SPACING = 20;

/** Font families the default-text setting offers (R8.2). */
export const FONT_FAMILY_OPTIONS: readonly string[] = [
  "Vazirmatn",
  "Noto Sans Arabic",
  "Tahoma",
  "Segoe UI",
  "Cascadia Mono",
];

/** Shape of the UI store. */
export interface UiState {
  language: Language;
  theme: ThemeMode;
  activeTool: ToolId;
  /** Primitive the shape tool creates (last picked in the toolbar). */
  shapeKind: ShapeKind;
  /** Font size (world units) the text tool creates boxes with. */
  fontSize: number;
  /** Card colour the sticky tool creates notes with. */
  stickyColor: string;
  /** Row count the table tool creates tables with (R6.1 picker). */
  tableRows: number;
  /** Column count the table tool creates tables with (R6.1 picker). */
  tableColumns: number;
  /** Routing strategy the connector tool creates lines with. */
  connectorRouting: ConnectorRoutingKind;
  /** Arrowhead placement the connector tool creates lines with. */
  connectorArrow: ConnectorArrowMode;
  /** Dash pattern the connector tool creates lines with. */
  connectorDash: StrokeStyleKind;
  /** Stroke colour the connector tool creates lines with (token or literal). */
  connectorColor: string;
  /** Stroke colour the pen tool draws with (token or literal, R5.4). */
  penColor: string;
  /** Stroke width the pen tool draws with (world units, R5.4). */
  penWidth: number;
  /** Whether the pen tool draws marker-mode strokes (R5.4 highlighter). */
  penHighlighter: boolean;
  /** Whether snap-to-grid is active for create/drag/resize (R5.5). */
  snapEnabled: boolean;
  /** Snap grid spacing in world units (R5.5, default 20). */
  snapSpacing: number;
  /** Whether the layers side panel is open (a view preference). */
  layersPanelOpen: boolean;
  /** Whether the inspector panel is open (strictly manual: toggle-only). */
  inspectorPanelOpen: boolean;
  /** Whether the dotted background grid is drawn (Ctrl+' toggles). */
  gridVisible: boolean;
  /** Whether the knowledge edges draw on the canvas (R12.4, Ctrl+Shift+E). */
  knowledgeEdgesVisible: boolean;
  /** Whether UI numerals render as Persian digits (R3B.7, default ON). */
  persianDigits: boolean;
  /** Whether the Find & Replace panel is open (R3B.8, Ctrl+F toggles). */
  findPanelOpen: boolean;
  /** Whether the Export PNG dialog is open (R4.8). */
  exportPngDialogOpen: boolean;
  /** Whether the Insert Image dialog is open (R5.2). */
  insertImageDialogOpen: boolean;
  /** Whether the Insert Video dialog is open (فاز M1). */
  insertVideoDialogOpen: boolean;
  /** Whether the Insert Audio dialog is open (فاز A1). */
  insertAudioDialogOpen: boolean;
  /** Whether the Insert PDF dialog is open (فاز P1). */
  insertPdfDialogOpen: boolean;
  /** Pending offline conversions (فاز M2 — RM2.5): the dialog's queue. */
  pendingVideoConversions: readonly {
    readonly file: File;
    readonly at?: { readonly x: number; readonly y: number };
  }[];
  /** Queues files for the conversion dialog. */
  queueVideoConversions: (
    items: readonly {
      readonly file: File;
      readonly at?: { readonly x: number; readonly y: number };
    }[],
  ) => void;
  /** Clears the conversion queue (cancel / done). */
  clearVideoConversions: () => void;
  /** Consumes the queue's HEAD (one converted import landed). */
  shiftVideoConversion: () => void;
  /** The open floating player's video object id, or null (فاز M2). */
  playerVideoId: string | null;
  /** Opens the floating player on one video (ONE instance — A.2.3). */
  openVideoPlayer: (objectId: string) => void;
  /** Closes the floating player (stops playback). */
  closeVideoPlayer: () => void;
  /** Sets the Insert Audio dialog's visibility (فاز A1). */
  setInsertAudioDialogOpen: (insertAudioDialogOpen: boolean) => void;
  /** Pending offline AUDIO conversions (فاز A2 — RA2.5): the dialog's queue. */
  pendingAudioConversions: readonly {
    readonly file: File;
    readonly at?: { readonly x: number; readonly y: number };
  }[];
  /** Queues files for the audio conversion dialog. */
  queueAudioConversions: (
    items: readonly {
      readonly file: File;
      readonly at?: { readonly x: number; readonly y: number };
    }[],
  ) => void;
  /** Clears the audio conversion queue (cancel / done). */
  clearAudioConversions: () => void;
  /** Consumes the audio queue's HEAD (one converted import landed). */
  shiftAudioConversion: () => void;
  /** The open mini-player's audio object id, or null (فاز A2 — A.2.3). */
  playerAudioId: string | null;
  /** Opens the mini-player on one audio clip (ONE instance across BOTH
   *  players — A.2.3: opening the audio player closes the video player). */
  openAudioPlayer: (objectId: string) => void;
  /** Closes the mini-player (stops playback — no background audio). */
  closeAudioPlayer: () => void;
  /** Sets the Insert PDF dialog's visibility (فاز P1). */
  setInsertPdfDialogOpen: (insertPdfDialogOpen: boolean) => void;
  /** The open PDF viewer's object id, or null (فاز P2 — A.2.3). */
  playerPdfId: string | null;
  /** Opens the floating PDF viewer on one document (ONE instance across
   *  ALL players — A.2.3: opening the PDF viewer closes the video/audio
   *  windows, and vice-versa). */
  openPdfViewer: (objectId: string) => void;
  /** Closes the floating PDF viewer (destroys the DOM instance). */
  closePdfViewer: () => void;
  /** The open context menu, or null (R6.2). */
  contextMenu: ContextMenuState | null;
  /** Open/closed state of every registered dock panel (R7.1). */
  panelOpen: Readonly<Record<string, boolean>>;
  /** Whether the command palette is open (R7.11, Ctrl+K). */
  commandPaletteOpen: boolean;
  /** Whether the bookmark-name prompt dialog is open (R7.9). */
  bookmarkPromptOpen: boolean;
  /** Whether typed ASCII digits become Persian digits in NEW text
   * (R8.2 input-rule — existing text is never rewritten). */
  convertTypedDigits: boolean;
  /** Default font family for NEW text objects (R8.2). */
  defaultFontFamily: string;
  /** Background grid spacing in world units (R8.2 default). */
  gridSpacing: number;
  /** Autosave interval in seconds (R8.2: 10–300). */
  autosaveIntervalSec: number;
  /** Whether the composed Settings dialog is open (R8.2). */
  settingsDialogOpen: boolean;
  /** Whether the template gallery is open (R8.4). */
  templateGalleryOpen: boolean;
  /** Whether the sticker-library picker dialog is open (R12.1). */
  stickerPickerOpen: boolean;
  /** Whether the Markdown interop dialog is open (R13.1). */
  markdownDialogOpen: boolean;
  /** The dialog's active tab (export | import). */
  markdownDialogTab: "export" | "import";
  /** Whether the style editor dialog is open (R13.3). */
  styleEditorOpen: boolean;
  /** Whether the one-way Markdown mirror is enabled (R13.1, AC13.2). */
  mirrorFolderEnabled: boolean;
  /** The Export dialog's active format (R8.7). */
  exportDialogFormat: "png" | "svg" | "pdf";
  /** Whether presentation mode is active (R8.3, F5). */
  presentationActive: boolean;
  /** The active presentation slide (0-based index). */
  presentationIndex: number;
  setLanguage: (language: Language) => void;
  setTheme: (theme: ThemeMode) => void;
  setActiveTool: (tool: ToolId) => void;
  setShapeKind: (shapeKind: ShapeKind) => void;
  setFontSize: (fontSize: number) => void;
  setStickyColor: (stickyColor: string) => void;
  setTableRows: (rows: number) => void;
  setTableColumns: (columns: number) => void;
  setConnectorRouting: (routing: ConnectorRoutingKind) => void;
  setConnectorArrow: (arrow: ConnectorArrowMode) => void;
  setConnectorDash: (dash: StrokeStyleKind) => void;
  setConnectorColor: (color: string) => void;
  setPenColor: (color: string) => void;
  setPenWidth: (width: number) => void;
  setPenHighlighter: (highlighter: boolean) => void;
  setSnapEnabled: (enabled: boolean) => void;
  toggleSnap: () => void;
  setSnapSpacing: (spacing: number) => void;
  setLayersPanelOpen: (open: boolean) => void;
  toggleLayersPanel: () => void;
  setInspectorPanelOpen: (open: boolean) => void;
  toggleInspectorPanel: () => void;
  setGridVisible: (visible: boolean) => void;
  toggleGrid: () => void;
  setKnowledgeEdgesVisible: (visible: boolean) => void;
  toggleKnowledgeEdges: () => void;
  setPersianDigits: (enabled: boolean) => void;
  togglePersianDigits: () => void;
  setFindPanelOpen: (open: boolean) => void;
  toggleFindPanel: () => void;
  setExportPngDialogOpen: (open: boolean) => void;
  setInsertImageDialogOpen: (open: boolean) => void;
  setInsertVideoDialogOpen: (open: boolean) => void;
  /** Opens the context menu at an anchor for a target (R6.2). */
  openContextMenu: (x: number, y: number, target: ContextMenuTarget) => void;
  /** Closes the context menu (R6.2). */
  closeContextMenu: () => void;
  /** Sets one panel's open state (R7.1; default-opens seed it). */
  setPanelOpen: (panelId: string, open: boolean) => void;
  /** Toggles one panel (R7.1). */
  togglePanel: (panelId: string) => void;
  /** Bulk-rehydrates panel state (localStorage boot, R7.1). */
  hydratePanelState: (state: Readonly<Record<string, boolean>>) => void;
  /** Sets the command palette's open state (R7.11). */
  setCommandPaletteOpen: (open: boolean) => void;
  /** Sets the bookmark prompt's open state (R7.9). */
  setBookmarkPromptOpen: (open: boolean) => void;
  /** Sets the typed-digit conversion setting (R8.2). */
  setConvertTypedDigits: (enabled: boolean) => void;
  /** Sets the default font family for new text (R8.2). */
  setDefaultFontFamily: (family: string) => void;
  /** Sets the background grid spacing (R8.2). */
  setGridSpacing: (spacing: number) => void;
  /** Sets the autosave interval in seconds (R8.2, clamped 10–300). */
  setAutosaveIntervalSec: (seconds: number) => void;
  /** Sets the Settings dialog's open state (R8.2). */
  setSettingsDialogOpen: (open: boolean) => void;
  /** Sets the template gallery's open state (R8.4). */
  setTemplateGalleryOpen: (open: boolean) => void;
  /** Sets the sticker picker dialog's open state (R12.1). */
  setStickerPickerOpen: (open: boolean) => void;
  /** Opens the Markdown interop dialog on a tab (R13.1). */
  openMarkdownDialog: (tab: "export" | "import") => void;
  /** Closes the Markdown interop dialog. */
  setMarkdownDialogOpen: (open: boolean) => void;
  /** Opens/closes the style editor dialog (R13.3). */
  setStyleEditorOpen: (open: boolean) => void;
  /** Toggles the one-way Markdown mirror (R13.1). */
  setMirrorFolderEnabled: (enabled: boolean) => void;
  /** Sets the Export dialog's active format (R8.7). */
  setExportDialogFormat: (format: "png" | "svg" | "pdf") => void;
  /** Sets the Export dialog open + format in one go (R8.7 commands). */
  openExportDialog: (format: "png" | "svg" | "pdf") => void;
  /** Enters/leaves presentation mode (R8.3). */
  setPresentationActive: (active: boolean) => void;
  /** Jumps to one presentation slide (clamped). */
  setPresentationIndex: (index: number) => void;
  /** Rehydrates persisted settings (R8.1/R8.2 boot). */
  hydrateSettings: (settings: Partial<SettingsSnapshot>) => void;
}

/**
 * The single UI state store. Components select narrow slices
 * (e.g. `useUiStore((s) => s.theme)`) to minimize re-renders.
 */
export const useUiStore = create<UiState>((set) => ({
  language: "fa",
  theme: "dark",
  activeTool: "select",
  shapeKind: "rectangle",
  fontSize: DEFAULT_TEXT_FONT_SIZE,
  stickyColor: DEFAULT_STICKY_NOTE_COLOR,
  tableRows: DEFAULT_TABLE_ROWS,
  tableColumns: DEFAULT_TABLE_COLS,
  connectorRouting: DEFAULT_CONNECTOR_STYLE.routing,
  connectorArrow: "end",
  connectorDash: DEFAULT_CONNECTOR_STYLE.dash,
  connectorColor: DEFAULT_CONNECTOR_STYLE.color,
  penColor: DEFAULT_PEN_COLOR,
  penWidth: DEFAULT_PEN_WIDTH,
  penHighlighter: false,
  snapEnabled: true,
  snapSpacing: DEFAULT_SNAP_SPACING,
  layersPanelOpen: false,
  inspectorPanelOpen: false,
  gridVisible: true,
  knowledgeEdgesVisible: false,
  persianDigits: true,
  findPanelOpen: false,
  exportPngDialogOpen: false,
  insertImageDialogOpen: false,
  insertVideoDialogOpen: false,
  insertAudioDialogOpen: false,
  insertPdfDialogOpen: false,
  pendingVideoConversions: [],
  pendingAudioConversions: [],
  playerVideoId: null,
  playerAudioId: null,
  playerPdfId: null,
  contextMenu: null,
  panelOpen: {},
  commandPaletteOpen: false,
  bookmarkPromptOpen: false,
  convertTypedDigits: false,
  defaultFontFamily: "Vazirmatn",
  gridSpacing: DEFAULT_GRID_SPACING,
  autosaveIntervalSec: DEFAULT_AUTOSAVE_INTERVAL_SEC,
  settingsDialogOpen: false,
  templateGalleryOpen: false,
  stickerPickerOpen: false,
  markdownDialogOpen: false,
  markdownDialogTab: "export",
  styleEditorOpen: false,
  mirrorFolderEnabled: false,
  exportDialogFormat: "png",
  presentationActive: false,
  presentationIndex: 0,
  setLanguage: (language) => set({ language }),
  setTheme: (theme) => set({ theme }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setShapeKind: (shapeKind) => set({ shapeKind }),
  setFontSize: (fontSize) => set({ fontSize }),
  setStickyColor: (stickyColor) => set({ stickyColor }),
  setTableRows: (tableRows) =>
    set({ tableRows: Math.max(1, Math.floor(tableRows)) }),
  setTableColumns: (tableColumns) =>
    set({ tableColumns: Math.max(1, Math.floor(tableColumns)) }),
  setConnectorRouting: (connectorRouting) => set({ connectorRouting }),
  setConnectorArrow: (connectorArrow) => set({ connectorArrow }),
  setConnectorDash: (connectorDash) => set({ connectorDash }),
  setConnectorColor: (connectorColor) => set({ connectorColor }),
  setLayersPanelOpen: (layersPanelOpen) => set({ layersPanelOpen }),
  toggleLayersPanel: () =>
    set((state) => ({ layersPanelOpen: !state.layersPanelOpen })),
  setInspectorPanelOpen: (inspectorPanelOpen) => set({ inspectorPanelOpen }),
  toggleInspectorPanel: () =>
    set((state) => ({ inspectorPanelOpen: !state.inspectorPanelOpen })),
  setGridVisible: (gridVisible) => set({ gridVisible }),
  toggleGrid: () => set((state) => ({ gridVisible: !state.gridVisible })),
  setKnowledgeEdgesVisible: (knowledgeEdgesVisible) =>
    set({ knowledgeEdgesVisible }),
  toggleKnowledgeEdges: () =>
    set((state) => ({
      knowledgeEdgesVisible: !state.knowledgeEdgesVisible,
    })),
  setPersianDigits: (persianDigits) => set({ persianDigits }),
  togglePersianDigits: () =>
    set((state) => ({ persianDigits: !state.persianDigits })),
  setFindPanelOpen: (findPanelOpen) => set({ findPanelOpen }),
  toggleFindPanel: () =>
    set((state) => ({ findPanelOpen: !state.findPanelOpen })),
  setExportPngDialogOpen: (exportPngDialogOpen) => set({ exportPngDialogOpen }),
  setInsertImageDialogOpen: (insertImageDialogOpen) =>
    set({ insertImageDialogOpen }),
  setInsertVideoDialogOpen: (insertVideoDialogOpen) =>
    set({ insertVideoDialogOpen }),
  setInsertAudioDialogOpen: (insertAudioDialogOpen) =>
    set({ insertAudioDialogOpen }),
  queueVideoConversions: (items) =>
    set((state) => ({
      pendingVideoConversions: [...state.pendingVideoConversions, ...items],
    })),
  clearVideoConversions: () => set({ pendingVideoConversions: [] }),
  shiftVideoConversion: () =>
    set((state) => ({
      pendingVideoConversions: state.pendingVideoConversions.slice(1),
    })),
  openVideoPlayer: (objectId) =>
    // فاز A2 (A.2.3 — ONE instance across BOTH players): opening the
    // video window closes the audio mini-player. فاز P2: and the PDF
    // viewer (ONE instance across ALL players).
    set({ playerVideoId: objectId, playerAudioId: null, playerPdfId: null }),
  closeVideoPlayer: () => set({ playerVideoId: null }),
  queueAudioConversions: (items) =>
    set((state) => ({
      pendingAudioConversions: [...state.pendingAudioConversions, ...items],
    })),
  clearAudioConversions: () => set({ pendingAudioConversions: [] }),
  shiftAudioConversion: () =>
    set((state) => ({
      pendingAudioConversions: state.pendingAudioConversions.slice(1),
    })),
  openAudioPlayer: (objectId) =>
    // فاز A2 (A.2.3): opening the mini-player closes the video window.
    // فاز P2: and the PDF viewer (ONE instance across ALL players).
    set({ playerAudioId: objectId, playerVideoId: null, playerPdfId: null }),
  closeAudioPlayer: () => set({ playerAudioId: null }),
  setInsertPdfDialogOpen: (insertPdfDialogOpen) =>
    set({ insertPdfDialogOpen }),
  openPdfViewer: (objectId) =>
    // فاز P2 (A.2.3): opening the PDF viewer closes the video window
    // and the audio mini-player (ONE instance across ALL players).
    set({ playerPdfId: objectId, playerVideoId: null, playerAudioId: null }),
  closePdfViewer: () => set({ playerPdfId: null }),
  setPenColor: (penColor) => set({ penColor }),
  setPenWidth: (penWidth) => set({ penWidth: Math.max(1, penWidth) }),
  setPenHighlighter: (penHighlighter) => set({ penHighlighter }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  setSnapSpacing: (snapSpacing) =>
    set({ snapSpacing: Math.max(1, Math.floor(snapSpacing)) }),
  openContextMenu: (x, y, target) =>
    set((state) => ({
      contextMenu: { x, y, target, token: (state.contextMenu?.token ?? 0) + 1 },
    })),
  closeContextMenu: () => set({ contextMenu: null }),
  setPanelOpen: (panelId, open) =>
    set((state) => ({ panelOpen: { ...state.panelOpen, [panelId]: open } })),
  togglePanel: (panelId) =>
    set((state) => ({
      panelOpen: { ...state.panelOpen, [panelId]: !state.panelOpen[panelId] },
    })),
  hydratePanelState: (rehydrated) => set({ panelOpen: { ...rehydrated } }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setBookmarkPromptOpen: (bookmarkPromptOpen) => set({ bookmarkPromptOpen }),
  setConvertTypedDigits: (convertTypedDigits) => set({ convertTypedDigits }),
  setDefaultFontFamily: (defaultFontFamily) => set({ defaultFontFamily }),
  setGridSpacing: (gridSpacing) =>
    set({ gridSpacing: Math.max(4, Math.floor(gridSpacing)) }),
  setAutosaveIntervalSec: (seconds) =>
    set({
      autosaveIntervalSec: Math.min(
        AUTOSAVE_INTERVAL_MAX_SEC,
        Math.max(AUTOSAVE_INTERVAL_MIN_SEC, Math.floor(seconds)),
      ),
    }),
  setSettingsDialogOpen: (settingsDialogOpen) => set({ settingsDialogOpen }),
  setTemplateGalleryOpen: (templateGalleryOpen) => set({ templateGalleryOpen }),
  setStickerPickerOpen: (stickerPickerOpen) => set({ stickerPickerOpen }),
  openMarkdownDialog: (tab) =>
    set({ markdownDialogOpen: true, markdownDialogTab: tab }),
  setMarkdownDialogOpen: (markdownDialogOpen) => set({ markdownDialogOpen }),
  setStyleEditorOpen: (styleEditorOpen) => set({ styleEditorOpen }),
  setMirrorFolderEnabled: (mirrorFolderEnabled) =>
    set({ mirrorFolderEnabled }),
  setExportDialogFormat: (exportDialogFormat) => set({ exportDialogFormat }),
  openExportDialog: (format) =>
    set({ exportDialogFormat: format, exportPngDialogOpen: true }),
  setPresentationActive: (presentationActive) =>
    set({ presentationActive, presentationIndex: 0 }),
  setPresentationIndex: (presentationIndex) =>
    set({ presentationIndex: Math.max(0, presentationIndex) }),
  hydrateSettings: (snapshot) =>
    set({
      ...(snapshot.language !== undefined
        ? { language: snapshot.language }
        : {}),
      ...(snapshot.theme !== undefined ? { theme: snapshot.theme } : {}),
      ...(snapshot.persianDigits !== undefined
        ? { persianDigits: snapshot.persianDigits }
        : {}),
      ...(snapshot.convertTypedDigits !== undefined
        ? { convertTypedDigits: snapshot.convertTypedDigits }
        : {}),
      ...(snapshot.mirrorFolderEnabled !== undefined
        ? { mirrorFolderEnabled: snapshot.mirrorFolderEnabled }
        : {}),
      ...(snapshot.defaultFontFamily !== undefined
        ? { defaultFontFamily: snapshot.defaultFontFamily }
        : {}),
      ...(snapshot.fontSize !== undefined
        ? { fontSize: snapshot.fontSize }
        : {}),
      ...(snapshot.gridSpacing !== undefined
        ? { gridSpacing: snapshot.gridSpacing }
        : {}),
      ...(snapshot.snapEnabled !== undefined
        ? { snapEnabled: snapshot.snapEnabled }
        : {}),
      ...(snapshot.snapSpacing !== undefined
        ? { snapSpacing: snapshot.snapSpacing }
        : {}),
      ...(snapshot.autosaveIntervalSec !== undefined
        ? {
            autosaveIntervalSec: Math.min(
              AUTOSAVE_INTERVAL_MAX_SEC,
              Math.max(
                AUTOSAVE_INTERVAL_MIN_SEC,
                Math.floor(snapshot.autosaveIntervalSec),
              ),
            ),
          }
        : {}),
    }),
}));
