import type { APIRoute } from 'astro';
import { getDb } from '../../lib/hub-db';
import { ensureTasksRegistered, getAllTasks } from '../../lib/task-registry';

interface TaskStatus {
  id: string;
  name: string;
  lessonCode: string;
  season: number;
  episode: number;
  mainFlag: string | null;
  secretFlag: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
}

interface DashboardData {
  tasks: TaskStatus[];
  totals: {
    mainFlags: number;
    secretFlags: number;
    totalTasks: number;
  };
  usage: {
    totalTokens: number;
    totalCost: number;
    totalCalls: number;
    byModel: Array<{ model: string; tokens: number; cost: number; calls: number }>;
  };
}

export const GET: APIRoute = async () => {
  ensureTasksRegistered();
  const db = getDb();
  const registeredTasks = getAllTasks();

  // Pobierz flagi
  const flags = db.prepare('SELECT task, flag, kind, found_at FROM task_flags ORDER BY found_at').all() as Array<{
    task: string; flag: string; kind: string; found_at: string;
  }>;

  // Pobierz timeline z hub_log
  const timeline = db.prepare(`
    SELECT task, MIN(ts) as first_seen, MAX(ts) as last_seen
    FROM hub_log
    GROUP BY task
  `).all() as Array<{ task: string; first_seen: string; last_seen: string }>;

  const timelineMap = new Map(timeline.map(t => [t.task, t]));

  // Mapa flag per task — zbiera po wszystkich możliwych nazwach
  const flagMap = new Map<string, { main: string | null; secret: string | null }>();
  for (const f of flags) {
    const entry = flagMap.get(f.task) || { main: null, secret: null };
    if (f.kind === 'main' && !entry.main) entry.main = f.flag;
    if (f.kind === 'secret' && !entry.secret) entry.secret = f.flag;
    flagMap.set(f.task, entry);
  }

  // Aliasy: task registry id → nazwy pod którymi mogą być zapisane flagi
  // (np. sendit-llm w rejestrze, ale saveFlag('sendit', ...) w endpoincie)
  const TASK_ALIASES: Record<string, string[]> = {
    'sendit-llm': ['sendit', 'sendit-llm'],
  };

  function lookupFlags(taskId: string) {
    const names = TASK_ALIASES[taskId] || [taskId];
    let main: string | null = null;
    let secret: string | null = null;
    for (const name of names) {
      const entry = flagMap.get(name);
      if (entry) {
        if (!main && entry.main) main = entry.main;
        if (!secret && entry.secret) secret = entry.secret;
      }
    }
    return { main, secret };
  }

  function lookupTimeline(taskId: string) {
    const names = TASK_ALIASES[taskId] || [taskId];
    for (const name of names) {
      const tl = timelineMap.get(name);
      if (tl) return tl;
    }
    return null;
  }

  // Buduj siatke 5x5 — registered tasks + puste sloty
  const tasks: TaskStatus[] = [];
  for (let s = 1; s <= 5; s++) {
    for (let e = 1; e <= 5; e++) {
      const code = `s${String(s).padStart(2, '0')}e${String(e).padStart(2, '0')}`;
      const registered = registeredTasks.find(t => {
        const m = t.name.toUpperCase().match(/S(\d+)E(\d+)/);
        return m && parseInt(m[1]) === s && parseInt(m[2]) === e;
      });
      const taskId = registered?.id || code;
      const flagEntry = lookupFlags(taskId);
      const tl = lookupTimeline(taskId);

      tasks.push({
        id: taskId,
        name: registered?.name || `${code.toUpperCase()} — ???`,
        lessonCode: code,
        season: s,
        episode: e,
        mainFlag: flagEntry.main,
        secretFlag: flagEntry.secret,
        firstSeen: tl?.first_seen || null,
        lastSeen: tl?.last_seen || null,
      });
    }
  }

  // Usage stats
  const usageRow = db.prepare(`
    SELECT
      COALESCE(SUM(prompt_tokens + completion_tokens), 0) as total_tokens,
      COALESCE(SUM(estimated_cost), 0) as total_cost,
      COUNT(*) as total_calls
    FROM usage_log
  `).get() as { total_tokens: number; total_cost: number; total_calls: number };

  const byModel = db.prepare(`
    SELECT
      model,
      SUM(prompt_tokens + completion_tokens) as tokens,
      SUM(estimated_cost) as cost,
      COUNT(*) as calls
    FROM usage_log
    GROUP BY model
    ORDER BY tokens DESC
  `).all() as Array<{ model: string; tokens: number; cost: number; calls: number }>;

  const mainFlags = tasks.filter(t => t.mainFlag).length;
  const secretFlags = tasks.filter(t => t.secretFlag).length;

  const data: DashboardData = {
    tasks,
    totals: {
      mainFlags,
      secretFlags,
      totalTasks: 25,
    },
    usage: {
      totalTokens: usageRow.total_tokens,
      totalCost: usageRow.total_cost,
      totalCalls: usageRow.total_calls,
      byModel,
    },
  };

  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
};
