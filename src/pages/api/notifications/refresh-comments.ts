import type { APIRoute } from 'astro';
import { getRowsNeedingCommentRefresh, updateComment } from '../../../lib/circle-db';
import { refreshCommentsBatch, refreshProgress, hasCookies } from '../../../lib/circle-api';

// POST /api/notifications/refresh-comments  — body: { limit?: number }
// Uruchamia batch refresh komentarzy w tle
export const POST: APIRoute = async ({ request }) => {
  if (!hasCookies()) {
    return new Response(JSON.stringify({ success: false, error: 'CIRCLE_COOKIES not configured' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (refreshProgress.inProgress) {
    return new Response(JSON.stringify({ success: false, error: 'Refresh already in progress', progress: refreshProgress }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await request.json().catch(() => ({})) as { limit?: number };
  const limit = Math.min(body.limit || 150, 500);

  const rows = getRowsNeedingCommentRefresh(limit);
  if (rows.length === 0) {
    return new Response(JSON.stringify({ success: true, message: 'No comments to refresh', total: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Uruchom w tle
  setTimeout(() => {
    refreshCommentsBatch(rows, (id, data) => {
      updateComment(id, data);
    }).catch(console.error);
  }, 0);

  return new Response(JSON.stringify({ success: true, started: true, total: rows.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// GET /api/notifications/refresh-comments — polling statusu
export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(refreshProgress), {
    headers: { 'Content-Type': 'application/json' },
  });
};
