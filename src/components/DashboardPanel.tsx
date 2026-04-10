import { useState, useEffect } from 'react';
import NavHeader from './NavHeader';
import NavFooter from './NavFooter';
import FlagText from './FlagText';

interface TaskStatus {
  id: string;
  name: string;
  lessonCode: string;
  season: number;
  episode: number;
  mainFlag: string | null;
  secretFlag: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
}

interface DashboardData {
  tasks: TaskStatus[];
  totals: { mainFlags: number; secretFlags: number; totalTasks: number };
  usage: {
    totalTokens: number;
    totalCost: number;
    totalCalls: number;
    byModel: Array<{ model: string; tokens: number; cost: number; calls: number }>;
  };
}

export default function DashboardPanel() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const shortModel = (id: string) => (id.split('/').pop() || id).replace(/-\d{8}$/, '');

  function tileColor(t: TaskStatus): string {
    if (t.mainFlag && t.secretFlag) return 'border-neon-green/60 bg-neon-green/10';
    if (t.mainFlag) return 'border-yellow-500/50 bg-yellow-500/10';
    if (t.firstSeen) return 'border-dark-500 bg-dark-800';
    return 'border-dark-600 bg-dark-900/50';
  }

  function statusDot(t: TaskStatus): string {
    if (t.mainFlag && t.secretFlag) return 'bg-neon-green';
    if (t.mainFlag) return 'bg-yellow-500';
    return 'bg-gray-700';
  }

  return (
    <div className="min-h-screen flex flex-col">
      <NavHeader activeTab="DASHBOARD" />

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-neon-green/50 border-t-neon-green rounded-full animate-spin" />
          </div>
        ) : data ? (
          <>
            {/* Progress bar */}
            <section className="bg-dark-800 border border-dark-600 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm text-gray-400 uppercase tracking-wider">Postep kursu</h2>
                <div className="flex gap-4 text-xs font-mono">
                  <span className="text-neon-green">{data.totals.mainFlags}/25 main</span>
                  <span className="text-cyan-400">{data.totals.secretFlags}/19 secrets</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-neon-green w-12 text-right">{data.totals.mainFlags}/25</span>
                  <div className="flex-1 h-2.5 rounded overflow-hidden bg-dark-900">
                    <div
                      className="h-full bg-neon-green/80 rounded transition-all duration-500"
                      style={{ width: `${(data.totals.mainFlags / 25) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-cyan-400 w-12 text-right">{data.totals.secretFlags}/19</span>
                  <div className="flex-1 h-2.5 rounded overflow-hidden bg-dark-900">
                    <div
                      className="h-full bg-cyan-500/60 rounded transition-all duration-500"
                      style={{ width: `${(data.totals.secretFlags / 19) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Grid 5x5 z kolumną na etykiety sezonów */}
            <section className="bg-dark-800 border border-dark-600 rounded-lg p-4">
              <h2 className="text-sm text-gray-400 uppercase tracking-wider mb-4">Siatka misji</h2>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'auto repeat(5, 1fr)' }}>
                {/* Corner (empty) + column headers */}
                <div />
                {[1, 2, 3, 4, 5].map(e => (
                  <div key={`hdr-${e}`} className="text-center text-xs text-gray-600 font-mono pb-1">
                    E{String(e).padStart(2, '0')}
                  </div>
                ))}

                {/* Rows: season label + 5 tiles */}
                {[1, 2, 3, 4, 5].map(s => {
                  const seasonTasks = data.tasks.filter(t => t.season === s);
                  return [
                    <div key={`s${s}`} className="flex items-center justify-center text-xs text-gray-600 font-mono pr-2">
                      S{String(s).padStart(2, '0')}
                    </div>,
                    ...seasonTasks.map(t => (
                      <div
                        key={t.lessonCode}
                        className={`border rounded-lg p-2.5 transition-colors ${tileColor(t)} group relative`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className={`w-2 h-2 rounded-full ${statusDot(t)} flex-shrink-0`} />
                          <span className="text-xs font-mono text-gray-400 truncate">
                            {t.lessonCode.toUpperCase()}
                          </span>
                        </div>

                        <div className="text-[10px] text-gray-500 truncate mb-1">
                          {t.name.replace(/^S\d+E\d+\s*—?\s*/, '').split('—')[0].trim() || '???'}
                        </div>

                        <div className="flex gap-1 flex-wrap">
                          {t.mainFlag && (
                            <span className="text-[9px] px-1 rounded bg-neon-green/20 text-neon-green" title={t.mainFlag}>
                              MAIN
                            </span>
                          )}
                          {t.secretFlag && (
                            <span className="text-[9px] px-1 rounded bg-cyan-500/20 text-cyan-400" title={t.secretFlag}>
                              SECRET
                            </span>
                          )}
                        </div>

                        {/* Hover tooltip */}
                        <div className="hidden group-hover:block absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-dark-900 border border-dark-500 rounded-lg p-3 shadow-lg text-xs">
                          <div className="font-mono text-gray-300 mb-1">{t.name}</div>
                          {t.mainFlag && <div className="text-neon-green"><FlagText text={t.mainFlag} /></div>}
                          {t.secretFlag && <div className="text-cyan-400 mt-0.5"><FlagText text={t.secretFlag} /></div>}
                          {t.firstSeen && (
                            <div className="text-gray-600 mt-1">
                              {new Date(t.firstSeen).toLocaleDateString('pl-PL')}
                              {t.lastSeen !== t.firstSeen && ` — ${new Date(t.lastSeen!).toLocaleDateString('pl-PL')}`}
                            </div>
                          )}
                        </div>
                      </div>
                    )),
                  ];
                })}
              </div>
            </section>

            {/* Timeline z flagami */}
            <section className="bg-dark-800 border border-dark-600 rounded-lg p-4">
              <h2 className="text-sm text-gray-400 uppercase tracking-wider mb-3">Timeline</h2>
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {data.tasks
                  .filter(t => t.mainFlag || t.secretFlag)
                  .sort((a, b) => (a.firstSeen || '').localeCompare(b.firstSeen || ''))
                  .map(t => (
                    <div key={t.lessonCode} className="text-xs font-mono">
                      <div className="flex items-center gap-3">
                        <span className="text-gray-600 w-20 flex-shrink-0">
                          {t.firstSeen ? new Date(t.firstSeen).toLocaleDateString('pl-PL', { month: '2-digit', day: '2-digit' }) : '??'}
                        </span>
                        <span className="text-gray-400 w-14 flex-shrink-0">{t.lessonCode.toUpperCase()}</span>
                        <span className="text-gray-500 flex-1 truncate">
                          {t.name.replace(/^S\d+E\d+\s*—?\s*/, '').split('—')[0].trim()}
                        </span>
                      </div>
                      <div className="ml-[8.5rem] flex flex-col gap-0.5 mt-0.5">
                        {t.mainFlag && (
                          <span className="text-neon-green text-[11px]"><FlagText text={t.mainFlag} /></span>
                        )}
                        {t.secretFlag && (
                          <span className="text-cyan-400 text-[11px]"><FlagText text={t.secretFlag} /></span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </section>

            {/* Usage stats */}
            <section className="bg-dark-800 border border-dark-600 rounded-lg p-4">
              <h2 className="text-sm text-gray-400 uppercase tracking-wider mb-3">Statystyki LLM</h2>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-mono text-neon-green">
                    {data.usage.totalTokens > 1_000_000
                      ? `${(data.usage.totalTokens / 1_000_000).toFixed(1)}M`
                      : `${(data.usage.totalTokens / 1000).toFixed(0)}k`}
                  </div>
                  <div className="text-xs text-gray-600">tokenow</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-mono text-yellow-500">${data.usage.totalCost.toFixed(2)}</div>
                  <div className="text-xs text-gray-600">koszt</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-mono text-cyan-400">{data.usage.totalCalls}</div>
                  <div className="text-xs text-gray-600">wywolan</div>
                </div>
              </div>

              {data.usage.byModel.length > 0 && (
                <div className="space-y-1">
                  {data.usage.byModel.slice(0, 8).map(m => (
                    <div key={m.model} className="flex items-center gap-3 text-xs font-mono">
                      <span className="text-gray-400 flex-1 truncate">{shortModel(m.model)}</span>
                      <span className="text-gray-500 w-16 text-right">{(m.tokens / 1000).toFixed(0)}k</span>
                      <span className="text-gray-600 w-16 text-right">${m.cost.toFixed(3)}</span>
                      <span className="text-gray-700 w-12 text-right">{m.calls}x</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="text-center py-20 text-gray-600 text-sm">Brak danych</div>
        )}
      </main>

      <NavFooter label="DASHBOARD" />
    </div>
  );
}
