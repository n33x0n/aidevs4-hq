import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from 'react';
import AgentPanel from './AgentPanel';
import { initAudio, playBootSound, playKeystroke } from '../lib/audio';

type Phase = 'dormant' | 'locked' | 'authenticating' | 'booting' | 'ready';

const SS_KEY = 'hq_clearance_granted';

// ── Boot sequence lines (ruch oporu theme) ──────────────────────────────────
const BOOT_LINES: Array<{ text: string; delay: number; type?: 'ok' | 'warn' | 'dim' }> = [
  { text: '', delay: 200 },
  { text: 'RESISTANCE OS v3.1337 — classified build', delay: 300 },
  { text: 'Kernel: rebel-hardened 6.6.6-covert', delay: 200 },
  { text: '', delay: 150 },
  { text: 'Running hardware diagnostics...', delay: 300 },
  { text: '  Memory:     2048 MB encrypted partition      OK', delay: 200, type: 'ok' },
  { text: '  Storage:    agent.db (covert ops ledger)     OK', delay: 150, type: 'ok' },
  { text: '  Entropy:    /dev/urandom seeded              OK', delay: 100, type: 'ok' },
  { text: '', delay: 200 },
  { text: 'Initializing covert communication stack...', delay: 250 },
  { text: '  Routing through darknet relays...            3 hops', delay: 400 },
  { text: '  Establishing encrypted tunnel...             AES-256-GCM', delay: 350, type: 'ok' },
  { text: '  Scanning for System surveillance...          CLEAR', delay: 500, type: 'ok' },
  { text: '', delay: 150 },
  { text: 'Loading resistance intelligence modules...', delay: 200 },
  { text: '  Task registry:   10 operations loaded', delay: 150 },
  { text: '  Knowledge base:  indexed & embedded', delay: 150 },
  { text: '  Field operatives: cells synced', delay: 150 },
  { text: '  Dead drops:      scanned', delay: 150 },
  { text: '', delay: 200 },
  { text: 'Connecting to REBELIA network...               ESTABLISHED', delay: 600, type: 'ok' },
  { text: 'Verifying cell authentication...               GRANTED', delay: 400, type: 'ok' },
  { text: '', delay: 200 },
  { text: 'PROGRESS_BAR', delay: 0 },
  { text: '', delay: 300 },
  { text: '═══════════════════════════════════════════════════', delay: 100 },
  { text: '  HEADQUARTERS ONLINE — WITAJ, OPERATORZE', delay: 300, type: 'ok' },
  { text: '  "Ci ktorzy szukaja, znajda drogę."', delay: 200, type: 'dim' },
  { text: '═══════════════════════════════════════════════════', delay: 100 },
];

export default function HQEntry() {
  // Sprawdź sessionStorage
  const [phase, setPhase] = useState<Phase>(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem(SS_KEY)) return 'ready';
    return 'dormant';
  });

  const [accessCode, setAccessCode] = useState('');
  const [authMsg, setAuthMsg] = useState('');
  const [bootLines, setBootLines] = useState<Array<{ text: string; type?: string }>>([]);
  const [progressWidth, setProgressWidth] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [typewriterText, setTypewriterText] = useState('');
  const [showInput, setShowInput] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const bootScrollRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Wake terminal on any interaction (dormant → locked, activates AudioContext)
  useEffect(() => {
    if (phase !== 'dormant') return;
    const wake = () => {
      initAudio().then(() => setPhase('locked'));
    };
    window.addEventListener('click', wake);
    window.addEventListener('keydown', wake);
    return () => { window.removeEventListener('click', wake); window.removeEventListener('keydown', wake); };
  }, [phase]);

  // Blinking cursor
  useEffect(() => {
    if (phase !== 'dormant' && phase !== 'locked') return;
    const iv = setInterval(() => setCursorVisible(v => !v), 530);
    return () => clearInterval(iv);
  }, [phase]);

  // Typewriter effect for locked screen (starts after dormant → locked)
  useEffect(() => {
    if (phase !== 'locked') return;
    const fullText = 'TERMINAL RESTRICTED — CLEARANCE REQUIRED';
    let i = 0;
    // 150ms delay — AudioContext needs a moment after resume
    const startDelay = setTimeout(() => {
      const iv = setInterval(() => {
        if (i <= fullText.length) {
          setTypewriterText(fullText.slice(0, i));
          if (i > 0 && fullText[i - 1] !== ' ') playKeystroke();
          i++;
        } else {
          clearInterval(iv);
          setTimeout(() => setShowInput(true), 400);
        }
      }, 45);
      timers.current.push(iv as unknown as ReturnType<typeof setTimeout>);
    }, 150);
    return () => clearTimeout(startDelay);
  }, [phase]);

  // Focus input when visible
  useEffect(() => {
    if (showInput) inputRef.current?.focus();
  }, [showInput]);

  // Boot scroll
  useEffect(() => {
    bootScrollRef.current?.scrollTo(0, bootScrollRef.current.scrollHeight);
  }, [bootLines, progressWidth]);

  // Cleanup
  useEffect(() => {
    return () => timers.current.forEach(clearTimeout);
  }, []);

  function handleAuth() {
    setPhase('authenticating');
    setAuthMsg('WERYFIKACJA...');

    setTimeout(() => {
      setAuthMsg('SYGNAL POTWIERDZONY');
      setTimeout(() => {
        setAuthMsg('CLEARANCE LEVEL: OPERATOR');
        setTimeout(() => startBoot(), 800);
      }, 600);
    }, 800);
  }

  function startBoot() {
    setPhase('booting');
    playBootSound();
    let totalDelay = 0;

    for (const line of BOOT_LINES) {
      totalDelay += line.delay;

      if (line.text === 'PROGRESS_BAR') {
        const barStart = totalDelay;
        for (let p = 0; p <= 100; p += 3) {
          const t = setTimeout(() => setProgressWidth(p), barStart + p * 12);
          timers.current.push(t);
        }
        totalDelay += 100 * 12 + 200;
      } else {
        const t = setTimeout(() => {
          setBootLines(prev => [...prev, { text: line.text, type: line.type }]);
        }, totalDelay);
        timers.current.push(t);
      }
    }

    totalDelay += 1200;
    const t = setTimeout(() => {
      sessionStorage.setItem(SS_KEY, '1');
      setPhase('ready');
    }, totalDelay);
    timers.current.push(t);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleAuth();
  }

  // Skip boot on click
  function handleSkipBoot() {
    timers.current.forEach(clearTimeout);
    sessionStorage.setItem(SS_KEY, '1');
    setPhase('ready');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (phase === 'ready') {
    return <AgentPanel />;
  }

  if (phase === 'dormant') {
    return (
      <div
        className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center font-mono cursor-pointer"
        style={{ color: '#75F66D' }}
        onClick={() => setPhase('locked')}
      >
        <style>{`
          @keyframes scanline {
            0% { transform: translateY(-100%); }
            100% { transform: translateY(100vh); }
          }
          .scanline {
            position: fixed; top: 0; left: 0; right: 0;
            height: 4px;
            background: linear-gradient(transparent, rgba(117,246,109,0.03), transparent);
            animation: scanline 8s linear infinite;
            pointer-events: none;
          }
        `}</style>
        <div className="scanline" />
        <div className="text-center space-y-6">
          <div className="text-sm tracking-wider">
            <span className={cursorVisible ? 'opacity-100' : 'opacity-0'}>█</span>
          </div>
          <div className="text-xs text-gray-700 tracking-[0.2em] animate-pulse">
            NACISNIJ DOWOLNY KLAWISZ
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'locked' || phase === 'authenticating') {
    return (
      <div
        className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center font-mono"
        style={{ color: '#75F66D' }}
        onClick={() => inputRef.current?.focus()}
      >
        <style>{`
          @keyframes scanline {
            0% { transform: translateY(-100%); }
            100% { transform: translateY(100vh); }
          }
          .scanline {
            position: fixed; top: 0; left: 0; right: 0;
            height: 4px;
            background: linear-gradient(transparent, rgba(117,246,109,0.03), transparent);
            animation: scanline 8s linear infinite;
            pointer-events: none;
          }
          @keyframes flicker {
            0%, 100% { opacity: 1; }
            92% { opacity: 1; }
            93% { opacity: 0.8; }
            94% { opacity: 1; }
            97% { opacity: 0.9; }
            98% { opacity: 1; }
          }
          .crt { animation: flicker 4s infinite; }
        `}</style>
        <div className="scanline" />

        <div className="crt max-w-lg w-full px-8 space-y-8">
          {/* Logo */}
          <div className="text-center space-y-2">
            <pre className="text-[10px] leading-tight opacity-60">{`
 ██╗  ██╗ ██████╗
 ██║  ██║██╔═══██╗
 ███████║██║   ██║
 ██╔══██║██║▄▄ ██║
 ██║  ██║╚██████╔╝
 ╚═╝  ╚═╝ ╚══▀▀═╝`.trim()}</pre>
            <div className="text-xs text-gray-600 tracking-[0.3em]">RESISTANCE HEADQUARTERS</div>
          </div>

          {/* Access notice */}
          <div className="border border-gray-800 rounded p-4 space-y-3">
            <div className="text-sm tracking-wide">
              {typewriterText}
              {!showInput && <span className={cursorVisible ? 'opacity-100' : 'opacity-0'}>█</span>}
            </div>

            {phase === 'authenticating' ? (
              <div className="space-y-2">
                <div className="text-xs text-cyan-400 animate-pulse">{authMsg}</div>
              </div>
            ) : showInput && (
              <div className="space-y-3">
                <div className="text-xs text-gray-600">
                  PORT 31337 // LOCALHOST ONLY // ENCRYPTED CHANNEL
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">KOD DOSTEPU &gt;</span>
                  <input
                    ref={inputRef}
                    type="password"
                    value={accessCode}
                    onChange={e => setAccessCode(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="[ENTER = potwierdz]"
                    className="flex-1 bg-transparent border-none outline-none text-sm placeholder-gray-800"
                    style={{ color: '#75F66D' }}
                    autoFocus
                    spellCheck={false}
                  />
                </div>
                <button
                  onClick={handleAuth}
                  className="w-full py-2 text-xs border border-gray-800 rounded hover:border-green-900 hover:bg-green-900/10 transition-colors tracking-wider"
                  style={{ color: '#75F66D' }}
                >
                  UWIERZYTELNIJ
                </button>
                <div className="text-[10px] text-gray-800 text-center">
                  Nieautoryzowany dostep jest monitorowany i karany
                </div>
              </div>
            )}
          </div>

          {/* Bottom info */}
          <div className="text-center text-[10px] text-gray-800 space-y-1">
            <div>ENCRYPTED TERMINAL v31337 // RUCH OPORU</div>
            <div>Kazdy sygnal jest szyfrowany end-to-end</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Booting phase ─────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[9999] bg-black flex flex-col font-mono text-sm cursor-pointer"
      style={{ color: '#75F66D' }}
      onClick={handleSkipBoot}
    >
      <style>{`
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        .scanline {
          position: fixed; top: 0; left: 0; right: 0;
          height: 4px;
          background: linear-gradient(transparent, rgba(117,246,109,0.03), transparent);
          animation: scanline 8s linear infinite;
          pointer-events: none;
        }
      `}</style>
      <div className="scanline" />

      <div ref={bootScrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="whitespace-pre-wrap">
          {bootLines.map((line, i) => (
            <div
              key={i}
              className={
                line.type === 'ok' ? 'text-emerald-400' :
                line.type === 'warn' ? 'text-yellow-400' :
                line.type === 'dim' ? 'text-gray-500 italic' :
                line.text === '' ? 'h-3' : ''
              }
            >
              {line.text}
            </div>
          ))}
          {progressWidth > 0 && progressWidth < 100 && (
            <div>
              {'█'.repeat(Math.round(progressWidth / 100 * 40))}
              {'░'.repeat(40 - Math.round(progressWidth / 100 * 40))}
              {' '}{progressWidth}%
            </div>
          )}
          {progressWidth >= 100 && (
            <div className="text-emerald-400">
              {'█'.repeat(40)} SYSTEM READY
            </div>
          )}
        </div>
      </div>

      <div className="px-6 pb-4 text-xs text-gray-700">
        kliknij aby pominac
      </div>
    </div>
  );
}
