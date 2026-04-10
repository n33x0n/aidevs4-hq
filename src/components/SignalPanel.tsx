import { useState, useEffect } from 'react';
import { readSSEStream } from '../lib/useSSE';

interface CirclePost {
  id: string;
  title?: string;
  content: string;
  author: string;
  timestamp: string;
  spaceId?: string;
  spaceName?: string;
  read: boolean;
  likes: number;
}

interface CircleComment {
  id: string;
  postId: string;
  content: string;
  author: string;
  timestamp: string;
  read: boolean;
  likes: number;
}

interface CircleMessage {
  id: string;
  conversationId: string;
  content: string;
  author: string;
  timestamp: string;
  read: boolean;
}

type ActiveSection = 'posts' | 'comments' | 'dms';

const LS_POSTS_KEY = 'sigint_posts';
const LS_COMMENTS_KEY = 'sigint_comments';
const LS_DMS_KEY = 'sigint_dms';
const LS_AUTH_KEY = 'sigint_auth';

export default function SignalPanel() {
  // Auth state
  const [sessionCookie, setSessionCookie] = useState('');
  const [showManualCookie, setShowManualCookie] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Data state
  const [posts, setPosts] = useState<CirclePost[]>([]);
  const [comments, setComments] = useState<CircleComment[]>([]);
  const [dms, setDms] = useState<CircleMessage[]>([]);
  const [activeSection, setActiveSection] = useState<ActiveSection>('posts');
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [syncError, setSyncError] = useState('');

  // Filters
  const [filter, setFilter] = useState<'all' | 'unread' | 'review'>('all');
  const [scraperScript, setScraperScript] = useState('');

  // Load cached auth + data after hydration
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const cachedAuth = localStorage.getItem(LS_AUTH_KEY);
        if (cachedAuth) {
          const { email: cachedEmail } = JSON.parse(cachedAuth);
          setAuthEmail(cachedEmail);
          setLoggedIn(true);
          loadCachedData();

          // Odtwórz sesję serwerową z .env (singleton resetuje się przy hot-reload)
          const restoreRes = await fetch('/api/circle/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'load_env' }),
          }).catch(() => null);
          console.log('[SIGINT] Auto-restored server session from .env');

        }
      } catch { /* ignore */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function loadCachedData() {
    try {
      const postsData = JSON.parse(localStorage.getItem(LS_POSTS_KEY) || '{"items":[],"lastSync":null}');
      const commentsData = JSON.parse(localStorage.getItem(LS_COMMENTS_KEY) || '{"items":[],"lastSync":null}');
      const dmsData = JSON.parse(localStorage.getItem(LS_DMS_KEY) || '{"items":[],"lastSync":null}');
      setPosts(postsData.items || []);
      setComments(commentsData.items || []);
      setDms(dmsData.items || []);
      setLastSync(postsData.lastSync || null);
    } catch { /* ignore */ }
  }

  async function handleAuth(action: 'load_env' | 'use_session') {
    if (action === 'use_session' && !sessionCookie) {
      setAuthError('Wklej session cookie');
      return;
    }

    setAuthLoading(true);
    setAuthError('');

    try {
      const payload: Record<string, string> = { action };
      if (action === 'use_session') payload.sessionCookie = sessionCookie;

      console.log(`[SIGINT] Auth action: ${action}...`);
      const res = await fetch('/api/circle/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      console.log('[SIGINT] Response status:', res.status);

      if (!res.ok) {
        const text = await res.text();
        setAuthError(`Auth failed: ${res.status} ${text.slice(0, 100)}`);
        return;
      }

      const data = (await res.json()) as { success: boolean; error?: string; email?: string };
      console.log('[SIGINT] Auth response:', data);

      if (!data.success) {
        setAuthError(data.error || 'Nie udało się załadować sesji');
        return;
      }

      const email = data.email || 'user';
      localStorage.setItem(LS_AUTH_KEY, JSON.stringify({ email }));
      setAuthEmail(email);
      setLoggedIn(true);
      setSessionCookie('');
      console.log('[SIGINT] Sesja załadowana pomyślnie');
      loadCachedData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[SIGINT] Auth error:', msg, err);
      setAuthError(`Błąd: ${msg}`);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/circle/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      });
    } catch { /* ignore */ }

    localStorage.removeItem(LS_AUTH_KEY);
    setLoggedIn(false);
    setAuthEmail('');
    setPosts([]);
    setComments([]);
    setDms([]);
  }

  async function handleSync() {
    console.log('[SIGINT] Rozpoczynam sync...');
    setSyncing(true);
    setSyncError('');

    try {
      const res = await fetch('/api/circle/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      console.log('[SIGINT] Sync response status:', res.status);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('[SIGINT] Sync failed:', res.status, text.slice(0, 200));
        setSyncError(`Sync failed: ${res.status} — ${text.slice(0, 100)}`);
        setSyncing(false);
        return;
      }

      // SSE stream
      if (!res.body) throw new Error('No response body');

      let newPosts: CirclePost[] = [...posts];
      let newComments: CircleComment[] = [...comments];
      let newDms: CircleMessage[] = [...dms];

      await readSSEStream(res, {
        data: (data) => {
          const { type, items } = data as { type: string; items: any[] };
          console.log(`[SIGINT] Otrzymano ${type}: ${items.length} elementów`);
          if (type === 'posts') {
            newPosts = mergeItems(newPosts, items, 200);
          } else if (type === 'comments') {
            newComments = mergeItems(newComments, items, 200);
          } else if (type === 'dms') {
            newDms = mergeItems(newDms, items, 200);
          }
        },
        log: (data) => console.log('[SIGINT]', data.message),
      });

      const now = Date.now();
      setPosts(newPosts);
      setComments(newComments);
      setDms(newDms);
      setLastSync(now);

      // Zapisz cache
      localStorage.setItem(LS_POSTS_KEY, JSON.stringify({ items: newPosts, lastSync: now }));
      localStorage.setItem(LS_COMMENTS_KEY, JSON.stringify({ items: newComments, lastSync: now }));
      localStorage.setItem(LS_DMS_KEY, JSON.stringify({ items: newDms, lastSync: now }));
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  function mergeItems<T extends { id: string }>(
    existing: T[],
    newItems: T[],
    maxSize: number
  ): T[] {
    const map = new Map<string, T>();
    existing.forEach((item) => map.set(item.id, item));
    newItems.forEach((item) => map.set(item.id, item));
    return Array.from(map.values()).slice(0, maxSize);
  }

  const filteredData = {
    posts: posts.filter((p) => {
      if (filter === 'unread') return !p.read;
      if (filter === 'review') return !p.read && (p.likes || 0) === 0; // dummy logic
      return true;
    }),
    comments: comments.filter((c) => {
      if (filter === 'unread') return !c.read;
      if (filter === 'review') return !c.read;
      return true;
    }),
    dms: dms.filter((d) => {
      if (filter === 'unread') return !d.read;
      return true;
    }),
  };

  const unreadCount = posts.filter((p) => !p.read).length;

  async function handleAction(type: 'like' | 'reply' | 'read' | 'review', targetId: string, content?: string) {
    try {
      const res = await fetch('/api/circle/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, targetId, content }),
      });

      const data = (await res.json()) as { success: boolean; error?: string };

      if (!data.success) {
        console.error(`Action ${type} failed:`, data.error);
        return;
      }

      // Optimistic update — zaznacz jako read
      if (type === 'read' && activeSection === 'posts') {
        setPosts((p) => p.map((post) => (post.id === targetId ? { ...post, read: true } : post)));
      }
      if (type === 'like' && activeSection === 'posts') {
        setPosts((p) => p.map((post) => (post.id === targetId ? { ...post, likes: post.likes + 1 } : post)));
      }
    } catch (err) {
      console.error('Action error:', err);
    }
  }

  return (
    <div className="space-y-4">
      {/* Login form — jeśli !loggedIn */}
      {!loggedIn && (
        <div className="bg-dark-800 border border-dark-600 rounded-lg p-6 space-y-4 max-w-md">
          <label className="block text-sm font-medium text-gray-400 uppercase tracking-wider">
            Circle.so Session
          </label>

          {/* Główny przycisk — załaduj z .env */}
          <button
            onClick={() => handleAuth('load_env')}
            disabled={authLoading}
            className="w-full bg-neon-green/10 border border-neon-green text-neon-green hover:bg-neon-green/20 disabled:opacity-50 px-3 py-2 rounded-md text-sm font-mono transition-colors"
          >
            {authLoading ? 'Łączę...' : 'CONNECT (saved session)'}
          </button>

          {/* Toggle ręcznego wklejania */}
          <button
            onClick={() => setShowManualCookie(!showManualCookie)}
            className="text-gray-500 hover:text-gray-300 text-xs font-mono transition-colors"
          >
            {showManualCookie ? '▾ ukryj manual cookie' : '▸ wklej cookie ręcznie'}
          </button>

          {showManualCookie && (
            <>
              <textarea
                placeholder="Wklej wartość _circle_session cookie z Safari DevTools"
                value={sessionCookie}
                onChange={(e) => setSessionCookie(e.target.value)}
                className="w-full bg-dark-700 border border-dark-600 rounded-md px-3 py-2 text-gray-100 font-mono text-xs focus:outline-none focus:border-neon-green transition-colors h-20 resize-none"
              />
              <button
                onClick={() => handleAuth('use_session')}
                disabled={authLoading || !sessionCookie}
                className="w-full bg-dark-700 border border-dark-600 text-gray-300 hover:border-neon-green/50 disabled:opacity-50 px-3 py-2 rounded-md text-sm font-mono transition-colors"
              >
                CONNECT (pasted cookie)
              </button>
            </>
          )}

          {authError && (
            <div className="text-red-400 text-xs bg-red-900/20 border border-red-700 rounded px-2 py-1">
              {authError}
            </div>
          )}
        </div>
      )}

      {/* Logged in state */}
      {loggedIn && (
        <>
          {/* Header */}
          <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 flex items-center justify-between">
            <div className="text-sm font-mono text-gray-300">
              <span className="text-neon-green">{authEmail}</span>
              {lastSync && (
                <span className="text-gray-500 ml-4">
                  · ostatni sync: {new Date(lastSync).toLocaleString('pl-PL', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (scraperScript) { setScraperScript(''); return; }
                  const res = await fetch('/api/circle/scraper');
                  setScraperScript(await res.text());
                }}
                className="bg-cyan-900/20 border border-cyan-600 text-cyan-400 hover:bg-cyan-900/30 px-3 py-1 rounded text-xs font-mono transition-colors"
              >
                {scraperScript ? 'HIDE SCRIPT' : 'FETCH SCRIPT'}
              </button>
              <label className="bg-cyan-900/20 border border-cyan-600 text-cyan-400 hover:bg-cyan-900/30 px-3 py-1 rounded text-xs font-mono transition-colors cursor-pointer">
                LOAD FILE
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const text = await file.text();
                      const data = JSON.parse(text);
                      console.log('[SIGINT] Wczytano plik:', { posts: data.posts?.length, comments: data.comments?.length, dms: data.dms?.length });
                      const res = await fetch('/api/circle/push', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: text,
                      });
                      const result = await res.json();
                      console.log('[SIGINT] Push result:', result);
                      if (result.success) handleSync();
                    } catch (err) {
                      console.error('[SIGINT] Load file error:', err);
                    }
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="bg-neon-green/10 border border-neon-green text-neon-green hover:bg-neon-green/20 disabled:opacity-50 px-3 py-1 rounded text-xs font-mono transition-colors"
              >
                {syncing ? 'SYNCING...' : 'SYNC ↺'}
              </button>
              <button
                onClick={handleLogout}
                className="bg-red-900/10 border border-red-700 text-red-400 hover:bg-red-900/20 px-3 py-1 rounded text-xs font-mono transition-colors"
              >
                LOGOUT
              </button>
            </div>
          </div>

          {/* Scraper script */}
          {scraperScript && (
            <div className="bg-dark-800 border border-cyan-800 rounded-lg p-4 space-y-2">
              <div className="text-cyan-400 text-xs font-mono">
                1. Otwórz bravecourses.circle.so → 2. Cmd+Option+C (konsola) → 3. Zaznacz wszystko poniżej (Cmd+A w polu), wklej w konsolę, Enter → 4. Kliknij SYNC
              </div>
              <textarea
                readOnly
                value={scraperScript}
                onFocus={(e) => e.target.select()}
                className="w-full bg-dark-900 border border-dark-600 rounded px-3 py-2 text-gray-300 font-mono text-xs h-32 resize-none focus:outline-none focus:border-cyan-600"
              />
            </div>
          )}

          {/* Sync error */}
          {syncError && (
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 text-red-300 text-xs font-mono">
              {syncError}
            </div>
          )}

          {/* Section tabs */}
          <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-4 font-mono text-xs">
                <button
                  onClick={() => setActiveSection('posts')}
                  className={`pb-2 transition-colors ${
                    activeSection === 'posts'
                      ? 'border-b-2 border-neon-green text-neon-green'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  POSTY
                </button>
                <button
                  onClick={() => setActiveSection('comments')}
                  className={`pb-2 transition-colors ${
                    activeSection === 'comments'
                      ? 'border-b-2 border-neon-green text-neon-green'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  KOMENTARZE
                </button>
                <button
                  onClick={() => setActiveSection('dms')}
                  className={`pb-2 transition-colors ${
                    activeSection === 'dms'
                      ? 'border-b-2 border-neon-green text-neon-green'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  WIADOMOŚCI
                </button>
              </div>

              {/* Filters */}
              <div className="flex gap-2 font-mono text-xs">
                {['all', 'unread', 'review'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f as typeof filter)}
                    className={`px-2 py-1 rounded transition-colors ${
                      filter === f
                        ? 'bg-neon-green/20 border border-neon-green text-neon-green'
                        : 'border border-dark-500 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {f === 'all' ? 'Wszystko' : f === 'unread' ? `Nieprzeczytane (${unreadCount})` : 'Do przejrzenia'}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {activeSection === 'posts' && (
                <>
                  {filteredData.posts.length === 0 ? (
                    <div className="text-gray-500 text-xs text-center py-6">Brak postów</div>
                  ) : (
                    filteredData.posts.map((post) => (
                      <div
                        key={post.id}
                        className={`border rounded-lg p-3 text-xs font-mono cursor-pointer transition-colors ${
                          post.read
                            ? 'border-dark-500 bg-dark-700/50 text-gray-400'
                            : 'border-neon-green/30 bg-dark-700 text-gray-100'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="font-semibold text-neon-green">{post.author}</span>
                          <span className="text-gray-500">{post.timestamp}</span>
                        </div>
                        {post.spaceName && (
                          <div className="text-gray-500 mb-1 text-[11px]">{post.spaceName}</div>
                        )}
                        <div className="line-clamp-2 mb-2">{post.content}</div>
                        <div className="flex gap-2 text-[10px]">
                          <button
                            onClick={() => handleAction('like', post.id)}
                            className="hover:text-neon-green transition-colors"
                          >
                            LIKE ♡ {post.likes}
                          </button>
                          <button
                            onClick={() => handleAction('reply', post.id)}
                            className="hover:text-neon-green transition-colors"
                          >
                            REPLY
                          </button>
                          <button
                            onClick={() => handleAction('review', post.id)}
                            className="hover:text-amber-400 transition-colors"
                          >
                            REVIEW ★
                          </button>
                          <button
                            onClick={() => handleAction('read', post.id)}
                            className="hover:text-neon-green transition-colors"
                          >
                            READ ✓
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}

              {activeSection === 'comments' && (
                <>
                  {filteredData.comments.length === 0 ? (
                    <div className="text-gray-500 text-xs text-center py-6">Brak komentarzy</div>
                  ) : (
                    filteredData.comments.map((comment) => (
                      <div
                        key={comment.id}
                        className={`border rounded-lg p-3 text-xs font-mono cursor-pointer transition-colors ${
                          comment.read
                            ? 'border-dark-500 bg-dark-700/50 text-gray-400'
                            : 'border-neon-green/30 bg-dark-700 text-gray-100'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="font-semibold text-neon-green">{comment.author}</span>
                          <span className="text-gray-500">{comment.timestamp}</span>
                        </div>
                        <div className="line-clamp-2 mb-2">{comment.content}</div>
                        <div className="flex gap-2 text-[10px]">
                          <button
                            onClick={() => handleAction('like', comment.id)}
                            className="hover:text-neon-green transition-colors"
                          >
                            LIKE ♡ {comment.likes}
                          </button>
                          <button
                            onClick={() => handleAction('reply', comment.id)}
                            className="hover:text-neon-green transition-colors"
                          >
                            REPLY
                          </button>
                          <button
                            onClick={() => handleAction('read', comment.id)}
                            className="hover:text-neon-green transition-colors"
                          >
                            READ ✓
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}

              {activeSection === 'dms' && (
                <>
                  {filteredData.dms.length === 0 ? (
                    <div className="text-gray-500 text-xs text-center py-6">Brak wiadomości</div>
                  ) : (
                    filteredData.dms.map((msg) => (
                      <div
                        key={msg.id}
                        className={`border rounded-lg p-3 text-xs font-mono cursor-pointer transition-colors ${
                          msg.read
                            ? 'border-dark-500 bg-dark-700/50 text-gray-400'
                            : 'border-neon-green/30 bg-dark-700 text-gray-100'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="font-semibold text-neon-green">{msg.author}</span>
                          <span className="text-gray-500">{msg.timestamp}</span>
                        </div>
                        <div className="line-clamp-2">{msg.content}</div>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
