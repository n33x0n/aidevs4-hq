import { createHash } from 'crypto';
import { basename } from 'path';

export interface MarkdownSection {
  title: string;
  content: string;
}

export interface Chunk {
  title: string;
  content: string;
  index: number;
}

/**
 * Parsuje markdown na sekcje po nagłówkach ## (h2).
 * Stripuje YAML frontmatter (---...---).
 * Treść przed pierwszym ## trafia do sekcji "Wstęp".
 */
export function parseMarkdownSections(content: string): MarkdownSection[] {
  // Strip YAML frontmatter
  let body = content;
  if (body.startsWith('---')) {
    const endIdx = body.indexOf('---', 3);
    if (endIdx !== -1) {
      body = body.slice(endIdx + 3).trimStart();
    }
  }

  const sections: MarkdownSection[] = [];
  const lines = body.split('\n');
  let currentTitle = 'Wstęp';
  let currentLines: string[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      // Zapisz poprzednią sekcję
      const text = currentLines.join('\n').trim();
      if (text) {
        sections.push({ title: currentTitle, content: text });
      }
      currentTitle = h2Match[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Ostatnia sekcja
  const text = currentLines.join('\n').trim();
  if (text) {
    sections.push({ title: currentTitle, content: text });
  }

  return sections;
}

/**
 * Dzieli dużą sekcję na chunki po paragrafach.
 * Nie łamie code blocks (```...```).
 * maxChars = max znaków na chunk.
 */
export function chunkSection(section: MarkdownSection, maxChars = 8000): Chunk[] {
  const { title, content } = section;

  if (content.length <= maxChars) {
    return [{ title, content, index: 0 }];
  }

  // Dziel po podwójnych newline (paragrafach), zachowując code blocks
  const paragraphs = splitPreservingCodeBlocks(content);
  const chunks: Chunk[] = [];
  let current = '';
  let idx = 0;

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      chunks.push({ title, content: current.trim(), index: idx++ });
      current = '';
    }
    current += (current ? '\n\n' : '') + para;
  }

  if (current.trim()) {
    chunks.push({ title, content: current.trim(), index: idx });
  }

  return chunks;
}

function splitPreservingCodeBlocks(text: string): string[] {
  const result: string[] = [];
  const lines = text.split('\n');
  let current: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }

    if (!inCodeBlock && line.trim() === '' && current.length > 0) {
      const block = current.join('\n').trim();
      if (block) result.push(block);
      current = [];
    } else {
      current.push(line);
    }
  }

  const block = current.join('\n').trim();
  if (block) result.push(block);

  return result;
}

/**
 * Wyciąga kod lekcji z nazwy pliku, np. "s01e01-cokolwiek.md" → "s01e01"
 */
export function extractLessonCode(filename: string): string | null {
  const name = basename(filename);
  const match = name.match(/^(s\d{2}e\d{2})/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * SHA-256 hash tekstu (hex).
 */
export function hashContent(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Szacunkowa liczba tokenów (~3 znaki/token dla polskiego tekstu).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}
