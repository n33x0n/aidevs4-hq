import type { APIRoute } from 'astro';
import { getNotification, markRead } from '../../../../lib/circle-db';
import { replyToComment, markAsReadOnCircle } from '../../../../lib/circle-api';

// POST /api/notifications/:id/reply — { text: string }
export const POST: APIRoute = async ({ params, request }) => {
  const id = parseInt(params.id!, 10);
  const row = getNotification(id);

  if (!row || !row.post_id || !row.notifiable_id) {
    return new Response(JSON.stringify({ success: false, error: 'Notification has no post_id or notifiable_id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await request.json() as { text?: string };
  const text = body.text?.trim();

  if (!text) {
    return new Response(JSON.stringify({ success: false, error: 'Text is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await replyToComment(row.post_id, row.notifiable_id, text);

    // Mark as read after replying
    try {
      await markAsReadOnCircle(id);
      markRead(id);
    } catch { /* ignore read marking errors */ }

    return new Response(JSON.stringify({
      success: true,
      commentId: result.id,
      showUrl: result.showUrl,
    }), {
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
