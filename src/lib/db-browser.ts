import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { resolve } from 'path';
import { statSync } from 'fs';

const DATABASES: Record<string, string> = {
  agent: resolve(process.cwd(), 'agent.db'),
  notifications: resolve(process.cwd(), 'notifications.db'),
};

function openDb(name: string): Database.Database {
  const path = DATABASES[name];
  if (!path) throw new Error(`Unknown database: ${name}. Available: ${Object.keys(DATABASES).join(', ')}`);
  const db = new Database(path, { readonly: false });
  db.pragma('journal_mode = WAL');
  if (name === 'agent') {
    try { sqliteVec.load(db); } catch { /* already loaded or unavailable */ }
  }
  return db;
}

export function listDatabases(): { name: string; path: string; size: number }[] {
  return Object.entries(DATABASES).map(([name, path]) => {
    let size = 0;
    try { size = statSync(path).size; } catch {}
    return { name, path, size };
  });
}

export function listTables(dbName: string): { name: string; type: string; rowCount: number }[] {
  const db = openDb(dbName);
  try {
    const tables = db.prepare(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as { name: string; type: string }[];

    // Filter out shadow tables created by virtual table modules (e.g. sqlite-vec)
    const virtualNames = tables
      .filter((t) => {
        try {
          const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t.name) as { sql: string } | undefined;
          return row?.sql?.toUpperCase().startsWith('CREATE VIRTUAL TABLE');
        } catch { return false; }
      })
      .map((t) => t.name);
    const filtered = tables.filter((t) =>
      !virtualNames.some((vt) => t.name !== vt && t.name.startsWith(vt + '_'))
    );

    return filtered.map((t) => {
      let rowCount = 0;
      try {
        const row = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get() as { cnt: number };
        rowCount = row.cnt;
      } catch {}
      return { ...t, rowCount };
    });
  } finally {
    db.close();
  }
}

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export function getTableSchema(dbName: string, table: string): { columns: ColumnInfo[]; indexes: unknown[]; sql: string } {
  const db = openDb(dbName);
  try {
    let columns = db.prepare(`PRAGMA table_info("${table}")`).all() as ColumnInfo[];

    // Virtual tables (e.g. vec0) don't support PRAGMA table_info — infer from a sample row
    if (columns.length === 0) {
      try {
        const sample = db.prepare(`SELECT * FROM "${table}" LIMIT 1`).all() as Record<string, unknown>[];
        if (sample.length > 0) {
          columns = Object.keys(sample[0]).map((name, i) => ({
            cid: i, name, type: '', notnull: 0, dflt_value: null, pk: 0,
          }));
        }
      } catch { /* virtual table may not support SELECT * either */ }
    }

    let indexes: unknown[] = [];
    try { indexes = db.prepare(`PRAGMA index_list("${table}")`).all(); } catch {}

    const sqlRow = db.prepare(
      "SELECT sql FROM sqlite_master WHERE name = ?"
    ).get(table) as { sql: string } | undefined;
    return { columns, indexes, sql: sqlRow?.sql ?? '' };
  } finally {
    db.close();
  }
}

export function getTableRows(
  dbName: string,
  table: string,
  opts: { page?: number; limit?: number; orderBy?: string; orderDir?: string; search?: string } = {},
): { rows: unknown[]; total: number; page: number; limit: number; columns: string[] } {
  const db = openDb(dbName);
  try {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(500, Math.max(1, opts.limit ?? 50));
    const offset = (page - 1) * limit;

    let columns = (db.prepare(`PRAGMA table_info("${table}")`).all() as ColumnInfo[]).map((c) => c.name);

    // Virtual tables: infer columns from a sample row
    if (columns.length === 0) {
      try {
        const sample = db.prepare(`SELECT * FROM "${table}" LIMIT 1`).all() as Record<string, unknown>[];
        if (sample.length > 0) columns = Object.keys(sample[0]);
      } catch { /* virtual table may not support SELECT * */ }
    }

    // If still no columns, return empty result
    if (columns.length === 0) {
      return { rows: [], total: 0, page, limit, columns: [] };
    }

    const orderBy = columns.includes(opts.orderBy ?? '') ? opts.orderBy! : columns[0];
    const orderDir = opts.orderDir === 'ASC' ? 'ASC' : 'DESC';

    let whereClause = '';
    const params: unknown[] = [];
    if (opts.search) {
      const conditions = columns.map((c) => `CAST("${c}" AS TEXT) LIKE ?`);
      whereClause = `WHERE ${conditions.join(' OR ')}`;
      params.push(...columns.map(() => `%${opts.search}%`));
    }

    let total = 0;
    try {
      const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM "${table}" ${whereClause}`).get(...params) as { cnt: number };
      total = countRow.cnt;
    } catch { /* virtual tables may not support COUNT */ }

    let rows: unknown[] = [];
    try {
      rows = db.prepare(
        `SELECT * FROM "${table}" ${whereClause} ORDER BY "${orderBy}" ${orderDir} LIMIT ? OFFSET ?`
      ).all(...params, limit, offset);
    } catch {
      // Virtual tables may not support ORDER BY — try without
      try {
        rows = db.prepare(
          `SELECT * FROM "${table}" LIMIT ? OFFSET ?`
        ).all(limit, offset);
      } catch { /* give up gracefully */ }
    }

    return { rows, total, page, limit, columns };
  } finally {
    db.close();
  }
}

export interface QueryResult {
  columns: string[];
  rows: unknown[];
  rowCount: number;
  changes: number;
  duration: number;
  error?: string;
}

export function executeQuery(dbName: string, sql: string): QueryResult {
  const db = openDb(dbName);
  const start = performance.now();
  try {
    const trimmed = sql.trim();
    const isSelect = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(trimmed);

    if (isSelect) {
      const stmt = db.prepare(trimmed);
      const rows = stmt.all() as Record<string, unknown>[];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : (stmt.columns?.() ?? []).map((c: { name: string }) => c.name);
      return {
        columns,
        rows,
        rowCount: rows.length,
        changes: 0,
        duration: performance.now() - start,
      };
    } else {
      const result = db.exec(trimmed);
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        changes: (result as unknown as { changes?: number })?.changes ?? 0,
        duration: performance.now() - start,
      };
    }
  } catch (err) {
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      changes: 0,
      duration: performance.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    db.close();
  }
}
