import type { APIRoute } from 'astro';
import { streamFromAzyl, getAzylInfo } from '../../../lib/azyl';
import { debugLog } from '../../../lib/debug-log';

// GET /api/azyl/tail?file=server.log
// Streamuje (tail -f) plik z Azylu jako SSE i równocześnie zapisuje do lokalnego debugLog
export const GET: APIRoute = async ({ url }) => {
  const file = url.searchParams.get('file') || 'server.log';
  const info = getAzylInfo();

  const encoder = new TextEncoder();
  let cancelStream: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* klient rozłączony */ }
      };

      if (!info.hasPassword) {
        send('error', { message: 'Brak hasła do Azylu' });
        controller.close();
        return;
      }

      const remotePath = file.startsWith('/') ? file : `~/dev/proxy/${file}`;
      send('start', { message: `Tailing: ${remotePath}` });

      let buffer = '';
      let closed = false;

      cancelStream = streamFromAzyl(
        `tail -f ${remotePath} 2>&1`,
        (chunk) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.trim()) {
              debugLog('azyl-server', line);
              send('log', { text: line });
            }
          }
        },
        () => {
          if (!closed) { closed = true; try { controller.close(); } catch { /* ignore */ } }
        },
        (err) => {
          if (!closed) {
            closed = true;
            send('error', { message: err.message });
            try { controller.close(); } catch { /* ignore */ }
          }
        },
      );
    },

    cancel() {
      if (cancelStream) cancelStream();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};
