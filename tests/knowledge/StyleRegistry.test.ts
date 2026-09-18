/**
 * Named-style registry tests (R13.3).
 */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_STYLES,
  EMPTY_STYLES_SECTION,
  StyleRegistry,
  parseStylesSection,
  planStyleApplication,
  planStyleEdit,
} from "@/core/knowledge/StyleRegistry";

describe("StyleRegistry (R13.3)", () => {
  it("ships the read-only built-ins (theme headings + default pair)", () => {
    expect(BUILTIN_STYLES.length).toBeGreaterThanOrEqual(5);
    expect(BUILTIN_STYLES.every((style) => style.builtin)).toBe(true);
    expect(BUILTIN_STYLES.map((style) => style.id)).toContain(
      "core.text.body",
    );
    expect(BUILTIN_STYLES.map((style) => style.id)).toContain(
      "core.color.default",
    );
  });

  it("rejects upserts of built-in ids (read-only)", () => {
    const registry = new StyleRegistry();
    const result = registry.upsertUserStyle({
      id: "core.text.body",
      kind: "text",
      name: "override",
      builtin: true,
      def: { fontSize: 99 },
    });
    expect(result).toBeNull();
    expect(registry.byId("core.text.body")?.name).toBe("متن بدنه");
  });

  it("creates, lists and deletes user styles with fresh ids", () => {
    const registry = new StyleRegistry();
    const first = registry.nextUserId("text");
    expect(first).toBe("user.text.1");
    registry.upsertUserStyle({
      id: first,
      kind: "text",
      name: "یادداشت جلسه",
      builtin: false,
      def: { fontSize: 16, fontWeight: 400 },
    });
    expect(registry.nextUserId("text")).toBe("user.text.2");
    expect(registry.list().some((style) => style.name === "یادداشت جلسه"))
      .toBe(true);
    expect(registry.deleteUserStyle(first)).toBe(true);
    expect(registry.deleteUserStyle(first)).toBe(false);
  });

  it("notifies subscribers on every mutation", () => {
    const registry = new StyleRegistry();
    let changes = 0;
    const stop = registry.subscribe(() => {
      changes += 1;
    });
    registry.upsertUserStyle({
      id: "user.text.1",
      kind: "text",
      name: "a",
      builtin: false,
      def: { fontSize: 20 },
    });
    registry.deleteUserStyle("user.text.1");
    stop();
    registry.upsertUserStyle({
      id: "user.text.2",
      kind: "text",
      name: "b",
      builtin: false,
      def: { fontSize: 20 },
    });
    expect(changes).toBe(2);
  });

  it("round-trips the persisted section (user styles only)", () => {
    const registry = new StyleRegistry();
    registry.upsertUserStyle({
      id: "user.color.1",
      kind: "color",
      name: "فیروزه",
      builtin: false,
      def: { fill: "#22d3ee", stroke: "#0e7490" },
    });
    const section = registry.toSection();
    expect(section.version).toBe(1);
    expect(section.styles.length).toBe(1);

    const second = new StyleRegistry();
    let changed = false;
    second.subscribe(() => {
      changed = true;
    });
    second.replaceFromSection(section);
    expect(second.byId("user.color.1")?.name).toBe("فیروزه");
    expect(changed).toBe(true);
    // Built-ins never come from the file.
    expect(second.list().filter((style) => style.builtin).length).toBe(
      BUILTIN_STYLES.length,
    );
  });

  it("parses sections defensively (malformed entries skip, envelope refuses)", () => {
    expect(parseStylesSection(null)).toBeNull();
    expect(parseStylesSection({ version: 2, styles: [] })).toBeNull();
    const parsed = parseStylesSection({
      version: 1,
      styles: [
        { id: "user.text.1", kind: "text", name: "ok", def: { fontSize: 18 } },
        { id: "", kind: "text", name: "bad", def: { fontSize: 18 } },
        { id: "user.text.2", kind: "weird", name: "bad", def: {} },
        { id: "user.text.3", kind: "text", name: "bad", def: {} },
        "not-an-object",
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.styles.length).toBe(1);
    expect(EMPTY_STYLES_SECTION.styles.length).toBe(0);
  });

  it("plans ONE application: styleId + the stamped fields", () => {
    const patches = planStyleApplication(
      {
        id: "core.text.title",
        kind: "text",
        name: "سرتیتر",
        builtin: true,
        def: { fontSize: 36, fontWeight: 700 },
      },
      [{ id: "a" }, { id: "b" }],
    );
    expect(patches).toEqual([
      { objectId: "a", field: "styleId", value: "core.text.title" },
      { objectId: "a", field: "fontSize", value: 36 },
      { objectId: "a", field: "fontWeight", value: 700 },
      { objectId: "b", field: "styleId", value: "core.text.title" },
      { objectId: "b", field: "fontSize", value: 36 },
      { objectId: "b", field: "fontWeight", value: 700 },
    ]);
  });
});

describe("planStyleEdit override guard (AC13.4)", () => {
  const oldStyle = {
    id: "user.text.1",
    kind: "text" as const,
    name: "x",
    builtin: false,
    def: { fontSize: 20, fontWeight: 400 },
  };
  const newStyle = {
    ...oldStyle,
    def: { fontSize: 24, fontWeight: 700 },
  };

  it("restamps usages that still carry the old values", () => {
    const patches = planStyleEdit(oldStyle, newStyle, [
      { id: "a", styleId: "user.text.1", fontSize: 20, fontWeight: 400 },
    ]);
    expect(patches).toEqual([
      { objectId: "a", field: "fontSize", value: 24 },
      { objectId: "a", field: "fontWeight", value: 700 },
    ]);
  });

  it("keeps LOCAL OVERRIDES (fields the user changed stay)", () => {
    const patches = planStyleEdit(oldStyle, newStyle, [
      { id: "a", styleId: "user.text.1", fontSize: 18, fontWeight: 400 },
    ]);
    expect(patches).toEqual([
      { objectId: "a", field: "fontWeight", value: 700 },
    ]);
  });

  it("ignores objects that reference another style", () => {
    const patches = planStyleEdit(oldStyle, newStyle, [
      { id: "a", styleId: "core.text.body", fontSize: 20 },
    ]);
    expect(patches).toEqual([]);
  });
});
