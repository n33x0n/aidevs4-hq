import { useState, useEffect } from 'react';

interface HourlyData {
  hour: string;
  count: number;
}

interface TopPost {
  title: string;
  comment_count: number;
  url: string;
}

interface TopAuthor {
  author: string;
  comment_count: number;
}

export default function StatsPanel() {
  const [hourly, setHourly] = useState<HourlyData[]>([]);
  const [topPosts, setTopPosts] = useState<TopPost[]>([]);
  const [topAuthors, setTopAuthors] = useState<TopAuthor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/notifications/stats')
      .then((r) => r.json())
      .then((data) => {
        setHourly(data.hourly || []);
        setTopPosts(data.topPosts || []);
        setTopAuthors(data.topAuthors || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const maxCount = Math.max(1, ...hourly.map((h) => h.count));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500 font-mono text-sm">
        Loading stats...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-dark-900/95 backdrop-blur border-b border-dark-600 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <a href="/notifications" className="text-gray-500 hover:text-neon-green transition text-sm">← NOTIFICATIONS</a>
          <h1 className="font-mono text-sm font-bold tracking-wider text-neon-green">
            SIGINT // STATS
          </h1>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 space-y-8">
        {/* Activity chart */}
        {hourly.length > 0 && (
          <section>
            <h2 className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">Activity (hourly)</h2>
            <div className="bg-dark-800 border border-dark-700 rounded p-4 overflow-x-auto">
              <div className="flex items-end gap-px min-w-max" style={{ height: '120px' }}>
                {hourly.map((h, i) => {
                  const pct = (h.count / maxCount) * 100;
                  const isDay = i % 24 === 0;
                  return (
                    <div
                      key={h.hour}
                      className="group relative flex-shrink-0"
                      style={{ width: '4px' }}
                    >
                      <div
                        className={`w-full rounded-t transition ${
                          h.count > 0 ? 'bg-neon-green/60 group-hover:bg-neon-green' : 'bg-dark-700'
                        }`}
                        style={{ height: `${Math.max(1, pct)}%` }}
                      />
                      {isDay && (
                        <div className="absolute -bottom-5 left-0 text-[8px] text-gray-600 font-mono whitespace-nowrap">
                          {h.hour.slice(5, 10)}
                        </div>
                      )}
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-dark-600 text-gray-300 text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                        {h.hour.slice(0, 16)}: {h.count}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top posts */}
          <section>
            <h2 className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">Top posts (by comments)</h2>
            <div className="bg-dark-800 border border-dark-700 rounded divide-y divide-dark-700">
              {topPosts.length === 0 ? (
                <div className="px-3 py-4 text-xs text-gray-600 font-mono">No data</div>
              ) : (
                topPosts.map((p, i) => (
                  <div key={i} className="px-3 py-2 flex items-center gap-2">
                    <span className="text-xs font-mono text-neon-green/70 w-8 text-right flex-shrink-0">{p.comment_count}</span>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener"
                      className="text-sm text-gray-400 hover:text-gray-200 truncate transition"
                    >
                      {p.title}
                    </a>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Top authors */}
          <section>
            <h2 className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">Top authors</h2>
            <div className="bg-dark-800 border border-dark-700 rounded divide-y divide-dark-700">
              {topAuthors.length === 0 ? (
                <div className="px-3 py-4 text-xs text-gray-600 font-mono">No data</div>
              ) : (
                topAuthors.map((a, i) => (
                  <div key={i} className="px-3 py-2 flex items-center gap-2">
                    <span className="text-xs font-mono text-neon-green/70 w-8 text-right flex-shrink-0">{a.comment_count}</span>
                    <span className="text-sm text-gray-400">{a.author}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
