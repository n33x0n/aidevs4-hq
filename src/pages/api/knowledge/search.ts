import type { APIRoute } from 'astro';
import { generateEmbedding } from '../../../lib/knowledge-embedder';
import { searchKnowledge } from '../../../lib/knowledge-db';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { query, limit = 10, sourceType } = await request.json();

    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: 'Brak pola query' }), { status: 400 });
    }

    const t0 = Date.now();

    const embedding = await generateEmbedding(query);
    const results = searchKnowledge(embedding, limit, sourceType);

    // Dodaj snippet (pierwsze 300 znaków)
    const enriched = results.map(r => ({
      ...r,
      snippet: r.content.slice(0, 300) + (r.content.length > 300 ? '...' : ''),
    }));

    return new Response(JSON.stringify({
      results: enriched,
      duration: Date.now() - t0,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    }), { status: 500 });
  }
};
