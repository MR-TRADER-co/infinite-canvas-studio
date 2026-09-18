/**
 * SQLite access layer with owner NAMESPACING (R8.5) — the single gate
 * every SQL statement passes through before reaching the app database.
 *
 * Convention (documented in docs/SEAMS.md §8): the HOST owns the `core_`
 * table prefix. All app tables (`core_versions`, …) are created and
 * touched ONLY through {@link DbAccess}, which validates that every
 * statement references `core_`-prefixed tables exclusively. Phase 9's
 * plugin runtime will hand each plugin its OWN DbAccess instance bound
 * to that plugin's prefix with its own migrations — the isolation is
 * structural, not conventional.
 *
 * Two backends implement the same executor contract:
 * - the desktop shell uses `tauri-plugin-sql` (SQLite file in the
 *   app-data directory, `sqlite:appdata.db`);
 * - the web shell (and any environment where the plugin is unavailable)
 *   degrades to a localStorage-backed engine — same SQL surface for the
 *   SELECT/INSERT/DELETE the version history performs, so the service
 *   layer never branches on platform.
 */
import { isTauriEnvironment } from "@/platform/tauri/log";

/** Executor the DbAccess gates (one statement + bound parameters). */
export type SqlExecutor = (
  sql: string,
  params?: readonly unknown[],
) => Promise<unknown>;

/** Result rows of a SELECT (array of plain records). */
export type SqlRows = ReadonlyArray<Record<string, unknown>>;

/** Prefix every host-owned table must carry (§1.7.2 / SEAMS.md §8). */
export const CORE_TABLE_PREFIX = "core_";

/** Pattern of a legal table identifier segment (letters/digits/_). */
const TABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Normalises + validates a host table name: appends the `core_` prefix
 * when missing and refuses anything malformed.
 *
 * @param table - the logical table name (e.g. `versions`).
 * @returns the physical table name (`core_versions`).
 * @throws Error when the name is malformed or carries a foreign prefix.
 */
export function coreTableName(table: string): string {
  if (!TABLE_NAME_PATTERN.test(table)) {
    throw new Error(`invalid core table name: ${table}`);
  }
  if (table.startsWith(CORE_TABLE_PREFIX)) {
    return table;
  }
  return `${CORE_TABLE_PREFIX}${table}`;
}

/**
 * Extracts the (first) table identifier a data statement touches. Only
 * the statement forms the host actually issues are recognised; anything
 * else fails closed.
 *
 * @param sql - the SQL statement.
 * @returns the physical table name the statement addresses, or null when
 *          the statement shape is unknown.
 */
function tableOfStatement(sql: string): string | null {
  const statement = sql.trim().replace(/\s+/g, " ");
  const create = statement.match(
    /^CREATE (?:TABLE|INDEX) IF NOT EXISTS ([A-Za-z0-9_]+)/i,
  );
  if (create !== null) {
    return create[1] ?? null;
  }
  const insert = statement.match(/^INSERT INTO ([A-Za-z0-9_]+)/i);
  if (insert !== null) {
    return insert[1] ?? null;
  }
  const update = statement.match(/^UPDATE ([A-Za-z0-9_]+)/i);
  if (update !== null) {
    return update[1] ?? null;
  }
  const remove = statement.match(/^DELETE FROM ([A-Za-z0-9_]+)/i);
  if (remove !== null) {
    return remove[1] ?? null;
  }
  const select = statement.match(/^SELECT .* FROM ([A-Za-z0-9_]+)/i);
  if (select !== null) {
    return select[1] ?? null;
  }
  return null;
}

/**
 * The namespaced SQL gate. Every host statement flows through
 * {@link DbAccess.execute}/{@link DbAccess.select} which call this.
 *
 * @param sql - the statement to validate.
 * @throws Error when the statement addresses a non-`core_` table or has
 *         an unrecognised shape (fail closed — a plugin prefix belongs
 *         to a different DbAccess instance, Phase 9).
 */
export function assertCoreOnlySql(sql: string): void {
  const table = tableOfStatement(sql);
  if (table === null || !table.startsWith(CORE_TABLE_PREFIX)) {
    throw new Error(
      `DbAccess refused non-core SQL (table: ${table ?? "<unrecognised>"}); ` +
        `host statements must target ${CORE_TABLE_PREFIX}* tables`,
    );
  }
}

/** One host migration: an id + the DDL it runs (idempotent). */
export interface CoreMigration {
  readonly id: string;
  readonly sql: string;
}

/**
 * The host's migrations, in order. `0001` creates the version-history
 * table (R8.5): one row per manual save — (project path, timestamp,
 * JSON payload).
 */
export const CORE_MIGRATIONS: readonly CoreMigration[] = [
  {
    id: "0001-core-versions",
    sql: "CREATE TABLE IF NOT EXISTS core_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, project_path TEXT NOT NULL, ts INTEGER NOT NULL, json TEXT NOT NULL)",
  },
  {
    id: "0002-core-versions-index",
    sql: "CREATE INDEX IF NOT EXISTS core_versions_path_ts ON core_versions (project_path, ts)",
  },
];

/**
 * The namespaced database access service (R8.5 / SEAMS.md §8).
 *
 * Wraps one executor; validates the `core_` prefix on every statement;
 * runs the host migrations once per instance; exposes execute/select for
 * the host services (version history today, plugins get their OWN
 * prefix-scoped instance in Phase 9).
 */
export class DbAccess {
  private readonly executor: SqlExecutor;
  private migrationsDone = false;

  /**
   * @param executor - the backend statement executor (plugin-sql on the
   *        desktop shell, the localStorage engine on the web shell).
   */
  public constructor(executor: SqlExecutor) {
    this.executor = executor;
  }

  /**
   * Runs the host migrations exactly once (idempotent DDL; safe to call
   * repeatedly — a second call is a no-op).
   *
   * @returns whether every migration applied.
   */
  public async migrate(): Promise<boolean> {
    if (this.migrationsDone) {
      return true;
    }
    try {
      for (const migration of CORE_MIGRATIONS) {
        await this.execute(migration.sql);
      }
      this.migrationsDone = true;
      return true;
    } catch (error) {
      console.warn("[db] core migration failed", error);
      return false;
    }
  }

  /**
   * Runs one gated statement (no result rows expected).
   *
   * @param sql - the statement (must target a `core_` table).
   * @param params - bound parameters.
   * @returns the backend result (rows-affected shape).
   */
  public async execute(
    sql: string,
    params?: readonly unknown[],
  ): Promise<unknown> {
    assertCoreOnlySql(sql);
    return this.executor(sql, params);
  }

  /**
   * Runs one gated SELECT.
   *
   * @param sql - the query (must read a `core_` table).
   * @param params - bound parameters.
   * @returns the result rows.
   */
  public async select(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlRows> {
    assertCoreOnlySql(sql);
    const rows = await this.executor(sql, params);
    return Array.isArray(rows) ? (rows as SqlRows) : [];
  }

  /**
   * Escapes + quotes a literal string for the history service's LIKE
   * filters (the localStorage engine reuses the SQL shapes verbatim, so
   * a shared escaper keeps both backends consistent).
   *
   * @param value - the raw string.
   * @returns the escaped, quoted literal.
   */
  public static quoteLiteral(value: string): string {
    return `'${value.replaceAll("'", "''")}'`;
  }
}

/**
 * Builds the desktop-shell DbAccess over `tauri-plugin-sql` (SQLite in
 * the app-data directory). The import is dynamic so the web shell never
 * loads the plugin bundle.
 *
 * @returns the desktop DbAccess, or null when the plugin is unavailable
 *          (the caller falls back to the localStorage engine).
 */
export async function createTauriSqlDbAccess(): Promise<DbAccess | null> {
  if (!isTauriEnvironment()) {
    return null;
  }
  try {
    const sqlModule = await import("@tauri-apps/plugin-sql");
    const Database = sqlModule.default;
    const database = await Database.load("sqlite:appdata.db");
    return new DbAccess(async (sql: string, params?: readonly unknown[]) => {
      // plugin-sql splits its API: SELECT returns rows through
      // `select`; mutations return {rowsAffected} through `execute`.
      if (sql.trimStart().toUpperCase().startsWith("SELECT")) {
        return database.select(sql, params as unknown[] | undefined);
      }
      return database.execute(sql, params as unknown[] | undefined);
    });
  } catch (error) {
    console.warn("[db] tauri-plugin-sql unavailable, degrading", error);
    return null;
  }
}
