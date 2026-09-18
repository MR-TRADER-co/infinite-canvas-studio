/**
 * Property-schema store tests (pack R11.3): first-use inference,
 * explicit assignment, section round-trip and the subscription contract.
 */
import { describe, expect, it } from "vitest";
import { PropertySchemaStore } from "@/core/knowledge/PropertySchemaStore";
import {
  EMPTY_PROPERTY_SCHEMA_SECTION,
  TAGS_PROPERTY,
} from "@/core/model/Properties";

describe("PropertySchemaStore", () => {
  it("starts empty and infers unknown names from their first value", () => {
    const store = new PropertySchemaStore();
    expect(store.names()).toEqual([]);
    expect(store.inferField("owner", "سارا")).toBe(true);
    expect(store.inferField("priority", 3)).toBe(true);
    expect(store.inferField(TAGS_PROPERTY, ["مهم"])).toBe(true);
    expect(store.field("owner")).toEqual({ type: "text" });
    expect(store.field("priority")).toEqual({ type: "number" });
    expect(store.field(TAGS_PROPERTY)).toEqual({ type: "tags" });
  });

  it("never re-infers a known name (explicit assignment wins)", () => {
    const store = new PropertySchemaStore();
    store.setField("status", "select", ["TODO", "done"]);
    expect(store.inferField("status", "plain text now")).toBe(false);
    expect(store.field("status")).toEqual({
      type: "select",
      options: ["TODO", "done"],
    });
  });

  it("setField ignores empty names and drops options for non-select", () => {
    const store = new PropertySchemaStore();
    expect(store.setField("   ", "text")).toBe(false);
    store.setField("owner", "text", ["ignored"]);
    expect(store.field("owner")).toEqual({ type: "text" });
  });

  it("date names infer as date even with text values", () => {
    const store = new PropertySchemaStore();
    store.inferField("deadline", "هر وقت");
    expect(store.field("deadline")).toEqual({ type: "date" });
  });

  it("round-trips through the persisted section", () => {
    const store = new PropertySchemaStore();
    store.setField("status", "select", ["TODO", "doing", "done"]);
    store.inferField("owner", "x");
    const section = store.toSection();
    const revived = new PropertySchemaStore();
    revived.replaceFromSection(section);
    expect(revived.field("status")).toEqual({
      type: "select",
      options: ["TODO", "doing", "done"],
    });
    expect(revived.field("owner")).toEqual({ type: "text" });
    expect(revived.names()).toEqual(["status", "owner"]);
  });

  it("empty stores snapshot to the shared empty section", () => {
    const store = new PropertySchemaStore();
    expect(store.toSection()).toBe(EMPTY_PROPERTY_SCHEMA_SECTION);
  });

  it("replaceFromSection drops invalid entries defensively", () => {
    const store = new PropertySchemaStore();
    store.replaceFromSection({
      version: 1,
      fields: {
        ok: { type: "number" },
        bad: { type: "nope" },
        "": { type: "text" },
      },
    } as unknown as Parameters<PropertySchemaStore["replaceFromSection"]>[0]);
    expect(store.names()).toEqual(["ok"]);
  });

  it("deleteField forgets and later use re-infers", () => {
    const store = new PropertySchemaStore();
    store.setField("priority", "number");
    expect(store.deleteField("priority")).toBe(true);
    expect(store.field("priority")).toBeNull();
    store.inferField("priority", "high");
    expect(store.field("priority")).toEqual({ type: "text" });
  });

  it("notifies subscribers on demand (the batched-mutation contract)", () => {
    const store = new PropertySchemaStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.inferField("owner", "x");
    store.notify();
    expect(calls).toBe(1);
    unsubscribe();
    store.notify();
    expect(calls).toBe(1);
  });
});
