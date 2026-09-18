/**
 * Unit tests for the core command catalog (R3B5.2/R3B5.3): the whole
 * catalog registers conflict-free under `core.*` ids, covers every group,
 * executes against real scene/history services and late-registered
 * commands surface in the group listing (the AC3B5.2 seam proof).
 */
import { describe, expect, it } from "vitest";
import { ServiceKey } from "@/AppContext";
import { CommandRegistry } from "@/core/registry/CommandRegistry";
import {
  CommandDispatcher,
  commandContextOf,
} from "@/interaction/dispatch/CommandDispatcher";
import { registerCoreCommands } from "@/interaction/dispatch/commands";
import type {
  CoreCommandWiring,
  EditorTextAction,
  TableAction,
  ToolCommandId,
} from "@/interaction/dispatch/commands";
import { Scene } from "@/core/model/Scene";
import { Selection } from "@/core/selection/Selection";
import { HistoryManager } from "@/core/history/HistoryManager";
import { IdGenerator } from "@/core/id/IdGenerator";
import { CameraController } from "@/core/camera/CameraController";
import { LinkRegistry } from "@/core/knowledge/LinkRegistry";
import type { KnowledgeService } from "@/core/knowledge/KnowledgeService";
import { textBoxFromRect } from "@/core/model/TextBoxObject";
import { vec2 } from "@/core/geometry/Vec2";
import type { SceneObjectData } from "@/core/model/SceneObject";

/** Structural stand-ins for the command catalog's service contracts. */
type AutosaveServiceLike = {
  saveNow: (reason?: "auto" | "manual" | "flush") => Promise<boolean>;
};
type TextLayerLike = { beginEditing: (id: string) => void };

/** Service keys mirroring the composition root's. */
const keys = {
  scene: ServiceKey.create<Scene>("scene"),
  history: ServiceKey.create<HistoryManager>("history"),
  selection: ServiceKey.create<Selection>("selection"),
  idGenerator: ServiceKey.create<IdGenerator>("idGenerator"),
  cameraController: ServiceKey.create<CameraController>("cameraController"),
  autosave: ServiceKey.create<AutosaveServiceLike>("autosave"),
  textLayer: ServiceKey.create<TextLayerLike>("textLayer"),
  links: ServiceKey.create<LinkRegistry>("links"),
  knowledge: ServiceKey.create<KnowledgeService>("knowledge"),
};

/** Records wiring calls. */
function makeWiring(calls: {
  tools: string[];
  editor: string[];
  ui: string[];
  table: string[];
}): CoreCommandWiring {
  return {
    keys,
    ui: {
      activateTool: (tool: ToolCommandId) => {
        calls.tools.push(tool);
      },
      toggleGrid: () => {
        calls.ui.push("grid");
      },
      openLinkDialog: () => {
        calls.ui.push("link");
      },
      openFind: () => {
        calls.ui.push("find");
      },
      newProject: () => {
        calls.ui.push("new");
      },
      openProject: () => {
        calls.ui.push("open");
      },
      saveProject: () => {
        calls.ui.push("save");
      },
      saveProjectAs: () => {
        calls.ui.push("saveAs");
      },
      openExportPng: () => {
        calls.ui.push("exportPng");
      },
      openExportSvg: () => {
        calls.ui.push("exportSvg");
      },
      openExportPdf: () => {
        calls.ui.push("exportPdf");
      },
      exportWord: () => {
        calls.ui.push("exportWord");
      },
      openStickerPicker: () => {
        calls.ui.push("stickerLibrary");
      },
      openSettings: () => {
        calls.ui.push("settings");
      },
      togglePresentation: () => {
        calls.ui.push("presentation");
      },
      insertImage: () => {
        calls.ui.push("insertImage");
      },
      insertVideo: () => {
        calls.ui.push("insertVideo");
      },
      insertAudio: () => {
        calls.ui.push("insertAudio");
      },
      // فاز P1: the PDF insert action (the wiring stub — never calls back).
      insertPdf: () => {
        calls.ui.push("insertPdf");
      },
      promptBookmark: () => {
        calls.ui.push("bookmark");
      },
      openCommandPalette: () => {
        calls.ui.push("palette");
      },
      togglePanel: (panelId) => {
        calls.ui.push(`panel:${panelId}`);
      },
      insertCard: (typeId, cardKey) => {
        calls.ui.push(`insert:${typeId}:${cardKey}`);
      },
      openMarkdownDialog: () => undefined,
      copyDeepLink: () => undefined,
      openLinkPicker: () => {
        calls.ui.push("linkPicker");
      },
      arrangeKnowledgeGraph: () => {
        calls.ui.push("arrangeGraph");
      },
      toggleKnowledgeEdges: () => {
        calls.ui.push("toggleKnowledgeEdges");
      },
      copySelection: () => {
        calls.ui.push("copySelection");
      },
      cutSelection: () => {
        calls.ui.push("cutSelection");
      },
      pasteFromClipboard: () => {
        calls.ui.push("pasteFromClipboard");
      },
      copyImageToSystem: () => {
        calls.ui.push("copyImageToSystem");
      },
      copySelectionAsImage: () => {
        calls.ui.push("copySelectionAsImage");
      },
      resetImageToNatural: () => {
        calls.ui.push("resetImageToNatural");
        return true;
      },
      resetImageToInsertState: () => {
        calls.ui.push("resetImageToInsertState");
        return true;
      },
      togglePin: () => {
        calls.ui.push("togglePin");
        return true;
      },
    },
    text: {
      runEditorAction: (action: EditorTextAction) => {
        calls.editor.push(action);
        return true;
      },
      hasLiveEditor: () => true,
      copyFormat: () => true,
      applyFormat: () => true,
    },
    table: {
      runTableAction: (action: TableAction) => {
        calls.table.push(action);
        return true;
      },
      canTableAction: () => true,
    },
  };
}

/** A locator with REAL core services (scene/history/selection). */
function makeLocator(
  scene: Scene,
  history: HistoryManager,
  selection: Selection,
) {
  return {
    tryGet: <T>(key: ServiceKey<T>): T | undefined => {
      const map: Record<string, unknown> = {
        scene,
        history,
        selection,
        idGenerator: new IdGenerator("obj"),
        cameraController: new CameraController(scene.camera),
        autosave: { saveNow: () => Promise.resolve(true) },
        textLayer: { beginEditing: () => undefined },
      };
      return (map as Record<string, T | undefined>)[key.id];
    },
  };
}

describe("registerCoreCommands (the core catalog)", () => {
  it("registers the whole catalog with NO id or shortcut conflicts", () => {
    const registry = new CommandRegistry();
    expect(() =>
      registerCoreCommands(
        registry,
        makeWiring({ tools: [], editor: [], ui: [], table: [] }),
      ),
    ).not.toThrow();
    // Every id is core.* (AC3B5.5).
    expect(registry.ids().every((id) => id.startsWith("core."))).toBe(true);
    expect(registry.size).toBeGreaterThanOrEqual(45);
  });

  it("covers every expected group with entries", () => {
    const registry = new CommandRegistry();
    registerCoreCommands(
      registry,
      makeWiring({ tools: [], editor: [], ui: [], table: [] }),
    );
    const groups = new Set(registry.list().map((entry) => entry.group));
    for (const expected of [
      "edit",
      "view",
      "selection",
      "tools",
      "file",
      "export",
      "text.format",
      "text.block",
      "text.link",
      "find",
    ]) {
      expect(groups.has(expected as never), `group ${expected}`).toBe(true);
    }
  });

  it("executes undo/redo through REAL services (behaviour parity)", () => {
    const scene = new Scene();
    const history = new HistoryManager(50, () => undefined);
    const selection = new Selection(() => undefined);
    scene.add(
      textBoxFromRect(
        { minX: 0, minY: 0, maxX: 80, maxY: 30 },
        "سلام",
        16,
        "box1",
        0,
        "fixed",
      ),
    );
    selection.replaceAll(["box1"]);

    const registry = new CommandRegistry();
    registerCoreCommands(
      registry,
      makeWiring({ tools: [], editor: [], ui: [], table: [] }),
    );
    const dispatcher = new CommandDispatcher(registry);
    const ctx = commandContextOf(makeLocator(scene, history, selection));

    // delete → undo → the box is back (the pre-refactor behaviour).
    expect(dispatcher.dispatch("core.selection.delete", ctx)).toBe(true);
    expect(scene.objectCount).toBe(0);
    expect(dispatcher.dispatch("core.edit.undo", ctx)).toBe(true);
    expect(scene.objectCount).toBe(1);
    expect(scene.findById("box1")?.kind).toBe("textBox");
  });

  it("executes tool commands through the wiring", () => {
    const calls = {
      tools: [] as string[],
      editor: [] as string[],
      ui: [] as string[],
      table: [] as string[],
    };
    const registry = new CommandRegistry();
    registerCoreCommands(registry, makeWiring(calls));
    const dispatcher = new CommandDispatcher(registry);
    const ctx = commandContextOf({
      tryGet: () => undefined,
    });
    expect(dispatcher.dispatch("core.tools.pen", ctx)).toBe(true);
    expect(calls.tools).toEqual(["pen"]);
  });

  it("executes text formatting commands through the wiring", () => {
    const calls = {
      tools: [] as string[],
      editor: [] as string[],
      ui: [] as string[],
      table: [] as string[],
    };
    const registry = new CommandRegistry();
    registerCoreCommands(registry, makeWiring(calls));
    const dispatcher = new CommandDispatcher(registry);
    const ctx = commandContextOf({ tryGet: () => undefined });
    expect(dispatcher.dispatch("core.text.bold", ctx)).toBe(true);
    expect(dispatcher.dispatch("core.text.heading2", ctx)).toBe(true);
    expect(dispatcher.dispatch("core.text.taskList", ctx)).toBe(true);
    expect(calls.editor).toEqual(["bold", "heading2", "taskList"]);
  });

  it("executes the find/link intents through the wiring", () => {
    const calls = {
      tools: [] as string[],
      editor: [] as string[],
      ui: [] as string[],
      table: [] as string[],
    };
    const registry = new CommandRegistry();
    registerCoreCommands(registry, makeWiring(calls));
    const dispatcher = new CommandDispatcher(registry);
    const ctx = commandContextOf({ tryGet: () => undefined });
    dispatcher.dispatch("core.find.open", ctx);
    dispatcher.dispatch("core.text.linkDialog", ctx);
    expect(calls.ui).toEqual(["find", "link"]);
  });

  it("gates delete/edit-selection commands on the selection state", () => {
    const scene = new Scene();
    const history = new HistoryManager(50, () => undefined);
    const selection = new Selection(() => undefined);
    const registry = new CommandRegistry();
    registerCoreCommands(
      registry,
      makeWiring({ tools: [], editor: [], ui: [], table: [] }),
    );
    const dispatcher = new CommandDispatcher(registry);
    const ctx = commandContextOf(makeLocator(scene, history, selection));

    // Empty selection: delete is disabled, clear runs.
    expect(dispatcher.dispatch("core.selection.delete", ctx)).toBe(false);
    expect(dispatcher.dispatch("core.selection.clear", ctx)).toBe(true);

    scene.add(
      textBoxFromRect(
        { minX: 0, minY: 0, maxX: 80, maxY: 30 },
        "سلام",
        16,
        "box1",
        0,
        "fixed",
      ),
    );
    selection.replaceAll(["box1"]);
    expect(dispatcher.dispatch("core.selection.delete", ctx)).toBe(true);
    expect(scene.objectCount).toBe(0);
  });

  it("dispatches the pin toggle through the wiring, gated on pinnables (فاز ۲۵)", () => {
    const calls = {
      tools: [] as string[],
      editor: [] as string[],
      ui: [] as string[],
      table: [] as string[],
    };
    const scene = new Scene();
    const history = new HistoryManager(50, () => undefined);
    const selection = new Selection(() => undefined);
    const registry = new CommandRegistry();
    registerCoreCommands(registry, makeWiring(calls));
    const dispatcher = new CommandDispatcher(registry);
    const ctx = commandContextOf(makeLocator(scene, history, selection));

    // Empty selection: the pin command is disabled.
    expect(dispatcher.dispatch("core.selection.togglePin", ctx)).toBe(false);
    expect(calls.ui).toEqual([]);

    // A pinnable shape selected: the command runs through the wiring.
    scene.add(
      textBoxFromRect(
        { minX: 0, minY: 0, maxX: 80, maxY: 30 },
        "سلام",
        16,
        "box1",
        0,
        "fixed",
      ),
    );
    selection.replaceAll(["box1"]);
    expect(dispatcher.dispatch("core.selection.togglePin", ctx)).toBe(true);
    expect(calls.ui).toEqual(["togglePin"]);

    // A world-attached-only selection (a connector) refuses the pin.
    calls.ui.length = 0;
    const connector = {
      id: "conn-1",
      kind: "connector",
      name: undefined,
      parentId: undefined,
      position: vec2(0, 0),
      rotation: 0,
      zIndex: 1,
      visible: true,
      locked: false,
      start: { objectId: null, anchorIndex: 0, position: vec2(0, 0) },
      end: { objectId: null, anchorIndex: 0, position: vec2(40, 0) },
      routingKind: "straight",
      strokeColor: "#000",
      strokeWidth: 2,
      strokeStyle: "solid",
      startArrow: "none",
      endArrow: "arrow",
    } as SceneObjectData;
    scene.add(connector);
    selection.replaceAll(["conn-1"]);
    expect(dispatcher.dispatch("core.selection.togglePin", ctx)).toBe(false);
    expect(calls.ui).toEqual([]);
  });

  it("a LATE-registered dummy command appears in the selection group (AC3B5.2)", () => {
    const registry = new CommandRegistry();
    registerCoreCommands(
      registry,
      makeWiring({ tools: [], editor: [], ui: [], table: [] }),
    );
    const dispatcher = new CommandDispatcher(registry);
    const before = dispatcher.commandsInGroup("selection").length;
    registry.register({
      id: "core.selection.dummy",
      titleKey: "selectionActions.duplicate",
      group: "selection",
      order: 999,
      execute: () => undefined,
    });
    const after = dispatcher.commandsInGroup("selection");
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]?.id).toBe("core.selection.dummy");
  });

  it("binds every pre-refactor shortcut to a command (AC3B5.3 parity)", () => {
    const registry = new CommandRegistry();
    registerCoreCommands(
      registry,
      makeWiring({ tools: [], editor: [], ui: [], table: [] }),
    );
    const expected: Record<string, string> = {
      "Mod-Z": "core.edit.undo",
      "Mod-Shift-Z": "core.edit.redo",
      "Mod-Y": "core.edit.redoAlternate",
      "Mod-S": "core.file.save",
      "Mod-Shift-S": "core.file.saveAs",
      "Mod-N": "core.file.new",
      "Mod-O": "core.file.open",
      "Mod-A": "core.selection.selectAll",
      "Mod-D": "core.selection.duplicate",
      "Mod-G": "core.selection.group",
      "Mod-Shift-G": "core.selection.ungroup",
      "Mod-L": "core.selection.toggleLock",
      "Mod-BracketRight": "core.selection.bringForward",
      "Mod-Shift-BracketRight": "core.selection.bringFront",
      "Mod-BracketLeft": "core.selection.sendBackward",
      "Mod-Shift-BracketLeft": "core.selection.sendBack",
      Delete: "core.selection.delete",
      Backspace: "core.selection.deleteBackspace",
      Escape: "core.selection.clear",
      Enter: "core.text.editSelection",
      "Mod-Equal": "core.view.zoomIn",
      "Mod-Minus": "core.view.zoomOut",
      "Mod-0": "core.view.resetZoom",
      "Mod-1": "core.view.fitAll",
      "Mod-Quote": "core.view.toggleGrid",
      "Mod-F": "core.find.open",
      v: "core.tools.select",
      h: "core.tools.hand",
      p: "core.tools.pen",
      e: "core.tools.eraser",
      t: "core.tools.text",
      n: "core.tools.sticky",
      g: "core.tools.table",
      s: "core.tools.shape",
      c: "core.tools.connector",
    };
    for (const [shortcut, id] of Object.entries(expected)) {
      expect(
        registry.commandForShortcut(shortcut),
        `shortcut ${shortcut}`,
      ).toBe(id);
    }
  });
});
