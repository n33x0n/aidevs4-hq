import type { APIRoute } from 'astro';
import { getStats } from '../../../lib/circle-db';

// GET /api/notifications/stats
export const GET: APIRoute = async () => {
  const stats = getStats();
  return new Response(JSON.stringify(stats), {
    headers: { 'Content-Type': 'application/json' },
  });
};
