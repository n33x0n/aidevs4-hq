import type { APIRoute } from 'astro';

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
}

let cache: { data: unknown[]; time: number } | null = null;
const TTL = 10 * 60 * 1000;

export const GET: APIRoute = async () => {
  if (cache && Date.now() - cache.time < TTL) {
    return new Response(JSON.stringify(cache.data), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    const json = await res.json();

    const models = (json.data as OpenRouterModel[])
      .filter((m) => m.pricing?.prompt !== undefined)
      .map((m) => ({
        id: m.id,
        name: m.name,
        context_length: m.context_length,
        promptPrice: parseFloat(m.pricing?.prompt || '0') * 1_000_000,
        completionPrice: parseFloat(m.pricing?.completion || '0') * 1_000_000,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    cache = { data: models, time: Date.now() };

    return new Response(JSON.stringify(models), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify([]), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
