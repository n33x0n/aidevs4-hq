import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const LOG_DIR = join(process.cwd(), 'src', 'logs');
try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }

// Jeden plik per uruchomienie serwera: debug-YYYY-MM-DDTHH-MM-SS.log
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG_PATH = join(LOG_DIR, `debug-${SESSION_TIMESTAMP}.log`);

export function debugLog(module: string, msg: string) {
  const line = `[${new Date().toISOString()}] [${module}] ${msg}\n`;
  try { appendFileSync(LOG_PATH, line); } catch { /* ignore */ }
}
