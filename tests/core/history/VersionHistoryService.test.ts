import { describe, expect, it } from "vitest";
import {
  assertCoreOnlySql,
  coreTableName,
  CORE_MIGRATIONS,
  CORE_TABLE_PREFIX,
  DbAccess,
  createTauriSqlDbAccess,
  type SqlExecutor,
} from "@/core/db/DbAccess";
import {
  LocalSqlEngine,
  VersionHistoryService,
  HISTORY_PER_PATH,
} from "@/core/history/VersionHistoryService";
import { VersionedSerializer } from "@/persistence/VersionedSerializer";
import { registerCoreObjectTypes } from "@/persistence/objectTypes";
import { ObjectRegistry } from "@/core/registry/ObjectRegistry";

/** A throwing executor (fail-closed probes). */
const refusing: SqlExecutor = async () => {
  throw new Error("must not be called");
};

describe("DbAccess namespacing gate (R8.5 / AC8.7)", () => {
  it("prefixes logical table names with core_", () => {
    expect(coreTableName("versions")).toBe("core_versions");
    expect(coreTableName("core_versions")).toBe("core_versions");
    expect(() => coreTableName("bad-name")).toThrow();
    expect(() => coreTableName("")).toThrow();
  });

  it("every host migration DDL carries the core_ prefix", () => {
    for (const migration of CORE_MIGRATIONS) {
      expect(migration.sql).toContain(CORE_TABLE_PREFIX);
    }
    expect(CORE_MIGRATIONS[0]?.sql).toContain("core_versions");
  });

  it("accepts core_ statements and refuses everything else (fail closed)", () => {
    expect(() =>
      assertCoreOnlySql("SELECT id FROM core_versions WHERE ts > ?"),
    ).not.toThrow();
    expect(() =>
      assertCoreOnlySql(
        "INSERT INTO core_versions (project_path, ts, json) VALUES (?, ?, ?)",
      ),
    ).not.toThrow();
    expect(() =>
      assertCoreOnlySql("DELETE FROM core_versions WHERE id = ?"),
    ).not.toThrow();
    expect(() =>
      assertCoreOnlySql("CREATE TABLE IF NOT EXISTS core_x (id INTEGER)"),
    ).not.toThrow();
    expect(() =>
      assertCoreOnlySql("CREATE INDEX IF NOT EXISTS core_x_ts ON core_x (ts)"),
    ).not.toThrow();
    expect(() => assertCoreOnlySql("SELECT * FROM plugin_data")).toThrow(
      /refused/i,
    );
    expect(() => assertCoreOnlySql("DROP TABLE core_versions")).toThrow(
      /refused/i,
    );
    expect(() => assertCoreOnlySql("PRAGMA journal_mode")).toThrow(/refused/i);
  });

  it("routes statements through the executor after validation", async () => {
    const seen: string[] = [];
    const db = new DbAccess(async (sql) => {
      seen.push(sql);
      return [];
    });
    await db.select("SELECT id FROM core_versions");
    expect(seen).toEqual(["SELECT id FROM core_versions"]);
    await db.execute("DELETE FROM core_versions WHERE id = ?", [7]);
    expect(seen.length).toBe(2);
    await expect(db.execute("UPDATE plugin_rows SET x = 1")).rejects.toThrow(
      /refused/i,
    );
  });

  it("migrations run once and failures are reported (not thrown)", async () => {
    let calls = 0;
    const db = new DbAccess(async () => {
      calls += 1;
      return [];
    });
    const ok = await db.migrate();
    expect(ok).toBe(true);
    const before = calls;
    await db.migrate();
    expect(calls).toBe(before);
    const failing = new DbAccess(refusing);
    expect(await failing.migrate()).toBe(false);
  });

  it("createTauriSqlDbAccess returns null outside the Tauri shell", async () => {
    expect(await createTauriSqlDbAccess()).toBeNull();
  });

  it("quoteLiteral escapes single quotes", () => {
    expect(DbAccess.quoteLiteral("a'b")).toBe("'a''b'");
  });
});

describe("VersionHistoryService (R8.5 / AC8.7)", () => {
  /** Fresh service over an in-memory engine each time. */
  const make = (): {
    service: VersionHistoryService;
    engine: LocalSqlEngine;
  } => {
    const engine = new LocalSqlEngine(memoryStorage());
    const service = new VersionHistoryService(new DbAccess(engine.execute));
    return { service, engine };
  };

  /** In-memory storage shim (no localStorage in node). */
  const memoryStorage = (): Pick<Storage, "getItem" | "setItem"> => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    };
  };

  it("3 saves → 3 entries, newest first (AC8.7)", async () => {
    const { service } = make();
    await service.record("/x/a.icb", '{"a":1}');
    await service.record("/x/a.icb", '{"a":2}');
    await service.record("/x/a.icb", '{"a":3}');
    const list = await service.list("/x/a.icb");
    expect(list.length).toBe(3);
    expect(list[0]?.json).toBe('{"a":3}');
    expect(list[2]?.json).toBe('{"a":1}');
    // The snapshot payload round-trips EXACTLY (restore reproduces the
    // older state — AC8.7's restore fidelity is byte-level).
    expect(list[2]?.ts).toBeGreaterThan(0);
    expect(list.every((row) => row.projectPath === "/x/a.icb")).toBe(true);
  });

  it("restore reproduces the older state exactly (deserialise round-trip)", async () => {
    const { service } = make();
    const serializer = new VersionedSerializer(
      registerCoreObjectTypes(new ObjectRegistry()),
    );
    // Build a small board, snapshot it, mutate, snapshot again.
    const boardV1 = {
      camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
      objects: [],
    };
    const rawV1 = serializer.serialize(boardV1 as never);
    await service.record("/x/board.icb", rawV1);
    const boardV2 = {
      camera: { x: 10, y: 10, zoom: 2, rotation: 0 },
      objects: [],
    };
    const rawV2 = serializer.serialize(boardV2 as never);
    await service.record("/x/board.icb", rawV2);
    const list = await service.list("/x/board.icb");
    // The OLDER snapshot deserialises back to the v1 camera exactly.
    const older = list[1]!;
    const outcome = serializer.deserialize(older.json);
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.data.camera).toEqual(boardV1.camera);
    }
  });

  it("keeps paths isolated + prunes to HISTORY_PER_PATH", async () => {
    const { service } = make();
    for (let i = 0; i < HISTORY_PER_PATH + 6; i += 1) {
      await service.record("/x/keep.icb", `{"i":${i}}`);
    }
    await service.record("/x/other.icb", '{"other":true}');
    const keep = await service.list("/x/keep.icb");
    const other = await service.list("/x/other.icb");
    expect(keep.length).toBe(HISTORY_PER_PATH);
    expect(other.length).toBe(1);
    // The newest snapshots survive pruning.
    const newest = JSON.parse(keep[0]?.json ?? "{}") as { i?: number };
    expect(newest.i).toBe(HISTORY_PER_PATH + 5);
  });

  it("removes + clears snapshots", async () => {
    const { service } = make();
    const snapshot = await service.record("/x/a.icb", "{}");
    expect(snapshot).not.toBeNull();
    await service.remove(snapshot!.id);
    expect(await service.list("/x/a.icb")).toEqual([]);
    await service.record("/x/a.icb", "{}");
    await service.clear();
    expect(await service.list("/x/a.icb")).toEqual([]);
  });

  it("the engine survives a corrupt persisted slot", () => {
    const storage = memoryStorage();
    storage.setItem("infinite-canvas-studio/history/v1", "{not json");
    const engine = new LocalSqlEngine(storage);
    expect(engine.count()).toBe(0);
  });

  it("DB tables all use the core_ prefix (AC8.7)", () => {
    for (const migration of VersionHistoryService.migrations()) {
      expect(migration.sql).toMatch(/core_/);
    }
  });
});
