/**
 * Knowledge-service tests (Knowledge Pack, pack-Phase-11 rebuild): the
 * live index holder — rebuilds from the injected objects seam,
 * subscription fan-out and the query surface.
 */
import { describe, expect, it, vi } from "vitest";
import { KnowledgeService } from "@/core/knowledge/KnowledgeService";
import { vec2 } from "@/core/geometry/Vec2";
import type { TextBoxObjectData } from "@/core/model/TextBoxObject";

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

describe("KnowledgeService", () => {
  it("starts EMPTY and rebuild() builds the first index", () => {
    const service = new KnowledgeService({ getObjects: () => [] });
    expect(service.current().titles.size).toBe(0);
    expect(service.stats().links).toBe(0);
    service.rebuild();
    expect(service.currentVersion()).toBe(1);
  });

  it("rebuilds from the LIVE objects seam (changes picked up)", () => {
    let objects = [textBox("a", "مرجع [[هدف]]")];
    const service = new KnowledgeService({ getObjects: () => objects });
    service.rebuild();
    expect(service.outgoingOf("a").length).toBe(1);
    expect(service.stats().broken).toBe(1);

    objects = [textBox("a", "مرجع [[هدف]]"), textBox("b", "", "هدف")];
    service.rebuild();
    expect(service.stats().broken).toBe(0);
    expect(service.backlinksOf("b").length).toBe(1);
  });

  it("notifies subscribers on every rebuild (and stops after unsubscribe)", () => {
    const service = new KnowledgeService({ getObjects: () => [] });
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    service.rebuild();
    service.rebuild();
    expect(listener.mock.calls.length).toBe(2);
    unsubscribe();
    service.rebuild();
    expect(listener.mock.calls.length).toBe(2);
  });

  it("answers the query surface (titles, outgoing, backlinks, tags)", () => {
    const service = new KnowledgeService({
      getObjects: () => [
        textBox("src", "پیوند به [[مقصد]] با #برچسب"),
        textBox("dst", "", "مقصد"),
      ],
    });
    service.rebuild();

    expect(service.titleOf("dst")?.display).toBe("مقصد");
    expect(service.titleOf("missing")).toBeNull();

    const out = service.outgoingOf("src");
    expect(out.length).toBe(1);
    expect(out[0]?.resolvedIds).toEqual(["dst"]);
    expect(service.outgoingOf("dst")).toEqual([]);

    expect(service.backlinksOf("dst").length).toBe(1);
    expect(service.backlinksOf("src")).toEqual([]);

    expect(service.tagsOf("src")).toEqual(["برچسب"]);
    expect(service.allTags().length).toBe(1);
    expect(service.allTags()[0]?.objectIds).toEqual(["src"]);

    expect(service.resolveTitle("مقصد")).toEqual(["dst"]);
    expect(service.tag("برچسب")?.display).toBe("برچسب");
  });

  it("reports aggregate stats", () => {
    const service = new KnowledgeService({
      getObjects: () => [
        textBox("a", "[[تنها]] #تنها"),
        textBox("b", "تنها عنوان", "تنها"),
      ],
    });
    service.rebuild();
    const stats = service.stats();
    expect(stats.titles).toBe(1);
    expect(stats.links).toBe(1);
    expect(stats.backlinks).toBe(1);
    expect(stats.broken).toBe(0);
    expect(stats.tags).toBe(1);
  });

  it("counts broken titles in stats", () => {
    const service = new KnowledgeService({
      getObjects: () => [textBox("a", "[[نبود]] و [[نیست]]")],
    });
    service.rebuild();
    const stats = service.stats();
    expect(stats.broken).toBe(2);
    expect(stats.backlinks).toBe(0);
  });
});
