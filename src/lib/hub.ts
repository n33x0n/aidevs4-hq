import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { debugLog } from './debug-log';
import { logHubRequest, logHubResponse } from './hub-db';

const HUB_URL = import.meta.env.HUB_URL || 'https://hub.ag3nts.org';
const API_KEY = import.meta.env.AIDEVS_API_KEY;
const DATA_DIR = resolve(process.cwd(), 'data');

// Retry z exponential backoff — 3 próby, 1s/2s/4s przerwy
async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
      if (res.status < 500) return res; // 4xx = błąd klienta, nie retry
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

export async function submitAnswer(task: string, answer: unknown) {
  const logPayload = { apikey: '***', task, answer };
  debugLog('hub', `POST /verify → ${JSON.stringify(logPayload)}`);
  logHubRequest(task, logPayload);

  const res = await fetchWithRetry(`${HUB_URL}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: API_KEY, task, answer }),
  });
  const json = await res.json();
  debugLog('hub', `POST /verify ← ${JSON.stringify(json)}`);
  logHubResponse(task, res.status, json);
  return json;
}

export async function fetchData(path: string): Promise<string> {
  debugLog('hub', `GET /data/${path}`);
  logHubRequest('_data', { path });

  const res = await fetchWithRetry(`${HUB_URL}/data/${API_KEY}/${path}`, {});
  const text = await res.text();
  debugLog('hub', `GET /data/${path} ← ${text.length} chars`);
  logHubResponse('_data', res.status, { path, length: text.length });

  // Zapisz kopię do data/
  try {
    const filePath = resolve(DATA_DIR, path);
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, text, 'utf-8');
  } catch (err) {
    debugLog('hub', `Nie udało się zapisać ${path}: ${err instanceof Error ? err.message : err}`);
  }

  return text;
}

export { API_KEY, HUB_URL };
