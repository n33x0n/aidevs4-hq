import type { APIRoute } from 'astro';
import { execOnAzyl, getAzylInfo } from '../../../lib/azyl';
import { createSSEStream } from '../../../lib/sse';

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const command = (body.command as string | undefined)?.trim() ?? '';

  return createSSEStream(async (send) => {
    if (!command) {
      send('error', { message: 'Brak komendy' });
      return;
    }

    const info = getAzylInfo();
    if (!info.hasPassword) {
      send('error', { message: 'Brak hasła do Azylu. Dodaj AZYL_PASSWORD=... do pliku .env i zrestartuj dev server.' });
      return;
    }

    const output = await execOnAzyl(command);
    send('output', { text: output });
    send('done', {});
  });
};

export const GET: APIRoute = async () => {
  const info = getAzylInfo();
  return new Response(JSON.stringify(info), {
    headers: { 'Content-Type': 'application/json' },
  });
};
