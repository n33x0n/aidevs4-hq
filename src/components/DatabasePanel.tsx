import { useState, useEffect, useCallback, useRef } from 'react';
import BootTerminal from './BootTerminal';
import NavHeader from './NavHeader';
import NavFooter from './NavFooter';
import FlagText from './FlagText';

// ── Types ──────────────────────────────────────────────────────────────────

interface DbInfo {
  name: string;
  path: string;
  size: number;
}

interface TableInfo {
  name: string;
  type: string;
  rowCount: number;
}

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface TableSchema {
  columns: ColumnInfo[];
  indexes: { name: string; unique: number; origin: string; partial: number }[];
  sql: string;
}

interface RowsResponse {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
  columns: string[];
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  changes: number;
  duration: number;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncate(val: unknown, maxLen = 120): string {
  const s = val === null ? 'NULL' : String(val);
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function DatabasePanel() {
  const [bootTerminal, setBootTerminal] = useState(false);

  // State: databases & tables
  const [databases, setDatabases] = useState<DbInfo[]>([]);
  const [selectedDb, setSelectedDb] = useState('agent');
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableSchema, setTableSchema] = useState<TableSchema | null>(null);

  // State: table browser
  const [rows, setRows] = useState<RowsResponse | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseSearch, setBrowseSearch] = useState('');
  const [browseOrderBy, setBrowseOrderBy] = useState<string>('');
  const [browseOrderDir, setBrowseOrderDir] = useState<'ASC' | 'DESC'>('DESC');

  // State: SQL editor
  const [sql, setSql] = useState('SELECT * FROM hub_log ORDER BY ts DESC LIMIT 20');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryHistory, setQueryHistory] = useState<string[]>([]);
  const [showSchema, setShowSchema] = useState(false);

  // State: active view
  const [activeView, setActiveView] = useState<'browser' | 'query'>('browser');

  // State: cell detail
  const [expandedCell, setExpandedCell] = useState<{ row: number; col: string } | null>(null);

  const sqlTextareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch databases ────────────────────────────────────────────────────

  const fetchDatabases = useCallback(async () => {
    const res = await fetch('/api/db?action=databases');
    const data = await res.json();
    setDatabases(data);
  }, []);

  const fetchTables = useCallback(async (db: string) => {
    const res = await fetch(`/api/db?action=tables&db=${db}`);
    const data = await res.json();
    setTables(data);
  }, []);

  const fetchSchema = useCallback(async (db: string, table: string) => {
    const res = await fetch(`/api/db?action=schema&db=${db}&table=${encodeURIComponent(table)}`);
    const data = await res.json();
    setTableSchema(data);
  }, []);

  const fetchRows = useCallback(async (db: string, table: string, page: number, search?: string, orderBy?: string, orderDir?: string) => {
    setBrowseLoading(true);
    const params = new URLSearchParams({
      action: 'rows',
      db,
      table,
      page: String(page),
      limit: '50',
    });
    if (search) params.set('search', search);
    if (orderBy) params.set('orderBy', orderBy);
    if (orderDir) params.set('orderDir', orderDir);

    const res = await fetch(`/api/db?${params}`);
    const data = await res.json();
    setRows(data);
    setBrowseLoading(false);
  }, []);

  // ── Effects ────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchDatabases();
  }, [fetchDatabases]);

  useEffect(() => {
    fetchTables(selectedDb);
    setSelectedTable(null);
    setTableSchema(null);
    setRows(null);
  }, [selectedDb, fetchTables]);

  useEffect(() => {
    if (selectedTable) {
      fetchSchema(selectedDb, selectedTable);
      setBrowsePage(1);
      setBrowseSearch('');
      setBrowseOrderBy('');
      setBrowseOrderDir('DESC');
      fetchRows(selectedDb, selectedTable, 1);
    }
  }, [selectedDb, selectedTable, fetchSchema, fetchRows]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleTableClick = (table: string) => {
    setSelectedTable(table);
    setActiveView('browser');
  };

  const handleBrowseSearch = () => {
    setBrowsePage(1);
    fetchRows(selectedDb, selectedTable!, 1, browseSearch, browseOrderBy, browseOrderDir);
  };

  const handlePageChange = (newPage: number) => {
    setBrowsePage(newPage);
    fetchRows(selectedDb, selectedTable!, newPage, browseSearch, browseOrderBy, browseOrderDir);
  };

  const handleSort = (col: string) => {
    const newDir = browseOrderBy === col && browseOrderDir === 'ASC' ? 'DESC' : 'ASC';
    setBrowseOrderBy(col);
    setBrowseOrderDir(newDir);
    setBrowsePage(1);
    fetchRows(selectedDb, selectedTable!, 1, browseSearch, col, newDir);
  };

  const handleRunQuery = async () => {
    if (!sql.trim()) return;
    setQueryLoading(true);
    setQueryResult(null);

    const res = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db: selectedDb, sql: sql.trim() }),
    });
    const data = await res.json();
    setQueryResult(data);
    setQueryLoading(false);

    if (!data.error) {
      setQueryHistory((prev) => {
        const next = [sql.trim(), ...prev.filter((q) => q !== sql.trim())];
        return next.slice(0, 30);
      });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setSql(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRunQuery();
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────

  const totalPages = rows ? Math.ceil(rows.total / rows.limit) : 0;

  const renderWithFlags = (text: string) => <FlagText text={text} />;

  const renderCellValue = (val: unknown, rowIdx: number, col: string) => {
    const isExpanded = expandedCell?.row === rowIdx && expandedCell?.col === col;
    const str = val === null ? 'NULL' : String(val);
    const isNull = val === null;
    const isTs = (col === 'ts' || col === 'found_at') && typeof val === 'string' && val.includes('T');
    const isLong = str.length > 120;

    return (
      <div
        className={`${isNull ? 'text-gray-600 italic' : 'text-gray-300'} ${isLong && !isExpanded ? 'cursor-pointer hover:text-white' : ''}`}
        onClick={() => isLong ? setExpandedCell(isExpanded ? null : { row: rowIdx, col }) : undefined}
        title={isLong && !isExpanded ? 'Kliknij aby rozwinąć' : undefined}
      >
        {isTs ? (
          <>{str.split('T')[0]}<br /><span className="text-gray-500">{str.split('T')[1]}</span></>
        ) : isExpanded ? (
          <pre className="whitespace-pre-wrap break-all text-xs max-h-96 overflow-auto bg-dark-700 p-2 rounded mt-1">{renderWithFlags(str)}</pre>
        ) : (
          renderWithFlags(truncate(val))
        )}
      </div>
    );
  };

  const colWidth = (col: string): string | undefined => {
    const c = col.toLowerCase();
    if (c === 'id') return 'w-14';
    if (c === 'kind' || c === 'direction') return 'w-20';
    if (c === 'http_status' || c === 'code') return 'w-20';
    if (c === 'task') return 'w-24';
    if (c === 'ts' || c === 'found_at') return 'w-28';
    if (c === 'flag') return 'w-36';
    return undefined; // content columns (payload etc.) get remaining space
  };

  const renderDataTable = (columns: string[], data: Record<string, unknown>[], rowOffset = 0) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono table-fixed">
        <thead>
          <tr className="border-b border-dark-600">
            <th className="px-2 py-1.5 text-left text-gray-500 font-normal w-10">#</th>
            {columns.map((col) => (
              <th
                key={col}
                className={`px-2 py-1.5 text-left text-gray-400 font-semibold cursor-pointer hover:text-neon-green transition-colors whitespace-nowrap overflow-hidden text-ellipsis ${colWidth(col) ?? ''}`}
                onClick={() => activeView === 'browser' && selectedTable ? handleSort(col) : undefined}
              >
                {col}
                {browseOrderBy === col && activeView === 'browser' && (
                  <span className="text-neon-green ml-1">{browseOrderDir === 'ASC' ? '▲' : '▼'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-b border-dark-600/50 hover:bg-dark-700/50 transition-colors">
              <td className="px-2 py-1 text-gray-600 w-10">{rowOffset + i + 1}</td>
              {columns.map((col) => (
                <td key={col} className={`px-2 py-1 overflow-hidden text-ellipsis ${colWidth(col) ?? ''}`}>
                  {renderCellValue(row[col], rowOffset + i, col)}
                </td>
              ))}
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="px-2 py-8 text-center text-gray-600">
                Brak danych
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">
      <NavHeader activeTab="DATABASE" />

      {/* Main */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">

          {/* ── Left sidebar: DB selector + tables ──────────────────── */}
          <div className="lg:col-span-1 space-y-3">
            {/* Database selector */}
            <div className="bg-dark-800 border border-dark-600 rounded-lg p-3">
              <label className="block text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Baza danych</label>
              <div className="flex flex-col gap-1">
                {databases.map((db) => (
                  <button
                    key={db.name}
                    onClick={() => setSelectedDb(db.name)}
                    className={`text-left px-3 py-2 rounded text-sm font-mono transition-colors ${
                      selectedDb === db.name
                        ? 'bg-neon-green/10 border border-neon-green/30 text-neon-green'
                        : 'text-gray-400 hover:text-white hover:bg-dark-700'
                    }`}
                  >
                    <div className="font-semibold">{db.name}.db</div>
                    <div className="text-xs text-gray-600">{formatBytes(db.size)}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Tables list */}
            <div className="bg-dark-800 border border-dark-600 rounded-lg p-3">
              <label className="block text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">
                Tabele ({tables.length})
              </label>
              <div className="flex flex-col gap-0.5 max-h-80 overflow-y-auto">
                {tables.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => handleTableClick(t.name)}
                    className={`text-left px-3 py-2 rounded text-sm font-mono transition-colors flex items-center justify-between ${
                      selectedTable === t.name
                        ? 'bg-neon-green/10 border border-neon-green/30 text-neon-green'
                        : 'text-gray-400 hover:text-white hover:bg-dark-700'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-gray-600">{t.type === 'view' ? '👁' : '◻'}</span>
                      {t.name}
                    </span>
                    <span className="text-xs text-gray-600">{t.rowCount}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Schema */}
            {tableSchema && selectedTable && (
              <div className="bg-dark-800 border border-dark-600 rounded-lg p-3">
                <button
                  onClick={() => setShowSchema(!showSchema)}
                  className="w-full text-left text-xs font-mono text-gray-500 uppercase tracking-wider flex items-center justify-between"
                >
                  <span>Schemat: {selectedTable}</span>
                  <span className="text-gray-600">{showSchema ? '▼' : '▶'}</span>
                </button>
                {showSchema && (
                  <div className="mt-2 space-y-1">
                    {tableSchema.columns.map((col) => (
                      <div
                        key={col.cid}
                        className="flex items-center gap-2 text-xs font-mono py-0.5 cursor-pointer hover:bg-dark-700 px-1 rounded"
                        onClick={() => {
                          setSql(`SELECT "${col.name}" FROM "${selectedTable}" LIMIT 100`);
                          setActiveView('query');
                        }}
                      >
                        <span className={col.pk ? 'text-neon-green' : 'text-gray-500'}>{col.pk ? '🔑' : '  '}</span>
                        <span className="text-gray-300">{col.name}</span>
                        <span className="text-gray-600 text-[10px]">{col.type || 'ANY'}</span>
                        {col.notnull ? <span className="text-red-400/50 text-[10px]">NOT NULL</span> : null}
                      </div>
                    ))}
                    {tableSchema.sql && (
                      <pre className="mt-2 text-[10px] text-gray-600 whitespace-pre-wrap break-all bg-dark-700 p-2 rounded max-h-40 overflow-auto">
                        {tableSchema.sql}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Right panel: browser + query ─────────────────────── */}
          <div className="lg:col-span-3 space-y-3">
            {/* View switcher */}
            <div className="flex items-center gap-4 bg-dark-800 border border-dark-600 rounded-lg px-4 py-2">
              <button
                onClick={() => setActiveView('browser')}
                className={`font-mono text-sm pb-1 transition-colors ${
                  activeView === 'browser'
                    ? 'border-b-2 border-neon-green text-neon-green'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                BROWSER
              </button>
              <button
                onClick={() => setActiveView('query')}
                className={`font-mono text-sm pb-1 transition-colors ${
                  activeView === 'query'
                    ? 'border-b-2 border-neon-green text-neon-green'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                SQL QUERY
              </button>
              {activeView === 'browser' && selectedTable && rows && (
                <span className="ml-auto text-xs font-mono text-gray-600">
                  {rows.total} {rows.total === 1 ? 'rekord' : 'rekordów'} w <span className="text-gray-400">{selectedTable}</span>
                </span>
              )}
              {activeView === 'query' && queryResult && !queryResult.error && (
                <span className="ml-auto text-xs font-mono text-gray-600">
                  {queryResult.rowCount} {queryResult.rowCount === 1 ? 'rekord' : 'rekordów'} · {queryResult.duration.toFixed(1)}ms
                </span>
              )}
            </div>

            {/* ── Browser view ──────────────────────────────────── */}
            {activeView === 'browser' && (
              <>
                {selectedTable ? (
                  <div className="bg-dark-800 border border-dark-600 rounded-lg overflow-hidden">
                    {/* Search + pagination bar */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-dark-600">
                      <input
                        type="text"
                        value={browseSearch}
                        onChange={(e) => setBrowseSearch(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleBrowseSearch()}
                        placeholder="Szukaj w tabeli..."
                        className="flex-1 bg-dark-700 border border-dark-600 rounded px-3 py-1.5 text-sm text-gray-100 font-mono focus:outline-none focus:border-neon-green placeholder:text-gray-600"
                      />
                      <button
                        onClick={handleBrowseSearch}
                        className="px-3 py-1.5 text-xs font-mono bg-neon-green/10 border border-neon-green/30 text-neon-green rounded hover:bg-neon-green/20 transition-colors"
                      >
                        SZUKAJ
                      </button>
                      <button
                        onClick={() => {
                          setBrowseSearch('');
                          setBrowsePage(1);
                          fetchRows(selectedDb, selectedTable!, 1);
                        }}
                        className="px-3 py-1.5 text-xs font-mono text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        RESET
                      </button>
                    </div>

                    {/* Table data */}
                    {browseLoading ? (
                      <div className="flex items-center justify-center py-12 text-gray-600 font-mono text-sm">
                        <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Wczytywanie...
                      </div>
                    ) : rows ? (
                      renderDataTable(rows.columns, rows.rows as Record<string, unknown>[], (rows.page - 1) * rows.limit)
                    ) : null}

                    {/* Pagination */}
                    {rows && totalPages > 1 && (
                      <div className="flex items-center justify-between px-3 py-2 border-t border-dark-600">
                        <button
                          onClick={() => handlePageChange(browsePage - 1)}
                          disabled={browsePage <= 1}
                          className="px-2 py-1 text-xs font-mono text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          ← Poprzednia
                        </button>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                            let page: number;
                            if (totalPages <= 7) {
                              page = i + 1;
                            } else if (browsePage <= 4) {
                              page = i + 1;
                            } else if (browsePage >= totalPages - 3) {
                              page = totalPages - 6 + i;
                            } else {
                              page = browsePage - 3 + i;
                            }
                            return (
                              <button
                                key={page}
                                onClick={() => handlePageChange(page)}
                                className={`w-7 h-7 text-xs font-mono rounded transition-colors ${
                                  page === browsePage
                                    ? 'bg-neon-green/20 text-neon-green border border-neon-green/30'
                                    : 'text-gray-500 hover:text-white hover:bg-dark-700'
                                }`}
                              >
                                {page}
                              </button>
                            );
                          })}
                          {totalPages > 7 && browsePage < totalPages - 3 && (
                            <span className="text-gray-600 text-xs">... {totalPages}</span>
                          )}
                        </div>
                        <button
                          onClick={() => handlePageChange(browsePage + 1)}
                          disabled={browsePage >= totalPages}
                          className="px-2 py-1 text-xs font-mono text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          Następna →
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-dark-800 border border-dark-600 rounded-lg p-12 flex items-center justify-center">
                    <span className="text-gray-600 font-mono text-sm">Wybierz tabelę z panelu po lewej</span>
                  </div>
                )}
              </>
            )}

            {/* ── Query view ────────────────────────────────────── */}
            {activeView === 'query' && (
              <div className="space-y-3">
                {/* SQL editor */}
                <div className="bg-dark-800 border border-dark-600 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-dark-600">
                    <span className="text-xs font-mono text-gray-500 uppercase tracking-wider">SQL Editor</span>
                    <div className="flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".sql,.txt"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-2 py-1 text-xs font-mono text-gray-500 hover:text-white border border-dark-600 hover:border-gray-500 rounded transition-colors"
                      >
                        LOAD FILE
                      </button>
                      {queryHistory.length > 0 && (
                        <select
                          onChange={(e) => {
                            if (e.target.value) setSql(e.target.value);
                            e.target.value = '';
                          }}
                          className="bg-dark-700 border border-dark-600 rounded px-2 py-1 text-xs font-mono text-gray-400 max-w-[200px]"
                          defaultValue=""
                        >
                          <option value="">Historia ({queryHistory.length})</option>
                          {queryHistory.map((q, i) => (
                            <option key={i} value={q}>{q.slice(0, 60)}</option>
                          ))}
                        </select>
                      )}
                      <span className="text-[10px] text-gray-600 font-mono">Ctrl+Enter = uruchom</span>
                    </div>
                  </div>
                  <textarea
                    ref={sqlTextareaRef}
                    value={sql}
                    onChange={(e) => setSql(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={6}
                    spellCheck={false}
                    className="w-full bg-dark-900 text-gray-100 font-mono text-sm p-4 resize-y focus:outline-none leading-relaxed placeholder:text-gray-700"
                    placeholder="SELECT * FROM hub_log ORDER BY ts DESC LIMIT 20"
                  />
                  <div className="flex items-center justify-between px-3 py-2 border-t border-dark-600">
                    <div className="text-xs font-mono text-gray-600">
                      Baza: <span className="text-gray-400">{selectedDb}</span>
                    </div>
                    <button
                      onClick={handleRunQuery}
                      disabled={queryLoading || !sql.trim()}
                      className="px-4 py-1.5 text-sm font-mono bg-neon-green/10 border border-neon-green/30 text-neon-green rounded hover:bg-neon-green/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {queryLoading ? (
                        <>
                          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          EXECUTING...
                        </>
                      ) : (
                        'RUN ▶'
                      )}
                    </button>
                  </div>
                </div>

                {/* Query results */}
                {queryResult && (
                  <div className="bg-dark-800 border border-dark-600 rounded-lg overflow-hidden">
                    {queryResult.error ? (
                      <div className="px-4 py-3 text-red-400 text-sm font-mono">
                        <span className="text-red-500 font-bold">ERROR:</span> {queryResult.error}
                      </div>
                    ) : queryResult.columns.length > 0 ? (
                      renderDataTable(queryResult.columns, queryResult.rows as Record<string, unknown>[])
                    ) : (
                      <div className="px-4 py-3 text-gray-400 text-sm font-mono">
                        Zapytanie wykonane. Zmiany: {queryResult.changes}. Czas: {queryResult.duration.toFixed(1)}ms
                      </div>
                    )}
                  </div>
                )}

                {/* Quick queries */}
                <div className="bg-dark-800 border border-dark-600 rounded-lg p-3">
                  <label className="block text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Szybkie zapytania</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: 'Tabele', sql: "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'" },
                      { label: 'Hub log', sql: 'SELECT * FROM hub_log ORDER BY ts DESC LIMIT 50' },
                      { label: 'Flagi', sql: 'SELECT * FROM task_flags ORDER BY found_at DESC' },
                      { label: 'Statystyki', sql: "SELECT task, COUNT(*) as calls, SUM(CASE WHEN flag IS NOT NULL THEN 1 ELSE 0 END) as flags FROM hub_log GROUP BY task ORDER BY calls DESC" },
                      { label: 'Ostatnie req', sql: "SELECT id, ts, task, substr(payload, 1, 200) as payload_preview FROM hub_log WHERE direction='request' ORDER BY ts DESC LIMIT 20" },
                      { label: 'Ostatnie resp', sql: "SELECT id, ts, task, http_status, flag, substr(payload, 1, 200) as payload_preview FROM hub_log WHERE direction='response' ORDER BY ts DESC LIMIT 20" },
                    ].map((q) => (
                      <button
                        key={q.label}
                        onClick={() => { setSql(q.sql); setActiveView('query'); }}
                        className="px-2.5 py-1 text-xs font-mono bg-dark-700 text-gray-400 hover:text-neon-green hover:bg-neon-green/10 border border-dark-600 hover:border-neon-green/30 rounded transition-colors"
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <NavFooter
        label="DATABASE"
        onEasterEgg={() => setBootTerminal(true)}
        stats={databases.map((db) => `${db.name}: ${formatBytes(db.size)}`).join(' · ')}
      />

      {bootTerminal && <BootTerminal onClose={() => setBootTerminal(false)} />}
    </div>
  );
}
