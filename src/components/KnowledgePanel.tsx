import { useState, useEffect, useRef, useCallback } from 'react';
import BootTerminal from './BootTerminal';
import { readSSEStream } from '../lib/useSSE';
import NavHeader from './NavHeader';
import NavFooter from './NavFooter';

interface SearchResult {
  id: number;
  distance: number;
  source_path: string;
  source_type: string;
  lesson_code: string | null;
  section_title: string;
  content: string;
  snippet: string;
  token_count: number | null;
}

interface KnowledgeStats {
  totalChunks: number;
  embeddedChunks: number;
  totalTokens: number;
  lastSync: string | null;
  sources: Array<{
    source_path: string;
    source_type: string;
    lesson_code: string | null;
    chunks: number;
    tokens: number;
    last_updated: string;
  }>;
}

interface QuizQuestion {
  id: number;
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  lessonCode: string;
  sectionTitle: string;
}

type QuizPhase = 'setup' | 'generating' | 'solving' | 'results';

export default function KnowledgePanel() {
  const [bootTerminal, setBootTerminal] = useState(false);

  // Wyszukiwanie
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDuration, setSearchDuration] = useState<number | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'' | 'lesson' | 'knowledge'>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Statystyki
  const [stats, setStats] = useState<KnowledgeStats | null>(null);

  // Quiz
  const [quizPhase, setQuizPhase] = useState<QuizPhase>('setup');
  const [selectedLessons, setSelectedLessons] = useState<Set<string>>(new Set());
  const [questionCount, setQuestionCount] = useState(10);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizLogs, setQuizLogs] = useState<string[]>([]);
  const [quizProgress, setQuizProgress] = useState<{ current: number; total: number; message?: string } | null>(null);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [checkedQuestions, setCheckedQuestions] = useState<Map<number, number>>(new Map()); // questionId → selectedOption
  const [expandedResultId, setExpandedResultId] = useState<number | null>(null);
  const [quizModel, setQuizModel] = useState('google/gemini-2.0-flash-001');

  const syncLogsRef = useRef<HTMLDivElement>(null);
  const quizLogsRef = useRef<HTMLDivElement>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge');
      if (res.ok) setStats(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  // Auto-scroll sync logs
  useEffect(() => {
    syncLogsRef.current?.scrollTo(0, syncLogsRef.current.scrollHeight);
  }, [syncLogs]);

  // Auto-scroll quiz logs
  useEffect(() => {
    quizLogsRef.current?.scrollTo(0, quizLogsRef.current.scrollHeight);
  }, [quizLogs]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || searching) return;

    setSearching(true);
    setResults([]);
    setSearchDuration(null);
    setExpandedId(null);

    try {
      const res = await fetch('/api/knowledge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          limit: 15,
          sourceType: sourceFilter || undefined,
        }),
      });
      const data = await res.json();
      setResults(data.results || []);
      setSearchDuration(data.duration);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setSearching(false);
    }
  }

  async function handleSync(force = false) {
    if (syncing) return;
    setSyncing(true);
    setSyncLogs([]);
    setSyncProgress(null);
    setSyncResult(null);

    try {
      const res = await fetch('/api/knowledge/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });

      await readSSEStream(res, {
        log: (data) => setSyncLogs(prev => [...prev, data.message]),
        progress: (data) => setSyncProgress({ current: data.current, total: data.total }),
        result: (data) => {
          setSyncResult(`Zaindeksowano ${data.chunksIndexed} chunków, pominięto ${data.skipped}, usunięto ${data.deleted ?? 0} (${data.duration}ms)`);
          loadStats();
        },
        error: (data) => setSyncLogs(prev => [...prev, `ERROR: ${data.message}`]),
      });
    } catch (err) {
      setSyncLogs(prev => [...prev, `ERROR: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setSyncing(false);
    }
  }

  // Quiz — dostępne lekcje
  const lessonSources = (stats?.sources || []).filter(s => s.source_type === 'lesson' && s.lesson_code);

  function toggleLesson(code: string) {
    setSelectedLessons(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleAllLessons() {
    if (selectedLessons.size === lessonSources.length) {
      setSelectedLessons(new Set());
    } else {
      setSelectedLessons(new Set(lessonSources.map(s => s.lesson_code!)));
    }
  }

  async function handleGenerateQuiz() {
    if (selectedLessons.size === 0) return;
    setQuizPhase('generating');
    setQuizQuestions([]);
    setQuizLogs([]);
    setQuizProgress(null);
    setCurrentQuestionIdx(0);
    setSelectedOption(null);
    setCheckedQuestions(new Map());

    try {
      const res = await fetch('/api/knowledge/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonCodes: [...selectedLessons],
          questionCount,
          model: quizModel,
        }),
      });

      await readSSEStream(res, {
        log: (data) => setQuizLogs(prev => [...prev, data.message]),
        progress: (data) => setQuizProgress({ current: data.current, total: data.total, message: data.message }),
        result: (data) => {
          const questions: QuizQuestion[] = data.questions || [];
          setQuizQuestions(questions);
          if (questions.length > 0) {
            setQuizPhase('solving');
          } else {
            setQuizLogs(prev => [...prev, 'Nie wygenerowano żadnych pytań']);
            setQuizPhase('setup');
          }
        },
        error: (data) => {
          setQuizLogs(prev => [...prev, `ERROR: ${data.message}`]);
          setQuizPhase('setup');
        },
      });
    } catch (err) {
      setQuizLogs(prev => [...prev, `ERROR: ${err instanceof Error ? err.message : String(err)}`]);
      setQuizPhase('setup');
    }
  }

  function handleCheckAnswer() {
    if (selectedOption === null || !quizQuestions[currentQuestionIdx]) return;
    setCheckedQuestions(prev => new Map(prev).set(quizQuestions[currentQuestionIdx].id, selectedOption));
  }

  function handleNextQuestion() {
    if (currentQuestionIdx < quizQuestions.length - 1) {
      const nextIdx = currentQuestionIdx + 1;
      setCurrentQuestionIdx(nextIdx);
      const nextQ = quizQuestions[nextIdx];
      setSelectedOption(checkedQuestions.has(nextQ.id) ? checkedQuestions.get(nextQ.id)! : null);
    }
  }

  function handlePrevQuestion() {
    if (currentQuestionIdx > 0) {
      const prevIdx = currentQuestionIdx - 1;
      setCurrentQuestionIdx(prevIdx);
      const prevQ = quizQuestions[prevIdx];
      setSelectedOption(checkedQuestions.has(prevQ.id) ? checkedQuestions.get(prevQ.id)! : null);
    }
  }

  function handleShowResults() {
    setQuizPhase('results');
  }

  function handleNewQuiz() {
    setQuizPhase('setup');
    setQuizQuestions([]);
    setQuizLogs([]);
    setQuizProgress(null);
    setCurrentQuestionIdx(0);
    setSelectedOption(null);
    setCheckedQuestions(new Map());
  }

  const correctCount = quizQuestions.filter(q => checkedQuestions.get(q.id) === q.correctIndex).length;
  const answeredCount = checkedQuestions.size;

  function exportQuizMD() {
    const lessons = [...new Set(quizQuestions.map(q => q.lessonCode.toUpperCase()))].join(', ');
    let md = `# Quiz: ${lessons} — Wynik: ${correctCount}/${quizQuestions.length}\n\n`;
    quizQuestions.forEach((q, i) => {
      const userAnswer = checkedQuestions.get(q.id);
      md += `## Pytanie ${i + 1} (${q.lessonCode.toUpperCase()})\n`;
      md += `**Q:** ${q.question}\n`;
      q.options.forEach((opt, oi) => {
        const mark = oi === q.correctIndex ? '- **' + String.fromCharCode(65 + oi) + ')** ' + opt + ' **(poprawna)**' :
          oi === userAnswer ? '- ~~' + String.fromCharCode(65 + oi) + ') ' + opt + '~~ (twoja odpowiedz)' :
          '- ' + String.fromCharCode(65 + oi) + ') ' + opt;
        md += mark + '\n';
      });
      md += `> ${q.explanation}\n\n`;
    });
    downloadFile(md, `quiz-${Date.now()}.md`, 'text/markdown');
  }

  function exportQuizAnki() {
    const lines = quizQuestions.map(q => {
      const correct = String.fromCharCode(65 + q.correctIndex) + ') ' + q.options[q.correctIndex];
      return `${q.question}\t${correct} — ${q.explanation}`;
    });
    downloadFile(lines.join('\n'), `quiz-anki-${Date.now()}.txt`, 'text/plain');
  }

  function downloadFile(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatDistance(d: number): string {
    return d.toFixed(4);
  }

  function sourceBadge(sourceType: string, lessonCode: string | null) {
    if (sourceType === 'knowledge') {
      return <span className="px-2 py-0.5 text-xs rounded bg-purple-900/50 text-purple-300 border border-purple-700/50">KNOWLEDGE</span>;
    }
    return <span className="px-2 py-0.5 text-xs rounded bg-cyan-900/50 text-cyan-300 border border-cyan-700/50">{lessonCode?.toUpperCase() || 'LESSON'}</span>;
  }

  return (
    <div className="min-h-screen bg-dark-900 text-gray-200 font-mono flex flex-col">
      {/* Header */}
      <NavHeader activeTab="KNOWLEDGE" />

      {/* Main content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-6 space-y-6">
        {/* Wyszukiwarka */}
        <section className="bg-dark-800 border border-dark-600 rounded-lg p-4">
          <h2 className="text-sm text-gray-400 mb-3 uppercase tracking-wider">Wyszukiwanie semantyczne</h2>
          <form onSubmit={handleSearch} className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Wpisz zapytanie (np. function calling, tokenizacja, prompt cache)..."
              className="flex-1 bg-dark-900 border border-dark-600 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-neon-green/50"
            />
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value as '' | 'lesson' | 'knowledge')}
              className="bg-dark-900 border border-dark-600 rounded px-3 py-2 text-sm text-gray-400 focus:outline-none focus:border-neon-green/50"
            >
              <option value="">Wszystko</option>
              <option value="lesson">Lekcje</option>
              <option value="knowledge">Knowledge</option>
            </select>
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="px-4 py-2 bg-neon-green/20 text-neon-green border border-neon-green/30 rounded text-sm hover:bg-neon-green/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {searching ? 'Szukam...' : 'SZUKAJ'}
            </button>
          </form>

          {searchDuration !== null && (
            <div className="mt-2 text-xs text-gray-500">
              {results.length} wyników w {searchDuration}ms
            </div>
          )}

          {/* Wyniki */}
          {results.length > 0 && (
            <div className="mt-4 space-y-2 max-h-[60vh] overflow-y-auto">
              {results.map(r => (
                <div
                  key={r.id}
                  className="bg-dark-900 border border-dark-600 rounded p-3 hover:border-dark-500 transition-colors cursor-pointer"
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {sourceBadge(r.source_type, r.lesson_code)}
                      <span className="text-sm text-gray-300 truncate">{r.section_title}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 text-xs text-gray-500">
                      <span>dist: {formatDistance(r.distance)}</span>
                      {r.token_count && <span>~{r.token_count} tok</span>}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">{r.source_path}</div>
                  {expandedId === r.id ? (
                    <pre className="mt-2 text-xs text-gray-400 whitespace-pre-wrap max-h-80 overflow-y-auto leading-relaxed">{r.content}</pre>
                  ) : (
                    <p className="mt-1 text-xs text-gray-500 line-clamp-2">{r.snippet}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Quiz */}
        <section className="bg-dark-800 border border-dark-600 rounded-lg p-4">
          <h2 className="text-sm text-gray-400 mb-3 uppercase tracking-wider">Quiz z lekcji</h2>

          {quizPhase === 'setup' && (
            <div className="space-y-4">
              {lessonSources.length === 0 ? (
                <div className="text-xs text-gray-600">Brak lekcji w bazie — uruchom SYNC</div>
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-500">Wybierz lekcje:</span>
                      <button
                        onClick={toggleAllLessons}
                        className="text-xs text-gray-500 hover:text-neon-green transition-colors"
                      >
                        {selectedLessons.size === lessonSources.length ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {lessonSources.map(s => (
                        <label
                          key={s.lesson_code}
                          className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer transition-colors text-xs ${
                            selectedLessons.has(s.lesson_code!)
                              ? 'bg-cyan-900/30 border-cyan-700/50 text-cyan-300'
                              : 'bg-dark-900 border-dark-600 text-gray-500 hover:border-dark-500'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedLessons.has(s.lesson_code!)}
                            onChange={() => toggleLesson(s.lesson_code!)}
                            className="sr-only"
                          />
                          <div className={`w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center ${
                            selectedLessons.has(s.lesson_code!)
                              ? 'bg-cyan-500 border-cyan-500'
                              : 'border-gray-600'
                          }`}>
                            {selectedLessons.has(s.lesson_code!) && (
                              <svg className="w-2 h-2 text-dark-900" fill="currentColor" viewBox="0 0 12 12"><path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
                            )}
                          </div>
                          {s.lesson_code!.toUpperCase()}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-xs text-gray-500 block mb-2">Liczba pytań:</span>
                    <div className="flex gap-2">
                      {[5, 10, 15, 20].map(n => (
                        <button
                          key={n}
                          onClick={() => setQuestionCount(n)}
                          className={`px-4 py-1.5 rounded text-sm border transition-colors ${
                            questionCount === n
                              ? 'bg-neon-green/20 text-neon-green border-neon-green/30'
                              : 'bg-dark-900 text-gray-500 border-dark-600 hover:border-dark-500'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-xs text-gray-500 block mb-2">Model LLM:</span>
                    <select
                      value={quizModel}
                      onChange={e => setQuizModel(e.target.value)}
                      className="bg-dark-900 border border-dark-600 rounded px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-neon-green/50"
                    >
                      <option value="google/gemini-2.0-flash-001">Gemini 2.0 Flash</option>
                      <option value="anthropic/claude-haiku-4-5">Claude Haiku 4.5</option>
                      <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
                    </select>
                  </div>

                  <button
                    onClick={handleGenerateQuiz}
                    disabled={selectedLessons.size === 0}
                    className="px-6 py-2 bg-neon-green/20 text-neon-green border border-neon-green/30 rounded text-sm font-medium hover:bg-neon-green/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    GENERUJ QUIZ
                  </button>
                </>
              )}
            </div>
          )}

          {quizPhase === 'generating' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-neon-green/50 border-t-neon-green rounded-full animate-spin" />
                <span className="text-sm text-gray-400">Generuję pytania — czekam na LLM...</span>
              </div>
              {quizProgress && (
                <div>
                  <div className="h-1.5 bg-dark-900 rounded overflow-hidden">
                    <div
                      className="h-full bg-neon-green/60 transition-all duration-300"
                      style={{ width: `${quizProgress.total > 0 ? (quizProgress.current / quizProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{quizProgress.message || `${quizProgress.current}/${quizProgress.total}`}</div>
                </div>
              )}
              {quizLogs.length > 0 && (
                <div ref={quizLogsRef} className="bg-dark-900 rounded p-2 max-h-40 overflow-y-auto text-xs text-gray-500 space-y-0.5">
                  {quizLogs.map((log, i) => (
                    <div key={i} className={log.startsWith('ERROR') || log.startsWith('Błąd') ? 'text-red-400' : ''}>{log}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {quizPhase === 'solving' && quizQuestions.length > 0 && (() => {
            const q = quizQuestions[currentQuestionIdx];
            const isChecked = checkedQuestions.has(q.id);
            const userAnswer = checkedQuestions.get(q.id);
            const isCorrect = userAnswer === q.correctIndex;
            const allAnswered = answeredCount === quizQuestions.length;

            return (
              <div className="space-y-4">
                {/* Progress */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Pytanie {currentQuestionIdx + 1}/{quizQuestions.length}</span>
                    <span className="px-2 py-0.5 text-xs rounded bg-cyan-900/50 text-cyan-300 border border-cyan-700/50">
                      {q.lessonCode.toUpperCase()}
                    </span>
                  </div>
                  <span className="text-xs text-gray-600">{answeredCount}/{quizQuestions.length} odpowiedzi</span>
                </div>
                <div className="h-1 bg-dark-900 rounded overflow-hidden">
                  <div
                    className="h-full bg-neon-green/40 transition-all duration-300"
                    style={{ width: `${((currentQuestionIdx + 1) / quizQuestions.length) * 100}%` }}
                  />
                </div>

                {/* Pytanie */}
                <p className="text-sm text-gray-200 leading-relaxed">{q.question}</p>

                {/* Opcje */}
                <div className="space-y-2">
                  {q.options.map((opt, i) => {
                    const letter = String.fromCharCode(65 + i);
                    let borderClass = 'border-dark-600 hover:border-dark-500';
                    let bgClass = 'bg-dark-900';
                    let textClass = 'text-gray-300';

                    if (isChecked) {
                      if (i === q.correctIndex) {
                        borderClass = 'border-green-500/70';
                        bgClass = 'bg-green-900/20';
                        textClass = 'text-green-300';
                      } else if (i === userAnswer && i !== q.correctIndex) {
                        borderClass = 'border-red-500/70';
                        bgClass = 'bg-red-900/20';
                        textClass = 'text-red-300';
                      } else {
                        textClass = 'text-gray-600';
                      }
                    } else if (selectedOption === i) {
                      borderClass = 'border-neon-green/50';
                      bgClass = 'bg-neon-green/10';
                      textClass = 'text-neon-green';
                    }

                    return (
                      <button
                        key={i}
                        onClick={() => !isChecked && setSelectedOption(i)}
                        disabled={isChecked}
                        className={`w-full text-left px-4 py-3 rounded border transition-colors ${borderClass} ${bgClass} ${isChecked ? 'cursor-default' : 'cursor-pointer'}`}
                      >
                        <span className={`text-sm ${textClass}`}>
                          <span className="font-medium mr-2">{letter}.</span>
                          {opt}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Wyjaśnienie */}
                {isChecked && (
                  <div className={`px-4 py-3 rounded border text-xs leading-relaxed ${
                    isCorrect
                      ? 'bg-green-900/10 border-green-800/30 text-green-400'
                      : 'bg-red-900/10 border-red-800/30 text-red-400'
                  }`}>
                    <span className="font-medium">{isCorrect ? 'Dobrze!' : 'Źle.'}</span>{' '}
                    {q.explanation}
                  </div>
                )}

                {/* Nawigacja */}
                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={handlePrevQuestion}
                    disabled={currentQuestionIdx === 0}
                    className="px-4 py-1.5 text-sm text-gray-500 border border-dark-600 rounded hover:text-gray-300 hover:border-dark-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    POPRZEDNIE
                  </button>
                  <div className="flex gap-2">
                    {!isChecked && (
                      <button
                        onClick={handleCheckAnswer}
                        disabled={selectedOption === null}
                        className="px-4 py-1.5 text-sm bg-neon-green/20 text-neon-green border border-neon-green/30 rounded hover:bg-neon-green/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        SPRAWDŹ
                      </button>
                    )}
                    {isChecked && currentQuestionIdx < quizQuestions.length - 1 && (
                      <button
                        onClick={handleNextQuestion}
                        className="px-4 py-1.5 text-sm bg-neon-green/20 text-neon-green border border-neon-green/30 rounded hover:bg-neon-green/30 transition-colors"
                      >
                        NASTĘPNE
                      </button>
                    )}
                    {allAnswered && (
                      <button
                        onClick={handleShowResults}
                        className="px-4 py-1.5 text-sm bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded hover:bg-purple-500/30 transition-colors"
                      >
                        WYNIKI
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {quizPhase === 'results' && (
            <div className="space-y-4">
              {/* Wynik */}
              <div className="text-center py-4">
                <div className="text-4xl font-bold text-neon-green">{correctCount}/{quizQuestions.length}</div>
                <div className="text-sm text-gray-500 mt-1">
                  {Math.round((correctCount / quizQuestions.length) * 100)}% poprawnych
                </div>
              </div>

              {/* Lista pytań */}
              <div className="space-y-1">
                {quizQuestions.map((q, i) => {
                  const userAnswer = checkedQuestions.get(q.id);
                  const isCorrect = userAnswer === q.correctIndex;
                  const isExpanded = expandedResultId === q.id;

                  return (
                    <div key={q.id}>
                      <button
                        onClick={() => setExpandedResultId(isExpanded ? null : q.id)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-dark-900/50 transition-colors text-left"
                      >
                        <span className={`text-xs font-medium w-5 ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>
                          {isCorrect ? '+' : '-'}
                        </span>
                        <span className="text-xs text-gray-600 w-5">{i + 1}.</span>
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-cyan-900/50 text-cyan-300 border border-cyan-700/50">
                          {q.lessonCode.toUpperCase()}
                        </span>
                        <span className="text-xs text-gray-400 truncate flex-1">{q.question}</span>
                      </button>
                      {isExpanded && (
                        <div className="ml-14 mb-2 px-3 py-2 bg-dark-900 rounded text-xs space-y-1">
                          {q.options.map((opt, oi) => (
                            <div key={oi} className={`${
                              oi === q.correctIndex ? 'text-green-400' :
                              oi === userAnswer ? 'text-red-400' : 'text-gray-600'
                            }`}>
                              {String.fromCharCode(65 + oi)}. {opt}
                              {oi === q.correctIndex && ' ✓'}
                              {oi === userAnswer && oi !== q.correctIndex && ' ✗'}
                            </div>
                          ))}
                          <div className="text-gray-500 mt-1 pt-1 border-t border-dark-600">{q.explanation}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleNewQuiz}
                  className="px-6 py-2 bg-neon-green/20 text-neon-green border border-neon-green/30 rounded text-sm font-medium hover:bg-neon-green/30 transition-colors"
                >
                  NOWY QUIZ
                </button>
                <button
                  onClick={exportQuizMD}
                  className="px-4 py-2 bg-dark-900 text-gray-400 border border-dark-600 rounded text-sm hover:border-cyan-500/50 hover:text-cyan-400 transition-colors"
                >
                  EKSPORT MD
                </button>
                <button
                  onClick={exportQuizAnki}
                  className="px-4 py-2 bg-dark-900 text-gray-400 border border-dark-600 rounded text-sm hover:border-purple-500/50 hover:text-purple-400 transition-colors"
                >
                  EKSPORT ANKI
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Sync + Stats obok siebie */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sync */}
          <section className="bg-dark-800 border border-dark-600 rounded-lg p-4">
            <h2 className="text-sm text-gray-400 mb-3 uppercase tracking-wider">Synchronizacja</h2>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => handleSync(false)}
                disabled={syncing}
                className="px-3 py-1.5 bg-dark-900 border border-dark-600 rounded text-sm text-gray-300 hover:border-neon-green/50 hover:text-neon-green disabled:opacity-40 transition-colors"
              >
                {syncing ? 'Synchronizuję...' : 'SYNC'}
              </button>
              <button
                onClick={() => handleSync(true)}
                disabled={syncing}
                className="px-3 py-1.5 bg-dark-900 border border-dark-600 rounded text-sm text-gray-500 hover:border-orange-500/50 hover:text-orange-400 disabled:opacity-40 transition-colors"
              >
                FORCE SYNC
              </button>
            </div>

            {syncProgress && (
              <div className="mb-2">
                <div className="h-1.5 bg-dark-900 rounded overflow-hidden">
                  <div
                    className="h-full bg-neon-green/60 transition-all duration-300"
                    style={{ width: `${syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0}%` }}
                  />
                </div>
                <div className="text-xs text-gray-500 mt-1">{syncProgress.current}/{syncProgress.total}</div>
              </div>
            )}

            {syncResult && (
              <div className="mb-2 text-xs text-neon-green">{syncResult}</div>
            )}

            {syncLogs.length > 0 && (
              <div ref={syncLogsRef} className="bg-dark-900 rounded p-2 max-h-40 overflow-y-auto text-xs text-gray-500 space-y-0.5">
                {syncLogs.map((log, i) => (
                  <div key={i} className={log.startsWith('ERROR') ? 'text-red-400' : ''}>{log}</div>
                ))}
              </div>
            )}
          </section>

          {/* Stats */}
          <section className="bg-dark-800 border border-dark-600 rounded-lg p-4">
            <h2 className="text-sm text-gray-400 mb-3 uppercase tracking-wider">Statystyki</h2>
            {stats ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-dark-900 rounded p-2 text-center">
                    <div className="text-lg text-neon-green">{stats.totalChunks}</div>
                    <div className="text-xs text-gray-500">chunków</div>
                  </div>
                  <div className="bg-dark-900 rounded p-2 text-center">
                    <div className="text-lg text-cyan-400">{stats.embeddedChunks}</div>
                    <div className="text-xs text-gray-500">embeddingów</div>
                  </div>
                  <div className="bg-dark-900 rounded p-2 text-center">
                    <div className="text-lg text-purple-400">{(stats.totalTokens / 1000).toFixed(1)}k</div>
                    <div className="text-xs text-gray-500">tokenów</div>
                  </div>
                </div>

                {stats.lastSync && (
                  <div className="text-xs text-gray-500">
                    Ostatni sync: {new Date(stats.lastSync).toLocaleString('pl-PL')}
                  </div>
                )}

                {stats.sources.length > 0 && (
                  <div className="space-y-1">
                    {stats.sources.map(s => (
                      <div key={s.source_path} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          {sourceBadge(s.source_type, s.lesson_code)}
                          <span className="text-gray-400 truncate max-w-[200px]">{s.source_path}</span>
                        </div>
                        <span className="text-gray-600">{s.chunks} ch · {(s.tokens / 1000).toFixed(1)}k tok</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-gray-600">Brak danych — uruchom SYNC</div>
            )}
          </section>
        </div>
      </main>

      {/* Footer */}
      <NavFooter
        label="KNOWLEDGE"
        onEasterEgg={() => setBootTerminal(true)}
        stats={stats ? `${stats.totalChunks} chunks · ${stats.embeddedChunks} embedded · ${(stats.totalTokens / 1000).toFixed(1)}k tokens` : 'no data'}
      />

      {bootTerminal && <BootTerminal onClose={() => setBootTerminal(false)} />}
    </div>
  );
}
