import type { APIRoute } from 'astro';
import { getChunksByLessonCodes } from '../../../lib/knowledge-db';
import { openai, DEFAULT_MODEL, observeOpenAI } from '../../../lib/llm';
import { debugLog } from '../../../lib/debug-log';
import { createSSEStream } from '../../../lib/sse';

export interface QuizQuestion {
  id: number;
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  lessonCode: string;
  sectionTitle: string;
}

const MAX_CONTEXT_TOKENS = 50_000;
const MAX_RETRIES = 2;

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const lessonCodes: string[] = body.lessonCodes ?? [];
  const questionCount: number = Math.min(20, Math.max(5, body.questionCount ?? 10));
  const model: string = body.model || DEFAULT_MODEL;

  if (lessonCodes.length === 0) {
    return new Response(JSON.stringify({ error: 'Brak wybranych lekcji' }), { status: 400 });
  }

  return createSSEStream(async (send) => {
    send('log', { message: `Generuję quiz: ${questionCount} pytań z ${lessonCodes.length} lekcji` });

    // Pobierz chunki
    const allChunks = getChunksByLessonCodes(lessonCodes);
    if (allChunks.length === 0) {
      send('error', { message: 'Brak chunków dla wybranych lekcji — uruchom SYNC' });
      return;
    }

    send('log', { message: `Znaleziono ${allChunks.length} chunków` });

    // Grupuj wg lekcji
    const byLesson = new Map<string, typeof allChunks>();
    for (const c of allChunks) {
      const arr = byLesson.get(c.lesson_code) || [];
      arr.push(c);
      byLesson.set(c.lesson_code, arr);
    }

    // Podziel pytania proporcjonalnie do liczby chunków
    const totalChunks = allChunks.length;
    const lessonEntries = [...byLesson.entries()];
    const questionsPerLesson = new Map<string, number>();
    let assigned = 0;
    for (let i = 0; i < lessonEntries.length; i++) {
      const [code, chunks] = lessonEntries[i];
      const share = i === lessonEntries.length - 1
        ? questionCount - assigned
        : Math.max(1, Math.round((chunks.length / totalChunks) * questionCount));
      questionsPerLesson.set(code, share);
      assigned += share;
    }

    // Wybierz chunki z każdej lekcji (losowe sekcje, chunk_index=0)
    const selectedChunks: typeof allChunks = [];
    let tokenBudget = MAX_CONTEXT_TOKENS;

    for (const [, chunks] of byLesson) {
      const sections = new Map<string, typeof chunks>();
      for (const c of chunks) {
        const arr = sections.get(c.section_title) || [];
        arr.push(c);
        sections.set(c.section_title, arr);
      }

      const sectionKeys = [...sections.keys()];
      shuffle(sectionKeys);

      for (const key of sectionKeys) {
        if (tokenBudget <= 0) break;
        const sectionChunks = sections.get(key)!;
        const first = sectionChunks.find(c => c.chunk_index === 0) || sectionChunks[0];
        if (first.token_count <= tokenBudget) {
          selectedChunks.push(first);
          tokenBudget -= first.token_count;
        }
      }
    }

    send('log', { message: `Wybrano ${selectedChunks.length} sekcji (~${MAX_CONTEXT_TOKENS - tokenBudget} tokenów)` });

    // Generuj pytania batchami per lekcja
    const allQuestions: QuizQuestion[] = [];
    let questionId = 1;
    let processedLessons = 0;

    for (const [code] of byLesson) {
      const count = questionsPerLesson.get(code) || 1;
      const lessonChunks = selectedChunks.filter(c => c.lesson_code === code);
      if (lessonChunks.length === 0) continue;

      processedLessons++;
      send('progress', {
        current: processedLessons,
        total: byLesson.size,
        message: `Generuję pytania z ${code.toUpperCase()}...`,
      });
      send('log', { message: `${code.toUpperCase()}: generuję ${count} pytań z ${lessonChunks.length} sekcji...` });

      const content = lessonChunks.map(c =>
        `### ${c.section_title}\n${c.content}`
      ).join('\n\n---\n\n');

      const messages: Array<{ role: 'system' | 'user'; content: string }> = [
        {
          role: 'system',
          content: `Jesteś generatorem quizu z materiałów edukacyjnych o AI/LLM. Generujesz pytania wielokrotnego wyboru testujące ZROZUMIENIE wiedzy technicznej, nie proste zapamiętywanie faktów.

Zasady:
- Każde pytanie ma dokładnie 4 opcje (A-D), dokładnie 1 poprawna
- Pytania i opcje po polsku
- Pytaj o koncepcje, zastosowania, porównania — nie o definicje
- Dodaj krótkie wyjaśnienie (1-2 zdania) dlaczego odpowiedź jest poprawna
- correctIndex: 0=A, 1=B, 2=C, 3=D
- Losowo rozmieszczaj poprawną odpowiedź (nie zawsze A)
- POMIJAJ treści fabularne (postacie, misje, akcja, Zygfryd, elektrownia, agenci) — pytaj WYŁĄCZNIE o wiedzę techniczną: LLM, API, prompt engineering, tokenizacja, embeddingi, RAG, function calling, fine-tuning, architektura AI itp.

WAŻNE: Zwróć TYLKO poprawny JSON, bez markdown code blocks.
Format: { "questions": [{ "question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "explanation": "...", "sectionTitle": "..." }] }`,
        },
        {
          role: 'user',
          content: `Materiał z lekcji ${code.toUpperCase()}:\n\n${content}\n\nWygeneruj ${count} pytań testujących zrozumienie tego materiału.`,
        },
      ];

      let questionsFromLesson: QuizQuestion[] = [];

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const client = observeOpenAI(openai, {
            generationName: `quiz-${code}-attempt${attempt}`,
            metadata: { task: 'knowledge-quiz' },
          });

          send('log', { message: `Czekam na odpowiedź LLM (próba ${attempt}/${MAX_RETRIES})...` });

          const response = await client.chat.completions.create({
            model,
            temperature: 0.7,
            response_format: { type: 'json_object' },
            messages,
          });

          const raw = response.choices?.[0]?.message?.content;
          if (!raw) {
            send('log', { message: `LLM zwrócił pustą odpowiedź` });
            continue;
          }

          debugLog('quiz', `Raw LLM response length for ${code}: ${raw.length}`);

          const parsed = repairAndParseJSON(raw);
          if (!parsed || !Array.isArray(parsed.questions)) {
            send('log', { message: `Nie udało się sparsować JSON — ponawiam...` });
            continue;
          }

          for (const q of parsed.questions) {
            if (!isValidQuestion(q)) continue;
            const vq = q as { question: string; options: string[]; correctIndex: number; explanation: string; sectionTitle?: string };
            questionsFromLesson.push({
              id: questionId++,
              question: vq.question,
              options: vq.options as [string, string, string, string],
              correctIndex: vq.correctIndex,
              explanation: vq.explanation,
              lessonCode: code,
              sectionTitle: vq.sectionTitle || lessonChunks[0].section_title,
            });
          }

          if (questionsFromLesson.length > 0) {
            send('log', { message: `${code.toUpperCase()}: wygenerowano ${questionsFromLesson.length} pytań` });
            break; // sukces
          }

          send('log', { message: `Brak poprawnych pytań w odpowiedzi — ponawiam...` });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          debugLog('quiz', `LLM error for ${code} attempt ${attempt}: ${msg}`);
          send('log', { message: `Błąd LLM (próba ${attempt}): ${msg.slice(0, 120)}` });
        }
      }

      allQuestions.push(...questionsFromLesson);
    }

    // Przetnij do żądanej liczby
    const finalQuestions = allQuestions.slice(0, questionCount);
    shuffle(finalQuestions);
    finalQuestions.forEach((q, i) => q.id = i + 1);

    send('log', { message: `Wygenerowano ${finalQuestions.length}/${questionCount} pytań` });
    send('result', { questions: finalQuestions });
  });
};

/** Próbuje naprawić typowe problemy z JSON od LLM */
function repairAndParseJSON(raw: string): Record<string, unknown> | null {
  // Usuń markdown code blocks
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  // Próba 1: bezpośredni parse
  try {
    return JSON.parse(text);
  } catch { /* continue */ }

  // Próba 2: znajdź pierwszy { i ostatni }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch { /* continue */ }
  }

  // Próba 3: napraw trailing comma przed ] lub }
  try {
    const fixed = text
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/(["\d\w])\s*\n\s*(["{[])/g, '$1,$2');
    return JSON.parse(fixed);
  } catch { /* continue */ }

  // Próba 4: wyciągnij { ... } i napraw
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const sub = text.slice(firstBrace, lastBrace + 1);
      const fixed = sub.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(fixed);
    } catch { /* continue */ }
  }

  debugLog('quiz', `JSON repair failed. First 200 chars: ${raw.slice(0, 200)}`);
  return null;
}

function isValidQuestion(q: unknown): boolean {
  if (!q || typeof q !== 'object') return false;
  const obj = q as Record<string, unknown>;
  return (
    typeof obj.question === 'string' &&
    Array.isArray(obj.options) &&
    obj.options.length === 4 &&
    obj.options.every((o: unknown) => typeof o === 'string') &&
    typeof obj.correctIndex === 'number' &&
    obj.correctIndex >= 0 && obj.correctIndex <= 3 &&
    typeof obj.explanation === 'string'
  );
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
