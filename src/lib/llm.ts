import OpenAI from 'openai';
export { observeOpenAI } from 'langfuse';

// Surowy klient OpenRouter — wrappowany per-request przez observeOpenAI
export const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: import.meta.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://agentv-hq.local',
    'X-Title': 'AgentV_HQ',
  },
});

// Domyślny model — tani, szybki Gemini Flash
export const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';

// Prompt cache (Anthropic przez OpenRouter).
// OpenAI SDK nie ma typów dla cache_control — wymagane rzutowanie.
// Oznacza stabilny system prompt do cachowania (ephemeral = do 5 min).
export function cachedSystemMessage(text: string): OpenAI.Chat.ChatCompletionSystemMessageParam {
  return {
    role: 'system',
    content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }],
  } as unknown as OpenAI.Chat.ChatCompletionSystemMessageParam;
}
