import { describe, expect, it } from "vitest";
import {
  PluginStorage,
  safeStorage,
  type StorageShim,
} from "@/plugins/host/PluginStorage";
import { memoryStorage } from "@/plugins/host/PluginStore";

describe("Plugin storage (R9.3 / R9.5)", () => {
  it("is in-memory when no storage shim exists (SSR-safe)", () => {
    const storage = new PluginStorage("acme", null);
    expect(safeStorage()).toBeNull();
    storage.set("k", { a: 1 });
    expect(storage.get("k")).toEqual({ a: 1 });
  });

  it("round-trips KV through a shim + re-tracks on reload", () => {
    const shim = memoryStorage();
    const first = new PluginStorage("acme", shim);
    first.set("colour", "#f59e0b");
    first.set("count", 3);
    expect(first.get("colour")).toBe("#f59e0b");
    // A second instance (simulated reload) re-tracks persisted keys.
    const second = new PluginStorage("acme", shim);
    expect(second.get("colour")).toBe("#f59e0b");
    expect(second.get("count")).toBe(3);
    second.delete("count");
    expect(second.get("count")).toBeUndefined();
  });

  it("runs the supported SQL family (create/insert/select/update/delete)", () => {
    const storage = new PluginStorage("acme", memoryStorage());
    const results = storage.sql([
      { sql: "CREATE TABLE IF NOT EXISTS notes (id, text, done)" },
      {
        sql: "INSERT INTO notes (id, text, done) VALUES (?, ?, ?)",
        params: ["n1", "سلام", 0],
      },
      {
        sql: "INSERT INTO notes (id, text, done) VALUES (?, ?, ?)",
        params: ["n2", "دنیا", 1],
      },
    ]);
    expect(results[1]).toMatchObject({ rowsAffected: 1, lastInsertId: 1 });

    const all = storage.sql([{ sql: "SELECT * FROM notes" }])[0] as Record<
      string,
      unknown
    >[];
    expect(all).toHaveLength(2);
    expect(all[0]?.text).toBe("سلام");

    const done = storage.sql([
      { sql: "SELECT * FROM notes WHERE done = ?", params: [1] },
    ])[0] as Record<string, unknown>[];
    expect(done).toHaveLength(1);
    expect(done[0]?.id).toBe("n2");

    const updated = storage.sql([
      {
        sql: "UPDATE notes SET text = ? WHERE id = ?",
        params: ["تغییر", "n1"],
      },
    ])[0] as { rowsAffected: number };
    expect(updated.rowsAffected).toBe(1);
    const after = storage.sql([
      { sql: "SELECT * FROM notes WHERE id = ?", params: ["n1"] },
    ])[0] as Record<string, unknown>[];
    expect(after[0]?.text).toBe("تغییر");

    const removed = storage.sql([
      { sql: "DELETE FROM notes WHERE id = ?", params: ["n2"] },
    ])[0] as { rowsAffected: number };
    expect(removed.rowsAffected).toBe(1);
    expect(storage.sql([{ sql: "SELECT * FROM notes" }])[0]).toHaveLength(1);
  });

  it("throws typed errors on unsupported statements (fail-closed)", () => {
    const storage = new PluginStorage("acme", null);
    expect(() => storage.sql([{ sql: "DROP DATABASE anything" }])).toThrow();
    expect(() =>
      storage.sql([{ sql: "SELECT * FROM t WHERE col LIKE ?" }]),
    ).toThrow();
    expect(() =>
      storage.sql([{ sql: "INSERT INTO t (a) VALUES (?)", params: [1, 2] }]),
    ).toThrow();
  });

  it("namespaces every key per plugin id (isolation)", () => {
    const shim = memoryStorage();
    const a = new PluginStorage("plugin-a", shim);
    const b = new PluginStorage("plugin-b", shim);
    a.set("shared", "از الف");
    b.set("shared", "از ب");
    expect(a.get("shared")).toBe("از الف");
    expect(b.get("shared")).toBe("از ب");
  });

  it("archives + restores the FULL state (AC9.7)", () => {
    const shim = memoryStorage();
    const original = new PluginStorage("acme", shim);
    original.set("colour", "#ef4444");
    original.sql([
      { sql: "CREATE TABLE counters (name, value)" },
      {
        sql: "INSERT INTO counters (name, value) VALUES (?, ?)",
        params: ["stars", 5],
      },
    ]);
    const snapshot = original.exportAll();
    expect(snapshot.kv.colour).toBe("#ef4444");
    expect(snapshot.tables.counters).toHaveLength(1);

    // Fresh plugin (uninstall + reinstall) — nothing persisted.
    const reinstalled = new PluginStorage("acme", shim);
    reinstalled.delete("colour");
    reinstalled.sql([{ sql: "DROP TABLE IF EXISTS counters" }]);
    expect(reinstalled.get("colour")).toBeUndefined();

    // Restore → everything returns exactly.
    reinstalled.importAll(snapshot);
    expect(reinstalled.get("colour")).toBe("#ef4444");
    const rows = reinstalled.sql([
      { sql: "SELECT * FROM counters" },
    ])[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(5);
  });

  it("survives corrupt persisted payloads (never crashes)", () => {
    const shim: StorageShim = memoryStorage();
    shim.setItem("plug:acme:tables", "{not json");
    const storage = new PluginStorage("acme", shim);
    expect(storage.sql([{ sql: "SELECT * FROM anything" }])[0]).toEqual([]);
  });
});
