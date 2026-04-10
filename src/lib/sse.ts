// SSE server utility — eliminuje boilerplate z endpointów streaming
export type SSESend = (event: string, data: unknown) => void;

export function createSSEStream(
  handler: (send: SSESend) => Promise<void>,
  options?: { headers?: Record<string, string> },
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send: SSESend = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* ignore */ }
      };
      try {
        await handler(send);
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : String(err) });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...options?.headers,
    },
  });
}
