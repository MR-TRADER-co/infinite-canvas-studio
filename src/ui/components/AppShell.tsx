"use client";

/**
 * Root application shell, shared by both hosts:
 * the Next.js preview route (`src/app/page.tsx`) and the Tauri desktop entry
 * (`src/main.tsx`).
 *
 * Layout: a full-viewport column with the canvas surface filling the space
 * and the status bar pinned to the bottom (`flex-none`, never floats). The
 * floating toolbar overlays the canvas bottom-center inside a `relative`
 * wrapper (it never reflows the canvas). The shell boots the service
 * container once and keeps `<html>` in sync with the UI store
 * (language → `lang`/`dir`, theme → `dark` class). Tool keyboard shortcuts
 * (physical-key based) are registered shell-wide here. The SSR markup
 * already defaults to `fa`/RTL/dark, so there is no flash.
 */
import { useEffect } from "react";
import { Application } from "@/App";
import { useCanvasShortcuts } from "@/ui/hooks/useCanvasShortcuts";
import { useToolShortcuts } from "@/ui/hooks/useToolShortcuts";
import { directionOf } from "@/ui/i18n";
import { useUiStore } from "@/ui/store/uiStore";
import CanvasSurface from "./CanvasSurface";
import StatusBar from "./StatusBar";
import Toolbar from "./toolbar/Toolbar";
import SelectionActions from "./toolbar/SelectionActions";
import PanelContainer from "./panels/PanelContainer";
import TextFormatToolbar from "./text/TextFormatToolbar";
import TableToolbar from "./text/TableToolbar";
import LinkDialog from "./text/LinkDialog";
import LinkBubble from "./text/LinkBubble";
import ConfirmOpenLinkDialog from "./text/ConfirmOpenLinkDialog";
import FindReplacePanel from "./text/FindReplacePanel";
import WikiAutocompletePopup from "./text/WikiAutocompletePopup";
import NoticeToasts from "./NoticeToasts";
import ProjectMenu from "./ProjectMenu";
import DocumentTitleBar from "./DocumentTitleBar";
import DocumentCloseGuard from "./DocumentCloseGuard";
import RecoveryDialog from "./RecoveryDialog";
import UnsavedConfirmDialog from "./UnsavedConfirmDialog";
import InsertImageDialog from "./InsertImageDialog";
import InsertVideoDialog from "./InsertVideoDialog";
import InsertAudioDialog from "./InsertAudioDialog";
import InsertPdfDialog from "./InsertPdfDialog";
import ConvertVideoDialog from "./ConvertVideoDialog";
import ConvertAudioDialog from "./ConvertAudioDialog";
import FloatingPlayerWindow from "../player/FloatingPlayerWindow";
import FloatingMiniPlayer from "../player/FloatingMiniPlayer";
import FloatingPdfViewer from "../player/FloatingPdfViewer";
import MarkdownInteropDialog from "./MarkdownInteropDialog";
import StyleEditorDialog from "./styles/StyleEditorDialog";
import ConnectorLabelEditor from "./ConnectorLabelEditor";
import ContextMenuHost from "./ContextMenuHost";
import CommandPalette from "@/ui/palette/CommandPalette";
import BookmarkBar from "./BookmarkBar";
import PulseHighlight from "./PulseHighlight";
import SettingsDialog from "./SettingsDialog";
import TemplateGalleryDialog from "./TemplateGalleryDialog";
import StickerPickerDialog from "./StickerPickerDialog";
import LinkTargetPickerDialog from "./LinkTargetPickerDialog";
import PresentationView from "./PresentationView";
import { ensurePanelsRegistered } from "@/ui/panels/registerPanels";
import { ensureSettingsRegistered } from "@/ui/settings/registerSettings";
import { attachSettingsPersistence } from "@/ui/settings/settingsPersistence";
import { AppContext } from "@/AppContext";
import { Services } from "@/App";

export default function AppShell() {
  const language = useUiStore((state) => state.language);
  const theme = useUiStore((state) => state.theme);

  /** Physical-key tool shortcuts (V/H/P/E/T/S/C) for the whole shell. */
  useToolShortcuts();

  /** Canvas shortcuts: Space pan, undo/redo, zoom in/out/reset. */
  useCanvasShortcuts();

  /** Boots the typed service container exactly once (idempotent). */
  useEffect(() => {
    void Application.boot();
  }, []);

  /** R8.1/R8.2: hydrate persisted app settings, keep them persisted, and
   *  register the core panels + settings sections (idempotent seams). */
  useEffect(() => {
    const detachPersistence = attachSettingsPersistence();
    void Application.boot().then((context) => {
      ensurePanelsRegistered(context);
      ensureSettingsRegistered(context);
      void context;
    });
    return detachPersistence;
  }, []);

  /** Registers the settings sections when the registry is reachable
   *  (StrictMode-safe; the AppContext default may pre-date boot). */
  useEffect(() => {
    const context = AppContext.getDefault();
    const registry = context.tryGet(Services.settingsSections);
    if (registry !== undefined) {
      ensureSettingsRegistered(context);
    }
  }, []);

  /** Mirrors the UI language onto `<html lang>` / `<html dir>`. */
  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = directionOf(language);
  }, [language]);

  /** Mirrors the UI theme onto the `dark` class of `<html>`. */
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* Canvas area + floating overlays (absolute, no reflow). */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <CanvasSurface />
        <ProjectMenu />
        {/* Document name chip + dirty marker (R4.5). */}
        <DocumentTitleBar />
        {/* Phase 7 surfaces (R7.1–R7.12): the registered dock panels
            (layers/inspector/search/outline/minimap/insert — rendered FROM
            the PanelRegistry), the bookmark bar + prompt, the camera-flight
            pulse highlight and the command palette. */}
        <PanelContainer />
        <BookmarkBar />
        <PulseHighlight />
        <CommandPalette />
        <SelectionActions />
        <Toolbar />
        {/* Floating rich text format bar (R3A.6) — fixed-positioned above
            the live selection, outside the transformed overlay. */}
        <TextFormatToolbar />
        {/* Floating TABLE toolbar (R6.2) — shows while the caret/selection
            sits inside a table (structural commands). */}
        <TableToolbar />
        {/* Link context bubble (R3B.3) — while the caret sits inside a link. */}
        <LinkBubble />
        {/* Find & Replace panel (R3B.8) — Ctrl+F, floating top-start. */}
        <FindReplacePanel />
        {/* Wiki-link autocomplete popup (R11.5) — opens while the caret
            sits inside an open [[span of either text-editing surface. */}
        <WikiAutocompletePopup />
        {/* Link dialog (R3B.3 — Ctrl+K) and the open-link confirmation. */}
        <LinkDialog />
        <ConfirmOpenLinkDialog />
        {/* Transient notice toasts (R6.6 rejected nested-table paste…). */}
        <NoticeToasts />
        {/* Phase 4 document lifecycle surfaces (R4.5/R4.6): the recovery
            offer on boot, the unsaved-changes guard (new/open/close) and
            the window-close interception. */}
        <RecoveryDialog />
        <UnsavedConfirmDialog />
        <DocumentCloseGuard />
        {/* Phase 5 surfaces: the Insert Image dialog (R5.2, File menu /
            core.insert.image) and the connector label editor (R5.3,
            double-click on a connector). */}
        <InsertImageDialog />
        <InsertVideoDialog />
        <InsertAudioDialog />
        <InsertPdfDialog />
        <ConvertVideoDialog />
        <ConvertAudioDialog />
        {/* Phase 13 surfaces (R13.1/R13.3): the Markdown interop dialog
            and the style editor. */}
        <MarkdownInteropDialog />
        <StyleEditorDialog />
        <ConnectorLabelEditor />
        {/* Phase 6 surface: the registered context menu (R6.2) — renders
            the ContextMenuRegistry's merged menu at the right-click
            anchor (canvas / object / table / text regions). */}
        <ContextMenuHost />
        {/* Phase 8 surfaces: the composed Settings dialog (R8.2), the
            template gallery (R8.4) and the presentation overlay (R8.3). */}
        <SettingsDialog />
        <TemplateGalleryDialog />
        {/* Phase 12 surface: the sticker-library picker (R12.1, Ctrl+Shift+K
            / insert panel / command palette). */}
        <StickerPickerDialog />
        {/* Pack R11.6 surface: the manual-link target picker («لینک به این
            شیء…» — the object context menu + command palette). */}
        <LinkTargetPickerDialog />
        <PresentationView />
        {/* فاز M2: the floating player portal — screen-space, above every
            panel, no scrim (the canvas stays interactive while watching). */}
        <FloatingPlayerWindow />
        {/* فاز A2: the audio mini-player portal — the SAME mechanism (one
            instance across both players, no scrim, no background audio). */}
        <FloatingMiniPlayer />
        {/* فاز P2: the floating PDF viewer portal — the SAME mechanism (ONE
            instance across ALL players, no scrim; canvas stays interactive). */}
        <FloatingPdfViewer />
      </div>
      <StatusBar />
    </div>
  );
}
