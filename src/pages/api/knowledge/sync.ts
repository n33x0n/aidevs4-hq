import type { APIRoute } from 'astro';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, basename } from 'path';
import { parseMarkdownSections, chunkSection, extractLessonCode, hashContent, estimateTokens } from '../../../lib/knowledge-chunker';
import { generateEmbeddings } from '../../../lib/knowledge-embedder';
import { upsertChunk, storeKnowledgeEmbedding, getAllChunkHashes, deleteChunksForSource } from '../../../lib/knowledge-db';
import { createSSEStream } from '../../../lib/sse';

interface SyncChunk {
  sourcePath: string;
  sourceType: 'lesson' | 'knowledge';
  lessonCode: string | null;
  sectionTitle: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenCount: number;
}

function discoverFiles(): Array<{ path: string; type: 'lesson' | 'knowledge' }> {
  const projectRoot = resolve(process.cwd(), '..');
  const files: Array<{ path: string; type: 'lesson' | 'knowledge' }> = [];

  // Lekcje
  const lessonsDir = resolve(projectRoot, 'lessons');
  try {
    for (const f of readdirSync(lessonsDir)) {
      if (f.endsWith('.md')) {
        files.push({ path: resolve(lessonsDir, f), type: 'lesson' });
      }
    }
  } catch { /* brak katalogu */ }

  // KNOWLEDGE.md
  const knowledgePath = resolve(projectRoot, 'KNOWLEDGE.md');
  try {
    statSync(knowledgePath);
    files.push({ path: knowledgePath, type: 'knowledge' });
  } catch { /* brak pliku */ }

  return files;
}

function chunkFile(file: { path: string; type: 'lesson' | 'knowledge' }): SyncChunk[] {
  const content = readFileSync(file.path, 'utf-8');
  const sections = parseMarkdownSections(content);
  const lessonCode = file.type === 'lesson' ? extractLessonCode(basename(file.path)) : null;
  const relativePath = basename(file.path);
  const chunks: SyncChunk[] = [];

  for (const section of sections) {
    const parts = chunkSection(section);
    for (const part of parts) {
      chunks.push({
        sourcePath: relativePath,
        sourceType: file.type,
        lessonCode,
        sectionTitle: part.title,
        chunkIndex: part.index,
        content: part.content,
        contentHash: hashContent(part.content),
        tokenCount: estimateTokens(part.content),
      });
    }
  }

  return chunks;
}

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const force = body.force === true;

  return createSSEStream(async (send) => {
    const t0 = Date.now();

    send('log', { message: 'Skanowanie plików...' });
    const files = discoverFiles();
    send('log', { message: `Znaleziono ${files.length} plików` });

    // Chunkuj wszystkie pliki
    const allChunks: SyncChunk[] = [];
    for (const file of files) {
      const chunks = chunkFile(file);
      send('log', { message: `  ${basename(file.path)}: ${chunks.length} chunków` });
      allChunks.push(...chunks);
    }

    // Pobierz istniejące hashe
    const existingHashes = getAllChunkHashes();

    // Filtruj changed/new
    let toEmbed: SyncChunk[] = [];
    let skipped = 0;

    if (force) {
      toEmbed = allChunks;
      send('log', { message: `Force mode — embeddingujemy wszystkie ${allChunks.length} chunków` });
    } else {
      for (const chunk of allChunks) {
        const key = `${chunk.sourcePath}::${chunk.sectionTitle}::${chunk.chunkIndex}`;
        const existing = existingHashes.get(key);
        if (existing && existing.hash === chunk.contentHash) {
          skipped++;
        } else {
          toEmbed.push(chunk);
        }
      }
      send('log', { message: `Nowych/zmienionych: ${toEmbed.length}, bez zmian: ${skipped}` });
    }

    // Wyczyść chunki które nie istnieją w plikach (usunięte sekcje)
    const currentKeys = new Set(allChunks.map(c => `${c.sourcePath}::${c.sectionTitle}::${c.chunkIndex}`));
    let deleted = 0;
    const { getDb: getDatabase } = await import('../../../lib/hub-db');
    for (const [key, { id }] of existingHashes) {
      if (!currentKeys.has(key)) {
        const db = getDatabase();
        const mapping = db.prepare('SELECT vec_rowid FROM vec_knowledge_map WHERE chunk_id = ?').get(id) as { vec_rowid: number } | undefined;
        if (mapping) {
          db.prepare('DELETE FROM vec_knowledge WHERE rowid = ?').run(mapping.vec_rowid);
          db.prepare('DELETE FROM vec_knowledge_map WHERE chunk_id = ?').run(id);
        }
        db.prepare('DELETE FROM knowledge_chunks WHERE id = ?').run(id);
        deleted++;
      }
    }
    if (deleted > 0) {
      send('log', { message: `Usunięto ${deleted} nieaktualnych chunków` });
    }

    if (toEmbed.length === 0) {
      send('log', { message: 'Brak zmian — wszystko aktualne!' });
      send('result', { chunksIndexed: 0, skipped, deleted, duration: Date.now() - t0 });
      return;
    }

    // Embedduj batchami
    const batchSize = 50;
    let indexed = 0;

    for (let i = 0; i < toEmbed.length; i += batchSize) {
      const batch = toEmbed.slice(i, i + batchSize);
      send('progress', { current: i, total: toEmbed.length });
      send('log', { message: `Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(toEmbed.length / batchSize)} (${batch.length} chunków)...` });

      // Generuj embeddingi
      const embeddings = await generateEmbeddings(batch.map(c => c.content));

      // Upsert w transakcji
      const { getDb } = await import('../../../lib/hub-db');
      const db = getDb();
      const transaction = db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const chunkId = upsertChunk({
            sourcePath: chunk.sourcePath,
            sourceType: chunk.sourceType,
            lessonCode: chunk.lessonCode,
            sectionTitle: chunk.sectionTitle,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            contentHash: chunk.contentHash,
            tokenCount: chunk.tokenCount,
          });
          storeKnowledgeEmbedding(chunkId, embeddings[j]);
          indexed++;
        }
      });
      transaction();
    }

    send('progress', { current: toEmbed.length, total: toEmbed.length });
    send('log', { message: `Gotowe! Zaindeksowano ${indexed} chunków.` });
    send('result', { chunksIndexed: indexed, skipped, deleted, duration: Date.now() - t0 });
  });
};
