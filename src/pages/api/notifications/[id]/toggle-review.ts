import type { APIRoute } from 'astro';
import { toggleReview } from '../../../../lib/circle-db';

// POST /api/notifications/:id/toggle-review
export const POST: APIRoute = async ({ params }) => {
  const id = parseInt(params.id!, 10);
  const markForReview = toggleReview(id);
  return new Response(JSON.stringify({ success: true, markForReview }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
