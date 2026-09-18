/**
 * Phase 7 command catalog tests (R7.3/R7.5/R7.9/R7.11/R7.12): every new
 * command registers, dispatches through the single dispatcher, honours
 * its enabled state, and — AC7.12 — the PALETTE surface is complete:
 * every registered command exists with a resolvable i18n title in BOTH
 * dictionaries (fa + en), so the palette (which renders FROM the
 * CommandRegistry only) lists everything.
 */
import { describe, expect, it } from "vitest";
import { CommandRegistry } from "@/core/registry/CommandRegistry";
import { registerCoreCommands } from "@/interaction/dispatch/commands";
import type { CoreCommandWiring } from "@/interaction/dispatch/commands";
import { CommandDispatcher } from "@/interaction/dispatch/CommandDispatcher";
import { commandContextOf } from "@/interaction/dispatch/CommandDispatcher";
import { AppContext, ServiceKey } from "@/AppContext";
import { Scene } from "@/core/model/Scene";
import { HistoryManager } from "@/core/history/HistoryManager";
import { Selection } from "@/core/selection/Selection";
import { IdGenerator } from "@/core/id/IdGenerator";
import { CameraController } from "@/core/camera/CameraController";
import { LinkRegistry } from "@/core/knowledge/LinkRegistry";
import type { KnowledgeService } from "@/core/knowledge/KnowledgeService";
import { fa } from "@/ui/i18n/fa";
import { en } from "@/ui/i18n/en";
import { makeShape } from "../core/commands/fixtures";

/** Recording wiring stub + the live services it exposes for assertions. */
interface WiringStub extends CoreCommandWiring {
  readonly context: AppContext;
  readonly scene: Scene;
  readonly history: HistoryManager;
  readonly selection: Selection;
}

/** Recording wiring stub. */
function makeWiring(calls: { ui: string[]; editor: string[] }): WiringStub {
  const scene = new Scene();
  const selection = new Selection();
  const history = new HistoryManager(30);
  const keys = {
    scene: ServiceKey.create<Scene>("scene"),
    history: ServiceKey.create<HistoryManager>("history"),
    selection: ServiceKey.create<Selection>("selection"),
    idGenerator: ServiceKey.create<IdGenerator>("ids"),
    cameraController: ServiceKey.create<CameraController>("camera"),
    autosave: ServiceKey.create<{ saveNow: () => Promise<boolean> }>(
      "autosave",
    ),
    textLayer: ServiceKey.create<{ beginEditing: (id: string) => void }>(
      "textLayer",
    ),
    links: ServiceKey.create<LinkRegistry>("links"),
    knowledge: ServiceKey.create<KnowledgeService>("knowledge"),
  };
  const context = new AppContext();
  context.register(keys.scene, scene);
  context.register(keys.history, history);
  context.register(keys.selection, selection);
  context.register(keys.idGenerator, new IdGenerator("obj"));
  context.register(keys.cameraController, new CameraController(scene.camera));
  context.register(keys.autosave, { saveNow: async () => true });
  context.register(keys.textLayer, { beginEditing: () => undefined });
  return {
    keys,
    context,
    ui: {
      activateTool: () => undefined,
      toggleGrid: () => undefined,
      openLinkDialog: () => undefined,
      openFind: () => undefined,
      newProject: () => undefined,
      openProject: () => undefined,
      saveProject: () => undefined,
      saveProjectAs: () => undefined,
      openExportPng: () => undefined,
      insertImage: () => {
        calls.ui.push("insertImage");
      },
      promptBookmark: () => {
        calls.ui.push("bookmark");
      },
      openCommandPalette: () => {
        calls.ui.push("palette");
      },
      togglePanel: (panelId: string) => {
        calls.ui.push(`panel:${panelId}`);
      },
      insertCard: (typeId: string, cardKey: string) => {
        calls.ui.push(`insert:${typeId}:${cardKey}`);
      },
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
      togglePin: () => false,
    },
    text: {
      runEditorAction: () => true,
      hasLiveEditor: () => false,
      copyFormat: () => {
        calls.editor.push("copy");
        return true;
      },
      applyFormat: () => {
        calls.editor.push("apply");
        return true;
      },
    },
    table: {
      runTableAction: () => true,
      canTableAction: () => true,
    },
    scene,
    selection,
    history,
  } as unknown as WiringStub;
}

/** Registers a full catalog over recording wiring + a dispatcher. */
function makeCatalog(calls: { ui: string[]; editor: string[] }): {
  registry: CommandRegistry;
  dispatcher: CommandDispatcher;
  context: AppContext;
} {
  const wiring = makeWiring(calls);
  const registry = registerCoreCommands(new CommandRegistry(), wiring);
  const dispatcher = new CommandDispatcher(registry);
  return {
    registry,
    dispatcher,
    context: wiring.context,
  };
}

/** The Phase 7 command ids this phase adds. */
const PHASE7_COMMANDS = [
  "core.selection.alignleft",
  "core.selection.aligncenterHorizontal",
  "core.selection.alignright",
  "core.selection.aligntop",
  "core.selection.alignmiddle",
  "core.selection.alignbottom",
  "core.selection.distributeHorizontal",
  "core.selection.distributeVertical",
  "core.text.formatPainterCopy",
  "core.text.formatPainterApply",
  "core.view.addBookmark",
  "core.view.commandPalette",
  "core.view.panel.layers",
  "core.view.panel.inspector",
  "core.view.panel.search",
  "core.view.panel.outline",
  "core.view.panel.minimap",
  "core.view.panel.insert",
  "core.insert.rectangle",
  "core.insert.ellipse",
  "core.insert.text",
  "core.insert.sticky",
  "core.insert.connector",
  "core.insert.pen",
] as const;

describe("Phase 7 command catalog (R7.3/R7.5/R7.9/R7.11/R7.12)", () => {
  it("registers every Phase 7 command", () => {
    const calls = { ui: [] as string[], editor: [] as string[] };
    const { registry } = makeCatalog(calls);
    for (const id of PHASE7_COMMANDS) {
      expect(registry.has(id), `missing command ${id}`).toBe(true);
    }
  });

  it("carries the spec shortcuts (Ctrl+Shift+B, Ctrl+K, Ctrl+Shift+C/V)", () => {
    const calls = { ui: [] as string[], editor: [] as string[] };
    const { registry } = makeCatalog(calls);
    expect(registry.commandForShortcut("Mod-Shift-B")).toBe(
      "core.view.addBookmark",
    );
    expect(registry.commandForShortcut("Mod-K")).toBe(
      "core.view.commandPalette",
    );
    expect(registry.commandForShortcut("Mod-Shift-C")).toBe(
      "core.text.formatPainterCopy",
    );
    expect(registry.commandForShortcut("Mod-Shift-V")).toBe(
      "core.text.formatPainterApply",
    );
  });

  it("align commands move a real selection through the dispatcher", () => {
    const calls = { ui: [] as string[], editor: [] as string[] };
    const wiring = makeWiring(calls);
    const registry = registerCoreCommands(new CommandRegistry(), wiring);
    const dispatcher = new CommandDispatcher(registry);
    const context = wiring.context;
    const scene = wiring.scene;
    scene.add(makeShape("a", 0, 0, 100, 50));
    scene.add(makeShape("b", 300, 40, 80, 40));
    wiring.selection.replaceAll(["a", "b"]);

    const alignLeft = registry.get("core.selection.alignleft");
    expect(alignLeft?.isEnabled?.(commandContextOf(context))).toBe(true);
    expect(
      dispatcher.dispatch(
        "core.selection.alignleft",
        commandContextOf(context),
      ),
    ).toBe(true);
    const moved = scene.findById("b");
    expect(moved?.position.x).toBeCloseTo(0, 6);
    // One undo step restores.
    wiring.history.undo();
    expect(scene.findById("b")?.position.x).toBeCloseTo(300, 6);

    // Distribute stays disabled below 3 selected.
    const distribute = registry.get("core.selection.distributeHorizontal");
    expect(distribute?.isEnabled?.(commandContextOf(context))).toBe(false);
  });

  it("panel toggles, palette, bookmark prompt and insert cards dispatch", () => {
    const calls = { ui: [] as string[], editor: [] as string[] };
    const wiring = makeWiring(calls);
    const registry = registerCoreCommands(new CommandRegistry(), wiring);
    const dispatcher = new CommandDispatcher(registry);
    const ctx = commandContextOf(wiring.context);
    dispatcher.dispatch("core.view.panel.layers", ctx);
    dispatcher.dispatch("core.view.commandPalette", ctx);
    dispatcher.dispatch("core.view.addBookmark", ctx);
    dispatcher.dispatch("core.insert.rectangle", ctx);
    dispatcher.dispatch("core.insert.pen", ctx);
    expect(calls.ui).toEqual([
      "panel:core.panels.layers",
      "palette",
      "bookmark",
      "insert:core.shape:rectangle",
      "insert:core.freehand:core.freehand",
    ]);
  });

  it("AC7.12 palette completeness: every command titleKey resolves in fa AND en", () => {
    const calls = { ui: [] as string[], editor: [] as string[] };
    const { registry } = makeCatalog(calls);
    for (const entry of registry.list()) {
      expect(
        entry.titleKey in fa,
        `fa missing key "${entry.titleKey}" (command ${entry.id})`,
      ).toBe(true);
      expect(
        entry.titleKey in en,
        `en missing key "${entry.titleKey}" (command ${entry.id})`,
      ).toBe(true);
    }
    // The palette renders exactly this registry surface.
    expect(registry.size).toBeGreaterThan(80);
  });
});
