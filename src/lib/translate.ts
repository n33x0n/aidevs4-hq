import { openai } from './llm';

const TRANSLATION_MODEL = 'google/gemini-2.0-flash-001';

const SYSTEM_PROMPT_TO_PL = `You are a translator. Translate the following English text to Polish.
Rules:
- Preserve all code blocks, JSON, URLs, file paths, and technical identifiers unchanged
- Preserve flag patterns like {FLG:...} unchanged
- Preserve proper nouns and brand names unchanged
- Maintain original formatting (markdown, lists, line breaks)
- Output ONLY the translated text, no explanations`;

const SYSTEM_PROMPT_TO_EN = `You are a translator. Translate the following Polish text to English.
Rules:
- Preserve all code blocks, JSON, URLs, file paths, and technical identifiers unchanged
- Preserve flag patterns like {FLG:...} unchanged
- Preserve proper nouns and brand names unchanged
- Maintain original formatting (markdown, lists, line breaks)
- Output ONLY the translated text, no explanations`;

const POLISH_CHARS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const POLISH_WORDS = /\b(jest|nie|tak|ale|czy|jak|się|ten|dla|lub|przy|jako|przez|będzie|może|tylko|bardzo|też|tutaj|teraz)\b/i;

export function isLikelyPolish(text: string): boolean {
  return POLISH_CHARS.test(text) || POLISH_WORDS.test(text);
}

export async function translateToPolish(text: string): Promise<string> {
  if (!text || text.length < 15) return text;
  if (isLikelyPolish(text)) return text;

  try {
    const res = await openai.chat.completions.create({
      model: TRANSLATION_MODEL,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_TO_PL },
        { role: 'user', content: text },
      ],
    });
    return res.choices[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}

export async function translateToEnglish(text: string): Promise<string> {
  if (!text || text.length < 15) return text;
  if (!isLikelyPolish(text)) return text;

  try {
    const res = await openai.chat.completions.create({
      model: TRANSLATION_MODEL,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_TO_EN },
        { role: 'user', content: text },
      ],
    });
    return res.choices[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}
