/**
 * Typed publish/subscribe event bus used to decouple feature modules.
 *
 * The bus is generic over an "event map" — an interface whose keys are event
 * names and whose values are payload types. Handlers receive exactly the typed
 * payload of the event they subscribe to.
 *
 * Layering note (CLAUDE.md §1.3): core/ stays free of React/DOM/TipTap/Tauri
 * imports — this file only uses plain TypeScript.
 */

/** Function returned by {@link EventBus.on} that removes the handler again. */
export type Unsubscribe = () => void;

/** Payload of the `app:started` event, emitted once after boot. */
export interface AppStartedEvent {
  readonly timestamp: number;
}

/** Payload of `ui:language-changed` (fa | en). */
export interface LanguageChangedEvent {
  readonly language: string;
}

/** Payload of `ui:theme-changed` (dark | light). */
export interface ThemeChangedEvent {
  readonly theme: string;
}

/** Payload of `ui:tool-changed`. */
export interface ToolChangedEvent {
  readonly tool: string;
}

/** Payload of `camera:changed`, emitted after every camera mutation. */
export interface CameraChangedEvent {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly rotation: number;
}

/** Payload of `scene:changed`, emitted after every scene mutation. */
export interface SceneChangedEvent {
  readonly revision: number;
  readonly objectCount: number;
}

/** Payload of `history:changed`, emitted after push/undo/redo/clear. */
export interface HistoryChangedEvent {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/** Payload of `pointer:moved` — the pointer position in world coordinates. */
export interface PointerMovedEvent {
  readonly x: number;
  readonly y: number;
}

/** Payload of `selection:changed`, emitted after every selection mutation. */
export interface SelectionChangedEvent {
  /** Number of currently selected objects (0 = nothing selected). */
  readonly size: number;
}

/** Payload of `resize:live`, emitted per frame during a resize gesture. */
export interface ResizeLiveEvent {
  /** Current width of the resized bounds, in world units. */
  readonly width: number;
  /** Current height of the resized bounds, in world units. */
  readonly height: number;
}

/** Payload of `resize:ended`, emitted when a resize gesture finishes. */
export interface ResizeEndedEvent {
  /** Final width of the resized bounds, in world units. */
  readonly width: number;
  /** Final height of the resized bounds, in world units. */
  readonly height: number;
}

/** Payload of `rotate:live`, emitted per frame of a rotation gesture. */
export interface RotateLiveEvent {
  /** Current rotation delta of the gesture, in degrees. */
  readonly angle: number;
}

/** Payload of `rotate:ended`, emitted when a rotation gesture finishes. */
export interface RotateEndedEvent {
  /** Final rotation delta applied by the gesture, in degrees. */
  readonly angle: number;
}

/** Payload of `text:edit-requested` — a tool asks to edit a text object. */
export interface TextEditRequestedEvent {
  /** Id of the text object to edit. */
  readonly objectId: string;
}

/** Payload of `text:create-requested` — a tool asks to create text. */
export interface TextCreateRequestedEvent {
  /** World-space left edge of the requested box. */
  readonly x: number;
  /** World-space top edge of the requested box. */
  readonly y: number;
  /** Box width in world units. */
  readonly width: number;
  /** Box height in world units. */
  readonly height: number;
  /** Font size in world units. */
  readonly fontSize: number;
  /** Width behaviour of the new box (R3A.7): taps create AUTO boxes,
   *  drag-outs create FIXED (wrapping) boxes. */
  readonly sizeMode: "fixed" | "auto";
}

/** Payload of `sticky:create-requested` — a tool asks to create a sticky note. */
export interface StickyCreateRequestedEvent {
  /** World-space left edge of the requested card. */
  readonly x: number;
  /** World-space top edge of the requested card. */
  readonly y: number;
  /** Card width in world units. */
  readonly width: number;
  /** Card height in world units. */
  readonly height: number;
  /** Card background colour (CSS string). */
  readonly noteColor: string;
  /** Font size in world units. */
  readonly fontSize: number;
}

/** Payload of `table:create-requested` — a tool asks to create a table. */
export interface TableCreateRequestedEvent {
  /** World-space left edge of the requested table box. */
  readonly x: number;
  /** World-space top edge of the requested table box. */
  readonly y: number;
  /** Box width in world units (tap → the picker's default footprint). */
  readonly width: number;
  /** Box height in world units. */
  readonly height: number;
  /** Row count of the new table (R6.1). */
  readonly rows: number;
  /** Column count of the new table (R6.1). */
  readonly cols: number;
  /** Font size in world units. */
  readonly fontSize: number;
}

/** Payload of `ui:notice` — a transient user-facing notice (toast). */
export interface UiNoticeEvent {
  /** i18n key of the notice text (resolved by the UI layer). */
  readonly messageKey: string;
  /** Notice severity. */
  readonly severity: "info" | "error";
  /** Placeholder values interpolated into `{name}` slots (R3B.8 counts). */
  readonly values?: Readonly<Record<string, string>>;
}

/** Payload of `ui:link-dialog-requested` — open the link dialog (Ctrl+K, R3B.3). */
export interface LinkDialogRequestedEvent {
  /** Whether the dialog should open with the current link pre-filled. */
  readonly fromSelection: boolean;
}

/** Payload of `ui:find-requested` — open the Find & Replace panel (Ctrl+F, R3B.8). */
export interface FindRequestedEvent {
  /** Where the shortcut came from (diagnostics only). */
  readonly source: "editor" | "canvas";
}

/** Payload of `ui:open-link-confirmation` — confirm opening a URL in the OS browser (R3B.3). */
export interface OpenLinkConfirmationEvent {
  /** The URL to open on confirmation. */
  readonly url: string;
}

/** Payload of `text:edit-began`, emitted when editing starts. */
export interface TextEditBeganEvent {
  /** Id of the text object being edited. */
  readonly objectId: string;
}

/** Payload of `text:edit-ended`, emitted when editing finishes. */
export interface TextEditEndedEvent {
  /** Id of the text object that was edited. */
  readonly objectId: string;
  /** Whether the edit was committed (vs. cancelled). */
  readonly committed: boolean;
}

/** Why a save ran: the periodic timer, a manual Ctrl+S or a tab flush. */
export type SaveReason = "auto" | "manual" | "flush";

/** Payload of `persistence:saved`, emitted after a successful save. */
export interface PersistenceSavedEvent {
  /** Epoch milliseconds of the completed save. */
  readonly timestamp: number;
  /** What triggered the save. */
  readonly reason: SaveReason;
}

/** Payload of `persistence:save-failed`, emitted when a save errors. */
export interface PersistenceSaveFailedEvent {
  /** Human-readable failure cause (logged, not user-facing). */
  readonly reason: string;
}

/** Payload of `project:restored`, emitted after the scene was replaced. */
export interface ProjectRestoredEvent {
  /** Number of objects in the restored project (0 for a fresh document). */
  readonly objectCount: number;
}

/** Payload of `project:import-requested` — the menu asks to load a file. */
export interface ProjectImportRequestedEvent {
  /** Raw file contents to deserialize and apply. */
  readonly raw: string;
  /** Absolute path the payload was read from (path-based opens only —
   *  feeds the document title, recent files and Ctrl+S re-saves). */
  readonly path?: string;
  /** Whether the payload is known to be clean (loaded verbatim from a
   *  file on disk — a future-format file additionally opens read-only). */
  readonly readOnly?: boolean;
}

/** Payload of `project:new-requested` — the menu asks for a fresh document. */
export interface ProjectNewRequestedEvent {
  /** Whether unsaved work should be discarded without asking. */
  readonly discardUnsaved: boolean;
}

/** Payload of `project:import-failed` — an import was refused. */
export interface ProjectImportFailedEvent {
  /** Human-readable refusal cause (corrupt file, wrong magic, ...). */
  readonly reason: string;
}

/** Payload of `project:document-changed` — the open-document state (R4.5). */
export interface DocumentChangedEvent {
  /** Absolute path of the open file, or null for an untitled document. */
  readonly path: string | null;
  /** Display name of the open document (null = untitled → i18n label). */
  readonly name: string | null;
  /** Whether unsaved changes exist (title bar «*» marker + close guard). */
  readonly dirty: boolean;
  /** Whether the document is read-only (future file version, R4.4a). */
  readonly readOnly: boolean;
}

/** Payload of `project:recovery-offered` — startup found a newer autosave. */
export interface RecoveryOfferedEvent {
  /** Save timestamp of the recovery snapshot (epoch ms). */
  readonly savedAt: number;
  /** Number of objects in the recovery snapshot. */
  readonly objectCount: number;
}

/** Payload of `project:recovery-decided` — the user answered the dialog. */
export interface RecoveryDecidedEvent {
  /** Whether the recovery snapshot should be restored. */
  readonly restore: boolean;
}

/** Payload of `ui:unsaved-confirm-requested` — guard before new/open (R4.5). */
export interface UnsavedConfirmRequestedEvent {
  /** What should run after the guard resolves (`close` = window close). */
  readonly action: "new" | "open" | "close";
}

/** Payload of `ui:unsaved-confirm-resolved` — the confirm dialog answered. */
export interface UnsavedConfirmResolvedEvent {
  /** The guarded action the request was issued for. */
  readonly action: "new" | "open" | "close";
  /** The user's decision. */
  readonly decision: "save" | "discard" | "cancel";
}

/** Payload of `ui:save-project-requested` — open the save-at-path dialog. */
export interface SaveProjectRequestedEvent {
  /** Whether the save must go through the Save-As flow (forced path pick). */
  readonly as: boolean;
}

/** Payload of `ui:open-project-requested` — start an open flow (Ctrl+O). */
export interface OpenProjectRequestedEvent {
  /** Nothing yet — kept for future source discrimination. */
  readonly source?: "command";
}

/** Payload of `ui:export-png-requested` — open the Export PNG dialog (R4.8). */
export interface ExportPngRequestedEvent {
  /** Nothing yet — kept for future option pre-seeds. */
  readonly source?: "command";
}

/** Payload of `ui:export-svg-requested` — the SVG export dialog intent (R8.7). */
export interface ExportSvgRequestedEvent {
  readonly source?: "command";
}

/** Payload of `ui:export-pdf-requested` — the PDF print pipeline intent (R8.7). */
export interface ExportPdfRequestedEvent {
  readonly source?: "command";
}

/** Payload of `ui:settings-dialog-requested` — open the composed settings dialog (R8.2). */
export interface SettingsDialogRequestedEvent {
  readonly source?: "command" | "statusBar";
}

/** Payload of `ui:template-gallery-requested` — open the New gallery (R8.4). */
export interface TemplateGalleryRequestedEvent {
  readonly source?: "command";
}

/** Payload of `version-history:changed` — the version-history list mutated (R8.5). */
export interface VersionHistoryChangedEvent {
  /** Number of snapshots for the active path after the mutation. */
  readonly count: number;
}

/** Payload of `plugins:changed` — the plugin world mutated (R9.5/9.6). */
export interface PluginsChangedEvent {
  /** The plugin id the mutation concerns ("" for bulk refreshes). */
  readonly pluginId: string;
  /** What happened. */
  readonly reason:
    "install" | "enable" | "disable" | "uninstall" | "restore" | "error";
}

/** Payload of `datahub:changed` — a hub contract's data changed (R10.1). */
export interface DataHubChangedEvent {
  /** The contract id (e.g. `planner.tasks`). */
  readonly contractId: string;
  /** Who published: a plugin id or `"host"`. */
  readonly providerId: string;
  /** The provider's change payload (e.g. `{type: "task-completed", …}`). */
  readonly change: unknown;
}

/** Payload of `automation:fired` — one rule fired (R10.7). */
export interface AutomationFiredEvent {
  /** The rule that fired. */
  readonly ruleId: string;
  /** Whether the action succeeded. */
  readonly ok: boolean;
  /** The action detail (command id, contract method or the Persian error). */
  readonly detail?: string;
}

/** Payload of `ui:connector-label-requested` — edit a connector's midpoint label (R5.3). */
export interface ConnectorLabelRequestedEvent {
  /** Id of the connector whose label the inline editor opens for. */
  readonly objectId: string;
}

/** Payload of `ui:insert-image-requested` — open the Insert Image dialog (R5.2). */
export interface InsertImageRequestedEvent {
  /** Nothing yet — kept for future source discrimination. */
  readonly source?: "menu" | "command";
}

/** Payload of `ui:insert-video-requested` — open the Insert Video dialog (فاز M1). */
export interface InsertVideoRequestedEvent {
  /** Nothing yet — kept for future source discrimination. */
  readonly source?: "menu" | "command";
}

/** Payload of `ui:insert-audio-requested` — open the Insert Audio dialog (فاز A1). */
export interface InsertAudioRequestedEvent {
  /** Nothing yet — kept for future source discrimination. */
  readonly source?: "menu" | "command";
}

/** Payload of `ui:video-play-requested` — open the floating player (فاز M2). */
export interface VideoPlayRequestedEvent {
  /** The video object the player opens on. */
  readonly objectId: string;
}

/** Payload of `ui:audio-play-requested` — open the floating mini-player (فاز A2). */
export interface AudioPlayRequestedEvent {
  /** The audio object the mini-player opens on. */
  readonly objectId: string;
}

/** Payload of `ui:insert-pdf-requested` — open the Insert PDF dialog (فاز P1). */
export interface InsertPdfRequestedEvent {
  /** Where the request came from (menu / command). */
  readonly source?: "menu" | "command";
}

/** Payload of `ui:pdf-view-requested` — open the floating PDF viewer (فاز P2). */
export interface PdfViewRequestedEvent {
  /** The PDF object the viewer opens on (at its `currentPage`). */
  readonly objectId: string;
}

/** Payload of `ui:context-menu-requested` — open the context menu (R6.2). */
export interface ContextMenuRequestedEvent {
  /** Which surface the right-click hit: canvas (optionally an object kind),
   *  a table cell, or plain text. */
  readonly region: "canvas" | "table" | "text";
  /** Scene object kind under the cursor (canvas region only). */
  readonly objectType?: string;
  /** Screen-space anchor (viewport coordinates). */
  readonly x: number;
  readonly y: number;
}

/** Payload of `bookmarks:changed` — the bookmark list mutated (R7.9). */
export interface BookmarksChangedEvent {
  /** Number of bookmarks after the mutation. */
  readonly count: number;
}

/** Payload of `ui:markdown-dialog-requested` (R13.1). */
export interface MarkdownDialogRequestedEvent {
  /** The dialog's opening tab. */
  readonly tab?: "export" | "import";
}

/** Payload of `styles:changed` — the named-style registry mutated (R13.3). */
export interface StylesChangedEvent {
  /** Total styles (built-ins + user) after the change. */
  readonly count: number;
}

/** Payload of `property-schema:changed` — the property-schema store mutated (pack R11.3). */
export interface PropertySchemaChangedEvent {
  /** Total known property names after the change. */
  readonly count: number;
}

/**
 * Payload of `knowledge:changed` — the knowledge index rebuilt
 * (Knowledge Pack, pack-Phase-11 rebuild: wiki links, backlinks, tags).
 */
export interface KnowledgeChangedEvent {
  /** Resolved titles after the rebuild. */
  readonly titles: number;
  /** Outgoing links (resolved + broken) after the rebuild. */
  readonly links: number;
  /** Backlink rows after the rebuild. */
  readonly backlinks: number;
  /** Distinct tags after the rebuild. */
  readonly tags: number;
}

/** Payload of `ui:fly-to-object` — camera flight + highlight pulse (R7.6). */
export interface FlyToObjectEvent {
  /** Id of the object to frame + pulse. */
  readonly objectId: string;
}

/**
 * Payload of `object:linking-changed` (pack R11.2/R11.10) — the
 * LinkRegistry mutated: entries added/removed, or dangling links
 * auto-resolved through the TitleIndex. Emitted after the knowledge
 * rebuild that observed the change.
 */
export interface ObjectLinkingChangedEvent {
  /** Manual/plugin link entries added since the last event. */
  readonly added: number;
  /** Manual/plugin link entries removed since the last event. */
  readonly removed: number;
  /** Entries that transitioned dangling → resolved (title match). */
  readonly resolved: number;
  /** Total registry entries after the change. */
  readonly total: number;
  /**
   * Pack-14 R14.5: the mutation's change-type — `link-created`,
   * `link-removed` or `link-resolved` — consumed by the automations
   * engine's change-type filter (the knowledge.onLinkCreated trigger).
   */
  readonly type?: "link-created" | "link-removed" | "link-resolved" | "link-changed";
}

/**
 * Payload of `object:properties-changed` (pack R11.10) — one or more
 * objects' structured `properties` records changed (edit, undo/redo,
 * import). Emitted from the debounced post-scene-change diff.
 */
export interface ObjectPropertiesChangedEvent {
  /** Ids of the objects whose properties record changed. */
  readonly objectIds: readonly string[];
}

/**
 * Payload of `ui:search-filter-tag` (pack R11.4/AC11.5) — a UI surface
 * (the Tag pane) asks the Search panel to apply one tag filter chip.
 */
export interface SearchFilterTagEvent {
  /** The tag KEY (normalised) the filter matches on. */
  readonly tagKey: string;
  /** The tag DISPLAY form to render in the chip. */
  readonly display: string;
}

/**
 * Payload of `ui:link-picker-requested` (pack R11.6) — the command
 * `core.knowledge.linkTo` asks the host to open the manual-link target
 * picker for one source object.
 */
export interface LinkPickerRequestedEvent {
  /** The source object the new manual link starts from. */
  readonly sourceId: string;
}

/** Payload of `project:file-saved` — a disk save completed (R4.5). */
export interface FileSavedEvent {
  /** Absolute path the project file was written to. */
  readonly path: string;
  /** Epoch milliseconds of the completed save. */
  readonly savedAt: number;
}

/**
 * Application-wide event map (Phase 0 shell events + Phase 1 canvas events:
 * camera, scene, history, pointer).
 *
 * Payload field types are intentionally wide (`string`, primitives) so
 * core/ never needs to import UI-layer types — the dependency rule lets
 * arrows point down only (ui → interaction → core, never the reverse).
 */
export interface AppEventMap {
  "app:started": AppStartedEvent;
  "ui:language-changed": LanguageChangedEvent;
  "ui:theme-changed": ThemeChangedEvent;
  "ui:tool-changed": ToolChangedEvent;
  "camera:changed": CameraChangedEvent;
  "scene:changed": SceneChangedEvent;
  "history:changed": HistoryChangedEvent;
  "pointer:moved": PointerMovedEvent;
  "selection:changed": SelectionChangedEvent;
  "resize:live": ResizeLiveEvent;
  "resize:ended": ResizeEndedEvent;
  "rotate:live": RotateLiveEvent;
  "rotate:ended": RotateEndedEvent;
  "text:edit-requested": TextEditRequestedEvent;
  "text:create-requested": TextCreateRequestedEvent;
  "sticky:create-requested": StickyCreateRequestedEvent;
  "table:create-requested": TableCreateRequestedEvent;
  "ui:notice": UiNoticeEvent;
  "ui:link-dialog-requested": LinkDialogRequestedEvent;
  "ui:find-requested": FindRequestedEvent;
  "ui:open-link-confirmation": OpenLinkConfirmationEvent;
  "text:edit-began": TextEditBeganEvent;
  "text:edit-ended": TextEditEndedEvent;
  "persistence:saved": PersistenceSavedEvent;
  "persistence:save-failed": PersistenceSaveFailedEvent;
  "project:restored": ProjectRestoredEvent;
  "project:import-requested": ProjectImportRequestedEvent;
  "project:import-failed": ProjectImportFailedEvent;
  "project:new-requested": ProjectNewRequestedEvent;
  "project:document-changed": DocumentChangedEvent;
  "project:recovery-offered": RecoveryOfferedEvent;
  "project:recovery-decided": RecoveryDecidedEvent;
  "project:file-saved": FileSavedEvent;
  "ui:unsaved-confirm-requested": UnsavedConfirmRequestedEvent;
  "ui:unsaved-confirm-resolved": UnsavedConfirmResolvedEvent;
  "ui:save-project-requested": SaveProjectRequestedEvent;
  "ui:open-project-requested": OpenProjectRequestedEvent;
  "ui:export-png-requested": ExportPngRequestedEvent;
  "ui:export-svg-requested": ExportSvgRequestedEvent;
  "ui:export-pdf-requested": ExportPdfRequestedEvent;
  "ui:settings-dialog-requested": SettingsDialogRequestedEvent;
  "ui:template-gallery-requested": TemplateGalleryRequestedEvent;
  "ui:connector-label-requested": ConnectorLabelRequestedEvent;
  "ui:insert-image-requested": InsertImageRequestedEvent;
  "ui:insert-video-requested": InsertVideoRequestedEvent;
  "ui:insert-audio-requested": InsertAudioRequestedEvent;
  "ui:insert-pdf-requested": InsertPdfRequestedEvent;
  "ui:video-play-requested": VideoPlayRequestedEvent;
  "ui:audio-play-requested": AudioPlayRequestedEvent;
  "ui:pdf-view-requested": PdfViewRequestedEvent;
  "ui:context-menu-requested": ContextMenuRequestedEvent;
  "bookmarks:changed": BookmarksChangedEvent;
  "version-history:changed": VersionHistoryChangedEvent;
  "plugins:changed": PluginsChangedEvent;
  "datahub:changed": DataHubChangedEvent;
  "automation:fired": AutomationFiredEvent;
  "ui:fly-to-object": FlyToObjectEvent;
  "styles:changed": StylesChangedEvent;
  "property-schema:changed": PropertySchemaChangedEvent;
  "knowledge:changed": KnowledgeChangedEvent;
  "object:linking-changed": ObjectLinkingChangedEvent;
  "object:properties-changed": ObjectPropertiesChangedEvent;
  "ui:search-filter-tag": SearchFilterTagEvent;
  "ui:link-picker-requested": LinkPickerRequestedEvent;
  "ui:markdown-dialog-requested": MarkdownDialogRequestedEvent;
}

/** A handler invoked with the payload of the event it subscribed to. */
type Handler<P> = (payload: P) => void;

/**
 * A strongly-typed event bus.
 *
 * @typeParam TEventMap - map of event names to their payload types. Typed as
 * `object` (instead of `Record<string, unknown>`) so plain interfaces work
 * as event maps — interfaces carry no implicit index signature.
 */
export class EventBus<TEventMap extends object> {
  private readonly handlers = new Map<keyof TEventMap, Set<Handler<unknown>>>();

  /**
   * Subscribes a handler to an event.
   *
   * @param event - event name (a key of the event map).
   * @param handler - invoked with the event payload on {@link EventBus.emit}.
   * @returns an {@link Unsubscribe} function; calling it removes the handler.
   */
  public on<K extends keyof TEventMap>(
    event: K,
    handler: Handler<TEventMap[K]>,
  ): Unsubscribe {
    let set = this.handlers.get(event);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(event, set);
    }
    // REASON: a heterogenous handler map must widen the stored handler type.
    const stored = handler as Handler<unknown>;
    set.add(stored);
    return () => {
      this.off(event, handler);
    };
  }

  /**
   * Subscribes a handler that is automatically removed after its first
   * invocation.
   *
   * @param event - event name (a key of the event map).
   * @param handler - invoked once with the event payload.
   * @returns an {@link Unsubscribe} function to cancel before the first emit.
   */
  public once<K extends keyof TEventMap>(
    event: K,
    handler: Handler<TEventMap[K]>,
  ): Unsubscribe {
    const wrapped: Handler<TEventMap[K]> = (payload) => {
      unsubscribe();
      handler(payload);
    };
    const unsubscribe = this.on(event, wrapped);
    return unsubscribe;
  }

  /**
   * Removes a previously subscribed handler. Safe to call for events without
   * subscribers or handlers that were never registered.
   *
   * @param event - event name (a key of the event map).
   * @param handler - the exact handler reference passed to on/once.
   */
  public off<K extends keyof TEventMap>(
    event: K,
    handler: Handler<TEventMap[K]>,
  ): void {
    const set = this.handlers.get(event);
    if (set === undefined) {
      return;
    }
    // REASON: symmetric widening with {@link EventBus.on}.
    const stored = handler as Handler<unknown>;
    set.delete(stored);
    if (set.size === 0) {
      this.handlers.delete(event);
    }
  }

  /**
   * Emits an event to all current subscribers.
   *
   * Handlers unsubscribing during dispatch are handled safely: the handler
   * set is snapshotted before iteration.
   *
   * @param event - event name (a key of the event map).
   * @param payload - the event payload delivered to every handler.
   */
  public emit<K extends keyof TEventMap>(
    event: K,
    payload: TEventMap[K],
  ): void {
    const set = this.handlers.get(event);
    if (set === undefined) {
      return;
    }
    const snapshot = [...set];
    for (const handler of snapshot) {
      // REASON: stored handlers were widened on registration; emit restores.
      const typed = handler as Handler<TEventMap[K]>;
      typed(payload);
    }
  }

  /** Removes every handler of every event. */
  public clear(): void {
    this.handlers.clear();
  }

  /**
   * @param event - event name (a key of the event map).
   * @returns the number of active handlers for `event`.
   */
  public listenerCount(event: keyof TEventMap): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}
