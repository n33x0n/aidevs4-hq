import type { APIRoute } from 'astro';
import { solveMainTask, solveSecretTask, solveLLM } from '../../../tasks/timetravel/solver';
import { debugLog } from '../../../lib/debug-log';
import { saveFlag } from '../../../lib/hub-db';
import { createSSEStream } from '../../../lib/sse';

const DEFAULT_MODEL = 'openai/gpt-4o';

function shortModel(id: string): string {
  return (id.split('/').pop() || id).replace(/-\d{8}$/, '');
}

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const models: string[] = body.models?.length ? body.models : [DEFAULT_MODEL];
  const model = models[0];
  const useLLM: boolean = body.debate === true;
  const modelsScope: string = body.modelsScope ?? 'all';

  return createSSEStream(async (send) => {
    const onStep = (step: string) => {
      debugLog('timetravel', step);
      send('log', { message: step });
    };

    const flags: string[] = [];
    let llmPromptTokens = 0;
    let llmCompletionTokens = 0;

    const trackUsage = (u: { model: string; promptTokens: number; completionTokens: number }) => {
      llmPromptTokens += u.promptTokens;
      llmCompletionTokens += u.completionTokens;
    };

    const displayModel = useLLM ? shortModel(model) : 'deterministic';
    send('model', { model: displayModel, name: displayModel, phase: 'main', index: 1, total: 1 });

    if (modelsScope !== 'main') {
      const secretResult = await solveSecretTask(onStep);
      if (secretResult.flag) {
        flags.push(secretResult.flag);
        saveFlag('timetravel', secretResult.flag, 'secret');
        onStep(`FLAGA SEKRETNA: ${secretResult.flag}`);
      }
    }

    if (modelsScope !== 'secrets') {
      let result: { flag?: string };
      if (useLLM) {
        result = await solveLLM(onStep, model, trackUsage);
      } else {
        result = await solveMainTask(onStep);
      }
      if (result.flag) {
        flags.push(result.flag);
        saveFlag('timetravel', result.flag, 'main');
        onStep(`FLAGA GŁÓWNA: ${result.flag}`);
      }
    }

    send('usage', {
      model: useLLM ? model : 'deterministic',
      promptTokens: llmPromptTokens,
      completionTokens: llmCompletionTokens,
    });

    send('result', {
      success: flags.length > 0,
      flag: flags.join(' | '),
      message: flags.length > 0
        ? `Znaleziono ${flags.length} flag(i): ${flags.join(', ')}`
        : 'Brak flag — zaimplementuj solver',
    });
  });
};
