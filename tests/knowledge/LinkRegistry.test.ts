/**
 * LinkRegistry tests (pack R11.2/R11.6 — law §1.7.8): the manual/plugin
 * link store, the Obsidian-style dangling→auto-resolve resolution, the
 * undoable link commands, the dead-entry filtering at save time and the
 * knowledge-index projections (outgoing rows, backlinks, broken titles)
 * — plus the wire-section round-trip and the plugin allowlist surface
 * (pack R11.10).
 */
import { describe, expect, it, vi } from "vitest";
import { vec2 } from "@/core/geometry/Vec2";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";
import {
  LinkRegistry,
  readLinkEntry,
  readLinksSection,
  resolveLinkTarget,
  type ObjectLinkEntry,
} from "@/core/knowledge/LinkRegistry";
import {
  addManualLinkCommand,
  removeAllManualLinksCommand,
  removeManualLinkCommand,
} from "@/core/commands/LinkCommands";
import { buildKnowledgeIndex } from "@/core/knowledge/KnowledgeIndex";
import { KnowledgeService } from "@/core/knowledge/KnowledgeService";
import { PLUGIN_EVENT_ALLOWLIST } from "@/plugins/host/PluginRuntime";

/** Builds a plain-text text-box fixture. */
function textBox(id: string, text: string, name?: string): TextBoxObjectData {
  return {
    id,
    kind: "textBox",
    position: vec2(0, 0),
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    width: 200,
    height: 60,
    text,
    doc: null,
    sizeMode: "fixed",
    fontSize: 20,
    color: "token://text",
    ...(name === undefined ? {} : { name }),
  };
}

/** Builds one manual link entry fixture. */
function entry(overrides: Partial<ObjectLinkEntry>): ObjectLinkEntry {
  return {
    id: "link-1",
    sourceId: "a",
    targetId: "b",
    targetTitle: "هدف",
    kind: "manual",
    createdAt: 1_000,
    ...overrides,
  };
}

describe("LinkRegistry (§1.7.8 store)", () => {
  it("adds/removes entries and notifies subscribers", () => {
    const registry = new LinkRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    registry.add(entry({}));
    expect(registry.count()).toBe(1);
    expect(registry.outgoingOf("a").length).toBe(1);
    expect(registry.incomingOf("b").length).toBe(1);
    expect(registry.entriesTouching("a").length).toBe(1);

    const removed = registry.remove("link-1");
    expect(removed?.id).toBe("link-1");
    expect(registry.count()).toBe(0);
    expect(registry.remove("link-1")).toBeNull();

    expect(listener.mock.calls.length).toBe(2);
    unsubscribe();
    registry.add(entry({}));
    expect(listener.mock.calls.length).toBe(2);
  });

  it("drains the added/removed diff once (event coalescing)", () => {
    const registry = new LinkRegistry();
    registry.add(entry({ id: "l1" }));
    registry.add(entry({ id: "l2" }));
    registry.remove("l1");
    expect(registry.drainDiff()).toEqual({ added: 2, removed: 1 });
    expect(registry.drainDiff()).toEqual({ added: 0, removed: 0 });
  });

  it("replaceFromSection resets silently (a load is not a mutation)", () => {
    const registry = new LinkRegistry();
    registry.add(entry({ id: "old" }));
    registry.drainDiff();
    registry.replaceFromSection({
      version: 1,
      links: [entry({ id: "new-1" }), entry({ id: "new-2" })],
    });
    expect(registry.count()).toBe(2);
    expect(registry.drainDiff()).toEqual({ added: 0, removed: 0 });
    registry.replaceFromSection(undefined);
    expect(registry.count()).toBe(0);
  });

  it("toSection drops DEAD entries (source gone) but keeps dangling ones", () => {
    const registry = new LinkRegistry();
    registry.add(entry({ id: "live", sourceId: "a", targetId: "b" }));
    registry.add(
      entry({ id: "dead-source", sourceId: "gone", targetId: "b" }),
    );
    registry.add(
      entry({ id: "dead-target", sourceId: "a", targetId: "gone" }),
    );
    registry.add(
      entry({ id: "dangling", sourceId: "a", targetId: null }),
    );
    const section = registry.toSection(new Set(["a", "b"]));
    expect(section.links.map((item) => item.id)).toEqual([
      "live",
      "dangling",
    ]);
  });
});

describe("resolveLinkTarget (dangling → auto-resolve)", () => {
  it("prefers the stored target while it exists", () => {
    const objects = new Set(["b", "z"]);
    const resolved = resolveLinkTarget(
      entry({ targetId: "b", targetTitle: "هدف" }),
      (id) => objects.has(id),
      () => [],
    );
    expect(resolved).toBe("b");
  });

  it("falls back to the title index when the target object is gone", () => {
    const objects = new Set(["a"]);
    const resolved = resolveLinkTarget(
      entry({ targetId: "b", targetTitle: "هدف" }),
      (id) => objects.has(id),
      (key) => (key === "هدف" ? ["z"] : []),
    );
    expect(resolved).toBe("z");
  });

  it("stays dangling when neither the id nor the title resolves", () => {
    const resolved = resolveLinkTarget(
      entry({ targetId: "b", targetTitle: "هیچ‌جا" }),
      () => false,
      () => [],
    );
    expect(resolved).toBeNull();
  });
});

describe("Link commands (one undo step each — R11.6)", () => {
  it("add/remove round-trip through undo/redo exactly", () => {
    const registry = new LinkRegistry();
    const add = addManualLinkCommand(registry, entry({}));
    add.do();
    expect(registry.count()).toBe(1);
    add.undo();
    expect(registry.count()).toBe(0);
    add.redo();
    expect(registry.count()).toBe(1);

    const remove = removeManualLinkCommand(registry, entry({}));
    remove.do();
    expect(registry.count()).toBe(0);
    remove.undo();
    expect(registry.count()).toBe(1);
    remove.redo();
    expect(registry.count()).toBe(0);
  });

  it("removeAllManualLinksCommand removes every manual link of ONE object (composite)", () => {
    const registry = new LinkRegistry();
    registry.add(entry({ id: "l1", sourceId: "a", kind: "manual" }));
    registry.add(entry({ id: "l2", sourceId: "a", kind: "manual" }));
    registry.add(entry({ id: "l3", sourceId: "z", kind: "manual" }));
    registry.add(entry({ id: "l4", sourceId: "a", kind: "plugin" }));

    const command = removeAllManualLinksCommand(registry, "a");
    expect(command).not.toBeNull();
    command?.do();
    expect(registry.outgoingOf("a").map((item) => item.id)).toEqual(["l4"]);
    command?.undo();
    expect(registry.outgoingOf("a").map((item) => item.id).sort()).toEqual([
      "l1",
      "l2",
      "l4",
    ]);
    expect(command).not.toBeNull();

    expect(removeAllManualLinksCommand(registry, "no-links")).toBeNull();
  });
});

describe("Knowledge-index projections of registry links", () => {
  it("folds manual links into outgoing/backlinks with the kind + linkId", () => {
    const objects = [textBox("a", "منبع"), textBox("b", "", "هدف")];
    const links = [entry({ id: "l1", sourceId: "a", targetId: "b" })];
    const index = buildKnowledgeIndex(objects, links);

    const outgoing = index.outgoing.get("a") ?? [];
    expect(outgoing.length).toBe(1);
    expect(outgoing[0]?.kind).toBe("manual");
    expect(outgoing[0]?.linkId).toBe("l1");
    expect(outgoing[0]?.resolvedIds).toEqual(["b"]);

    const backlinks = index.backlinks.get("b") ?? [];
    expect(backlinks.length).toBe(1);
    expect(backlinks[0]?.sourceId).toBe("a");
    expect(backlinks[0]?.kind).toBe("manual");
    expect(index.linkResolution.get("l1")).toBe("b");
  });

  it("a deleted target dangles by title and auto-resolves through it", () => {
    // The target object b is GONE; its title lives on object z.
    const objects = [
      textBox("a", "منبع"),
      textBox("z", "", "هدف"),
    ];
    const links = [entry({ id: "l1", sourceId: "a", targetId: "b" })];
    const index = buildKnowledgeIndex(objects, links);
    expect(index.linkResolution.get("l1")).toBe("z");
    expect((index.backlinks.get("z") ?? []).length).toBe(1);

    // Undo-style: b returns → the id wins again.
    const restored = buildKnowledgeIndex(
      [textBox("a", "منبع"), textBox("z", "", "هدف"), textBox("b", "", "هدف")],
      links,
    );
    expect(restored.linkResolution.get("l1")).toBe("b");
  });

  it("entries whose SOURCE is gone are fully inert (undo-safe)", () => {
    const objects = [textBox("b", "", "هدف")];
    const links = [entry({ id: "l1", sourceId: "a", targetId: "b" })];
    const index = buildKnowledgeIndex(objects, links);
    expect(index.outgoing.get("a")).toBeUndefined();
    expect((index.backlinks.get("b") ?? []).length).toBe(0);
    expect(index.linkResolution.get("l1")).toBeNull();
  });

  it("dangling manual links appear in the broken titles (red rows)", () => {
    const objects = [textBox("a", "منبع")];
    const links = [
      entry({ id: "l1", sourceId: "a", targetId: null, targetTitle: "غایب" }),
    ];
    const index = buildKnowledgeIndex(objects, links);
    const broken = index.brokenTitles.get("غایب") ?? [];
    expect(broken.length).toBe(1);
    expect(broken[0]?.kind).toBe("manual");
  });

  it("the service folds the getLinks seam + resolvedTargetOfLink", () => {
    const objects = [textBox("a", "منبع"), textBox("b", "", "هدف")];
    const links = [entry({ id: "l1", sourceId: "a", targetId: "b" })];
    const service = new KnowledgeService({
      getObjects: () => objects,
      getLinks: () => links,
    });
    service.rebuild();
    expect(service.outgoingOf("a").length).toBe(1);
    expect(service.resolvedTargetOfLink("l1")).toBe("b");
    expect(service.resolvedTargetOfLink("missing")).toBeNull();
  });
});

describe("Wire section (readLinkEntry / readLinksSection)", () => {
  it("round-trips valid entries and skips corrupt rows", () => {
    const section = readLinksSection({
      version: 1,
      links: [
        {
          id: "l1",
          sourceId: "a",
          targetId: "b",
          targetTitle: "هدف",
          kind: "manual",
          label: "برای یادآوری",
          createdAt: 5,
        },
        { id: "", sourceId: "a", targetTitle: "x", kind: "manual" },
        { id: "l2", sourceId: "a", kind: "wiki" },
        "not-an-object",
      ],
    });
    expect(section?.links.length).toBe(1);
    const first = section?.links[0];
    expect(first?.id).toBe("l1");
    expect(first?.label).toBe("برای یادآوری");
    expect(readLinkEntry("nope")).toBeNull();
  });

  it("corrupt/absent sections read as undefined (never a crash)", () => {
    expect(readLinksSection(undefined)).toBeUndefined();
    expect(readLinksSection(null)).toBeUndefined();
    expect(readLinksSection("links")).toBeUndefined();
    expect(readLinksSection({ version: 1 })).toBeUndefined();
    expect(readLinksSection({ links: {} })).toBeUndefined();
  });
});

describe("Plugin allowlist surface (pack R11.10)", () => {
  it("exposes the two new knowledge events to plugins", () => {
    expect(PLUGIN_EVENT_ALLOWLIST).toContain("object:linking-changed");
    expect(PLUGIN_EVENT_ALLOWLIST).toContain("object:properties-changed");
    // The non-domain UI events stay disallowed.
    expect(PLUGIN_EVENT_ALLOWLIST).not.toContain("ui:find-requested");
  });
});
