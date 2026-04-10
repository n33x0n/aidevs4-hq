import type { APIRoute } from 'astro';
import { getLatestData } from './push';
import { createSSEStream } from '../../../lib/sse';

// Sync — zwraca dane otrzymane przez /api/circle/push (z bookmarkletu)
export const POST: APIRoute = async () => {
  return createSSEStream(async (send) => {
    const raw = getLatestData();

    if (!raw) {
      send('log', { message: '[SIGINT] Brak danych — uruchom skrypt na Circle.so (patrz przycisk FETCH w panelu)' });
      return;
    }

    const age = Date.now() - raw.timestamp;
    const ageMin = Math.round(age / 60000);
    send('log', { message: `[SIGINT] Dane z Circle.so (${ageMin}min temu)` });

    // Posty
    const posts = raw.posts.map((p: any) => ({
      id: String(p.id),
      title: p.name || p.title || '',
      content: p.body?.plain_text_body || p.body?.body || (typeof p.body === 'string' ? p.body : '') || p.content || '',
      author: p.user_name || p.user?.name || p.creator?.name || 'Unknown',
      timestamp: new Date(p.created_at || Date.now()).toLocaleString('pl-PL', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }),
      spaceId: String(p.space_id || ''),
      spaceName: p.space?.name || p.space_name || '',
      read: false,
      likes: p.user_likes_count || p.like_count || p.likes_count || 0,
    }));
    send('data', { type: 'posts', items: posts });
    send('log', { message: `[SIGINT] Załadowano ${posts.length} postów` });

    // Komentarze
    const comments = raw.comments.map((c: any) => ({
      id: String(c.id),
      postId: String(c.post_id || ''),
      content: c.body?.plain_text_body || c.body?.body || (typeof c.body === 'string' ? c.body : '') || c.content || '',
      author: c.user_name || c.user?.name || c.creator?.name || 'Unknown',
      timestamp: new Date(c.created_at || Date.now()).toLocaleString('pl-PL', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }),
      read: false,
      likes: c.user_likes_count || c.like_count || c.likes_count || 0,
    }));
    send('data', { type: 'comments', items: comments });
    send('log', { message: `[SIGINT] Załadowano ${comments.length} komentarzy` });

    // DMs
    const dms = raw.dms.map((m: any) => ({
      id: String(m.id),
      conversationId: String(m.chat_room_uuid || m.chat_room_id || ''),
      content: m.body?.plain_text_body || m.body?.body || (typeof m.body === 'string' ? m.body : '') || m.content || '',
      author: m.user_name || m.user?.name || m.creator?.name || 'Unknown',
      timestamp: new Date(m.created_at || Date.now()).toLocaleString('pl-PL', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }),
      read: m.is_read || m.read_at ? true : false,
    }));
    send('data', { type: 'dms', items: dms });
    send('log', { message: `[SIGINT] Załadowano ${dms.length} wiadomości` });

    send('log', { message: '[SIGINT] Synchronizacja zakończona' });
  }, { headers: { 'X-Accel-Buffering': 'no' } });
};
