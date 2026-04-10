import { useState, useEffect, useRef, useCallback } from 'react';
import BootTerminal from './BootTerminal';
import { readSSEStream } from '../lib/useSSE';
import NavHeader from './NavHeader';
import NavFooter from './NavFooter';
import FlagText from './FlagText';
import { playAlertBeep } from '../lib/audio';

const LS_LOGS_KEY = 'agentv_last_session';
const LS_HISTORY_KEY = 'agentv_run_history';
const SKILL_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

interface Task {
  id: string;
  name: string;
  description: string;
  endpoint: string;
}

interface TaskResult {
  success: boolean;
  flag?: string;
  message: string;
  data?: unknown;
}

interface ModelInfo {
  id: string;
  name: string;
  context_length: number;
  promptPrice: number;
  completionPrice: number;
}

interface LoadedSkill {
  id: string;
  name: string;
  content: string;
}

interface RunRecord {
  id: string;
  timestamp: number;
  taskName: string;
  flag?: string;
}

type SecretPhase = 'idle' | 'asking_is_lesson' | 'asking_lesson_id' | 'asking_max_turns' | 'asking_extra_hints' | 'entering_extra_hints' | 'running';

interface SecretFlow {
  phase: SecretPhase;
  hint: string;
  lessonId?: string;
  maxTurns?: number;
  extraHints?: string;
}

const DEFAULT_MODELS = ['google/gemini-2.0-flash-001'];

function shortModelName(id: string): string {
  const name = id.split('/').pop() || id;
  return name.replace(/-\d{8}$/, '');
}

function formatPrice(m: ModelInfo): string {
  if (m.promptPrice === 0 && m.completionPrice === 0) return 'free';
  return `$${m.promptPrice.toFixed(2)}/$${m.completionPrice.toFixed(2)} /1M`;
}

export default function AgentPanel() {
  const [bootTerminal, setBootTerminal] = useState(false);
  const [showFlagInput, setShowFlagInput] = useState(false);
  const [flagInput, setFlagInput] = useState('');
  const [flagRevealed, setFlagRevealed] = useState(false);

  // Task state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  const [secretEnabled, setSecretEnabled] = useState(false);
  const [agentQuestion, setAgentQuestion] = useState<string | null>(null);
  const [agentAnswer, setAgentAnswer] = useState('');
  const pendingChoiceRef = useRef<((answer: string) => void) | null>(null);
  const agentAnswerRef = useRef<HTMLInputElement>(null);
  const [skillsEnabled, setSkillsEnabled] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageData, setUsageData] = useState<{
    total_calls: number; total_prompt: number; total_completion: number;
    total_tokens: number; total_cost: number;
    by_model: Array<{ model: string; calls: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; estimated_cost: number }>;
  } | null>(null);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Model state
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedModels, setSelectedModels] = useState<string[]>(DEFAULT_MODELS);
  const [debateMode, setDebateMode] = useState(false);
  const [modelsScope, setModelsScope] = useState<'all' | 'secret'>('all');
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // Secret flow state
  const [secretFlow, setSecretFlow] = useState<SecretFlow>({ phase: 'idle', hint: '' });
  const [terminalInput, setTerminalInput] = useState('');
  const terminalInputRef = useRef<HTMLInputElement>(null);
  const terminalTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Skills state
  const [loadedSkills, setLoadedSkills] = useState<LoadedSkill[]>([]);
  const [skillDropActive, setSkillDropActive] = useState(false);
  const skillFileInputRef = useRef<HTMLInputElement>(null);

  // Azyl terminal state
  const [azylOpen, setAzylOpen] = useState(false);
  const [azylHistory, setAzylHistory] = useState<string[]>([]);
  const [azylInput, setAzylInput] = useState('');
  const [azylLoading, setAzylLoading] = useState(false);
  const [azylTailing, setAzylTailing] = useState(false);
  const [outputBlurred, setOutputBlurred] = useState(false);
  const azylHistoryEndRef = useRef<HTMLDivElement>(null);
  const azylInputRef = useRef<HTMLInputElement>(null);
  const azylTailAbortRef = useRef<AbortController | null>(null);


  // Load logs and history from localStorage after hydration
  useEffect(() => {
    try {
      const logsData = localStorage.getItem(LS_LOGS_KEY);
      if (logsData) setLogs(JSON.parse(logsData));
    } catch { /* ignore */ }
    try {
      const historyData = localStorage.getItem(LS_HISTORY_KEY);
      if (historyData) setRunHistory(JSON.parse(historyData));
    } catch { /* ignore */ }
  }, []);

  // Fetch tasks
  useEffect(() => {
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((data: Task[]) => {
        setTasks(data);
        if (data.length > 0) setSelectedTask(data[0].id);
      });
  }, []);

  // Fetch models
  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((data: ModelInfo[]) => {
        if (Array.isArray(data)) setAvailableModels(data);
      })
      .catch(() => {});
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Auto-scroll azyl history
  useEffect(() => {
    azylHistoryEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [azylHistory]);

  // Auto-focus azyl input when terminal opens
  useEffect(() => {
    if (azylOpen) setTimeout(() => azylInputRef.current?.focus(), 50);
  }, [azylOpen]);

  // Persist logs to localStorage
  useEffect(() => {
    if (logs.length === 0) return;
    try { localStorage.setItem(LS_LOGS_KEY, JSON.stringify(logs)); } catch { /* ignore */ }
  }, [logs]);

  // Auto-focus terminal input when secret phase changes
  useEffect(() => {
    if (
      secretFlow.phase === 'asking_is_lesson' ||
      secretFlow.phase === 'asking_lesson_id' ||
      secretFlow.phase === 'asking_max_turns' ||
      secretFlow.phase === 'asking_extra_hints'
    ) {
      setTimeout(() => terminalInputRef.current?.focus(), 50);
    } else if (secretFlow.phase === 'entering_extra_hints') {
      setTimeout(() => terminalTextareaRef.current?.focus(), 50);
    }
  }, [secretFlow.phase]);

  // Close search dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedTaskInfo = tasks.find((t) => t.id === selectedTask);

  // Model helpers
  const selectedSet = new Set(selectedModels);
  const filteredModels = modelSearch.trim()
    ? availableModels
        .filter((m) => !selectedSet.has(m.id))
        .filter((m) => {
          const q = modelSearch.toLowerCase();
          return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
        })
        .slice(0, 10)
    : [];

  const addModel = useCallback((id: string) => {
    setSelectedModels((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setModelSearch('');
    setSearchOpen(false);
  }, []);

  const removeModel = useCallback((idx: number) => {
    setSelectedModels((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Drag and drop
  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedIdx !== null && draggedIdx !== targetIdx) {
      setSelectedModels((prev) => {
        const next = [...prev];
        const [moved] = next.splice(draggedIdx, 1);
        next.splice(targetIdx, 0, moved);
        return next;
      });
    }
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  // ── SSE helper ──────────────────────────────────────────────────────────────
  async function executeSSE(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<TaskResult> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000), // 10 min max
    });

    if (!res.body) throw new Error('Brak strumienia odpowiedzi');

    let finalResult: TaskResult = { success: false, message: '' };
    const loggedFlags = new Set<string>();

    await readSSEStream(res, {
      log: (data) => {
        const msg = data.message as string;
        const logLines = msg.split('\n').filter((l: string) => l.length > 0);
        setLogs((prev) => [
          ...prev,
          ...logLines.map((l: string) =>
            l.startsWith('BŁĄD:') ? '[ERROR] ' + l : '[LOG] ' + l
          ),
        ]);
      },
      model: (data) => {
        const label = data.phase === 'main' ? 'Główne zadanie' : 'Sekretna faza';
        setLogs((prev) => [
          ...prev,
          `[MODEL] ═══ ${label} — ${data.name} (${data.index}/${data.total}) ═══`,
        ]);
      },
      usage: (data) => {
        const u = data as { model: string; promptTokens: number; completionTokens: number };
        const modelInfo = availableModels.find((m) => m.id === u.model);
        let cost = 0;
        let costStr = '';
        if (modelInfo && (modelInfo.promptPrice > 0 || modelInfo.completionPrice > 0)) {
          cost = u.promptTokens / 1_000_000 * modelInfo.promptPrice
            + u.completionTokens / 1_000_000 * modelInfo.completionPrice;
          costStr = ` · ~$${cost.toFixed(4)}`;
        }
        setLogs((prev) => [
          ...prev,
          `[USAGE] ${shortModelName(u.model)} · ${u.promptTokens.toLocaleString()} in + ${u.completionTokens.toLocaleString()} out${costStr}`,
        ]);
        // Persist to database
        const taskName = endpoint.split('/').pop() || 'unknown';
        fetch('/api/usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: taskName, model: u.model, promptTokens: u.promptTokens, completionTokens: u.completionTokens, estimatedCost: cost }),
        }).catch(() => {});
      },
      result: (data) => {
        const taskResult = data as TaskResult;
        finalResult = taskResult;

        if (taskResult.success && taskResult.flag) {
          setResult(taskResult);
          const newFlags = (taskResult.flag?.split(' | ') || []).filter((f) => !loggedFlags.has(f));
          newFlags.forEach((f) => loggedFlags.add(f));
          if (newFlags.length > 0) {
            setLogs((prev) => [
              ...prev,
              ...newFlags.map((f: string) => {
                const m = f.match(/^\{FLG:(.+)\}$/);
                return `[SUCCESS] Flaga: ${m ? `{{FLG:${m[1]}}}` : f}`;
              }),
            ]);
          }
        }
      },
      error: (data) => {
        playAlertBeep();
        setLogs((prev) => [...prev, `[ERROR] ${data.message}`]);
      },
    });

    return finalResult;
  }

  // ── Task endpoint lookup by lesson code (e.g. s01e01) ─────────────────────
  function resolveTaskEndpoint(lessonId: string): string | null {
    const normalized = lessonId.toUpperCase().replace(/S0*(\d+)E0*(\d+)/, (_, s, e) =>
      `S${s.padStart(2, '0')}E${e.padStart(2, '0')}`
    );
    const task = tasks.find((t) => {
      const m = t.name.toUpperCase().match(/S(\d+)E(\d+)/);
      if (!m) return false;
      return `S${m[1].padStart(2, '0')}E${m[2].padStart(2, '0')}` === normalized;
    });
    return task?.endpoint ?? null;
  }

  // ── Skills helpers ─────────────────────────────────────────────────────────
  const removeSkill = useCallback((id: string) => {
    setLoadedSkills((prev) => prev.filter((s) => s.id !== id));
  }, []);

  async function loadSkillFiles(files: File[]) {
    const valid = files.filter((f) => /\.(sh|py|js|md)$/i.test(f.name));
    for (const file of valid) {
      if (file.size > SKILL_MAX_BYTES) {
        setLogs((prev) => [...prev, `[ERROR] Plik "${file.name}" przekracza limit 5 MB — pominięto.`]);
        continue;
      }
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsText(file);
      });
      setLoadedSkills((prev) => [
        ...prev,
        { id: `${file.name}-${Date.now()}`, name: file.name, content },
      ]);
    }
  }

  async function handleSkillDrop(e: React.DragEvent) {
    e.preventDefault();
    setSkillDropActive(false);
    await loadSkillFiles(Array.from(e.dataTransfer.files));
  }

  async function handleSkillFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      await loadSkillFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  }

  // ── Run history ───────────────────────────────────────────────────────────
  function saveRunRecord(taskName: string, flag?: string) {
    setRunHistory((prev) => {
      const rec: RunRecord = { id: Date.now().toString(), timestamp: Date.now(), taskName, flag };
      const next = [rec, ...prev].slice(0, 5);
      try { localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  // ── Export logs as .md ────────────────────────────────────────────────────
  function submitFlag() {
    if (!flagInput.trim()) return;
    if (flagInput.trim() === atob('e0ZMRzpCMDBUX1MzUVUzTkMzfQ==')) {
      const url = atob('dG9tbGViaW9kYS5jb20vYWlkZXZzL3NvbHZlcnMuemlw');
      const pwd = atob('RU1NRVRUQlJPV04=');
      const urlLine = `[AGENT]  ║   ${url}${' '.repeat(54 - 3 - url.length)}║`;
      const pwdLine = `[AGENT]  ║   Password: ${pwd}${' '.repeat(54 - 3 - 10 - pwd.length)}║`;
      setFlagRevealed(true);
      setLogs([
        '[SUCCESS] Flag accepted. Access granted.',
        '[AGENT]  ',
        '[AGENT]  ╔══════════════════════════════════════════════════════╗',
        '[AGENT]  ║                                                      ║',
        '[AGENT]  ║   SOLVERS UNLOCKED                                   ║',
        '[AGENT]  ║                                                      ║',
        urlLine,
        '[AGENT]  ║                                                      ║',
        pwdLine,
        '[AGENT]  ║                                                      ║',
        '[AGENT]  ║   Unzip into /src/tasks/ and restart dev server.     ║',
        '[AGENT]  ║                                                      ║',
        '[AGENT]  ╚══════════════════════════════════════════════════════╝',
        '[AGENT]  ',
      ]);
      setResult(null);
    } else {
      setLogs(['[ERROR] Invalid flag. Access denied.']);
      setResult(null);
    }
  }

  function exportLogs() {
    const date = new Date().toLocaleString('pl-PL');
    const taskName = selectedTaskInfo?.name ?? 'Sesja';
    let md = `# Agent V — ${taskName}\n\n**Data:** ${date}\n\n## Output\n\n\`\`\`\n`;
    md += logs.map((l) => {
      const m = l.match(/^\[(\w+)\]\s*(.*)/s);
      return m ? `[${m[1]}] :: ${m[2]}` : l;
    }).join('\n');
    md += '\n```\n';
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agentv-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── Secret: direct (hint only → LLM) ──────────────────────────────────────
  async function runSecretDirect(hint: string, extraHints: string) {
    setLoading(true);
    try {
      setLogs((prev) => [...prev, '[AGENT] Przekazuję podpowiedź do LLM...']);
      await executeSSE('/api/tasks/secret-analyze', {
        mode: 'direct',
        hint,
        extraHints,
        model: selectedModels[0] || DEFAULT_MODELS[0],
        skills: loadedSkills.map(({ name, content }) => ({ name, content })),
      });
    } catch (err) {
      setLogs((prev) => [
        ...prev,
        `[ERROR] ${err instanceof Error ? err.message : String(err)}`,
      ]);
    } finally {
      setLoading(false);
      setSecretFlow({ phase: 'idle', hint: '' });
    }
  }

  // ── Secret: lesson (run agent → LLM analysis) ─────────────────────────────
  async function runSecretLesson(hint: string, lessonId: string, maxTurns = 5, extraHints = '') {
    setLoading(true);
    try {
      const endpoint = resolveTaskEndpoint(lessonId);
      if (!endpoint) {
        const available = tasks
          .map((t) => {
            const m = t.name.match(/S\d+E\d+/i);
            return m ? m[0].toLowerCase() : null;
          })
          .filter(Boolean)
          .join(', ');
        setLogs((prev) => [
          ...prev,
          `[ERROR] Nie znaleziono zadania "${lessonId}". Dostępne: ${available || 'brak'}`,
        ]);
        return;
      }

      setLogs((prev) => [
        ...prev,
        `[AGENT] ═══ Faza 1: Uruchamiam solver dla zadania ${lessonId.toUpperCase()} ═══`,
      ]);

      const lessonResult = await executeSSE(endpoint, {
        models: selectedModels.length > 0 ? selectedModels : DEFAULT_MODELS,
        debate: false,
        modelsScope: 'all',
      });

      setLogs((prev) => [
        ...prev,
        `[AGENT] ═══ Faza 2: Analiza LLM (${maxTurns} tur) w poszukiwaniu sekretu ═══`,
      ]);

      await executeSSE('/api/tasks/secret-analyze', {
        mode: 'lesson',
        hint,
        lessonId,
        lessonResult: JSON.stringify(lessonResult, null, 2),
        extraHints,
        model: selectedModels[0] || DEFAULT_MODELS[0],
        maxTurns,
        skills: loadedSkills.map(({ name, content }) => ({ name, content })),
      });
    } catch (err) {
      setLogs((prev) => [
        ...prev,
        `[ERROR] ${err instanceof Error ? err.message : String(err)}`,
      ]);
    } finally {
      setLoading(false);
      setSecretFlow({ phase: 'idle', hint: '' });
    }
  }

  // ── Interactive terminal input handler ────────────────────────────────────
  async function handleTerminalInput(value: string) {
    const trimmed = value.trim();
    setTerminalInput('');
    setLogs((prev) => [...prev, `[USER] ${trimmed}`]);

    // File path detection — works in any interactive phase
    if (trimmed.startsWith('/data/') || trimmed.startsWith('/lessons/')) {
      try {
        const res = await fetch(`/api/readfile?path=${encodeURIComponent(trimmed)}`);
        const data = await res.json() as { content?: string; lines?: number; error?: string };
        if (data.content) {
          const fileName = trimmed.split('/').pop() || trimmed;
          setLoadedSkills((prev) => [
            ...prev,
            { id: `${fileName}-${Date.now()}`, name: fileName, content: data.content! },
          ]);
          setLogs((prev) => [
            ...prev,
            `[AGENT] Załadowano "${fileName}" (${data.lines} linii) jako skill.`,
          ]);
        } else {
          setLogs((prev) => [...prev, `[ERROR] ${data.error || 'Nie można załadować pliku.'}`]);
        }
      } catch (err) {
        setLogs((prev) => [...prev, `[ERROR] ${err instanceof Error ? err.message : String(err)}`]);
      }
      return;
    }

    if (secretFlow.phase === 'asking_is_lesson') {
      const answer = trimmed.toLowerCase();
      if (answer === 'y' || answer === 'yes') {
        const available = tasks
          .map((t) => { const m = t.name.match(/S\d+E\d+/i); return m ? m[0].toLowerCase() : null; })
          .filter(Boolean).join(', ');
        setLogs((prev) => [
          ...prev,
          `[AGENT] Której lekcji dotyczy podpowiedź? (format: s01e01)${available ? `  Dostępne: ${available}` : ''}`,
        ]);
        setSecretFlow((prev) => ({ ...prev, phase: 'asking_lesson_id' }));
      } else if (answer === 'n' || answer === 'no') {
        setLogs((prev) => [...prev, '[AGENT] Czy masz dodatkowe wskazówki do dodania? (y/n)']);
        setSecretFlow((prev) => ({ ...prev, phase: 'asking_extra_hints' }));
      } else {
        setLogs((prev) => [...prev, '[ERROR] Nieprawidłowa odpowiedź. Wpisz y lub n.']);
      }
      return;
    }

    if (secretFlow.phase === 'asking_lesson_id') {
      const lessonMatch = trimmed.match(/^[sS](\d{1,2})[eE](\d{1,2})$/);
      if (!lessonMatch) {
        setLogs((prev) => [
          ...prev,
          '[ERROR] Nieprawidłowy format. Użyj s01e01 lub S01E01.',
        ]);
        return;
      }
      const lessonId = `s${lessonMatch[1].padStart(2, '0')}e${lessonMatch[2].padStart(2, '0')}`;
      setLogs((prev) => [...prev, '[AGENT] Ile tur ma wykonać agent? (1–10, Enter = 5)']);
      setSecretFlow((prev) => ({ ...prev, phase: 'asking_max_turns', lessonId }));
      return;
    }

    if (secretFlow.phase === 'asking_max_turns') {
      let maxTurns = 5;
      if (trimmed !== '') {
        const n = parseInt(trimmed, 10);
        if (isNaN(n) || n < 1 || n > 10) {
          setLogs((prev) => [
            ...prev,
            '[ERROR] Podaj liczbę od 1 do 10 lub naciśnij Enter (domyślnie 5).',
          ]);
          return;
        }
        maxTurns = n;
      }
      setLogs((prev) => [...prev, '[AGENT] Czy masz dodatkowe wskazówki do dodania? (y/n)']);
      setSecretFlow((prev) => ({ ...prev, phase: 'asking_extra_hints', maxTurns }));
      return;
    }

    if (secretFlow.phase === 'asking_extra_hints') {
      const answer = trimmed.toLowerCase();
      if (answer === 'y' || answer === 'yes') {
        setLogs((prev) => [...prev, '[AGENT] Wklej wskazówki (Ctrl+Enter aby zakończyć):']);
        setSecretFlow((prev) => ({ ...prev, phase: 'entering_extra_hints' }));
      } else if (answer === 'n' || answer === 'no') {
        setSecretFlow((prev) => ({ ...prev, phase: 'running' }));
        if (secretFlow.lessonId) {
          await runSecretLesson(secretFlow.hint, secretFlow.lessonId, secretFlow.maxTurns ?? 5, '');
        } else {
          await runSecretDirect(secretFlow.hint, '');
        }
      } else {
        setLogs((prev) => [...prev, '[ERROR] Nieprawidłowa odpowiedź. Wpisz y lub n.']);
      }
      return;
    }
  }

  // ── Extra hints textarea submit ────────────────────────────────────────────
  async function handleExtraHintsSubmit(extraHints: string) {
    setTerminalInput('');
    const trimmed = extraHints.trim();
    setLogs((prev) => [
      ...prev,
      trimmed
        ? `[USER] [Wskazówki dodane — ${trimmed.length} znaków]`
        : '[USER] (brak wskazówek)',
    ]);
    setSecretFlow((prev) => ({ ...prev, phase: 'running', extraHints: trimmed }));
    if (secretFlow.lessonId) {
      await runSecretLesson(secretFlow.hint, secretFlow.lessonId, secretFlow.maxTurns ?? 5, trimmed);
    } else {
      await runSecretDirect(secretFlow.hint, trimmed);
    }
  }

  // ── Azyl terminal command handler ─────────────────────────────────────────
  async function handleAzylCommand() {
    const cmd = azylInput.trim();
    if (!cmd || azylLoading) return;
    setAzylInput('');

    // Special local commands
    if (cmd === 'clear') {
      if (azylTailAbortRef.current) { azylTailAbortRef.current.abort(); azylTailAbortRef.current = null; setAzylTailing(false); }
      setAzylHistory([]);
      return;
    }
    if (cmd === 'exit') {
      if (azylTailAbortRef.current) { azylTailAbortRef.current.abort(); azylTailAbortRef.current = null; setAzylTailing(false); }
      setAzylOpen(false);
      return;
    }
    if (cmd === 'info') {
      try {
        const res = await fetch('/api/azyl/exec');
        const info = await res.json() as { user: string; host: string; port: number; remotePort: number; publicUrl: string | null; hasPassword: boolean };
        setAzylHistory((prev) => [
          ...prev,
          `$ ${cmd}`,
          `user:       ${info.user}`,
          `host:       ${info.host}:${info.port}`,
          `remotePort: ${info.remotePort || '(nie ustawiony)'}`,
          `publicUrl:  ${info.publicUrl || '(nie ustawiony)'}`,
          `password:   ${info.hasPassword ? '✓ ustawione' : '✗ brak — dodaj AZYL_PASSWORD do .env'}`,
        ]);
      } catch {
        setAzylHistory((prev) => [...prev, `$ ${cmd}`, '[ERROR] Nie można pobrać info']);
      }
      setTimeout(() => azylInputRef.current?.focus(), 50);
      return;
    }
    if (cmd === 'stop') {
      if (azylTailAbortRef.current) {
        azylTailAbortRef.current.abort();
        azylTailAbortRef.current = null;
      }
      setAzylTailing(false);
      setAzylHistory((prev) => [...prev, `$ ${cmd}`, '[stopped]']);
      setTimeout(() => azylInputRef.current?.focus(), 50);
      return;
    }
    if (cmd.startsWith('logs')) {
      const file = cmd.split(' ')[1] || 'server.log';
      setAzylHistory((prev) => [...prev, `$ ${cmd}`, `[tail -f ~/dev/proxy/${file}] — wpisz "stop" żeby zatrzymać`]);
      setAzylTailing(true);
      const abort = new AbortController();
      azylTailAbortRef.current = abort;

      (async () => {
        try {
          const res = await fetch(`/api/azyl/tail?file=${encodeURIComponent(file)}`, { signal: abort.signal });
          const reader = res.body?.getReader();
          if (!reader) throw new Error('Brak strumienia');
          const decoder = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() || '';
            for (const part of parts) {
              let dataStr = '';
              for (const line of part.split('\n')) {
                if (line.startsWith('data: ')) dataStr = line.slice(6);
              }
              if (!dataStr) continue;
              try {
                const data = JSON.parse(dataStr) as { text?: string; message?: string };
                const text = data.text ?? data.message ?? '';
                if (text) setAzylHistory((prev) => [...prev, text]);
              } catch { /* skip */ }
            }
          }
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            setAzylHistory((prev) => [...prev, `[ERROR] ${err instanceof Error ? err.message : String(err)}`]);
          }
        } finally {
          setAzylTailing(false);
          azylTailAbortRef.current = null;
          setTimeout(() => azylInputRef.current?.focus(), 50);
        }
      })();
      return;
    }

    setAzylHistory((prev) => [...prev, `$ ${cmd}`]);
    setAzylLoading(true);

    try {
      const res = await fetch('/api/azyl/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Brak strumienia odpowiedzi');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.trim()) continue;
          let eventType = 'message';
          let dataStr = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7);
            else if (line.startsWith('data: ')) dataStr += line.slice(6);
          }
          if (!dataStr) continue;
          try {
            const data = JSON.parse(dataStr) as { text?: string; message?: string };
            if (eventType === 'output' && data.text) {
              const lines = data.text.split('\n').filter((l) => l.length > 0);
              setAzylHistory((prev) => [...prev, ...lines]);
            } else if (eventType === 'error' && data.message) {
              setAzylHistory((prev) => [...prev, `[ERROR] ${data.message}`]);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setAzylHistory((prev) => [
        ...prev,
        `[ERROR] ${err instanceof Error ? err.message : String(err)}`,
      ]);
    } finally {
      setAzylLoading(false);
      setTimeout(() => azylInputRef.current?.focus(), 50);
    }
  }

  // ── Pytanie do użytkownika w terminalu ──────────────────────────────────
  function askUser(question: string): Promise<string> {
    return new Promise((resolve) => {
      setAgentQuestion(question);
      setAgentAnswer('');
      pendingChoiceRef.current = (answer: string) => {
        setAgentQuestion(null);
        setAgentAnswer('');
        pendingChoiceRef.current = null;
        resolve(answer);
      };
      setTimeout(() => agentAnswerRef.current?.focus(), 50);
    });
  }

  function submitAgentAnswer() {
    if (pendingChoiceRef.current && agentAnswer.trim()) {
      setLogs((prev) => [...prev, `[USER] ${agentAnswer.trim()}`]);
      pendingChoiceRef.current(agentAnswer.trim());
    }
  }

  // ── Main task runner ──────────────────────────────────────────────────────
  async function runTask() {
    if (!selectedTaskInfo) return;

    // Normal task execution — SEKRET toggle steruje modelsScope
    setLoading(true);
    setResult(null);
    const scope = secretEnabled ? 'all' : 'main';
    const secretHint = secretEnabled ? prompt.trim() : '';
    setLogs([
      '[AGENT] Uruchamiam zadanie: ' + selectedTaskInfo.name + '...',
      ...(secretEnabled ? ['[AGENT] Tryb sekretny aktywowany.' + (secretHint ? ` Podpowiedź: "${secretHint}"` : '')] : []),
    ]);

    // Firmware: pytaj o tryb
    let extraParams: Record<string, unknown> = {};
    if (selectedTaskInfo.id === 'firmware' || selectedTaskInfo.id === 'reactor' || selectedTaskInfo.id === 'savethem' || selectedTaskInfo.id === 'okoeditor' || selectedTaskInfo.id === 'domatowo' || selectedTaskInfo.id === 'filesystem' || selectedTaskInfo.id === 'foodwarehouse' || selectedTaskInfo.id === 'radiomonitoring' || selectedTaskInfo.id === 'phonecall' || selectedTaskInfo.id === 'shellaccess' || selectedTaskInfo.id === 'goingthere') {
      const answer = await askUser('Wybierz tryb solvera: [1] deterministyczny  [2] LLM agent');
      const useLLM = answer.trim() === '2' || answer.toLowerCase().includes('llm');
      extraParams.debate = useLLM;
      setLogs((prev) => [...prev, `[AGENT] Tryb: ${useLLM ? 'LLM agent' : 'deterministyczny'}`]);
    }

    try {
      const taskResult = await executeSSE(selectedTaskInfo.endpoint, {
        prompt: secretHint,
        secretHint,
        models: selectedModels.length > 0 ? selectedModels : DEFAULT_MODELS,
        debate: debateMode,
        modelsScope: scope,
        ...extraParams,
      });
      setLogs((prev) => [...prev, '[RESULT] Zadanie zakończone.']);
      const flagsToSave = taskResult.flag ? taskResult.flag.split(' | ') : [undefined];
      for (const f of flagsToSave) {
        saveRunRecord(selectedTaskInfo.name, f || undefined);
      }
    } catch (err) {
      setLogs((prev) => [
        ...prev,
        `[ERROR] ${err instanceof Error ? err.message : String(err)}`,
      ]);
    } finally {
      setLoading(false);
    }
  }

  function renderTextWithFlags(text: string, className: string) {
    return <span className={`${className} whitespace-pre-wrap`}><FlagText text={text} /></span>;
  }

  // Toggle component
  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none ${
        checked ? 'bg-neon-green/30' : 'bg-dark-600'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full transition-all duration-200 ${
          checked
            ? 'translate-x-[18px] bg-neon-green shadow-[0_0_6px_rgba(117,246,109,0.5)]'
            : 'translate-x-[3px] bg-gray-500'
        }`}
      />
    </button>
  );

  const isInteractive =
    agentQuestion !== null ||
    secretFlow.phase === 'asking_is_lesson' ||
    secretFlow.phase === 'asking_lesson_id' ||
    secretFlow.phase === 'asking_max_turns' ||
    secretFlow.phase === 'asking_extra_hints' ||
    secretFlow.phase === 'entering_extra_hints';

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <NavHeader activeTab="OPERATIONS" />

      {/* Main */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-6 overflow-hidden" style={{ paddingTop: '24px', paddingBottom: '24px' }}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full overflow-hidden">
        {/* Left panel — controls */}
        <div className="lg:col-span-1 space-y-2 overflow-y-auto scrollbar-thin">
          {/* Task selector */}
          <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 space-y-3">
            <label className="block text-sm font-medium text-gray-400 uppercase tracking-wider">
              Zadanie
            </label>
            <select
              value={selectedTask}
              onChange={(e) => setSelectedTask(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded-md px-3 py-2 text-gray-100 font-mono text-sm focus:outline-none focus:border-neon-green transition-colors"
            >
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {selectedTaskInfo && (
              <p className="text-xs text-gray-500 leading-relaxed">
                {selectedTaskInfo.description}
              </p>
            )}
          </div>

          {/* Model selector */}
          <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 space-y-3">
            <label className="block text-sm font-medium text-gray-400 uppercase tracking-wider">
              Model
            </label>

            {/* Search */}
            <div className="relative" ref={searchRef}>
              <svg
                className="absolute left-2.5 top-[9px] w-3.5 h-3.5 text-gray-500 pointer-events-none"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                value={modelSearch}
                onChange={(e) => {
                  setModelSearch(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => {
                  if (modelSearch.trim()) setSearchOpen(true);
                }}
                placeholder="Szukaj modelu..."
                className="w-full bg-dark-700 border border-dark-600 rounded-md pl-8 pr-3 py-2 text-gray-100 font-mono text-sm focus:outline-none focus:border-neon-green transition-colors"
              />

              {/* Dropdown */}
              {searchOpen && filteredModels.length > 0 && (
                <div className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto bg-dark-700 border border-dark-600 rounded-md shadow-xl">
                  {filteredModels.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => addModel(m.id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 transition-colors flex items-baseline justify-between gap-2"
                    >
                      <span className="text-gray-200 font-mono truncate">
                        {m.name || m.id}
                      </span>
                      <span className="text-gray-500 text-xs shrink-0">
                        {formatPrice(m)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Pills */}
            {selectedModels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedModels.map((modelId, i) => (
                  <div
                    key={modelId}
                    draggable
                    onDragStart={(e) => handleDragStart(e, i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDrop={(e) => handleDrop(e, i)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono cursor-grab active:cursor-grabbing transition-all select-none ${
                      draggedIdx === i ? 'opacity-40 scale-95' : ''
                    } ${
                      dragOverIdx === i && draggedIdx !== i
                        ? 'ring-1 ring-neon-green'
                        : ''
                    } bg-neon-green/15 text-neon-green border border-neon-green/30 hover:bg-neon-green/25`}
                  >
                    <span className="text-[10px] text-neon-green/50 mr-0.5">{i + 1}.</span>
                    <span>{shortModelName(modelId)}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeModel(i);
                      }}
                      className="ml-0.5 hover:text-white transition-colors"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Multi-model options */}
            {selectedModels.length > 1 && (
              <div className="space-y-2.5 pt-1 border-t border-dark-600">
                {/* Debate toggle */}
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-gray-400">Debate on solution</span>
                  <Toggle checked={debateMode} onChange={() => setDebateMode(!debateMode)} />
                </div>

                {/* Scope removed — controlled by SEKRET toggle */}
              </div>
            )}
          </div>

          {/* Logs toggle */}
          <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Logi agenta
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={showLogs}
              onClick={() => setShowLogs(!showLogs)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                showLogs ? 'bg-neon-green/30' : 'bg-dark-600'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full transition-all duration-200 ${
                  showLogs
                    ? 'translate-x-[18px] bg-neon-green shadow-[0_0_6px_rgba(117,246,109,0.5)]'
                    : 'translate-x-[3px] bg-gray-500'
                }`}
              />
            </button>
          </div>

          {/* Sekret toggle */}
          <div className="bg-dark-800 border border-dark-600 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                Sekret
              </span>
              <Toggle checked={secretEnabled} onChange={() => setSecretEnabled(!secretEnabled)} />
            </div>
            {secretEnabled && (
              <div className="mt-3">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!loading && !isInteractive && selectedTask) runTask();
                    }
                  }}
                  disabled={loading || isInteractive}
                  placeholder="Dodatkowa instrukcja dla LLM (opcjonalna)..."
                  rows={2}
                  className="w-full bg-dark-700 border border-dark-600 rounded-md px-3 py-2 text-gray-100 font-mono text-sm resize-none focus:outline-none focus:border-neon-green transition-colors placeholder:text-gray-600 disabled:opacity-40"
                />
              </div>
            )}
          </div>

          {/* Skills toggle */}
          <input
            ref={skillFileInputRef}
            type="file"
            accept=".sh,.py,.js,.md"
            multiple
            className="hidden"
            onChange={handleSkillFileInput}
          />
          <div
            className={`bg-dark-800 border rounded-lg p-4 transition-all cursor-default ${
              skillsEnabled && skillDropActive
                ? 'border-neon-green bg-neon-green/5'
                : skillsEnabled
                ? 'border-dashed border-dark-600 hover:border-dark-500'
                : 'border-dark-600'
            }`}
            onDragOver={(e) => { if (skillsEnabled) { e.preventDefault(); setSkillDropActive(true); } }}
            onDragLeave={() => setSkillDropActive(false)}
            onDrop={(e) => { if (skillsEnabled) handleSkillDrop(e); }}
            onDoubleClick={() => { if (skillsEnabled) skillFileInputRef.current?.click(); }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-400 uppercase tracking-wider pointer-events-none">
                Agent Skill
              </span>
              <Toggle checked={skillsEnabled} onChange={() => setSkillsEnabled(!skillsEnabled)} />
            </div>
            {skillsEnabled && (
              <div className="mt-3">
                {loadedSkills.length === 0 ? (
                  <div className="py-1 text-gray-600 text-xs font-mono select-none pointer-events-none">
                    {skillDropActive
                      ? '⬇ Upuść plik tutaj'
                      : 'Przeciągnij .sh / .py / .js / .md'}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {loadedSkills.map((skill) => (
                      <div
                        key={skill.id}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 transition-colors"
                      >
                        <span className="max-w-[8rem] truncate" title={skill.name}>{skill.name}</span>
                        <button
                          onClick={() => removeSkill(skill.id)}
                          className="ml-0.5 hover:text-white transition-colors shrink-0"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Run history */}
          <div className="bg-dark-800 border border-dark-600 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                Historia
              </span>
              <Toggle checked={historyOpen} onChange={() => setHistoryOpen(!historyOpen)} />
            </div>
            {historyOpen && (
              <div className="mt-3 max-h-32 overflow-y-auto space-y-2 scrollbar-thin">
                {runHistory.length === 0 ? (
                  <div className="text-gray-600 text-xs font-mono">Brak historii</div>
                ) : (
                  runHistory.map((rec) => (
                    <div key={rec.id} className="group/hr flex items-center gap-2 text-xs font-mono overflow-hidden">
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="text-gray-500 text-[10px]">
                          {rec.taskName.match(/S\d+E\d+/)?.[0] ?? rec.taskName}
                        </div>
                        <div className="text-gray-600 truncate">
                          {new Date(rec.timestamp).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                      </div>
                      {rec.flag && (
                        <span className="text-neon-green shrink-0 group/hf cursor-default max-w-[40%] truncate" title={rec.flag}>
                          {'{{FLG:'}
                          <span className="blur-sm transition-all duration-300 group-hover/hf:blur-none select-none">
                            {rec.flag.match(/^\{FLG:(.+)\}$/)?.[1] ?? rec.flag}
                          </span>
                          {'}}'}
                        </span>
                      )}
                      <button
                        onClick={() => {
                          const next = runHistory.filter((r) => r.id !== rec.id);
                          setRunHistory(next);
                          try { localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
                        }}
                        className="shrink-0 text-gray-700 hover:text-red-500 opacity-0 group-hover/hr:opacity-100 transition-all ml-auto"
                        title="Usuń z historii"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Run button */}
          <button
            onClick={runTask}
            disabled={loading || !selectedTask || isInteractive}
            className="w-full bg-gradient-to-r from-neon-green/20 to-neon-green-dim/20 border border-neon-green/50 text-neon-green font-mono font-medium py-3 px-6 rounded-lg hover:from-neon-green/30 hover:to-neon-green-dim/30 hover:border-neon-green transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle
                    cx="12" cy="12" r="10"
                    stroke="currentColor" strokeWidth="3"
                    className="opacity-25"
                  />
                  <path
                    d="M4 12a8 8 0 018-8"
                    stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                  />
                </svg>
                Przetwarzam...
              </span>
            ) : (
              'Wyślij Agenta V'
            )}
          </button>
        </div>

        {/* Right panel — terminal output */}
        <div className="lg:col-span-2 flex flex-col overflow-hidden">
          {/* Flag input bar */}
          {showFlagInput && !flagRevealed && (
            <div className="mb-2 flex items-center gap-2 bg-dark-800 border border-[#75F66D]/40 rounded-lg px-4 py-2.5">
              <input
                type="text"
                value={flagInput}
                onChange={(e) => setFlagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitFlag(); }}
                placeholder="Znaleziona flaga"
                className="flex-1 bg-transparent text-[#75F66D] font-mono text-sm focus:outline-none placeholder:text-gray-600 caret-[#75F66D]"
                autoFocus
                spellCheck={false}
                autoComplete="off"
              />
              <button
                onClick={submitFlag}
                className="px-4 py-1.5 bg-dark-700 text-gray-300 text-sm font-mono rounded hover:bg-dark-600 transition-colors border border-dark-500"
              >
                Zg{'ł'}o{'ś'}
              </button>
            </div>
          )}
          <div className="bg-dark-800 border border-dark-600 rounded-lg flex-1 flex flex-col overflow-hidden">
            {/* Terminal header */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-dark-600 bg-dark-700/50">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
              <span className="ml-2 text-xs text-gray-500 font-mono flex-1">
                {usageOpen ? 'token-usage' : azylOpen ? 'azyl-terminal' : 'agent-output'}
                {!azylOpen && isInteractive && (
                  <span className="ml-2 text-neon-green animate-pulse">● interactive</span>
                )}
                {azylOpen && azylLoading && (
                  <span className="ml-2 text-cyan-400 animate-pulse">● connecting...</span>
                )}
                {azylOpen && azylTailing && (
                  <span className="ml-2 text-yellow-400 animate-pulse">● tailing logs → debug.log</span>
                )}
              </span>
              {/* Tokeny button */}
              <button
                onClick={() => {
                  const next = !usageOpen;
                  setUsageOpen(next);
                  if (next) {
                    setAzylOpen(false);
                    fetch('/api/usage').then(r => r.json()).then(setUsageData).catch(() => {});
                  }
                }}
                title={usageOpen ? 'Wróć do agent-output' : 'Statystyki tokenów'}
                className={`text-xs font-mono px-2 py-0.5 rounded transition-colors border ${
                  usageOpen
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30'
                    : 'text-gray-500 border-dark-500 hover:text-purple-400 hover:border-purple-500/40'
                }`}
              >
                TOKENY
              </button>
              {/* Azyl button */}
              <button
                onClick={() => { setAzylOpen((prev) => !prev); setUsageOpen(false); }}
                title={azylOpen ? 'Wróć do agent-output' : 'Otwórz terminal Azylu'}
                className={`text-xs font-mono px-2 py-0.5 rounded transition-colors border ${
                  azylOpen
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/30'
                    : 'text-gray-500 border-dark-500 hover:text-cyan-400 hover:border-cyan-500/40'
                }`}
              >
                AZYL
              </button>
              <div className="flex items-center gap-2">
                  {/* Export as .md */}
                  <button
                    onClick={exportLogs}
                    disabled={logs.length === 0}
                    title="Eksportuj jako .md"
                    className="text-gray-400 hover:text-neon-green transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M12 15V3m0 12l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2 17v2a2 2 0 002 2h16a2 2 0 002-2v-2" strokeLinecap="round" />
                    </svg>
                  </button>
                  {/* Refresh (clear logs) */}
                  <button
                    onClick={() => {
                      setLogs([]);
                      setResult(null);
                      try { localStorage.removeItem(LS_LOGS_KEY); } catch { /* ignore */ }
                    }}
                    disabled={logs.length === 0}
                    title="Wyczyść output"
                    className="text-gray-400 hover:text-neon-green transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {/* Copy */}
                  <button
                    onClick={() => {
                      const text = logs
                        .map((l) => { const m = l.match(/^\[(\w+)\]\s*(.*)/); return m ? `[${m[1]}] :: ${m[2]}` : l; })
                        .join('\n');
                      navigator.clipboard.writeText(text);
                    }}
                    disabled={logs.length === 0}
                    title="Kopiuj output"
                    className="text-gray-400 hover:text-neon-green transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                  </button>
                  {/* Blur toggle */}
                  <button
                    onClick={() => setOutputBlurred((prev) => !prev)}
                    title={outputBlurred ? 'Odkryj output' : 'Zabluruj output'}
                    className={`transition-colors ${outputBlurred ? 'text-neon-green' : 'text-gray-400 hover:text-neon-green'}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      {outputBlurred ? (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" strokeLinecap="round" strokeLinejoin="round" />
                          <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" />
                        </>
                      ) : (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
            </div>

            {/* Terminal body */}
            <div className={`flex-1 overflow-y-auto p-4 font-mono text-sm leading-relaxed transition-all duration-300 ${outputBlurred ? 'blur-md select-none hover:blur-none' : ''}`}>
              {/* ── Token usage view ── */}
              {usageOpen ? (
                usageData ? (
                  <div className="space-y-4">
                    {/* Summary */}
                    <div className="flex items-baseline gap-6 text-gray-300">
                      <div>
                        <span className="text-2xl font-bold tabular-nums">{usageData.total_tokens.toLocaleString()}</span>
                        <span className="text-gray-500 text-sm ml-2">tokenów</span>
                      </div>
                      <div>
                        <span className="text-lg font-bold tabular-nums">{usageData.total_calls}</span>
                        <span className="text-gray-500 text-sm ml-2">wywołań</span>
                      </div>
                      {usageData.total_cost > 0 && (
                        <div>
                          <span className="text-lg font-bold tabular-nums">~${usageData.total_cost.toFixed(4)}</span>
                          <span className="text-gray-500 text-sm ml-2">koszt</span>
                        </div>
                      )}
                    </div>

                    {/* Table */}
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-dark-600">
                          <th className="text-left py-2 font-medium">Model</th>
                          <th className="text-right py-2 font-medium">Wywołania</th>
                          <th className="text-right py-2 font-medium">In</th>
                          <th className="text-right py-2 font-medium">Out</th>
                          <th className="text-right py-2 font-medium">Razem</th>
                          <th className="text-right py-2 font-medium">Koszt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageData.by_model.map((m) => (
                          <tr key={m.model} className="border-b border-dark-700 hover:bg-dark-700/50 transition-colors">
                            <td className="py-1.5 text-purple-400 truncate max-w-[200px]" title={m.model}>
                              {m.model.split('/').pop()?.replace(/-\d{8}$/, '') ?? m.model}
                            </td>
                            <td className="py-1.5 text-gray-500 text-right tabular-nums">{m.calls}</td>
                            <td className="py-1.5 text-gray-400 text-right tabular-nums">{m.prompt_tokens.toLocaleString()}</td>
                            <td className="py-1.5 text-gray-400 text-right tabular-nums">{m.completion_tokens.toLocaleString()}</td>
                            <td className="py-1.5 text-gray-300 text-right tabular-nums">{m.total_tokens.toLocaleString()}</td>
                            <td className="py-1.5 text-gray-600 text-right tabular-nums">{m.estimated_cost > 0 ? `$${m.estimated_cost.toFixed(4)}` : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <button
                      onClick={() => fetch('/api/usage').then(r => r.json()).then(setUsageData).catch(() => {})}
                      className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                    >
                      odśwież
                    </button>
                  </div>
                ) : (
                  <div className="text-gray-600 italic">Ładowanie...</div>
                )
              ) : azylOpen ? (
                <>
                  {azylHistory.length === 0 && (
                    <div className="text-cyan-600 text-xs mb-3">
                      Połączono z Azylem. Wpisz &apos;info&apos; aby sprawdzić konfigurację, &apos;clear&apos; aby wyczyścić, &apos;exit&apos; aby zamknąć.
                    </div>
                  )}
                  {azylHistory.map((line, i) => {
                    const isCmd = line.startsWith('$ ');
                    const isErr = line.startsWith('[ERROR]');
                    return (
                      <div key={i} className={`whitespace-pre-wrap break-all ${
                        isCmd ? 'text-cyan-300 mt-1' : isErr ? 'text-red-400' : 'text-gray-300'
                      }`}>
                        {isCmd && <span className="text-cyan-600 select-none">agent13348@azyl:~</span>}
                        {line}
                      </div>
                    );
                  })}
                  <div ref={azylHistoryEndRef} />
                  {/* Azyl input */}
                  <div className="flex items-center gap-1 mt-2 border-t border-cyan-500/20 pt-2">
                    <span className="text-cyan-600 shrink-0 select-none">agent13348@azyl:~$</span>
                    <input
                      ref={azylInputRef}
                      type="text"
                      value={azylInput}
                      onChange={(e) => setAzylInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAzylCommand();
                      }}
                      disabled={azylLoading}
                      className="bg-transparent text-cyan-200 font-mono text-sm focus:outline-none flex-1 caret-cyan-400 placeholder:text-cyan-700 disabled:opacity-50 ml-1"
                      placeholder="wpisz komendę SSH..."
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {azylLoading && (
                      <svg className="animate-spin h-3.5 w-3.5 text-cyan-500 shrink-0" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    )}
                  </div>
                </>
              ) : logs.length === 0 ? (
                <div className="text-gray-600 italic">
                  Wybierz zadanie i kliknij "Wyślij Agenta V"...
                </div>
              ) : (
                logs
                  .filter((log) =>
                    showLogs
                      ? true
                      : log.startsWith('[AGENT]') ||
                        log.startsWith('[SUCCESS]') ||
                        log.startsWith('[MODEL]') ||
                        log.startsWith('[USER]')
                  )
                  .map((log, i) => {
                    const match = log.match(/^\[(\w+)\]\s*(.*)/s);
                    const tag = match ? match[1] : '';
                    const text = match ? match[2] : log;

                    let tagColor = 'text-gray-500';
                    let textColor = 'text-gray-400';
                    if (tag === 'AGENT') {
                      tagColor = 'text-neon-green';
                      textColor = 'text-neon-green';
                    } else if (tag === 'USER') {
                      tagColor = 'text-cyan-400';
                      textColor = 'text-cyan-300';
                    } else if (tag === 'SUCCESS') {
                      tagColor = 'text-neon-green';
                      textColor = 'text-neon-green font-bold';
                    } else if (tag === 'ERROR') {
                      tagColor = 'text-red-400';
                      textColor = 'text-red-400';
                    } else if (tag === 'RESULT') {
                      tagColor = 'text-yellow-500';
                      textColor = 'text-yellow-500';
                    } else if (tag === 'MODEL') {
                      tagColor = 'text-amber-400';
                      textColor = 'text-amber-400 font-bold';
                    } else if (tag === 'USAGE') {
                      tagColor = 'text-purple-400';
                      textColor = 'text-purple-400';
                    }

                    return (
                      <div key={i} className="flex">
                        <span className={`${tagColor} w-[5.5rem] shrink-0`}>[{tag}]</span>
                        <span className="text-gray-600 shrink-0 mr-2">::</span>
                        <span className={`${textColor} whitespace-pre-wrap break-all min-w-0`}>{renderTextWithFlags(text, textColor)}</span>
                      </div>
                    );
                  })
              )}

              {/* Agent question input */}
              {!azylOpen && agentQuestion && (
                <div className="mt-2 border-t border-cyan-500/20 pt-2">
                  <div className="text-cyan-400 text-sm font-mono mb-1">{agentQuestion}</div>
                  <div className="flex items-center gap-1">
                    <span className="text-cyan-400 shrink-0 select-none">❯</span>
                    <input
                      ref={agentAnswerRef}
                      type="text"
                      value={agentAnswer}
                      onChange={(e) => setAgentAnswer(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitAgentAnswer(); }}
                      className="flex-1 bg-transparent text-cyan-300 font-mono text-sm focus:outline-none caret-cyan-400"
                      placeholder="1 lub 2..."
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                    />
                  </div>
                </div>
              )}

              {/* Interactive terminal input — tylko w trybie agent-output */}
              {!azylOpen && !agentQuestion && isInteractive && (
                <div className="mt-2 border-t border-neon-green/20 pt-2">
                  {secretFlow.phase === 'entering_extra_hints' ? (
                    <div className="space-y-1">
                      <textarea
                        ref={terminalTextareaRef}
                        value={terminalInput}
                        onChange={(e) => setTerminalInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.ctrlKey) {
                            e.preventDefault();
                            handleExtraHintsSubmit(terminalInput);
                          }
                        }}
                        rows={4}
                        className="w-full bg-transparent text-neon-green font-mono text-sm focus:outline-none caret-neon-green placeholder:text-neon-green/30 resize-none border border-neon-green/20 rounded px-2 py-1"
                        placeholder="Wklej wskazówki tutaj..."
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <div className="text-neon-green/40 text-xs font-mono">Ctrl+Enter aby zakończyć</div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="text-neon-green shrink-0 select-none">❯</span>
                      <input
                        ref={terminalInputRef}
                        type="text"
                        value={terminalInput}
                        onChange={(e) => setTerminalInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (secretFlow.phase === 'asking_max_turns' || terminalInput.trim()) {
                              handleTerminalInput(terminalInput);
                            }
                          }
                        }}
                        className="bg-transparent text-neon-green font-mono text-sm focus:outline-none flex-1 caret-neon-green placeholder:text-neon-green/30"
                        placeholder={
                          secretFlow.phase === 'asking_is_lesson' || secretFlow.phase === 'asking_extra_hints'
                            ? 'y / n'
                            : secretFlow.phase === 'asking_lesson_id'
                            ? 's01e01'
                            : '1–10 (Enter = 5)'
                        }
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  )}
                </div>
              )}

              <div ref={logsEndRef} />
            </div>

            {/* Result banner */}
            {result?.flag &&
              result.flag.split(' | ').map((singleFlag, fi) => {
                const flagMatch = singleFlag.match(/^\{FLG:(.+)\}$/);
                const flagValue = flagMatch ? flagMatch[1] : singleFlag;
                return (
                  <div
                    key={fi}
                    className="shrink-0 border-t border-neon-green/30 bg-neon-green/5 px-4 py-3 group/flag cursor-default"
                  >
                    <span className="text-neon-green font-mono font-bold text-lg">
                      {'{{FLG:'}
                      <span className="blur-md transition-all duration-300 group-hover/flag:blur-none">
                        {flagValue}
                      </span>
                      {'}}'}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
        </div>

      </main>

      {/* Footer */}
      <NavFooter
        label="OPERATIONS"
        onEasterEgg={() => setBootTerminal(true)}
        stats={<>Modular Agent Framework · Copyright &copy;{' '}<a href="https://www.linkedin.com/in/tlebioda/" target="_blank" rel="noopener noreferrer" className="text-neon-green hover:underline">Tomasz Lebioda</a></>}
      />

      {bootTerminal && <BootTerminal onClose={(fromHub) => {
        setBootTerminal(false);
        if (fromHub) setShowFlagInput(true);
      }} />}
    </div>
  );
}
