import type { APIRoute } from 'astro';
import { getAllTasks, ensureTasksRegistered } from '../../../lib/task-registry';

export const GET: APIRoute = async () => {
  ensureTasksRegistered();
  const tasks = getAllTasks();
  return new Response(JSON.stringify(tasks), {
    headers: { 'Content-Type': 'application/json' },
  });
};
