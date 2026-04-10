import type { APIRoute } from 'astro';
import { getNotification, markLiked, markUnliked } from '../../../../lib/circle-db';
import { likeComment, unlikeComment, markAsReadOnCircle } from '../../../../lib/circle-api';

// POST /api/notifications/:id/like — toggle like/unlike
export const POST: APIRoute = async ({ params }) => {
  const id = parseInt(params.id!, 10);
  const row = getNotification(id);

  if (!row || row.notifiable_id == null) {
    return new Response(JSON.stringify({ success: false, error: 'Notification has no notifiable_id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const alreadyLiked = !!row.is_liked;

  try {
    if (alreadyLiked) {
      await unlikeComment(row.notifiable_id);
      const likesCount = markUnliked(id);
      return new Response(JSON.stringify({ success: true, isLiked: false, likesCount }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      await likeComment(row.notifiable_id);
      await markAsReadOnCircle(id);
      const likesCount = markLiked(id);
      return new Response(JSON.stringify({ success: true, isLiked: true, likesCount }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
