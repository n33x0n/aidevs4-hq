// S05E03 — ShellAccess
// TODO: Zaimplementuj solver

type StepCallback = (msg: string) => void;
type UsageCallback = (u: { model: string; promptTokens: number; completionTokens: number }) => void;

export async function solveMainTask(onStep: StepCallback): Promise<{ flag?: string }> {
  onStep('TODO: implement solveMainTask');
  return {};
}

export async function solveSecretTask(onStep: StepCallback): Promise<{ flag?: string }> {
  onStep('TODO: implement solveSecretTask');
  return {};
}

export async function solveLLM(
  onStep: StepCallback,
  _model: string,
  _trackUsage: UsageCallback,
): Promise<{ flag?: string }> {
  onStep('TODO: implement solveLLM');
  return {};
}
