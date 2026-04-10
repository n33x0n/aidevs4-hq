import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from 'react';
import { playHalcyon, stopHalcyon } from '../lib/audio';

interface BootTerminalProps {
  onClose: (fromHub?: boolean) => void;
}

interface TerminalLine {
  text: string;
  type: 'output' | 'input' | 'success' | 'error' | 'ascii';
}

const BOOT_LINES = [
  { text: '', delay: 300 },
  { text: 'AGENT_V BIOS v31337', delay: 400 },
  { text: 'Copyright (C) 2026 AI_devs Builders', delay: 600 },
  { text: '', delay: 400 },
  { text: 'Memory Test: 1048576K OK', delay: 800 },
  { text: 'Detecting drives... SSD0: agent.db', delay: 600 },
  { text: 'Loading AGENT_V kernel.......... OK', delay: 1200 },
  { text: 'Initializing neural pathways... OK', delay: 500 },
  { text: 'Establishing secure channel... OK', delay: 400 },
  { text: '', delay: 300 },
  { text: 'PROGRESS_BAR', delay: 0 },
  { text: '', delay: 200 },
  { text: 'SYSTEM READY. Type \'help\' for commands.', delay: 0 },
];

const HELP_TEXT = `Available commands:
  help       Show this help
  whoami     Display current identity
  status     System status report
  ls         List files
  cat <file> Read file contents
  manual     Field operations manual
  date       Current date/time
  ping       Test connectivity
  connect    Connect to remote host
  verify     Verify identity
  build      Build system component
  flag       Capture the flag
  clear      Clear terminal
  exit       Disconnect

Run 'manual' for the field guide.`;

const MANUAL_TEXT = `╔══════════════════════════════════════════╗
║     AGENT_V — FIELD OPERATIONS MANUAL    ║
╠══════════════════════════════════════════╣
║                                          ║
║  "Every builder must first CONNECT,      ║
║   then VERIFY, then BUILD."              ║
║                                          ║
║  Protocol sequence matters.              ║
║  Your .config holds what you need.       ║
║                                          ║
╚══════════════════════════════════════════╝`;

const FILES = ['.secret', '.config', 'README.md', 'agent.db', 'tasks/', 'solvers/', 'manual.txt'];
const COMMANDS = ['help', 'whoami', 'status', 'ls', 'cat', 'manual', 'date', 'ping', 'connect', 'verify', 'build', 'flag', 'clear', 'exit', 'sudo'];
const LS_TEXT = FILES.join('\n');

const STATUS_TEXT = `AGENT_V STATUS REPORT
─────────────────────
Tasks solved:     ███████░░░  classified
Secrets found:    ██░░░░░░░░  classified
Coffee level:     ░░░░░░░░░░  CRITICALLY LOW
Neural pathways:  ██████████  OPERATIONAL
Uptime:           ∞`;

// decoded at runtime
const _k = () => atob('e0ZMRzpCMDBUX1MzUVUzTkMzfQ==');

function buildCompleteBox() {
  const W = 46;
  const bdr = (s: string) => `║${s.padEnd(W)}║`;
  const line = (s: string) => bdr(`   ${s}`);
  const empty = bdr('');
  const top = `╔${'═'.repeat(W)}╗`;
  const bot = `╚${'═'.repeat(W)}╝`;
  const art = [
    '██████╗ ██╗   ██╗██╗██╗     ██████╗',
    '██╔══██╗██║   ██║██║██║     ██╔══██╗',
    '██████╔╝██║   ██║██║██║     ██║  ██║',
    '██╔══██╗██║   ██║██║██║     ██║  ██║',
    '██████╔╝╚██████╔╝██║███████╗██████╔╝',
    '╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═════╝',
  ];

  type Line = { text: string; type: TerminalLine['type']; delay: number };
  const lines: Line[] = [
    { text: top, type: 'success', delay: 200 },
    { text: empty, type: 'success', delay: 50 },
    ...art.map((a, i) => ({ text: line(a), type: 'success' as const, delay: i === 0 ? 100 : 50 })),
    { text: empty, type: 'success', delay: 50 },
    { text: line('BUILD COMPLETE'), type: 'success', delay: 200 },
    { text: empty, type: 'success', delay: 50 },
    { text: line(`Flag: ${_k()}`), type: 'success', delay: 400 },
    { text: empty, type: 'success', delay: 50 },
    { text: line('"The builders who seek shall find.'), type: 'success', delay: 50 },
    { text: line(' The flag is the key."'), type: 'success', delay: 50 },
    { text: empty, type: 'success', delay: 50 },
    { text: bot, type: 'success', delay: 200 },
    { text: '', type: 'success', delay: 400 },
    { text: 'Secure disconnect recommended. Type exit to return to HQ.', type: 'output', delay: 300 },
  ];
  return lines;
}

type InputMode = 'command' | 'verify-challenge';

export default function BootTerminal({ onClose }: BootTerminalProps) {
  const [phase, setPhase] = useState<'booting' | 'terminal'>('booting');
  const [bootLines, setBootLines] = useState<string[]>([]);
  const [progressWidth, setProgressWidth] = useState(0);
  const [terminalHistory, setTerminalHistory] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [puzzleState, setPuzzleState] = useState({ connected: false, verified: false });
  const [isClosing, setIsClosing] = useState(false);
  const [promptHost, setPromptHost] = useState('hq');
  const [inputDisabled, setInputDisabled] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('command');

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bootTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const seqTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [bootLines, terminalHistory]);

  // Focus input
  useEffect(() => {
    if (phase === 'terminal' && !inputDisabled) {
      inputRef.current?.focus();
    }
  }, [phase, inputDisabled]);

  // Boot sequence
  useEffect(() => {
    let totalDelay = 0;

    BOOT_LINES.forEach((line) => {
      totalDelay += line.delay;

      if (line.text === 'PROGRESS_BAR') {
        const barStart = totalDelay;
        for (let p = 0; p <= 100; p += 4) {
          const t = setTimeout(() => setProgressWidth(p), barStart + p * 15);
          bootTimers.current.push(t);
        }
        totalDelay += 100 * 15 + 200;
      } else {
        const t = setTimeout(() => {
          setBootLines((prev) => [...prev, line.text]);
        }, totalDelay);
        bootTimers.current.push(t);
      }
    });

    totalDelay += 500;
    const t = setTimeout(() => setPhase('terminal'), totalDelay);
    bootTimers.current.push(t);

    return () => bootTimers.current.forEach(clearTimeout);
  }, []);

  // Cleanup sequence timers
  useEffect(() => {
    return () => seqTimers.current.forEach(clearTimeout);
  }, []);

  // ESC to close
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { stopHalcyon(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const addOutput = useCallback((text: string, type: TerminalLine['type'] = 'output') => {
    setTerminalHistory((prev) => [...prev, { text, type }]);
  }, []);

  // Animated sequence: show lines one by one with delays, then run callback
  const playSequence = useCallback((lines: { text: string; type: TerminalLine['type']; delay: number }[], onDone?: () => void) => {
    setInputDisabled(true);
    let total = 0;
    for (const line of lines) {
      total += line.delay;
      const t = setTimeout(() => {
        setTerminalHistory((prev) => [...prev, { text: line.text, type: line.type }]);
      }, total);
      seqTimers.current.push(t);
    }
    total += 100;
    const t = setTimeout(() => {
      setInputDisabled(false);
      onDone?.();
    }, total);
    seqTimers.current.push(t);
  }, []);

  const handleVerifyInput = useCallback((response: string) => {
    const trimmed = response.trim().toLowerCase();
    setTerminalHistory((prev) => [...prev, { text: `response> ${response.trim()}`, type: 'input' }]);
    setInputMode('command');

    if (trimmed === 'builder') {
      playSequence([
        { text: 'Matching against credential store...', type: 'output', delay: 400 },
        { text: 'Hash comparison:  0x7f3a...b2c1 ✓', type: 'output', delay: 600 },
        { text: 'Signature valid.', type: 'output', delay: 300 },
        { text: '', type: 'output', delay: 200 },
        { text: '▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ IDENTITY CONFIRMED', type: 'success', delay: 500 },
        { text: 'Access level: ELEVATED', type: 'success', delay: 300 },
        { text: 'Welcome, Builder.', type: 'success', delay: 400 },
      ], () => {
        setPuzzleState((prev) => ({ ...prev, verified: true }));
      });
    } else {
      playSequence([
        { text: 'Matching against credential store...', type: 'output', delay: 400 },
        { text: `Hash mismatch for identity '${response.trim()}'.`, type: 'error', delay: 500 },
        { text: 'ACCESS DENIED. Connection remains active.', type: 'error', delay: 300 },
      ]);
    }
  }, [playSequence]);

  const handleCommand = useCallback((cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    // Verify challenge mode
    if (inputMode === 'verify-challenge') {
      handleVerifyInput(trimmed);
      return;
    }

    const prompt = `agent_v@${promptHost}:~$`;
    setTerminalHistory((prev) => [...prev, { text: `${prompt} ${trimmed}`, type: 'input' }]);
    setCommandHistory((prev) => [...prev, trimmed]);
    setHistoryIndex(-1);

    const parts = trimmed.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (command) {
      case 'help':
        addOutput(HELP_TEXT);
        break;

      case 'whoami':
        addOutput('Agent V — Builder, AI_devs 4');
        break;

      case 'status':
        addOutput(STATUS_TEXT);
        break;

      case 'ls':
        addOutput(LS_TEXT);
        break;

      case 'cat':
        if (args === '.secret') {
          addOutput('Permission denied. Access level insufficient.', 'error');
        } else if (args === '.config') {
          addOutput('host=builder.ag3nts.org\nport=443\nprotocol=secure\nrole=builder\ntarget=agent');
        } else if (args === 'README.md') {
          addOutput('# AGENT_V\nModular Agent Framework for AI_devs 4 Builders.\nSee manual for operations protocol.');
        } else if (args === 'manual.txt') {
          addOutput(MANUAL_TEXT);
        } else if (args) {
          addOutput(`cat: ${args}: No such file or directory`, 'error');
        } else {
          addOutput('Usage: cat <filename>', 'error');
        }
        break;

      case 'sudo':
        if (args.startsWith('cat .secret')) {
          addOutput('Nice try. Root access requires something more... creative.', 'error');
        } else {
          addOutput('sudo: permission denied. This incident will be reported.', 'error');
        }
        break;

      case 'manual':
        addOutput(MANUAL_TEXT);
        break;

      case 'date':
        addOutput(new Date().toLocaleString('pl-PL', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }));
        break;

      case 'ping': {
        const host = args || 'localhost';
        const lines = [
          `PING ${host} (10.13.37.1): 56 data bytes`,
          `64 bytes from 10.13.37.1: seq=0 ttl=64 time=${(Math.random() * 5 + 1).toFixed(1)} ms`,
          `64 bytes from 10.13.37.1: seq=1 ttl=64 time=${(Math.random() * 5 + 1).toFixed(1)} ms`,
          `64 bytes from 10.13.37.1: seq=2 ttl=64 time=${(Math.random() * 5 + 1).toFixed(1)} ms`,
          `--- ${host} ping statistics ---`,
          `3 packets transmitted, 3 received, 0% packet loss`,
        ];
        addOutput(lines.join('\n'));
        break;
      }

      case 'connect':
        if (puzzleState.connected) {
          addOutput(`Already connected to builder.ag3nts.org.`, 'error');
        } else if (args.toLowerCase() === 'builder.ag3nts.org') {
          playSequence([
            { text: 'Resolving builder.ag3nts.org...         10.13.37.1', type: 'output', delay: 400 },
            { text: 'TCP handshake...                    SYN', type: 'output', delay: 300 },
            { text: 'TCP handshake...                    SYN → SYN-ACK', type: 'output', delay: 250 },
            { text: 'TCP handshake...                    SYN → SYN-ACK → ACK ✓', type: 'success', delay: 200 },
            { text: 'TLS 1.3 negotiation...              ECDHE-X25519', type: 'output', delay: 500 },
            { text: 'Certificate verification...         ag3nts.org [VALID] ✓', type: 'success', delay: 400 },
            { text: 'Opening secure channel...           ████████████████ OK', type: 'success', delay: 600 },
            { text: '', type: 'output', delay: 200 },
            { text: 'Connected to builder.ag3nts.org', type: 'success', delay: 300 },
            { text: `Session: 0x${Math.random().toString(16).slice(2, 10).toUpperCase()} | Encrypted | Latency: ${(Math.random() * 4 + 1).toFixed(1)}ms`, type: 'output', delay: 200 },
          ], () => {
            setPuzzleState((prev) => ({ ...prev, connected: true }));
            setPromptHost('hub');
          });
        } else if (args) {
          addOutput(`connect: ${args}: Connection refused`, 'error');
        } else {
          addOutput('Usage: connect <host>', 'error');
        }
        break;

      case 'verify':
        if (!puzzleState.connected) {
          addOutput('Error: No active connection. Connect to a host first.', 'error');
        } else if (puzzleState.verified) {
          addOutput('Identity already verified. Access level: ELEVATED.', 'success');
        } else {
          playSequence([
            { text: 'Initiating verification protocol...', type: 'output', delay: 400 },
            { text: 'Loading identity module...          ████████████████ OK', type: 'output', delay: 600 },
            { text: 'Scanning neural signature...        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓', type: 'output', delay: 800 },
            { text: '', type: 'output', delay: 200 },
            { text: '┌─────────────────────────────────────────┐', type: 'ascii', delay: 300 },
            { text: '│  IDENTITY CHALLENGE                     │', type: 'ascii', delay: 100 },
            { text: '│  What is your role?                     │', type: 'ascii', delay: 100 },
            { text: '│  Hint: check your credentials (.config) │', type: 'ascii', delay: 100 },
            { text: '└─────────────────────────────────────────┘', type: 'ascii', delay: 100 },
            { text: '', type: 'output', delay: 200 },
          ], () => {
            setInputMode('verify-challenge');
          });
        }
        break;

      case 'build':
        if (!puzzleState.connected) {
          addOutput('Error: No active connection. Connect to a host first.', 'error');
        } else if (!puzzleState.verified) {
          addOutput('Error: Identity not verified. Run verify first.', 'error');
        } else if (args.toLowerCase() === 'agent') {
          playSequence([
            { text: 'Initializing build pipeline...', type: 'output', delay: 400 },
            { text: 'Fetching solver modules...          ░░░░░░░░░░░░░░░░', type: 'output', delay: 300 },
            { text: 'Fetching solver modules...          ████░░░░░░░░░░░░', type: 'output', delay: 300 },
            { text: 'Fetching solver modules...          ████████░░░░░░░░', type: 'output', delay: 300 },
            { text: 'Fetching solver modules...          ████████████░░░░', type: 'output', delay: 300 },
            { text: 'Fetching solver modules...          ████████████████ OK', type: 'success', delay: 300 },
            { text: 'Compiling task registry...          ████████████████ OK', type: 'success', delay: 400 },
            { text: 'Linking neural pathways...          ████████████████ OK', type: 'success', delay: 400 },
            { text: 'Running integrity checks...         PASS (31337 assertions)', type: 'success', delay: 500 },
            { text: '', type: 'output', delay: 300 },
            ...buildCompleteBox(),
          ], () => { playHalcyon(); });
        } else if (args) {
          addOutput(`build: unknown target '${args}'`, 'error');
        } else {
          addOutput('Usage: build <target>', 'error');
        }
        break;

      case 'flag':
        addOutput('{FLG:NIC3_TRY}\n\n...wait, that doesn\'t look right. Maybe there\'s another way.', 'error');
        break;

      case 'clear':
        setTerminalHistory([]);
        break;

      case 'exit':
        stopHalcyon();
        addOutput('You can check out any time, but you can never leave...');
        setIsClosing(true);
        setTimeout(() => onClose(puzzleState.connected), 2000);
        break;

      case 'rm':
        addOutput('Nice try. Self-destruct sequence requires two-factor authentication.', 'error');
        break;

      case 'hack':
        addOutput('I appreciate the enthusiasm, but we\'re the good guys here.', 'error');
        break;

      default:
        addOutput(`Command not found: ${command}. Type 'help' for available commands.`, 'error');
    }
  }, [puzzleState, promptHost, inputMode, addOutput, onClose, playSequence, handleVerifyInput]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const parts = input.split(/\s+/);
      const isFirstWord = parts.length <= 1;
      const partial = (parts.at(-1) ?? '').toLowerCase();
      if (!partial) return;

      const cmd = parts[0]?.toLowerCase();
      const argPool = isFirstWord ? COMMANDS
        : cmd === 'cat' ? FILES.filter((f) => !f.endsWith('/'))
        : cmd === 'connect' ? ['builder.ag3nts.org']
        : cmd === 'verify' ? ['builder']
        : cmd === 'build' ? ['agent']
        : cmd === 'ping' ? ['builder.ag3nts.org', 'localhost']
        : FILES;
      const candidates = argPool.filter((c) => c.toLowerCase().startsWith(partial));

      if (candidates.length === 1) {
        const completed = isFirstWord
          ? candidates[0] + ' '
          : [...parts.slice(0, -1), candidates[0]].join(' ');
        setInput(isFirstWord ? completed : completed);
      } else if (candidates.length > 1) {
        // find common prefix
        let prefix = candidates[0];
        for (const c of candidates) {
          while (!c.startsWith(prefix)) prefix = prefix.slice(0, -1);
        }
        if (prefix.length > partial.length) {
          const newParts = [...parts.slice(0, -1), prefix];
          setInput(newParts.join(' '));
        } else {
          addOutput(candidates.join('  '));
        }
      }
      return;
    }
    if (e.key === 'Enter') {
      handleCommand(input);
      setInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex !== -1) {
        const newIndex = historyIndex + 1;
        if (newIndex >= commandHistory.length) {
          setHistoryIndex(-1);
          setInput('');
        } else {
          setHistoryIndex(newIndex);
          setInput(commandHistory[newIndex]);
        }
      }
    }
  };

  const renderProgressBar = () => {
    const filled = Math.round(progressWidth / 100 * 30);
    const bar = '█'.repeat(filled) + '░'.repeat(30 - filled);
    return `${bar} ${progressWidth}%`;
  };

  const isHub = promptHost === 'hub';

  const renderPrompt = () => {
    if (inputMode === 'verify-challenge') {
      return <span className="text-cyan-400/90 mr-1 shrink-0">response&gt;</span>;
    }
    return (
      <span className="mr-1 shrink-0 text-white/70">
        agent_v@{isHub ? <span className="matrix-glow">hub</span> : 'hq'}:~$
      </span>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black flex flex-col font-mono text-sm cursor-text"
      style={{ color: '#75F66D' }}
      onClick={() => { if (!window.getSelection()?.toString()) inputRef.current?.focus(); }}
    >
      <style>{`
        .matrix-glow {
          color: #75F66D;
          animation: matrixPulse 2s ease-in-out infinite;
        }
        @keyframes matrixPulse {
          0%, 100% { text-shadow: 0 0 4px #75F66D, 0 0 8px #75F66D40; opacity: 1; }
          50% { text-shadow: 0 0 8px #75F66D, 0 0 16px #75F66D80, 0 0 24px #75F66D30; opacity: 0.85; }
        }
      `}</style>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 pb-2">
        {phase === 'booting' && (
          <div className="whitespace-pre-wrap">
            {bootLines.map((line, i) => (
              <div key={i} className={line === '' ? 'h-4' : ''}>{line}</div>
            ))}
            {progressWidth > 0 && progressWidth <= 100 && (
              <div>{renderProgressBar()}</div>
            )}
          </div>
        )}

        {phase === 'terminal' && (
          <div className="whitespace-pre-wrap">
            {terminalHistory.map((line, i) => (
              <div
                key={i}
                className={
                  line.type === 'input' ? 'text-white/70' :
                  line.type === 'success' ? 'text-emerald-400' :
                  line.type === 'error' ? 'text-red-400/80' :
                  line.type === 'ascii' ? 'text-cyan-400/90' :
                  ''
                }
              >
                {line.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {phase === 'terminal' && !isClosing && !inputDisabled && (
        <div className="flex items-center px-6 pb-6 pt-2">
          {renderPrompt()}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent outline-none border-none caret-current"
            style={{ color: '#75F66D' }}
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      )}

      <div className="absolute top-4 right-6 text-xs text-gray-700">
        ESC — emergency abort
      </div>
    </div>
  );
}
