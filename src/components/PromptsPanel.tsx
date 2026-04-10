import { useState, useEffect } from 'react';
import NavHeader from './NavHeader';
import NavFooter from './NavFooter';

interface PromptEntry {
  task: string;
  lessonCode: string;
  file: string;
  name: string;
  content: string;
  lineNumber: number;
}

export default function PromptsPanel() {
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lessonFilter, setLessonFilter] = useState('');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/prompts')
      .then(r => r.json())
      .then(d => { setPrompts(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const lessons = [...new Set(prompts.map(p => p.lessonCode))].sort();

  const filtered = prompts.filter(p => {
    if (lessonFilter && p.lessonCode !== lessonFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.content.toLowerCase().includes(q) ||
             p.name.toLowerCase().includes(q) ||
             p.task.toLowerCase().includes(q);
    }
    return true;
  });

  async function handleCopy(idx: number, content: string) {
    await navigator.clipboard.writeText(content);
    setCopied(idx);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <NavHeader activeTab="PROMPTS" />

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-6 space-y-4">
        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Szukaj w promptach..."
            className="flex-1 min-w-[200px] bg-dark-900 border border-dark-600 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-neon-green/50"
          />
          <select
            value={lessonFilter}
            onChange={e => setLessonFilter(e.target.value)}
            className="bg-dark-900 border border-dark-600 rounded px-3 py-2 text-sm text-gray-400 focus:outline-none focus:border-neon-green/50"
          >
            <option value="">Wszystkie lekcje</option>
            {lessons.map(l => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </select>
          <span className="text-xs text-gray-600 self-center">
            {filtered.length}/{prompts.length} promptow
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-neon-green/50 border-t-neon-green rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-600 text-sm">Brak promptow</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((p, i) => {
              const isExpanded = expandedIdx === i;
              return (
                <div key={`${p.file}-${p.lineNumber}`} className="bg-dark-800 border border-dark-600 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedIdx(isExpanded ? null : i)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-dark-700/50 transition-colors"
                  >
                    <span className="px-2 py-0.5 text-[10px] rounded bg-cyan-900/50 text-cyan-300 border border-cyan-700/50 flex-shrink-0">
                      {p.lessonCode.toUpperCase()}
                    </span>
                    <span className="text-sm text-gray-300 flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-gray-600 flex-shrink-0">{p.task}</span>
                    <span className="text-xs text-gray-700 flex-shrink-0">:{p.lineNumber}</span>
                    <svg
                      className={`w-4 h-4 text-gray-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-dark-600">
                      <div className="flex items-center justify-between px-4 py-2 bg-dark-900/50">
                        <span className="text-xs text-gray-600 font-mono">{p.file}:{p.lineNumber}</span>
                        <button
                          onClick={() => handleCopy(i, p.content)}
                          className="px-3 py-1 text-xs bg-dark-800 text-gray-400 border border-dark-600 rounded hover:border-neon-green/50 hover:text-neon-green transition-colors"
                        >
                          {copied === i ? 'SKOPIOWANO' : 'KOPIUJ'}
                        </button>
                      </div>
                      <pre className="px-4 py-3 text-xs text-gray-400 whitespace-pre-wrap max-h-[60vh] overflow-y-auto leading-relaxed font-mono">
                        {p.content}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      <NavFooter label="PROMPTS" stats={`${prompts.length} promptow z ${lessons.length} zrodel`} />
    </div>
  );
}
