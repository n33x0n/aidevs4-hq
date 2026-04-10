import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { resolve } from 'path';

const DB_PATH = resolve(process.cwd(), 'agent.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    sqliteVec.load(_db);
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hub_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      task TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('request', 'response')),
      http_status INTEGER,
      payload TEXT NOT NULL,
      flag TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_hub_log_task ON hub_log(task);
    CREATE INDEX IF NOT EXISTS idx_hub_log_ts ON hub_log(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_hub_log_flag ON hub_log(flag) WHERE flag IS NOT NULL;

    CREATE TABLE IF NOT EXISTS task_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task TEXT NOT NULL,
      flag TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'main' CHECK (kind IN ('main', 'secret', 'teczka')),
      found_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(task, flag)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS vec_hub USING vec0(
      id INTEGER PRIMARY KEY,
      embedding float[1536]
    );

    -- Knowledge base (lekcje + KNOWLEDGE.md)
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('lesson', 'knowledge')),
      lesson_code TEXT,
      section_title TEXT NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      token_count INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(source_path, section_title, chunk_index)
    );

    CREATE INDEX IF NOT EXISTS idx_kc_source ON knowledge_chunks(source_path);
    CREATE INDEX IF NOT EXISTS idx_kc_lesson ON knowledge_chunks(lesson_code);

    CREATE VIRTUAL TABLE IF NOT EXISTS vec_knowledge USING vec0(
      embedding float[1536]
    );

    CREATE TABLE IF NOT EXISTS vec_knowledge_map (
      chunk_id INTEGER PRIMARY KEY,
      vec_rowid INTEGER NOT NULL
    );

    -- Token usage tracking
    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      task TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_usage_log_ts ON usage_log(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_log_model ON usage_log(model);
    CREATE INDEX IF NOT EXISTS idx_usage_log_task ON usage_log(task);
  `);
}

// ── Logowanie request/response ──────────────────────────────────────────────

export function logHubRequest(task: string, payload: unknown) {
  const db = getDb();
  db.prepare(
    'INSERT INTO hub_log (task, direction, payload) VALUES (?, ?, ?)',
  ).run(task, 'request', JSON.stringify(payload));
}

export function logHubResponse(task: string, httpStatus: number, payload: unknown) {
  const db = getDb();
  const payloadStr = JSON.stringify(payload);
  const flag = payloadStr.match(/\{FLG:[^}]+\}/)?.[0] ?? null;
  db.prepare(
    'INSERT INTO hub_log (task, direction, http_status, payload, flag) VALUES (?, ?, ?, ?, ?)',
  ).run(task, 'response', httpStatus, payloadStr, flag);

  if (flag) {
    db.prepare(
      'INSERT OR IGNORE INTO task_flags (task, flag) VALUES (?, ?)',
    ).run(task, flag);
  }
}

// ── Zapis flagi z jawnym kind ───────────────────────────────────────────────

export function saveFlag(task: string, flag: string, kind: 'main' | 'secret' | 'teczka' = 'main') {
  const db = getDb();
  db.prepare(
    'INSERT OR IGNORE INTO task_flags (task, flag, kind) VALUES (?, ?, ?)',
  ).run(task, flag, kind);
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function getHubLog(opts?: { task?: string; limit?: number; direction?: string }) {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts?.task) { where.push('task = ?'); params.push(opts.task); }
  if (opts?.direction) { where.push('direction = ?'); params.push(opts.direction); }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = opts?.limit ?? 100;

  return db.prepare(
    `SELECT id, ts, task, direction, http_status, payload, flag FROM hub_log ${whereClause} ORDER BY ts DESC LIMIT ?`,
  ).all(...params, limit) as Array<{
    id: number; ts: string; task: string; direction: string;
    http_status: number | null; payload: string; flag: string | null;
  }>;
}

export function getFlags(task?: string) {
  const db = getDb();
  if (task) {
    return db.prepare('SELECT * FROM task_flags WHERE task = ? ORDER BY found_at DESC').all(task);
  }
  return db.prepare('SELECT * FROM task_flags ORDER BY found_at DESC').all();
}

export function getTaskStats() {
  const db = getDb();
  return db.prepare(`
    SELECT
      task,
      COUNT(*) as total_calls,
      SUM(CASE WHEN direction = 'request' THEN 1 ELSE 0 END) as requests,
      SUM(CASE WHEN direction = 'response' THEN 1 ELSE 0 END) as responses,
      SUM(CASE WHEN flag IS NOT NULL THEN 1 ELSE 0 END) as flags_found,
      MIN(ts) as first_call,
      MAX(ts) as last_call
    FROM hub_log
    GROUP BY task
    ORDER BY last_call DESC
  `).all();
}

// ── Usage tracking ──────────────────────────────────────────────────────

export function logUsage(task: string, model: string, promptTokens: number, completionTokens: number, estimatedCost = 0) {
  const db = getDb();
  db.prepare(
    'INSERT INTO usage_log (task, model, prompt_tokens, completion_tokens, estimated_cost) VALUES (?, ?, ?, ?, ?)',
  ).run(task, model, promptTokens, completionTokens, estimatedCost);
}

export interface UsageByModel {
  model: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost: number;
}

export interface UsageSummary {
  total_calls: number;
  total_prompt: number;
  total_completion: number;
  total_tokens: number;
  total_cost: number;
  by_model: UsageByModel[];
}

export function getUsageSummary(): UsageSummary {
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_calls,
      COALESCE(SUM(prompt_tokens), 0) as total_prompt,
      COALESCE(SUM(completion_tokens), 0) as total_completion,
      COALESCE(SUM(prompt_tokens + completion_tokens), 0) as total_tokens,
      COALESCE(SUM(estimated_cost), 0) as total_cost
    FROM usage_log
  `).get() as { total_calls: number; total_prompt: number; total_completion: number; total_tokens: number; total_cost: number };

  const by_model = db.prepare(`
    SELECT
      model,
      COUNT(*) as calls,
      SUM(prompt_tokens) as prompt_tokens,
      SUM(completion_tokens) as completion_tokens,
      SUM(prompt_tokens + completion_tokens) as total_tokens,
      SUM(estimated_cost) as estimated_cost
    FROM usage_log
    GROUP BY model
    ORDER BY total_tokens DESC
  `).all() as UsageByModel[];

  return { ...totals, by_model };
}

