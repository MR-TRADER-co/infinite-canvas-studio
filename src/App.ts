"use client";

/**
 * Application composition root.
 *
 * Boots the typed service container, constructs the canvas stack (scene,
 * camera controller, history, tools, stroke overlay) and wires every
 * mutation onto the typed event bus. It is idempotent so both shells
 * (Next.js preview and Tauri desktop entry) can call
 * {@link Application.boot} safely.
 */
import { AppContext, ServiceKey } from "@/AppContext";
import { ConsoleLogSink, Logger, type ILogSink } from "@/Logger";
import { EventBus, type AppEventMap } from "@/core/events/EventBus";
import { TauriFileLogSink, isTauriEnvironment } from "@/platform/tauri/log";
import { useUiStore } from "@/ui/store/uiStore";
import {
  appSelectionClipboard,
  plainTextOfObjects,
} from "@/core/clipboard/SelectionClipboard";
import {
  imageObjectToPngBlob,
  readSystemClipboard,
  writeImageObjectToSystemClipboard,
  writeRichTextToSystemClipboard,
  writeSelectionImageToSystemClipboard,
  writeTextToSystemClipboard,
  type ClipboardWriteOutcome,
} from "@/ui/clipboard/osClipboard";
import {
  downloadBlob,
  IMAGE_DOWNLOAD_FILENAME,
  SELECTION_SNAPSHOT_FILENAME,
} from "@/ui/clipboard/blobDownload";
import {
  decodeImageFile,
  insertDecodedImage,
  insertTextBoxAt,
  markInternalPasteHandled,
} from "@/ui/clipboard/canvasImport";
import {
  buildSelectionSubsetScene,
  rasterizeSceneToPngBlob,
  shouldRasterizeSelection,
} from "@/ui/clipboard/selectionRaster";
import { richTextHtmlOfObjects } from "@/ui/clipboard/richTextOut";
import {
  WORD_EXPORT_FILENAME,
  wordDocumentBlob,
} from "@/persistence/exporters/WordExporter";
import { isImportablePasteText } from "@/core/clipboard/DropPayload";
import { Scene } from "@/core/model/Scene";
import type { Vec2 } from "@/core/geometry/Vec2";
import { Camera } from "@/core/camera/Camera";
import { CameraController } from "@/core/camera/CameraController";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { Selection } from "@/core/selection/Selection";
import { ToolManager } from "@/interaction/ToolManager";
import { HandTool } from "@/interaction/HandTool";
import { PenTool } from "@/interaction/PenTool";
import { EraserTool } from "@/interaction/EraserTool";
import { SelectTool } from "@/interaction/SelectTool";
import { TextTool } from "@/interaction/TextTool";
import { TableTool } from "@/interaction/TableTool";
import { StickyTool } from "@/interaction/StickyTool";
import { ShapeTool } from "@/interaction/ShapeTool";
import { ConnectorTool } from "@/interaction/ConnectorTool";
import { MarqueeLogic } from "@/interaction/MarqueeLogic";
import { Coalescer } from "@/core/commands/Coalescer";
import type { ICommand } from "@/core/commands/Command";
import { CommandRegistry } from "@/core/registry/CommandRegistry";
import { CommandDispatcher } from "@/interaction/dispatch/CommandDispatcher";
import { registerCoreCommands } from "@/interaction/dispatch/commands";
import type {
  CoreCommandWiring,
  EditorTextAction,
  TableAction,
  ToolCommandId,
} from "@/interaction/dispatch/commands";
import { StrokeOverlay } from "@/rendering/StrokeOverlay";
import { ShapeOverlay } from "@/rendering/ShapeOverlay";
import { ConnectorOverlay } from "@/rendering/ConnectorOverlay";
import { GuidesOverlay } from "@/rendering/GuidesOverlay";
import { HandlesRenderer } from "@/rendering/HandlesRenderer";
import { TextLayerView } from "@/text/view/TextLayerView";
import { getSharedTextEditor } from "@/text/editor/TipTapFactory";
import { copyFormatFrom, pasteFormatOnto } from "@/text/editor/FormatPainter";
import { STROKE_COLOR_TOKEN } from "@/core/model/FreehandObject";
import { SHAPE_FILL_TOKEN, type ShapeStyle } from "@/core/model/ShapeObject";
import type { StrokeStyle } from "@/interaction/PenTool";
import type { SnapConfig } from "@/interaction/SnapEngine";
import {
  DEFAULT_CONNECTOR_STYLE,
  type ConnectorStyle,
} from "@/core/model/ConnectorObject";
import {
  applyProjectData,
  buildProjectData,
  type ProjectData,
} from "@/persistence/ProjectFile";
import { VersionedSerializer } from "@/persistence/VersionedSerializer";
import {
  WebStorageBackend,
  type IProjectStorage,
} from "@/persistence/StorageBackend";
import { TauriAppDataStorage } from "@/persistence/TauriAppDataStorage";
import { AutosaveService } from "@/persistence/AutosaveService";
import { DocumentService } from "@/persistence/DocumentService";
import { RecentFilesService } from "@/persistence/RecentFilesService";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";
import { ContextMenuRegistry } from "@/core/registry/ContextMenuRegistry";
import { registerContextMenuContributions } from "@/ui/contextMenu/contributions";
import { vec2 } from "@/core/geometry/Vec2";
import { registerCoreObjectTypes } from "@/persistence/objectTypes";
import { writeProjectFile } from "@/persistence/SaveToDisk";
import { t } from "@/ui/i18n";
import { togglePinSelection } from "@/core/commands/SelectionOps";
import { attachQaHook } from "@/dev/qaHook";
import { isPinnedObject } from "@/core/model/Pinned";
import { SceneSpatialIndex } from "@/core/spatial/SceneSpatialIndex";
import { RTreeSpatialIndex } from "@/core/spatial/RTreeSpatialIndex";
import { BookmarkService } from "@/core/bookmarks/BookmarkService";
import { insertCatalogObject } from "@/interaction/CatalogInsert";
import { createElement, type ComponentType } from "react";
import { PanelRegistry } from "@/ui/registry/PanelRegistry";
import { InspectorSectionRegistry } from "@/ui/registry/InspectorSectionRegistry";
import { SettingsSectionRegistry } from "@/ui/registry/SettingsSectionRegistry";
import { VersionHistoryService } from "@/core/history/VersionHistoryService";
import {
  LifecycleManager,
  type SandboxSpawn,
} from "@/plugins/host/LifecycleManager";
import type { InstalledPluginRecord } from "@/plugins/host/PluginStore";
import { PluginStore } from "@/plugins/host/PluginStore";
import { commandContextOf } from "@/interaction/dispatch/CommandDispatcher";
import type { CommandContext } from "@/core/registry/CommandRegistry";
import { PluginObjectLayer } from "@/plugins/host/PluginObjectLayer";
import { spawnSandbox } from "@/plugins/host/SandboxHost";
import { DataHub } from "@/datahub/DataHub";
import { buildProjectDigest } from "@/datahub/contracts/projectDigest";
import {
  registerSceneQueryContract,
  sceneQueryChangePublisher,
} from "@/datahub/contracts/sceneQuery";
import {
  RuleEngine,
  type AutomationDispatcher,
} from "@/datahub/automations/RuleEngine";
import { RuleStore } from "@/datahub/automations/rules";
import PluginRegionFrame from "@/ui/components/plugins/PluginRegionFrame";
import { createTauriSqlDbAccess } from "@/core/db/DbAccess";
import { formatTodayAsJalaliText } from "@/core/utils/jalali";
import { setPersianDigitsInputEnabled } from "@/text/editor/extensions/PersianDigits";
import { presentationFrames } from "@/core/presentation/Presentation";
import { subscribeOpenFile } from "@/platform/tauri/openFile";
import {
  buildWebDeepLinkHash,
  readDeepLinkFromLocation,
  subscribeDeepLink,
  type DeepLink,
} from "@/platform/tauri/deeplink";
import { StyleRegistry } from "@/core/knowledge/StyleRegistry";
import { PropertySchemaStore } from "@/core/knowledge/PropertySchemaStore";
import { KnowledgeService } from "@/core/knowledge/KnowledgeService";
import { planGraphArrange } from "@/core/knowledge/GraphArrange";
import {
  objectBBox,
  type SceneObjectData,
} from "@/core/model/SceneObject";
import {
  isImageObject,
  insertStateResetPatch,
  naturalResetPatch,
  type ImageObjectData,
} from "@/core/model/ImageObject";
import { formatInteger } from "@/ui/i18n/numbers";
import { LinkRegistry } from "@/core/knowledge/LinkRegistry";
import {
  WebAssetStore,
  type AssetStore,
} from "@/persistence/AssetStore";
import { TauriAssetStore } from "@/persistence/TauriAssetStore";
import { setAssetUrlResolver } from "@/media/AssetUrlResolver";
import { PdfRenderer } from "@/media/PdfRenderer";
import { collectVideoAssetHashes } from "@/core/model/VideoObject";
import { collectAudioAssetHashes } from "@/core/model/AudioObject";
import { collectPdfAssetHashes } from "@/core/model/PdfObject";
import {
  collectGroupMembers,
  computeReflowPlan,
  slotRequiresMove,
} from "@/core/knowledge/LayoutService";
import { exportSceneToMarkdown } from "@/persistence/MarkdownInterop";
import { isFrameObject, type FrameObjectData } from "@/core/model/FrameObject";
import { MoveCommand } from "@/core/commands/MoveCommand";
import { ResizeCommand } from "@/core/commands/ResizeCommand";
import { CompositeCommand } from "@/core/commands/CompositeCommand";
import {
  canInsertColumnVisual,
  canSplitCellAlongAxis,
  currentTableDirection,
  distributeTableColumns,
  findTableAncestor,
  insertColumnVisual,
  insertTableInheritingDirection,
  isSelectionInTable,
  measureTableColumnFallbackWidth,
  setCellVerticalAlign,
  setTablePreset,
  splitCellAlongAxis,
  toggleTableDirection,
} from "@/text/editor/tableCommands";
import { coerceTablePreset } from "@/text/editor/extensions/table";

/** Service keys for everything registered during boot. */
export const Services = {
  logger: ServiceKey.create<Logger>("logger"),
  eventBus: ServiceKey.create<EventBus<AppEventMap>>("eventBus"),
  scene: ServiceKey.create<Scene>("scene"),
  cameraController: ServiceKey.create<CameraController>("cameraController"),
  history: ServiceKey.create<HistoryManager>("history"),
  toolManager: ServiceKey.create<ToolManager>("toolManager"),
  strokeOverlay: ServiceKey.create<StrokeOverlay>("strokeOverlay"),
  shapeOverlay: ServiceKey.create<ShapeOverlay>("shapeOverlay"),
  connectorOverlay: ServiceKey.create<ConnectorOverlay>("connectorOverlay"),
  handlesRenderer: ServiceKey.create<HandlesRenderer>("handlesRenderer"),
  selection: ServiceKey.create<Selection>("selection"),
  idGenerator: ServiceKey.create<IdGenerator>("idGenerator"),
  textLayer: ServiceKey.create<TextLayerView>("textLayer"),
  autosave: ServiceKey.create<AutosaveService>("autosave"),
  serializer: ServiceKey.create<VersionedSerializer>("serializer"),
  projectStorage: ServiceKey.create<IProjectStorage>("projectStorage"),
  /** The object registry — the (de)serialization dispatch surface (R4.1). */
  objectRegistry: ServiceKey.create<ObjectRegistry>("objectRegistry"),
  /** The open-document lifecycle state (R4.5). */
  document: ServiceKey.create<DocumentService>("document"),
  /** The recent files list (R4.7). */
  recentFiles: ServiceKey.create<RecentFilesService>("recentFiles"),
  /** The command registry — every user-invokable action (R3B5.2). */
  commands: ServiceKey.create<CommandRegistry>("commands"),
  /** The single dispatcher all surfaces execute through (R3B5.2). */
  commandDispatcher: ServiceKey.create<CommandDispatcher>("commandDispatcher"),
  /** The context-menu registry — every right-click contribution (R6.2). */
  contextMenu: ServiceKey.create<ContextMenuRegistry>("contextMenu"),
  /** The smart-guide overlay — transient drag guides (R7.4). */
  guidesOverlay: ServiceKey.create<GuidesOverlay>("guidesOverlay"),
  /** The scene R-tree index — broad-phase hit-testing (R7.10). */
  spatialIndex: ServiceKey.create<SceneSpatialIndex>("spatialIndex"),
  /** The camera bookmark store (R7.9). */
  bookmarks: ServiceKey.create<BookmarkService>("bookmarks"),
  /** The dock-panel registry (R7.1). */
  panels: ServiceKey.create<PanelRegistry>("panels"),
  /** The inspector-section registry (R7.2). */
  inspectorSections:
    ServiceKey.create<InspectorSectionRegistry>("inspectorSections"),
  /** The settings-section registry (R8.2 — the Settings dialog composes
   *  from this). */
  settingsSections:
    ServiceKey.create<SettingsSectionRegistry>("settingsSections"),
  /** The version-history service (R8.5 — snapshots of manual saves). */
  versionHistory: ServiceKey.create<VersionHistoryService>("versionHistory"),
  /** The plugin lifecycle manager (R9.5 — install/enable/disable/…). */
  pluginManager: ServiceKey.create<LifecycleManager>("pluginManager"),
  /** The plugin object DOM layer (R9.9 — sandboxed widget views). */
  pluginObjectLayer: ServiceKey.create<PluginObjectLayer>("pluginObjectLayer"),
  /** The Data Hub (R10.1 — typed, versioned inter-plugin contracts). */
  dataHub: ServiceKey.create<DataHub>("dataHub"),
  /** The automations rule engine (R10.7). */
  automations: ServiceKey.create<RuleEngine>("automations"),
  /** The named-style registry (R13.3 — styles section, schema v3). */
  styles: ServiceKey.create<StyleRegistry>("styles"),
  /** The property-schema store (pack R11.3 — propertySchema section). */
  propertySchema: ServiceKey.create<PropertySchemaStore>("propertySchema"),
  /** The knowledge service (pack-Phase-11 rebuild — wiki links/backlinks/tags). */
  knowledge: ServiceKey.create<KnowledgeService>("knowledge"),
  /** The link registry (pack R11.2 — §1.7.8's manual/plugin link store). */
  links: ServiceKey.create<LinkRegistry>("links"),
  /** The sidecar AssetStore (فاز M1 — video bytes stay OUT of the .icb). */
  assetStore: ServiceKey.create<AssetStore>("assetStore"),
  /** The pdf.js wrapper service (فاز P1 — posters + page counts). */
  pdfRenderer: ServiceKey.create<PdfRenderer>("pdfRenderer"),
} as const;

/** Default stroke width in world units (matches the inspector "thin" preset). */
const DEFAULT_STROKE_WIDTH = 2;

/** Boots the application once and wires every service. */
export class Application {
  /** The in-flight/completed boot (concurrent callers share ONE boot). */
  private static bootPromise: Promise<AppContext> | null = null;

  /**
   * Boots the application; concurrent + subsequent calls AWAIT the same
   * boot (R9: late-boot services — the plugin layer — must be visible to
   * every caller, never a half-built default context).
   *
   * @returns the fully wired {@link AppContext}.
   */
  public static boot(): Promise<AppContext> {
    if (Application.bootPromise === null) {
      Application.bootPromise = Application.build();
    }
    return Application.bootPromise;
  }

  /**
   * The boot sequence itself (single-owner: {@link boot}).
   *
   * @returns the fully wired context.
   */
  private static async build(): Promise<AppContext> {
    const context = new AppContext();
    // The default context is visible DURING the build (services register
    // progressively); the shared boot PROMISE is what guarantees callers
    // only observe the COMPLETED wiring.
    AppContext.setDefault(context);

    const platform = isTauriEnvironment() ? "tauri" : "web";
    const sinks: ILogSink[] = [new ConsoleLogSink()];
    if (isTauriEnvironment()) {
      sinks.push(new TauriFileLogSink());
    }

    const logger = new Logger(sinks, { minLevel: "debug", context: "app" });
    context.register(Services.logger, logger);

    const eventBus = new EventBus<AppEventMap>();
    context.register(Services.eventBus, eventBus);

    const fileLayer = await registerCanvasServices(context, eventBus, logger);
    registerCommandLayer(context, logger, fileLayer.performDiskSave);
    registerDataHubLayer(context, eventBus, logger);
    registerPluginLayer(context, eventBus, logger);
    bridgeUiStoreToEventBus(eventBus, logger);

    // فاز ۳۳: the DEV-ONLY `window.__qa` introspection hook — read-only
    // scene/camera/selection access for QA rounds (never in production
    // builds; idempotent under StrictMode double-boots).
    if (process.env.NODE_ENV === "development") {
      const scene = context.tryGet(Services.scene);
      const selection = context.tryGet(Services.selection);
      if (scene !== undefined && selection !== undefined) {
        attachQaHook({
          scene,
          selection,
          phase: () => t("app.phase"),
          version: () => t("status.version"),
        });
      }
    }

    eventBus.emit("app:started", { timestamp: Date.now() });
    logger.info("application booted", { platform });
    return context;
  }
}

/**
 * Constructs and registers the canvas stack (scene, camera, history,
 * tools, overlay) and wires all change notifiers onto the event bus.
 *
 * @param context - the service container receiving the registrations.
 * @param eventBus - the bus receiving change events.
 * @param logger - the root logger.
 */
async function registerCanvasServices(
  context: AppContext,
  eventBus: EventBus<AppEventMap>,
  logger: Logger,
): Promise<{ readonly performDiskSave: (path: string) => Promise<boolean> }> {
  const emitCamera = (): void => {
    const camera = scene.camera;
    eventBus.emit("camera:changed", {
      x: camera.x,
      y: camera.y,
      zoom: camera.zoom,
      rotation: camera.rotation,
    });
  };
  const emitScene = (): void => {
    eventBus.emit("scene:changed", {
      revision: scene.revision,
      objectCount: scene.objectCount,
    });
  };
  const emitSelection = (): void => {
    eventBus.emit("selection:changed", { size: selection.size });
  };

  const selection = new Selection(emitSelection);
  const scene = new Scene(new Camera(), selection, emitScene);
  context.register(Services.scene, scene);
  context.register(Services.selection, selection);

  // ≥ 200 undo steps per the interaction spec (R2.6).
  const history = new HistoryManager(200, () => {
    eventBus.emit("history:changed", {
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
    });
  });
  context.register(Services.history, history);

  const controller = new CameraController(scene.camera, emitCamera);
  context.register(Services.cameraController, controller);

  const overlay = new StrokeOverlay();
  context.register(Services.strokeOverlay, overlay);

  const shapeOverlay = new ShapeOverlay();
  context.register(Services.shapeOverlay, shapeOverlay);

  const connectorOverlay = new ConnectorOverlay();
  context.register(Services.connectorOverlay, connectorOverlay);

  // R7.4: the transient smart-guide overlay the SelectTool streams drag
  // frames into (rendered above the committed scene by the render loop).
  const guidesOverlay = new GuidesOverlay();
  context.register(Services.guidesOverlay, guidesOverlay);

  // R7.10: the scene's R-tree index — the broad phase behind hit-testing
  // and marquee resolution (enabled here; the linear backend stays the
  // reference implementation in tests).
  const spatialIndex = new SceneSpatialIndex(scene, new RTreeSpatialIndex());
  context.register(Services.spatialIndex, spatialIndex);

  const handles = new HandlesRenderer();
  context.register(Services.handlesRenderer, handles);

  // Single id source of truth: every object-creating site (pen tool,
  // duplication, later paste/import) draws from the same monotonic sequence,
  // so ids can never collide across features.
  const idGenerator = new IdGenerator("obj");
  context.register(Services.idGenerator, idGenerator);

  const toolManager = new ToolManager();
  toolManager.register(
    new SelectTool({
      scene,
      history,
      selection,
      coalescer: new Coalescer(),
      marquee: new MarqueeLogic(scene, spatialIndex),
      handles,
      bus: eventBus,
      getFontSize: () => useUiStore.getState().fontSize,
      ids: idGenerator,
      getSnapConfig,
      guides: guidesOverlay,
      spatialIndex,
      // فاز ۲۵ «سنجاش روی صفحه»: the pin-anchor coordinate space (the
      // same live-canvas convention as `viewportCentre`/`fitToContent`).
      getViewport: canvasViewport,
    }),
  );
  toolManager.register(new HandTool(controller));
  toolManager.register(
    new PenTool({
      scene,
      history,
      ids: idGenerator,
      overlay,
      getStrokeStyle,
    }),
  );
  toolManager.register(new EraserTool(scene, history));
  toolManager.register(
    new TextTool({
      scene,
      bus: eventBus,
      getFontSize: () => useUiStore.getState().fontSize,
      getSnapConfig,
    }),
  );
  toolManager.register(
    new StickyTool({
      scene,
      bus: eventBus,
      getNoteColor: () => useUiStore.getState().stickyColor,
      getFontSize: () => useUiStore.getState().fontSize,
      getSnapConfig,
    }),
  );
  toolManager.register(
    new TableTool({
      bus: eventBus,
      getRows: () => useUiStore.getState().tableRows,
      getColumns: () => useUiStore.getState().tableColumns,
      getFontSize: () => useUiStore.getState().fontSize,
      getSnapConfig,
    }),
  );
  toolManager.register(
    new ShapeTool({
      scene,
      history,
      ids: idGenerator,
      overlay: shapeOverlay,
      getShapeKind: () => useUiStore.getState().shapeKind,
      getShapeStyle,
      getSnapConfig,
    }),
  );
  toolManager.register(
    new ConnectorTool({
      scene,
      history,
      ids: idGenerator,
      overlay: connectorOverlay,
      getConnectorStyle,
      getSnapConfig,
    }),
  );
  context.register(Services.toolManager, toolManager);

  // The DOM overlay for text objects: created app-scoped, attached to the
  // canvas surface by the React host, synced by the render loop's frame.
  const textLayer = new TextLayerView({
    scene,
    selection,
    history,
    ids: idGenerator,
    bus: eventBus,
    getLabels: () => ({
      placeholder: t("text.placeholder"),
      stickyPlaceholder: t("sticky.placeholder"),
    }),
    // R8.2: the default font family of NEW text objects (the Settings
    // dialog's text section owns the value).
    getFontFamily: () => useUiStore.getState().defaultFontFamily,
  });
  context.register(Services.textLayer, textLayer);

  // Tools express text intents on the bus; the composition root forwards
  // them to the text layer (feature modules never import each other).
  eventBus.on("text:edit-requested", ({ objectId }) =>
    textLayer.beginEditing(objectId),
  );
  eventBus.on(
    "text:create-requested",
    ({ x, y, width, height, fontSize, sizeMode }) =>
      textLayer.beginCreation({ x, y, width, height }, fontSize, sizeMode),
  );
  eventBus.on(
    "sticky:create-requested",
    ({ x, y, width, height, noteColor, fontSize }) =>
      textLayer.beginStickyCreation(
        { x, y, width, height },
        noteColor,
        fontSize,
      ),
  );
  eventBus.on(
    "table:create-requested",
    ({ x, y, width, height, rows, cols, fontSize }) =>
      textLayer.beginTableCreation(
        { x, y, width, height },
        rows,
        cols,
        fontSize,
      ),
  );
  // Rich-text editor notices (R6.6: rejected nested-table paste; R3B.5:
  // dropped remote images) surface as transient toasts through the same
  // bus → UI path.
  getSharedTextEditor().setNoticeHandler((messageKey) => {
    eventBus.emit("ui:notice", { messageKey, severity: "error" });
  });
  // Editor-originated UI intents (R3B.3/R3B.8): the in-editor Ctrl+K /
  // Ctrl+F leave the text layer through the injected handler and reach the
  // React surfaces through the typed event bus (never a direct import).
  getSharedTextEditor().setIntentHandler((intent) => {
    if (intent.type === "link-dialog") {
      eventBus.emit("ui:link-dialog-requested", { fromSelection: true });
      return;
    }
    if (intent.type === "context-menu") {
      // R6.2: an editor right-click resolved its region (table vs. text).
      eventBus.emit("ui:context-menu-requested", {
        region: intent.region,
        x: intent.x,
        y: intent.y,
      });
      return;
    }
    eventBus.emit("ui:find-requested", { source: "editor" });
  });

  // Activate the tool the UI store starts with and follow later switches.
  toolManager.activate(useUiStore.getState().activeTool);
  eventBus.on("ui:tool-changed", ({ tool }) => {
    toolManager.activate(tool);
  });

  // ---- Persistence (R4): registry, document lifecycle, autosave,
  //      recovery, recent files + the file command flows -----------------
  const objectRegistry = registerCoreObjectTypes(new ObjectRegistry(true));
  context.register(Services.objectRegistry, objectRegistry);

  const serializer = new VersionedSerializer(objectRegistry);
  context.register(Services.serializer, serializer);

  // R4.6: the autosave slot lives in the app-data directory on the
  // desktop shell (autosave.icb) and in localStorage on the web — the
  // desktop backend degrades to localStorage when the app-data path is
  // unavailable, so autosave never silently disappears.
  const storage: IProjectStorage = isTauriEnvironment()
    ? new TauriAppDataStorage()
    : new WebStorageBackend();
  context.register(Services.projectStorage, storage);

  const document = new DocumentService(eventBus);
  context.register(Services.document, document);

  // فاز M1 (A.2.1): the sidecar AssetStore — video bytes (and their
  // posters) live NEXT TO the .icb, hash-named and deduped, so project
  // files stay KB-scale. The web shell talks to /api/assets/* (the
  // LocalFsBridge posture); the renderer resolves poster URLs through
  // the injected seam (no cycle into the composition root).
  // فاز D1 (DECISIONS #63): the desktop shell swaps in the fs-backed
  // Tauri twin behind the SAME seam — the `icbasset` protocol + chunked
  // IPC writes — so media imports (image posters, audio, video, PDF)
  // work inside the exe exactly like the web shell's `/api/assets/*`
  // routes. The web shell keeps WebAssetStore, untouched.
  const assetStore: AssetStore = isTauriEnvironment()
    ? new TauriAssetStore()
    : new WebAssetStore();
  context.register(Services.assetStore, assetStore);
  setAssetUrlResolver((hash, mime) => assetStore.assetUrl(hash, mime));

  // فاز P1 (RP1.4): the pdf.js wrapper — lazy-loaded, worker from the
  // bundled public/pdfjs/ assets (100% offline, A.2.5). The service is
  // injected (never imported by core) so tests mock it freely.
  context.register(Services.pdfRenderer, new PdfRenderer());

  const recentFiles = new RecentFilesService();
  context.register(Services.recentFiles, recentFiles);

  // R7.9: camera bookmarks — captured from the scene camera, persisted
  // with the project file, restored on load.
  const bookmarks = new BookmarkService({
    getCamera: () => scene.camera,
    onChange: () => {
      document.markDirty();
      eventBus.emit("bookmarks:changed", { count: bookmarks.list().length });
    },
  });
  context.register(Services.bookmarks, bookmarks);

  // R13.3: the named-style registry — built-ins ship always; user styles
  // persist with the project (schema v3). Every mutation re-broadcasts
  // through the typed bus so the panels + plugin allowlist stay live.
  const styles = new StyleRegistry();
  context.register(Services.styles, styles);
  styles.subscribe(() => {
    document.markDirty();
    eventBus.emit("styles:changed", { count: styles.list().length });
  });

  // Pack R11.3: the property-schema store — the project's memory of
  // property names → types (inferred on first use). Schema edits mark
  // the document dirty (they persist in the propertySchema section) but
  // are NOT undoable — they re-type editors, never values (the styles
  // precedent, DECISIONS #52).
  const propertySchema = new PropertySchemaStore();
  context.register(Services.propertySchema, propertySchema);
  propertySchema.subscribe(() => {
    document.markDirty();
    eventBus.emit("property-schema:changed", {
      count: propertySchema.names().length,
    });
  });

  // Pack R11.2 (law §1.7.8): the link registry — the single source of
  // truth for manual/plugin object links. Wiki links stay intrinsic to
  // the text (parsed as projections); every OTHER link kind lives ONLY
  // here and persists through the optional `links` file section.
  const links = new LinkRegistry();
  context.register(Services.links, links);

  // Pack-Phase-11 rebuild + R11.2/R11.10: the knowledge service — the
  // wiki-link index ([[عنوان]] links, backlinks, #tags) rebuilt from the
  // scene + the registry's link entries folded in as projections. The
  // rebuild is debounced (250ms after the last scene mutation OR link
  // mutation): the reflow, autosave and this index share the
  // scene:changed stream but each owns its own schedule; a rebuild only
  // ever reads.
  const knowledge = new KnowledgeService({
    getObjects: () => scene.objects,
    getLinks: () => links.list(),
  });
  context.register(Services.knowledge, knowledge);
  knowledge.rebuild();

  // R11.10: the structured-properties diff snapshot — after every
  // debounced rebuild, objects whose `properties` record changed (edit,
  // undo/redo, import) surface through `object:properties-changed`.
  let prevProperties = new Map<string, string>(
    scene.objects.map((object) => [
      object.id,
      JSON.stringify(object.properties ?? {}),
    ]),
  );
  // R11.2 resolution transitions: dangling → resolved entries surface
  // through `object:linking-changed`'s `resolved` counter.
  let prevResolvedLinkIds = new Set<string>(
    [...knowledge.current().linkResolution.entries()]
      .filter(([, target]) => target !== null)
      .map(([id]) => id),
  );

  let knowledgeTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleKnowledgeRebuild = (): void => {
    if (knowledgeTimer !== null) {
      clearTimeout(knowledgeTimer);
    }
    knowledgeTimer = setTimeout(() => {
      knowledgeTimer = null;
      knowledge.rebuild();

      // R11.10 — properties diff (the plugin-visible change event).
      const nextProperties = new Map<string, string>(
        scene.objects.map((object) => [
          object.id,
          JSON.stringify(object.properties ?? {}),
        ]),
      );
      const changedIds: string[] = [];
      for (const [id, signature] of nextProperties) {
        if (prevProperties.get(id) !== signature) {
          changedIds.push(id);
        }
      }
      prevProperties = nextProperties;
      if (changedIds.length > 0) {
        eventBus.emit("object:properties-changed", { objectIds: changedIds });
      }

      // R11.2 — resolution transitions (dangling → resolved).
      const nextResolved = new Set<string>(
        [...knowledge.current().linkResolution.entries()]
          .filter(([, target]) => target !== null)
          .map(([id]) => id),
      );
      let newlyResolved = 0;
      for (const id of nextResolved) {
        if (!prevResolvedLinkIds.has(id)) {
          newlyResolved += 1;
        }
      }
      prevResolvedLinkIds = nextResolved;
      if (newlyResolved > 0) {
        eventBus.emit("object:linking-changed", {
          added: 0,
          removed: 0,
          resolved: newlyResolved,
          total: links.count(),
        });
      }

      const stats = knowledge.stats();
      eventBus.emit("knowledge:changed", stats);
    }, 250);
  };
  eventBus.on("scene:changed", scheduleKnowledgeRebuild);

  // R11.2/R11.6: registry mutations (commands) mark the document dirty,
  // broadcast the mutation diff and schedule the projection rebuild.
  links.subscribe(() => {
    document.markDirty();
    const diff = links.drainDiff();
    if (diff.added > 0 || diff.removed > 0) {
      eventBus.emit("object:linking-changed", {
        added: diff.added,
        removed: diff.removed,
        resolved: 0,
        total: links.count(),
        // Pack-14 R14.5: the automations engine's change-type filter
        // reads `.type` — the link-created trigger needs it on the
        // payload.
        type:
          diff.added > 0
            ? "link-created"
            : diff.removed > 0
              ? "link-removed"
              : "link-changed",
      });
    }
    scheduleKnowledgeRebuild();
  });

  // R7.1/R7.2 + R8.2 + R9.5: the panel + inspector + settings-section
  // registries — OPEN to third-party owners (§1.7.2): plugin panels and
  // settings sections register through their own owner namespace at
  // enable time; core entries register from the ui layer at host mount
  // (ui/panels/registerPanels, ui/settings/registerSettings).
  const panelRegistry = new PanelRegistry(true);
  const settingsSections = new SettingsSectionRegistry(true);
  context.register(Services.panels, panelRegistry);
  context.register(Services.inspectorSections, new InspectorSectionRegistry());
  context.register(Services.settingsSections, settingsSections);

  // R8.5: version history — SQLite via tauri-plugin-sql on the desktop
  // shell, the localStorage engine on the web (same statement surface
  // through the namespaced DbAccess gate).
  const versionHistory = await createVersionHistory();
  context.register(Services.versionHistory, versionHistory);

  const autosave = new AutosaveService({
    serializer,
    storage,
    bus: eventBus,
    getProjectData: () =>
      // Styles + the property schema + the link registry ride the
      // autosave slot too (a crash must not lose named styles, known
      // property types or manual links).
      buildProjectData(
        scene,
        document.getPlugins(),
        bookmarks.list(),
        styles.toSection(),
        propertySchema.toSection(),
        links.toSection(
          new Set(scene.objects.map((object) => object.id)),
        ),
      ),
  });
  context.register(Services.autosave, autosave);
  /**
   * Applies a validated payload as the current document: scene swap,
   * history reset, id reseeding, plugins passthrough (§1.7.4) and the
   * document lifecycle state (R4.5) — dirty tracking is suspended for the
   * swap so a freshly opened file starts clean.
   */
  const restoreDocument = (
    data: ProjectData,
    path: string | null,
    options: { readOnly?: boolean } = {},
  ): number => {
    document.suspendDirtyTracking();
    const count = applyProjectData(scene, data);
    history.clear();
    idGenerator.reseed(data.objects.map((object) => object.id));
    document.setPlugins(data.plugins ?? {});
    bookmarks.replaceAll(data.bookmarks ?? []);
    styles.replaceFromSection(data.styles ?? { version: 1, styles: [] });
    propertySchema.replaceFromSection(
      data.propertySchema ?? { version: 1, fields: {} },
    );
    // Pack R11.2: §1.7.8's link store resets with the document (a
    // replace is not a user mutation — diff counters stay silent).
    links.replaceFromSection(data.links ?? { version: 1, links: [] });
    document.openedFromDisk(path, options.readOnly ?? false);
    // فاز M1: the AssetStore scope follows the opened document — reads
    // resolve against THIS project's sidecar (+ the inbox fallback);
    // a null path (fresh canvas / autosave restore) scopes to the inbox.
    assetStore.setProjectPath(path);
    // The swap's own change notifications stay INSIDE the suspension so a
    // freshly opened file starts clean (dirty tracking resumes after).
    emitCamera();
    emitScene();
    document.resumeDirtyTracking();
    eventBus.emit("project:restored", { objectCount: count });
    if (path !== null) {
      recentFiles.add(path);
    }
    return count;
  };

  /**
   * Performs a disk save at the document's known path (R4.5 Ctrl+S),
   * then refreshes the document state, the recent list AND the recovery
   * slot (so the next boot's recovery comparison sees slot == disk and
   * stays quiet).
   */
  const performDiskSave = async (path: string): Promise<boolean> => {
    if (document.isReadOnly()) {
      eventBus.emit("ui:notice", {
        messageKey: "file.readOnlyBlocked",
        severity: "error",
      });
      return false;
    }
    const result = await writeProjectFile(
      scene,
      serializer,
      path,
      document.getPlugins(),
      {
        bookmarks: bookmarks.list(),
        styles: styles.toSection(),
        propertySchema: propertySchema.toSection(),
        links: links.toSection(
          new Set(scene.objects.map((object) => object.id)),
        ),
      },
    );
    if (result.kind !== "saved") {
      eventBus.emit("ui:notice", {
        messageKey: "saveAt.failedToast",
        severity: "error",
      });
      logger.warn("disk save failed", {
        reason: result.kind === "failed" ? result.reason : "unknown",
      });
      return false;
    }
    const savedAt = Date.now();
    document.noteDiskSave(result.path, savedAt);
    recentFiles.add(result.path);
    eventBus.emit("project:file-saved", { path: result.path, savedAt });
    eventBus.emit("ui:notice", {
      messageKey: "saveAt.savedToast",
      severity: "info",
      values: { path: result.path },
    });
    // فاز M1 (A.2.1): the save ALSO adopts the asset scope — inbox files
    // MOVE into this project's sidecar on the first Save As; a later
    // Save As to a new path COPIES the referenced assets (the old file
    // keeps working). Content addressing keeps this idempotent.
    // فاز A1: audio hashes ride the SAME relocation manifest (the video
    // list + the audio list — duplicates across the two are no-ops).
    // فاز P1: PDF hashes ride the SAME relocation manifest (original +
    // every captured page poster).
    void assetStore
      .syncProjectPath(result.path, [
        ...collectVideoAssetHashes(scene.objects),
        ...collectAudioAssetHashes(scene.objects),
        ...collectPdfAssetHashes(scene.objects),
      ])
      .then((outcome) => {
        if (!outcome.relocated) {
          logger.warn("asset relocation incomplete", {
            missing: outcome.missing.length,
          });
        }
      });
    // R8.5: every successful manual save leaves a timestamped snapshot
    // in the history store (SQLite / localStorage per shell).
    const snapshotJson = serializer.serialize(
      buildProjectData(
        scene,
        document.getPlugins(),
        bookmarks.list(),
        styles.toSection(),
        propertySchema.toSection(),
        links.toSection(
          new Set(scene.objects.map((object) => object.id)),
        ),
      ),
      savedAt,
    );
    void versionHistory.record(result.path, snapshotJson).then((recorded) => {
      if (recorded !== null) {
        eventBus.emit("version-history:changed", { count: 1 });
      }
    });
    // Sync the recovery slot to the saved state (R4.6: a boot right after
    // a save must NOT offer recovery — slot and disk agree).
    void autosave.saveNow("flush");
    logger.info("project saved", { path: result.path });
    return true;
  };

  // Boot recovery (R4.6): the autosave slot is read once; when it is
  // NEWER than the last disk save, the Persian recovery dialog
  // («بازیابی آخرین تغییرات؟») offers the restore. A stale or corrupt
  // slot starts a fresh canvas quietly.
  let pendingRecovery: ProjectData | null = null;
  void storage.read().then((raw) => {
    if (raw === null) {
      return;
    }
    const outcome = serializer.deserialize(raw);
    if (outcome.status !== "ok") {
      return;
    }
    const { data, savedAt } = outcome;
    const lastDisk = document.lastDiskSaveAt();
    if (savedAt !== null && lastDisk !== null && savedAt <= lastDisk) {
      return;
    }
    pendingRecovery = data;
    eventBus.emit("project:recovery-offered", {
      savedAt: savedAt ?? Date.now(),
      objectCount: data.objects.length,
    });
    logger.debug("recovery offered", {
      slotSavedAt: savedAt,
      lastDiskSaveAt: lastDisk,
      objects: data.objects.length,
    });
  });
  // R13.2: deep links — the web fallback (`#open?…`) and the desktop
  // protocol both land here: a project path opens first (the web loads
  // through the fs bridge), then the camera flies to the object/bookmark.
  // Invalid parameters surface the Persian error toast — never a crash.
  const landDeepLink = (link: DeepLink): void => {
    const finish = (): void => {
      if (link.object !== undefined) {
        const target = scene.findById(link.object);
        if (target === undefined) {
          eventBus.emit("ui:notice", {
            messageKey: "deeplink.objectMissing",
            severity: "error",
          });
          return;
        }
        eventBus.emit("ui:fly-to-object", { objectId: link.object });
        return;
      }
      if (link.view !== undefined) {
        const bookmark = bookmarks
          .list()
          .find((entry) => entry.id === link.view);
        if (bookmark === undefined) {
          eventBus.emit("ui:notice", {
            messageKey: "deeplink.viewMissing",
            severity: "error",
          });
          return;
        }
        controller.flyToCamera(
          {
            x: bookmark.camera.x,
            y: bookmark.camera.y,
            zoom: bookmark.camera.zoom,
            rotation: bookmark.camera.rotation,
          },
          600,
        );
      }
    };
    if (link.project === undefined) {
      finish();
      return;
    }
    if (isTauriEnvironment()) {
      // Desktop: the raw path opens through the same import flow the
      // file menu uses (subscribeOpenFile handles the shell side).
      finish();
      return;
    }
    void import("@/persistence/LocalFsBridge")
      .then(({ loadViaLocalFsBridge }) =>
        loadViaLocalFsBridge(link.project as string),
      )
      .then((outcome) => {
        if (outcome.kind !== "loaded") {
          eventBus.emit("ui:notice", {
            messageKey: "deeplink.projectFailed",
            severity: "error",
          });
          return;
        }
        eventBus.emit("project:import-requested", {
          raw: outcome.contents,
          path: outcome.path,
        });
        finish();
      })
      .catch(() => {
        eventBus.emit("ui:notice", {
          messageKey: "deeplink.projectFailed",
          severity: "error",
        });
      });
  };
  const initialLink = readDeepLinkFromLocation();
  if (initialLink !== null) {
    window.setTimeout(() => landDeepLink(initialLink), 800);
  }
  const stopDeepLinks = subscribeDeepLink(landDeepLink);
  void stopDeepLinks;

  // R13.1: the one-way Markdown mirror — after every successful disk
  // save (and only then), the project re-exports to `<project>.icb.md/`.
  // ONE-WAY by contract: the .icb stays the source of truth (AC13.2's
  // Persian notice documents this in the settings section).
  eventBus.on("project:file-saved", ({ path }) => {
    if (!useUiStore.getState().mirrorFolderEnabled) {
      return;
    }
    const files = exportSceneToMarkdown(
      scene.objects,
      document.getName() ?? "project",
    );
    const mirrorPath = `${path}.md`;
    if (isTauriEnvironment()) {
      return; // Desktop writes through the fs plugin (source-level).
    }
    void fetch("/api/fs/mirror", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: mirrorPath,
        files: files.map((file) => ({
          path: file.path,
          content: file.content,
        })),
      }),
    })
      .then((response) => {
        if (response.ok) {
          eventBus.emit("ui:notice", {
            messageKey: "mirror.updatedNotice",
            severity: "info",
          });
        } else {
          eventBus.emit("ui:notice", {
            messageKey: "mirror.failedNotice",
            severity: "error",
          });
        }
      })
      .catch(() => {
        eventBus.emit("ui:notice", {
          messageKey: "mirror.failedNotice",
          severity: "error",
        });
      });
  });

  eventBus.on("project:recovery-decided", ({ restore }) => {
    if (restore && pendingRecovery !== null) {
      const count = restoreDocument(pendingRecovery, null);
      // The recovered state exists ONLY in the slot — the document is
      // deliberately dirty so the «*» marker and the close guard protect
      // it until the user saves to disk.
      document.markDirty();
      eventBus.emit("ui:notice", {
        messageKey: "recovery.restoredToast",
        severity: "info",
        values: { count: String(count) },
      });
      logger.info("project recovered from autosave", { objects: count });
    } else {
      void autosave.clearStorage();
      eventBus.emit("ui:notice", {
        messageKey: "recovery.discardedToast",
        severity: "info",
      });
    }
    pendingRecovery = null;
  });

  // Any scene or camera mutation marks the document dirty for autosave
  // AND for the title-bar marker / close guard (R4.5).
  eventBus.on("scene:changed", () => {
    autosave.markDirty();
    document.markDirty();
  });

  // R13.4: auto-layout frames — the debounced reflow (350ms after the
  // last scene mutation) applies the LayoutService plan as ONE composite
  // undo step. The epsilon guard makes an unchanged plan a no-op (never
  // a loop); the reflow's own mutations re-enter scene:changed but the
  // second plan computes identical slots and bails out.
  let reflowTimer: ReturnType<typeof setTimeout> | null = null;
  let reflowDepth = false;
  const runFrameReflow = (): void => {
    if (reflowDepth) {
      return;
    }
    const objects = scene.objects;
    const groupMembers = collectGroupMembers(objects);
    const commands: ICommand[] = [];
    for (const object of objects) {
      if (!isFrameObject(object) || object.layout === undefined) {
        continue;
      }
      const plan = computeReflowPlan(object, objects, groupMembers);
      const moves: Array<{ id: string; dx: number; dy: number }> = [];
      for (const slot of plan.slots) {
        const child = scene.findById(slot.id);
        if (child === undefined) {
          continue;
        }
        if (slotRequiresMove(slot, child.position)) {
          moves.push({
            id: slot.id,
            dx: slot.x - child.position.x,
            dy: slot.y - child.position.y,
          });
        }
      }
      const sizeChanged =
        Math.abs(plan.frameWidth - object.width) > 0.5 ||
        Math.abs(plan.frameHeight - object.height) > 0.5;
      if (moves.length === 0 && !sizeChanged) {
        continue;
      }
      if (moves.length > 0) {
        commands.push(
          new MoveCommand(
            scene,
            moves.map((move) => move.id),
            vec2(moves[0]?.dx ?? 0, moves[0]?.dy ?? 0),
          ),
        );
        // MoveCommand applies ONE delta to every id — group per-object
        // so each child lands on its own slot.
        commands.pop();
        for (const move of moves) {
          commands.push(
            new MoveCommand(scene, [move.id], vec2(move.dx, move.dy)),
          );
        }
      }
      if (sizeChanged) {
        commands.push(
          new ResizeCommand(
            scene,
            object.id,
            object,
            {
              ...object,
              width: plan.frameWidth,
              height: plan.frameHeight,
            } as FrameObjectData,
          ),
        );
      }
    }
    if (commands.length === 0) {
      return;
    }
    const composite = new CompositeCommand("command.frameReflow", commands);
    reflowDepth = true;
    try {
      composite.do();
      history.push(composite);
    } finally {
      reflowDepth = false;
    }
  };
  eventBus.on("scene:changed", () => {
    if (reflowTimer !== null) {
      clearTimeout(reflowTimer);
    }
    reflowTimer = setTimeout(() => {
      reflowTimer = null;
      runFrameReflow();
    }, 350);
  });
  eventBus.on("camera:changed", () => {
    autosave.markDirty();
    document.markDirty();
  });

  // Project imports (file picker, path opens, drag-dropped files): the
  // raw payload + its source path flow through the SAME restore. A
  // future-format file (R4.4a) surfaces the Persian error and opens
  // read-only — never a silent migration guess.
  eventBus.on("project:import-requested", ({ raw, path, readOnly }) => {
    const outcome = serializer.deserialize(raw);
    if (outcome === null || outcome.status === "corrupt") {
      eventBus.emit("project:import-failed", {
        reason: "corrupt project file",
      });
      logger.warn("project import refused: corrupt file");
      return;
    }
    if (outcome.status === "future") {
      eventBus.emit("ui:notice", {
        messageKey: "file.futureVersion",
        severity: "error",
        values: { version: String(outcome.fileVersion) },
      });
      const count = restoreDocument(outcome.data, path ?? null, {
        readOnly: true,
      });
      logger.warn("future-format project opened read-only", {
        fileVersion: outcome.fileVersion,
        objects: count,
      });
      return;
    }
    // R8.5: history previews import read-only (the payload's explicit
    // flag); regular file opens stay editable.
    const count = restoreDocument(outcome.data, path ?? null, {
      readOnly: readOnly ?? false,
    });
    logger.info("project imported", { objects: count, path: path ?? null });
  });
  eventBus.on("project:new-requested", () => {
    void autosave
      .clearStorage()
      .then(() => {
        document.suspendDirtyTracking();
        scene.clear();
        history.clear();
        bookmarks.replaceAll([]);
        // A fresh document starts from the default framing, too.
        scene.camera.x = 0;
        scene.camera.y = 0;
        scene.camera.zoom = 1;
        scene.camera.rotation = 0;
        document.openNew();
        emitCamera();
        emitScene();
        document.resumeDirtyTracking();
        eventBus.emit("project:restored", { objectCount: 0 });
        logger.info("project reset");
      })
      .catch(() => {
        logger.warn("project reset: storage clear failed");
      });
  });

  // Unsaved-changes guard (R4.5): core.file.new / core.file.open ask the
  // Persian confirm dialog when the document is dirty; the resolved
  // decision either saves first or proceeds unprotected.
  eventBus.on("ui:unsaved-confirm-resolved", ({ action, decision }) => {
    const runAction = (): void => {
      if (action === "new") {
        // R8.4: the guarded «new» lands in the template gallery (Blank
        // is one of the cards) — same flow as the clean path.
        eventBus.emit("ui:template-gallery-requested", { source: "command" });
        return;
      }
      eventBus.emit("ui:open-project-requested", { source: "command" });
    };
    if (decision === "cancel") {
      return;
    }
    if (decision === "discard") {
      runAction();
      return;
    }
    const path = document.getPath();
    if (path !== null) {
      void performDiskSave(path).then((saved) => {
        if (saved) {
          runAction();
        }
      });
      return;
    }
    // Pathless document: hand the user the Save-As flow; they re-run the
    // guarded action after saving (the guard then passes cleanly).
    eventBus.emit("ui:save-project-requested", { as: true });
  });

  // Periodic autosave (R4.6/R8.2: every N seconds while dirty — the
  // user-configurable interval from the Settings dialog) + best-effort
  // flush when the tab hides or closes. Interval changes restart the
  // timer live (idempotent stop+start; the flush listeners re-attach).
  const startAutosaveWithInterval = (): void => {
    const seconds = useUiStore.getState().autosaveIntervalSec;
    autosave.start(seconds * 1000);
    autosave.attachWindowFlush();
  };
  startAutosaveWithInterval();
  useUiStore.subscribe((state, previous) => {
    if (state.autosaveIntervalSec !== previous.autosaveIntervalSec) {
      startAutosaveWithInterval();
    }
  });

  // R8.2: the typed-digit conversion probe (the PersianDigits input
  // rule reads it through the injected setter — no ui import in text/).
  setPersianDigitsInputEnabled(() => useUiStore.getState().convertTypedDigits);

  // R8.8: files opened from the OS (Explorer double-click on an
  // associated .icb, or a second-instance launch) arrive as an absolute
  // path on the Tauri-only "open-file" channel; they flow through the
  // SAME import pipeline as the in-app Open dialog.
  if (isTauriEnvironment()) {
    // App-lifetime subscription (no teardown — the host outlives it).
    subscribeOpenFile((path) => {
      void import("@/platform/tauri/openFile")
        .then((module) => module.readProjectFileRaw(path))
        .then((raw) => {
          eventBus.emit("project:import-requested", { raw, path });
        })
        .catch(() => {
          eventBus.emit("ui:notice", {
            messageKey: "file.futureVersion",
            severity: "error",
            values: { version: path },
          });
          logger.warn("open-file import failed", { path });
        });
    });
  }

  logger.debug("persistence services registered", {
    intervalSec: useUiStore.getState().autosaveIntervalSec,
    recovery: "dialog",
    registryTypes: objectRegistry.size,
  });
  logger.debug("canvas services registered", { tools: 9 });
  return { performDiskSave };
}

/**
 * Builds the version-history service for the active shell (R8.5): the
 * SQLite-backed DbAccess on Tauri, the localStorage engine on the web.
 *
 * @returns the ready service.
 */
async function createVersionHistory(): Promise<VersionHistoryService> {
  if (isTauriEnvironment()) {
    const dbAccess = await createTauriSqlDbAccess();
    if (dbAccess !== null) {
      return new VersionHistoryService(dbAccess);
    }
  }
  return new VersionHistoryService("local");
}

/**
 * Builds the command layer (R3B5.2/R3B5.3): the registry + the single
 * dispatcher, with the whole core catalog registered under `core.*` ids.
 * The wiring binds UI behaviours (tool activation, dialog intents) and
 * rich-text actions to the shared editor — the interaction layer stays
 * free of ui/text imports.
 *
 * @param context - the service container receiving the registrations.
 * @param logger - the root logger (conflict diagnostics mirror into it).
 */
/**
 * Registers the Data Hub layer (R10.1/R10.2/R10.7 + R12.6): the hub
 * itself, the HOST-provided `project.digest` v1 contract, the
 * HOST-provided `scene.query` v1 contract (the structured QuerySpec
 * engine for plugins — law §1.7.9), the event-bus bridge
 * (`datahub:changed`), and the automations rule engine. Runs BEFORE the
 * plugin layer so plugin runtimes receive the live hub in their services.
 *
 * @param context - the booting application context.
 * @param eventBus - the app event bus.
 * @param logger - the app logger.
 */
function registerDataHubLayer(
  context: AppContext,
  eventBus: EventBus<AppEventMap>,
  logger: Logger,
): void {
  const hub = new DataHub();
  context.register(Services.dataHub, hub);

  // Bridge every hub change onto the app bus (the automations engine,
  // panels and tests observe `datahub:changed`).
  hub.onAnyChange((change) => {
    eventBus.emit("datahub:changed", {
      contractId: change.contractId,
      providerId: change.providerId,
      change: change.change,
    });
  });

  // R10.2: the HOST provider — project.digest v1 (aggregated summary of
  // the current project; computes on demand, change events on scene
  // churn + saves).
  const scene = context.get(Services.scene);
  const documentService = context.get(Services.document);
  const history = context.get(Services.history);
  const bookmarks = context.get(Services.bookmarks);
  hub.registerHostProvider({
    contractId: "project.digest",
    version: "1.0.0",
    providerId: "host",
    methods: ["get", "changed"],
    query: async (method) => {
      if (method === "changed") {
        return { changed: true };
      }
      return buildProjectDigest(
        scene,
        {
          projectName: () => documentService.getName() ?? "بدون نام",
          savedPath: () => documentService.getPath(),
          isDirty: () => documentService.isDirty(),
          lastSavedAt: () => documentService.lastDiskSaveAt(),
        },
        {
          depth: () => history.depth(),
          canUndo: () => history.canUndo(),
          canRedo: () => history.canRedo(),
        },
        { count: () => bookmarks.list().length },
      );
    },
  });
  const recomputeDigestChange = (): void => {
    hub.publish("host", "project.digest", {
      type: "project-changed",
    });
  };
  eventBus.on("scene:changed", recomputeDigestChange);
  eventBus.on("persistence:saved", recomputeDigestChange);

  // R12.6: the HOST provider — scene.query v1 (the structured scene
  // queries of the Knowledge Pack, §1.7.9). The knowledge service is
  // registered by registerCanvasServices (which runs first); the
  // change signal rides the same streams as the digest + knowledge
  // rebuilds.
  registerSceneQueryContract(hub, {
    scene,
    knowledge: context.get(Services.knowledge),
  });
  const publishSceneQueryChange = sceneQueryChangePublisher(hub);
  eventBus.on("scene:changed", publishSceneQueryChange);
  eventBus.on("knowledge:changed", publishSceneQueryChange);

  // R10.7: the automations rule engine — allowlisted triggers, command
  // (undoable) or datahub-write actions, every firing logged.
  const commandDispatcher = context.get(Services.commandDispatcher);
  const dispatcher: AutomationDispatcher = {
    dispatch: (commandId, commandContext) => {
      commandDispatcher.dispatch(commandId, commandContext as CommandContext);
    },
  };
  const engine = new RuleEngine({
    hub,
    bus: eventBus,
    dispatcher,
    store: new RuleStore(),
    commandContext: () => commandContextOf(context),
    logger: logger.child("automations"),
  });
  context.register(Services.automations, engine);
  engine.start();
}

/**
 * Registers the plugin layer (R9.5/R9.9): the lifecycle manager over the
 * OPENED registries + the plugin object DOM layer. Runs AFTER the command
 * layer (the manager's services resolve the command registry/dispatcher
 * through the context — both exist by then).
 *
 * @param context - the booting application context.
 * @param eventBus - the app event bus.
 * @param logger - the app logger.
 */
function registerPluginLayer(
  context: AppContext,
  eventBus: EventBus<AppEventMap>,
  logger: Logger,
): void {
  const documentService = context.get(Services.document);
  const idGenerator = context.get(Services.idGenerator);
  const panelRegistry = context.get(Services.panels);
  const settingsSections = context.get(Services.settingsSections);
  // R9.5: the plugin lifecycle manager. The registries opened above, the
  // sandbox factory spawning OPAQUE-ORIGIN iframes (allow-scripts only),
  // the region-frame hook binding plugin regions to the React host
  // component, and the command layer already registered by
  // registerCommandLayer. A plugin failure NEVER fails the app (AC9.3).
  const commandRegistry = context.get(Services.commands);
  const commandDispatcher = context.get(Services.commandDispatcher);
  const pluginSandboxFactory = (
    record: InstalledPluginRecord,
    regionId: string | null,
  ): SandboxSpawn => {
    const sandbox = spawnSandbox(record.manifest, {
      regionId,
      entrySource: record.entrySource,
      host: "infinite-canvas-studio",
    });
    if (typeof globalThis.document !== "undefined") {
      globalThis.document.body.appendChild(sandbox.frame);
    }
    return sandbox;
  };
  const pluginManager = new LifecycleManager(
    {
      scene: context.get(Services.scene),
      history: context.get(Services.history),
      selection: context.get(Services.selection),
      objectRegistry: context.get(Services.objectRegistry),
      dataHub: context.get(Services.dataHub),
      eventBus: {
        on: (event, handler) =>
          eventBus.on(event, handler as never) as unknown as () => void,
      },
      registerCommand: (entry) => {
        commandRegistry.register({
          id: entry.id,
          titleKey: entry.titleKey,
          icon: entry.icon,
          shortcut: entry.shortcut,
          group: "tools",
          order: entry.order,
          execute: entry.execute,
        });
      },
      unregisterCommand: (id) => {
        commandRegistry.unregister(id);
      },
      registerPanel: (entry) => {
        panelRegistry.register({
          id: entry.id,
          titleKey: entry.titleKey,
          icon: entry.icon ?? "Puzzle",
          component: entry.component as ComponentType,
          placement: entry.placement,
          order: entry.order,
          defaultOpen: false,
        });
      },
      unregisterPanel: (id) => {
        panelRegistry.unregister(id);
      },
      registerSettingsSection: (entry) => {
        settingsSections.register({
          id: entry.id,
          titleKey: entry.titleKey,
          order: entry.order,
          component: entry.component as ComponentType,
        });
      },
      unregisterSettingsSection: (id) => {
        settingsSections.unregister(id);
      },
      regionFrame: (pluginId, regionId, titleKey) => {
        const component: ComponentType = () =>
          createElement(PluginRegionFrame, { pluginId, regionId, titleKey });
        return component;
      },
      projectPlugins: {
        get: () => documentService.getPlugins(),
        set: (plugins) => {
          documentService.setPlugins(plugins);
          documentService.markDirty();
        },
      },
      nextObjectId: () => idGenerator.next(),
      executeCommand: (commandId) => {
        commandDispatcher.dispatch(commandId, commandContextOf(context));
      },
      viewportCentre: () =>
        viewportCentre(context, context.get(Services.scene)),
      notifyError: (message) => {
        eventBus.emit("ui:notice", { messageKey: message, severity: "error" });
      },
      // Pack-14 `app.scene` seams: the link registry + camera flights
      // + info toasts (permission-gated host-side).
      links: context.get(Services.links),
      flyToObject: (objectId) => {
        eventBus.emit("ui:fly-to-object", { objectId });
      },
      notifyInfo: (message) => {
        eventBus.emit("ui:notice", { messageKey: message, severity: "info" });
      },
      logger: logger.child("plugins"),
    },
    pluginSandboxFactory,
    new PluginStore(),
    eventBus,
  );
  context.register(Services.pluginManager, pluginManager);

  // R9.9: the plugin object DOM layer — sandboxed widget iframes riding
  // the render loop's companion contract.
  const pluginObjectLayer = new PluginObjectLayer({
    runtimeForTypeId: (typeId) => {
      const runtime = pluginManager.runtimeForTypeId(typeId);
      return runtime === undefined ? null : runtime;
    },
  });
  context.register(Services.pluginObjectLayer, pluginObjectLayer);

  // R9.5: every ENABLED plugin boots with the app (crash-isolated — a
  // failing plugin lands in the manager's error surface, never here).
  // NON-blocking: a dead sandbox's handshake timeout never delays the
  // app boot; registrations arrive asynchronously and every consuming
  // surface re-renders on late registration.
  void pluginManager.bootEnabled();
}

/**
 * Builds the command layer (R3B5.2/R3B5.3): the registry + the single
 * dispatcher, with the whole core catalog registered under `core.*` ids.
 * The wiring binds UI behaviours (tool activation, dialog intents) and
 * rich-text actions to the shared editor — the interaction layer stays
 * free of ui/text imports.
 *
 * @param context - the service container receiving the registrations.
 * @param logger - the root logger (conflict diagnostics mirror into it).
 * @param performDiskSave - the persistence layer's save action.
 */
function registerCommandLayer(
  context: AppContext,
  logger: Logger,
  performDiskSave: (path: string) => Promise<boolean>,
): void {
  const registry = new CommandRegistry(logger, true);
  const wiring: CoreCommandWiring = {
    keys: {
      scene: Services.scene,
      history: Services.history,
      selection: Services.selection,
      idGenerator: Services.idGenerator,
      cameraController: Services.cameraController,
      autosave: Services.autosave,
      textLayer: Services.textLayer,
      links: Services.links,
      knowledge: Services.knowledge,
    },
    ui: {
      activateTool: (tool: ToolCommandId) => {
        useUiStore.getState().setActiveTool(tool);
      },
      toggleGrid: () => {
        useUiStore.getState().toggleGrid();
      },
      openLinkDialog: () => {
        context.tryGet(Services.eventBus)?.emit("ui:link-dialog-requested", {
          fromSelection: true,
        });
      },
      openFind: () => {
        context
          .tryGet(Services.eventBus)
          ?.emit("ui:find-requested", { source: "canvas" });
      },
      // core.file.* (R4.5): guarded flows through the document lifecycle.
      newProject: () => {
        const bus = context.tryGet(Services.eventBus);
        const document = context.tryGet(Services.document);
        if (bus === undefined) {
          return;
        }
        if (document?.isDirty() ?? false) {
          bus.emit("ui:unsaved-confirm-requested", { action: "new" });
          return;
        }
        // R8.4: «جدید» opens the template gallery (Blank is one of the
        // cards; the guard already passed).
        bus.emit("ui:template-gallery-requested", { source: "command" });
      },
      openProject: () => {
        const bus = context.tryGet(Services.eventBus);
        const document = context.tryGet(Services.document);
        if (bus === undefined) {
          return;
        }
        if (document?.isDirty() ?? false) {
          bus.emit("ui:unsaved-confirm-requested", { action: "open" });
          return;
        }
        bus.emit("ui:open-project-requested", { source: "command" });
      },
      saveProject: () => {
        const bus = context.tryGet(Services.eventBus);
        const document = context.tryGet(Services.document);
        if (bus === undefined || document === undefined) {
          return;
        }
        const path = document.getPath();
        if (path !== null) {
          void performDiskSave(path);
          return;
        }
        bus.emit("ui:save-project-requested", { as: false });
      },
      saveProjectAs: () => {
        context
          .tryGet(Services.eventBus)
          ?.emit("ui:save-project-requested", { as: true });
      },
      openExportPng: () => {
        context
          .tryGet(Services.eventBus)
          ?.emit("ui:export-png-requested", { source: "command" });
      },
      // R8.7: SVG + PDF export open the SAME dialog pre-seeded with the
      // format (one export surface, three formats).
      openExportSvg: () => {
        context
          .tryGet(Services.eventBus)
          ?.emit("ui:export-svg-requested", { source: "command" });
      },
      openExportPdf: () => {
        context
          .tryGet(Services.eventBus)
          ?.emit("ui:export-pdf-requested", { source: "command" });
      },
      // فاز ۳۶ «جدول به ورد»: the selection's text-bearing objects (or,
      // when none are picked, the whole scene's) travel out as a REAL
      // Word .docx download — tables become `w:tbl` Word tables with
      // borders/merges/RTL column order, headings become Word heading
      // styles, lists and links survive intact.
      exportWord: () => {
        const scene = context.tryGet(Services.scene);
        const selection = context.tryGet(Services.selection);
        const bus = context.tryGet(Services.eventBus);
        if (scene === undefined) {
          return;
        }
        const selected = [...(selection?.ids ?? [])]
          .map((id) => scene.findById(id))
          .filter((object): object is SceneObjectData => object !== undefined)
          .filter(
            (object) => object.kind === "textBox" || object.kind === "stickyNote",
          );
        const objects =
          selected.length > 0
            ? selected
            : scene.objects.filter(
                (object) =>
                  object.kind === "textBox" || object.kind === "stickyNote",
              );
        const blob = wordDocumentBlob(objects);
        if (blob === null) {
          bus?.emit("ui:notice", {
            messageKey: "clipboard.wordExportEmptyNotice",
            severity: "error",
          });
          return;
        }
        const ok = downloadBlob(blob, WORD_EXPORT_FILENAME);
        bus?.emit("ui:notice", {
          messageKey: ok
            ? "clipboard.wordExportedNotice"
            : "clipboard.osWriteFailedNotice",
          severity: ok ? "info" : "error",
        });
      },
      // R8.2: Ctrl+, opens the composed Settings dialog.
      openSettings: () => {
        context
          .tryGet(Services.eventBus)
          ?.emit("ui:settings-dialog-requested", { source: "command" });
      },
      // R12.1: Ctrl+Shift+K opens the sticker-library picker.
      openStickerPicker: () => {
        useUiStore.getState().setStickerPickerOpen(true);
      },
      // R8.3: F5 toggles presentation mode (refuses politely when the
      // board has no frames to present).
      togglePresentation: () => {
        const bus = context.tryGet(Services.eventBus);
        const scene = context.tryGet(Services.scene);
        if (bus === undefined || scene === undefined) {
          return;
        }
        if (useUiStore.getState().presentationActive) {
          useUiStore.getState().setPresentationActive(false);
          return;
        }
        if (presentationFrames(scene).length === 0) {
          bus.emit("ui:notice", {
            messageKey: "presentation.noFrames",
            severity: "error",
          });
          return;
        }
        useUiStore.getState().setPresentationActive(true);
      },
      insertImage: () => {
        context
          .tryGet(Services.eventBus)
          ?.emit("ui:insert-image-requested", { source: "command" });
      },
      // فاز M1 (A.2.6): the video insert action opens the FILE PICKER —
      // a contentless placeholder would be useless, exactly like images.
      insertVideo: () => {
        context
          .tryGet(Services.eventBus)
          ?.emit("ui:insert-video-requested", { source: "command" });
      },
      // فاز A1 (A.2.6): the audio insert action opens the FILE PICKER —
      // the same dialog-driven path as images and videos.
      insertAudio: () => {
        context
          .tryGet(Services.eventBus)
          ?.emit("ui:insert-audio-requested", { source: "command" });
      },
      // فاز P1 (A.2.6): the PDF insert action opens the FILE PICKER —
      // the same dialog-driven path as images, videos and audio.
      insertPdf: () => {
        context
          .tryGet(Services.eventBus)
          ?.emit("ui:insert-pdf-requested", { source: "command" });
      },
      // R7.9: Ctrl+Shift+B opens the bookmark-name prompt (the dialog
      // captures the camera on confirm).
      promptBookmark: () => {
        useUiStore.getState().setBookmarkPromptOpen(true);
      },
      // R7.11: Ctrl+K (outside the editor) opens the command palette.
      openCommandPalette: () => {
        useUiStore.getState().setCommandPaletteOpen(true);
      },
      // R7.1: panel toggles through the dispatcher (palette + dock rail).
      togglePanel: (panelId) => {
        useUiStore.getState().togglePanel(panelId);
      },
      // R7.12: the Insert Panel's click path — the card's factory places
      // the object at the CURRENT viewport centre (identical defaults to
      // the panel's drag-drop; text kinds open an edit session).
      insertCard: (typeId, cardKey) => {
        const scene = context.tryGet(Services.scene);
        const history = context.tryGet(Services.history);
        const registry = context.tryGet(Services.objectRegistry);
        const textLayer = context.tryGet(Services.textLayer);
        if (
          scene === undefined ||
          history === undefined ||
          registry === undefined
        ) {
          return;
        }
        if (typeId === "core.image") {
          // Image cards launch the asset flow (D-7.3): a contentless
          // placeholder would be useless — the dialog IS the toolbar path.
          context
            .tryGet(Services.eventBus)
            ?.emit("ui:insert-image-requested", { source: "command" });
          return;
        }
        // فاز M1 (A.2.6): the video card drag-drop is N/A for file-based
        // content — dropping it opens the SAME picker as the click path.
        if (typeId === "core.video") {
          context
            .tryGet(Services.eventBus)
            ?.emit("ui:insert-video-requested", { source: "command" });
          return;
        }
        const centre = viewportCentre(context, scene);
        const object = insertCatalogObject(
          scene,
          history,
          registry,
          typeId,
          cardKey,
          centre,
        );
        if (
          object !== null &&
          textLayer !== undefined &&
          (object.kind === "textBox" || object.kind === "stickyNote")
        ) {
          textLayer.beginEditing(object.id);
        }
      },
      openMarkdownDialog: (tab) => {
        useUiStore.getState().openMarkdownDialog(tab);
      },
      copyDeepLink: () => {
        const liveContext = AppContext.getDefault();
        const liveSelection = liveContext.tryGet(Services.selection);
        const liveBus = liveContext.tryGet(Services.eventBus);
        if (liveSelection === undefined || liveBus === undefined) {
          return;
        }
        const selected = [...liveSelection.ids];
        if (selected.length === 0) {
          liveBus.emit("ui:notice", {
            messageKey: "deeplink.noSelection",
            severity: "error",
          });
          return;
        }
        const hash = buildWebDeepLinkHash({ object: selected[0] });
        const url = `${window.location.origin}${window.location.pathname}${hash}`;
        void navigator.clipboard
          .writeText(url)
          .then(() => {
            liveBus.emit("ui:notice", {
              messageKey: "deeplink.copied",
              severity: "info",
            });
          })
          .catch(() => {
            liveBus.emit("ui:notice", {
              messageKey: "deeplink.copyFailed",
              severity: "error",
            });
          });
      },
      // Pack R11.6: the manual-link picker opens for the one selected
      // source object (the dialog itself creates the link command).
      openLinkPicker: (sourceId) => {
        context
          .tryGet(Services.eventBus)
          ?.emit("ui:link-picker-requested", { sourceId });
      },
      // Pack R12.3: the force-directed knowledge-graph arrange — one
      // composite undo step, a Persian count toast, and a fit-to-content
      // flight so the laid-out graph lands in view.
      arrangeKnowledgeGraph: () => {
        const liveScene = context.tryGet(Services.scene);
        const liveHistory = context.tryGet(Services.history);
        const liveKnowledge = context.tryGet(Services.knowledge);
        const liveBus = context.tryGet(Services.eventBus);
        const liveCamera = context.tryGet(Services.cameraController);
        if (
          liveScene === undefined ||
          liveHistory === undefined ||
          liveKnowledge === undefined ||
          liveBus === undefined
        ) {
          return;
        }
        const plan = planGraphArrange(
          liveScene.objects,
          liveKnowledge.current(),
        );
        if (plan === null || plan.moves.length === 0) {
          liveBus.emit("ui:notice", {
            messageKey: "knowledge.arrangeNothing",
            severity: "info",
          });
          return;
        }
        const command = new CompositeCommand(
          "command.graphArrange",
          plan.moves.map(
            (move) => new MoveCommand(liveScene, [move.id], move.delta),
          ),
        );
        command.do();
        liveHistory.push(command);
        liveBus.emit("ui:notice", {
          messageKey: "knowledge.arrangeDone",
          severity: "info",
          values: { count: formatInteger(plan.moves.length, "fa") },
        });
        // Frame the freshly laid-out graph (the fitAll command's math).
        if (liveCamera !== undefined) {
          const canvas =
            typeof document !== "undefined"
              ? document.querySelector("canvas")
              : null;
          const viewport =
            canvas !== null
              ? {
                  width: canvas.clientWidth,
                  height: canvas.clientHeight,
                }
              : {
                  width:
                    typeof window !== "undefined" ? window.innerWidth : 0,
                  height:
                    typeof window !== "undefined" ? window.innerHeight : 0,
                };
          let bounds: ReturnType<typeof objectBBox> | null = null;
          for (const object of liveScene.objects) {
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
          if (bounds !== null) {
            liveCamera.fitToBBox(bounds, viewport);
          }
        }
      },
      // Pack R12.4: the on-canvas knowledge-edge overlay toggle (the
      // canvas host rebuilds the renderer frame from the store state).
      toggleKnowledgeEdges: () => {
        useUiStore.getState().toggleKnowledgeEdges();
      },
      // ── Phase 23 «پل کلیپ‌بورد»: the selection clipboard + the OS
      //    bridge. Copy/cut seed the internal buffer AND (when the
      //    selection carries text or a single image) the SYSTEM
      //    clipboard, so Word / Photoshop / After Effects receive it.
      copySelection: () => {
        const scene = context.tryGet(Services.scene);
        const selection = context.tryGet(Services.selection);
        const bus = context.tryGet(Services.eventBus);
        if (scene === undefined || selection === undefined) {
          return;
        }
        const count = appSelectionClipboard.copy(scene, selection);
        if (count === 0) {
          return;
        }
        bus?.emit("ui:notice", {
          messageKey: "clipboard.copiedNotice",
          severity: "info",
        });
        const objects = [...selection.ids]
          .map((id) => scene.findById(id))
          .filter((object): object is SceneObjectData => object !== undefined);
        // OS side effects: a single IMAGE writes image/png at its
        // ORIGINAL intrinsic size; a single text-bearing object writes
        // text/plain; everything else (فاز ۲۴) rasterises the selection
        // into a transparent 2x image/png snapshot — with the plain-text
        // projection riding the SAME ClipboardItem when text is present.
        const singleImage =
          objects.length === 1 ? (objects[0] ?? null) : null;
        if (singleImage !== null && isImageObject(singleImage)) {
          deliverImageToSystem(singleImage, bus);
          return;
        }
        const text = plainTextOfObjects(objects);
        if (shouldRasterizeSelection(objects)) {
          deliverSelectionSnapshot(
            buildSelectionSubsetScene(scene, [...selection.ids]),
            text,
            bus,
          );
          return;
        }
        // فاز ۳۵ «خروج غنی از بوم»: a single text-bearing selection ALSO
        // ships text/html — Word / Outlook / AI chats paste the structure
        // (headings, bold, lists, tables); Firefox degrades to the plain
        // write below (its ClipboardItem absence → "unsupported").
        const richHtml = richTextHtmlOfObjects(objects);
        if (text !== null && richHtml !== null) {
          void writeRichTextToSystemClipboard(richHtml, text).then(
            (outcome) => {
              if (outcome === "written") {
                bus?.emit("ui:notice", {
                  messageKey: "clipboard.richCopiedNotice",
                  severity: "info",
                });
                return;
              }
              // "unsupported" (Firefox) / "failed": the plain projection
              // still lands — never lose the copy outright.
              void writeTextToSystemClipboard(text).then((ok) => {
                if (ok) {
                  bus?.emit("ui:notice", {
                    messageKey: "clipboard.textCopiedNotice",
                    severity: "info",
                  });
                }
              });
            },
          );
          return;
        }
        if (text !== null) {
          void writeTextToSystemClipboard(text).then((ok) => {
            if (ok) {
              bus?.emit("ui:notice", {
                messageKey: "clipboard.textCopiedNotice",
                severity: "info",
              });
            }
          });
        }
      },
      cutSelection: () => {
        const scene = context.tryGet(Services.scene);
        const history = context.tryGet(Services.history);
        const selection = context.tryGet(Services.selection);
        const bus = context.tryGet(Services.eventBus);
        if (
          scene === undefined ||
          history === undefined ||
          selection === undefined
        ) {
          return;
        }
        const objects = [...selection.ids]
          .map((id) => scene.findById(id))
          .filter((object): object is SceneObjectData => object !== undefined);
        // فاز ۲۴: the rasterised snapshot must be built BEFORE the cut
        // removes the objects — the subset scene holds them by reference.
        const singleImage =
          objects.length === 1 ? (objects[0] ?? null) : null;
        const cutText = plainTextOfObjects(objects);
        const cutSubset = shouldRasterizeSelection(objects)
          ? buildSelectionSubsetScene(scene, objects.map((object) => object.id))
          : null;
        const count = appSelectionClipboard.cut(scene, history, selection);
        if (count === 0) {
          return;
        }
        bus?.emit("ui:notice", {
          messageKey: "clipboard.cutNotice",
          severity: "info",
        });
        if (singleImage !== null && isImageObject(singleImage)) {
          deliverImageToSystem(singleImage, bus);
          return;
        }
        if (cutSubset !== null) {
          deliverSelectionSnapshot(cutSubset, cutText, bus);
          return;
        }
        // فاز ۳۵: cut mirrors copy — rich text leaves WITH its structure.
        const cutHtml = richTextHtmlOfObjects(objects);
        if (cutText !== null && cutHtml !== null) {
          void writeRichTextToSystemClipboard(cutHtml, cutText).then(
            (outcome) => {
              if (outcome === "written") {
                bus?.emit("ui:notice", {
                  messageKey: "clipboard.richCopiedNotice",
                  severity: "info",
                });
                return;
              }
              void writeTextToSystemClipboard(cutText).then((ok) => {
                if (ok) {
                  bus?.emit("ui:notice", {
                    messageKey: "clipboard.textCopiedNotice",
                    severity: "info",
                  });
                }
              });
            },
          );
          return;
        }
        if (cutText !== null) {
          void writeTextToSystemClipboard(cutText).then((ok) => {
            if (ok) {
              bus?.emit("ui:notice", {
                messageKey: "clipboard.textCopiedNotice",
                severity: "info",
              });
            }
          });
        }
      },
      pasteFromClipboard: () => {
        const scene = context.tryGet(Services.scene);
        const history = context.tryGet(Services.history);
        const selection = context.tryGet(Services.selection);
        const ids = context.tryGet(Services.idGenerator);
        const bus = context.tryGet(Services.eventBus);
        if (
          scene === undefined ||
          history === undefined ||
          selection === undefined ||
          ids === undefined ||
          bus === undefined
        ) {
          return;
        }
        if (appSelectionClipboard.hasContent()) {
          // Internal paste: mark the instant so the document paste event
          // (if the browser still fires one) never double-imports.
          markInternalPasteHandled();
          const pasted = appSelectionClipboard.paste(
            scene,
            history,
            selection,
            ids,
            viewportCentre(context, scene),
          );
          if (pasted !== null && pasted.length > 0) {
            bus.emit("ui:notice", {
              messageKey: "clipboard.pastedNotice",
              severity: "info",
              values: { count: formatInteger(pasted.length, "fa") },
            });
          }
          return;
        }
        // No internal buffer: read the SYSTEM clipboard (image first,
        // then text). Runs async; permission denial degrades gracefully.
        void (async () => {
          const read = await readSystemClipboard();
          if (read.status === "denied") {
            bus.emit("ui:notice", {
              messageKey: "clipboard.osReadDeniedNotice",
              severity: "error",
            });
            return;
          }
          if (read.image !== null) {
            const type = read.image.type.startsWith("image/")
              ? read.image.type
              : "image/png";
            const file = new File([read.image], "clipboard-image", { type });
            const decoded = await decodeImageFile(file);
            if (decoded !== null) {
              const surface =
                typeof document !== "undefined"
                  ? document.querySelector<HTMLElement>("main")
                  : null;
              const rect =
                surface !== null
                  ? { width: surface.clientWidth, height: surface.clientHeight }
                  : null;
              insertDecodedImage(
                { scene, history, selection, ids, bus },
                decoded,
                rect,
              );
              return;
            }
          }
          if (read.text !== null && isImportablePasteText(read.text)) {
            insertTextBoxAt(
              { scene, history, selection, ids, bus },
              read.text,
              viewportCentre(context, scene),
            );
            bus.emit("ui:notice", {
              messageKey: "clipboard.textPastedNotice",
              severity: "info",
            });
            return;
          }
          bus.emit("ui:notice", {
            messageKey: "clipboard.pasteEmptyNotice",
            severity: "info",
          });
        })();
      },
      copyImageToSystem: () => {
        const scene = context.tryGet(Services.scene);
        const selection = context.tryGet(Services.selection);
        const bus = context.tryGet(Services.eventBus);
        if (scene === undefined || selection === undefined || bus === undefined) {
          return;
        }
        const ids = [...selection.ids];
        if (ids.length !== 1) {
          return;
        }
        const object = scene.findById(ids[0] ?? "");
        if (object === undefined || !isImageObject(object)) {
          return;
        }
        deliverImageToSystem(object, bus);
      },
      // فاز ۲۴ «کپی چندشیء به‌صورت تصویر»: the EXPLICIT copy-as-image
      // command (context menu / command palette) — ANY selection, even a
      // lone text box, rasterises into the transparent 2x PNG snapshot;
      // the text projection rides along in the same ClipboardItem.
      copySelectionAsImage: () => {
        const scene = context.tryGet(Services.scene);
        const selection = context.tryGet(Services.selection);
        const bus = context.tryGet(Services.eventBus);
        if (scene === undefined || selection === undefined) {
          return;
        }
        const ids = [...selection.ids];
        if (ids.length === 0) {
          return;
        }
        const objects = ids
          .map((id) => scene.findById(id))
          .filter((object): object is SceneObjectData => object !== undefined);
        if (objects.length === 0) {
          return;
        }
        deliverSelectionSnapshot(
          buildSelectionSubsetScene(scene, ids),
          plainTextOfObjects(objects),
          bus,
        );
      },
      resetImageToNatural: () => {
        const scene = context.tryGet(Services.scene);
        const history = context.tryGet(Services.history);
        const selection = context.tryGet(Services.selection);
        const bus = context.tryGet(Services.eventBus);
        if (
          scene === undefined ||
          history === undefined ||
          selection === undefined
        ) {
          return false;
        }
        const ids = [...selection.ids];
        if (ids.length !== 1) {
          return false;
        }
        const object = scene.findById(ids[0] ?? "");
        if (object === undefined || !isImageObject(object)) {
          return false;
        }
        const after = naturalResetPatch(object);
        if (after === null) {
          return false;
        }
        const command = new ResizeCommand(scene, object.id, object, after);
        command.do();
        history.push(command);
        bus?.emit("ui:notice", {
          messageKey: "image.resetDoneNotice",
          severity: "info",
        });
        return true;
      },
      // فاز ۳۴ «زمان صفر»: the insert-state restore — the exact placed
      // size/position/rotation at the moment the image entered THIS
      // canvas (one ResizeCommand snapshot swap → one undo step).
      resetImageToInsertState: () => {
        const scene = context.tryGet(Services.scene);
        const history = context.tryGet(Services.history);
        const selection = context.tryGet(Services.selection);
        const bus = context.tryGet(Services.eventBus);
        if (
          scene === undefined ||
          history === undefined ||
          selection === undefined
        ) {
          return false;
        }
        const ids = [...selection.ids];
        if (ids.length !== 1) {
          return false;
        }
        const object = scene.findById(ids[0] ?? "");
        if (object === undefined || !isImageObject(object)) {
          return false;
        }
        const after = insertStateResetPatch(object);
        if (after === null) {
          return false;
        }
        const command = new ResizeCommand(scene, object.id, object, after);
        command.do();
        history.push(command);
        bus?.emit("ui:notice", {
          messageKey: "image.insertResetDoneNotice",
          severity: "info",
        });
        return true;
      },
      togglePin: () => {
        const scene = context.tryGet(Services.scene);
        const history = context.tryGet(Services.history);
        const selection = context.tryGet(Services.selection);
        const bus = context.tryGet(Services.eventBus);
        if (
          scene === undefined ||
          history === undefined ||
          selection === undefined
        ) {
          return false;
        }
        // فاز ۲۵: resolve the canvas viewport (the anchor space) — the
        // module-level `canvasViewport` helper (the `document` service
        // shadows the DOM global inside this function).
        const viewport = canvasViewport();
        if (viewport.width <= 0 || viewport.height <= 0) {
          return false;
        }
        const changed = togglePinSelection(
          scene,
          history,
          selection,
          viewport,
        );
        if (changed) {
          // Notice per direction: report what the selection NOW holds.
          let anyNowPinned = false;
          for (const id of selection.ids) {
            const object = scene.findById(id);
            if (object !== undefined && isPinnedObject(object)) {
              anyNowPinned = true;
            }
          }
          bus?.emit("ui:notice", {
            messageKey: anyNowPinned
              ? "pin.pinDoneNotice"
              : "pin.unpinDoneNotice",
            severity: "info",
          });
        }
        return changed;
      },
    },
    text: {
      runEditorAction: (action: EditorTextAction) =>
        runEditorTextAction(action),
      // R7.5: Format Painter — copy/apply against the live shared editor;
      // the clipboard itself lives in the FormatPainter module.
      hasLiveEditor: () => editorSessionActive(),
      copyFormat: () => {
        const editor = getSharedTextEditor().tryGetEditor();
        return editor !== null && copyFormatFrom(editor);
      },
      applyFormat: () => {
        const editor = getSharedTextEditor().tryGetEditor();
        return editor !== null && pasteFormatOnto(editor);
      },
    },
    table: {
      runTableAction: (action: TableAction) => runTableAction(action),
      canTableAction: (action: TableAction) => canTableAction(action),
    },
  };
  registerCoreCommands(registry, wiring);
  const dispatcher = new CommandDispatcher(registry, logger.child("commands"));
  context.register(Services.commands, registry);
  context.register(Services.commandDispatcher, dispatcher);
  // R6.2: the context-menu registry + the app's contributions (the table
  // menu, the canvas/object menus, the text menu) — hosts render FROM
  // this registry, so late registrations appear without host edits.
  const contextMenu = registerContextMenuContributions(
    new ContextMenuRegistry(),
  );
  context.register(Services.contextMenu, contextMenu);
}

/**
 * Resolves the live canvas viewport in CSS pixels (فاز ۲۵ — the
 * pin-anchor coordinate space). Module-level so the DOM `document` is
 * never the shadowed `DocumentService` binding of the boot function.
 *
 * @returns the viewport size (0×0 outside a browser / before mount).
 */
function canvasViewport(): { width: number; height: number } {
  const canvas =
    typeof document !== "undefined" ? document.querySelector("canvas") : null;
  return canvas !== null
    ? { width: canvas.clientWidth, height: canvas.clientHeight }
    : { width: 0, height: 0 };
}

/**
 * Resolves the world point at the centre of the visible canvas (the
 * insert-card drop target, R7.12 — shared with the R6.1 table insert).
 *
 * @param context - the service container (unused; kept for symmetry).
 * @param scene - the scene providing the camera.
 * @returns the viewport-centre world point (origin fallback pre-mount).
 */
function viewportCentre(context: AppContext, scene: Scene): Vec2 {
  void context;
  const canvas =
    typeof document !== "undefined" ? document.querySelector("canvas") : null;
  return canvas !== null
    ? scene.camera.screenToWorld(
        vec2(canvas.clientWidth / 2, canvas.clientHeight / 2),
      )
    : vec2(0, 0);
}

/**
 * Delivers a rasterised selection snapshot to the SYSTEM clipboard
 * (فاز ۲۴ «کپی چندشیء به‌صورت تصویر»): the transparent 2x PNG rides in
 * ONE ClipboardItem together with the plain-text projection (when the
 * selection carries text), so Word / PowerPoint / Photoshop receive the
 * image while plain-text consumers still find the words. A rasterisation
 * failure degrades to the text-only write; a total failure surfaces the
 * honest Persian error toast.
 *
 * فاز ۲۶ «کیفیت انتخاب و کلیپ‌بورد»: a browser that cannot write IMAGES
 * (Firefox — no `ClipboardItem`) still receives the TEXT through the
 * text-only clipboard write, and the PNG snapshot DOWNLOADS as a file —
 * the Persian notice says exactly what happened instead of a bare
 * error.
 *
 * @param subset - the pre-built scene view containing exactly the copied
 *        objects (built BEFORE a cut removes them).
 * @param text - the selection's plain-text projection (null when textual
 *        content is absent).
 * @param bus - the event bus for the Persian notices (optional).
 */
function deliverSelectionSnapshot(
  subset: Scene,
  text: string | null,
  bus: Pick<EventBus<AppEventMap>, "emit"> | undefined,
): void {
  void rasterizeSceneToPngBlob(subset).then((blob) => {
    if (blob === null) {
      if (text !== null) {
        void writeTextToSystemClipboard(text).then((ok) => {
          if (ok) {
            bus?.emit("ui:notice", {
              messageKey: "clipboard.textCopiedNotice",
              severity: "info",
            });
          }
        });
        return;
      }
      bus?.emit("ui:notice", {
        messageKey: "clipboard.osWriteFailedNotice",
        severity: "error",
      });
      return;
    }
    void writeSelectionImageToSystemClipboard(blob, text).then((outcome) => {
      if (outcome === "unsupported") {
        // Firefox: the image cannot ride the clipboard — the TEXT still
        // can; the PNG snapshot downloads as a file instead (فاز ۲۶).
        void (async () => {
          if (text !== null) {
            await writeTextToSystemClipboard(text);
          }
          if (downloadBlob(blob, SELECTION_SNAPSHOT_FILENAME)) {
            bus?.emit("ui:notice", {
              messageKey: "clipboard.imageDownloadedNotice",
              severity: "info",
            });
          } else {
            bus?.emit("ui:notice", {
              messageKey: "clipboard.osWriteFailedNotice",
              severity: "error",
            });
          }
        })();
        return;
      }
      bus?.emit("ui:notice", {
        messageKey:
          outcome === "written"
            ? "clipboard.selectionImageCopiedNotice"
            : "clipboard.osWriteFailedNotice",
        severity: outcome === "written" ? "info" : "error",
      });
    });
  });
}

/**
 * Delivers ONE image object to the SYSTEM clipboard at its ORIGINAL
 * intrinsic size (فاز ۲۳ «کپی تصویر» + فاز ۲۶ fallback): browsers that
 * cannot write images (Firefox — no `ClipboardItem`) download the
 * rendered PNG instead, with a Persian notice that says exactly that.
 *
 * @param object - the image object being copied out.
 * @param bus - the event bus for the Persian notices (optional).
 */
function deliverImageToSystem(
  object: ImageObjectData,
  bus: Pick<EventBus<AppEventMap>, "emit"> | undefined,
): void {
  void writeImageObjectToSystemClipboard(object).then((outcome) => {
    if (outcome === "unsupported") {
      // Firefox: render at the intrinsic size and DOWNLOAD the PNG —
      // the original-quality contract survives the clipboard gap.
      void imageObjectToPngBlob(object).then((blob) => {
        if (blob !== null && downloadBlob(blob, IMAGE_DOWNLOAD_FILENAME)) {
          bus?.emit("ui:notice", {
            messageKey: "clipboard.imageDownloadedNotice",
            severity: "info",
          });
          return;
        }
        bus?.emit("ui:notice", {
          messageKey: "clipboard.osWriteFailedNotice",
          severity: "error",
        });
      });
      return;
    }
    reportImageWriteOutcome(outcome, bus);
  });
}

/**
 * Raises the Persian notice for a resolved image-clipboard write
 * outcome (the shared tail of every write path, فاز ۲۶).
 *
 * @param outcome - the resolved tri-state outcome.
 * @param bus - the event bus (optional).
 */
function reportImageWriteOutcome(
  outcome: ClipboardWriteOutcome,
  bus: Pick<EventBus<AppEventMap>, "emit"> | undefined,
): void {
  bus?.emit("ui:notice", {
    messageKey:
      outcome === "written"
        ? "clipboard.imageCopiedNotice"
        : "clipboard.osWriteFailedNotice",
    severity: outcome === "written" ? "info" : "error",
  });
}

/**
 * Runs one rich-text editor action on the shared TipTap editor (the
 * command catalog's text executor).
 *
 * @param action - the editor action id.
 * @returns whether an editor command chain ran.
 */
function runEditorTextAction(action: EditorTextAction): boolean {
  const editor = getSharedTextEditor().tryGetEditor();
  if (editor === null) {
    return false;
  }
  const chain = editor.chain().focus();
  switch (action) {
    case "bold":
      return chain.toggleBold().run();
    case "italic":
      return chain.toggleItalic().run();
    case "underline":
      return chain.toggleUnderline().run();
    case "strike":
      return chain.toggleStrike().run();
    case "subscript":
      return chain.toggleSubscript().run();
    case "superscript":
      return chain.toggleSuperscript().run();
    case "zwnj":
      return chain.insertContent("\u200C").run();
    case "insertDate":
      // R8.3: the Jalali «۲۱ مرداد ۱۴۰۳» form.
      return chain.insertContent(formatTodayAsJalaliText("long")).run();
    case "insertDateNumeric":
      // R8.3: the Jalali 1403/05/21 form.
      return chain.insertContent(formatTodayAsJalaliText("numeric")).run();
    case "clearFormatting":
      return chain.unsetAllMarks().clearNodes().run();
    case "heading1":
      return chain.setHeading({ level: 1 }).run();
    case "heading2":
      return chain.setHeading({ level: 2 }).run();
    case "heading3":
      return chain.setHeading({ level: 3 }).run();
    case "paragraph":
      return chain.setParagraph().run();
    case "blockquote":
      return chain.toggleBlockquote().run();
    case "codeBlock":
      return chain.toggleCodeBlock().run();
    case "horizontalRule":
      return chain.setHorizontalRule().run();
    case "bulletList":
      return chain.toggleBulletList().run();
    case "orderedList":
      return chain.toggleOrderedList().run();
    case "taskList":
      return chain.toggleTaskList().run();
    default:
      return false;
  }
}

/**
 * Whether the shared editor currently hosts a LIVE editing session (the
 * table commands' availability contract — a detached editor keeps the
 * last document around, but must not accept structural edits).
 *
 * @returns whether an object is being edited right now.
 */
function editorSessionActive(): boolean {
  return getSharedTextEditor().mountedIn() !== null;
}

/**
 * Runs one rich-text TABLE action on the shared TipTap editor (the
 * command catalog's table executor, R6.1–R6.5). `insert` follows R6.1:
 * it inserts into the live editor when a session is active, otherwise it
 * creates a new table text object at the viewport centre through the
 * `table:create-requested` flow.
 *
 * @param action - the table action id.
 * @returns whether an action ran.
 */
function runTableAction(action: TableAction): boolean {
  const service = getSharedTextEditor();
  const editor = service.tryGetEditor();
  if (action === "insert") {
    const ui = useUiStore.getState();
    const rows = Math.max(1, Math.floor(ui.tableRows));
    const cols = Math.max(1, Math.floor(ui.tableColumns));
    if (editor !== null && editorSessionActive()) {
      return insertTableInheritingDirection(editor, rows, cols, true);
    }
    const context = AppContext.getDefault();
    const scene = context.tryGet(Services.scene);
    const bus = context.tryGet(Services.eventBus);
    if (scene === undefined || bus === undefined) {
      return false;
    }
    // R6.1: nothing being edited — create a fresh table text object at
    // the viewport centre (the TableTool's default footprint).
    const canvas =
      typeof document !== "undefined" ? document.querySelector("canvas") : null;
    const center =
      canvas !== null
        ? scene.camera.screenToWorld(
            vec2(canvas.clientWidth / 2, canvas.clientHeight / 2),
          )
        : vec2(0, 0);
    const width = cols * 110;
    const height = rows * 36 + 8;
    bus.emit("table:create-requested", {
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
      rows,
      cols,
      fontSize: ui.fontSize,
    });
    return true;
  }
  if (editor === null || !editorSessionActive()) {
    return false;
  }
  switch (action) {
    case "insertRowAbove":
      return editor.chain().focus().addRowBefore().run();
    case "insertRowBelow":
      return editor.chain().focus().addRowAfter().run();
    case "deleteRow":
      return editor.chain().focus().deleteRow().run();
    case "insertColumnLeft":
      return insertColumnVisual(editor, "left");
    case "insertColumnRight":
      return insertColumnVisual(editor, "right");
    case "deleteColumn":
      return editor.chain().focus().deleteColumn().run();
    case "deleteTable":
      return editor.chain().focus().deleteTable().run();
    case "mergeCells":
      return editor.chain().focus().mergeCells().run();
    case "splitCellHorizontal":
      return splitCellAlongAxis(editor, "row");
    case "splitCellVertical":
      return splitCellAlongAxis(editor, "column");
    case "toggleHeaderRow":
      return editor.chain().focus().toggleHeaderRow().run();
    case "toggleHeaderColumn":
      return editor.chain().focus().toggleHeaderColumn().run();
    case "toggleDirection":
      return toggleTableDirection(editor);
    case "distributeColumns":
      return distributeTableColumns(editor, {
        minWidth: TABLE_CELL_MIN_WIDTH,
        fallbackWidth: measureTableColumnFallbackWidth(
          editor,
          findTableAncestor(editor),
        ),
      });
    case "alignCellTop":
      return setCellVerticalAlign(editor, "top");
    case "alignCellMiddle":
      return setCellVerticalAlign(editor, "middle");
    case "alignCellBottom":
      return setCellVerticalAlign(editor, "bottom");
    default: {
      if (action.startsWith("preset:")) {
        return setTablePreset(
          editor,
          coerceTablePreset(action.slice("preset:".length)),
        );
      }
      return false;
    }
  }
}

/**
 * Probes one rich-text TABLE action's availability (the command catalog's
 * enabled states — menu items gray out outside tables / on 1×1 cells).
 *
 * @param action - the table action id.
 * @returns whether the action could run right now.
 */
function canTableAction(action: TableAction): boolean {
  if (action === "insert") {
    return true;
  }
  const service = getSharedTextEditor();
  const editor = service.tryGetEditor();
  if (editor === null || !editorSessionActive()) {
    return false;
  }
  switch (action) {
    case "insertRowAbove":
      return editor.can().addRowBefore();
    case "insertRowBelow":
      return editor.can().addRowAfter();
    case "deleteRow":
      return editor.can().deleteRow();
    case "insertColumnLeft":
    case "insertColumnRight":
      return canInsertColumnVisual(editor);
    case "deleteColumn":
      return editor.can().deleteColumn();
    case "deleteTable":
      return editor.can().deleteTable();
    case "mergeCells":
      return editor.can().mergeCells();
    case "splitCellHorizontal":
      return canSplitCellAlongAxis(editor, "row");
    case "splitCellVertical":
      return canSplitCellAlongAxis(editor, "column");
    case "toggleHeaderRow":
      return editor.can().toggleHeaderRow();
    case "toggleHeaderColumn":
      return editor.can().toggleHeaderColumn();
    case "toggleDirection":
      return currentTableDirection(editor) !== null;
    case "distributeColumns":
      return isSelectionInTable(editor);
    case "alignCellTop":
    case "alignCellMiddle":
    case "alignCellBottom":
      return isSelectionInTable(editor);
    default:
      return action.startsWith("preset:") && isSelectionInTable(editor);
  }
}

/** The drag-resize plugin's minimum column width (R6.3/R6.7). */
const TABLE_CELL_MIN_WIDTH = 40;

/**
 * Resolves the connector style. The colour is the palette token by default
 * (`STROKE_COLOR_TOKEN`), which the renderer maps to the active theme's
 * stroke colour — connectors stay readable after theme switches, exactly
 * like strokes and shapes (DECISIONS #17).
 *
 * @returns the style/arrow/routing bundle used for new connectors.
 */
function getConnectorStyle(): ConnectorStyle {
  const state = useUiStore.getState();
  return {
    color: state.connectorColor,
    width: DEFAULT_CONNECTOR_STYLE.width,
    dash: state.connectorDash,
    routing: state.connectorRouting,
    startArrow: state.connectorArrow === "both" ? "arrow" : "none",
    endArrow: state.connectorArrow === "none" ? "none" : "arrow",
  };
}

/**
 * Resolves the pen stroke style (R5.4: user-adjustable colour/width + the
 * marker mode). The colour default is the palette token
 * (`STROKE_COLOR_TOKEN`), which the renderer maps to the active theme's
 * stroke colour — so strokes stay readable after theme switches.
 *
 * @returns the colour/width/marker bundle used for new strokes.
 */
function getStrokeStyle(): StrokeStyle {
  const state = useUiStore.getState();
  return {
    color: state.penColor,
    width: state.penHighlighter ? Math.max(state.penWidth, 8) : state.penWidth,
    highlighter: state.penHighlighter,
  };
}

/**
 * Resolves the R5.5 snap configuration shared by every gesture-capable
 * tool (create/drag/resize + floating connector endpoints).
 *
 * @returns the enabled/spacing pair from the UI store.
 */
function getSnapConfig(): SnapConfig {
  const state = useUiStore.getState();
  return { enabled: state.snapEnabled, spacing: state.snapSpacing };
}

/**
 * Resolves the shape style. Fill and stroke are palette tokens the renderer
 * maps to the active theme's accent-tinted fill and stroke colours — shapes
 * stay readable after theme switches, exactly like strokes (DECISIONS #17).
 *
 * @returns the fill/stroke/width triple used for new shapes.
 */
function getShapeStyle(): ShapeStyle {
  return {
    fill: SHAPE_FILL_TOKEN,
    stroke: STROKE_COLOR_TOKEN,
    strokeWidth: DEFAULT_STROKE_WIDTH,
  };
}

/**
 * Emits typed events whenever the UI store changes (language/theme/tool).
 *
 * @param eventBus - the application event bus.
 * @param logger - the root logger (used for a debug trace).
 */
function bridgeUiStoreToEventBus(
  eventBus: EventBus<AppEventMap>,
  logger: Logger,
): void {
  const uiLogger = logger.child("ui");
  // Command-triggered dialogs (R4.8): core.export.png opens the Export
  // PNG dialog through the UI store slice.
  eventBus.on("ui:export-png-requested", () => {
    useUiStore.getState().openExportDialog("png");
  });
  // R8.7: the SVG + PDF export commands pre-seed the same dialog.
  eventBus.on("ui:export-svg-requested", () => {
    useUiStore.getState().openExportDialog("svg");
  });
  eventBus.on("ui:export-pdf-requested", () => {
    useUiStore.getState().openExportDialog("pdf");
  });
  // R8.2: the Settings dialog opens through the store slice.
  eventBus.on("ui:settings-dialog-requested", () => {
    useUiStore.getState().setSettingsDialogOpen(true);
  });
  // R8.4: the New-project template gallery.
  eventBus.on("ui:template-gallery-requested", () => {
    useUiStore.getState().setTemplateGalleryOpen(true);
  });
  // Command-triggered dialogs (R5.2): core.insert.image opens the Insert
  // Image dialog through the UI store slice.
  eventBus.on("ui:insert-image-requested", () => {
    useUiStore.getState().setInsertImageDialogOpen(true);
  });
  // فاز M1: core.insert.video opens the Insert Video dialog the same way.
  eventBus.on("ui:insert-video-requested", () => {
    useUiStore.getState().setInsertVideoDialogOpen(true);
  });
  // فاز A1: core.insert.audio opens the Insert Audio dialog the same way.
  eventBus.on("ui:insert-audio-requested", () => {
    useUiStore.getState().setInsertAudioDialogOpen(true);
  });
  // فاز P1: core.insert.pdf opens the Insert PDF dialog the same way.
  eventBus.on("ui:insert-pdf-requested", () => {
    useUiStore.getState().setInsertPdfDialogOpen(true);
  });
  // فاز M2 (A.2.3): the double-click play request opens the floating
  // player — ONE instance (opening B closes A through the single-id store).
  eventBus.on("ui:video-play-requested", ({ objectId }) => {
    useUiStore.getState().openVideoPlayer(objectId);
  });
  // فاز A2 (A.2.3): the audio double-click opens the mini-player — the
  // store owns the ONE-instance hand-off across BOTH players.
  eventBus.on("ui:audio-play-requested", ({ objectId }) => {
    useUiStore.getState().openAudioPlayer(objectId);
  });
  // فاز P2 (A.2.3): the PDF double-click opens the floating viewer —
  // the store owns the ONE-instance hand-off across ALL players.
  eventBus.on("ui:pdf-view-requested", ({ objectId }) => {
    useUiStore.getState().openPdfViewer(objectId);
  });
  // R13.1: the Markdown interop dialog opens through the store slice.
  eventBus.on("ui:markdown-dialog-requested", ({ tab }) => {
    useUiStore.getState().openMarkdownDialog(tab ?? "export");
  });
  // Context-menu opens (R6.2): both the canvas right-click path and the
  // editor right-click path arrive through the typed bus and land in the
  // UI store, which the ContextMenuHost renders from.
  eventBus.on("ui:context-menu-requested", ({ region, objectType, x, y }) => {
    useUiStore.getState().openContextMenu(x, y, { region, objectType });
  });
  useUiStore.subscribe((state, previous) => {
    if (state.language !== previous.language) {
      eventBus.emit("ui:language-changed", { language: state.language });
      uiLogger.debug("language changed", { language: state.language });
    }
    if (state.theme !== previous.theme) {
      eventBus.emit("ui:theme-changed", { theme: state.theme });
    }
    if (state.activeTool !== previous.activeTool) {
      eventBus.emit("ui:tool-changed", { tool: state.activeTool });
    }
  });
}
