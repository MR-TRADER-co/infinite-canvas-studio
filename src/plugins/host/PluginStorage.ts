/**
 * Per-plugin namespaced storage (R9.3 `app.storage`, R9.5 archive).
 *
 * Two surfaces over ONE persistence backend (a `Storage`-like shim —
 * window.localStorage in both shells; tests inject a memory map):
 * - a key-value store under `plug:<id>:kv:<key>`;
 * - a mini row-table SQL engine under `plug:<id>:tables` — the same
 *   fail-closed philosophy as the host's DbAccess: CREATE TABLE /
 *   DROP TABLE / INSERT / SELECT / UPDATE / DELETE over generic rows,
 *   everything else throws (the error crosses the bridge as
 *   `bad-params`). On the desktop shell a future engine can swap the
 *   executor for prefix-scoped SQLite — the statement family is the
 *   contract.
 *
 * Archives (R9.5/AC9.7) export BOTH surfaces and restore them intact.
 *
 * Layering: plain TypeScript — no React/DOM imports.
 */

/** The persistence shim (localStorage in production, a map in tests). */
export type StorageShim = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "length" | "key"
>;

/** localStorage guarded against unavailability (SSR / disabled). */
export function safeStorage(): StorageShim | null {
  if (typeof window !== "undefined" && window.localStorage !== undefined) {
    return window.localStorage;
  }
  return null;
}

/** One SQL statement with optional bound parameters. */
export interface SqlStatement {
  readonly sql: string;
  readonly params?: readonly unknown[];
}

/** One generic table row. */
interface TableRow {
  readonly id: number;
  readonly values: Record<string, unknown>;
}

/** The persisted shape of one plugin's tables. */
interface TableStore {
  readonly tables: Record<string, TableRow[]>;
}

/** The mini-SQL engine over generic rows (fail-closed). */
class PluginSqlEngine {
  private store: TableStore = { tables: {} };
  private nextId = 1;

  public constructor(
    storage: StorageShim | null,
    private readonly slot: string,
  ) {
    if (storage !== null) {
      try {
        const raw = storage.getItem(this.slot);
        if (raw !== null) {
          const parsed = JSON.parse(raw) as TableStore;
          if (
            parsed !== null &&
            typeof parsed === "object" &&
            parsed.tables !== undefined
          ) {
            this.store = { tables: parsed.tables };
            for (const rows of Object.values(this.store.tables)) {
              for (const row of rows) {
                this.nextId = Math.max(this.nextId, row.id + 1);
              }
            }
          }
        }
      } catch {
        // Corrupt payload: start empty (fail-closed, never crash).
      }
    }
  }

  /**
   * Executes one statement (the supported family only).
   *
   * @param statement - the statement.
   * @returns metadata for writes, rows for SELECTs.
   * @throws Error on unsupported shapes (crosses the bridge typed).
   */
  public execute(statement: SqlStatement): unknown {
    const sql = statement.sql.trim().replace(/\s+/g, " ");
    const params = statement.params ?? [];
    const select =
      /^SELECT (.+?) FROM ([a-zA-Z_][a-zA-Z0-9_]*)(?: WHERE (.+))?$/.exec(sql);
    if (select !== null) {
      const rows = this.rowsOf(select[2] ?? "");
      const where = select[3];
      const filtered =
        where === undefined
          ? rows
          : rows.filter((row) => matchesWhere(row, where, params));
      if (where !== undefined) {
        validateWhere(where);
      }
      return filtered.map((row) => ({ ...row.values }));
    }
    const insert =
      /^INSERT INTO ([a-zA-Z_][a-zA-Z0-9_]*) \(([^)]+)\) VALUES \((\?(?:, \?)*)\)$/.exec(
        sql,
      );
    if (insert !== null) {
      const columns = (insert[2] ?? "")
        .split(",")
        .map((column) => column.trim());
      const placeholders = (insert[3] ?? "").split(",").length;
      if (params.length !== placeholders) {
        throw new Error(
          `پارامترها با جای‌خالی‌ها هم‌خوانی ندارند (${params.length} ≠ ${placeholders})`,
        );
      }
      const rows = this.rowsOf(insert[1] ?? "");
      const values: Record<string, unknown> = {};
      columns.forEach((column, index) => {
        values[column] = params[index];
      });
      const row: TableRow = { id: this.nextId, values };
      this.nextId += 1;
      rows.push(row);
      return { rowsAffected: 1, lastInsertId: row.id };
    }
    const create =
      /^CREATE TABLE (IF NOT EXISTS )?([a-zA-Z_][a-zA-Z0-9_]*)(?: \([^)]+\))?$/.exec(
        sql,
      );
    if (create !== null) {
      this.rowsOf(create[2] ?? "");
      return { rowsAffected: 0 };
    }
    const drop = /^DROP TABLE (IF EXISTS )?([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(sql);
    if (drop !== null) {
      delete this.store.tables[drop[2] ?? ""];
      return { rowsAffected: 0 };
    }
    const update =
      /^UPDATE ([a-zA-Z_][a-zA-Z0-9_]*) SET (.+?)(?: WHERE (.+))?$/.exec(sql);
    if (update !== null) {
      if (update[3] !== undefined) {
        validateWhere(update[3]);
      }
      const assignments = parseAssignments(update[2] ?? "");
      const rows = this.rowsOf(update[1] ?? "");
      const where = update[3];
      const whereParams = params.slice(assignments.length);
      let affected = 0;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (row === undefined) {
          continue;
        }
        if (where !== undefined && !matchesWhere(row, where, whereParams)) {
          continue;
        }
        const values = { ...row.values };
        assignments.forEach((assignment, paramIndex) => {
          values[assignment.column] = params[paramIndex];
        });
        rows[index] = { id: row.id, values };
        affected += 1;
      }
      return { rowsAffected: affected };
    }
    const remove =
      /^DELETE FROM ([a-zA-Z_][a-zA-Z0-9_]*)(?: WHERE (.+))?$/.exec(sql);
    if (remove !== null) {
      const rows = this.rowsOf(remove[1] ?? "");
      const where = remove[2];
      if (where !== undefined) {
        validateWhere(where);
      }
      const keep =
        where === undefined
          ? []
          : rows.filter((row) => !matchesWhere(row, where, params));
      const affected = rows.length - keep.length;
      this.store.tables[remove[1] ?? ""] = keep;
      return { rowsAffected: affected };
    }
    throw new Error(`دستور SQL پشتیبانی نمی‌شود: ${sql}`);
  }

  /**
   * @returns the plugin's tables (the archive export).
   */
  public exportTables(): Record<string, unknown[]> {
    const output: Record<string, unknown[]> = {};
    for (const [name, rows] of Object.entries(this.store.tables)) {
      output[name] = rows.map((row) => ({ ...row.values, id: row.id }));
    }
    return output;
  }

  /**
   * Restores table rows (the archive path).
   *
   * @param tables - the previously exported tables.
   */
  public importTables(tables: Record<string, unknown[]>): void {
    const next: Record<string, TableRow[]> = {};
    let nextId = 1;
    for (const [name, rows] of Object.entries(tables ?? {})) {
      if (!Array.isArray(rows)) {
        continue;
      }
      next[name] = rows.map((row, index) => {
        const values = { ...(row as Record<string, unknown>) };
        delete values.id;
        const id =
          typeof (row as { id?: unknown }).id === "number"
            ? ((row as { id: number }).id as number)
            : index + 1;
        nextId = Math.max(nextId, id + 1);
        return { id, values };
      });
    }
    this.store = { tables: next };
    this.nextId = nextId;
  }

  /**
   * Persists the store (called after every mutating statement).
   */
  public save(storage: StorageShim | null, slot: string): void {
    if (storage === null) {
      return;
    }
    try {
      storage.setItem(slot, JSON.stringify(this.store));
    } catch {
      // Quota: the plugin data stays live for this session; the next
      // statement retries (fail-soft — a plugin never crashes the app).
    }
  }

  /**
   * @param name - the table name.
   * @returns the live row array (creating the table on first touch).
   */
  private rowsOf(name: string): TableRow[] {
    let rows = this.store.tables[name];
    if (rows === undefined) {
      rows = [];
      this.store.tables[name] = rows;
    }
    return rows;
  }
}

/** One `col = ?` assignment of an UPDATE statement. */
interface Assignment {
  readonly column: string;
}

/**
 * Parses the SET clause (positional `?` params in declaration order).
 *
 * @param clause - the raw `col = ?, col2 = ?` text.
 * @returns the assignments.
 */
function parseAssignments(clause: string): Assignment[] {
  return clause
    .split(",")
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .map((piece) => {
      const column = piece.split("=")[0]?.trim();
      if (column === undefined || column.length === 0) {
        throw new Error("بند SET نامعتبر است");
      }
      return { column };
    });
}

/**
 * Evaluates a WHERE clause of the supported shapes (`col = ?`,
 * `col = ? AND col2 = ?`; `id` addresses the synthetic row id).
 *
 * @param row - the candidate row.
 * @param where - the raw WHERE text.
 * @param params - the bound parameters (positional, AFTER any SET
 *        parameters of an UPDATE).
 * @returns whether the row matches.
 */
function matchesWhere(
  row: TableRow,
  where: string,
  params: readonly unknown[],
): boolean {
  const conditions = where.split(" AND ").map((condition) => condition.trim());
  let paramIndex = 0;
  for (const condition of conditions) {
    const match = /^([a-zA-Z_][a-zA-Z0-9_]*) = \?$/.exec(condition);
    if (match === null) {
      throw new Error(`شرط WHERE پشتیبانی نمی‌شود: ${condition}`);
    }
    const expected = row.values[match[1] ?? ""];
    if (expected !== params[paramIndex]) {
      return false;
    }
    paramIndex += 1;
  }
  return true;
}

/**
 * Validates a WHERE clause's SHAPE (fail-closed even for empty tables).
 *
 * @param where - the raw WHERE text.
 * @throws Error on unsupported condition shapes.
 */
function validateWhere(where: string): void {
  for (const condition of where.split(" AND ").map((piece) => piece.trim())) {
    if (!/^([a-zA-Z_][a-zA-Z0-9_]*) = \?$/.test(condition)) {
      throw new Error(`شرط WHERE پشتیبانی نمی‌شود: ${condition}`);
    }
  }
}

/**
 * The per-plugin storage facade the SDK talks to (permission-gated at
 * the bridge).
 */
export class PluginStorage {
  private readonly kvPrefix: string;
  private readonly slot: string;
  private engine: PluginSqlEngine;
  private trackedKv: Record<string, unknown> = {};

  /**
   * @param pluginId - the owning plugin id (the namespace).
   * @param storage - the persistence shim (null = in-memory).
   */
  public constructor(
    private readonly pluginId: string,
    private readonly storage: StorageShim | null = safeStorage(),
  ) {
    this.kvPrefix = `plug:${pluginId}:kv:`;
    this.slot = `plug:${pluginId}:tables`;
    this.engine = new PluginSqlEngine(storage, this.slot);
    this.retrackKv();
  }

  /**
   * @param key - the key.
   * @returns the stored value (undefined when absent).
   */
  public get(key: string): unknown {
    if (this.storage === null) {
      return this.trackedKv[key];
    }
    const raw = this.storage.getItem(this.kvPrefix + key);
    if (raw === null) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }

  /**
   * @param key - the key.
   * @param value - the JSON-compatible value.
   */
  public set(key: string, value: unknown): void {
    this.trackedKv[key] = value;
    this.storage?.setItem(this.kvPrefix + key, JSON.stringify(value));
  }

  /**
   * @param key - the key.
   */
  public delete(key: string): void {
    delete this.trackedKv[key];
    this.storage?.removeItem(this.kvPrefix + key);
  }

  /**
   * Executes a batch of SQL statements against the plugin's tables.
   *
   * @param statements - the statements (the supported family).
   * @returns per-statement results.
   */
  public sql(statements: readonly SqlStatement[]): unknown[] {
    const results: unknown[] = [];
    for (const statement of statements) {
      results.push(this.engine.execute(statement));
    }
    this.engine.save(this.storage, this.slot);
    return results;
  }

  /**
   * @returns the plugin's full storage snapshot (the R9.5 archive).
   */
  public exportAll(): {
    kv: Record<string, unknown>;
    tables: Record<string, unknown[]>;
  } {
    return { kv: { ...this.trackedKv }, tables: this.engine.exportTables() };
  }

  /**
   * Restores a full snapshot (reinstall + restore, AC9.7).
   *
   * @param snapshot - the archived state.
   */
  public importAll(snapshot: {
    kv: Record<string, unknown>;
    tables: Record<string, unknown[]>;
  }): void {
    this.trackedKv = {};
    for (const [key, value] of Object.entries(snapshot.kv ?? {})) {
      this.set(key, value);
    }
    this.engine = new PluginSqlEngine(this.storage, this.slot);
    this.engine.importTables(snapshot.tables ?? {});
    this.engine.save(this.storage, this.slot);
  }

  /**
   * Re-tracks persisted KV keys at boot (the shim's enumeration when
   * available; the archive otherwise misses pre-existing keys).
   */
  private retrackKv(): void {
    if (this.storage === null) {
      return;
    }
    const enumerable = this.storage as StorageShim & {
      length?: number;
      key?: (index: number) => string | null;
    };
    if (
      typeof enumerable.length !== "number" ||
      typeof enumerable.key !== "function"
    ) {
      return;
    }
    for (let index = 0; index < enumerable.length; index += 1) {
      const key = enumerable.key(index);
      if (key === null || !key.startsWith(this.kvPrefix)) {
        continue;
      }
      const shortKey = key.slice(this.kvPrefix.length);
      const raw = this.storage.getItem(key);
      if (raw === null) {
        continue;
      }
      try {
        this.trackedKv[shortKey] = JSON.parse(raw) as unknown;
      } catch {
        this.trackedKv[shortKey] = raw;
      }
    }
  }
}
