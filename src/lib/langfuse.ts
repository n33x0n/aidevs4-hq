import Langfuse from 'langfuse';

export const langfuse = new Langfuse({
  secretKey: import.meta.env.LANGFUSE_SECRET_KEY,
  publicKey: import.meta.env.LANGFUSE_PUBLIC_KEY,
  baseUrl: import.meta.env.LANGFUSE_BASE_URL,
  // Flush szybko — środowisko SSR, brak długoживущего procesu
  flushAt: 1,
  flushInterval: 0,
});
