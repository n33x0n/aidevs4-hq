import Database from 'better-sqlite3';
import { resolve } from 'path';

const DB_PATH = resolve(process.cwd(), 'notifications.db');

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY,
      actor_name TEXT,
      notifiable_type TEXT,
      notifiable_title TEXT,
      space_title TEXT,
      created_at TEXT,
      read_at TEXT,
      action_web_url TEXT,
      post_id INTEGER,
      topic_id INTEGER,
      notifiable_id INTEGER,
      comment_text TEXT,
      is_liked INTEGER DEFAULT 0,
      likes_count INTEGER DEFAULT 0,
      comment_updated_at TEXT,
      thread_json TEXT,
      comment_images TEXT,
      mark_for_review INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(read_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_comment_updated ON notifications(comment_updated_at);
  `);
}

// ── Types ──────────────────────────────────────────────────────────────────
export interface Notification {
  id: number;
  actor_name: string | null;
  notifiable_type: string | null;
  notifiable_title: string | null;
  space_title: string | null;
  created_at: string | null;
  read_at: string | null;
  action_web_url: string | null;
  post_id: number | null;
  topic_id: number | null;
  notifiable_id: number | null;
  comment_text: string | null;
  is_liked: number;
  likes_count: number;
  comment_updated_at: string | null;
  thread_json: string | null;
  comment_images: string | null;
  mark_for_review: number;
}

export interface NotificationCounts {
  total: number;
  unread: number;
  marked: number;
  liked: number;
  mentioned: number;
}

// ── Upsert ─────────────────────────────────────────────────────────────────
export function upsertNotification(n: {
  id: number;
  actor_name?: string | null;
  notifiable_type?: string | null;
  notifiable_title?: string | null;
  space_title?: string | null;
  created_at?: string | null;
  read_at?: string | null;
  action_web_url?: string | null;
  post_id?: number | null;
  topic_id?: number | null;
  notifiable_id?: number | null;
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO notifications (id, actor_name, notifiable_type, notifiable_title, space_title, created_at, read_at, action_web_url, post_id, topic_id, notifiable_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      actor_name = excluded.actor_name,
      notifiable_type = excluded.notifiable_type,
      notifiable_title = excluded.notifiable_title,
      space_title = excluded.space_title,
      created_at = excluded.created_at,
      read_at = excluded.read_at,
      action_web_url = excluded.action_web_url,
      post_id = excluded.post_id,
      topic_id = excluded.topic_id,
      notifiable_id = excluded.notifiable_id
  `).run(
    n.id, n.actor_name ?? null, n.notifiable_type ?? null,
    n.notifiable_title ?? null, n.space_title ?? null,
    n.created_at ?? null, n.read_at ?? null,
    n.action_web_url ?? null, n.post_id ?? null,
    n.topic_id ?? null, n.notifiable_id ?? null,
  );
}

// ── Queries ────────────────────────────────────────────────────────────────
const ITEMS_PER_PAGE = 50;

const CIRCLE_DISPLAY_NAME = 'Tomasz Lebioda';

export function getNotifications(opts: {
  page?: number;
  filter?: 'all' | 'unread' | 'review' | 'liked' | 'mentioned';
  type?: 'all' | 'comments' | 'posts';
  space?: string;
}): { notifications: Notification[]; counts: NotificationCounts; totalPages: number; currentPage: number } {
  const db = getDb();
  const page = opts.page ?? 1;
  const filter = opts.filter ?? 'all';
  const type = opts.type ?? 'all';
  const space = opts.space ?? 'all';
  const offset = (page - 1) * ITEMS_PER_PAGE;

  // Build WHERE conditions
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Always exclude 'like' notifications from the list
  conditions.push("COALESCE(notifiable_type, '') != 'like'");

  if (filter === 'review') conditions.push('COALESCE(mark_for_review, 0) = 1');
  else if (filter === 'unread') conditions.push('read_at IS NULL AND COALESCE(is_liked, 0) = 0');
  else if (filter === 'liked') conditions.push('COALESCE(is_liked, 0) = 1');
  else if (filter === 'mentioned') conditions.push(`(comment_text LIKE '%@${CIRCLE_DISPLAY_NAME}%' OR thread_json LIKE '%@${CIRCLE_DISPLAY_NAME}%')`);

  if (type === 'comments') conditions.push("(LOWER(notifiable_type) LIKE '%comment%' OR LOWER(notifiable_type) LIKE '%reply%' OR LOWER(notifiable_type) LIKE '%mention%')");
  else if (type === 'posts') conditions.push("LOWER(notifiable_type) LIKE '%post%'");

  if (space && space !== 'all') {
    conditions.push('space_title = ?');
    params.push(space);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const noPagination = filter === 'unread';
  const limitClause = noPagination ? '' : ` LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}`;
  const notifications = db.prepare(`SELECT * FROM notifications ${whereClause} ORDER BY created_at DESC ${limitClause}`).all(...params) as Notification[];

  // Global counts (no type/space filter, excluding 'like' notifications)
  const noLikes = "COALESCE(notifiable_type, '') != 'like'";
  const counts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN read_at IS NULL AND COALESCE(is_liked, 0) = 0 THEN 1 ELSE 0 END) as unread,
      SUM(CASE WHEN COALESCE(is_liked, 0) = 1 THEN 1 ELSE 0 END) as liked,
      SUM(CASE WHEN (comment_text LIKE '%@${CIRCLE_DISPLAY_NAME}%' OR thread_json LIKE '%@${CIRCLE_DISPLAY_NAME}%') THEN 1 ELSE 0 END) as mentioned
    FROM notifications WHERE ${noLikes}
  `).get() as { total: number; unread: number; liked: number; mentioned: number };

  const markedRow = db.prepare(`SELECT COUNT(*) as count FROM notifications WHERE COALESCE(mark_for_review, 0) = 1 AND ${noLikes}`).get() as { count: number };

  const totalCountRow = db.prepare(`SELECT COUNT(*) as count FROM notifications ${whereClause}`).get(...params) as { count: number };
  const totalPages = noPagination ? 1 : Math.ceil(totalCountRow.count / ITEMS_PER_PAGE) || 1;

  return {
    notifications,
    counts: { total: counts.total, unread: counts.unread, marked: markedRow.count, liked: counts.liked, mentioned: counts.mentioned },
    totalPages,
    currentPage: noPagination ? 1 : page,
  };
}

// ── Unique spaces ─────────────────────────────────────────────────────────────
export function getUniqueSpaces(): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT DISTINCT space_title FROM notifications WHERE space_title IS NOT NULL ORDER BY space_title').all() as Array<{ space_title: string }>;
  return rows.map(r => r.space_title);
}

// ── Update comment ─────────────────────────────────────────────────────────
export function updateComment(id: number, data: {
  commentText: string;
  isLiked: boolean;
  likesCount: number;
  threadJson: string;
  commentImages: string[];
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const isLikedInt = data.isLiked ? 1 : 0;
  db.prepare(`
    UPDATE notifications SET
      comment_text = ?,
      is_liked = ?,
      likes_count = ?,
      comment_updated_at = ?,
      read_at = CASE WHEN ? = 1 AND read_at IS NULL THEN ? ELSE read_at END,
      thread_json = ?,
      comment_images = ?
    WHERE id = ?
  `).run(
    data.commentText, isLikedInt, data.likesCount, now,
    isLikedInt, now,
    data.threadJson, JSON.stringify(data.commentImages),
    id,
  );
}

// ── Mark as liked ──────────────────────────────────────────────────────────
export function markLiked(id: number) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE notifications SET read_at = ?, is_liked = 1, likes_count = COALESCE(likes_count, 0) + 1 WHERE id = ?').run(now, id);
  const row = db.prepare('SELECT likes_count FROM notifications WHERE id = ?').get(id) as { likes_count: number } | undefined;
  return row?.likes_count ?? 0;
}

// ── Mark as unliked ─────────────────────────────────────────────────────────
export function markUnliked(id: number) {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_liked = 0, likes_count = MAX(0, COALESCE(likes_count, 1) - 1) WHERE id = ?').run(id);
  const row = db.prepare('SELECT likes_count FROM notifications WHERE id = ?').get(id) as { likes_count: number } | undefined;
  return row?.likes_count ?? 0;
}

// ── Mark as read ───────────────────────────────────────────────────────────
export function markRead(id: number) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(now, id);
}

// ── Toggle review ──────────────────────────────────────────────────────────
export function toggleReview(id: number): number {
  const db = getDb();
  const row = db.prepare('SELECT mark_for_review FROM notifications WHERE id = ?').get(id) as { mark_for_review: number } | undefined;
  if (!row) return 0;
  const next = row.mark_for_review ? 0 : 1;
  db.prepare('UPDATE notifications SET mark_for_review = ? WHERE id = ?').run(next, id);
  return next;
}

// ── Get rows needing comment refresh ───────────────────────────────────────
export function getRowsNeedingCommentRefresh(limit: number): Array<{ id: number; post_id: number; notifiable_id: number }> {
  const db = getDb();
  return db.prepare(
    'SELECT id, post_id, notifiable_id FROM notifications WHERE post_id IS NOT NULL AND notifiable_id IS NOT NULL AND comment_updated_at IS NULL ORDER BY id DESC LIMIT ?',
  ).all(limit) as Array<{ id: number; post_id: number; notifiable_id: number }>;
}

// ── Get single notification ────────────────────────────────────────────────
export function getNotification(id: number): Notification | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as Notification | undefined;
}

// ── Statistics ─────────────────────────────────────────────────────────────
export function getStats(startDate: string = '2026-03-01 00:00:00') {
  const db = getDb();

  const hourly = db.prepare(`
    SELECT strftime('%Y-%m-%d %H:00:00', created_at) as hour, COUNT(*) as count
    FROM notifications
    WHERE created_at >= ?
    GROUP BY hour
    ORDER BY hour
  `).all(startDate) as Array<{ hour: string; count: number }>;

  const topPosts = db.prepare(`
    SELECT notifiable_title as title, COUNT(*) as comment_count, MAX(action_web_url) as url
    FROM notifications
    WHERE notifiable_title IS NOT NULL AND created_at >= ?
    GROUP BY notifiable_title
    ORDER BY comment_count DESC
    LIMIT 30
  `).all(startDate) as Array<{ title: string; comment_count: number; url: string }>;

  const topAuthors = db.prepare(`
    SELECT actor_name as author, COUNT(*) as comment_count
    FROM notifications
    WHERE actor_name IS NOT NULL AND created_at >= ?
    GROUP BY actor_name
    ORDER BY comment_count DESC
    LIMIT 30
  `).all(startDate) as Array<{ author: string; comment_count: number }>;

  return { hourly, topPosts, topAuthors };
}
