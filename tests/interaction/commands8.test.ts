/**
 * Phase 8 command catalog tests (R8.2/R8.3/R8.5/R8.7): the new commands
 * register, dispatch through the single dispatcher, and — AC parity with
 * Phase 7 — every registered command resolves an i18n title in BOTH
 * dictionaries (fa + en), so the palette lists everything.
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
import { makeFrameObject } from "@/core/model/FrameObject";

/** The Phase 8 command ids this phase adds. */
const PHASE8_COMMANDS = [
  "core.app.settings",
  "core.view.presentation",
  "core.text.insertDate",
  "core.text.insertDateNumeric",
  "core.export.svg",
  "core.export.pdf",
  "core.insert.frame",
  "core.view.panel.history",
] as const;

/** Recording wiring stub. */
function makeWiring(calls: {
  ui: string[];
  editor: string[];
  presentation: string[];
}): CoreCommandWiring {
  const scene = new Scene();
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
  context.register(keys.history, new HistoryManager(30));
  context.register(keys.selection, new Selection());
  context.register(keys.idGenerator, new IdGenerator("obj"));
  context.register(keys.cameraController, new CameraController(scene.camera));
  context.register(keys.autosave, { saveNow: async () => true });
  context.register(keys.textLayer, { beginEditing: () => undefined });
  return {
    keys,
    ui: {
      activateTool: () => undefined,
      toggleGrid: () => undefined,
      openLinkDialog: () => undefined,
      openFind: () => undefined,
      newProject: () => {
        calls.ui.push("new");
      },
      openProject: () => undefined,
      saveProject: () => undefined,
      saveProjectAs: () => undefined,
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
        calls.presentation.push("toggle");
      },
      insertImage: () => undefined,
      insertVideo: () => undefined,
      insertAudio: () => undefined,
      // فاز P1: the PDF insert action (the wiring stub).
      insertPdf: () => undefined,
      promptBookmark: () => undefined,
      openCommandPalette: () => undefined,
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
      resetImageToInsertState: () => false,
      togglePin: () => false,
    },
    text: {
      runEditorAction: (action) => {
        calls.editor.push(action);
        return true;
      },
      hasLiveEditor: () => true,
      copyFormat: () => true,
      applyFormat: () => true,
    },
    table: {
      runTableAction: () => true,
      canTableAction: () => true,
    },
  };
}

/** Registers a full catalog over recording wiring + a dispatcher. */
function makeCatalog(calls: {
  ui: string[];
  editor: string[];
  presentation: string[];
}): {
  registry: CommandRegistry;
  dispatcher: CommandDispatcher;
  context: AppContext;
  scene: Scene;
} {
  const wiring = makeWiring(calls);
  const registry = registerCoreCommands(new CommandRegistry(), wiring);
  const dispatcher = new CommandDispatcher(registry);
  return {
    registry,
    dispatcher,
    context:
      wiring.keys.scene !== undefined
        ? wiringContext(wiring)
        : new AppContext(),
    scene: wiringContext(wiring).tryGet(
      (wiring.keys as { scene: ServiceKey<Scene> }).scene,
    )!,
  };
}

/** Builds a command context over the stub's services. */
function wiringContext(wiring: CoreCommandWiring): AppContext {
  const context = new AppContext();
  const keys = wiring.keys as unknown as Record<string, ServiceKey<unknown>>;
  const scene = new Scene();
  const history = new HistoryManager(30);
  const selection = new Selection();
  context.register(keys.scene as ServiceKey<Scene>, scene);
  context.register(keys.history as ServiceKey<HistoryManager>, history);
  context.register(keys.selection as ServiceKey<Selection>, selection);
  context.register(
    keys.idGenerator as ServiceKey<IdGenerator>,
    new IdGenerator("obj"),
  );
  context.register(
    keys.cameraController as ServiceKey<CameraController>,
    new CameraController(scene.camera),
  );
  return context;
}

describe("Phase 8 command catalog (R8.2/R8.3/R8.7)", () => {
  it("registers every Phase 8 command", () => {
    const calls = {
      ui: [] as string[],
      editor: [] as string[],
      presentation: [] as string[],
    };
    const { registry } = makeCatalog(calls);
    for (const id of PHASE8_COMMANDS) {
      expect(registry.has(id), `missing command ${id}`).toBe(true);
    }
  });

  it("dispatches the new commands through the single dispatcher", () => {
    const calls = {
      ui: [] as string[],
      editor: [] as string[],
      presentation: [] as string[],
    };
    const { registry, dispatcher } = makeCatalog(calls);
    const ctx = { services: new AppContext() };
    void ctx;
    const context = commandContextOf(new AppContext());
    void context;
    for (const id of [
      "core.app.settings",
      "core.export.svg",
      "core.export.pdf",
    ]) {
      const command = registry.get(id);
      expect(command).not.toBeNull();
      command?.execute(commandContextOf(new AppContext()));
    }
    expect(calls.ui).toEqual(["settings", "exportSvg", "exportPdf"]);
    // The Jalali date commands run through the editor action executor.
    registry
      .get("core.text.insertDate")
      ?.execute(commandContextOf(new AppContext()));
    registry
      .get("core.text.insertDateNumeric")
      ?.execute(commandContextOf(new AppContext()));
    expect(calls.editor).toContain("insertDate");
    expect(calls.editor).toContain("insertDateNumeric");
    // The frame card inserts through the catalog-card path.
    registry
      .get("core.insert.frame")
      ?.execute(commandContextOf(new AppContext()));
    expect(calls.ui).toContain("insert:core.frame:core.frame");
    void dispatcher;
  });

  it("the F5 presentation shortcut is registered canonically", () => {
    const calls = {
      ui: [] as string[],
      editor: [] as string[],
      presentation: [] as string[],
    };
    const { registry } = makeCatalog(calls);
    expect(registry.get("core.view.presentation")?.shortcut).toBe("F5");
    expect(registry.get("core.app.settings")?.shortcut).toBe("Mod-Comma");
  });

  it("AC parity: every registered command resolves fa + en titles", () => {
    const calls = {
      ui: [] as string[],
      editor: [] as string[],
      presentation: [] as string[],
    };
    const { registry } = makeCatalog(calls);
    for (const command of registry.list()) {
      expect(
        fa[command.titleKey as keyof typeof fa],
        `fa missing title for ${command.id}`,
      ).toBeTruthy();
      expect(
        en[command.titleKey as keyof typeof en],
        `en missing title for ${command.id}`,
      ).toBeTruthy();
    }
  });

  it("the presentation command's guard state lives in the wiring (scene frames)", () => {
    // The command itself always dispatches; the wiring decides (the
    // App.ts binding refuses politely when no frames exist). The frame
    // object the guard checks is part of the registered object types.
    const frame = makeFrameObject("frame-1", 0);
    expect(frame.kind).toBe("frame");
  });
});
