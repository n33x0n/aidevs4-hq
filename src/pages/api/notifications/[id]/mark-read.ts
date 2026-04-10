import type { APIRoute } from 'astro';
import { markRead } from '../../../../lib/circle-db';
import { markAsReadOnCircle } from '../../../../lib/circle-api';

// POST /api/notifications/:id/mark-read
export const POST: APIRoute = async ({ params }) => {
  const id = parseInt(params.id!, 10);

  try {
    await markAsReadOnCircle(id);
    markRead(id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
