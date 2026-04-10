import type { APIRoute } from 'astro';
import { getNotification, updateComment } from '../../../../lib/circle-db';
import { fetchComment } from '../../../../lib/circle-api';

// GET /api/notifications/:id/comment — pobierz komentarz z Circle API i cache w DB
export const GET: APIRoute = async ({ params }) => {
  const id = parseInt(params.id!, 10);
  const row = getNotification(id);

  if (!row || row.post_id == null || row.notifiable_id == null) {
    return new Response(JSON.stringify({ error: 'No post_id or notifiable_id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const details = await fetchComment(row.post_id, row.notifiable_id);

    // Cache w DB
    updateComment(id, details);

    return new Response(JSON.stringify({
      commentText: details.commentText,
      isLiked: details.isLiked,
      likesCount: details.likesCount,
      commentImages: details.commentImages,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
