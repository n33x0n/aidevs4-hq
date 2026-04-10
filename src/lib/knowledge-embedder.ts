import { openai } from './llm';

export const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;

/**
 * Generuje embedding dla pojedynczego tekstu.
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return new Float32Array(res.data[0].embedding);
}

/**
 * Generuje embeddingi batchowo (max 100 na raz).
 */
export async function generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
  const results: Float32Array[] = [];
  const batchSize = 100;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    for (const item of res.data) {
      results.push(new Float32Array(item.embedding));
    }
  }

  return results;
}
