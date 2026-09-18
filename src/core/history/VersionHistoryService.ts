/**
 * Version history service (R8.5): on every successful MANUAL save a
 * timestamped snapshot of the serialised project lands in the
 * `core_versions` table; a History panel lists the snapshots; preview
 * restores them read-only; restore re-applies them and hands the user
 * the save-as flow.
 *
 * Storage runs through {@link DbAccess} (the `core_` namespacing gate):
 * SQLite via `tauri-plugin-sql` on the desktop shell; a
 * localStorage-backed engine speaking the SAME statement shapes on the
 * web shell, so the service logic is identical everywhere and fully
 * node-testable.
 */
import {
  CORE_MIGRATIONS,
  DbAccess,
  type SqlExecutor,
} from "@/core/db/DbAccess";

/** localStorage slot of the web-shell history engine. */
const WEB_HISTORY_KEY = "infinite-canvas-studio/history/v1";

/** Snapshots kept per project path (pruned after every insert). */
export const HISTORY_PER_PATH = 20;

/** Total snapshot cap of the localStorage engine (quota guard). */
const WEB_TOTAL_CAP = 30;

/** One recorded snapshot of a manual save. */
export interface VersionSnapshot {
  /** Row id (AUTOINCREMENT / synthetic on the web engine). */
  readonly id: number;
  /** Absolute path of the project file at save time ("" for pathless). */
  readonly projectPath: string;
  /** Save timestamp (epoch ms). */
  readonly ts: number;
  /** The serialised `.icb` payload (exact bytes that were saved). */
  readonly json: string;
}

/**
 * The localStorage-backed SQL engine (web shell): interprets exactly the
 * statement family the history service issues (INSERT INTO core_versions /
 * SELECT … FROM core_versions / DELETE FROM core_versions) over one
 * persisted row array. Unknown shapes throw — the same fail-closed
 * contract as the SQL gate.
 */
export class LocalSqlEngine {
  private rows: VersionSnapshot[] = [];

  /**
   * @param storage - the storage shim (tests inject a memory map;
   *        production passes window.localStorage).
   */
  public constructor(
    private readonly storage: Pick<
      Storage,
      "getItem" | "setItem"
    > = safeLocalStorage(),
  ) {
    this.load();
  }

  /**
   * The statement executor (the DbAccess gate sits in front of it).
   *
   * @param sql - the statement.
   * @param params - bound parameters.
   * @returns affected-row metadata or the selected rows.
   */
  public readonly execute: SqlExecutor = async (
    sql: string,
    params?: readonly unknown[],
  ): Promise<unknown> => {
    const statement = sql.trim().replace(/\s+/g, " ");
    if (statement.startsWith("CREATE")) {
      // DDL — the in-memory shape already satisfies every migration.
      return { rowsAffected: 0 };
    }
    if (statement.startsWith("INSERT INTO core_versions")) {
      const [projectPath, ts, json] = (params ?? []) as [
        string?,
        number?,
        string?,
      ];
      if (
        typeof projectPath !== "string" ||
        typeof ts !== "number" ||
        typeof json !== "string"
      ) {
        throw new Error("core_versions insert: bad parameters");
      }
      const id = this.rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
      this.rows.push({ id, projectPath, ts, json });
      this.save();
      return { rowsAffected: 1, lastInsertId: id };
    }
    if (statement.startsWith("SELECT")) {
      const wherePath = statement.match(/WHERE project_path = \?/);
      const filtered = wherePath
        ? this.rows.filter(
            (row) => row.projectPath === (params?.[0] as string | undefined),
          )
        : this.rows;
      // Newest first; the row id breaks timestamp ties (same-ms saves).
      const ordered = [...filtered].sort((a, b) => b.ts - a.ts || b.id - a.id);
      return ordered.map((row) => ({ ...row }));
    }
    if (statement.startsWith("DELETE FROM core_versions")) {
      const match = statement.match(/WHERE id = \?/);
      if (match === null) {
        throw new Error("core_versions delete: unsupported shape");
      }
      const id = params?.[0];
      const before = this.rows.length;
      this.rows = this.rows.filter((row) => row.id !== id);
      this.save();
      return { rowsAffected: before - this.rows.length };
    }
    throw new Error(`LocalSqlEngine: unsupported statement: ${statement}`);
  };

  /** Re-reads the persisted rows (constructor bootstrap). */
  private load(): void {
    try {
      const raw = this.storage.getItem(WEB_HISTORY_KEY);
      if (raw === null) {
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }
      this.rows = parsed.filter(isSnapshotShaped);
    } catch {
      // Corrupt slot: start empty (history is a convenience, never a
      // blocker — the autosave slot remains the crash-recovery source).
      this.rows = [];
    }
  }

  /** Persists the rows (best-effort quota handling: drops oldest). */
  private save(): void {
    let payload = JSON.stringify(this.rows);
    try {
      this.storage.setItem(WEB_HISTORY_KEY, payload);
    } catch {
      // Quota exceeded: shed the oldest snapshots until it fits.
      while (this.rows.length > 1) {
        this.rows = [...this.rows].sort((a, b) => a.ts - b.ts).slice(1);
        payload = JSON.stringify(this.rows);
        try {
          this.storage.setItem(WEB_HISTORY_KEY, payload);
          return;
        } catch {
          // keep shedding
        }
      }
    }
  }

  /**
   * Test seam: total snapshot count (quota tests).
   *
   * @returns the number of stored rows.
   */
  public count(): number {
    return this.rows.length;
  }
}

/**
 * @param value - a candidate row.
 * @returns whether it structurally matches a snapshot.
 */
function isSnapshotShaped(value: unknown): value is VersionSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<VersionSnapshot>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.projectPath === "string" &&
    typeof candidate.ts === "number" &&
    typeof candidate.json === "string"
  );
}

/**
 * The browser localStorage guarded against unavailable storage (SSR,
 * disabled storage) — a memory shim keeps the engine functional.
 *
 * @returns a storage-compatible shim.
 */
function safeLocalStorage(): Pick<Storage, "getItem" | "setItem"> {
  try {
    if (typeof window !== "undefined" && window.localStorage !== undefined) {
      return window.localStorage;
    }
  } catch {
    // fall through to the memory shim
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  };
}

/**
 * The version-history service: the single writer of `core_versions`.
 *
 * Storage is injected (SQLite DbAccess on desktop, the local engine on
 * web) — tests pass a fresh LocalSqlEngine wrapped in DbAccess.
 */
export class VersionHistoryService {
  private readonly db: DbAccess;
  private readonly engine: LocalSqlEngine | null;

  /**
   * @param storage - the storage backend: either a ready DbAccess (the
   *        desktop SQLite path) or the string "local" to construct the
   *        localStorage engine here.
   */
  public constructor(storage: DbAccess | "local" = "local") {
    if (storage === "local") {
      this.engine = new LocalSqlEngine();
      this.db = new DbAccess(this.engine.execute);
    } else {
      this.engine = null;
      this.db = storage;
    }
    void this.db.migrate();
  }

  /**
   * Records one snapshot of a manual save (called by the composition
   * root right after a successful disk write).
   *
   * @param projectPath - the saved file's absolute path ("" allowed).
   * @param json - the serialised project payload.
   * @returns the stored snapshot (or null when storage failed).
   */
  public async record(
    projectPath: string,
    json: string,
  ): Promise<VersionSnapshot | null> {
    try {
      const result = (await this.db.execute(
        "INSERT INTO core_versions (project_path, ts, json) VALUES (?, ?, ?)",
        [projectPath, Date.now(), json],
      )) as { lastInsertId?: number } | undefined;
      const id =
        typeof result?.lastInsertId === "number" ? result.lastInsertId : 0;
      await this.prune(projectPath);
      return { id, projectPath, ts: Date.now(), json };
    } catch (error) {
      console.warn("[history] snapshot insert failed", error);
      return null;
    }
  }

  /**
   * Lists a project's snapshots, newest first.
   *
   * @param projectPath - the project's path ("" lists pathless saves).
   * @returns the snapshots in ts-descending order.
   */
  public async list(projectPath: string): Promise<VersionSnapshot[]> {
    const rows = await this.db.select(
      "SELECT id, project_path, ts, json FROM core_versions WHERE project_path = ? ORDER BY ts DESC, id DESC",
      [projectPath],
    );
    return (rows as unknown[]).filter(isSnapshotShaped);
  }

  /**
   * Lists the newest snapshots across ALL paths (the History panel's
   * pathless overview — capped).
   *
   * @param limit - maximum rows returned.
   * @returns the snapshots in ts-descending order.
   */
  public async listAll(limit = 20): Promise<VersionSnapshot[]> {
    const rows = await this.db.select(
      "SELECT id, project_path, ts, json FROM core_versions ORDER BY ts DESC, id DESC",
    );
    return (rows as unknown[]).filter(isSnapshotShaped).slice(0, limit);
  }

  /**
   * Removes one snapshot.
   *
   * @param id - the snapshot row id.
   */
  public async remove(id: number): Promise<void> {
    await this.db.execute("DELETE FROM core_versions WHERE id = ?", [id]);
  }

  /**
   * Prunes one project's history to the newest {@link HISTORY_PER_PATH}
   * snapshots (runs after every insert).
   *
   * @param projectPath - the project's path.
   */
  public async prune(projectPath: string): Promise<void> {
    const snapshots = await this.list(projectPath);
    const excess = snapshots.slice(HISTORY_PER_PATH);
    for (const snapshot of excess) {
      await this.remove(snapshot.id);
    }
    // The web engine's global quota guard.
    if (this.engine !== null && this.engine.count() > WEB_TOTAL_CAP) {
      const oldest = await this.db.select(
        "SELECT id, project_path, ts, json FROM core_versions",
      );
      const over = (oldest as unknown[])
        .filter(isSnapshotShaped)
        .sort((a, b) => a.ts - b.ts || a.id - b.id)
        .slice(0, this.engine.count() - WEB_TOTAL_CAP);
      for (const snapshot of over) {
        await this.remove(snapshot.id);
      }
    }
  }

  /**
   * Drops the entire history (new-project reset; the files on disk stay
   * untouched).
   */
  public async clear(): Promise<void> {
    const snapshots = await this.db.select(
      "SELECT id, project_path, ts, json FROM core_versions",
    );
    for (const snapshot of (snapshots as unknown[]).filter(isSnapshotShaped)) {
      await this.remove(snapshot.id);
    }
  }

  /**
   * The migrations this service installed (SEAMS documentation probe).
   *
   * @returns the host migration list.
   */
  public static migrations(): readonly (typeof CORE_MIGRATIONS)[number][] {
    return CORE_MIGRATIONS;
  }
}
