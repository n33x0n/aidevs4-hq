import type { APIRoute } from 'astro';
import { readFileSync, readdirSync, statSync, realpathSync } from 'fs';
import { join, resolve, extname } from 'path';

// Dozwolone katalogi — tylko /data i /lessons (bezpieczeństwo)
const ALLOWED_DIRS = [
  resolve(process.cwd(), '..', 'data'),
  resolve(process.cwd(), '..', 'lessons'),
];

function isAllowedPath(filePath: string): boolean {
  try {
    // realpathSync podąża za symlinkami — chroni przed symlink attacks
    const real = realpathSync(filePath);
    return ALLOWED_DIRS.some((dir) => real.startsWith(dir + '/') || real === dir);
  } catch {
    // Plik nie istnieje lub brak dostępu — deny
    return false;
  }
}

// GET /api/readfile?path=/data/people.csv  → zwraca treść pliku
// GET /api/readfile?list=true              → lista dostępnych plików
export const GET: APIRoute = async ({ url }) => {
  const listMode = url.searchParams.get('list') === 'true';

  if (listMode) {
    const files: Array<{ path: string; size: number }> = [];
    for (const dir of ALLOWED_DIRS) {
      try {
        const dirName = dir.endsWith('data') ? '/data' : '/lessons';
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          try {
            const stat = statSync(full);
            if (stat.isFile()) {
              files.push({ path: `${dirName}/${entry}`, size: stat.size });
            }
          } catch { /* ignore */ }
        }
      } catch { /* dir nie istnieje */ }
    }
    return new Response(JSON.stringify({ files }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pathParam = url.searchParams.get('path');
  if (!pathParam) {
    return new Response(JSON.stringify({ error: 'Brak parametru ?path=' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Zamień /data/... lub /lessons/... na bezwzględną ścieżkę
  let absPath: string;
  if (pathParam.startsWith('/data/')) {
    absPath = resolve(process.cwd(), '..', 'data', pathParam.slice(6));
  } else if (pathParam.startsWith('/lessons/')) {
    absPath = resolve(process.cwd(), '..', 'lessons', pathParam.slice(9));
  } else {
    return new Response(JSON.stringify({ error: 'Ścieżka musi zaczynać się od /data/ lub /lessons/' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!isAllowedPath(absPath)) {
    return new Response(JSON.stringify({ error: 'Dostęp zabroniony' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const ext = extname(absPath).toLowerCase();
    const isBinary = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip'].includes(ext);
    if (isBinary) {
      return new Response(JSON.stringify({ error: 'Pliki binarne nie są obsługiwane' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const content = readFileSync(absPath, 'utf-8');
    // Dla dużych plików (>200KB) zwróć tylko pierwsze 500 linii
    const lines = content.split('\n');
    const truncated = lines.length > 500;
    const preview = truncated ? lines.slice(0, 500).join('\n') : content;

    return new Response(JSON.stringify({
      path: pathParam,
      content: preview,
      lines: lines.length,
      truncated,
      size: Buffer.byteLength(content, 'utf-8'),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: `Plik nie istnieje: ${pathParam}` }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }
};
