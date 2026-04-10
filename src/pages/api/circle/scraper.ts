import type { APIRoute } from 'astro';

// GET — zwraca skrypt diagnostyczny do uruchomienia w konsoli Safari na bravecourses.circle.so
export const GET: APIRoute = async ({ url }) => {
  const AGENT_URL = 'http://localhost:31337';
  const debug = url.searchParams.has('debug');

  const script = `
(async () => {
  const AGENT = '${AGENT_URL}';
  const h = { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  const DEBUG = ${debug};

  // 1. Spaces
  console.log('[SIGINT] Pobieram spaces...');
  let spaces = [];
  try {
    const sr = await fetch('/internal_api/spaces?page=1&per_page=50', { headers: h, credentials: 'include' });
    const sd = await sr.json();
    if (DEBUG) console.log('[SIGINT] RAW spaces:', JSON.stringify(sd).slice(0, 500));
    // Circle API zwraca różne formaty — szukamy tablicy
    spaces = sd.records || sd.spaces || sd || [];
    if (!Array.isArray(spaces)) spaces = Object.values(sd).find(v => Array.isArray(v)) || [];
    console.log('[SIGINT] Spaces znalezione:', spaces.length, spaces.map(s => s.name + ' (id:' + s.id + ')'));
  } catch(e) { console.error('[SIGINT] spaces error:', e); }

  // 2. Posty z każdego space
  let allPosts = [];
  for (const space of spaces) {
    console.log('[SIGINT] Pobieram posty z:', space.name, '(id:' + space.id + ')...');
    try {
      const pr = await fetch('/internal_api/spaces/' + space.id + '/posts?page=1&per_page=20&include_top_pinned_post=true&used_on=cards', { headers: h, credentials: 'include' });
      const pd = await pr.json();
      if (DEBUG) console.log('[SIGINT] RAW posts (' + space.name + '):', JSON.stringify(pd).slice(0, 500));
      const posts = pd.records || pd.posts || [];
      if (!Array.isArray(posts)) { console.warn('[SIGINT] posts nie jest tablicą, klucze:', Object.keys(pd)); continue; }
      posts.forEach(p => { p.space_name = space.name; p.space_id = space.id; });
      allPosts.push(...posts);
      console.log('[SIGINT] Posty z', space.name + ':', posts.length);
    } catch(e) { console.error('[SIGINT] posts error for space', space.id, e); }
  }

  // Fallback — jeśli spaces puste, spróbuj domyślny community feed
  if (allPosts.length === 0) {
    console.log('[SIGINT] Brak postów ze spaces, próbuję community feed...');
    for (const endpoint of [
      '/internal_api/community/posts?page=1&per_page=20',
      '/internal_api/posts?page=1&per_page=20',
      '/internal_api/activity_feed?page=1&per_page=20',
    ]) {
      try {
        const r = await fetch(endpoint, { headers: h, credentials: 'include' });
        if (!r.ok) { console.log('[SIGINT]', endpoint, '→', r.status); continue; }
        const d = await r.json();
        console.log('[SIGINT] RAW', endpoint, '→ klucze:', Object.keys(d), 'slice:', JSON.stringify(d).slice(0, 300));
        const items = d.records || d.posts || d.activities || [];
        if (items.length > 0) { allPosts = items; console.log('[SIGINT] Znaleziono', items.length, 'postów z', endpoint); break; }
      } catch(e) { console.warn('[SIGINT]', endpoint, 'error:', e); }
    }
  }

  console.log('[SIGINT] Łącznie postów:', allPosts.length);

  // 3. Komentarze (top 5 postów)
  let allComments = [];
  for (const p of allPosts.slice(0, 5)) {
    try {
      const cr = await fetch('/internal_api/posts/' + p.id + '/comments?page=1&per_page=20', { headers: h, credentials: 'include' });
      if (!cr.ok) continue;
      const cd = await cr.json();
      const items = cd.records || cd.comments || [];
      allComments.push(...items);
    } catch(e) { /* skip */ }
  }
  console.log('[SIGINT] Komentarze:', allComments.length);

  // 4. DM-y
  let allDms = [];
  try {
    const dr = await fetch('/internal_api/chat_rooms?page=1&per_page=10', { headers: h, credentials: 'include' });
    if (dr.ok) {
      const dd = await dr.json();
      if (DEBUG) console.log('[SIGINT] RAW chat_rooms:', JSON.stringify(dd).slice(0, 500));
      const rooms = dd.records || dd.chat_rooms || [];
      console.log('[SIGINT] Chat rooms:', rooms.length);
      for (const room of rooms.slice(0, 5)) {
        try {
          const mr = await fetch('/internal_api/chat_rooms/' + room.id + '/messages?page=1&per_page=20', { headers: h, credentials: 'include' });
          if (!mr.ok) continue;
          const md = await mr.json();
          allDms.push(...(md.records || md.messages || []));
        } catch(e) { /* skip */ }
      }
    } else {
      console.log('[SIGINT] chat_rooms:', dr.status);
    }
  } catch(e) { console.error('[SIGINT] DM error:', e); }
  console.log('[SIGINT] DM-y:', allDms.length);

  // 5. Zapisz dane do pobrania
  const payload = JSON.stringify({ posts: allPosts, comments: allComments, dms: allDms });

  // Utwórz link do pobrania pliku JSON
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'circle-data.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  alert('[SIGINT] Pobrano circle-data.json!\\nPosty: ' + allPosts.length + ', Komentarze: ' + allComments.length + ', DM: ' + allDms.length + '\\n\\nTeraz wróć do agenta i wgraj ten plik przyciskiem LOAD FILE.');
})();
`;

  return new Response(script, {
    headers: { 'Content-Type': 'application/javascript' },
  });
};
