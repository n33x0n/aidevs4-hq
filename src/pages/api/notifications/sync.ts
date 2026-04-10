import type { APIRoute } from 'astro';
import { fetchNotifications, hasCookies } from '../../../lib/circle-api';
import { upsertNotification } from '../../../lib/circle-db';

// POST /api/notifications/sync  — body: { limit?: number }
export const POST: APIRoute = async ({ request }) => {
  if (!hasCookies()) {
    return new Response(JSON.stringify({ success: false, error: 'CIRCLE_COOKIES not configured in .env' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await request.json().catch(() => ({})) as { limit?: number };
  const limit = Math.min(body.limit || 100, 500);

  try {
    const records = await fetchNotifications(limit);

    for (const r of records) {
      upsertNotification({
        id: r.id,
        actor_name: r.actor_name,
        notifiable_type: r.notifiable_type ?? r.action,
        notifiable_title: r.notifiable_title,
        space_title: r.space_title,
        created_at: r.created_at,
        read_at: r.read_at,
        action_web_url: r.action_web_url,
        post_id: r.post_id,
        topic_id: r.topic_id,
        notifiable_id: r.notifiable_id,
      });
    }

    return new Response(JSON.stringify({ success: true, synced: records.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
