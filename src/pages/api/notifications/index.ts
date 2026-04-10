import type { APIRoute } from 'astro';
import { getNotifications, getUniqueSpaces } from '../../../lib/circle-db';

// GET /api/notifications?page=1&filter=all|unread|review|liked|mentioned&type=all|comments|posts&space=all|<name>
export const GET: APIRoute = async ({ url }) => {
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const filter = (url.searchParams.get('filter') || 'all') as 'all' | 'unread' | 'review' | 'liked' | 'mentioned';
  const type = (url.searchParams.get('type') || 'all') as 'all' | 'comments' | 'posts';
  const space = url.searchParams.get('space') || 'all';

  const data = getNotifications({ page, filter, type, space });

  const notifications = data.notifications.map((n) => ({
    ...n,
    comment_images: n.comment_images ? JSON.parse(n.comment_images) : [],
    thread_json: n.thread_json ? JSON.parse(n.thread_json) : null,
  }));

  const spaces = getUniqueSpaces();

  return new Response(JSON.stringify({
    notifications,
    counts: data.counts,
    totalPages: data.totalPages,
    currentPage: data.currentPage,
    spaces,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
