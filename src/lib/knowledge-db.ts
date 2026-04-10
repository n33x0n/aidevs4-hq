import { getDb } from './hub-db';

export interface ChunkRow {
  id: number;
  source_path: string;
  source_type: string;
  lesson_code: string | null;
  section_title: string;
  chunk_index: number;
  content: string;
  content_hash: string;
  token_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChunkUpsert {
  sourcePath: string;
  sourceType: 'lesson' | 'knowledge';
  lessonCode: string | null;
  sectionTitle: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenCount: number | null;
}

export interface SearchResult {
  id: number;
  distance: number;
  source_path: string;
  source_type: string;
  lesson_code: string | null;
  section_title: string;
  content: string;
  token_count: number | null;
}

/**
 * Upsert chunk — INSERT ON CONFLICT UPDATE.
 * Zwraca id wiersza.
 */
export function upsertChunk(chunk: ChunkUpsert): number {
  const db = getDb();
  db.prepare(`
    INSERT INTO knowledge_chunks (source_path, source_type, lesson_code, section_title, chunk_index, content, content_hash, token_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_path, section_title, chunk_index) DO UPDATE SET
      content = excluded.content,
      content_hash = excluded.content_hash,
      token_count = excluded.token_count,
      source_type = excluded.source_type,
      lesson_code = excluded.lesson_code,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).run(
    chunk.sourcePath,
    chunk.sourceType,
    chunk.lessonCode,
    chunk.sectionTitle,
    chunk.chunkIndex,
    chunk.content,
    chunk.contentHash,
    chunk.tokenCount,
  );

  const row = db.prepare(
    'SELECT id FROM knowledge_chunks WHERE source_path = ? AND section_title = ? AND chunk_index = ?',
  ).get(chunk.sourcePath, chunk.sectionTitle, chunk.chunkIndex) as { id: number };
  return row.id;
}

/**
 * Zapisuje embedding — vec0 v0.1.7 nie akceptuje jawnego rowid,
 * więc używamy mapping table vec_knowledge_map.
 */
export function storeKnowledgeEmbedding(chunkId: number, embedding: Float32Array) {
  const db = getDb();

  // Usuń stary embedding jeśli istnieje
  const existing = db.prepare('SELECT vec_rowid FROM vec_knowledge_map WHERE chunk_id = ?').get(chunkId) as { vec_rowid: number } | undefined;
  if (existing) {
    db.prepare('DELETE FROM vec_knowledge WHERE rowid = ?').run(existing.vec_rowid);
    db.prepare('DELETE FROM vec_knowledge_map WHERE chunk_id = ?').run(chunkId);
  }

  // Wstaw embedding (rowid auto-assigned)
  const result = db.prepare('INSERT INTO vec_knowledge(embedding) VALUES (?)').run(embedding);
  const vecRowid = Number(result.lastInsertRowid);

  // Zapisz mapping
  db.prepare('INSERT OR REPLACE INTO vec_knowledge_map(chunk_id, vec_rowid) VALUES (?, ?)').run(chunkId, vecRowid);
}

/**
 * Wyszukiwanie semantyczne — vec_knowledge → map → knowledge_chunks.
 */
export function searchKnowledge(
  embedding: Float32Array,
  limit = 10,
  sourceType?: 'lesson' | 'knowledge',
): SearchResult[] {
  const db = getDb();

  // vec0 wymaga "k = ?" zamiast "LIMIT ?" w kNN queries
  // Filtrowanie po sourceType robimy post-hoc (vec0 nie wspiera dodatkowych WHERE w MATCH)
  const maxK = sourceType ? limit * 3 : limit;
  // vec0 kNN: "k = ?" jest wymagany constraint (nie LIMIT)
  // Alias "k" koliduje z tabelą "k" — użyj pełnej kwalifikacji
  const rows = db.prepare(`
    SELECT kc.id, v.distance, kc.source_path, kc.source_type, kc.lesson_code, kc.section_title, kc.content, kc.token_count
    FROM vec_knowledge v
    JOIN vec_knowledge_map m ON m.vec_rowid = v.rowid
    JOIN knowledge_chunks kc ON kc.id = m.chunk_id
    WHERE v.embedding MATCH ?
      AND v.k = ?
    ORDER BY v.distance
  `).all(embedding, maxK) as SearchResult[];

  if (sourceType) {
    return rows.filter(r => r.source_type === sourceType).slice(0, limit);
  }
  return rows.slice(0, limit);
}

/**
 * Pobiera hashe wszystkich chunków (opcjonalnie dla danego source_path).
 */
export function getAllChunkHashes(sourcePath?: string): Map<string, { id: number; hash: string }> {
  const db = getDb();
  const rows = sourcePath
    ? db.prepare('SELECT id, source_path, section_title, chunk_index, content_hash FROM knowledge_chunks WHERE source_path = ?').all(sourcePath) as Array<{ id: number; source_path: string; section_title: string; chunk_index: number; content_hash: string }>
    : db.prepare('SELECT id, source_path, section_title, chunk_index, content_hash FROM knowledge_chunks').all() as Array<{ id: number; source_path: string; section_title: string; chunk_index: number; content_hash: string }>;

  const map = new Map<string, { id: number; hash: string }>();
  for (const r of rows) {
    const key = `${r.source_path}::${r.section_title}::${r.chunk_index}`;
    map.set(key, { id: r.id, hash: r.content_hash });
  }
  return map;
}

/**
 * Usuwa chunki i embeddingi dla danego source_path.
 */
export function deleteChunksForSource(sourcePath: string) {
  const db = getDb();
  const ids = db.prepare('SELECT id FROM knowledge_chunks WHERE source_path = ?').all(sourcePath) as Array<{ id: number }>;
  for (const { id } of ids) {
    const mapping = db.prepare('SELECT vec_rowid FROM vec_knowledge_map WHERE chunk_id = ?').get(id) as { vec_rowid: number } | undefined;
    if (mapping) {
      db.prepare('DELETE FROM vec_knowledge WHERE rowid = ?').run(mapping.vec_rowid);
      db.prepare('DELETE FROM vec_knowledge_map WHERE chunk_id = ?').run(id);
    }
  }
  db.prepare('DELETE FROM knowledge_chunks WHERE source_path = ?').run(sourcePath);
}

/**
 * Statystyki knowledge base.
 */
export function getKnowledgeStats() {
  const db = getDb();

  const total = db.prepare('SELECT COUNT(*) as cnt FROM knowledge_chunks').get() as { cnt: number };
  const embedded = db.prepare('SELECT COUNT(*) as cnt FROM vec_knowledge_map').get() as { cnt: number };
  const totalTokens = db.prepare('SELECT COALESCE(SUM(token_count), 0) as total FROM knowledge_chunks').get() as { total: number };

  const sources = db.prepare(`
    SELECT source_path, source_type, lesson_code, COUNT(*) as chunks, COALESCE(SUM(token_count), 0) as tokens,
           MAX(updated_at) as last_updated
    FROM knowledge_chunks
    GROUP BY source_path
    ORDER BY source_path
  `).all() as Array<{
    source_path: string;
    source_type: string;
    lesson_code: string | null;
    chunks: number;
    tokens: number;
    last_updated: string;
  }>;

  const lastSync = db.prepare('SELECT MAX(updated_at) as ts FROM knowledge_chunks').get() as { ts: string | null };

  return {
    totalChunks: total.cnt,
    embeddedChunks: embedded.cnt,
    totalTokens: totalTokens.total,
    lastSync: lastSync.ts,
    sources,
  };
}

/**
 * Pobiera chunki dla podanych lesson_code (do quizu).
 */
export function getChunksByLessonCodes(lessonCodes: string[]): {
  id: number; lesson_code: string; section_title: string;
  chunk_index: number; content: string; token_count: number;
}[] {
  if (lessonCodes.length === 0) return [];
  const db = getDb();
  const placeholders = lessonCodes.map(() => '?').join(',');
  return db.prepare(`
    SELECT id, lesson_code, section_title, chunk_index, content, COALESCE(token_count, 0) as token_count
    FROM knowledge_chunks
    WHERE lesson_code IN (${placeholders}) AND source_type = 'lesson'
    ORDER BY lesson_code, section_title, chunk_index
  `).all(...lessonCodes) as {
    id: number; lesson_code: string; section_title: string;
    chunk_index: number; content: string; token_count: number;
  }[];
}

/**
 * Wysoki poziom API — wyszukaj wiedzę po zapytaniu tekstowym.
 * Zwraca sformatowany kontekst markdown gotowy do wstrzyknięcia do promptu.
 * Zwraca '' jeśli baza jest pusta lub brak wyników.
 */
export async function getKnowledgeContext(
  query: string,
  opts?: { limit?: number; sourceType?: 'lesson' | 'knowledge'; minResults?: number },
): Promise<string> {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as cnt FROM vec_knowledge_map').get() as { cnt: number };
  if (count.cnt === 0) return '';

  const { generateEmbedding } = await import('./knowledge-embedder');
  const embedding = await generateEmbedding(query);
  const results = searchKnowledge(embedding, opts?.limit ?? 5, opts?.sourceType);

  if (results.length < (opts?.minResults ?? 1)) return '';

  return results.map(r => {
    const source = r.lesson_code ? `[${r.lesson_code.toUpperCase()}]` : '[KNOWLEDGE]';
    return `### ${source} ${r.section_title}\n${r.content}`;
  }).join('\n\n---\n\n');
}
