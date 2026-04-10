import type { AstroIntegration } from 'astro';

/**
 * Astro integration — auto-sync knowledge base przy starcie dev servera.
 * Odpala sync w tle (nie blokuje startu).
 */
export default function knowledgeAutoSync(): AstroIntegration {
  return {
    name: 'knowledge-auto-sync',
    hooks: {
      'astro:server:start': async () => {
        try {
        // Dynamic import żeby nie ładować modułów przy buildzie
        const { readdirSync, readFileSync, statSync } = await import('fs');
        const { resolve, basename } = await import('path');
          const { parseMarkdownSections, chunkSection, extractLessonCode, hashContent, estimateTokens } = await import('../lib/knowledge-chunker');
          const { generateEmbeddings } = await import('../lib/knowledge-embedder');
          const { upsertChunk, storeKnowledgeEmbedding, getAllChunkHashes } = await import('../lib/knowledge-db');
          const { getDb } = await import('../lib/hub-db');

          // Upewnij się że DB jest zainicjalizowane
          getDb();

          const projectRoot = resolve(process.cwd(), '..');
          const files: Array<{ path: string; type: 'lesson' | 'knowledge' }> = [];

          // Lekcje
          const lessonsDir = resolve(projectRoot, 'lessons');
          try {
            for (const f of readdirSync(lessonsDir)) {
              if (f.endsWith('.md')) files.push({ path: resolve(lessonsDir, f), type: 'lesson' });
            }
          } catch { /* brak katalogu */ }

          // KNOWLEDGE.md
          const knowledgePath = resolve(projectRoot, 'KNOWLEDGE.md');
          try { statSync(knowledgePath); files.push({ path: knowledgePath, type: 'knowledge' }); } catch { /* */ }

          // Chunkuj
          interface SyncChunk {
            sourcePath: string; sourceType: 'lesson' | 'knowledge'; lessonCode: string | null;
            sectionTitle: string; chunkIndex: number; content: string; contentHash: string; tokenCount: number;
          }

          const allChunks: SyncChunk[] = [];
          for (const file of files) {
            const content = readFileSync(file.path, 'utf-8');
            const sections = parseMarkdownSections(content);
            const lessonCode = file.type === 'lesson' ? extractLessonCode(basename(file.path)) : null;
            const relativePath = basename(file.path);

            for (const section of sections) {
              const parts = chunkSection(section);
              for (const part of parts) {
                allChunks.push({
                  sourcePath: relativePath, sourceType: file.type, lessonCode,
                  sectionTitle: part.title, chunkIndex: part.index,
                  content: part.content, contentHash: hashContent(part.content),
                  tokenCount: estimateTokens(part.content),
                });
              }
            }
          }

          // Incremental diff
          const existingHashes = getAllChunkHashes();
          const toEmbed = allChunks.filter(chunk => {
            const key = `${chunk.sourcePath}::${chunk.sectionTitle}::${chunk.chunkIndex}`;
            const existing = existingHashes.get(key);
            return !existing || existing.hash !== chunk.contentHash;
          });

          if (toEmbed.length === 0) {
            console.log(`[knowledge] Auto-sync: ${allChunks.length} chunków aktualne, brak zmian`);
            return;
          }

          console.log(`[knowledge] Auto-sync: ${toEmbed.length} nowych/zmienionych chunków (z ${allChunks.length} total)...`);

          // Embedduj batchami
          const batchSize = 50;
          for (let i = 0; i < toEmbed.length; i += batchSize) {
            const batch = toEmbed.slice(i, i + batchSize);
            const embeddings = await generateEmbeddings(batch.map(c => c.content));

            const db = getDb();
            const transaction = db.transaction(() => {
              for (let j = 0; j < batch.length; j++) {
                const chunk = batch[j];
                const chunkId = upsertChunk({
                  sourcePath: chunk.sourcePath, sourceType: chunk.sourceType,
                  lessonCode: chunk.lessonCode, sectionTitle: chunk.sectionTitle,
                  chunkIndex: chunk.chunkIndex, content: chunk.content,
                  contentHash: chunk.contentHash, tokenCount: chunk.tokenCount,
                });
                storeKnowledgeEmbedding(chunkId, embeddings[j]);
              }
            });
            transaction();
          }

          console.log(`[knowledge] Auto-sync: zaindeksowano ${toEmbed.length} chunków`);
        } catch (err) {
          console.error('[knowledge] Auto-sync error:', err instanceof Error ? err.message : err);
        }
      },
    },
  };
}
