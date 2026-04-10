import type { APIRoute } from 'astro';
import { getKnowledgeStats } from '../../../lib/knowledge-db';

export const GET: APIRoute = async () => {
  try {
    const stats = getKnowledgeStats();
    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    }), { status: 500 });
  }
};
