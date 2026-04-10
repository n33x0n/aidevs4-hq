import { useState, useEffect, useCallback, type ReactNode } from 'react';
import BootTerminal from './BootTerminal';
import NavHeader from './NavHeader';
import NavFooter from './NavFooter';

// ── Tiptap Types ──────────────────────────────────────────────────────────────
interface TiptapMark {
  type: string;
  attrs?: { href?: string; [k: string]: unknown };
}

interface TiptapNode {
  type: string;
  text?: string;
  circle_ios_fallback_text?: string;
  attrs?: { url?: string; label?: string; [k: string]: unknown };
  marks?: TiptapMark[];
  content?: TiptapNode[];
}

interface ThreadComment {
  id: number;
  parent_comment_id: number | null;
  community_member: { name: string; avatar_url: string | null };
  tiptap_body: {
    body: { type: 'doc'; content: TiptapNode[] };
    circle_ios_fallback_text: string;
    inline_attachments: Array<{ url: string; image_variants?: Record<string, string> }>;
  } | null;
  is_liked: boolean;
  likes_count: number;
  created_at: string;
  replies?: ThreadComment[];
}

// ── Core Types ────────────────────────────────────────────────────────────────
interface Notification {
  id: number;
  actor_name: string | null;
  notifiable_type: string | null;
  notifiable_title: string | null;
  space_title: string | null;
  created_at: string | null;
  read_at: string | null;
  action_web_url: string | null;
  post_id: number | null;
  topic_id: number | null;
  notifiable_id: number | null;
  comment_text: string | null;
  is_liked: number;
  likes_count: number;
  comment_updated_at: string | null;
  comment_images: string[];
  thread_json: ThreadComment | null;
  mark_for_review: number;
}

interface Counts {
  total: number;
  unread: number;
  marked: number;
  liked: number;
  mentioned: number;
}

interface RefreshProgress {
  inProgress: boolean;
  current: number;
  total: number;
  updated: number;
  failed: number;
}

type Filter = 'all' | 'unread' | 'liked' | 'mentioned' | 'review';
type TypeFilter = 'all' | 'comments';

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'teraz';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function getTypeBadge(type: string | null): string {
  if (!type) return 'NOTIFICATION';
  const t = type.toLowerCase();
  if (t.includes('like')) return 'LIKE';
  if (t.includes('mention')) return 'MENTION';
  if (t.includes('reply')) return 'REPLY';
  if (t.includes('comment')) return 'COMMENT';
  if (t.includes('post')) return 'POST';
  return 'NOTIFICATION';
}

function getPreviewText(n: Notification): string {
  if (n.comment_text) return n.comment_text.slice(0, 200);
  if (n.thread_json) {
    const thread = n.thread_json;
    if (thread.id === n.notifiable_id) {
      return thread.tiptap_body?.circle_ios_fallback_text?.slice(0, 200) || '';
    }
    const reply = thread.replies?.find(r => r.id === n.notifiable_id);
    if (reply) return reply.tiptap_body?.circle_ios_fallback_text?.slice(0, 200) || '';
    return thread.tiptap_body?.circle_ios_fallback_text?.slice(0, 200) || '';
  }
  return '';
}

// ── Tiptap Renderer ───────────────────────────────────────────────────────────
function renderTiptapContent(nodes: TiptapNode[]): ReactNode {
  if (!nodes || nodes.length === 0) return null;
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'doc':
        return node.content ? <div key={i}>{renderTiptapContent(node.content)}</div> : null;
      case 'paragraph':
        return (
          <p key={i} className="mb-2 text-post text-gray-300 last:mb-0 font-mono">
            {node.content ? renderTiptapContent(node.content) : null}
          </p>
        );
      case 'text': {
        let el: ReactNode = node.text || '';
        if (node.marks) {
          for (const mark of node.marks) {
            switch (mark.type) {
              case 'bold':
                el = <strong className="font-semibold">{el}</strong>;
                break;
              case 'code':
                el = <code className="bg-dark-700 px-1 rounded font-mono text-xs">{el}</code>;
                break;
              case 'italic':
                el = <em>{el}</em>;
                break;
              case 'link':
                el = <a href={mark.attrs?.href} target="_blank" rel="noopener" className="text-neon-green hover:underline">{el}</a>;
                break;
            }
          }
        }
        return <span key={i}>{el}</span>;
      }
      case 'hardBreak':
        return <br key={i} />;
      case 'image':
        return <img key={i} src={node.attrs?.url as string} alt="" className="max-w-full rounded-lg my-2" loading="lazy" />;
      case 'mention': {
        const raw = String(node.attrs?.label || node.circle_ios_fallback_text || 'unknown');
        const name = raw.replace(/^@+/, '');
        return <span key={i} className="text-neon-green font-medium">@{name}</span>;
      }
      case 'bullet_list':
      case 'bulletList':
        return <ul key={i} className="list-disc pl-4 mb-2">{node.content ? renderTiptapContent(node.content) : null}</ul>;
      case 'ordered_list':
      case 'orderedList':
        return <ol key={i} className="list-decimal pl-4 mb-2">{node.content ? renderTiptapContent(node.content) : null}</ol>;
      case 'list_item':
      case 'listItem':
        return <li key={i} className="text-sm text-gray-300">{node.content ? renderTiptapContent(node.content) : null}</li>;
      case 'codeBlock':
      case 'code_block':
        return (
          <pre key={i} className="bg-dark-700 rounded p-3 mb-2 overflow-x-auto">
            <code className="text-xs font-mono text-gray-300">{node.content ? renderTiptapContent(node.content) : null}</code>
          </pre>
        );
      case 'blockquote':
        return (
          <blockquote key={i} className="border-l-2 border-gray-600 pl-3 mb-2 italic text-gray-400">
            {node.content ? renderTiptapContent(node.content) : null}
          </blockquote>
        );
      case 'heading': {
        const level = (node.attrs as Record<string, unknown>)?.level || 3;
        const cls = (level as number) <= 2 ? 'text-base font-bold' : 'text-sm font-semibold';
        return <div key={i} className={`${cls} text-gray-200 mb-2`}>{node.content ? renderTiptapContent(node.content) : null}</div>;
      }
      default:
        if (node.content) return <div key={i}>{renderTiptapContent(node.content)}</div>;
        if (node.text) return <span key={i}>{node.text}</span>;
        return null;
    }
  });
}

// ── Plain text extractor (for quoting) ────────────────────────────────────────
function extractPlainText(nodes: TiptapNode[]): string {
  if (!nodes) return '';
  return nodes.map(node => {
    if (node.type === 'hardBreak') return '\n';
    if (node.text) return node.text;
    if (node.type === 'mention') {
      const raw = String(node.attrs?.label || node.circle_ios_fallback_text || '');
      return '@' + raw.replace(/^@+/, '');
    }
    if (node.content) return extractPlainText(node.content);
    return '';
  }).join('');
}

function getQuoteText(comment: ThreadComment): string {
  const author = comment.community_member?.name || 'Unknown';
  const body = comment.tiptap_body?.body?.content;
  const text = body && body.length > 0
    ? extractPlainText(body).trim()
    : (comment.tiptap_body?.circle_ios_fallback_text || '').trim();
  const firstLine = text.split('\n')[0].slice(0, 200);
  return `> @${author}: ${firstLine}\n`;
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  const initial = (name || '?')[0].toUpperCase();
  if (avatarUrl) {
    const fullUrl = avatarUrl.startsWith('http') ? avatarUrl : `https://bravecourses.circle.so${avatarUrl}`;
    return <img src={fullUrl} alt={name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />;
  }
  return (
    <div className="w-7 h-7 rounded-full bg-dark-600 flex items-center justify-center text-gray-400 font-mono text-xs flex-shrink-0">
      {initial}
    </div>
  );
}

// ── Comment Item (thread) ─────────────────────────────────────────────────────
function CommentItem({ comment, highlighted, onQuote }: { comment: ThreadComment; highlighted: boolean; onQuote?: (comment: ThreadComment) => void }) {
  const body = comment.tiptap_body?.body?.content;
  const fallback = comment.tiptap_body?.circle_ios_fallback_text;

  return (
    <div className={`group/comment py-2 ${highlighted ? 'border-l-2 border-l-neon-green bg-neon-green/5 pl-3 -ml-0.5 rounded-r' : ''}`}>
      <div className="flex items-center gap-2 mb-1">
        <Avatar name={comment.community_member?.name || '?'} avatarUrl={comment.community_member?.avatar_url} />
        <span className="text-xs font-medium text-gray-300">{comment.community_member?.name || 'Unknown'}</span>
        <span className="text-xs text-gray-600 font-mono">{timeAgo(comment.created_at)}</span>
        {highlighted && <span className="text-xs text-neon-green font-mono">★</span>}
        {comment.likes_count > 0 && <span className="text-xs text-gray-500">❤️ {comment.likes_count}</span>}
        {onQuote && (
          <button
            onClick={(e) => { e.stopPropagation(); onQuote(comment); }}
            className="opacity-0 group-hover/comment:opacity-100 px-1.5 py-0.5 text-xs font-mono text-gray-500 hover:text-neon-green transition"
            title="Cytuj"
          >
            QUOTE
          </button>
        )}
      </div>
      <div>
        {body && body.length > 0
          ? renderTiptapContent(body)
          : fallback
            ? <p className="text-post text-gray-300 font-mono">{fallback}</p>
            : <p className="text-xs text-gray-600 italic">Brak treści</p>
        }
      </div>
    </div>
  );
}

// ── Thread View ───────────────────────────────────────────────────────────────
function ThreadView({ thread, highlightId, onQuote }: { thread: ThreadComment; highlightId: number | null; onQuote?: (comment: ThreadComment) => void }) {
  return (
    <div className="border border-dark-600 bg-dark-800/50 rounded-lg p-3 mt-2">
      <CommentItem comment={thread} highlighted={thread.id === highlightId} onQuote={onQuote} />
      {thread.replies && thread.replies.length > 0 && (
        <div className="border-l-2 border-dark-600 ml-4 pl-4 mt-1 space-y-1">
          {thread.replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} highlighted={reply.id === highlightId} onQuote={onQuote} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function NotificationsPanel() {
  const [bootTerminal, setBootTerminal] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, unread: 0, marked: 0, liked: 0, mentioned: 0 });
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [filter, setFilter] = useState<Filter>('unread');
  const typeFilter: TypeFilter = 'all';
  const [spaceFilter, setSpaceFilter] = useState('all');
  const [spaces, setSpaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<RefreshProgress | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<number, string>>({});
  const [replying, setReplying] = useState<number | null>(null);

  // ── Fetch notifications ───────────────────────────────────────────────────
  const fetchNotifications = useCallback(async (page: number, f: Filter, type: TypeFilter = 'all', space: string = 'all') => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), filter: f, type, space });
      const res = await fetch(`/api/notifications?${params}`);
      const data = await res.json();
      setNotifications(data.notifications || []);
      setCounts(data.counts || { total: 0, unread: 0, marked: 0, liked: 0, mentioned: 0 });
      setTotalPages(data.totalPages || 1);
      setCurrentPage(data.currentPage || 1);
      if (data.spaces) setSpaces(data.spaces);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchNotifications(currentPage, filter, typeFilter, spaceFilter);
  }, [currentPage, filter, typeFilter, spaceFilter, fetchNotifications]);

  // ── Sync from Circle ──────────────────────────────────────────────────────
  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch('/api/notifications/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 200 }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await fetchNotifications(1, filter, typeFilter, spaceFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    }
    setSyncing(false);
  };

  // ── Refresh comments ──────────────────────────────────────────────────────
  const handleRefreshComments = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/notifications/refresh-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 150 }),
      });
      const data = await res.json();
      if (!data.success && data.error !== 'Refresh already in progress') throw new Error(data.error);

      const poll = setInterval(async () => {
        const pRes = await fetch('/api/notifications/refresh-comments');
        const progress = await pRes.json() as RefreshProgress;
        setRefreshProgress(progress);
        if (!progress.inProgress) {
          clearInterval(poll);
          setRefreshing(false);
          setRefreshProgress(null);
          fetchNotifications(currentPage, filter, typeFilter, spaceFilter);
        }
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
      setRefreshing(false);
    }
  };

  // ── Like / Unlike toggle ─────────────────────────────────────────────────
  const handleToggleLike = async (id: number, currentlyLiked: boolean) => {
    try {
      const res = await fetch(`/api/notifications/${id}/like`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === id
              ? { ...n, is_liked: data.isLiked ? 1 : 0, likes_count: data.likesCount, ...(data.isLiked ? { read_at: new Date().toISOString() } : {}) }
              : n,
          ),
        );
        if (!currentlyLiked) {
          setCounts((c) => ({ ...c, unread: Math.max(0, c.unread - 1), liked: c.liked + 1 }));
        } else {
          setCounts((c) => ({ ...c, liked: Math.max(0, c.liked - 1) }));
        }
      }
    } catch { /* ignore */ }
  };

  // ── Toggle review ─────────────────────────────────────────────────────────
  const handleToggleReview = async (id: number) => {
    try {
      const res = await fetch(`/api/notifications/${id}/toggle-review`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, mark_for_review: data.markForReview } : n)),
        );
        setCounts((c) => ({
          ...c,
          marked: c.marked + (data.markForReview ? 1 : -1),
        }));
      }
    } catch { /* ignore */ }
  };

  // ── Mark as read ──────────────────────────────────────────────────────────
  const handleMarkRead = async (id: number) => {
    try {
      const res = await fetch(`/api/notifications/${id}/mark-read`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        setCounts((c) => ({ ...c, unread: Math.max(0, c.unread - 1) }));
        if (expandedId === id) setExpandedId(null);
      }
    } catch { /* ignore */ }
  };

  // ── Reply ─────────────────────────────────────────────────────────────────
  const handleReply = async (id: number) => {
    const text = replyText[id]?.trim();
    if (!text) return;
    setReplying(id);
    try {
      const res = await fetch(`/api/notifications/${id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.success) {
        setReplyText((prev) => ({ ...prev, [id]: '' }));
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
        );
        setCounts((c) => ({ ...c, unread: Math.max(0, c.unread - 1) }));
      } else {
        setError(data.error || 'Reply failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reply failed');
    }
    setReplying(null);
  };

  // ── Quote ──────────────────────────────────────────────────────────────────
  const handleQuote = (notificationId: number, comment: ThreadComment) => {
    const quote = getQuoteText(comment);
    setReplyText(prev => ({
      ...prev,
      [notificationId]: (prev[notificationId] || '') + quote,
    }));
  };

  // ── Expand/load comment ───────────────────────────────────────────────────
  const handleExpand = async (n: Notification) => {
    if (expandedId === n.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(n.id);

    // If no cached comment and no thread, try fetching
    if (!n.comment_text && !n.thread_json && n.post_id && n.notifiable_id) {
      try {
        const res = await fetch(`/api/notifications/${n.id}/comment`);
        const data = await res.json();
        if (data.commentText) {
          setNotifications((prev) =>
            prev.map((x) =>
              x.id === n.id
                ? {
                    ...x,
                    comment_text: data.commentText,
                    is_liked: data.isLiked ? 1 : 0,
                    likes_count: data.likesCount,
                    comment_images: data.commentImages || [],
                  }
                : x,
            ),
          );
        }
      } catch { /* ignore */ }
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col">
      <NavHeader activeTab="SIGINT" />

      {/* Filters + actions */}
      <div className="max-w-6xl mx-auto w-full px-6 py-3 flex items-center gap-3 flex-wrap">
        {/* Main filters */}
        <div className="flex gap-1 bg-dark-800 rounded p-0.5">
          {([
            ['all', `All (${counts.total})`],
            ['unread', `Unread (${counts.unread})`],
            ['liked', `Liked (${counts.liked})`],
            ['mentioned', `@ (${counts.mentioned})`],
            ['review', `Review (${counts.marked})`],
          ] as const).map(([f, label]) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setCurrentPage(1); }}
              className={`px-3 py-1 text-xs font-mono rounded transition ${
                filter === f
                  ? 'bg-neon-green/15 text-neon-green'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Space filter */}
        {spaces.length > 0 && (
          <select
            value={spaceFilter}
            onChange={(e) => { setSpaceFilter(e.target.value); setCurrentPage(1); }}
            className="bg-dark-800 border border-dark-600 text-gray-400 text-xs font-mono rounded px-2 py-1.5 focus:outline-none focus:border-neon-green"
          >
            <option value="all">ALL SPACES</option>
            {spaces.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

        {error && <span className="text-xs text-red-400 font-mono">{error}</span>}

        {/* Action buttons */}
        <div className="flex items-center gap-2 ml-auto">
          <a
            href="/notifications/stats"
            className="px-3 py-1.5 text-xs font-mono bg-dark-700 text-gray-400 hover:text-white border border-dark-600 hover:border-gray-500 rounded transition"
          >
            STATS
          </a>
          <button
            onClick={handleRefreshComments}
            disabled={refreshing}
            className="px-3 py-1.5 text-xs font-mono bg-dark-700 text-gray-400 hover:text-white border border-dark-600 hover:border-gray-500 rounded transition disabled:opacity-50"
          >
            {refreshing ? `REFRESH ${refreshProgress?.current ?? 0}/${refreshProgress?.total ?? '?'}` : 'REFRESH'}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-3 py-1.5 text-xs font-mono bg-neon-green/10 text-neon-green border border-neon-green/30 hover:bg-neon-green/20 rounded transition disabled:opacity-50"
          >
            {syncing ? 'SYNCING...' : 'SYNC'}
          </button>
        </div>
      </div>

      {/* Notifications list */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 pb-6">
        {loading && notifications.length === 0 ? (
          <div className="text-center text-gray-500 py-12 font-mono text-sm">Loading...</div>
        ) : notifications.length === 0 ? (
          <div className="text-center text-gray-500 py-12 font-mono text-sm">
            Brak powiadomień. Kliknij SYNC aby pobrać z Circle.so
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => {
              const isExpanded = expandedId === n.id;
              const isUnread = !n.read_at && !n.is_liked;
              const badge = getTypeBadge(n.notifiable_type);
              const preview = getPreviewText(n);
              const leftBorder = n.mark_for_review
                ? 'border-l-2 border-l-amber-400'
                : isUnread
                  ? 'border-l-2 border-l-neon-green'
                  : '';

              return (
                <div
                  key={n.id}
                  className={`border border-dark-700 rounded-lg overflow-hidden transition ${
                    isUnread ? 'bg-dark-800' : 'bg-dark-800/50'
                  } ${leftBorder}`}
                >
                  {/* Collapsed header */}
                  <div
                    className="px-4 py-3 cursor-pointer hover:bg-dark-700/30 transition"
                    onClick={() => handleExpand(n)}
                  >
                    {/* Breadcrumb + badge row */}
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-gray-500 font-mono truncate">
                        {n.space_title || 'Circle'}
                        {n.notifiable_title && <> <span className="text-gray-600">›</span> {n.notifiable_title}</>}
                      </span>
                      <span className="bg-dark-700 text-gray-500 text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0 ml-2">
                        {badge}
                      </span>
                    </div>

                    {/* Author + meta row */}
                    <div className="flex items-center gap-2">
                      <Avatar name={n.actor_name || '?'} />
                      <span className={`text-sm font-medium ${isUnread ? 'text-gray-200' : 'text-gray-400'}`}>
                        {n.actor_name || 'Unknown'}
                      </span>
                      <span className="text-xs text-gray-600 font-mono ml-auto">
                        {timeAgo(n.created_at)}
                      </span>
                      {n.likes_count > 0 && (
                        <span className="text-xs text-gray-500">❤️ {n.likes_count}</span>
                      )}
                      {n.mark_for_review ? <span className="text-xs text-amber-400">★</span> : null}
                    </div>

                    {/* Preview */}
                    {preview && !isExpanded && (
                      <p className={`text-sm mt-1.5 line-clamp-2 ${isUnread ? 'text-gray-400' : 'text-gray-500'}`}>
                        {preview}
                      </p>
                    )}
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="border-t border-dark-700 px-4 py-3">
                      {/* Thread view */}
                      {n.thread_json ? (
                        <ThreadView thread={n.thread_json} highlightId={n.notifiable_id} onQuote={(comment) => handleQuote(n.id, comment)} />
                      ) : n.comment_text ? (
                        <div className="text-post text-gray-300 whitespace-pre-wrap mb-3 font-mono">
                          {n.comment_text}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-600 font-mono mb-2">
                          {n.post_id && n.notifiable_id ? 'Loading comment...' : 'No comment data'}
                        </div>
                      )}

                      {/* Legacy images (for notifications without thread_json) */}
                      {!n.thread_json && n.comment_images && n.comment_images.length > 0 && (
                        <div className="flex gap-2 flex-wrap mb-3 mt-2">
                          {n.comment_images.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noopener">
                              <img src={url} alt="" className="max-w-xs rounded-lg border border-dark-600 hover:border-neon-green transition" />
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Reply input */}
                      <div className="mt-3 flex gap-2">
                        <input
                          type="text"
                          value={replyText[n.id] || ''}
                          onChange={(e) => setReplyText((prev) => ({ ...prev, [n.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(n.id); } }}
                          onClick={(e) => e.stopPropagation()}
                          placeholder="Napisz odpowiedź..."
                          className="flex-1 bg-dark-700 border border-dark-600 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 font-mono focus:outline-none focus:border-neon-green transition"
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleReply(n.id); }}
                          disabled={replying === n.id || !replyText[n.id]?.trim()}
                          className="px-3 py-1.5 text-xs font-mono bg-neon-green/10 text-neon-green border border-neon-green/30 hover:bg-neon-green/20 rounded transition disabled:opacity-30"
                        >
                          {replying === n.id ? '...' : 'REPLY'}
                        </button>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 mt-2">
                        {n.action_web_url && (
                          <a
                            href={n.action_web_url}
                            target="_blank"
                            rel="noopener"
                            className="px-2 py-1 text-xs font-mono bg-dark-700 text-gray-400 hover:text-neon-green border border-dark-600 rounded transition"
                          >
                            OPEN
                          </a>
                        )}
                        {n.notifiable_id && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleToggleLike(n.id, !!n.is_liked); }}
                            className={`px-2 py-1 text-xs font-mono border rounded transition ${
                              n.is_liked
                                ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
                                : 'bg-dark-700 text-gray-400 hover:text-red-400 border-dark-600'
                            }`}
                          >
                            {n.is_liked ? '❤️ UNLIKE' : '♡ LIKE'}
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleReview(n.id); }}
                          className={`px-2 py-1 text-xs font-mono border rounded transition ${
                            n.mark_for_review
                              ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30'
                              : 'bg-dark-700 text-gray-400 hover:text-yellow-500 border-dark-600'
                          }`}
                        >
                          {n.mark_for_review ? '★ REVIEWED' : '☆ REVIEW'}
                        </button>
                        {isUnread && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMarkRead(n.id); }}
                            className="px-2 py-1 text-xs font-mono bg-dark-700 text-gray-400 hover:text-blue-400 border border-dark-600 rounded transition"
                          >
                            ✓ READ
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && filter !== 'unread' && (
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="px-3 py-1.5 text-xs font-mono bg-dark-700 text-gray-400 border border-dark-600 rounded transition disabled:opacity-30 hover:text-white"
            >
              ← PREV
            </button>
            <span className="text-xs font-mono text-gray-500">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 text-xs font-mono bg-dark-700 text-gray-400 border border-dark-600 rounded transition disabled:opacity-30 hover:text-white"
            >
              NEXT →
            </button>
          </div>
        )}
      </main>

      <NavFooter
        label="SIGINT"
        onEasterEgg={() => setBootTerminal(true)}
        stats={`${counts.total} total · ${counts.unread} unread · ${counts.liked} liked · ${counts.mentioned} mentioned · ${counts.marked} review`}
      />

      {bootTerminal && <BootTerminal onClose={() => setBootTerminal(false)} />}
    </div>
  );
}
