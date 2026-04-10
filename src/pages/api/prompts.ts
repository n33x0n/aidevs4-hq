import type { APIRoute } from 'astro';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, basename, dirname } from 'path';

interface PromptEntry {
  task: string;
  lessonCode: string;
  file: string;
  name: string;
  content: string;
  lineNumber: number;
}

let cache: PromptEntry[] | null = null;

function scanPrompts(): PromptEntry[] {
  if (cache) return cache;

  const tasksDir = resolve(process.cwd(), 'src', 'tasks');
  const entries: PromptEntry[] = [];

  let taskDirs: string[];
  try {
    taskDirs = readdirSync(tasksDir).filter(d => {
      try { return statSync(resolve(tasksDir, d)).isDirectory(); } catch { return false; }
    });
  } catch { return []; }

  // Mapuj task dir → lesson code
  const TASK_LESSON: Record<string, string> = {
    people: 's01e01', findhim: 's01e02', proxy: 's01e03',
    sendit: 's01e04', railway: 's01e05', categorize: 's02e01',
    electricity: 's02e02', failure: 's02e03', mailbox: 's02e04', drone: 's02e05',
  };

  for (const dir of taskDirs) {
    const solverPath = resolve(tasksDir, dir, 'solver.ts');
    let content: string;
    try { content = readFileSync(solverPath, 'utf-8'); } catch { continue; }

    const lines = content.split('\n');
    let inPrompt = false;
    let promptStart = 0;
    let promptContent = '';
    let promptName = '';
    let backtickCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect system prompt patterns
      // Pattern 1: role: 'system', content: `...`
      if (line.match(/role:\s*['"]system['"]/)) {
        // Find the content on this or next lines
        const contentMatch = line.match(/content:\s*[`'"]/);
        if (contentMatch) {
          promptStart = i + 1;
          promptName = `system prompt`;
          inPrompt = true;
          promptContent = '';
          backtickCount = (line.match(/`/g) || []).length;
          // Extract content after content: `
          const afterContent = line.slice(line.indexOf('content:') + 8).trim();
          const startQuote = afterContent.match(/^[`'"]/);
          if (startQuote) {
            promptContent = afterContent.slice(1);
            // Check if single-line
            if (afterContent.endsWith("'") || afterContent.endsWith('"') || (afterContent.endsWith('`') && backtickCount % 2 === 0)) {
              promptContent = promptContent.slice(0, -1);
              if (promptContent.trim()) {
                entries.push({
                  task: dir,
                  lessonCode: TASK_LESSON[dir] || dir,
                  file: `src/tasks/${dir}/solver.ts`,
                  name: promptName,
                  content: promptContent.trim(),
                  lineNumber: promptStart,
                });
              }
              inPrompt = false;
              continue;
            }
          }
          continue;
        }
      }

      // Pattern 2: const SYSTEM_PROMPT = `...` or similar
      const constMatch = line.match(/(?:const|let)\s+(\w*[Pp]rompt\w*|SYSTEM_\w+)\s*=\s*`/);
      if (constMatch) {
        promptStart = i + 1;
        promptName = constMatch[1];
        inPrompt = true;
        promptContent = line.slice(line.indexOf('`') + 1);
        if (promptContent.endsWith('`')) {
          promptContent = promptContent.slice(0, -1);
          if (promptContent.trim()) {
            entries.push({
              task: dir,
              lessonCode: TASK_LESSON[dir] || dir,
              file: `src/tasks/${dir}/solver.ts`,
              name: promptName,
              content: promptContent.trim(),
              lineNumber: promptStart,
            });
          }
          inPrompt = false;
        }
        continue;
      }

      // Pattern 3: Template literal continuation
      if (inPrompt) {
        if (line.includes('`')) {
          promptContent += '\n' + line.slice(0, line.indexOf('`'));
          if (promptContent.trim().length > 20) {
            entries.push({
              task: dir,
              lessonCode: TASK_LESSON[dir] || dir,
              file: `src/tasks/${dir}/solver.ts`,
              name: promptName,
              content: promptContent.trim(),
              lineNumber: promptStart,
            });
          }
          inPrompt = false;
        } else {
          promptContent += '\n' + line;
        }
      }
    }

    // Also check for llm-solver.ts
    const llmSolverPath = resolve(tasksDir, dir, 'llm-solver.ts');
    try {
      const llmContent = readFileSync(llmSolverPath, 'utf-8');
      const llmLines = llmContent.split('\n');
      let inLlmPrompt = false;
      let llmPromptStart = 0;
      let llmPromptContent = '';
      let llmPromptName = '';

      for (let i = 0; i < llmLines.length; i++) {
        const line = llmLines[i];

        const constMatch = line.match(/(?:const|let)\s+(\w*[Pp]rompt\w*|SYSTEM_\w+)\s*=\s*`/);
        if (constMatch) {
          llmPromptStart = i + 1;
          llmPromptName = constMatch[1];
          inLlmPrompt = true;
          llmPromptContent = line.slice(line.indexOf('`') + 1);
          if (llmPromptContent.endsWith('`')) {
            llmPromptContent = llmPromptContent.slice(0, -1);
            if (llmPromptContent.trim()) {
              entries.push({
                task: dir,
                lessonCode: TASK_LESSON[dir] || dir,
                file: `src/tasks/${dir}/llm-solver.ts`,
                name: llmPromptName,
                content: llmPromptContent.trim(),
                lineNumber: llmPromptStart,
              });
            }
            inLlmPrompt = false;
            continue;
          }
          continue;
        }

        if (inLlmPrompt) {
          if (line.includes('`')) {
            llmPromptContent += '\n' + line.slice(0, line.indexOf('`'));
            if (llmPromptContent.trim().length > 20) {
              entries.push({
                task: dir,
                lessonCode: TASK_LESSON[dir] || dir,
                file: `src/tasks/${dir}/llm-solver.ts`,
                name: llmPromptName,
                content: llmPromptContent.trim(),
                lineNumber: llmPromptStart,
              });
            }
            inLlmPrompt = false;
          } else {
            llmPromptContent += '\n' + line;
          }
        }
      }
    } catch { /* no llm-solver */ }
  }

  // Also scan secret-analyze.ts for the base system prompt
  try {
    const secretPath = resolve(process.cwd(), 'src', 'pages', 'api', 'tasks', 'secret-analyze.ts');
    const secretContent = readFileSync(secretPath, 'utf-8');
    const match = secretContent.match(/function buildBaseSystemPrompt\(\)[\s\S]*?return `([\s\S]*?)`;/);
    if (match) {
      const lineNumber = secretContent.slice(0, secretContent.indexOf(match[0])).split('\n').length;
      entries.push({
        task: 'secret-analyze',
        lessonCode: 'global',
        file: 'src/pages/api/tasks/secret-analyze.ts',
        name: 'buildBaseSystemPrompt',
        content: match[1].trim(),
        lineNumber,
      });
    }
  } catch { /* ignore */ }

  cache = entries;
  return entries;
}

export const GET: APIRoute = async () => {
  const prompts = scanPrompts();
  return new Response(JSON.stringify(prompts), {
    headers: { 'Content-Type': 'application/json' },
  });
};
