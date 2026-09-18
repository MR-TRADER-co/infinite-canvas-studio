/**
 * Table command catalog tests (R6.1–R6.4 / AC6.7): EVERY table menu
 * action exists as a registered command in the CommandRegistry, dispatch
 * flows through the wiring's table executor, the enabled state consults
 * canTableAction, and the direction-aware VISUAL column ids
 * (insertColumnLeft/Right) carry their own actions.
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
  TableAction,
  ToolCommandId,
} from "@/interaction/dispatch/commands";
import type { Scene } from "@/core/model/Scene";
import type { Selection } from "@/core/selection/Selection";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { IdGenerator } from "@/core/id/IdGenerator";
import type { CameraController } from "@/core/camera/CameraController";
import type { LinkRegistry } from "@/core/knowledge/LinkRegistry";
import type { KnowledgeService } from "@/core/knowledge/KnowledgeService";

/** Structural stand-ins for the command catalog's service contracts. */
type AutosaveServiceLike = {
  saveNow: (reason?: "auto" | "manual" | "flush") => Promise<boolean>;
};
type TextLayerLike = { beginEditing: (id: string) => void };

/** Service keys mirroring the composition root's (types only). */
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

/** A wiring that records table actions and toggles availability. */
function makeWiring(
  calls: TableAction[],
  available: boolean,
): CoreCommandWiring {
  return {
    keys,
    ui: {
      activateTool: (tool: ToolCommandId) => void tool,
      toggleGrid: () => undefined,
      openLinkDialog: () => undefined,
      openFind: () => undefined,
      newProject: () => undefined,
      openProject: () => undefined,
      saveProject: () => undefined,
      saveProjectAs: () => undefined,
      openExportPng: () => undefined,
      openExportSvg: () => undefined,
      openExportPdf: () => undefined,
      exportWord: () => undefined,
      openSettings: () => undefined,
      openStickerPicker: () => undefined,
      togglePresentation: () => undefined,
      insertImage: () => undefined,
      insertVideo: () => undefined,
      insertAudio: () => undefined,
      // فاز P1: the PDF insert action (the wiring stub).
      insertPdf: () => undefined,
      promptBookmark: () => undefined,
      openCommandPalette: () => undefined,
      togglePanel: () => undefined,
      insertCard: () => undefined,
      openMarkdownDialog: () => undefined,
      copyDeepLink: () => undefined,
      openLinkPicker: () => undefined,
      arrangeKnowledgeGraph: () => undefined,
      toggleKnowledgeEdges: () => undefined,
      copySelection: () => undefined,
      cutSelection: () => undefined,
      pasteFromClipboard: () => undefined,
      copyImageToSystem: () => undefined,
      copySelectionAsImage: () => undefined,
      resetImageToNatural: () => false,
      resetImageToInsertState: () => false,
      togglePin: () => false,
    },
    text: {
      runEditorAction: () => true,
      hasLiveEditor: () => true,
      copyFormat: () => true,
      applyFormat: () => true,
    },
    table: {
      runTableAction: (action: TableAction) => {
        calls.push(action);
        return true;
      },
      // Mirrors the composition root: `insert` stays always-available
      // (R6.1 — it can create a fresh table object with nothing open).
      canTableAction: (action: TableAction) =>
        action === "insert" ? true : available,
    },
  };
}

/** A locator stub (no services needed — the wiring absorbs execution). */
const emptyLocator = {
  tryGet: <T>(_key: ServiceKey<T>): T | undefined => undefined,
};

/** Every table command the R6.2 menu requires (AC6.7). */
const TABLE_COMMAND_IDS: readonly string[] = [
  "core.table.insert",
  "core.table.insertRowAbove",
  "core.table.insertRowBelow",
  "core.table.deleteRow",
  "core.table.insertColumnLeft",
  "core.table.insertColumnRight",
  "core.table.deleteColumn",
  "core.table.deleteTable",
  "core.table.mergeCells",
  "core.table.splitCellHorizontal",
  "core.table.splitCellVertical",
  "core.table.toggleHeaderRow",
  "core.table.toggleHeaderColumn",
  "core.table.toggleDirection",
  "core.table.distributeColumns",
  "core.table.alignCellTop",
  "core.table.alignCellMiddle",
  "core.table.alignCellBottom",
  "core.table.preset.classic",
  "core.table.preset.minimal",
  "core.table.preset.zebra",
  "core.table.preset.soft",
  "core.table.preset.grid",
  "core.table.preset.dark",
];

/** Maps command id → the table action the wiring must receive. */
const ID_TO_ACTION: Readonly<Record<string, TableAction>> = {
  "core.table.insert": "insert",
  "core.table.insertRowAbove": "insertRowAbove",
  "core.table.insertRowBelow": "insertRowBelow",
  "core.table.deleteRow": "deleteRow",
  "core.table.insertColumnLeft": "insertColumnLeft",
  "core.table.insertColumnRight": "insertColumnRight",
  "core.table.deleteColumn": "deleteColumn",
  "core.table.deleteTable": "deleteTable",
  "core.table.mergeCells": "mergeCells",
  "core.table.splitCellHorizontal": "splitCellHorizontal",
  "core.table.splitCellVertical": "splitCellVertical",
  "core.table.toggleHeaderRow": "toggleHeaderRow",
  "core.table.toggleHeaderColumn": "toggleHeaderColumn",
  "core.table.toggleDirection": "toggleDirection",
  "core.table.distributeColumns": "distributeColumns",
  "core.table.alignCellTop": "alignCellTop",
  "core.table.alignCellMiddle": "alignCellMiddle",
  "core.table.alignCellBottom": "alignCellBottom",
  "core.table.preset.classic": "preset:classic",
  "core.table.preset.minimal": "preset:minimal",
  "core.table.preset.zebra": "preset:zebra",
  "core.table.preset.soft": "preset:soft",
  "core.table.preset.grid": "preset:grid",
  "core.table.preset.dark": "preset:dark",
};

describe("the table command family (AC6.7 — every menu action a command)", () => {
  it("registers every table command conflict-free under core.table.*", () => {
    const registry = new CommandRegistry();
    expect(() =>
      registerCoreCommands(registry, makeWiring([], true)),
    ).not.toThrow();
    for (const id of TABLE_COMMAND_IDS) {
      expect(registry.has(id), id).toBe(true);
    }
    for (const id of registry.ids()) {
      // Id scheme: core.table.* commands all carry the table group.
      if (id.startsWith("core.table.")) {
        expect(registry.get(id)?.group).toBe("table");
      }
    }
  });

  it("dispatching every table command executes its wiring action", () => {
    const calls: TableAction[] = [];
    const registry = new CommandRegistry();
    registerCoreCommands(registry, makeWiring(calls, true));
    const dispatcher = new CommandDispatcher(registry);
    const context = commandContextOf(emptyLocator);
    for (const id of TABLE_COMMAND_IDS) {
      const ran = dispatcher.dispatch(id, context);
      expect(ran, id).toBe(true);
    }
    expect(calls).toEqual(TABLE_COMMAND_IDS.map((id) => ID_TO_ACTION[id]));
  });

  it("disabled table commands refuse to execute (menu gray-out source)", () => {
    const calls: TableAction[] = [];
    const registry = new CommandRegistry();
    registerCoreCommands(registry, makeWiring(calls, false));
    const dispatcher = new CommandDispatcher(registry);
    const context = commandContextOf(emptyLocator);
    // structural probe: a disabled action neither runs nor records.
    expect(dispatcher.dispatch("core.table.mergeCells", context)).toBe(false);
    expect(calls).toEqual([]);
    // insert stays always-available (R6.1: it can create a fresh object).
    expect(dispatcher.dispatch("core.table.insert", context)).toBe(true);
    expect(calls).toEqual(["insert"]);
  });

  it("the direction-aware visual column ids are distinct commands", () => {
    const registry = new CommandRegistry();
    registerCoreCommands(registry, makeWiring([], true));
    const left = registry.get("core.table.insertColumnLeft");
    const right = registry.get("core.table.insertColumnRight");
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(left?.titleKey).toBe("table.insertColumnLeft");
    expect(right?.titleKey).toBe("table.insertColumnRight");
  });
});
