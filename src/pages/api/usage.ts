import type { APIRoute } from 'astro';
import { getUsageSummary, logUsage } from '../../lib/hub-db';

// GET — pobranie statystyk
export const GET: APIRoute = async () => {
  const summary = getUsageSummary();
  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST — zapis usage event (wywoływany z frontendu)
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const { task, model, promptTokens, completionTokens, estimatedCost } = body;
  if (!task || !model) {
    return new Response(JSON.stringify({ error: 'task and model required' }), { status: 400 });
  }
  logUsage(task, model, promptTokens ?? 0, completionTokens ?? 0, estimatedCost ?? 0);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
