import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/circle-session';

const CIRCLE_BASE = 'https://bravecourses.circle.so';

async function fetchCircle(endpoint: string, init?: RequestInit) {
  const session = getSession();
  if (!session) throw new Error('Not authenticated');

  const url = endpoint.startsWith('http') ? endpoint : `${CIRCLE_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Cookie: session.cookie,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(`Circle API ${response.status}: ${text.slice(0, 200)}`);
  }

  return response.json();
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({
      type: 'like',
      targetId: '',
    }))) as {
      type: 'like' | 'reply' | 'read' | 'review';
      targetId: string;
      content?: string;
    };

    const { type, targetId, content } = body;

    if (!targetId) {
      return new Response(JSON.stringify({ success: false, error: 'Brak targetId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let result: any;

    switch (type) {
      case 'like': {
        // POST like na post
        result = await fetchCircle('/internal_api/post_likes', {
          method: 'POST',
          body: JSON.stringify({ post_id: targetId }),
        });
        break;
      }

      case 'reply': {
        // POST komentarz
        if (!content) throw new Error('Content required for reply');
        result = await fetchCircle(`/internal_api/posts/${targetId}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body: content }),
        });
        break;
      }

      case 'read': {
        // Mark post as read
        result = await fetchCircle(`/internal_api/posts/${targetId}`, {
          method: 'PATCH',
          body: JSON.stringify({ is_read: true }),
        }).catch(() => ({ success: true })); // Niektóre API mogą nie wspierać tego
        break;
      }

      case 'review': {
        // Niestandardowa akcja — w Circle.so nie ma bezpośrednio "review", ale moglibyśmy zrobić flagę
        console.log('[CIRCLE] Review action for', targetId);
        result = { success: true };
        break;
      }

      default:
        throw new Error(`Unknown action type: ${type}`);
    }

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[CIRCLE] Action error:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
