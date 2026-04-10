import type { APIRoute } from 'astro';
import { getHubLog, getFlags, getTaskStats } from '../../lib/hub-db';

export const GET: APIRoute = async ({ url }) => {
  const action = url.searchParams.get('action') ?? 'log';
  const task = url.searchParams.get('task') ?? undefined;
  const limit = parseInt(url.searchParams.get('limit') ?? '50');

  let data: unknown;
  if (action === 'flags') {
    data = getFlags(task);
  } else if (action === 'stats') {
    data = getTaskStats();
  } else {
    data = getHubLog({ task, limit, direction: url.searchParams.get('direction') ?? undefined });
  }

  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
};
