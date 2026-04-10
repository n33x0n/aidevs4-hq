// Circle.so API client — pobiera powiadomienia i komentarze z bravecourses.circle.so

const CIRCLE_BASE = 'https://bravecourses.circle.so';
const CIRCLE_COOKIES = import.meta.env.CIRCLE_COOKIES ?? process.env.CIRCLE_COOKIES ?? '';
const CIRCLE_REFERER = `${CIRCLE_BASE}/`;

function getHeaders(): Record<string, string> {
  return {
    'accept': 'application/json',
    'accept-language': 'en-US,en;q=0.5',
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    'pragma': 'no-cache',
    'referer': CIRCLE_REFERER,
    'sec-ch-ua': '"Brave";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    'cookie': CIRCLE_COOKIES,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Notifications ──────────────────────────────────────────────────────────
export interface CircleNotification {
  id: number;
  actor_name: string;
  action?: string;
  notifiable_type?: string;
  notifiable_title?: string;
  space_title?: string;
  created_at: string;
  read_at: string | null;
  action_web_url?: string;
  post_id?: number | null;
  topic_id?: number | null;
  notifiable_id?: number | null;
}

export async function fetchNotifications(limit: number = 100): Promise<CircleNotification[]> {
  if (!CIRCLE_COOKIES) throw new Error('CIRCLE_COOKIES not configured in .env');

  const url = `${CIRCLE_BASE}/notifications?page=1&per_page=${limit}&notification_group=inbox`;
  const res = await fetch(url, { method: 'GET', headers: getHeaders() });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Circle notifications API ${res.status}: ${res.statusText} ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { records: Array<Record<string, unknown>> };

  return data.records.map((r) => ({
    id: r.id as number,
    actor_name: r.actor_name as string,
    action: r.action as string | undefined,
    notifiable_type: (r.action ?? r.notifiable_type) as string | undefined,
    notifiable_title: r.notifiable_title as string | undefined,
    space_title: r.space_title as string | undefined,
    created_at: r.created_at as string,
    read_at: (r.read_at ?? null) as string | null,
    action_web_url: r.action_web_url as string | undefined,
    post_id: (r.post_id ?? null) as number | null,
    topic_id: (r.topic_id ?? null) as number | null,
    notifiable_id: (r.notifiable_id ?? null) as number | null,
  }));
}

// ── Comment details ────────────────────────────────────────────────────────
export interface CommentDetails {
  commentText: string;
  isLiked: boolean;
  likesCount: number;
  threadJson: string;
  commentImages: string[];
}

function extractCommentImages(comment: Record<string, unknown>): string[] {
  const body = comment?.tiptap_body as Record<string, unknown> | undefined;
  const attachments = body?.inline_attachments as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((att) => {
      const variants = att?.image_variants as Record<string, string> | undefined;
      return (att?.url ?? variants?.original) as string | undefined;
    })
    .filter(Boolean) as string[];
}

export async function fetchComment(postId: number, notifiableId: number): Promise<CommentDetails> {
  if (!CIRCLE_COOKIES) throw new Error('CIRCLE_COOKIES not configured in .env');

  const url = `${CIRCLE_BASE}/internal_api/posts/${postId}/comments/${notifiableId}/comment_hierarchy?`;
  const res = await fetch(url, { method: 'GET', headers: getHeaders() });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Circle comment API ${res.status}: ${res.statusText} ${body.slice(0, 200)}`);
  }

  const body = await res.json() as Record<string, unknown>;
  const replies = (body.replies ?? []) as Array<Record<string, unknown>>;
  const comment = (body.id === notifiableId ? body : replies.find((r) => r.id === notifiableId)) ?? body;
  const tiptap = comment?.tiptap_body as Record<string, unknown> | undefined;

  return {
    commentText: (tiptap?.circle_ios_fallback_text ?? '') as string,
    isLiked: (comment?.is_liked ?? false) as boolean,
    likesCount: (comment?.likes_count ?? 0) as number,
    threadJson: JSON.stringify(body),
    commentImages: extractCommentImages(comment as Record<string, unknown>),
  };
}

// ── Like comment ───────────────────────────────────────────────────────────
export async function likeComment(notifiableId: number): Promise<void> {
  const headers = { ...getHeaders(), origin: CIRCLE_BASE };
  const res = await fetch(`${CIRCLE_BASE}/user_likes?`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_likeable_type: 'Comment', user_likeable_id: notifiableId }),
  });
  if (!res.ok) throw new Error(`Like API ${res.status}: ${res.statusText}`);
}

// ── Unlike comment ──────────────────────────────────────────────────────────
export async function unlikeComment(notifiableId: number): Promise<void> {
  const headers = { ...getHeaders(), origin: CIRCLE_BASE };
  const res = await fetch(`${CIRCLE_BASE}/user_likes?`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ user_likeable_type: 'Comment', user_likeable_id: notifiableId }),
  });
  if (!res.ok) throw new Error(`Unlike API ${res.status}: ${res.statusText}`);
}

// ── Mark as read ───────────────────────────────────────────────────────────
export async function markAsReadOnCircle(notificationId: number): Promise<void> {
  const res = await fetch(`${CIRCLE_BASE}/notifications/${notificationId}/mark_as_read`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Mark read API ${res.status}: ${res.statusText}`);
}

// ── Reply to comment ────────────────────────────────────────────────────────
export interface ReplyResult {
  id: number;
  parentCommentId: number | null;
  showUrl: string;
}

export async function replyToComment(postId: number, parentCommentId: number, text: string): Promise<ReplyResult> {
  if (!CIRCLE_COOKIES) throw new Error('CIRCLE_COOKIES not configured in .env');

  const headers = { ...getHeaders(), origin: CIRCLE_BASE };
  const body = {
    comment: {
      tiptap_body: {
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        },
      },
      parent_comment_id: parentCommentId,
    },
  };

  const res = await fetch(`${CIRCLE_BASE}/internal_api/posts/${postId}/comments`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Reply API ${res.status}: ${res.statusText} ${errBody.slice(0, 200)}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return {
    id: data.id as number,
    parentCommentId: (data.parent_comment_id ?? null) as number | null,
    showUrl: (data.show_url ?? '') as string,
  };
}

// ── Batch refresh comments ─────────────────────────────────────────────────
export interface RefreshProgress {
  inProgress: boolean;
  current: number;
  total: number;
  updated: number;
  failed: number;
}

// Singleton progress — odpytywany przez polling z frontendu
export const refreshProgress: RefreshProgress = {
  inProgress: false, current: 0, total: 0, updated: 0, failed: 0,
};

export async function refreshCommentsBatch(
  rows: Array<{ id: number; post_id: number; notifiable_id: number }>,
  onUpdate: (id: number, data: CommentDetails) => void,
  delayMs: number = 200,
) {
  refreshProgress.inProgress = true;
  refreshProgress.current = 0;
  refreshProgress.total = rows.length;
  refreshProgress.updated = 0;
  refreshProgress.failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const details = await fetchComment(row.post_id, row.notifiable_id);
      onUpdate(row.id, details);
      refreshProgress.updated++;
    } catch {
      refreshProgress.failed++;
    }
    refreshProgress.current = i + 1;
    if (i < rows.length - 1 && delayMs > 0) await sleep(delayMs);
  }

  refreshProgress.inProgress = false;
}

export function hasCookies(): boolean {
  return !!CIRCLE_COOKIES;
}
